import type { ApplicationStatus } from "../domain/applications";
import { isSafeLink } from "../domain/urls";

export interface ApplicationRow {
  id: string;
  job_id: string;
  status: string;
  notes: string | null;
  created_at: string | null;
  updated_at: string;
  title: string;
  company: string;
  url: string | null;
}

export function toApplicationDto(row: ApplicationRow) {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    notes: row.notes ?? "",
    createdAt: row.created_at ?? row.updated_at,
    updatedAt: row.updated_at,
    job: { title: row.title, company: row.company, url: isSafeLink(row.url) ? row.url : null },
  };
}

const SELECT_ACTIVE = `SELECT a.id, a.job_id, a.status, a.notes, a.created_at, a.updated_at, j.title, j.company, j.url
  FROM applications a JOIN jobs j ON j.id = a.job_id
  WHERE a.archived_at IS NULL`;

export async function listActiveApplications(db: D1Database): Promise<ApplicationRow[]> {
  const { results } = await db.prepare(`${SELECT_ACTIVE} ORDER BY a.updated_at DESC`).all<ApplicationRow>();
  return results;
}

export async function getActiveApplication(db: D1Database, id: string): Promise<ApplicationRow | null> {
  return db.prepare(`${SELECT_ACTIVE} AND a.id = ?`).bind(id).first<ApplicationRow>();
}

export async function findActiveApplicationIdForJob(db: D1Database, jobId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM applications WHERE job_id = ? AND archived_at IS NULL")
    .bind(jobId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function insertApplication(
  db: D1Database,
  application: { id: string; jobId: string; status: ApplicationStatus; notes: string; now: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO applications (id, job_id, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(application.id, application.jobId, application.status, application.notes, application.now, application.now)
    .run();
}

/** Updates only the fields provided. Omitted fields keep their stored values. */
export async function updateApplication(
  db: D1Database,
  id: string,
  changes: { status?: ApplicationStatus; notes?: string },
  now: string,
): Promise<boolean> {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (changes.status !== undefined) {
    sets.push("status = ?");
    values.push(changes.status);
  }
  if (changes.notes !== undefined) {
    sets.push("notes = ?");
    values.push(changes.notes);
  }
  sets.push("updated_at = ?");
  values.push(now, id);
  const result = await db
    .prepare(`UPDATE applications SET ${sets.join(", ")} WHERE id = ? AND archived_at IS NULL`)
    .bind(...values)
    .run();
  return (result.meta.changes ?? 0) === 1;
}
