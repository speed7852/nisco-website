# NISCO Career AI

A private, single-user career workspace: a master CV whose facts you review and confirm, job
discovery from public feeds, AI match assessment against your confirmed facts, draft application
text, and an application tracker.

It runs entirely on Cloudflare: a static Pages app (`frontend/`), one Worker API (`worker/`), D1
(SQL), a private R2 bucket (CV files) and Workers AI. It is separate from the NISCO website and the
`nisco-ai/` Worker in this repository and shares no code or resources with them.

**The app never submits applications or contacts employers.** You review everything and apply
yourself; the tracker records what you did.

## Status (Phase 2)

| Area | State |
| --- | --- |
| Master CV: upload, versions (one active), download, delete with typed confirmation | Working, tested (Phase 2) |
| CV text extraction in the browser (PDF via vendored pdf.js, DOCX), no OCR | Working, tested (Phase 2) |
| Structured profile: proposals with provenance, confirm/edit/reject, missing sections, export, delete | Working, tested (Phase 2) |
| Original Phase 1 profile notes | Preserved word for word, with snapshots; reviewable as proposals |
| Manual jobs, match assessment, drafts, tracker | Working; use **confirmed facts only** since Phase 2 |
| Scheduled discovery (Arbeitnow, Remote OK) | Working; Saudi Arabia/India coverage is limited by these free feeds. The exact-location allowlist correction is **deferred**: location filtering is not fully validated |
| Private file uploads (`/api/files`) | Working, unchanged (PDF/DOCX only, 8 MB) |
| ATS CV generation, job-portal connectors | Not built yet (later phases) |
| Approval records and a "submitted" status | Not built yet; "submitted" is refused until they exist |
| Cloudflare Access sign-in | Designed and implemented in the Worker, **not enabled** (see `docs/ACCESS.md`) |

## Layout

```
career-ai/
  frontend/            Static Pages app: index.html, app.js (ES module), styles.css, config.js, _headers
    js/                Browser modules: API client, master CV, profile facts, PDF/DOCX extraction
    vendor/pdfjs/      pdf.js 6.4.299 (Apache-2.0), byte-identical to the npm package (manifest.json)
  e2e/                 Browser tests: journeys (Playwright), unit/ (node --test), synthetic file
                       generator (fixtures/), local Worker and static server (scripts/)
  worker/              Worker API (TypeScript)
    src/
      index.ts         Entry: fetch (HTTP API) and scheduled (discovery)
      app.ts           Route table and request pipeline
      auth/            Session tokens, Cloudflare Access JWT, rate limiting, constant-time compare
      http/            Router, JSON body reading, validation, errors, CORS, response headers
      domain/          Profile rules, URL safety, statuses, HTML-to-text
      ai/              Workers AI client, prompts (with fencing), response parsing, matching
      db/              D1 queries, one module per table
      discovery/       Feed adapters, role/location filters, the bounded discovery run
      files/           File type detection, file-name sanitising, shared upload/download service
      profile/         Phase 2: section schema, fixed-rule CV structuring, confirmed-only profile
      routes/          HTTP handlers
    migrations/        D1 schema (0001 original, 0002 Phase 1, 0003 Phase 2)
    scripts/           migration-0003-drill.sh (local apply/rollback rehearsal)
    test/              Vitest suites run inside workerd with local D1/R2
  scripts/             Repository hygiene check used by CI
  docs/                HANDOVER, ARCHITECTURE, DATA-MODEL, DEPLOYMENT, ACCESS, TESTING
```

## Develop

Requirements: Node.js 22. All tools are pinned in `worker/package-lock.json` and
`e2e/package-lock.json`.

```bash
cd career-ai/worker
npm ci
npm run check          # strict typecheck + all Worker tests (local D1/R2, Workers AI stubbed)

cd ../e2e
npm ci
npx playwright install --with-deps chromium   # once per machine
npm run test:unit      # browser-module unit tests (DOCX parser, PDF text, extraction outcomes)
npm run vendor:verify  # vendored pdf.js matches the pinned package
npm test               # both browser journeys (51 checks) against an isolated local Worker
```

`docs/TESTING.md` lists every command, what each suite covers and the latest results.

To click through the app locally, use the same isolated setup the browser journey uses. Nothing is
edited and nothing reaches Cloudflare:

```bash
cd career-ai/e2e
node scripts/start-worker.js      # terminal 1: Worker on http://127.0.0.1:8799, fresh local D1/R2
node scripts/serve-frontend.js    # terminal 2: app on http://127.0.0.1:4174 with production headers
```

Open http://127.0.0.1:4174 and sign in with the synthetic `ACCESS_KEY` from `e2e/e2e.config.js`.
For CV files to upload, run `node scripts/make-synthetic-cv.js /tmp/synthetic-cv` (it refuses to
write inside the repository).
The local Worker has no Workers AI binding, so assessments and drafts show their failure states. Data
is discarded when the Worker stops.

## Documentation

- `docs/HANDOVER.md` - start here: status, first hour, code map, invariants, common changes, known limitations
- `docs/ARCHITECTURE.md` - components, data model, request pipeline, master CV flow, matching and discovery
- `docs/DATA-MODEL.md` - CV versions, profile facts, snapshots: statuses, provenance, lifecycle, deletion, export
- `docs/DEPLOYMENT.md` - how deployment works, secrets, manual GitHub/Cloudflare steps, Phase 2 rollout and rollback
- `docs/ACCESS.md` - Cloudflare Access design and the exact steps to enable it
- `docs/TESTING.md` - exact test commands, latest results, audit-probe coverage, browser journey isolation and failure evidence

## Rules for contributors

- Never commit CVs, personal records, real candidate data, keys or tokens. CI blocks document files
  and credential-like strings under `career-ai/` (`scripts/check-repo-hygiene.sh`).
- Test fixtures are synthetic and generated at test time; email addresses must use reserved example
  domains (enforced by the hygiene check).
- Matching, drafts and discovery use confirmed facts only. CV structuring copies text; it never
  generates values. AI output may only rephrase or reorder confirmed facts. Never add logic that invents
  experience, qualifications, dates or metrics, and never add automated submission to job sites.
