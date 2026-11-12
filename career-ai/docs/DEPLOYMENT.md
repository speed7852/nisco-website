# Deployment

Career AI deploys from the `career-ai-deploy` branch only. The website (`main`) and the `nisco-ai/`
Worker have their own workflows and are not affected.

## How a deployment runs

`.github/workflows/deploy-career-ai.yml` starts on a push to `career-ai-deploy` that touches
`career-ai/**` or the Career AI workflows, or by manual dispatch.

1. **Checks** (`test-career-ai.yml`), two jobs that must both pass, or nothing is deployed:
   - *Typecheck and tests*: `npm ci`, strict typecheck, all Worker tests, frontend syntax, the
     repository hygiene check and `npm audit --audit-level=high`;
   - *Browser journey*: the 25-check Playwright journey against the real Worker on
     `wrangler dev --local` (fresh local D1/R2, no Workers AI binding, no credentials) with the
     production headers from `frontend/_headers`. See `TESTING.md`.
2. **Deploy** (only on `refs/heads/career-ai-deploy`, in the `career-ai-production` environment):
   1. check the three secrets exist;
   2. look up the D1 database `nisco-career-ai-db` by name (stops if not exactly one; never creates);
   3. check the R2 bucket `nisco-career-ai-private` exists (stops if missing; never creates);
   4. apply pending D1 migrations (`--remote`);
   5. deploy the Worker with the Wrangler version pinned in `worker/package-lock.json`;
   6. set the Worker secret `APP_ACCESS_KEY` from `CAREER_AI_ACCESS_KEY`;
   7. deploy `frontend/` to Pages as branch `career-ai-deploy`.

Deployments queue and are never cancelled midway. Pull requests into `career-ai-deploy` run only the
checks; they cannot deploy.

## Required GitHub Actions secrets

| Secret | Used for |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Wrangler (Workers, D1, R2 read, Pages) |
| `CLOUDFLARE_ACCOUNT_ID` | Wrangler |
| `CAREER_AI_ACCESS_KEY` | The private access key, set as the Worker secret `APP_ACCESS_KEY`. Use a long random value (at least 32 characters). |

## Manual steps that cannot be done from code

These are **not configured by this repository**. Do them in the GitHub and Cloudflare dashboards.

1. **GitHub Environment approval (before merging Phase 0/1).** Settings > Environments > New
   environment `career-ai-production`. Add yourself under *Required reviewers*. Under *Deployment
   branches and tags*, choose *Selected branches* and add `career-ai-deploy`. If the environment does
   not exist when the workflow first runs, GitHub creates it **without** protection and the
   deployment proceeds without approval.
2. **Branch protection (recommended).** Protect `career-ai-deploy`: require a pull request and the
   status checks *Typecheck and tests* and *Browser journey (local Worker, production headers)*.
3. **Commit the D1 database ID (recommended).** The deploy log prints `Using D1 database <id>`. Add
   `database_id = "<id>"` under `database_name` in `worker/wrangler.toml` and delete the lookup step.
   The ID is an identifier, not a secret (`nisco-ai/wrangler.toml` already commits its own).
4. **Observability.** `[observability] enabled = true` takes effect on the next deployment. Confirm in
   Workers & Pages > nisco-career-ai-api > Logs that entries appear.
5. **Cloudflare Access.** Optional and not enabled. Follow `ACCESS.md`.

## What the first deployment after Phase 0/1 changes in production

- Migration `0002_phase1_integrity.sql` runs on the live database. It only adds columns, indexes,
  triggers and two tables. Existing scores become `legacy_unverified` and are re-assessed by the next
  discovery run. Duplicate applications for the same job are archived (kept, hidden), not deleted.
- The new Worker replaces the old API. For the minute between the Worker and Pages steps, the old
  page cannot talk to the new API; reload after the deployment finishes.
- Sign-in changes: the access key is exchanged for an 8-hour session. Everyone must sign in again.
  The old page's stored key (`careerKey` in session storage) is removed by the new page.
- CORS now allows only `https://nisco-career-ai.pages.dev` and
  `https://career-ai-deploy.nisco-career-ai.pages.dev`. Per-deployment hash URLs
  (`https://<hash>.nisco-career-ai.pages.dev`) can load the page but cannot call the API.
- Two Workers Rate Limiting namespaces are created (`2026111201`, `2026111202`).
- The Pages app sends a strict CSP and other security headers from `frontend/_headers`.

### After that deployment

1. Open the app and sign in.
2. Profile tab > **Find earlier uploads**, to register CV files uploaded before Phase 1 (they were
   stored without a database record). Delete any you no longer want.
3. After the next scheduled run (03:00 or 15:00 UTC), check the *Last discovery* label on the Jobs tab
   or `GET /api/discovery/runs`.

## Rollback

- **Worker:** `npx wrangler rollback` from `career-ai/worker` (or Workers & Pages > Deployments).
- **Pages:** Workers & Pages > nisco-career-ai > Deployments > roll back to the previous deployment.
- **D1:** migration 0002 is additive, so the old Worker keeps working against the new schema with two
  differences: it can no longer create a second application for the same job, or save an application
  status outside the allow-list. Do not delete the added columns; there is no down-migration.

## Rotating the access key

Change the GitHub secret `CAREER_AI_ACCESS_KEY` and redeploy, or run
`npx wrangler secret put APP_ACCESS_KEY` in `career-ai/worker`. All sessions end immediately.
