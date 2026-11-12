import { sha256, toHex } from "../auth/crypto";
import { MAX_UPLOAD_BYTES } from "../config";
import type { Env } from "../env";
import { deleteDocument, getDocument, insertDocument, type DocumentRow } from "../db/documents";
import { readBodyBytes } from "../http/body";
import { badRequest, HttpError, payloadTooLarge, unsupportedMediaType } from "../http/errors";
import { SECURITY_HEADERS } from "../http/responses";
import { detectFileType, FILE_TYPES, sanitiseFileName, typeFromFileName, type SupportedFileType } from "./signature";

/**
 * The single upload and download path for private files, shared by /api/files (Phase 1) and the
 * master CV routes (Phase 2):
 * - size enforced while streaming (Content-Length is not trusted);
 * - type detected from the bytes (PDF or DOCX only), and the file name and declared content type
 *   must agree with it;
 * - the file name is decoded safely and stripped of paths and control characters;
 * - files go to the private R2 bucket under a random key and are recorded in D1;
 * - downloads are always attachments, never rendered inline.
 */

export interface ValidatedUpload {
  name: string;
  bytes: Uint8Array;
  type: SupportedFileType;
  mime: string;
  sha256: string;
}

const UPLOAD_PREFIX = "private/uploads/";
const LIMIT_MESSAGE = `Files must be ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB or smaller.`;

export async function validateUpload(request: Request): Promise<ValidatedUpload> {
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
  return { name, bytes, type: detected, mime: FILE_TYPES[detected].mime, sha256: toHex(await sha256(bytes)) };
}

/** Stores a validated upload in R2 and records it in D1. Never leaves an unrecorded object behind. */
export async function storeUpload(env: Env, upload: ValidatedUpload): Promise<DocumentRow> {
  const id = crypto.randomUUID();
  const key = `${UPLOAD_PREFIX}${id}`;
  await env.PRIVATE_FILES.put(key, upload.bytes, {
    httpMetadata: { contentType: upload.mime },
    customMetadata: { originalName: upload.name, sha256: upload.sha256, documentId: id },
  });
  const row: DocumentRow = {
    id,
    r2_key: key,
    kind: "upload",
    original_name: upload.name,
    content_type: upload.mime,
    size_bytes: upload.bytes.byteLength,
    sha256: upload.sha256,
    created_at: new Date().toISOString(),
  };
  try {
    await insertDocument(env.DB, row);
  } catch (error) {
    await env.PRIVATE_FILES.delete(key);
    throw error;
  }
  return (await getDocument(env.DB, id)) ?? row;
}

/** Removes a stored file: the R2 object first (idempotent), then its D1 record. */
export async function removeStoredDocument(env: Env, row: Pick<DocumentRow, "id" | "r2_key">): Promise<void> {
  await env.PRIVATE_FILES.delete(row.r2_key);
  await deleteDocument(env.DB, row.id);
}

/** An authenticated download of a stored file, always as an attachment. */
export async function downloadResponse(env: Env, row: Pick<DocumentRow, "r2_key" | "original_name" | "content_type">): Promise<Response> {
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
