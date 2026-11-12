export interface DocumentRow {
  id: string;
  r2_key: string;
  kind: "upload" | "legacy_upload";
  original_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string | null;
  created_at: string;
}

export function toDocumentDto(row: DocumentRow) {
  return {
    id: row.id,
    name: row.original_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

const COLUMNS = "id, r2_key, kind, original_name, content_type, size_bytes, sha256, created_at";

export async function listDocuments(db: D1Database): Promise<DocumentRow[]> {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM documents ORDER BY created_at DESC LIMIT 200`).all<DocumentRow>();
  return results;
}

export async function getDocument(db: D1Database, id: string): Promise<DocumentRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM documents WHERE id = ?`).bind(id).first<DocumentRow>();
}

export async function insertDocument(db: D1Database, row: DocumentRow): Promise<void> {
  await db
    .prepare(`INSERT INTO documents (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, row.r2_key, row.kind, row.original_name, row.content_type, row.size_bytes, row.sha256, row.created_at)
    .run();
}

export async function deleteDocument(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM documents WHERE id = ?").bind(id).run();
}

export async function knownR2Keys(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare("SELECT r2_key FROM documents").all<{ r2_key: string }>();
  return new Set(results.map((row) => row.r2_key));
}
