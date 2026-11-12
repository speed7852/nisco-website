-- Migration 0003: Phase 2 master CV versions and the structured candidate profile.
--
-- Additive only. Nothing existing is rewritten or deleted:
-- - the Phase 1 `profile` row is only READ: it is copied byte for byte into an immutable snapshot,
--   and its non-empty fields become PROPOSED profile items (verbatim, never confirmed automatically);
-- - `documents` rows, their R2 objects and the /api/files endpoints are unchanged. A CV version
--   points at a `documents` row; earlier uploads become CV versions only when the user registers them.
-- Tested against 0001/0002-era data, including malformed profile JSON, in test/migrations.test.ts.

-- Immutable copies of the Phase 1 profile ------------------------------------------------------

CREATE TABLE IF NOT EXISTS profile_snapshots (
  id TEXT PRIMARY KEY,
  -- migration_0003: taken by this migration; before_legacy_edit: taken before PUT /api/profile
  -- overwrites the Phase 1 profile; legacy_proposals: taken when proposals are made from it.
  reason TEXT NOT NULL CHECK (reason IN ('migration_0003', 'before_legacy_edit', 'legacy_proposals')),
  -- The stored JSON text exactly as it was, even if it was never valid JSON.
  data TEXT NOT NULL,
  original_updated_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_snapshots_created ON profile_snapshots(created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_profile_snapshots_immutable
BEFORE UPDATE ON profile_snapshots
BEGIN
  SELECT RAISE(ABORT, 'profile snapshots are immutable');
END;

INSERT INTO profile_snapshots (id, reason, data, original_updated_at, created_at)
SELECT '30030000-0000-4000-8000-000000000003', 'migration_0003', data, updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM profile
WHERE id = 1;

-- CV versions --------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cv_versions (
  id TEXT PRIMARY KEY,
  -- The stored file (Phase 1 documents table: R2 key, name, type, size, SHA-256, upload time).
  -- NULL only for a deleted version, which keeps no personal data.
  document_id TEXT REFERENCES documents(id),
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'deleted')),
  extraction_status TEXT NOT NULL DEFAULT 'not_extracted'
    CHECK (extraction_status IN ('not_extracted', 'extracted', 'partial', 'failed')),
  parser TEXT,
  parser_version TEXT,
  -- JSON array of warning codes reported by the extractor.
  extraction_warnings TEXT,
  -- R2 key of the extracted text. Never returned by the API.
  extracted_text_key TEXT,
  extracted_chars INTEGER,
  page_count INTEGER,
  extracted_at TEXT,
  review_status TEXT NOT NULL DEFAULT 'not_started' CHECK (review_status IN ('not_started', 'in_review', 'reviewed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  activated_at TEXT,
  deleted_at TEXT,
  CHECK ((status = 'deleted') = (document_id IS NULL))
);
-- At most one active master CV.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cv_versions_one_active ON cv_versions(status) WHERE status = 'active';
-- A stored file backs at most one CV version.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cv_versions_document ON cv_versions(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cv_versions_created ON cv_versions(created_at DESC);

-- Structured candidate profile -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS profile_items (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  -- JSON object validated per section by src/profile/schema.ts.
  value TEXT NOT NULL CHECK (json_valid(value)),
  -- proposed: extracted or carried over, not yet reviewed; confirmed: accepted by the user;
  -- rejected: declined by the user; superseded: a confirmed value the user explicitly replaced.
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'rejected', 'superseded')),
  source TEXT NOT NULL CHECK (source IN ('manual', 'cv_extraction', 'legacy_profile')),
  source_cv_version_id TEXT REFERENCES cv_versions(id),
  source_snapshot_id TEXT REFERENCES profile_snapshots(id),
  -- Phase 1 field name for legacy proposals.
  source_field TEXT,
  -- Character span in the extracted CV text that the value was copied from.
  source_start INTEGER,
  source_end INTEGER,
  user_edited INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK (source <> 'cv_extraction' OR source_cv_version_id IS NOT NULL),
  CHECK (source <> 'legacy_profile' OR source_snapshot_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_profile_items_section_status ON profile_items(section, status);
CREATE INDEX IF NOT EXISTS idx_profile_items_cv ON profile_items(source_cv_version_id);

-- Single-value sections can hold one confirmed value at a time. Must match SINGLE_VALUE_SECTIONS
-- in src/profile/schema.ts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_items_one_confirmed
  ON profile_items(section)
  WHERE status = 'confirmed'
    AND section IN ('name', 'headline', 'summary', 'years_experience', 'email', 'phone', 'location_text',
                    'remote_preference', 'skills_text', 'experience_text', 'preferred_titles_text');

-- Section allow-list. Must match PROFILE_SECTIONS in src/profile/schema.ts. A trigger (rather than
-- a CHECK) so a later migration can extend the list without rebuilding the table.
CREATE TRIGGER IF NOT EXISTS trg_profile_items_section_insert
BEFORE INSERT ON profile_items
WHEN NEW.section NOT IN ('name', 'headline', 'summary', 'years_experience', 'email', 'phone', 'location_text',
                         'remote_preference', 'skills_text', 'experience_text', 'preferred_titles_text',
                         'link', 'skill', 'experience', 'education', 'certification', 'preferred_title',
                         'approved_location')
BEGIN
  SELECT RAISE(ABORT, 'invalid profile section');
END;

CREATE TRIGGER IF NOT EXISTS trg_profile_items_section_update
BEFORE UPDATE OF section ON profile_items
WHEN NEW.section NOT IN ('name', 'headline', 'summary', 'years_experience', 'email', 'phone', 'location_text',
                         'remote_preference', 'skills_text', 'experience_text', 'preferred_titles_text',
                         'link', 'skill', 'experience', 'education', 'certification', 'preferred_title',
                         'approved_location')
BEGIN
  SELECT RAISE(ABORT, 'invalid profile section');
END;

-- Phase 1 profile fields as PROPOSALS, verbatim -------------------------------------------------------
-- Each non-empty text field becomes one proposed item holding exactly the stored text. Nothing is
-- split, reworded or confirmed. "location" goes to free-text location_text, never to approved
-- locations. A row that is not a JSON object (possible before Phase 1 validation) produces no
-- proposals but is still preserved above. CASE guarantees json_type runs only on valid JSON.
-- The field mapping is a JSON table because D1 limits compound SELECT (UNION) terms.

INSERT INTO profile_items (id, section, value, status, source, source_snapshot_id, source_field, position, created_at, updated_at)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
    || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  f.section,
  json_object('text', f.text),
  'proposed',
  'legacy_profile',
  '30030000-0000-4000-8000-000000000003',
  f.field,
  f.position,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT json_extract(m.value, '$[0]') AS field,
         json_extract(m.value, '$[1]') AS section,
         json_extract(m.value, '$[2]') AS position,
         CASE WHEN typeof(json_extract(p.data, '$.' || json_extract(m.value, '$[0]'))) IN ('integer', 'real')
              THEN CAST(json_extract(p.data, '$.' || json_extract(m.value, '$[0]')) AS TEXT)
              ELSE json_extract(p.data, '$.' || json_extract(m.value, '$[0]')) END AS text
  FROM profile p,
       json_each('[["name","name",1],["headline","headline",2],["years","years_experience",3],["location","location_text",4],["summary","summary",5],["skills","skills_text",6],["experience","experience_text",7],["roles","preferred_titles_text",8]]') AS m
  WHERE p.id = 1 AND (CASE WHEN json_valid(p.data) THEN json_type(p.data) END) = 'object'
) f
WHERE typeof(f.text) = 'text' AND trim(f.text) <> '';
