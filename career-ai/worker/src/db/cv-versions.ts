import type { ItemStatus } from "./profile-items";

export type CvStatus = "active" | "inactive" | "deleted";
export type ExtractionStatus = "not_extracted" | "extracted" | "partial" | "failed";

/** A CV version joined with its stored file (Phase 1 documents row). Internal: includes R2 keys. */
export interface CvVersionRow {
  id: string;
  document_id: string | null;
  status: CvStatus;
  extraction_status: ExtractionStatus;
  parser: string | null;
  parser_version: string | null;
  extraction_warnings: string | null;
  extracted_text_key: string | null;
  extracted_chars: number | null;
  page_count: number | null;
  extracted_at: string | null;
  review_status: string;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  deleted_at: string | null;
  // From documents (null once deleted)
  r2_key: string | null;
  original_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  uploaded_at: string | null;
}

const SELECT = `SELECT c.id, c.document_id, c.status, c.extraction_status, c.parser, c.parser_version, c.extraction_warnings,
  c.extracted_text_key, c.extracted_chars, c.page_count, c.extracted_at, c.review_status, c.created_at, c.updated_at,
  c.activated_at, c.deleted_at, d.r2_key, d.original_name, d.content_type, d.size_bytes, d.sha256, d.created_at AS uploaded_at
  FROM cv_versions c LEFT JOIN documents d ON d.id = c.document_id`;

export type ReviewStatus = "not_started" | "in_review" | "reviewed";

/** Review status follows the data: in review while proposals from this CV await a decision. */
export function reviewStatus(row: Pick<CvVersionRow, "extraction_status" | "status">, counts?: Record<ItemStatus, number>): ReviewStatus {
  if (row.status === "deleted" || row.extraction_status === "not_extracted" || row.extraction_status === "failed") return "not_started";
  return (counts?.proposed ?? 0) > 0 ? "in_review" : "reviewed";
}

function parseWarnings(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** The browser-facing shape. Never contains R2 keys. */
export function toCvVersionDto(row: CvVersionRow, counts?: Record<ItemStatus, number>) {
  return {
    id: row.id,
    status: row.status,
    active: row.status === "active",
    file:
      row.document_id && row.original_name
        ? {
            documentId: row.document_id,
            name: row.original_name,
            contentType: row.content_type,
            sizeBytes: row.size_bytes,
            sha256: row.sha256,
            uploadedAt: row.uploaded_at,
          }
        : null,
    extraction: {
      status: row.extraction_status,
      parser: row.parser,
      parserVersion: row.parser_version,
      warnings: parseWarnings(row.extraction_warnings),
      characters: row.extracted_chars,
      pageCount: row.page_count,
      extractedAt: row.extracted_at,
    },
    review: {
      status: reviewStatus(row, counts),
      proposed: counts?.proposed ?? 0,
      confirmed: counts?.confirmed ?? 0,
      rejected: counts?.rejected ?? 0,
    },
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    deletedAt: row.deleted_at,
  };
}

export type CvVersionDto = ReturnType<typeof toCvVersionDto>;

export async function listCvVersions(db: D1Database, includeDeleted: boolean): Promise<CvVersionRow[]> {
  const where = includeDeleted ? "" : "WHERE c.status <> 'deleted'";
  const { results } = await db.prepare(`${SELECT} ${where} ORDER BY c.created_at DESC LIMIT 100`).all<CvVersionRow>();
  return results;
}

export async function getCvVersion(db: D1Database, id: string): Promise<CvVersionRow | null> {
  return db.prepare(`${SELECT} WHERE c.id = ?`).bind(id).first<CvVersionRow>();
}

export async function findLiveCvVersionBySha(db: D1Database, sha256: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT c.id FROM cv_versions c JOIN documents d ON d.id = c.document_id WHERE d.sha256 = ? AND c.status <> 'deleted'")
    .bind(sha256)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function findCvVersionByDocument(db: D1Database, documentId: string): Promise<string | null> {
  const row = await db.prepare("SELECT id FROM cv_versions WHERE document_id = ?").bind(documentId).first<{ id: string }>();
  return row?.id ?? null;
}

export async function insertCvVersion(db: D1Database, version: { id: string; documentId: string; now: string }): Promise<void> {
  await db
    .prepare("INSERT INTO cv_versions (id, document_id, status, created_at, updated_at) VALUES (?, ?, 'inactive', ?, ?)")
    .bind(version.id, version.documentId, version.now, version.now)
    .run();
}

export function recordExtractionStatement(
  db: D1Database,
  id: string,
  extraction: {
    status: Exclude<ExtractionStatus, "not_extracted">;
    parser: string;
    parserVersion: string;
    warnings: string[];
    textKey: string | null;
    characters: number;
    pageCount: number | null;
    reviewStatus: ReviewStatus;
    now: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE cv_versions SET extraction_status = ?, parser = ?, parser_version = ?, extraction_warnings = ?, extracted_text_key = ?,
         extracted_chars = ?, page_count = ?, extracted_at = ?, review_status = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      extraction.status,
      extraction.parser,
      extraction.parserVersion,
      JSON.stringify(extraction.warnings),
      extraction.textKey,
      extraction.characters,
      extraction.pageCount,
      extraction.now,
      extraction.reviewStatus,
      extraction.now,
      id,
    );
}

export async function setReviewStatus(db: D1Database, id: string, status: ReviewStatus, now: string): Promise<void> {
  await db.prepare("UPDATE cv_versions SET review_status = ?, updated_at = ? WHERE id = ? AND status <> 'deleted'").bind(status, now, id).run();
}

/** Makes one version active, atomically deactivating any other. */
export async function activateCvVersion(db: D1Database, id: string, now: string): Promise<void> {
  await db.batch([
    db.prepare("UPDATE cv_versions SET status = 'inactive', updated_at = ? WHERE status = 'active' AND id <> ?").bind(now, id),
    db.prepare("UPDATE cv_versions SET status = 'active', activated_at = ?, updated_at = ? WHERE id = ? AND status <> 'deleted'").bind(now, now, id),
  ]);
}

export async function deactivateCvVersion(db: D1Database, id: string, now: string): Promise<void> {
  await db.prepare("UPDATE cv_versions SET status = 'inactive', updated_at = ? WHERE id = ? AND status = 'active'").bind(now, id).run();
}

/** Tombstone: keeps the id and parser details for history, drops the file link and extracted data. */
export function tombstoneStatement(db: D1Database, id: string, now: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE cv_versions SET status = 'deleted', document_id = NULL, extracted_text_key = NULL, extraction_warnings = NULL,
         extracted_chars = NULL, page_count = NULL, review_status = 'not_started', deleted_at = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(now, now, id);
}
