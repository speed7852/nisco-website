# Data model: master CV and structured profile (Phase 2)

Migration `worker/migrations/0003_phase2_cv_profile.sql` adds three tables. It is **additive**: it
creates tables, indexes and triggers, copies the existing profile into a snapshot and creates review
proposals from it. It changes no existing row and drops nothing. Tables from 0001/0002 are described
in `ARCHITECTURE.md`.

```
documents (Phase 1, unchanged)          profile (Phase 1, unchanged, kept word for word)
   ^ 1                                      |
   | 0..1  document_id                      | copied, verbatim
cv_versions ---------------------+      profile_snapshots (immutable)
   ^                             |          ^
   | source_cv_version_id        |          | source_snapshot_id
   +------------ profile_items ---+----------+
                 (proposed / confirmed / rejected / superseded)
```

## The three sources of truth, and which one is used

| Data | Table | Used by matching, drafts, discovery? |
| --- | --- | --- |
| Original profile notes (the Phase 1 form) | `profile` | **No.** Kept exactly as saved; editable in "Original profile notes". |
| Copies of those notes | `profile_snapshots` | No. Recovery and export only. |
| Facts the user has explicitly confirmed | `profile_items` with `status = 'confirmed'` | **Yes, and nothing else.** |
| Proposals (from a CV or from the notes) | `profile_items` with `status = 'proposed'` | No, until confirmed. |

`worker/src/profile/confirmed.ts` (`getConfirmedProfile`) builds the profile for `routes/jobs.ts`
(match), `routes/drafts.ts` and `discovery/run.ts` from confirmed items only. With no confirmed fact,
match and draft return 409 `profile_required` and discovery skips assessment. Confirmed email, phone
and links are **not** passed to the AI (matching does not need them).

## `cv_versions`

One row per master CV version. The original file is the Phase 1 `documents` row (and its private R2
object under `private/uploads/`), so upload, download and the R2 layout are shared with `/api/files`.

| Column | Meaning |
| --- | --- |
| `id` | UUID |
| `document_id` | The file (`documents.id`). Unique. `NULL` only once the version is deleted. |
| `status` | `active`, `inactive` or `deleted`. A partial unique index allows **one** `active` row. `CHECK ((status = 'deleted') = (document_id IS NULL))`. |
| `extraction_status` | `not_extracted`, `extracted`, `partial`, `failed` |
| `parser`, `parser_version` | `pdfjs-dist` + its version for PDF, `nisco-docx` + its version for DOCX. The Worker refuses a parser that does not match the file type. |
| `extraction_warnings` | JSON array of codes from a fixed list (`EXTRACTION_WARNINGS` in `routes/cv.ts`) |
| `extracted_text_key` | R2 key of the extracted text, `private/cv/<id>/extracted.txt` (never returned by the API) |
| `extracted_chars`, `page_count`, `extracted_at` | Extraction facts |
| `review_status` | Stored hint; the API reports `not_started`, `in_review` (proposals remain) or `reviewed` |
| `created_at`, `updated_at`, `activated_at`, `deleted_at` | Timestamps |

New versions start `inactive`; the user makes one active. Uploading identical bytes again (same
SHA-256 as a live version) is refused with 409 `duplicate_cv`.

**Deleting a version** (`DELETE /api/cv/versions/:id` with `{"confirm":"DELETE"}`) removes, in this
order: the extracted text from R2, the original file from R2, then in one D1 batch the version's
unconfirmed proposals, the `documents` row, and turns the version into a tombstone (`status =
'deleted'`, `document_id = NULL`, file metadata gone). Confirmed facts that came from it stay (they
are the user's decisions) and report `source.cvDeleted = true`. A file that belongs to a CV version
cannot be deleted through `/api/files/:id` (409 `document_in_use`).

**Confirm all** (`POST /api/cv/versions/:id/proposals/confirm`) confirms, as they are, the version's
remaining proposals in one step, at the user's request. It never replaces or repeats a confirmed
fact: a proposal for a single-value section that already has a confirmed value, a value already
confirmed in its section, or a value that fails validation stays proposed and is reported in
`skipped` (`wouldReplace`, `duplicate`, `needsEdit`). Updates run in D1 batches of 50 statements
(a batch counts as one query against the per-invocation limit).

## `profile_items`

One row per fact or proposal.

| Column | Meaning |
| --- | --- |
| `section` | One of the sections below (allow-list enforced by triggers on insert and update) |
| `value` | JSON object (`CHECK (json_valid(value))`), shape defined per section in `profile/schema.ts` |
| `status` | `proposed`, `confirmed`, `rejected`, `superseded` |
| `source` | `cv_extraction`, `legacy_profile` or `manual` |
| `source_cv_version_id` | Required when `source = 'cv_extraction'`, otherwise `NULL` (`CHECK`) |
| `source_snapshot_id` | Required when `source = 'legacy_profile'`, otherwise `NULL` (`CHECK`) |
| `source_field` | The legacy field name (`skills`, `roles`, ...) for `legacy_profile` items |
| `source_start`, `source_end` | Character span in the extracted text that the value was read from |
| `user_edited` | 1 if the user changed the value before or after confirming |
| `position`, timestamps, `decided_at` | Ordering and history |

### Sections

Single-value sections (at most **one** confirmed row, enforced by the partial unique index
`idx_profile_items_one_confirmed`): `name`, `headline`, `summary`, `years_experience`, `email`,
`phone`, `location_text`, `remote_preference`, and the free-text notes `skills_text`,
`experience_text`, `preferred_titles_text`.

Multi-value sections: `link`, `skill`, `experience` (role, employer, start, end, location, heading,
achievements), `education`, `certification`, `preferred_title`, `approved_location`.

`GET /api/profile/items` returns the section definitions (labels, fields, limits), every item, each
section's state (`confirmed`, `unconfirmed` = only proposals, `missing`) and the list of expected
sections still missing. `skill`, `experience` and `preferred_title` count as present when their
free-text note is confirmed.

### Lifecycle

```
            confirm (optionally with an edited value)
proposed  ----------------------------------------->  confirmed
   |   \  reject                                       |   ^
   |    `-------> rejected --- confirm later ----------'   |  PATCH value (user_edited = 1)
   |                                                       |
   `-- re-reading the same CV replaces its proposals       |  replaced by another value with
                                                           v  replaceConfirmed: true
                                                       superseded (kept as history)
```

- Confirming into a single-value section that already has a confirmed value returns 409
  `confirmed_value_exists` unless the request says `replaceConfirmed: true`; the old value becomes
  `superseded`, never deleted. The UI asks the user before sending that flag.
- A duplicate of a confirmed value in a multi-value section returns 409 `already_confirmed`.
- New proposals are de-duplicated against every confirmed and proposed item from any source, and
  against rejected items from the same CV (so a rejection is not asked again for that CV).
- Manual items (`POST /api/profile/items`) are confirmed immediately: the user typed them.

## `profile_snapshots`

Immutable copies of the Phase 1 `profile` row: an `UPDATE` trigger aborts any change.

| `reason` | Written when |
| --- | --- |
| `migration_0003` | By the migration, before it creates proposals (fixed id `30030000-0000-4000-8000-000000000003`) |
| `before_legacy_edit` | Before every `PUT /api/profile` changes the notes |
| `legacy_proposals` | When the user asks to review the notes as proposals (`POST /api/profile/legacy/proposals`) |

## How the existing profile was carried over (migration 0003)

1. The `profile` row is **not modified**. A snapshot with its exact `data` and `updated_at` is
   inserted first.
2. For each non-empty legacy field, one `proposed` item with the field's text **verbatim** (numbers
   become their decimal text) is created, with `source = 'legacy_profile'` and the field name:
   `name`→`name`, `headline`→`headline`, `years`→`years_experience`, `location`→`location_text`,
   `summary`→`summary`, `skills`→`skills_text`, `experience`→`experience_text`,
   `roles`→`preferred_titles_text`. Nothing is split, reworded or interpreted.
3. Nothing is confirmed: no stored record shows that the user confirmed the old free-text profile as
   individual facts, so each value must be reviewed once.

## CV structuring rules (no AI)

`worker/src/profile/structure.ts` (`STRUCTURER_VERSION = "rules-1.1.0"`) turns extracted text into
proposals with fixed rules: contact details from the first lines, sections by known headings
(summary, experience, education, certifications, skills), experience entries anchored on date-range
lines, skills split on `, ; | •`. It never proposes preferences (titles, locations, remote).

Rules added in 1.1.0, for CVs written in Word with list bullets (no bullet characters in the text):

- **Experience:** "Title" on its own line above "Employer | Location | Dates" (or "Title | Employer |
  Dates" on one line) fills role, employer and location, but only when exactly one of the two names
  contains a job-title word (Manager, Lead, Consultant, ...). Two titles or none stay unassigned,
  with the verbatim heading kept. A sentence-like line (8+ words ending in a full stop, or over 120
  characters) is never taken as a header, so each entry keeps its own last bullet.
- **Current location:** the part of a pipe-separated contact line above the first section heading
  that is not the email, a phone number, a link or the name.
- **Skills:** a "Category: a, b, c" line drops the category label.
- **Education:** "Qualification, Institution, Country, Year" is split into qualification and
  institution.

**Read again** on a CV version already uploaded reads its file again and applies the current rules.

**Grounding invariant:** every string in every proposed value is an exact substring of the extracted
text inside the recorded span (`isGrounded`, enforced before insert and fuzz-tested with 400
deterministic random documents). Values are never generated, normalised or completed.

## Extraction

Text is extracted in the browser (`frontend/js/extract.js`): PDF with the vendored, integrity-checked
pdf.js (`frontend/vendor/pdfjs`, evaluation disabled, run in its own Web Worker), DOCX with
`frontend/js/docx.js` (ZIP and XML read with size, ratio and DTD guards). The Worker re-validates the
submission (`POST /api/cv/versions/:id/extraction`): status and warning codes from fixed lists,
parser matching the file type, version format, text at most 200,000 characters and a 1 MB body,
then normalises line endings and control characters before storing and structuring. Browser-supplied
text is therefore validated but **not** proven to come from the file (see Known limitations in
`HANDOVER.md`).

## Export

`GET /api/profile/export` returns `career-ai-profile-export-YYYY-MM-DD.json` (attachment,
`no-store`): `legacyProfile`, every snapshot, every profile item with its source and status, every CV
version (including deleted tombstones) with its file metadata and extracted text, and the uploaded
file list. It contains no R2 keys, tokens or secrets.

## Delete everything structured

`DELETE /api/profile/items` with `{"confirm":"DELETE PROFILE DATA"}` deletes every profile item
(confirmed, proposed, rejected, superseded). It keeps the original notes, their snapshots and all CV
versions; CV versions are deleted individually.
