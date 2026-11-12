import { toHex, sha256 } from "../auth/crypto";
import { MAX_UPLOAD_BYTES } from "../config";
import { deleteDocument, getDocument, insertDocument, knownR2Keys, listDocuments, toDocumentDto } from "../db/documents";
import { detectFileType, FILE_TYPES, sanitiseFileName, typeFromFileName } from "../files/signature";
import { readBodyBytes } from "../http/body";
import { badRequest, HttpError, notFound, payloadTooLarge, unsupportedMediaType } from "../http/errors";
import { json, SECURITY_HEADERS } from "../http/responses";
import type { RequestContext } from "../http/router";
import { requireIdParam } from "../http/validation";

const UPLOAD_PREFIX = "private/uploads/";
const LIMIT_MESSAGE = `Files must be ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB or smaller.`;

/**
 * POST /api/files: stores a CV privately in R2 and records it in D1.
 * Size is enforced while streaming, the type is detected from the file's bytes (PDF or DOCX only),
 * and the file name and declared content type must agree with what the bytes are.
 * Text extraction is not part of Phase 1.
 */
export async function uploadFile({ request, env }: RequestContext): Promise<Response> {
  const name = sanitiseFileName(request.headers.get("x-file-name"));
  if (name === null) throw badRequest("The file name is missing or could not be read.", { fileName: "Invalid file name." });
  const typeByName = typeFromFileName(name);
  if (typeByName === null) throw unsupportedMediaType("Only PDF (.pdf) and Word (.docx) files are accepted.");

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) throw payloadTooLarge(LIMIT_MESSAGE);
  const bytes = await readBodyBytes(request, MAX_UPLOAD_BYTES, LIMIT_MESSAGE);
  if (bytes.byteLength === 0) throw badRequest("The file is empty.");

  const detected = detectFileType(bytes);
  if (detected === null) throw unsupportedMediaType("The file content is not a valid PDF or DOCX document.");
  if (detected !== typeByName) {
    throw unsupportedMediaType(`The file is named ${FILE_TYPES[typeByName].extension} but its content is ${FILE_TYPES[detected].extension}.`);
  }
  const declaredType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (declaredType !== "" && declaredType !== "application/octet-stream" && declaredType !== FILE_TYPES[detected].mime) {
    throw unsupportedMediaType("The declared content type does not match the file content.");
  }

  const id = crypto.randomUUID();
  const key = `${UPLOAD_PREFIX}${id}`;
  const hash = toHex(await sha256(bytes));
  const createdAt = new Date().toISOString();
  await env.PRIVATE_FILES.put(key, bytes, {
    httpMetadata: { contentType: FILE_TYPES[detected].mime },
    customMetadata: { originalName: name, sha256: hash, documentId: id },
  });
  try {
    await insertDocument(env.DB, {
      id,
      r2_key: key,
      kind: "upload",
      original_name: name,
      content_type: FILE_TYPES[detected].mime,
      size_bytes: bytes.byteLength,
      sha256: hash,
      created_at: createdAt,
    });
  } catch (error) {
    // Never leave an unrecorded file in storage.
    await env.PRIVATE_FILES.delete(key);
    throw error;
  }
  const row = await getDocument(env.DB, id);
  return json({ ok: true, file: row ? toDocumentDto(row) : null }, 201);
}

export async function listFiles({ env }: RequestContext): Promise<Response> {
  return json({ files: (await listDocuments(env.DB)).map(toDocumentDto) });
}

/** GET /api/files/:id: downloads a stored file as an attachment (never rendered inline). */
export async function downloadFile({ env, params }: RequestContext): Promise<Response> {
  const row = await getDocument(env.DB, requireIdParam(params.id));
  if (!row) throw notFound("File");
  const object = await env.PRIVATE_FILES.get(row.r2_key);
  if (!object) throw new HttpError(404, "file_missing", "The stored file could not be found.");
  const asciiName = row.original_name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(object.body, {
    headers: {
      ...SECURITY_HEADERS,
      "content-type": row.content_type,
      "content-length": String(object.size),
      "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
    },
  });
}

/** DELETE /api/files/:id: removes the file from R2 and its record from D1. */
export async function removeFile({ env, params }: RequestContext): Promise<Response> {
  const row = await getDocument(env.DB, requireIdParam(params.id));
  if (!row) throw notFound("File");
  await env.PRIVATE_FILES.delete(row.r2_key);
  await deleteDocument(env.DB, row.id);
  return json({ ok: true, deleted: row.id });
}

/**
 * POST /api/files/reconcile: one-off recovery for files uploaded before migration 0002, which were
 * stored in R2 without a D1 record. Registers each unrecorded object under `private/` so it can be
 * listed, downloaded or deleted. Safe to run more than once.
 */
export async function reconcileFiles({ env }: RequestContext): Promise<Response> {
  const known = await knownR2Keys(env.DB);
  let cursor: string | undefined;
  let scanned = 0;
  let registered = 0;
  do {
    const page = await env.PRIVATE_FILES.list({ prefix: "private/", limit: 500, include: ["httpMetadata", "customMetadata"], ...(cursor ? { cursor } : {}) });
    for (const object of page.objects) {
      scanned += 1;
      if (known.has(object.key)) continue;
      const originalName = sanitiseFileName(encodeURIComponent(object.customMetadata?.originalName ?? "")) ?? "earlier-upload";
      await insertDocument(env.DB, {
        id: crypto.randomUUID(),
        r2_key: object.key,
        kind: "legacy_upload",
        original_name: originalName,
        content_type: object.httpMetadata?.contentType ?? "application/octet-stream",
        size_bytes: object.size,
        sha256: null,
        created_at: object.uploaded.toISOString(),
      });
      registered += 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && scanned < 5_000);
  return json({ ok: true, scanned, registered });
}
