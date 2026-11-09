# NISCO AI — Agent Worker

This is the private backend for the NISCO website chat assistant. The static website is deployed through Cloudflare Pages; this Worker is deployed separately.

## Agent capabilities
- Understands visitor needs across NISCO's four service areas.
- Asks focused qualification questions and prepares enquiry briefs.
- Uses a controlled `capture_lead` tool to save an enquiry to Cloudflare D1.
- Saves a lead only after the visitor explicitly requests contact/submission and consents.
- Does not quote unapproved prices, promise delivery dates, or take external actions.

## Architecture
Browser chat widget → Cloudflare Worker → OpenAI Chat Completions tool-calling loop → Cloudflare D1 lead table.

The OpenAI API key is a Worker secret and is never exposed to browser JavaScript. The website widget contains only the public Worker URL.

## One-time Cloudflare setup
1. In Cloudflare, create a D1 database named `nisco-ai-leads`.
2. Copy its database ID into `wrangler.toml`, replacing `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID`.
3. From this `nisco-ai` folder, run `npx wrangler d1 migrations apply nisco-ai-leads --remote`.
4. Authenticate Wrangler with `npx wrangler login` if not already authenticated.
5. Add the OpenAI key as a secret: `npx wrangler secret put OPENAI_API_KEY`.
6. Deploy: `npx wrangler deploy`.
7. Copy the resulting `https://nisco-ai.<your-subdomain>.workers.dev` URL and update `API_URL` in `../assets/nisco-chat.js` to end in `/chat`.
8. Commit the widget URL change. Cloudflare Pages should then publish the updated site from GitHub.
9. If using a custom domain, update `ALLOWED_ORIGIN` in `wrangler.toml` to that exact origin and redeploy.

## Local development
Create `.dev.vars` in this folder (never commit it):
```dotenv
OPENAI_API_KEY=your-key-here
ALLOWED_ORIGIN=http://localhost:8788
```
For local D1, use Wrangler's local database workflow and apply the migration locally. Then run `npx wrangler dev`.

## Lead handling and privacy
Leads are stored in D1. Access the database only through authorised Cloudflare account users. Before launch, publish a privacy notice explaining what details are collected, why they are collected, retention and contact rights. Add a retention/deletion process and restrict access to the database. No automatic email or WhatsApp notification is configured in this first release.

## Verification checklist
- [ ] D1 database created and migration applied remotely.
- [ ] `OPENAI_API_KEY` added as a Worker secret.
- [ ] Worker deployed and `/chat` endpoint responds.
- [ ] Website `API_URL` points to the deployed Worker.
- [ ] Test all four service areas on desktop and mobile.
- [ ] Test that a lead is not saved without explicit consent.
- [ ] Test that a consented enquiry appears in D1.
- [ ] Add/confirm privacy notice before collecting real visitor data.

## Handover
The Worker entry point is `src/index.js`; the lead schema is in `migrations/0001_create_leads.sql`. Tool definitions, guardrails and business knowledge are near the top of the Worker file. Keep secrets out of GitHub and never place the OpenAI key in the website files.
