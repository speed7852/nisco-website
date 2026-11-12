# Deployment

Career AI deploys from the `career-ai-deploy` branch only. The website (`main`) and the `nisco-ai/`
Worker have their own workflows and are not affected.

## How a deployment runs

`.github/workflows/deploy-career-ai.yml` starts on a push to `career-ai-deploy` that touches
`career-ai/**` or the Career AI workflows, or by manual dispatch.

1. **Checks** (`test-career-ai.yml`), two jobs that must both pass, or nothing is deployed:
   - *Typecheck and tests*: `npm ci`, strict typecheck, all Worker tests, frontend syntax, the
     repository hygiene check and `npm audit --audit-level=high`;
   - *Browser journey*: browser-module unit tests, the pdf.js integrity check
     (`vendor:verify`), then both Playwright journeys (26 + 25 checks) against the real Worker on
     `wrangler dev --local` (fresh local D1/R2, no Workers AI binding, no credentials) with the
     production headers from `frontend/_headers`. See `TESTING.md`.
2. **Deploy** (only on `refs/heads/career-ai-deploy`, in the `career-ai-production` environment):
   1. check the three secrets exist;
   2. look up the D1 database `nisco-career-ai-db` by name (stops if not exactly one; never creates);
   3. check the R2 bucket `nisco-career-ai-private` exists (stops if missing; never creates);
   4. **read-only privacy check**: stops unless `wrangler r2 bucket dev-url get` prints exactly
      `Public access via the r2.dev URL is disabled.` and `wrangler r2 bucket domain list` prints
      exactly `There are no custom domains connected to this bucket.` (Wrangler's own messages in the
      pinned version; any other output, including an API error, stops the run and changes nothing);
   5. **read-only restore point**: records the D1 Time Travel bookmark (`wrangler d1 time-travel
      info --json`) in the log and the job summary, and lists pending migrations; stops if no
      bookmark can be read;
   6. apply pending D1 migrations (`--remote`);
   7. deploy the Worker with the Wrangler version pinned in `worker/package-lock.json`;
   8. set the Worker secret `APP_ACCESS_KEY` from `CAREER_AI_ACCESS_KEY`;
   9. deploy `frontend/` to Pages as branch `career-ai-deploy`.

Deployments queue and are never cancelled midway. Pull requests into `career-ai-deploy` run only the
checks; they cannot deploy.

## Required GitHub Actions secrets

| Secret | Used for |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Wrangler (Workers, D1 including Time Travel info, R2 read including bucket public-access settings, Pages). If the token cannot read the R2 settings or the D1 bookmark, the deployment stops before any change. |
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
5. **Cloudflare Access.** Optional and not enabled. Follow `ACCESS.md`, and set
   `ACCESS_ALLOWED_EMAILS` to the owner's email first: the CV and profile routes refuse to work in
   Access mode without it.
6. **R2 public access (check once in the dashboard).** R2 > `nisco-career-ai-private` > Settings:
   *Public Development URL* disabled and no *Custom Domains*. The deploy re-checks this read-only on
   every run, but never changes it.

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

## What the first deployment after Phase 2 changes in production

- Migration `0003_phase2_cv_profile.sql` runs on the live database. It **only adds**: three tables,
  their indexes and triggers, one snapshot of the current profile row, and one *proposed* fact per
  non-empty profile field, copied word for word. The `profile`, `documents`, `jobs` and
  `applications` rows are not modified. `scripts/migration-0003-drill.sh` proves this locally.
- **Matching and drafts stop working until facts are confirmed.** They now use confirmed facts only,
  and nothing is confirmed by the migration. The scheduled discovery keeps collecting jobs but does
  not assess them until then (its summary says `skippedReason: "no_profile"`).
- The Pages app becomes ES modules plus `vendor/pdfjs` (about 1.7 MB, loaded only when a PDF is read),
  and the CSP gains `worker-src 'self'` for pdf.js's Web Worker.
- New R2 keys appear under `private/cv/<version>/extracted.txt`. CV originals keep using
  `private/uploads/`.

### After that deployment

1. Sign in. Career profile > *Facts awaiting your review* lists your existing profile values as
   proposals "From your original profile notes". Confirm, edit or reject each one. Matching works
   again once headline, summary, skills or experience is confirmed.
2. Upload your master CV under *Master CV* (or choose an earlier upload there), review its proposals,
   and press *Make active*.
3. Use *Export my profile data* once and keep the file somewhere private; it is your own backup of
   the structured profile.

## Rolling back migration 0003

0003 is additive, so **rolling back the code without touching the database is safe** and is the
recommended first response: roll back the Worker (`npx wrangler rollback`) **and** Pages together
(the Phase 2 page calls endpoints the Phase 1 Worker does not have). The Phase 1 Worker ignores the
new tables and keeps reading the untouched `profile` row. One difference: deleting a file that
belongs to a CV version fails (the `cv_versions` foreign key refuses it), which protects that file.

To remove the Phase 2 data as well (only with an explicit decision, because facts confirmed after the
deployment are lost):

1. Export first: *Export my profile data* in the app (or `GET /api/profile/export`).
2. Find the bookmark recorded by the deploy run (job summary: *D1 restore point before
   migrations*), or choose one: `npx wrangler d1 time-travel info nisco-career-ai-db
   --timestamp=<before the deployment>`.
3. Restore: `npx wrangler d1 time-travel restore nisco-career-ai-db --bookmark=<bookmark>`.
   D1 Time Travel keeps 7 days of history on the Workers Free plan (30 on Paid), so act within a
   week. The restore reports the bookmark from just before it, so it can be undone the same way.
4. Roll back the Worker (`npx wrangler rollback`) and Pages (dashboard) to the Phase 1 deployments.
5. R2 objects under `private/cv/` and CV files uploaded after the deployment stay in the bucket
   without a database record. Phase 1's *Find earlier uploads* registers stray `private/uploads/`
   files; delete `private/cv/` objects in the R2 dashboard if wanted.

`scripts/migration-0003-drill.sh` rehearses the same sequence locally (backup, apply, verify,
restore, verify, re-apply) on synthetic data.

## Rollback

- **Worker:** `npx wrangler rollback` from `career-ai/worker` (or Workers & Pages > Deployments).
- **Pages:** Workers & Pages > nisco-career-ai > Deployments > roll back to the previous deployment.
- **D1 (0003):** see "Rolling back migration 0003" above.
- **D1 (0002):** migration 0002 is additive, so the old Worker keeps working against the new schema with two
  differences: it can no longer create a second application for the same job, or save an application
  status outside the allow-list. Do not delete the added columns; there is no down-migration.

## Rotating the access key

Change the GitHub secret `CAREER_AI_ACCESS_KEY` and redeploy, or run
`npx wrangler secret put APP_ACCESS_KEY` in `career-ai/worker`. All sessions end immediately.
