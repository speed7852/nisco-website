# NISCO AI — Website Business Assistant

NISCO AI is the guided business assistant embedded in the NISCO static website. The website is hosted separately on Cloudflare Pages; the assistant API runs as a Cloudflare Worker.

## Current capabilities

- Supports English, Tamil and Modern Standard Arabic responses; Arabic messages are rendered right-to-left in the website chat widget.
- Explains NISCO's services: digital solutions, AI and automation, consulting, cloud and integration, digital marketing, and selected business services.
- Gives approved India starting prices only:
  - Business website: ₹15,000 onwards
  - Business automation: ₹15,000 onwards
  - AI chatbot: ₹10,000 onwards
  - Website maintenance: ₹2,000/month onwards
  - Automation support: ₹3,000/month onwards
- Answers public location and contact questions: Chennai, India; nisco.in@outlook.com.
- Provides guided qualification for website, automation, AI chatbot, digital marketing, website maintenance and automation support.
- Stores chat enquiries in Cloudflare D1 only after a contact method is supplied and the visitor explicitly consents. English, Tamil and Arabic consent replies are recognised.
- Does not automatically send WhatsApp or email notifications for chatbot-captured leads.

Prices are indicative starting prices, not fixed quotations. Scope, integrations, licences, hosting, taxes and third-party costs must be confirmed in writing.

## Architecture

Website chat widget (assets/nisco-chat.js) → Cloudflare Worker (src/index.js) → Cloudflare Workers AI → Cloudflare D1 (leads and consent challenges).

The Worker uses the Workers AI binding with @cf/meta/llama-3.3-70b-instruct-fp8-fast. It does not require an OpenAI API key.

The separate website consultation form posts to the Worker's /enquiry endpoint. That route sends a transactional email through Brevo and stores the enquiry in D1 after successful email delivery.

## Deployment

The GitHub Actions workflow .github/workflows/deploy-nisco-ai.yml runs Worker regression tests, applies pending D1 migrations, and deploys the Worker.

Required GitHub Actions secrets:
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID

Required Worker secrets:
- BREVO_API_KEY
- ADMIN_API_TOKEN

Worker variable:
- BREVO_SENDER_EMAIL (verified Brevo sender, configured in wrangler.toml)

Never commit secrets or put them in browser JavaScript.

## Configuration

- Worker name: nisco-ai
- Chat endpoint: https://nisco-ai.speedhome7852.workers.dev/chat
- Website enquiry endpoint: https://nisco-ai.speedhome7852.workers.dev/enquiry
- Allowed website origin: https://nisco-website.pages.dev
- D1 database: nisco-ai-leads
- D1 schema and migrations: migrations/

If the website origin changes, update ALLOWED_ORIGIN in wrangler.toml and redeploy the Worker. The frontend chat endpoint in assets/nisco-chat.js and public Worker URL in assets/nisco-india-config.js must match the deployed Worker.

## Local development and tests

From this directory:

\`\`\`bash
npm test
npx wrangler dev
\`\`\`

Tests use mocked Workers AI and D1 bindings; they do not contact production services or write real leads.

## Lead privacy and handling

- A chat lead is stored only after a visitor provides an email or phone number and explicitly agrees to share the enquiry with NISCO.
- Declining consent must not create a lead record.
- The visitor is told when an enquiry is successfully saved; failed writes must never be described as successful.
- Website form enquiries require explicit consent and a valid email. Optional phone details are included in the notification and stored in D1.
- Website form notifications are sent to nisco.in@outlook.com through Brevo after sender verification and API-key configuration.
- Chatbot lead capture remains stored in D1 without automatic email or WhatsApp notification.
- Before collecting real visitor data, publish and maintain a privacy notice covering purpose, access, retention/deletion and contact rights. Restrict D1 access to authorised operators.

## Release verification

After a successful GitHub Actions deployment:

1. Confirm the Worker test and deployment jobs completed successfully.
2. Open the live website and test the chatbot on mobile and desktop.
3. Test approved price answers and all guided enquiry paths.
4. Verify that a chat lead is not stored before consent and is stored after consent.
5. Submit a controlled website form test with and without optional phone details.
6. Confirm the notification reaches the NISCO mailbox and the D1 record includes the submitted contact details.
7. Confirm the chatbot does not claim that an email or WhatsApp notification was sent.
