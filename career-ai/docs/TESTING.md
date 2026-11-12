# Testing

Career AI has two test suites, both run by CI on every pull request into `career-ai-deploy`, on every
push to a `career-ai-phase-*` branch, and before every deployment
(`.github/workflows/test-career-ai.yml`, called by `deploy-career-ai.yml`).

| Suite | Where | What it runs against |
| --- | --- | --- |
| Worker tests (unit and integration) | `career-ai/worker/test/` | The Worker code inside workerd with local D1/R2; Workers AI stubbed |
| Browser journey (end to end) | `career-ai/e2e/` | The real frontend in Chromium, served with the production headers, talking to the real Worker under `wrangler dev --local` |

## Exact commands

Requires Node.js 22. All tool versions are pinned in the two lockfiles.

```bash
# 1. Worker: install, strict typecheck, tests, dependency audit
cd career-ai/worker
npm ci
npm run typecheck
npm test
npm audit --audit-level=high

# 2. Browser journey (needs career-ai/worker/node_modules from step 1)
cd ../e2e
npm ci
npx playwright install --with-deps chromium   # once per machine; skip if Chromium for Playwright 1.63 is installed
npm run check                                 # syntax of the harness and spec
npm audit --audit-level=high
npm test                                      # set CI=1 for the CI reporters (GitHub annotations, JUnit)

# 3. Repository hygiene (from the repository root)
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

Run on 12 November 2026 on branch `career-ai-phase-0-1`, from clean installs (`npm ci`):

| Check | Command | Result |
| --- | --- | --- |
| Strict typecheck | `npm run typecheck` (worker) | exit 0, no errors |
| Worker tests | `npm test` (worker) | 13 files, **251 / 251 passed** |
| Browser journey | `CI=1 npm test` (e2e) | **25 / 25 passed** in 16.5 s |
| Browser journey, repeated | five consecutive runs | 25 / 25 each time, no temporary directories left |
| Browser journey, all CPU cores saturated | one run | 25 / 25 in 20.6 s |
| Dependency audit | `npm audit --audit-level=high` (worker and e2e) | 0 vulnerabilities in both |
| Repository hygiene | `check-repo-hygiene.sh` | pass (also confirmed to fail on a planted `.pdf` and a planted key) |
| Frontend syntax | `node --check app.js config.js` | pass |
| Website + NISCO AI | `node --test tests/site.test.js nisco-ai/src/index.test.js` | 31 / 31 passed |
| NISCO AI | `cd nisco-ai && npm test` | 24 / 24 passed |
| Design system | `node scripts/check-design-system.mjs` | pass |
| Website browser specs | `npx playwright test` (repository root) | 11 / 11 passed |

The GitHub Actions results for the same commit are linked from the pull request.

## Worker tests

- Vitest with `@cloudflare/vitest-plugin` runs tests inside workerd with **local** D1 and R2. Remote
  bindings are disabled; nothing contacts Cloudflare.
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

## Browser journey

`career-ai/e2e/tests/journey.spec.js` is one ordered story of 25 checks sharing one browser page.
Playwright starts two servers (`playwright.config.js`) and stops them afterwards.

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
- disables Wrangler telemetry (`WRANGLER_SEND_METRICS=false`).

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
| `logs/browser-network.log` | Every response the browser received |
| `logs/trace.zip` | Full Playwright trace: open with `npx playwright show-trace logs/trace.zip` |
| `logs/wrangler.e2e.toml` | The generated, AI-free test configuration |

The failing check is also annotated on the pull request. Checks after a failure are skipped (they
depend on earlier steps of the story).

### The 25 checks

| # | Check |
| --- | --- |
| 01 | Page served with the production security headers (only the API origin differs) |
| 02 | Sign-in page: no critical or serious axe violations |
| 03 | Wrong access key rejected with a message |
| 04 | Raw access key never stored in browser storage |
| 05 | Workspace busy and inert until saved data has loaded |
| 06 | Short-lived (8-hour) session token stored instead |
| 07 | Career profile saved and confirmed through the API |
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

## Not covered by automated tests

- Real Workers AI output quality. Tests prove how responses are handled, not how good they are.
- The live feeds' current payloads. Adapters are tested against their documented shapes; a feed that
  changes format shows up as a source error in `discovery_runs`.
- The headers Cloudflare Pages actually sends in production, and Cloudflare Access configuration,
  which exist only in Cloudflare. The journey proves the headers in `_headers` work with the app.
- Browsers other than Chromium.

## Dependency advisories

`npm audit --audit-level=high` blocks CI when a high or critical advisory affects a pinned package.
Fix it by moving the pin to a patched version (update `package.json` and the lockfile together, then
rerun everything above). Do not loosen the audit level to get a green build.
