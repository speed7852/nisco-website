// Career AI browser journey: the real Worker (local, isolated) and the real frontend served with the
// production security headers. Each test is one check in a single ordered story; they share one
// browser page, so they run serially and stop at the first failure.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ACCESS_KEY, API_ORIGIN, APP_ORIGIN, LOG_DIR } from "../e2e.config.js";
import { headersFor, localRules, productionRules } from "../scripts/headers.js";

test.describe.configure({ mode: "serial" });

/** Synthetic test data only. */
const PROFILE = {
  name: "E2E Synthetic Candidate",
  headline: "Synthetic programme manager",
  years: "11",
  skills: "PMO, ITIL",
  experience: "Synthetic experience only.",
  roles: "Programme Manager",
};
const JOB_URL = "https://jobs.example.com/e2e-programme-manager?utm_source=newsletter";
const JOB_URL_TRACKING_VARIANT = "https://jobs.example.com/e2e-programme-manager?utm_source=other#apply";
/**
 * Every initial profile load is delayed by this much. It turns a real race (a slow first load
 * overwriting newer data) into a deterministic check: without the app's busy/inert guard and its
 * stale-load guard, the busy-state check and the tracker checks fail on every run.
 */
const INITIAL_LOAD_DELAY_MS = 1_000;
const PDF_BYTES = Buffer.from("%PDF-1.4\n% synthetic e2e document\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");

let context;
let page;
const consoleErrors = [];
const networkLog = [];

/** Clears the status line, performs the action, then waits for the expected message. */
async function expectMessage(action, text) {
  await page.locator("#message").evaluate((node) => {
    node.textContent = "";
  });
  await action();
  await expect(page.locator("#message")).toContainText(text);
}

/** Waits until the workspace has finished loading saved data and accepts input again. */
async function expectWorkspaceReady() {
  await expect(page.locator("#app")).toHaveAttribute("aria-busy", "false");
  expect(await page.locator("#app").evaluate((node) => node.inert)).toBe(false);
}

/** Calls the local API with the browser's current session token, to confirm stored state. */
async function apiGet(pathname) {
  const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem("careerAiSession") ?? "null"));
  const response = await page.request.get(`${API_ORIGIN}${pathname}`, {
    headers: { authorization: `Bearer ${session.token}`, origin: APP_ORIGIN },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function seriousAxeViolations() {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return result.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => `${v.id} x${v.nodes.length}`);
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ acceptDownloads: true, locale: "en-GB", timezoneId: "UTC" });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  // Record every CSP violation the page reports (CSP stays enforced: bypassCSP is off).
  await context.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await context.route(`${API_ORIGIN}/api/profile`, async (route) => {
    if (route.request().method() === "GET") await new Promise((resolve) => setTimeout(resolve, INITIAL_LOAD_DELAY_MS));
    await route.continue();
  });
  page = await context.newPage();
  page.on("console", (message) => {
    // Deliberate 4xx responses (wrong key, invalid link, duplicates) log "Failed to load resource";
    // only script errors and CSP reports count as failures.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => networkLog.push(`${response.status()} ${response.request().method()} ${response.url()}`));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
});

// On failure, save a screenshot and the visible page state as files in test-results/<test>/ (and in
// the HTML report). Worker/server logs and the full trace are in logs/.
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const screenshot = testInfo.outputPath("failure-screenshot.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("failure-screenshot", { path: screenshot, contentType: "image/png" });
  const visible = await page.locator("#message").textContent().catch(() => "(unavailable)");
  const login = await page.locator("#login-message").textContent().catch(() => "(unavailable)");
  const state = testInfo.outputPath("page-state.txt");
  writeFileSync(
    state,
    `#message: ${visible}\n#login-message: ${login}\nURL: ${page.url()}\n\nConsole errors:\n${consoleErrors.join("\n") || "(none)"}\n\nLast 30 responses:\n${networkLog.slice(-30).join("\n")}\n`,
  );
  await testInfo.attach("page-state", { path: state, contentType: "text/plain" });
});

test.afterAll(async () => {
  await context.tracing.stop({ path: path.join(LOG_DIR, "trace.zip") });
  writeFileSync(path.join(LOG_DIR, "browser-network.log"), `${networkLog.join("\n")}\n`);
  await context.close();
});

test("01 page is served with the production security headers", async () => {
  const response = await page.request.get(`${APP_ORIGIN}/`);
  const expected = headersFor(localRules(), "/");
  const production = headersFor(productionRules(), "/");
  for (const [name, value] of expected) expect(response.headers()[name], name).toBe(value);
  // Exactly one difference from production: the API origin in connect-src.
  for (const [name, value] of production) {
    if (name !== "content-security-policy") expect(expected.get(name), name).toBe(value);
  }
  expect(expected.get("content-security-policy")).toContain(`connect-src 'self' ${API_ORIGIN}`);
  expect(expected.get("content-security-policy")).toContain("script-src 'self'");
  expect(expected.get("x-frame-options")).toBe("DENY");
});

test("02 sign-in page has no critical or serious accessibility violations", async () => {
  expect(await seriousAxeViolations()).toEqual([]);
});

test("03 a wrong access key is rejected with a message", async () => {
  await page.fill("#access-key", "wrong-key");
  await page.click("#login-button");
  await expect(page.locator("#login-message")).toHaveText("That access key is not correct.");
  await expect(page.locator("#app")).toBeHidden();
});

test("04 the raw access key is never stored in the browser", async () => {
  await page.fill("#access-key", ACCESS_KEY);
  await page.click("#login-button");
  await expect(page.locator("#app")).toBeVisible();
  await expectWorkspaceReady();
  const storage = await page.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } }));
  expect(storage).not.toContain(ACCESS_KEY);
});

test("05 the workspace is busy and inert until saved data has loaded", async () => {
  await page.click("#logout");
  await page.fill("#access-key", ACCESS_KEY);
  await page.click("#login-button");
  await expect(page.locator("#app")).toHaveAttribute("aria-busy", "true");
  expect(await page.locator("#app").evaluate((node) => node.inert)).toBe(true);
  await expectWorkspaceReady();
});

test("06 a short-lived session token is stored instead", async () => {
  const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem("careerAiSession") ?? "null"));
  expect(session.token).toMatch(/^v1\./);
  const hours = (Date.parse(session.expiresAt) - Date.now()) / 3_600_000;
  expect(hours).toBeGreaterThan(7.5);
  expect(hours).toBeLessThanOrEqual(8);
});

test("07 the career profile is saved", async () => {
  for (const [field, value] of Object.entries(PROFILE)) await page.fill(`#p-${field}`, value);
  await expectMessage(() => page.click("#profile-form button[type=submit]"), "Career profile saved.");
  const stored = await apiGet("/api/profile");
  expect(stored.profile).toMatchObject({ name: PROFILE.name, years: 11, roles: PROFILE.roles });
});

// Phase 2: matching and drafts use confirmed facts only, so the saved notes are reviewed as
// proposals and confirmed one by one before the job checks below.
test("07b the saved notes are reviewed as proposals and confirmed one by one", async () => {
  await expectMessage(() => page.click("#legacy-propose"), "6 proposal(s) created from your saved notes");
  const proposals = page.locator("#proposals article.proposal");
  await expect(proposals).toHaveCount(6);
  await expect(page.locator("#proposals")).toContainText("From your original profile notes");
  for (let remaining = 6; remaining > 0; remaining -= 1) {
    await page.locator("#proposals button.confirm").first().click();
    await expect(proposals).toHaveCount(remaining - 1);
  }
  const { items } = await apiGet("/api/profile/items");
  expect(items.filter((item) => item.status === "confirmed").map((item) => item.section).sort()).toEqual(
    ["experience_text", "headline", "name", "preferred_titles_text", "skills_text", "years_experience"],
  );
  expect(items.every((item) => item.source.type === "legacy_profile")).toBe(true);
  // The notes themselves are unchanged.
  expect((await apiGet("/api/profile")).profile).toMatchObject({ name: PROFILE.name, skills: PROFILE.skills });
});

test("08 a javascript: job link is rejected and the field is marked invalid", async () => {
  await page.click("[data-tab=jobs]");
  await page.fill("#j-title", "Programme Manager");
  await page.fill("#j-company", "Synthetic Co");
  await page.fill("#j-location", "Riyadh");
  await page.fill("#j-url", "javascript:alert(document.domain)");
  await page.fill("#j-desc", "Synthetic description: PMO governance and ITIL.");
  await expectMessage(() => page.click("#job-form button[type=submit]"), "Only https:// job links are accepted.");
  await expect(page.locator("#j-url")).toHaveAttribute("aria-invalid", "true");
  expect((await apiGet("/api/jobs")).jobs).toHaveLength(0);
});

test("09 a valid job is saved and listed", async () => {
  await page.fill("#j-url", JOB_URL);
  await expectMessage(() => page.click("#job-form button[type=submit]"), "Job saved.");
  await expect(page.locator("#jobs-list article")).toHaveCount(1);
  await expect(page.locator("#job-count")).toHaveText("1");
});

test("10 a tracking-parameter variant of the same link is rejected as a duplicate", async () => {
  await page.fill("#j-title", "Programme Manager");
  await page.fill("#j-company", "Synthetic Co");
  await page.fill("#j-desc", "Duplicate");
  await page.fill("#j-url", JOB_URL_TRACKING_VARIANT);
  await expectMessage(() => page.click("#job-form button[type=submit]"), "This job is already saved.");
  expect((await apiGet("/api/jobs")).jobs).toHaveLength(1);
});

test("11 the listing link is an https link", async () => {
  await expect(page.locator("#jobs-list a")).toHaveAttribute("href", JOB_URL);
});

test("12 with no AI available the assessment is marked needs_review and no score is invented", async () => {
  await expectMessage(() => page.click("#jobs-list button"), "The assessment did not complete.");
  const [job] = (await apiGet("/api/jobs")).jobs;
  expect(job.match).toMatchObject({ status: "needs_review", score: null, verified: false, shortlisted: false, lastError: "inference_failed" });
  await expect(page.locator("#jobs-list .notice")).toContainText("did not complete (inference_failed)");
  await expect(page.locator("#shortlist-count")).toHaveText("0");
});

test("13 a draft with AI unavailable shows a clear error", async () => {
  await page.click("[data-tab=studio]");
  await expectMessage(() => page.click("#generate-draft"), "The AI service did not respond.");
  await expect(page.locator("#draft-output pre")).toHaveCount(0);
});

test("14 a second tracker entry for the same job is refused", async () => {
  await page.click("[data-tab=tracker]");
  await page.selectOption("#track-status", "applied");
  await page.fill("#track-notes", "Applied myself on the employer site");
  await expectMessage(() => page.click("#tracker-form button[type=submit]"), "Application added to tracker.");
  await expect(page.locator("#applications-list article")).toHaveCount(1);
  await expectMessage(() => page.click("#tracker-form button[type=submit]"), "This job is already in your tracker.");
  await expect(page.locator("#applications-list article")).toHaveCount(1);
});

test("15 'submitted' is not offered as a status", async () => {
  const options = await page.locator("#track-status option").evaluateAll((nodes) => nodes.map((node) => node.value));
  expect(options).toEqual(["prepared", "applied", "recruiter_contact", "interview", "offer", "rejected", "withdrawn"]);
});

test("16 a notes-only update keeps the status 'applied'", async () => {
  await page.fill("#applications-list textarea", "Follow up on Monday");
  await expectMessage(() => page.click("#applications-list button"), "Application tracker updated.");
  const [application] = (await apiGet("/api/applications")).applications;
  expect(application).toMatchObject({ status: "applied", notes: "Follow up on Monday" });
  await expect(page.locator("#applications-list select")).toHaveValue("applied");
});

test("17 a PDF is uploaded privately and listed", async () => {
  await page.click("[data-tab=profile]");
  await page.setInputFiles("#cv-file", { name: "Synthetic CV.pdf", mimeType: "application/pdf", buffer: PDF_BYTES });
  await expectMessage(() => page.click("#upload-cv"), "Uploaded Synthetic CV.pdf privately.");
  await expect(page.locator("#files-list li strong")).toHaveText(["Synthetic CV.pdf"]);
});

test("18 the download returns exactly the uploaded bytes", async () => {
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#files-list button.secondary")]);
  expect(download.suggestedFilename()).toBe("Synthetic CV.pdf");
  const { readFile } = await import("node:fs/promises");
  expect((await readFile(await download.path())).equals(PDF_BYTES)).toBe(true);
});

test("19 an HTML file named .pdf is rejected", async () => {
  await page.setInputFiles("#cv-file", { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
  await expectMessage(() => page.click("#upload-cv"), "The file content is not a valid PDF or DOCX document.");
  await expect(page.locator("#files-list li strong")).toHaveCount(1);
});

test("20 the file is deleted", async () => {
  await expectMessage(() => page.click("#files-list button.danger"), "File deleted.");
  await expect(page.locator("#files-list li strong")).toHaveCount(0);
  expect((await apiGet("/api/files")).files).toHaveLength(0);
});

test("21 every tab has no critical or serious accessibility violations", async () => {
  const violations = [];
  for (const tab of ["profile", "jobs", "studio", "tracker"]) {
    await page.click(`[data-tab=${tab}]`);
    await expect(page.locator(`#tab-${tab}`)).toBeVisible();
    violations.push(...(await seriousAxeViolations()).map((v) => `${tab}: ${v}`));
  }
  expect(violations).toEqual([]);
});

test("22 nothing overflows horizontally at 360 px", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("23 the session survives a page reload", async () => {
  await page.reload();
  await expect(page.locator("#app")).toBeVisible();
  await expectWorkspaceReady();
  await expect(page.locator("#login")).toBeHidden();
  await expect(page.locator("#job-count")).toHaveText("1");
});

test("24 locking the workspace clears session storage", async () => {
  await page.click("#logout");
  await expect(page.locator("#login")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test("25 no console errors and no CSP violations during the journey", async () => {
  const violations = await page.evaluate(() => window.__cspViolations);
  expect(violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
