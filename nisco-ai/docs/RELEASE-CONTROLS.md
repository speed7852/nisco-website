# NISCO AI — Release Controls and Rollback

## Branch policy
All enterprise work is committed to `feature/nisco-ai-enterprise`. Do not push feature work directly to `main`. Changes should be reviewed through a pull request after tests and documentation are complete.

## Production protection
- A feature-branch push must never deploy the production Worker.
- D1 remote migrations must never run from feature-branch CI.
- Production deployment must require a main-branch release and an explicit human approval step.
- The release operator must verify the commit SHA, test results, migration diff, configured secrets and target Cloudflare account before release.
- Do not run `wrangler deploy`, `wrangler d1 migrations apply --remote`, or a production workflow during feature development.

## Release checklist
1. Review all code and documentation changes.
2. Run Worker unit/integration tests and website regression tests.
3. Review Arabic RTL, English, mobile and desktop behaviour.
4. Review security, privacy, cost and dependency changes.
5. Inspect migration SQL and backup/restore options.
6. Confirm production secrets and bindings without printing their values.
7. Obtain explicit production release approval.
8. Deploy Worker and website in a coordinated, documented sequence.
9. Verify live health, chat, lead consent, enquiry form, admin and rollback readiness.

## Rollback
- Keep the last known-good production commit and Worker version identifiable.
- Prefer Cloudflare Worker version rollback for code-only failures where supported.
- Do not assume a database migration can be reversed automatically. Use additive migrations and a tested forward-fix or documented restore procedure.
- If a release fails, stop further changes, preserve logs without exposing secrets or customer data, restore the previous Worker version where safe, and report the incident and recovery status.
