# Developer handover

For a developer taking over NISCO Career AI with no prior context. Read this first, then
`ARCHITECTURE.md`, `DATA-MODEL.md` and `TESTING.md`.

## What it is, in one paragraph

A private, **single-user** career workspace on the Cloudflare Free plan: a static Pages app
(`frontend/`), one Worker API (`worker/`), D1, a private R2 bucket and Workers AI. The owner uploads a
master CV; its text is read **in the browser**, checked by the Worker, and turned by fixed rules into
proposed profile facts. The owner confirms, edits or rejects each one. Job matching, drafts and job
discovery use **confirmed facts only**. Nothing is ever submitted to an employer. The NISCO website
(repository root) and `nisco-ai/` are separate products: do not change them from Career AI work.

## Status after Phase 2

| Area | State |
| --- | --- |
| Sign-in (access key → 8-hour session); Cloudflare Access | Key mode live; Access implemented, **not enabled** (`ACCESS.md`) |
| Master CV: upload, versions (one active), download, delete | Done (Phase 2) |
| Browser text extraction (PDF via pdf.js, DOCX via own parser) | Done (Phase 2). No OCR. |
| Structured profile with provenance and review | Done (Phase 2) |
| Original Phase 1 profile | Preserved word for word; reviewable as proposals |
| Export and delete | Done (Phase 2) |
| Jobs, matching, drafts, tracker, discovery | Phase 1; now driven by confirmed facts |
| Exact-location allowlist for discovery (Riyadh, Madinah/Medina, Jeddah, Chennai, Hyderabad) | **Not done, deferred.** Discovery location filtering is not fully validated. |
| Job-portal connectors, ATS CV generation, approval records | Not built (later phases) |

## First hour

```bash
git clone https://github.com/speed7852/nisco-website && cd nisco-website/career-ai

# Worker: install, typecheck, 427 tests (local D1/R2 inside workerd; Workers AI stubbed)
cd worker && npm ci && npm run typecheck && npm test

# Browser: unit tests, pdf.js integrity, both journeys (51 checks)
cd ../e2e && npm ci
npx playwright install --with-deps chromium     # once per machine
npm run test:unit && npm run vendor:verify && npm test

# Migration 0003 apply/rollback drill on a throwaway local database (about 40 s)
cd ../worker && bash scripts/migration-0003-drill.sh
```

Run the app locally (fresh, isolated, nothing reaches Cloudflare; data is lost when it stops):

```bash
cd career-ai/e2e
node scripts/start-worker.js                          # terminal 1: API on http://127.0.0.1:8799
node scripts/serve-frontend.js                        # terminal 2: app on http://127.0.0.1:4174
node scripts/make-synthetic-cv.js /tmp/synthetic-cv   # synthetic PDF/DOCX to upload (outside the repo)
```

Sign in with `ACCESS_KEY` from `e2e/e2e.config.js` (synthetic). The local Worker has no AI binding,
so matching and drafts show their failure states, and it allows 1200 API requests a minute instead of
120 (see `TESTING.md`).

## Code map (Phase 2 additions)

| Path | Purpose |
| --- | --- |
| `worker/migrations/0003_phase2_cv_profile.sql` | `cv_versions`, `profile_items`, `profile_snapshots`, carry-over of the old profile |
| `worker/src/routes/cv.ts` | CV version API: upload, register an earlier upload, extraction result, activate, download, delete |
| `worker/src/routes/profile-items.ts` | Facts API: list, add, edit, confirm, reject, delete, legacy proposals, export, delete all |
| `worker/src/files/upload.ts` | Upload validation (type by content, 8 MB, SHA-256), storage and download, shared by `/api/files` and CV versions |
| `worker/src/profile/schema.ts` | Section definitions and value validation (also served to the browser) |
| `worker/src/profile/structure.ts` | Fixed-rule CV structuring and the grounding check |
| `worker/src/profile/confirmed.ts` | The confirmed-only profile used by matching, drafts and discovery |
| `worker/src/profile/proposals.ts`, `legacy.ts` | Proposal de-duplication, section states, legacy field mapping |
| `worker/src/db/cv-versions.ts`, `profile-items.ts`, `profile-snapshots.ts` | D1 queries and DTOs (no R2 keys in DTOs) |
| `worker/src/auth/index.ts` → `requireOwnerIdentity` | Single-user guard on every `personal` route |
| `frontend/app.js` | ES module: sign-in, layout, jobs, studio, tracker, private files |
| `frontend/js/core.js` | API client, DOM helper, confirmation dialog, workspace refresh |
| `frontend/js/master-cv.js`, `profile-facts.js` | Master CV panel; review queue, confirmed profile, export, delete |
| `frontend/js/extract.js`, `docx.js`, `pdf-text.js` | Browser extraction |
| `frontend/vendor/pdfjs/` | pdf.js 6.4.299 (Apache-2.0) with `manifest.json` of SHA-256 hashes. Never edit by hand. |
| `e2e/tests/master-cv.spec.js`, `e2e/unit/`, `e2e/fixtures/synthetic-docs.js` | Master CV journey, browser-module unit tests, synthetic PDF/DOCX generator |
| `e2e/scripts/vendor-pdfjs.js` | `update` / `verify` the vendored pdf.js |

## Invariants: do not break these

Each one is enforced in code **and** covered by tests. If a change makes one of these tests fail, the
change is wrong, not the test.

1. **Only confirmed facts reach matching, drafts and discovery.** `profile/confirmed.ts`; tests in
   `confirmed-only.test.ts`.
2. **Nothing is invented.** Structuring only copies substrings of the extracted text; every proposal
   passes `isGrounded`. `unit/structure.test.ts` (including a 400-document fuzz test) and journey
   check M05.
3. **The original profile is never rewritten.** Migration 0003 and the API only add snapshots and
   proposals; every legacy edit snapshots the previous row first. `migrations.test.ts`,
   `profile-items.test.ts`, the migration drill.
4. **One active CV version; one confirmed value per single-value section.** Partial unique indexes in
   0003; replacing a confirmed value needs `replaceConfirmed: true`.
5. **CV files stay private.** R2 keys never appear in responses or logs (`phase2-access.test.ts`
   scans every route); downloads are attachments; the deploy stops if the bucket gets an r2.dev URL
   or a custom domain.
6. **Single user.** Key mode: the key holder is the owner. Access mode: `personal` routes require a
   non-empty `ACCESS_ALLOWED_EMAILS` (503 `owner_not_configured` otherwise) and a listed email. No
   registration or multi-user code exists; do not add any.
7. **Destructive actions need typed confirmation** (`DELETE` for a CV, `DELETE PROFILE DATA` for all
   facts) in both the API and the UI.
8. **No real personal data in the repository.** Fixtures are generated; `scripts/check-repo-hygiene.sh`
   blocks document files, credential-like strings and email addresses outside reserved example
   domains.

## Common changes

**Add or change a profile section.** Edit `SECTION_SPECS` and the section lists in
`profile/schema.ts`; add the section to the allow-list triggers in a **new** migration (never edit
0003 after it has run in production); update `confirmed.ts` if matching should use it; the browser
renders forms from the served specs, so no frontend change is usually needed. Add tests in
`unit/profile-schema.test.ts` and `profile-items.test.ts`.

**Improve CV structuring.** Change rules in `profile/structure.ts`, bump `STRUCTURER_VERSION`, keep the
final `filter(isGrounded)`. Add synthetic cases to `unit/structure.test.ts`. Re-reading a CV
replaces only that CV's unreviewed proposals.

**Upgrade pdf.js.** Change the exact version of `pdfjs-dist` in `e2e/package.json`, `npm install`,
`node scripts/vendor-pdfjs.js update`, review the diff of `frontend/vendor/pdfjs/manifest.json`, run
the unit tests and both journeys (M04/M25 prove it works under the production CSP). CI runs
`vendor:verify`, which fails if the committed files differ from the lockfile-verified package.

**Add a migration.** New numbered file; test it in `test/migrations.test.ts` against data from the
previous schema; write a drill like `scripts/migration-0003-drill.sh`; document rollback in
`DEPLOYMENT.md`.

## Releasing

1. Work on a `career-ai-phase-*` branch; CI (`test-career-ai.yml`) runs on every push.
2. Open a pull request; merge into `career-ai-deploy` only with the owner's approval. A push to
   `career-ai-deploy` starts `deploy-career-ai.yml`: checks, then (with environment approval) the
   read-only R2 privacy check, the D1 restore point, migrations, Worker, secret, Pages.
3. Follow "What the first deployment after Phase 2 changes" and "Rolling back migration 0003" in
   `DEPLOYMENT.md`.

## Known limitations and risks

- **Location filtering is not fully validated.** The exact allowlist correction is deferred
  (recorded in the Phase 2 issue). Discovery still uses the Phase 1 country/region filter.
- **Structuring is heuristic.** Unusual CV layouts produce fewer or oddly split proposals (for
  example a second line taken as the headline). Nothing is confirmed automatically, so the cost is
  review effort, not wrong data; facts can always be edited or added by hand.
- **Extracted text comes from the browser.** The Worker validates its shape, size and parser, but
  cannot prove the text came from the stored file (the Free plan's CPU limit rules out server-side
  parsing). In a single-user app the only party who could submit other text is the owner.
- **No OCR.** Scanned PDFs are reported as `no_text_layer`; the owner can add facts by hand.
- **Chromium only.** The browser journeys run in Chromium; Firefox and Safari are untested.
- **Access mode guards.** `requireOwnerIdentity` protects the Phase 2 routes. The Phase 1 routes
  `/api/profile` and `/api/files` keep their Phase 1 behaviour (any Access-authenticated identity
  passing the optional allow-list), to avoid changing existing contracts. Before enabling Access, set
  `ACCESS_ALLOWED_EMAILS` (`ACCESS.md`).
- **Pages previews.** The repository's Pages Git integration builds a preview of every pushed branch,
  including Career AI branches. Previews cannot call the API (CORS allows only the two production
  origins) and contain no data, but they exist.
- **Deploy checks are untested against real Cloudflare.** The R2 privacy and Time Travel steps use
  the exact output of the pinned Wrangler and were exercised with simulated output only; their first
  real run is the next approved deployment. They fail closed.
