# NISCO Website

Premium, responsive corporate website for NISCO, using the approved luxury corporate technology direction: midnight navy, warm gold, cream sections, and the brand line **“Built to Rise. Driven to Grow.”**

## Current homepage

The current homepage is the premium India–Saudi Arabia corporate version. Its sections are:

1. Main navigation and city-skyline hero
2. Four service cards: Digital Solutions, AI & Automation, Consulting, and Cloud & Integration
3. Why NISCO / India–Saudi Arabia positioning
4. Capability strip (markets, end-to-end delivery, practical solutions)
5. Portfolio examples for Al Jawdah, Zafari Academy, and NISCO AI
6. NISCO approach
7. Consultation form and NISCO AI chat assistant

Portfolio descriptions deliberately distinguish delivered work from concepts and in-house demonstrations. Do not add invented client counts, project metrics, testimonials, endorsements, or performance claims.

## Technology and hosting

- Front end: static HTML, CSS and vanilla JavaScript; no build step or package installation.
- Static hosting: Cloudflare Pages, expected project domain https://nisco-website.pages.dev/.
- AI backend: separate Cloudflare Worker in the nisco-ai/ directory.
- Lead storage: Cloudflare D1.
- Website consultation email: Brevo transactional email API.
- AI model: Cloudflare Workers AI, @cf/meta/llama-3.3-70b-instruct-fp8-fast.
- Source control: GitHub, default branch main.

The Cloudflare Pages Git integration/deployment status must be checked in the Cloudflare dashboard; a GitHub commit alone does not prove that the live website has deployed.

## Run locally

No root-level dependencies are required.

\`\`\`bash
python -m http.server 8000
\`\`\`

Open http://localhost:8000.

Run the homepage regression tests:

\`\`\`bash
node --test tests/site.test.js
\`\`\`

Run the AI Worker tests and local development server from nisco-ai/:

\`\`\`bash
cd nisco-ai
npm test
npx wrangler dev
\`\`\`

The Worker tests use mocked services; they do not submit real enquiries or modify production D1 data.

## Cloudflare Pages deployment

The Pages project should be connected to this GitHub repository and the main branch.

- Framework preset: None / static site
- Build command: leave blank
- Build output directory: repository root
- Root directory: repository root

Confirm the configured production branch and custom domains in Cloudflare Pages. Do not change DNS or domain settings as part of a routine code update.

## NISCO AI Worker deployment

The Worker configuration is in nisco-ai/wrangler.toml. The GitHub Actions workflow .github/workflows/deploy-nisco-ai.yml runs Worker tests, applies pending D1 migrations, and deploys the Worker when relevant Worker files change or when manually dispatched.

Required GitHub Actions secrets:
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID

Required Worker secrets:
- BREVO_API_KEY (for the website consultation form email)
- ADMIN_API_TOKEN (for protected lead administration)

Worker variable:
- BREVO_SENDER_EMAIL (must be a verified Brevo sender; currently configured in nisco-ai/wrangler.toml)

Never commit secrets or put them in browser JavaScript, GitHub source files, or public configuration.

The D1 database binding and database ID are configured in nisco-ai/wrangler.toml. Do not replace the database or edit production data during ordinary front-end work.

## Enquiry handling

### Website consultation form
- Requires name, email, service, requirement, and explicit consent.
- Phone and company are optional.
- Sends the enquiry notification to nisco.in@outlook.com through Brevo.
- Stores the enquiry in D1 after successful email delivery.
- The visitor receives a success message only after the Worker reports success.

### NISCO AI chat
- Uses the Cloudflare Workers AI binding and D1.
- Guides visitors through service qualification.
- Stores a chat lead only after a contact method is provided and explicit consent is confirmed.
- Chatbot lead capture does not automatically send WhatsApp or email notifications.
- Do not claim a lead was saved unless the Worker confirms it.

### Public contact and prices
- Public email: nisco.in@outlook.com
- Primary India sales location: Chennai
- Indicative India starting prices are maintained in assets/nisco-india-config.js and the Worker system prompt. Keep them consistent:
  - Business website: ₹15,000 onwards
  - Business automation: ₹15,000 onwards
  - AI chatbot: ₹10,000 onwards
  - Website maintenance: ₹2,000/month onwards
  - Automation support: ₹3,000/month onwards

Prices are indicative, not fixed quotations. Confirm scope, third-party costs, taxes and delivery timeline in writing.

## Security and privacy

- Never commit API keys, tokens, credentials, or private customer data.
- Keep public settings only in assets/nisco-india-config.js.
- Keep consent required before saving a lead.
- The privacy notice is privacy-policy.html.
- Review retention, access and deletion controls before production launch.
- Keep security headers in _headers aligned with the actual third-party services used.

## Release checklist

1. Run node --test tests/site.test.js.
2. Run npm test from nisco-ai/ when Worker code changes.
3. Review desktop and mobile layouts at common viewport sizes.
4. Check all navigation anchors, service links, privacy links and form validation.
5. Test the consultation form with a controlled test enquiry; verify Brevo delivery and D1 storage.
6. Test NISCO AI service answers, consent flow and D1 lead capture.
7. Confirm GitHub Actions results for Worker changes.
8. Confirm the Cloudflare Pages production deployment and inspect the live site.
9. Check browser console, network requests, accessibility and Lighthouse performance.
10. Update this README whenever architecture, secrets, hosting, or lead-handling behaviour changes.

## Project structure

\`\`\`
nisco-website/
├── index.html
├── styles.css
├── script.js
├── privacy-policy.html
├── _headers
├── assets/
│   ├── nisco-logo.svg
│   ├── nisco-hero.jpg
│   ├── nisco-chat.js
│   └── nisco-india-config.js
├── tests/
│   └── site.test.js
├── .github/workflows/
│   ├── deploy-nisco-ai.yml
│   └── site-check.yml
└── nisco-ai/
    ├── src/
    ├── migrations/
    ├── tests/
    ├── package.json
    └── wrangler.toml
\`\`\`
