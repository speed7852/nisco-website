# NISCO Career AI — Phase 0 and Phase 1 implementation brief

Status: approved for implementation on `career-ai-phase-0-1` only.
Target integration branch: `career-ai-deploy`.
Production deployment: **NOT APPROVED**. Do not merge, dispatch workflows, deploy Worker/Pages, apply production migrations, or change Cloudflare resources.

## Confirmed product decisions

- Keep the existing Cloudflare architecture: Pages, Workers, D1, private R2, Workers AI.
- Start on Cloudflare Free. Do not enable paid services or incur provider/API charges without approval.
- Evaluate free and permitted job feeds first; paid job APIs only after documenting coverage gaps and cost for approval.
- Keep the current repository for now. Do not change repository visibility.
- Preserve the existing website and `nisco-ai/` completely.
- The user personally reviews and submits every job application. The app must never submit applications to third-party sites.
- Work only under `career-ai/` and the Career AI workflow/docs as needed. Do not commit CVs, personal records, secrets, tokens, or real candidate data.

## Working rules

1. Make changes only on this feature branch. Never push to `main` or `career-ai-deploy`.
2. Do not merge the feature branch or trigger any deployment. The current workflow deploys on pushes to `career-ai-deploy`; avoid that branch.
3. Before changing deployment configuration, inspect the current workflow and explain any production implications in the PR.
4. Use pinned dependency versions. Do not add paid services or new external dependencies without justification.
5. Use synthetic fixtures only. Add regression tests for every reproduced audit probe.
6. Keep implementation modular, readable, documented, and independently maintainable.
7. Do not claim production configuration (Cloudflare Access, observability, rate limits, GitHub Environment approvals) is active unless it has actually been configured and verified.

## Phase 0 — Guardrails

### 0.1 CI and deployment safety
- Add Career AI typecheck and automated test jobs to CI.
- Ensure tests run on pull requests targeting `career-ai-deploy`.
- Ensure deployment cannot run from feature branches or before checks pass.
- Pin Wrangler and all newly introduced dependencies.
- Remove unsafe deploy cancellation behaviour where it can interrupt a migration/deploy sequence.
- Do not change the live workflow in a way that causes a production deployment during this work.
- Document the required GitHub Environment approval gate. Do not create or alter repository/environment settings without explicit access and verification.

### 0.2 Access security
- Prepare a Cloudflare Access design for both Pages and Worker API, including Worker-side JWT validation (issuer, audience, signature/JWKS, expiry).
- Add rate limiting as a second layer and constant-time comparison for any retained app secret.
- Do not assume Access is already enabled. If configuration requires dashboard actions, document exact steps and leave production untouched.
- Avoid storing a long-lived access key in browser storage if a secure Access-backed session can be used.
- Add appropriate security headers and restrict CORS to the exact deployed app origin(s), not arbitrary preview subdomains.
- Do not expose sensitive authentication configuration through health endpoints.

## Phase 1 — Restructure and fix

### 1.1 Engineering foundation
- Split the minified/single-line Worker into small modules with clear responsibilities.
- Add `package.json`, strict `tsconfig.json`, pinned Wrangler, Vitest and Cloudflare Workers test-pool configuration compatible with the current runtime.
- Keep existing site and NISCO AI test suites passing.
- Add a reproducible local test command and CI command.

### 1.2 Request validation and error handling
- Validate every request body and route parameter.
- Malformed JSON and invalid fields return 400 with safe field-level errors.
- Unknown records return 404.
- Never return generic 500 for ordinary user input errors.
- Validate profile shape; reject arbitrary JSON primitives.

### 1.3 AI match score safety
- Accept valid model output as JSON, fenced JSON, preambled JSON, or supported object response.
- Validate schema and clamp accepted scores to 0–100.
- On malformed output, timeout, or inference failure, mark assessment for review and preserve the previous good score. Never replace a valid score with zero because parsing failed.
- Prevent job-posting text from acting as instructions: clearly fence it as untrusted data in prompts.
- Do not shortlist on invalid or unverified scores. Boundary: 79 is not shortlisted; 80 is.
- Keep the score calculation explainable and do not fabricate candidate qualifications.

### 1.4 Job URL and deduplication safety
- Accept HTTPS job URLs only; reject `javascript:`, `data:`, and other unsafe schemes.
- Canonicalise common tracking parameters and normalise URLs.
- Reject duplicate manual additions and duplicate tracking records.
- Add an appropriate database uniqueness constraint only with a migration tested against a copy of the existing schema.

### 1.5 Application tracker correctness
- Implement partial updates: omitted fields must remain unchanged.
- Validate status against a documented allow-list.
- Return 404 for unknown application IDs.
- Enforce at most one application per job.
- Do not permit a status of submitted unless a valid user approval record exists. If approval records are not yet implemented in Phase 1, keep submitted transition unavailable rather than faking approval.
- Never send applications to employers or third-party job sites.

### 1.6 Upload validation
- Enforce the 8 MB limit by counting streamed bytes, not trusting Content-Length.
- Accept only supported PDF and DOCX files; verify file signatures and reject spoofed MIME types/extensions.
- Handle malformed filename headers safely.
- Keep uploads private. Do not claim CV extraction or document-library functionality until implemented in later phases.

### 1.7 Retry-safe discovery scoring
- Ensure jobs saved without a score remain eligible for retry on subsequent runs, with bounded retry attempts.
- Read the saved profile once per run; strip HTML and truncate untrusted descriptions; cap AI calls per run.
- Record safe structured logs and outcomes. Do not execute a production cron or invoke production feeds as part of tests.

## Required regression tests

Cover the audit probes P05–P24 and S01–S04 where applicable, especially:
- malformed JSON/profile shape;
- unsafe and duplicate URLs;
- clean, fenced, preambled, object, out-of-range and garbage AI outputs;
- preserve prior score on inference/parse failure;
- unknown job/application IDs;
- duplicate applications;
- notes-only updates preserve status;
- invalid status rejected;
- upload over 8 MB rejected with and without Content-Length;
- invalid content type/signature rejected;
- malformed filename safely rejected;
- failed discovery scores retried;
- remote roles restricted to other countries excluded;
- tracking URL variants deduplicated;
- untrusted feed text fenced;
- per-run D1/AI work bounded.

Use local D1/R2 and stubbed Workers AI. No real CV or personal data in fixtures.

## Acceptance gate before asking for review

- All Career AI tests pass.
- Existing website and NISCO AI tests pass unchanged.
- Typecheck passes with meaningful types (avoid blanket `any`).
- No secrets or personal documents in the diff.
- No changes outside the approved Career AI scope.
- No production deployment, migration, cron invocation, or Cloudflare resource change.
- Provide a concise report: files changed, tests/commands and results, known limitations, dashboard steps still required, and exact production risks.

## Completion workflow

Open a pull request from `career-ai-phase-0-1` into `career-ai-deploy` as **draft**. Do not merge it. Request independent review before any production approval.
