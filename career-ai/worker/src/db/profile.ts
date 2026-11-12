import { parseStoredProfile, type CareerProfile } from "../domain/profile";

export interface StoredProfile {
  profile: CareerProfile;
  updatedAt: string;
}

export async function getProfile(db: D1Database): Promise<StoredProfile | null> {
  const row = await db.prepare("SELECT data, updated_at FROM profile WHERE id = 1").first<{ data: string; updated_at: string }>();
  if (!row) return null;
  const profile = parseStoredProfile(row.data);
  return profile ? { profile, updatedAt: row.updated_at } : null;
}

export async function saveProfile(db: D1Database, profile: CareerProfile, now: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
    )
    .bind(JSON.stringify(profile), now)
    .run();
}
