# NISCO Career AI

A private, single-user career workspace: a master career profile, job discovery from public feeds,
AI match assessment against the profile, draft application text, and an application tracker.

It runs entirely on Cloudflare: a static Pages app (`frontend/`), one Worker API (`worker/`), D1
(SQL), a private R2 bucket (CV files) and Workers AI. It is separate from the NISCO website and the
`nisco-ai/` Worker in this repository and shares no code or resources with them.

**The app never submits applications or contacts employers.** You review everything and apply
yourself; the tracker records what you did.

## Status (Phase 0 and Phase 1)

| Area | State |
| --- | --- |
| Profile, manual jobs, match assessment, drafts, tracker | Working, validated, tested |
| Scheduled discovery (Arbeitnow, Remote OK) | Working; Saudi Arabia/India coverage is limited by these free feeds |
| CV upload, list, download, delete | Working (PDF/DOCX only, 8 MB) |
| CV text extraction, versioned document library, ATS CV files | Not built yet (later phases) |
| Approval records and a "submitted" status | Not built yet; "submitted" is refused until they exist |
| Cloudflare Access sign-in | Designed and implemented in the Worker, **not enabled** (see `docs/ACCESS.md`) |

## Layout

```
career-ai/
  frontend/            Static Pages app: index.html, app.js, styles.css, config.js, _headers
  e2e/                 Browser journey (Playwright) against an isolated local Worker
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
      files/           File type detection and file-name sanitising
      routes/          HTTP handlers
    migrations/        D1 schema (0001 original, 0002 Phase 1)
    test/              Vitest suites run inside workerd with local D1/R2
  scripts/             Repository hygiene check used by CI
  docs/                ARCHITECTURE, DEPLOYMENT, ACCESS, TESTING
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
npm test               # 25-check browser journey against an isolated local Worker
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
The local Worker has no Workers AI binding, so assessments and drafts show their failure states. Data
is discarded when the Worker stops.

## Documentation

- `docs/ARCHITECTURE.md` - components, data model, request pipeline, matching and discovery
- `docs/DEPLOYMENT.md` - how deployment works, secrets, manual GitHub/Cloudflare steps, rollback
- `docs/ACCESS.md` - Cloudflare Access design and the exact steps to enable it
- `docs/TESTING.md` - exact test commands, latest results, audit-probe coverage, browser journey isolation and failure evidence

## Rules for contributors

- Never commit CVs, personal records, real candidate data, keys or tokens. CI blocks document files
  and credential-like strings under `career-ai/` (`scripts/check-repo-hygiene.sh`).
- Test fixtures are synthetic.
- AI output may only rephrase or reorder facts from the saved profile. Never add logic that invents
  experience, qualifications, dates or metrics, and never add automated submission to job sites.
