# Architecture

## Components

| Component | Cloudflare product | Name |
| --- | --- | --- |
| Browser app (includes CV text extraction) | Pages | project `nisco-career-ai`, branch alias `career-ai-deploy.nisco-career-ai.pages.dev` |
| API and scheduled discovery | Workers | `nisco-career-ai-api` (`*.workers.dev`) |
| Data | D1 | `nisco-career-ai-db` |
| CV files and extracted CV text | R2 (private) | `nisco-career-ai-private` (`private/uploads/`, `private/cv/`) |
| Matching and drafts | Workers AI | `@cf/meta/llama-3.1-8b-instruct` |
| Rate limiting | Workers Rate Limiting | `API_RATE_LIMITER` (120/min/IP), `AUTH_RATE_LIMITER` (10/min/IP) |

Everything is on the Cloudflare Free plan. Nothing calls a paid third-party API.

## Request pipeline (`worker/src/app.ts`)

1. CORS preflight: answered only for origins listed exactly in `ALLOWED_ORIGINS`.
2. Route lookup: 404 for unknown paths, 405 (with `Allow`) for a wrong method.
3. Writes (`POST`, `PUT`, `PATCH`, `DELETE`) carrying a foreign `Origin` header are refused (403).
4. `/api/*` is rate limited per client IP.
5. Authentication (all `/api/*` except `POST /api/session`), see below. Routes marked `personal`
   (all Phase 2 CV and profile-fact routes) also pass `requireOwnerIdentity`: in Access mode they need
   a non-empty `ACCESS_ALLOWED_EMAILS` (503 `owner_not_configured`) and an allowed email. In key mode
   the key holder is the owner.
6. The handler validates input. Validation problems are 400 with per-field messages, unknown IDs are
   404, conflicts are 409. Unexpected errors are logged with a request ID and returned as a generic 500.

All API responses carry `cache-control: no-store`, `nosniff`, `no-referrer`, `DENY` framing and a
`default-src 'none'` CSP. Downloads are always `content-disposition: attachment`.

## Authentication (`worker/src/auth/`)

`AUTH_MODE` selects one mode. An unknown value fails closed (503).

- **key** (current production): the user enters the private access key once. `POST /api/session`
  compares it in constant time (SHA-256 both sides, then `crypto.subtle.timingSafeEqual`) and returns
  a signed session token (HMAC-SHA256, default 8 hours, `SESSION_TTL_SECONDS`). The browser keeps only
  the token in `sessionStorage`; the key is never stored. Rotating `APP_ACCESS_KEY` invalidates all
  sessions. Sign-in is limited to 10 attempts per minute per IP.
- **access**: every request must carry a Cloudflare Access JWT (`Cf-Access-Jwt-Assertion` header or
  `CF_Authorization` cookie). The Worker verifies algorithm (RS256 only), signature against the
  team's JWKS, issuer, audience, expiry and not-before, then an optional email allow-list. Not
  enabled yet: see `ACCESS.md`.

## Data model

Migrations live in `worker/migrations/`. 0002 and 0003 are additive and safe over existing data. The
Phase 2 tables (`cv_versions`, `profile_items`, `profile_snapshots`) are described in
`DATA-MODEL.md`.

- `profile` (one row): the original Phase 1 profile notes as validated JSON (`name`, `headline`,
  `years`, `location`, `summary`, `skills`, `experience`, `roles`). Since Phase 2 it is kept word for
  word and is **not** used by matching, drafts or discovery until its values are confirmed as facts.
- `jobs`: vacancy fields plus `source`, `canonical_url` (unique when not null) and match state:
  `match_status` (`pending`, `scored`, `needs_review`, `legacy_unverified`), `match_score`,
  `match_details` (matched skills, gaps, rationale), `match_attempts`, `match_error`, `match_model`,
  `match_prompt_version`, `match_scored_at`, `match_checked_at`.
- `applications`: one active row per job (unique index where `archived_at` is null), status
  allow-list enforced by the API and by triggers, `notes`, `created_at`, `updated_at`.
- `documents`: every uploaded file the API stores in R2 (`r2_key`, original name, detected type,
  size, SHA-256). CV versions reference these rows; extracted text is keyed by CV version instead.
- `discovery_runs`: one row per scheduled run with status and per-source counts. No candidate data.

## Master CV and structured profile (Phase 2)

```
browser                                   Worker                          storage
-------                                   ------                          -------
choose PDF/DOCX ---- POST /api/cv/versions ---> type by content, 8 MB,  --> R2 private/uploads/<id>
                                                SHA-256, duplicate check    D1 documents + cv_versions
read text locally (pdf.js in a Web Worker,
own DOCX parser; no OCR)
     ---- POST /api/cv/versions/:id/extraction -> validate codes, parser,
                                                size; normalise text  ---> R2 private/cv/<id>/extracted.txt
                                                fixed-rule structuring,
                                                grounding check, dedupe --> D1 profile_items (proposed)
review: confirm / edit / reject ------------------> /api/profile/items/... -> confirmed / rejected / superseded
matching, drafts, discovery <---------------- getConfirmedProfile (confirmed items only)
```

Why the browser reads the text: the Workers Free plan allows about 10 ms of CPU per request, too little
to parse PDFs in the Worker. pdf.js is vendored (`frontend/vendor/pdfjs`, SHA-256 manifest checked in
CI), runs with script evaluation disabled in its own Web Worker allowed by the CSP `worker-src
'self'`. Section definitions, statuses, provenance, lifecycle and deletion are in `DATA-MODEL.md`.

## Matching (`worker/src/ai/`)

- Matching and drafts use the profile built from **confirmed** facts only
  (`worker/src/profile/confirmed.ts`); with none they return 409 `profile_required`.
- Prompts put the profile and the job posting in labelled fences. The posting is described to
  the model as untrusted data, and fence markers inside it are neutralised.
- Model output is accepted as JSON, fenced JSON, JSON with surrounding prose, or a JSON-mode object.
  The score must be numeric and is clamped to 0-100.
- A failed call, a timeout (25 s) or invalid output marks the job `needs_review` and keeps the previous
  score. A job is **shortlisted only if** its score came from a validated assessment
  (`match_scored_at` set) and is at least 80. Scores from before migration 0002 are
  `legacy_unverified` and are re-assessed by the next discovery run.

## Discovery (`worker/src/discovery/`)

Runs at 03:00 and 15:00 UTC (06:00 and 18:00 Riyadh). One run:

1. Reads the confirmed-facts profile once; role terms are the defaults plus the confirmed target
   roles. Without confirmed facts, new jobs are still collected but not assessed.
2. Fetches each feed with a 15 s timeout and one retry on network errors or HTTP 5xx.
3. Keeps https links whose title matches a role term and whose location is in Saudi Arabia or India,
   in a region containing them, or remote without a restriction to another country.
4. Canonicalises URLs (drops tracking parameters and fragments) and skips known jobs in one batched
   lookup. Inserts at most 25 new jobs in one batch.
5. Assesses up to 8 jobs that are pending, failed or legacy (fewer than 3 automatic attempts each).
6. Records the outcome in `discovery_runs` and logs a JSON summary.

Limits are in `worker/src/config.ts`.

## Application statuses

`prepared`, `applied` (you applied yourself, outside the app), `recruiter_contact`, `interview`,
`offer`, `rejected`, `withdrawn`. `submitted` is refused until approval records exist (a later
phase). The list lives in `worker/src/domain/applications.ts` and in the triggers of migration 0002;
change both together.
