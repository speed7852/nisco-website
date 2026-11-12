import type { ItemValue, ProfileSection } from "../profile/schema";

export type ItemStatus = "proposed" | "confirmed" | "rejected" | "superseded";
export type ItemSource = "manual" | "cv_extraction" | "legacy_profile";

export interface ProfileItemRow {
  id: string;
  section: ProfileSection;
  value: string;
  status: ItemStatus;
  source: ItemSource;
  source_cv_version_id: string | null;
  source_snapshot_id: string | null;
  source_field: string | null;
  source_start: number | null;
  source_end: number | null;
  user_edited: number;
  position: number;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  /** Joined: the source CV version's status, to show "source CV deleted". */
  source_cv_status?: string | null;
}

export interface NewProfileItem {
  section: ProfileSection;
  value: ItemValue;
  status: ItemStatus;
  source: ItemSource;
  sourceCvVersionId?: string | null;
  sourceSnapshotId?: string | null;
  sourceField?: string | null;
  sourceStart?: number | null;
  sourceEnd?: number | null;
  position?: number;
}

const COLUMNS = `i.id, i.section, i.value, i.status, i.source, i.source_cv_version_id, i.source_snapshot_id, i.source_field,
  i.source_start, i.source_end, i.user_edited, i.position, i.created_at, i.updated_at, i.decided_at, c.status AS source_cv_status`;
const FROM = "FROM profile_items i LEFT JOIN cv_versions c ON c.id = i.source_cv_version_id";

export function parseValue(row: Pick<ProfileItemRow, "value">): ItemValue {
  try {
    const parsed: unknown = JSON.parse(row.value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as ItemValue) : {};
  } catch {
    return {};
  }
}

export function toProfileItemDto(row: ProfileItemRow) {
  return {
    id: row.id,
    section: row.section,
    value: parseValue(row),
    status: row.status,
    source: {
      type: row.source,
      cvVersionId: row.source_cv_version_id,
      cvDeleted: row.source_cv_status === "deleted",
      snapshotId: row.source_snapshot_id,
      field: row.source_field,
      span: row.source_start !== null && row.source_end !== null ? { start: row.source_start, end: row.source_end } : null,
    },
    userEdited: row.user_edited === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
  };
}

export type ProfileItemDto = ReturnType<typeof toProfileItemDto>;

export async function listItems(db: D1Database, filter: { statuses?: ItemStatus[]; cvVersionId?: string } = {}): Promise<ProfileItemRow[]> {
  const where: string[] = [];
  const values: string[] = [];
  if (filter.statuses && filter.statuses.length > 0) {
    where.push(`i.status IN (${filter.statuses.map(() => "?").join(", ")})`);
    values.push(...filter.statuses);
  }
  if (filter.cvVersionId) {
    where.push("i.source_cv_version_id = ?");
    values.push(filter.cvVersionId);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} ${FROM} ${clause} ORDER BY i.section, i.position, i.created_at LIMIT 2000`)
    .bind(...values)
    .all<ProfileItemRow>();
  return results;
}

export async function getItem(db: D1Database, id: string): Promise<ProfileItemRow | null> {
  return db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE i.id = ?`).bind(id).first<ProfileItemRow>();
}

export async function findConfirmedInSection(db: D1Database, section: ProfileSection): Promise<ProfileItemRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} ${FROM} WHERE i.section = ? AND i.status = 'confirmed'`)
    .bind(section)
    .all<ProfileItemRow>();
  return results;
}

export function insertItemStatement(db: D1Database, item: NewProfileItem, now: string, id: string = crypto.randomUUID()): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO profile_items (id, section, value, status, source, source_cv_version_id, source_snapshot_id, source_field,
         source_start, source_end, user_edited, position, created_at, updated_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      item.section,
      JSON.stringify(item.value),
      item.status,
      item.source,
      item.sourceCvVersionId ?? null,
      item.sourceSnapshotId ?? null,
      item.sourceField ?? null,
      item.sourceStart ?? null,
      item.sourceEnd ?? null,
      item.position ?? 0,
      now,
      now,
      item.status === "confirmed" ? now : null,
    );
}

export async function insertItem(db: D1Database, item: NewProfileItem, now: string): Promise<string> {
  const id = crypto.randomUUID();
  await insertItemStatement(db, item, now, id).run();
  return id;
}

export function updateValueStatement(db: D1Database, id: string, value: ItemValue, now: string): D1PreparedStatement {
  return db
    .prepare("UPDATE profile_items SET value = ?, user_edited = 1, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(value), now, id);
}

export function setStatusStatement(db: D1Database, id: string, status: ItemStatus, now: string): D1PreparedStatement {
  return db
    .prepare("UPDATE profile_items SET status = ?, decided_at = ?, updated_at = ? WHERE id = ?")
    .bind(status, now, now, id);
}

export async function deleteItem(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM profile_items WHERE id = ?").bind(id).run();
  return (result.meta.changes ?? 0) === 1;
}

export async function deleteAllItems(db: D1Database): Promise<number> {
  const result = await db.prepare("DELETE FROM profile_items").run();
  return result.meta.changes ?? 0;
}

export function deleteUnconfirmedFromCvStatement(db: D1Database, cvVersionId: string): D1PreparedStatement {
  return db
    .prepare("DELETE FROM profile_items WHERE source_cv_version_id = ? AND status IN ('proposed', 'rejected')")
    .bind(cvVersionId);
}

/** Proposal and decision counts per CV version, for review status. */
export async function countsByCv(db: D1Database): Promise<Map<string, Record<ItemStatus, number>>> {
  const { results } = await db
    .prepare("SELECT source_cv_version_id AS cv, status, COUNT(*) AS n FROM profile_items WHERE source_cv_version_id IS NOT NULL GROUP BY cv, status")
    .all<{ cv: string; status: ItemStatus; n: number }>();
  const counts = new Map<string, Record<ItemStatus, number>>();
  for (const row of results) {
    const entry = counts.get(row.cv) ?? { proposed: 0, confirmed: 0, rejected: 0, superseded: 0 };
    entry[row.status] = row.n;
    counts.set(row.cv, entry);
  }
  return counts;
}
