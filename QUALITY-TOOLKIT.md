# NISCO Website Quality Engineering Toolkit

The repository includes an automated quality toolchain. These are installable development tools and workflows, not standalone AI-agent skills.

## Included
- Playwright + Chromium: real-browser layout, mobile navigation and viewport regression tests.
- axe-core via @axe-core/playwright: automated WCAG 2A/AA accessibility checks.
- Lighthouse CI: live-site performance, accessibility, best-practices and SEO audits.
- GitHub Actions: repeatable checks and stored browser screenshots/reports.
- Existing Cloudflare Pages/Workers and D1 integration remains unchanged.

## Local use
Install @playwright/test and @axe-core/playwright, install Chromium with Playwright, then run npx playwright test.

## Lighthouse
Run the NISCO Lighthouse Quality Audit workflow from GitHub Actions or let it run after the website test workflow succeeds. It audits the deployed Pages URL and uploads a temporary report link.

Automated audits do not replace manual review of visual design, real-device behaviour, content accuracy, SEO strategy or security configuration. Scores start as warnings so baseline issues do not block deployment.
