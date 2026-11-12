# Testing

```bash
cd career-ai/worker
npm ci
npm run typecheck   # strict TypeScript, tests included
npm test            # all suites
npm run check       # both
```

CI runs the same commands (`.github/workflows/test-career-ai.yml`) on every pull request into
`career-ai-deploy`, on pushes to `career-ai-phase-*` branches, and before every deployment.

## How the tests run

- Vitest with `@cloudflare/vitest-plugin` runs tests inside workerd, the Workers runtime, with
  **local** D1 and R2. Remote bindings are disabled; nothing contacts Cloudflare.
- `test/setup/global.ts` applies the real migration files, then empties every table and the R2 bucket
  before each test. Local storage is shared between tests in this runtime, so this reset matters.
- Workers AI is replaced by `AiStub` (`test/helpers.ts`). A call with no queued response throws, so a
  test can never reach the real, billable AI service. `makeEnv()` only accepts an `AiStub` for `AI`.
- Rate limiters are replaced by allow-all stubs, except in the test that uses the real
  `AUTH_RATE_LIMITER` binding from `wrangler.toml`.
- The migration test uses a separate empty database (`MIGRATION_TEST_DB`), applies 0001, inserts
  0001-era data (duplicates, unsafe links, bad scores, invalid statuses) and then applies 0002.
- Feeds are fake `fetch` functions returning payloads in each feed's real shape. No real feed and no
  production cron is ever called.
- All fixtures are synthetic: no real person, CV, key or employer data.

## Audit probe coverage

| Audit probe | What it checks | Test |
| --- | --- | --- |
| P05 | Malformed JSON returns 400 | `profile-and-jobs.test.ts` |
| P06 | Profile must be an object with known fields | `profile-and-jobs.test.ts` |
| P07 | `javascript:`, `data:`, `http:` links rejected; unsafe stored links withheld | `profile-and-jobs.test.ts`, `unit/urls.test.ts` |
| P08 | Duplicate and tracking-variant links rejected with 409 | `profile-and-jobs.test.ts` |
| P09 | Missing or unknown job ID returns 400/404 | `profile-and-jobs.test.ts` |
| P10 | Preambled JSON scored correctly, never stored as 0 | `profile-and-jobs.test.ts`, `unit/parse.test.ts` |
| P11 | Scores clamped to 0-100 | `profile-and-jobs.test.ts`, `unit/parse.test.ts` |
| P12 | Object (JSON-mode) responses accepted | `profile-and-jobs.test.ts`, `unit/parse.test.ts` |
| P13 | Matched skills, gaps and rationale kept after reload | `profile-and-jobs.test.ts` |
| P14 | Application for an unknown job returns 404 | `applications-and-drafts.test.ts` |
| P15 | One application per job (409) | `applications-and-drafts.test.ts`, `migrations.test.ts` |
| P16 | Unknown application ID returns 404 | `applications-and-drafts.test.ts` |
| P17 | Notes-only update keeps the status | `applications-and-drafts.test.ts` |
| P18 | Status outside the allow-list rejected (API and database) | `applications-and-drafts.test.ts`, `migrations.test.ts` |
| P19 | Oversized upload with Content-Length rejected | `files.test.ts` |
| P20 | Oversized streamed upload without Content-Length rejected | `files.test.ts` |
| P21 | Malformed file-name header returns 400 | `files.test.ts`, `unit/signature-and-prompts.test.ts` |
| P22, P23 | Uploads recorded, listed, downloadable, deletable; earlier uploads recoverable | `files.test.ts` |
| P24 | Drafts use the saved profile only | `applications-and-drafts.test.ts` |
| S01 | Restricted-remote roles excluded; tracking variants de-duplicated | `discovery.test.ts`, `unit/filters-and-text.test.ts` |
| S02 | Per-run inserts, AI calls and D1 statements bounded; profile read once | `discovery.test.ts` |
| S03 | Untrusted feed text fenced in prompts | `discovery.test.ts`, `unit/signature-and-prompts.test.ts` |
| S04 | Failed scores retried on later runs, up to 3 attempts | `discovery.test.ts` |

Security tests: every authenticated route returns 401 without a session (`auth.test.ts`); session
expiry, tampering and key rotation; constant-time comparison; rate limiting (stub and real binding);
exact CORS origins; foreign-origin writes refused; health reveals no auth configuration; Access JWT
validation and allow-list (`access-jwt.test.ts`); generic 500 with no internal details
(`router.test.ts`).

## Not covered by automated tests

- Real Workers AI output quality. Tests prove how responses are handled, not how good they are.
- The live feeds' current payloads. Adapters are tested against their documented shapes; a feed that
  changes format shows up as a source error in `discovery_runs`.
- The deployed Pages headers and Cloudflare Access configuration, which exist only in Cloudflare.
- A browser end-to-end journey is not part of CI yet. It was run manually for this phase against
  `wrangler dev --local` (see the pull request description).
