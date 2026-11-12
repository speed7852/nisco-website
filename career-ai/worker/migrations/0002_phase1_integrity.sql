-- Migration 0002: Phase 1 data integrity.
--
-- Additive only: no table is rebuilt and no row is deleted. Every backfill below is written
-- so that it cannot fail on data left by the 0001-era code (duplicate URLs, duplicate
-- applications, unvalidated scores or statuses). Tested against a copy of the 0001 schema
-- with such data in test/migrations.test.ts.

-- Jobs: provenance, canonical URL and AI match state ------------------------------------------

ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE jobs ADD COLUMN canonical_url TEXT;
ALTER TABLE jobs ADD COLUMN match_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (match_status IN ('pending', 'scored', 'needs_review', 'legacy_unverified'));
ALTER TABLE jobs ADD COLUMN match_attempts INTEGER NOT NULL DEFAULT 0;
-- JSON object {"matched": [...], "gaps": [...], "rationale": "..."} from the last valid assessment.
ALTER TABLE jobs ADD COLUMN match_details TEXT;
ALTER TABLE jobs ADD COLUMN match_error TEXT;
ALTER TABLE jobs ADD COLUMN match_model TEXT;
ALTER TABLE jobs ADD COLUMN match_prompt_version TEXT;
-- Set only when a model response passed validation. A score without this timestamp is never shortlisted.
ALTER TABLE jobs ADD COLUMN match_scored_at TEXT;
-- Last assessment attempt, successful or not.
ALTER TABLE jobs ADD COLUMN match_checked_at TEXT;

-- Scores written by the 0001-era code were never validated (a parse failure was stored as 0 and
-- scores were not clamped). Keep the number for reference, but mark it unverified so it is not
-- shortlisted and is re-assessed by the next discovery run.
UPDATE jobs SET match_status = 'legacy_unverified' WHERE match_score IS NOT NULL;

-- Canonical URL for existing rows: HTTPS only, and only the earliest row for each exact URL, so
-- pre-existing duplicates cannot make the unique index below fail. Tracking-parameter
-- normalisation is applied by application code to every new row.
UPDATE jobs
SET canonical_url = url
WHERE url LIKE 'https://%'
  AND rowid IN (SELECT MIN(rowid) FROM jobs WHERE url LIKE 'https://%' GROUP BY url);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_canonical_url
  ON jobs(canonical_url) WHERE canonical_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_match_queue
  ON jobs(match_status, match_attempts, created_at);

-- Applications: one active application per job ------------------------------------------------

ALTER TABLE applications ADD COLUMN created_at TEXT;
ALTER TABLE applications ADD COLUMN archived_at TEXT;
UPDATE applications SET created_at = updated_at WHERE created_at IS NULL;

-- Keep the most recently updated application for each job active. Older duplicates are archived,
-- not deleted, so no tracker history is lost.
UPDATE applications
SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE archived_at IS NULL
  AND rowid NOT IN (
    SELECT rid FROM (
      SELECT rowid AS rid,
             ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY updated_at DESC, rowid DESC) AS rn
      FROM applications
      WHERE archived_at IS NULL
    )
    WHERE rn = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_one_active_per_job
  ON applications(job_id) WHERE archived_at IS NULL;

-- Status allow-list for new writes. Must match APPLICATION_STATUSES in src/domain/applications.ts.
-- Existing rows are not rewritten; a legacy value stays readable until the user changes it.
CREATE TRIGGER IF NOT EXISTS trg_applications_status_insert
BEFORE INSERT ON applications
WHEN NEW.status NOT IN ('prepared', 'applied', 'recruiter_contact', 'interview', 'offer', 'rejected', 'withdrawn')
BEGIN
  SELECT RAISE(ABORT, 'invalid application status');
END;

CREATE TRIGGER IF NOT EXISTS trg_applications_status_update
BEFORE UPDATE OF status ON applications
WHEN NEW.status NOT IN ('prepared', 'applied', 'recruiter_contact', 'interview', 'offer', 'rejected', 'withdrawn')
BEGIN
  SELECT RAISE(ABORT, 'invalid application status');
END;

-- Uploaded files: every R2 object written by the API is recorded here --------------------------

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  -- 'upload' = verified PDF/DOCX upload; 'legacy_upload' = found in R2 from before this migration.
  kind TEXT NOT NULL CHECK (kind IN ('upload', 'legacy_upload')),
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);

-- Scheduled discovery runs: outcome and per-source counts, no candidate data --------------------

CREATE TABLE IF NOT EXISTS discovery_runs (
  id TEXT PRIMARY KEY,
  cron TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  -- JSON summary: per-source fetched/eligible/inserted counts and errors, AI calls and outcomes.
  summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_started ON discovery_runs(started_at DESC);
