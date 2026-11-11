# NISCO AI — Baseline Architecture (Pre-upgrade)

## Repository components
- `assets/nisco-chat.js`: browser chat widget; sends up to 24 messages to `/chat`; session history is held in browser memory.
- `nisco-ai/src/index.js`: Cloudflare Worker entry point, business prompt, lead capture, website enquiry, admin UI/routes, scheduled retention cleanup and routing.
- `nisco-ai/src/mcp.js`: authenticated MCP tools for enquiry listing, retrieval, status updates, deletion and dashboard counts.
- `nisco-ai/wrangler.toml`: Worker name, allowed origin, D1/AI bindings, rate-limiters, observability and cron.
- `nisco-ai/migrations/`: D1 schema migrations.
- `nisco-ai/README.md`: existing setup and deployment guide.
- `tests/site.test.js`: website regression tests.
- `.github/workflows/deploy-nisco-ai.yml`: Worker tests and production deployment workflow.

## Existing bindings and service configuration
- Worker: `nisco-ai`
- Workers AI binding: `AI`
- Model configured in code: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- D1 binding: `DB`
- D1 database name: `nisco-ai-leads`
- Public chat endpoint: `/chat` on the configured Worker origin
- Website enquiry endpoint: `/enquiry`
- Admin routes: `/admin` and `/admin/*`
- MCP endpoint: `/mcp`
- Scheduled retention cleanup: daily cron configured in Wrangler.

## Existing business and privacy behaviour
- Approved indicative India prices are embedded in the system prompt and deterministic price replies.
- Chat lead capture requires a contact method, service, summary and explicit consent.
- Website enquiry submission uses a separate form flow and Brevo email configuration.
- Chat-captured leads are stored in D1; current README states they do not trigger automatic email/WhatsApp notifications.
- Admin and MCP operations use configured secrets; never expose these to the browser or repository.
- The current public contact email is `nisco.in@outlook.com`.

## Compatibility requirements
The upgrade must preserve endpoint contracts and the existing website widget's ability to communicate with the Worker. Any changes to request/response shapes must remain backward-compatible until the frontend and Worker are released together. Existing lead consent and data-retention protections must not be weakened.

## Verification gaps to close in Stage 0
- Inventory every migration and table before adding schema changes.
- Review the complete Worker routing and AI tool-call implementation.
- Confirm all workflow triggers and branch protections.
- Establish baseline test execution and a local test harness for Worker routes.
- Confirm current Cloudflare plan quotas and actual account usage before enabling new workloads.
