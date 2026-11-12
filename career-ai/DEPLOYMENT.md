# NISCO Career AI — deployment setup

This project is intentionally isolated on the `career-ai-deploy` branch. The existing NISCO website and `nisco-ai/` Worker are not modified by this deployment workflow.

## GitHub Actions secrets

Add these repository Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Never commit either value to the repository or paste either value into chat.

## Cloudflare resources required before first deployment

Create a Pages project named `nisco-career-ai` in the same Cloudflare account. The workflow deploys the static frontend to that project.

The Worker configuration is in `worker/wrangler.toml`. The Worker is deployed separately from the existing `nisco-ai` Worker.

## API token permissions

For the first deployment, create a custom account API token scoped to the relevant Cloudflare account with:

- Workers product: Admin (needed to create the new Worker on first deploy; reduce to Editor after the Worker exists, if your token setup supports resource-scoped access)
- Cloudflare Pages: Write

If later provisioning D1 or R2 resources through this pipeline, add D1 and R2 permissions only when needed. The current deployment workflow does not create or modify D1 databases or R2 buckets.

## Run deployment

After the secrets and Pages project exist, open GitHub → Actions → **Deploy NISCO Career AI** → **Run workflow** on branch `career-ai-deploy`.

The workflow deploys only the Career AI Worker and Pages project. It does not run the existing NISCO AI deployment workflow.

## Current status

This is deployment plumbing, not a claim that the full Career AI product is production-ready. Authentication, D1/R2 persistence, job discovery, CV processing, and approval-gated application features must be implemented and tested before using it with personal data.
