import {
  activateCvVersion,
  deactivateCvVersion,
  findCvVersionByDocument,
  findLiveCvVersionBySha,
  getCvVersion,
  insertCvVersion,
  listCvVersions,
  recordExtractionStatement,
  reviewStatus,
  setReviewStatus,
  toCvVersionDto,
  tombstoneStatement,
  type CvVersionRow,
} from "../db/cv-versions";
import { getDocument } from "../db/documents";
import { countsByCv, deleteUnconfirmedFromCvStatement } from "../db/profile-items";
import { downloadResponse, removeStoredDocument, storeUpload, validateUpload } from "../files/upload";
import { readJson } from "../http/body";
import { badRequest, conflict, HttpError, notFound, unsupportedMediaType } from "../http/errors";
import { json } from "../http/responses";
import type { RequestContext } from "../http/router";
import { FieldErrors, isUuid, readEnum, rejectUnknownKeys, requireIdParam, requireObject } from "../http/validation";
import { insertProposalsDeduplicated } from "../profile/proposals";
import { structureCvText, STRUCTURER_VERSION } from "../profile/structure";

/**
 * Master CV versions. A version points at a stored file (the Phase 1 documents mechanism, reused):
 * upload, validation, R2 storage and downloads are shared with /api/files. Text is extracted in the
 * browser and submitted here; the Worker validates it, keeps it in private R2 (never in D1) and
 * turns it into PROPOSED profile items with fixed rules. Nothing is confirmed automatically.
 */

export const MAX_EXTRACTED_CHARS = 200_000;
const EXTRACTION_BODY_LIMIT = 1_000_000;
export const PARSERS: Record<string, "pdfjs-dist" | "nisco-docx"> = {
  "application/pdf": "pdfjs-dist",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "nisco-docx",
};
export const EXTRACTION_WARNINGS = [
  "page_limit_reached",
  "no_text_layer",
  "short_text",
  "password_protected",
  "timeout",
  "parse_error",
  "truncated",
  "unsupported_content",
  "headers_included",
  "encrypted",
  "too_large",
  "no_text",
] as const;
const DELETE_CONFIRMATION = "DELETE";

const textKey = (versionId: string) => `private/cv/${versionId}/extracted.txt`;

async function requireVersion(db: D1Database, id: string | undefined): Promise<CvVersionRow> {
  const row = await getCvVersion(db, requireIdParam(id));
  if (!row) throw notFound("CV version");
  return row;
}

function requireLive(row: CvVersionRow): void {
  if (row.status === "deleted" || !row.document_id) throw new HttpError(410, "cv_deleted", "This CV version has been deleted.");
}

async function dto(db: D1Database, id: string) {
  const row = await getCvVersion(db, id);
  if (!row) throw notFound("CV version");
  return toCvVersionDto(row, (await countsByCv(db)).get(id));
}

export async function listCvVersionsRoute({ env, url }: RequestContext): Promise<Response> {
  const includeDeleted = url.searchParams.get("includeDeleted") === "true";
  const [rows, counts] = await Promise.all([listCvVersions(env.DB, includeDeleted), countsByCv(env.DB)]);
  const versions = rows.map((row) => toCvVersionDto(row, counts.get(row.id)));
  return json({ versions, activeId: versions.find((version) => version.active)?.id ?? null });
}

export async function getCvVersionRoute({ env, params }: RequestContext): Promise<Response> {
  const row = await requireVersion(env.DB, params.id);
  return json({ version: toCvVersionDto(row, (await countsByCv(env.DB)).get(row.id)) });
}

/** POST /api/cv/versions: uploads a new master CV version (PDF or DOCX). */
export async function uploadCvVersion({ request, env }: RequestContext): Promise<Response> {
  const upload = await validateUpload(request);
  const existingId = await findLiveCvVersionBySha(env.DB, upload.sha256);
  if (existingId) throw conflict("duplicate_cv", "This exact file is already one of your CV versions.", { existingId });
  const document = await storeUpload(env, upload);
  const id = crypto.randomUUID();
  try {
    await insertCvVersion(env.DB, { id, documentId: document.id, now: new Date().toISOString() });
  } catch (error) {
    await removeStoredDocument(env, document);
    throw error;
  }
  return json({ ok: true, version: await dto(env.DB, id) }, 201);
}

/** POST /api/cv/versions/from-upload: makes an earlier upload a CV version without copying it. */
export async function registerExistingUpload({ request, env }: RequestContext): Promise<Response> {
  const body = requireObject(await readJson(request));
  const errors = new FieldErrors();
  rejectUnknownKeys(body, ["documentId"], errors);
  if (!isUuid(body.documentId)) errors.add("documentId", "A valid file ID is required.");
  errors.throwIfAny();
  const document = await getDocument(env.DB, (body.documentId as string).toLowerCase());
  if (!document) throw notFound("File");
  if (!PARSERS[document.content_type]) throw unsupportedMediaType("Only PDF and DOCX files can become CV versions.");
  const linked = await findCvVersionByDocument(env.DB, document.id);
  if (linked) throw conflict("already_cv_version", "This file is already a CV version.", { existingId: linked });
  if (document.sha256) {
    const duplicate = await findLiveCvVersionBySha(env.DB, document.sha256);
    if (duplicate) throw conflict("duplicate_cv", "This exact file is already one of your CV versions.", { existingId: duplicate });
  }
  const id = crypto.randomUUID();
  await insertCvVersion(env.DB, { id, documentId: document.id, now: new Date().toISOString() });
  return json({ ok: true, version: await dto(env.DB, id) }, 201);
}

export async function downloadCvVersion({ env, params }: RequestContext): Promise<Response> {
  const row = await requireVersion(env.DB, params.id);
  requireLive(row);
  if (!row.r2_key || !row.original_name || !row.content_type) throw new HttpError(404, "file_missing", "The stored file could not be found.");
  return downloadResponse(env, { r2_key: row.r2_key, original_name: row.original_name, content_type: row.content_type });
}

/** GET /api/cv/versions/:id/text: the extracted text, for review. */
export async function getExtractedText({ env, params }: RequestContext): Promise<Response> {
  const row = await requireVersion(env.DB, params.id);
  requireLive(row);
  if (!row.extracted_text_key) throw new HttpError(404, "not_extracted", "No text has been extracted from this CV yet.");
  const object = await env.PRIVATE_FILES.get(row.extracted_text_key);
  if (!object) throw new HttpError(404, "file_missing", "The extracted text could not be found.");
  const text = await object.text();
  return json({ text, characters: text.length });
}

/** Normalises submitted text: Unix newlines, no control characters except tab and newline. */
export function normaliseExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * POST /api/cv/versions/:id/extraction: records the browser's extraction result.
 * Body: { status, parser, parserVersion, text?, pageCount?, warnings? }.
 */
export async function submitExtraction({ request, env, params }: RequestContext): Promise<Response> {
  const row = await requireVersion(env.DB, params.id);
  requireLive(row);
  const body = requireObject(await readJson(request, EXTRACTION_BODY_LIMIT));
  const errors = new FieldErrors();
  rejectUnknownKeys(body, ["status", "parser", "parserVersion", "text", "pageCount", "warnings"], errors);
  let status = readEnum(body, "status", ["extracted", "partial", "failed"] as const, errors, true);
  const expectedParser = PARSERS[row.content_type ?? ""];
  if (body.parser !== expectedParser) errors.add("parser", `This file needs the ${expectedParser ?? "unknown"} parser.`);
  if (typeof body.parserVersion !== "string" || !/^\d{1,3}\.\d{1,4}\.\d{1,6}$/.test(body.parserVersion)) {
    errors.add("parserVersion", "Must be a version such as 1.2.3.");
  }
  const pageCount = body.pageCount;
  if (pageCount !== undefined && pageCount !== null && !(Number.isInteger(pageCount) && (pageCount as number) >= 0 && (pageCount as number) <= 1000)) {
    errors.add("pageCount", "Must be a whole number from 0 to 1000.");
  }
  const warnings = body.warnings ?? [];
  if (!Array.isArray(warnings) || warnings.some((code) => !(EXTRACTION_WARNINGS as readonly unknown[]).includes(code))) {
    errors.add("warnings", `Must be a list of: ${EXTRACTION_WARNINGS.join(", ")}.`);
  }
  if (body.text !== undefined && body.text !== null && typeof body.text !== "string") errors.add("text", "Must be text.");
  if (typeof body.text === "string" && body.text.length > MAX_EXTRACTED_CHARS) {
    errors.add("text", `Must be ${MAX_EXTRACTED_CHARS} characters or fewer.`);
  }
  errors.throwIfAny("The extraction result is invalid.");
  if (status === undefined) throw badRequest("status is required.");

  const text = status === "failed" ? "" : normaliseExtractedText(typeof body.text === "string" ? body.text : "");
  const codes = new Set(warnings as string[]);
  if (status !== "failed" && text === "") {
    status = "failed";
    codes.add("no_text");
  }

  const now = new Date().toISOString();
  const key = textKey(row.id);
  if (text) {
    await env.PRIVATE_FILES.put(key, text, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
      customMetadata: { cvVersionId: row.id, parser: String(body.parser), parserVersion: String(body.parserVersion) },
    });
  } else {
    await env.PRIVATE_FILES.delete(key);
  }

  // Replace this version's earlier unreviewed proposals; keep confirmed facts and decisions.
  await env.DB.prepare("DELETE FROM profile_items WHERE source_cv_version_id = ? AND status = 'proposed'").bind(row.id).run();
  const proposals = text ? structureCvText(text) : [];
  const created = await insertProposalsDeduplicated(
    env.DB,
    proposals.map((proposal, index) => ({
      section: proposal.section,
      value: proposal.value,
      status: "proposed",
      source: "cv_extraction",
      sourceCvVersionId: row.id,
      sourceStart: proposal.start,
      sourceEnd: proposal.end,
      position: index,
    })),
    { now, rejectedFromCvVersionId: row.id },
  );

  await recordExtractionStatement(env.DB, row.id, {
    status,
    parser: String(body.parser),
    parserVersion: String(body.parserVersion),
    warnings: [...codes],
    textKey: text ? key : null,
    characters: text.length,
    pageCount: typeof pageCount === "number" ? pageCount : null,
    reviewStatus: reviewStatus({ status: row.status, extraction_status: status }, { proposed: created, confirmed: 0, rejected: 0, superseded: 0 }),
    now,
  }).run();

  return json({
    ok: true,
    proposalsCreated: created,
    proposalsFound: proposals.length,
    structurer: STRUCTURER_VERSION,
    version: await dto(env.DB, row.id),
  });
}

export async function activateCvVersionRoute({ env, params }: RequestContext): Promise<Response> {
  const row = await requireVersion(env.DB, params.id);
  requireLive(row);
  await activateCvVersion(env.DB, row.id, new Date().toISOString());
  return json({ ok: true, version: await dto(env.DB, row.id) });
}

export async function deactivateCvVersionRoute({ env, params }: RequestContext): Promise<Response> {
  const row = await requireVersion(env.DB, params.id);
  requireLive(row);
  await deactivateCvVersion(env.DB, row.id, new Date().toISOString());
  return json({ ok: true, version: await dto(env.DB, row.id) });
}

/** POST /api/cv/versions/:id/proposals/reject: rejects every remaining proposal from this CV. */
export async function rejectRemainingProposals({ env, params }: RequestContext): Promise<Response> {
  const row = await requireVersion(env.DB, params.id);
  requireLive(row);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE profile_items SET status = 'rejected', decided_at = ?, updated_at = ? WHERE source_cv_version_id = ? AND status = 'proposed'",
  )
    .bind(now, now, row.id)
    .run();
  await setReviewStatus(env.DB, row.id, "reviewed", now);
  return json({ ok: true, rejected: result.meta.changes ?? 0, version: await dto(env.DB, row.id) });
}

/**
 * DELETE /api/cv/versions/:id with body { "confirm": "DELETE" }.
 * Removes the original file and the extracted text from R2, the file record, and this CV's
 * unconfirmed proposals. Confirmed facts stay (they are the user's decisions) and show that their
 * source CV was deleted. The version id remains as a tombstone without personal data.
 */
export async function deleteCvVersion({ request, env, params }: RequestContext): Promise<Response> {
  const row = await requireVersion(env.DB, params.id);
  requireLive(row);
  const body = requireObject(await readJson(request, 1024));
  if (body.confirm !== DELETE_CONFIRMATION) {
    throw badRequest(`To delete this CV permanently, send { "confirm": "${DELETE_CONFIRMATION}" }.`, { confirm: `Type ${DELETE_CONFIRMATION} to confirm.` });
  }
  const now = new Date().toISOString();
  if (row.extracted_text_key) await env.PRIVATE_FILES.delete(row.extracted_text_key);
  if (row.r2_key) await env.PRIVATE_FILES.delete(row.r2_key);
  const documentId = row.document_id;
  await env.DB.batch([
    deleteUnconfirmedFromCvStatement(env.DB, row.id),
    tombstoneStatement(env.DB, row.id, now),
    ...(documentId ? [env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(documentId)] : []),
  ]);
  return json({ ok: true, deleted: row.id });
}
