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

Requirements: Node.js 22. All tools are pinned in `worker/package-lock.json`.

```bash
cd career-ai/worker
npm ci
npm run check          # strict typecheck + all tests (local D1/R2, Workers AI stubbed)
```

To run the API locally against a local database:

```bash
cd career-ai/worker
npx wrangler d1 migrations apply nisco-career-ai-db --local
cat > .dev.vars <<'EOF'       # git-ignored; synthetic values only
APP_ACCESS_KEY=local-dev-key-change-me
ALLOWED_ORIGINS=http://127.0.0.1:4173
EOF
npx wrangler dev --local --port 8799
```

Then serve `career-ai/frontend` on port 4173 (for example `python3 -m http.server 4173`) with
`config.js` temporarily pointing `apiBase` at `http://127.0.0.1:8799`. Do not commit that change.
Workers AI is not available in local mode, so assessments and drafts show their failure states.

## Documentation

- `docs/ARCHITECTURE.md` - components, data model, request pipeline, matching and discovery
- `docs/DEPLOYMENT.md` - how deployment works, secrets, manual GitHub/Cloudflare steps, rollback
- `docs/ACCESS.md` - Cloudflare Access design and the exact steps to enable it
- `docs/TESTING.md` - what the tests cover and how they map to the engineering audit

## Rules for contributors

- Never commit CVs, personal records, real candidate data, keys or tokens. CI blocks document files
  and credential-like strings under `career-ai/` (`scripts/check-repo-hygiene.sh`).
- Test fixtures are synthetic.
- AI output may only rephrase or reorder facts from the saved profile. Never add logic that invents
  experience, qualifications, dates or metrics, and never add automated submission to job sites.
