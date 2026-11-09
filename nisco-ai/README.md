# NISCO AI — Website Business Assistant

NISCO AI is the website assistant for NISCO's India service launch. The static website is deployed through Cloudflare Pages; the assistant backend is deployed separately as a Cloudflare Worker.

## Current capabilities
- Explains NISCO's India services: business websites, automation, AI chatbots, digital marketing and ongoing support.
- Gives approved INR starting prices only:
  - Business website: ₹15,000 onwards
  - Business automation: ₹15,000 onwards
  - AI chatbot: ₹10,000 onwards
  - Website maintenance: ₹2,000/month onwards
  - Automation support: ₹3,000/month onwards
- Answers common location and contact questions (Chennai; Catchnoor@live.in; email nisco.in@outlook.com).
- Provides guided qualification for website, automation, AI chatbot, digital marketing, website maintenance and automation support enquiries.
- Stores an enquiry in Cloudflare D1 only after a contact method is supplied and the visitor explicitly consents.
- Does not send WhatsApp or email notifications, make promises, or submit a quotation.

Prices are indicative starting prices, not fixed quotations. Scope, integrations, licences, hosting, taxes and third-party costs must be confirmed in writing.

## Architecture
Website chat widget (assets/nisco-chat.js) → Cloudflare Worker (src/index.js) → Cloudflare Workers AI → Cloudflare D1 (leads).

The deployed Worker uses the Cloudflare Workers AI binding and the model @cf/meta/llama-3.3-70b-instruct-fp8-fast. It does not require an OpenAI API key. The D1 binding is configured in wrangler.toml.

## Deployment
The GitHub Actions workflow .github/workflows/deploy-nisco-ai.yml runs the Node regression tests first. If they pass, it applies pending D1 migrations and deploys the Worker.

Required GitHub Actions secrets:
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID

Never commit secrets or put them in browser JavaScript.

## Configuration
- Worker name: nisco-ai
- Endpoint: https://nisco-ai.speedhome7852.workers.dev/chat
- Allowed website origin: https://nisco-website.pages.dev
- D1 database: nisco-ai-leads
- D1 schema: migrations/0001_create_leads.sql

If the website is moved to a different domain, update ALLOWED_ORIGIN in wrangler.toml and redeploy the Worker. The frontend's public API_URL must match the deployed Worker endpoint.

## Local development and tests
From this directory:
```bash
npm test
npx wrangler dev
```

The tests use mocked Workers AI and D1 bindings; they do not contact production services or write real leads.

## Lead privacy and handling
- A lead is stored only after a visitor provides an email or phone number and explicitly agrees to share the enquiry with NISCO.
- Declining consent must not create a database record.
- The visitor is told when an enquiry is successfully saved; failed writes must never be described as successful.
- No automated email or WhatsApp notification is configured.
- Before collecting real visitor data, publish a privacy notice covering purpose, access, retention/deletion and contact rights. Restrict D1 access to authorised operators.

## Release verification
After a successful GitHub Actions deployment:
1. Confirm the Worker deployment job completed successfully.
2. Open the live website and test the chatbot on mobile and desktop.
3. Test price answers for website, automation, AI chatbot and monthly support.
4. Test each guided enquiry path.
5. Verify a lead is not stored before consent and is stored after consent.
6. Confirm the chatbot does not claim that an email or WhatsApp notification was sent.
