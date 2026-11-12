import { MAX_MATCH_ATTEMPTS, SHORTLIST_THRESHOLD } from "../config";
import type { MatchAssessment } from "../ai/parse";
import { isSafeLink } from "../domain/urls";

export type MatchStatus = "pending" | "scored" | "needs_review" | "legacy_unverified";

export interface JobRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  url: string | null;
  description: string;
  source: string;
  canonical_url: string | null;
  created_at: string;
  match_score: number | null;
  match_status: MatchStatus;
  match_attempts: number;
  match_details: string | null;
  match_error: string | null;
  match_model: string | null;
  match_prompt_version: string | null;
  match_scored_at: string | null;
  match_checked_at: string | null;
}

export interface NewJob {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  canonicalUrl: string | null;
  description: string;
  source: string;
  createdAt: string;
}

const JOB_COLUMNS =
  "id, title, company, location, url, description, source, canonical_url, created_at, match_score, match_status, match_attempts, match_details, match_error, match_model, match_prompt_version, match_scored_at, match_checked_at";

/**
 * A job is shortlisted only when a validated assessment produced its score (match_scored_at is
 * set) and that score is at least the threshold. Scores from before migration 0002 are never
 * shortlisted until re-assessed.
 */
export function isShortlisted(row: Pick<JobRow, "match_score" | "match_scored_at">): boolean {
  return (
    row.match_scored_at !== null &&
    row.match_score !== null &&
    row.match_score >= SHORTLIST_THRESHOLD &&
    row.match_score <= 100
  );
}

function parseDetails(value: string | null): Pick<MatchAssessment, "matched" | "gaps" | "rationale"> {
  if (!value) return { matched: [], gaps: [], rationale: "" };
  try {
    const parsed = JSON.parse(value) as Partial<MatchAssessment>;
    return {
      matched: Array.isArray(parsed.matched) ? parsed.matched.filter((x): x is string => typeof x === "string") : [],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.filter((x): x is string => typeof x === "string") : [],
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    };
  } catch {
    return { matched: [], gaps: [], rationale: "" };
  }
}

/** The JSON shape returned to the browser. Unsafe stored links are withheld, not rendered. */
export function toJobDto(row: JobRow) {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location ?? "",
    url: isSafeLink(row.url) ? row.url : null,
    description: row.description,
    source: row.source,
    createdAt: row.created_at,
    match: {
      status: row.match_status,
      score: row.match_score,
      verified: row.match_scored_at !== null,
      shortlisted: isShortlisted(row),
      ...parseDetails(row.match_details),
      attempts: row.match_attempts,
      lastError: row.match_status === "needs_review" ? row.match_error : null,
      scoredAt: row.match_scored_at,
      checkedAt: row.match_checked_at,
      promptVersion: row.match_prompt_version,
    },
  };
}

export type JobDto = ReturnType<typeof toJobDto>;

export async function listJobs(db: D1Database, options: { shortlistedOnly: boolean; limit: number }): Promise<JobRow[]> {
  const where = options.shortlistedOnly
    ? `WHERE match_scored_at IS NOT NULL AND match_score >= ${SHORTLIST_THRESHOLD} AND match_score <= 100`
    : "";
  const order = options.shortlistedOnly ? "match_score DESC, created_at DESC" : "created_at DESC";
  const { results } = await db
    .prepare(`SELECT ${JOB_COLUMNS} FROM jobs ${where} ORDER BY ${order} LIMIT ?`)
    .bind(options.limit)
    .all<JobRow>();
  return results;
}

export async function getJob(db: D1Database, id: string): Promise<JobRow | null> {
  return db.prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`).bind(id).first<JobRow>();
}

export async function findJobIdByCanonicalUrl(db: D1Database, canonicalUrl: string): Promise<string | null> {
  const row = await db.prepare("SELECT id FROM jobs WHERE canonical_url = ?").bind(canonicalUrl).first<{ id: string }>();
  return row?.id ?? null;
}

/** Returns which of the given canonical URLs already exist, in chunks to stay under D1's bind limit. */
export async function existingCanonicalUrls(db: D1Database, urls: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < urls.length; i += 50) {
    const chunk = urls.slice(i, i + 50);
    const placeholders = chunk.map(() => "?").join(", ");
    const { results } = await db
      .prepare(`SELECT canonical_url FROM jobs WHERE canonical_url IN (${placeholders})`)
      .bind(...chunk)
      .all<{ canonical_url: string }>();
    for (const row of results) found.add(row.canonical_url);
  }
  return found;
}

function insertStatement(db: D1Database, job: NewJob, orIgnore: boolean): D1PreparedStatement {
  return db
    .prepare(
      `INSERT ${orIgnore ? "OR IGNORE " : ""}INTO jobs (id, title, company, location, url, canonical_url, description, source, status, match_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'saved', 'pending', ?)`,
    )
    .bind(job.id, job.title, job.company, job.location, job.url, job.canonicalUrl, job.description, job.source, job.createdAt);
}

export async function insertJob(db: D1Database, job: NewJob): Promise<void> {
  await insertStatement(db, job, false).run();
}

/** Inserts many jobs in one round trip. Rows whose canonical URL already exists are skipped. */
export async function insertJobsIgnoringDuplicates(db: D1Database, jobs: NewJob[]): Promise<number> {
  if (jobs.length === 0) return 0;
  const results = await db.batch(jobs.map((job) => insertStatement(db, job, true)));
  return results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
}

/** Jobs waiting for an automatic assessment: never scored, failed, or carrying an unverified legacy score. */
export async function listJobsNeedingAssessment(db: D1Database, limit: number): Promise<JobRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${JOB_COLUMNS} FROM jobs
       WHERE match_status IN ('pending', 'needs_review', 'legacy_unverified') AND match_attempts < ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(MAX_MATCH_ATTEMPTS, limit)
    .all<JobRow>();
  return results;
}

export async function recordAssessment(
  db: D1Database,
  jobId: string,
  assessment: MatchAssessment,
  meta: { model: string; promptVersion: string; now: string },
): Promise<void> {
  const details = JSON.stringify({ matched: assessment.matched, gaps: assessment.gaps, rationale: assessment.rationale });
  await db
    .prepare(
      `UPDATE jobs SET match_score = ?, match_status = 'scored', match_details = ?, match_error = NULL, match_model = ?,
         match_prompt_version = ?, match_scored_at = ?, match_checked_at = ?, match_attempts = match_attempts + 1
       WHERE id = ?`,
    )
    .bind(assessment.score, details, meta.model, meta.promptVersion, meta.now, meta.now, jobId)
    .run();
}

/** Records a failed assessment. The previous score, details and scored_at are left untouched. */
export async function recordAssessmentFailure(db: D1Database, jobId: string, reason: string, now: string): Promise<void> {
  await db
    .prepare(
      "UPDATE jobs SET match_status = 'needs_review', match_error = ?, match_checked_at = ?, match_attempts = match_attempts + 1 WHERE id = ?",
    )
    .bind(reason.slice(0, 200), now, jobId)
    .run();
}
