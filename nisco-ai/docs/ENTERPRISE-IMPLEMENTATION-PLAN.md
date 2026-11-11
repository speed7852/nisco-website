# NISCO AI Enterprise — Implementation Plan

## Approved scope
- Delivery: staged enterprise architecture.
- Languages: English and Arabic.
- Incremental budget: ₹0 target; existing free-tier allowances only.
- Source of truth: GitHub repository.
- Development branch: `feature/nisco-ai-enterprise`.
- Production deployment: prohibited until explicit release approval after test evidence is reviewed.

## Baseline architecture
Website widget (`assets/nisco-chat.js`) → Cloudflare Worker (`nisco-ai/src/index.js`) → Workers AI and D1. The Worker also exposes website enquiry, admin and MCP routes. The current AI model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

## Stages and exit criteria
1. **Baseline and protection:** record routes, bindings, migrations, workflows, existing behaviour and rollback steps. Exit: baseline inventory and CI protection documented.
2. **Conversation intelligence and bilingual UX:** language-aware system instructions, safe Arabic/RTL rendering, session-scoped context and deterministic intent handling. Exit: English/Arabic test suite passes; existing English flows remain compatible.
3. **Knowledge centre:** curated, versioned NISCO content and retrieval with source-grounded answers. Exit: approved facts/prices only; unknown answers hand off rather than fabricate.
4. **Lead intelligence:** structured qualification, explicit consent, lead priority and routing. Exit: no lead saved without consent; existing schema and form compatibility preserved.
5. **Admin operations:** dashboard insights, role/access controls and audited administrative operations. Exit: authenticated access tests and destructive-action safeguards pass.
6. **Security and performance:** prompt-injection tests, input limits, rate limits, privacy/retention review, bilingual accessibility and cost monitoring. Exit: security, regression and performance checks pass.
7. **Release readiness:** deployment runbook, rollback, migration plan, independent developer handover and final acceptance report. Exit: user reviews evidence and explicitly authorises production release.

## Non-negotiable safeguards
- Never commit secrets, tokens, personal customer data or production exports.
- Do not use real customer records in tests.
- Do not execute destructive database migrations or production data changes during development.
- Do not add paid services, paid API keys or paid dependencies without prior approval.
- Preserve the current website enquiry form, chatbot endpoint, consent challenge, lead storage, admin routes and MCP contracts unless a compatibility-preserving change is approved.
- All schema changes must be additive, documented, reversible where feasible and tested against a disposable local/test database first.
- Keep conversation memory session-scoped by default; persistent customer memory requires separate explicit consent and retention policy.
- Arabic responses must support RTL presentation without breaking English layout.

## Definition of done
All existing and new automated tests pass; manual bilingual and mobile/desktop checks are recorded; cost and privacy review is complete; documentation is current; the release candidate is on a reviewable branch/PR; and production deployment is performed only after explicit approval.
