# Architecture

## Components

| Component | Cloudflare product | Name |
| --- | --- | --- |
| Browser app | Pages | project `nisco-career-ai`, branch alias `career-ai-deploy.nisco-career-ai.pages.dev` |
| API and scheduled discovery | Workers | `nisco-career-ai-api` (`*.workers.dev`) |
| Data | D1 | `nisco-career-ai-db` |
| CV files | R2 (private) | `nisco-career-ai-private` |
| Matching and drafts | Workers AI | `@cf/meta/llama-3.1-8b-instruct` |
| Rate limiting | Workers Rate Limiting | `API_RATE_LIMITER` (120/min/IP), `AUTH_RATE_LIMITER` (10/min/IP) |

Everything is on the Cloudflare Free plan. Nothing calls a paid third-party API.

## Request pipeline (`worker/src/app.ts`)

1. CORS preflight: answered only for origins listed exactly in `ALLOWED_ORIGINS`.
2. Route lookup: 404 for unknown paths, 405 (with `Allow`) for a wrong method.
3. Writes (`POST`, `PUT`, `PATCH`, `DELETE`) carrying a foreign `Origin` header are refused (403).
4. `/api/*` is rate limited per client IP.
5. Authentication (all `/api/*` except `POST /api/session`), see below.
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

Migrations live in `worker/migrations/`. 0002 is additive and safe over existing data.

- `profile` (one row): the master profile as validated JSON (`name`, `headline`, `years`, `location`,
  `summary`, `skills`, `experience`, `roles`).
- `jobs`: vacancy fields plus `source`, `canonical_url` (unique when not null) and match state:
  `match_status` (`pending`, `scored`, `needs_review`, `legacy_unverified`), `match_score`,
  `match_details` (matched skills, gaps, rationale), `match_attempts`, `match_error`, `match_model`,
  `match_prompt_version`, `match_scored_at`, `match_checked_at`.
- `applications`: one active row per job (unique index where `archived_at` is null), status
  allow-list enforced by the API and by triggers, `notes`, `created_at`, `updated_at`.
- `documents`: every R2 object the API stores (`r2_key`, original name, detected type, size, SHA-256).
- `discovery_runs`: one row per scheduled run with status and per-source counts. No candidate data.

## Matching (`worker/src/ai/`)

- Prompts put the saved profile and the job posting in labelled fences. The posting is described to
  the model as untrusted data, and fence markers inside it are neutralised.
- Model output is accepted as JSON, fenced JSON, JSON with surrounding prose, or a JSON-mode object.
  The score must be numeric and is clamped to 0-100.
- A failed call, a timeout (25 s) or invalid output marks the job `needs_review` and keeps the previous
  score. A job is **shortlisted only if** its score came from a validated assessment
  (`match_scored_at` set) and is at least 80. Scores from before migration 0002 are
  `legacy_unverified` and are re-assessed by the next discovery run.

## Discovery (`worker/src/discovery/`)

Runs at 03:00 and 15:00 UTC (06:00 and 18:00 Riyadh). One run:

1. Reads the profile once; role terms are the defaults plus the profile's target roles.
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
