# Testing

Career AI has three test suites, all run by CI on every pull request into `career-ai-deploy`, on every
push to a `career-ai-phase-*` branch, and before every deployment
(`.github/workflows/test-career-ai.yml`, called by `deploy-career-ai.yml`).

| Suite | Where | What it runs against |
| --- | --- | --- |
| Worker tests (unit and integration) | `career-ai/worker/test/` | The Worker code inside workerd with local D1/R2; Workers AI stubbed |
| Browser-module unit tests | `career-ai/e2e/unit/` | `node --test` on the browser's DOCX parser, PDF text joining and extraction outcomes, with generated synthetic files |
| Browser journeys (end to end) | `career-ai/e2e/tests/` | The real frontend in Chromium, served with the production headers, talking to the real Worker under `wrangler dev --local`: `journey.spec.js` (26 checks) then `master-cv.spec.js` (25 checks) |

Plus two scripted checks: `npm run vendor:verify` (the committed pdf.js is byte-identical to the
lockfile-verified package) and `worker/scripts/migration-0003-drill.sh` (apply, verify, restore
from backup, re-apply, on a throwaway local database).

## Exact commands

Requires Node.js 22. All tool versions are pinned in the two lockfiles.

```bash
# 1. Worker: install, strict typecheck, tests, dependency audit
cd career-ai/worker
npm ci
npm run typecheck
npm test
npm audit --audit-level=high

# 2. Browser tests (needs career-ai/worker/node_modules from step 1)
cd ../e2e
npm ci
npx playwright install --with-deps chromium   # once per machine; skip if Chromium for Playwright 1.63 is installed
npm run check                                 # syntax of the harness, specs and browser modules
npm audit --audit-level=high
npm run test:unit                             # browser-module unit tests (node --test)
npm run vendor:verify                         # vendored pdf.js matches the pinned package
npm test                                      # both journeys; set CI=1 for the CI reporters

# 3. Migration 0003 drill (local only, about 40 s)
cd ../worker && bash scripts/migration-0003-drill.sh

# 4. Repository hygiene (from the repository root)
bash career-ai/scripts/check-repo-hygiene.sh
```

The existing website and `nisco-ai/` checks are unchanged and run separately:

```bash
node --check script.js && node --check assets/nisco-chat.js && node --check assets/nisco-india-config.js && node --check nisco-ai/src/index.js
node --test tests/site.test.js nisco-ai/src/index.test.js
(cd nisco-ai && npm test)
node scripts/check-design-system.mjs
npx playwright test        # repository-root config; website layout and accessibility specs
```

## Latest verified results

Run on 12 November 2026 on branch `career-ai-phase-2`, from clean installs (`npm ci`):

| Check | Command | Result |
| --- | --- | --- |
| Strict typecheck | `npm run typecheck` (worker) | exit 0, no errors |
| Worker tests | `npm test` (worker) | 19 files, **427 / 427 passed** (Phase 1: 251) |
| Browser-module unit tests | `npm run test:unit` (e2e) | **31 / 31 passed** |
| pdf.js integrity | `npm run vendor:verify` (e2e) | pass: pdfjs-dist 6.4.299, 3 files match (also confirmed to fail on a tampered file) |
| Browser journeys | `CI=1 npm test` (e2e) | **51 / 51 passed** (26 + 25) in about 26 s |
| Browser journeys, repeated | five consecutive runs | 51 / 51 each time, no temporary directories left |
| Browser journeys, all CPU cores saturated | one run | 51 / 51 in 34.9 s |
| Migration 0003 drill | `bash scripts/migration-0003-drill.sh` | 12 / 12 checks passed, temporary state removed |
| Dependency audit | `npm audit --audit-level=high` (worker and e2e) | 0 vulnerabilities in both |
| Repository hygiene | `check-repo-hygiene.sh` | pass (also confirmed to fail on a planted non-example email address) |
| Frontend syntax | `node --check app.js config.js js/*.js` | pass |
| Website + NISCO AI | `node --test tests/site.test.js nisco-ai/src/index.test.js` | 31 / 31 passed (unchanged) |
| NISCO AI | `cd nisco-ai && npm test` | 24 / 24 passed (unchanged) |
| Design system | `node scripts/check-design-system.mjs` | pass (unchanged) |
| Website browser specs | `npx playwright test` (repository root) | 11 / 11 passed (unchanged) |

The GitHub Actions results for the same commit are linked from the pull request.

## Worker tests

- Vitest with `@cloudflare/vitest-plugin` runs tests inside workerd with **local** D1 and R2. Remote
  bindings are disabled; nothing contacts Cloudflare.
- `test/setup/global.ts` applies the real migration files (0001-0003), then empties every table
  (Phase 2 tables first, because of their foreign keys) and the R2 bucket before each test. Local storage is shared between tests in this runtime, so this reset matters.
- Workers AI is replaced by `AiStub` (`test/helpers.ts`). A call with no queued response throws, so a
  test can never reach the real, billable AI service. `makeEnv()` only accepts an `AiStub` for `AI`.
- Rate limiters are replaced by allow-all stubs, except in the test that uses the real
  `AUTH_RATE_LIMITER` binding from `wrangler.toml`.
- The migration test uses a separate empty database (`MIGRATION_TEST_DB`), applies 0001, inserts
  0001-era data (duplicates, unsafe links, bad scores, invalid statuses) and then applies 0002.
- Feeds are fake `fetch` functions returning payloads in each feed's real shape. No real feed and no
  production cron is ever called.
- All fixtures are synthetic: no real person, CV, key or employer data.

### Phase 2 coverage (Issue #3 acceptance)

| Requirement | Tests |
| --- | --- |
| Upload validation: type by content, size, spoofed files, duplicates | `cv.test.ts`, `files.test.ts`, journey M13, M14 |
| Extraction result validation (statuses, warning codes, parser per type, size limits, normalisation) | `cv.test.ts` |
| Browser extraction: PDF (pdf.js under the production CSP), DOCX, scanned PDF, hostile DOCX (zip bomb, DTD, encryption, ZIP64) | `e2e/unit/*.test.js`, journey M04, M11, M15, M25 |
| Structuring is grounded (no invented values) | `unit/structure.test.ts` (incl. 400-document fuzz), journey M05 |
| Review: confirm, edit before confirming, reject, reject remaining, replace a confirmed value only explicitly | `profile-items.test.ts`, `cv.test.ts`, journey M06-M09, M18 |
| Statuses and provenance (`proposed`/`confirmed`/`rejected`/`superseded`; source CV, snapshot, span) | `profile-items.test.ts`, `cv.test.ts`, journey M05-M08, M22 |
| Versioning: one active version, activate/deactivate, re-read, register an earlier upload | `cv.test.ts`, journey M10, M12, M19 |
| Matching, drafts and discovery use confirmed facts only | `confirmed-only.test.ts`, journey 07b, 12, 13 |
| Existing profile preserved word for word; snapshots immutable; verbatim proposals | `migrations.test.ts` (10 tests for 0003), `profile-items.test.ts`, migration drill |
| Authorisation: every personal route needs a session; Access owner allowed, others 403, empty allow-list 503 | `phase2-access.test.ts` (route table driven), journey M20 |
| Privacy: no R2 keys in any response; no CV text in logs (log canary) | `phase2-access.test.ts`, journey M21 |
| Delete CV (typed confirmation; R2 and records removed; confirmed facts kept with history) | `cv.test.ts`, journey M22 |
| Delete all profile facts (typed confirmation; notes and CVs kept) | `profile-items.test.ts`, journey M02 |
| Export (profile, snapshots, items, CV versions with text, file list; no keys or secrets) | `profile-items.test.ts`, journey M21 |
| Existing `/api/files` contract unchanged | `files.test.ts` (all 17 Phase 1 tests unchanged), journey 17-20 |
| Accessibility and layout | journey M23 (profile tab and dialog), M24 (360 px) |

### Audit probe coverage

| Audit probe | What it checks | Test |
| --- | --- | --- |
| P05 | Malformed JSON returns 400 | `profile-and-jobs.test.ts` |
| P06 | Profile must be an object with known fields | `profile-and-jobs.test.ts` |
| P07 | `javascript:`, `data:`, `http:` links rejected; unsafe stored links withheld | `profile-and-jobs.test.ts`, `unit/urls.test.ts`, journey check 08 |
| P08 | Duplicate and tracking-variant links rejected with 409 | `profile-and-jobs.test.ts`, journey check 10 |
| P09 | Missing or unknown job ID returns 400/404 | `profile-and-jobs.test.ts` |
| P10 | Preambled JSON scored correctly, never stored as 0 | `profile-and-jobs.test.ts`, `unit/parse.test.ts` |
| P11 | Scores clamped to 0-100 | `profile-and-jobs.test.ts`, `unit/parse.test.ts` |
| P12 | Object (JSON-mode) responses accepted | `profile-and-jobs.test.ts`, `unit/parse.test.ts` |
| P13 | Matched skills, gaps and rationale kept after reload | `profile-and-jobs.test.ts` |
| P14 | Application for an unknown job returns 404 | `applications-and-drafts.test.ts` |
| P15 | One application per job (409) | `applications-and-drafts.test.ts`, `migrations.test.ts`, journey check 14 |
| P16 | Unknown application ID returns 404 | `applications-and-drafts.test.ts` |
| P17 | Notes-only update keeps the status | `applications-and-drafts.test.ts`, journey check 16 |
| P18 | Status outside the allow-list rejected (API and database) | `applications-and-drafts.test.ts`, `migrations.test.ts` |
| P19 | Oversized upload with Content-Length rejected | `files.test.ts` |
| P20 | Oversized streamed upload without Content-Length rejected | `files.test.ts` |
| P21 | Malformed file-name header returns 400 | `files.test.ts`, `unit/signature-and-prompts.test.ts` |
| P22, P23 | Uploads recorded, listed, downloadable, deletable; earlier uploads recoverable | `files.test.ts`, journey checks 17-20 |
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

## Browser journeys

`career-ai/e2e/tests/journey.spec.js` (Phase 1, 26 checks) and `master-cv.spec.js` (Phase 2, 25
checks) are each one ordered story sharing one browser page; they run one after the other against
the same fresh Worker. Playwright starts two servers (`playwright.config.js`) and stops them
afterwards. The PDF and DOCX files are generated in memory by `e2e/fixtures/synthetic-docs.js`; no
CV file is committed.

### Isolation: what it can and cannot reach

`scripts/start-worker.js` starts the real Worker with `wrangler dev --local` and:

- creates a new temporary directory for local D1 and R2 state, applies the migrations to it, and
  deletes it when the run ends, so every run starts from an empty database;
- generates its Wrangler config from `worker/wrangler.toml` with the `[ai]` and `[triggers]`
  sections removed, and refuses to start if the result still contains an AI binding, cron triggers, a
  `database_id` or a remote binding. The Worker therefore has no Workers AI binding at all and never
  fetches job feeds; assessments and drafts exercise their real failure paths;
- removes `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and related variables from Wrangler's
  environment, and points `HOME` and `XDG_CONFIG_HOME` at the temporary directory so a stored
  `wrangler login` is not visible;
- disables Wrangler telemetry (`WRANGLER_SEND_METRICS=false`);
- raises the API rate limit from 120 to 1200 requests a minute (the sign-in limit stays at 10). The
  journeys perform about 75 user actions plus their own state checks in well under a minute; at the
  production limit they would only measure their own speed. 429 handling is tested in
  `auth.test.ts`, and check M06 pins the request budget of a review action (exactly two API
  requests), which keeps a person far inside the production limit.

The CI job references no secrets and also fails fast if any Cloudflare credential variable is set.
The generated config is saved to `e2e/logs/wrangler.e2e.toml` for inspection.

### Production headers

`scripts/serve-frontend.js` serves `career-ai/frontend` with every header from `frontend/_headers`,
parsed with the Pages rules (`scripts/headers.js`). Exactly two values differ from production, and
both substitutions fail loudly if the production value is not found:

- the CSP `connect-src` entry for the production API points at the local Worker;
- `config.js` `apiBase` points at the local Worker.

Check 01 compares the served headers with `_headers`, and check 25 asserts that the page reported no
CSP violation (`securitypolicyviolation` events are recorded; CSP is enforced, not bypassed).

### Determinism

- One worker, serial checks, no retries, `forbidOnly` in CI; fixed `en-GB` locale and `UTC` time zone.
- Every wait targets a specific visible state (a status message, a count, an attribute), never a
  fixed sleep. Status messages are cleared before each action, so an earlier message cannot satisfy
  a later wait.
- Servers are never reused (`reuseExistingServer: false`): a busy port fails the run instead of
  testing a stale server.
- The first data load after sign-in is delayed by 1 s on every run. This makes a real race
  deterministic: before the fix, a slow first load could overwrite data entered afterwards (found while
  building this suite). Check 05 asserts the workspace is `aria-busy` and `inert` until the load ends,
  and the later checks fail if a stale load overwrites newer data.

### When it fails

CI uploads an artifact named `career-ai-e2e-failure-<run>-<attempt>` (kept 14 days) containing:

| Path | Contents |
| --- | --- |
| `playwright-report/` | HTML report with the failing assertion, call log and attachments |
| `test-results/<check>/failure-screenshot.png` | Full-page screenshot at the moment of failure |
| `test-results/<check>/page-state.txt` | Visible status messages, URL, console errors, last 30 responses |
| `test-results/<check>/error-context.md` | Playwright's accessibility snapshot of the page |
| `test-results/junit.xml` | Per-check results |
| `logs/worker.log` | Wrangler and Worker output, including every API request |
| `logs/frontend.log` | Every request to the static server |
| `logs/browser-network.log`, `logs/browser-network-master-cv.log` | Every response the browser received, per journey |
| `logs/trace.zip` | Full Playwright trace of `journey.spec.js`: open with `npx playwright show-trace logs/trace.zip` |
| `logs/wrangler.e2e.toml` | The generated, AI-free test configuration |

The failing check is also annotated on the pull request. Checks after a failure are skipped (they
depend on earlier steps of the story).

### The checks

`journey.spec.js`. Phase 2 inserted one step, 07b: matching and drafts now use confirmed facts only,
so the notes saved in 07 are reviewed and confirmed before 12 and 13. The 25 original checks and
their assertions are unchanged.

| # | Check |
| --- | --- |
| 01 | Page served with the production security headers (only the API origin differs) |
| 02 | Sign-in page: no critical or serious axe violations |
| 03 | Wrong access key rejected with a message |
| 04 | Raw access key never stored in browser storage |
| 05 | Workspace busy and inert until saved data has loaded |
| 06 | Short-lived (8-hour) session token stored instead |
| 07 | Career profile saved and confirmed through the API |
| 07b | Saved notes reviewed as proposals and confirmed one by one; notes unchanged |
| 08 | `javascript:` job link rejected; field marked invalid; nothing saved |
| 09 | Valid job saved and listed |
| 10 | Tracking-parameter variant rejected as a duplicate |
| 11 | Listing link is an https link |
| 12 | With no AI available, assessment is `needs_review` and no score is invented |
| 13 | Draft with AI unavailable shows a clear error |
| 14 | Second tracker entry for the same job refused |
| 15 | "submitted" not offered as a status |
| 16 | Notes-only update keeps the status "applied" (confirmed through the API) |
| 17 | PDF uploaded privately and listed |
| 18 | Download returns exactly the uploaded bytes |
| 19 | HTML file named `.pdf` rejected |
| 20 | File deleted (and gone from the API) |
| 21 | Every tab: no critical or serious axe violations |
| 22 | No horizontal overflow at 360 px |
| 23 | Session survives a page reload |
| 24 | Locking the workspace clears session storage |
| 25 | No console errors and no CSP violations during the journey |

`master-cv.spec.js`:

| # | Check |
| --- | --- |
| M01 | Sign in; master CV panel shown |
| M02 | Delete all profile facts needs the exact typed phrase; cancel keeps everything |
| M03 | A fact added by hand is confirmed immediately |
| M04 | PDF uploaded; text read in the browser by the vendored pdf.js; extraction recorded; no storage keys returned |
| M05 | Every proposal is grounded in the extracted text and shows its source |
| M06 | Proposal confirmed as is, with exactly two API requests |
| M07 | Proposal edited before confirming; marked as edited |
| M08 | Replacing a confirmed value asks first; cancel keeps it; replace supersedes it |
| M09 | Proposal rejected |
| M10 | PDF made the active master CV |
| M11 | DOCX read by the DOCX parser (header included); nothing already confirmed or proposed is proposed again |
| M12 | Activating the DOCX leaves exactly one active version |
| M13 | Same bytes uploaded again refused as a duplicate |
| M14 | HTML named `.pdf` refused; nothing stored |
| M15 | Scanned PDF without a text layer reported as failed; no proposals |
| M16 | Download returns exactly the uploaded bytes |
| M17 | Extracted text viewable in the page |
| M18 | Remaining proposals from one CV rejected together |
| M19 | Earlier private upload registered as a CV version and read; its file can no longer be deleted from the file list |
| M20 | Without a session (or with a forged token) the CV, profile and export endpoints return 401 |
| M21 | Export contains profile and document metadata, no storage keys, access key or session token |
| M22 | Delete CV needs the typed phrase; file and records removed (download 410); confirmed facts kept and marked |
| M23 | Profile tab and confirmation dialog: no critical or serious axe violations |
| M24 | No horizontal overflow at 360 px |
| M25 | pdf.js worker loaded; no console errors and no CSP violations |

## Not covered by automated tests

- Real Workers AI output quality. Tests prove how responses are handled, not how good they are.
- The live feeds' current payloads. Adapters are tested against their documented shapes; a feed that
  changes format shows up as a source error in `discovery_runs`.
- The headers Cloudflare Pages actually sends in production, and Cloudflare Access configuration,
  which exist only in Cloudflare. The journey proves the headers in `_headers` work with the app.
- Browsers other than Chromium.
- Real-world CV layouts. Structuring is tested on synthetic CVs; real layouts vary, which is why
  every proposal needs review.
- The deploy-time R2 privacy and D1 restore-point steps against real Cloudflare: they were exercised
  with simulated Wrangler output (pass and every failure case) and run for real on the next approved
  deployment.

## Dependency advisories

`npm audit --audit-level=high` blocks CI when a high or critical advisory affects a pinned package.
Fix it by moving the pin to a patched version (update `package.json` and the lockfile together, then
rerun everything above). Do not loosen the audit level to get a green build.
