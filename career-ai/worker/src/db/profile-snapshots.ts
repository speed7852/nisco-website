/** Immutable copies of the Phase 1 profile (see migration 0003). Rows are never updated. */

export type SnapshotReason = "migration_0003" | "before_legacy_edit" | "legacy_proposals";

export interface SnapshotRow {
  id: string;
  reason: SnapshotReason;
  data: string;
  original_updated_at: string | null;
  created_at: string;
}

export async function insertSnapshot(
  db: D1Database,
  snapshot: { reason: SnapshotReason; data: string; originalUpdatedAt: string | null; now: string },
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO profile_snapshots (id, reason, data, original_updated_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, snapshot.reason, snapshot.data, snapshot.originalUpdatedAt, snapshot.now)
    .run();
  return id;
}

export async function listSnapshots(db: D1Database): Promise<SnapshotRow[]> {
  const { results } = await db
    .prepare("SELECT id, reason, data, original_updated_at, created_at FROM profile_snapshots ORDER BY created_at DESC")
    .all<SnapshotRow>();
  return results;
}

/** The Phase 1 profile row exactly as stored (raw text, which may not be valid JSON). */
export async function getLegacyProfileRaw(db: D1Database): Promise<{ data: string; updated_at: string } | null> {
  return db.prepare("SELECT data, updated_at FROM profile WHERE id = 1").first<{ data: string; updated_at: string }>();
}
