export type RunStatus = "running" | "ok" | "partial" | "failed";

export interface DiscoveryRunRow {
  id: string;
  cron: string;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  summary: string | null;
}

export async function startRun(db: D1Database, run: { id: string; cron: string; startedAt: string }): Promise<void> {
  await db
    .prepare("INSERT INTO discovery_runs (id, cron, started_at, status) VALUES (?, ?, ?, 'running')")
    .bind(run.id, run.cron, run.startedAt)
    .run();
}

export async function finishRun(
  db: D1Database,
  run: { id: string; finishedAt: string; status: Exclude<RunStatus, "running">; summary: unknown },
): Promise<void> {
  await db
    .prepare("UPDATE discovery_runs SET finished_at = ?, status = ?, summary = ? WHERE id = ?")
    .bind(run.finishedAt, run.status, JSON.stringify(run.summary), run.id)
    .run();
}

export async function listRecentRuns(db: D1Database, limit: number) {
  const { results } = await db
    .prepare("SELECT id, cron, started_at, finished_at, status, summary FROM discovery_runs ORDER BY started_at DESC LIMIT ?")
    .bind(limit)
    .all<DiscoveryRunRow>();
  return results.map((row) => ({
    id: row.id,
    cron: row.cron,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    summary: safeJson(row.summary),
  }));
}

function safeJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
