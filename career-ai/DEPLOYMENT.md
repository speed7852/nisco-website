# NISCO Career AI — Cloudflare setup
Isolated on branch `career-ai-deploy`; existing website and `nisco-ai/` Worker are not modified.

## Cloudflare resources
Workers AI binding `AI`; D1 database `nisco-career-ai-db`; R2 bucket auto-provisioned with Worker prefix; cron at 03:00 and 15:00 UTC.
Wrangler can auto-provision D1/R2 bindings on deploy; verify generated resources in Cloudflare dashboard.

## Required before private use
Set Worker secret `APP_ACCESS_KEY` to a long random value using Cloudflare dashboard or Wrangler. Do not commit it. The current API rejects private requests until configured.
Apply `migrations/0001_init.sql` to the D1 database.

## API
Bearer authentication required except `/health`.
GET/PUT `/api/profile`; GET/POST `/api/jobs`; POST `/api/jobs/match` (`jobId`); GET/POST `/api/applications`; POST `/api/ai/draft`; POST `/api/files` (R2 upload).
AI model: `@cf/meta/llama-3.1-8b-instruct`.

## Not yet production-complete
This commit adds API foundations, D1 schema and AI/R2 bindings. Job-source integrations are not configured; cron currently logs scheduled ticks only. The dashboard is still a static preview and is not yet wired to authenticated APIs. CV text extraction/import and private login UI remain to be completed. Do not upload CV or personal data until secret, bindings and access controls are verified.
