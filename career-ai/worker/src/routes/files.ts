import { findCvVersionByDocument } from "../db/cv-versions";
import { getDocument, insertDocument, knownR2Keys, listDocuments, toDocumentDto } from "../db/documents";
import { downloadResponse, removeStoredDocument, storeUpload, validateUpload } from "../files/upload";
import { sanitiseFileName } from "../files/signature";
import { conflict, notFound } from "../http/errors";
import { json } from "../http/responses";
import type { RequestContext } from "../http/router";
import { requireIdParam } from "../http/validation";

/**
 * Phase 1 private file endpoints. Unchanged behaviour; validation, storage and download are shared
 * with the master CV routes through files/upload.ts. A file that backs a CV version cannot be
 * deleted here: delete the CV version instead, which requires typed confirmation.
 */

/** POST /api/files: stores a PDF/DOCX privately in R2 and records it in D1. */
export async function uploadFile({ request, env }: RequestContext): Promise<Response> {
  const row = await storeUpload(env, await validateUpload(request));
  return json({ ok: true, file: toDocumentDto(row) }, 201);
}

export async function listFiles({ env }: RequestContext): Promise<Response> {
  return json({ files: (await listDocuments(env.DB)).map(toDocumentDto) });
}

/** GET /api/files/:id: downloads a stored file as an attachment (never rendered inline). */
export async function downloadFile({ env, params }: RequestContext): Promise<Response> {
  const row = await getDocument(env.DB, requireIdParam(params.id));
  if (!row) throw notFound("File");
  return downloadResponse(env, row);
}

/** DELETE /api/files/:id: removes the file from R2 and its record from D1. */
export async function removeFile({ env, params }: RequestContext): Promise<Response> {
  const row = await getDocument(env.DB, requireIdParam(params.id));
  if (!row) throw notFound("File");
  const cvVersionId = await findCvVersionByDocument(env.DB, row.id);
  if (cvVersionId) {
    throw conflict("document_in_use", "This file is a master CV version. Delete it from the Master CV section instead.", { cvVersionId });
  }
  await removeStoredDocument(env, row);
  return json({ ok: true, deleted: row.id });
}

/**
 * POST /api/files/reconcile: one-off recovery for files uploaded before migration 0002, which were
 * stored in R2 without a D1 record. Registers each unrecorded object under `private/` (excluding
 * derived CV text) so it can be listed, downloaded or deleted. Safe to run more than once.
 */
export async function reconcileFiles({ env }: RequestContext): Promise<Response> {
  const known = await knownR2Keys(env.DB);
  let cursor: string | undefined;
  let scanned = 0;
  let registered = 0;
  do {
    const page = await env.PRIVATE_FILES.list({ prefix: "private/", limit: 500, include: ["httpMetadata", "customMetadata"], ...(cursor ? { cursor } : {}) });
    for (const object of page.objects) {
      if (object.key.startsWith("private/cv/")) continue; // extracted CV text, managed by CV versions
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
