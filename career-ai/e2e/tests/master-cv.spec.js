// Master CV journey (Phase 2): the real Worker (local, isolated) and the real frontend with the
// production security headers, in Chromium. Synthetic PDF and DOCX files are generated in memory;
// no CV file is committed. Like journey.spec.js, the checks are one ordered story in one page.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ACCESS_KEY, API_ORIGIN, APP_ORIGIN, LOG_DIR } from "../e2e.config.js";
import { SYNTHETIC_CV_LINES, buildDocx, buildPdf } from "../fixtures/synthetic-docs.js";

test.describe.configure({ mode: "serial" });

const PDF_NAME = "Synthetic CV.pdf";
const DOCX_NAME = "Synthetic CV.docx";
const PDF_BYTES = buildPdf();
const DOCX_BYTES = buildDocx(SYNTHETIC_CV_LINES, { header: ["Alex Synthetic · synthetic header"] });
const SCANNED_BYTES = buildPdf([[]]);
const EARLIER_DOCX = buildDocx(["Jordan Example", "Synthetic earlier upload for tests only.", "SKILLS", "Risk management, Vendor management"]);
const PDF_TYPE = "application/pdf";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

let context;
let page;
const consoleErrors = [];
const networkLog = [];

async function expectMessage(action, text) {
  await page.locator("#message").evaluate((node) => {
    node.textContent = "";
  });
  await action();
  await expect(page.locator("#message")).toContainText(text, { timeout: 30_000 });
}

async function token() {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem("careerAiSession") ?? "null").token);
}

async function apiGet(pathname) {
  const response = await page.request.get(`${API_ORIGIN}${pathname}`, { headers: { authorization: `Bearer ${await token()}`, origin: APP_ORIGIN } });
  expect(response.ok(), `${pathname} -> ${response.status()}`).toBe(true);
  return response.json();
}

async function items() {
  return (await apiGet("/api/profile/items")).items;
}

const versionCard = (name) => page.locator("#cv-versions article", { has: page.locator("h5", { hasText: name }) });
const proposal = (section) => page.locator(`#proposals article.proposal[data-section="${section}"]`);

async function upload(name, mimeType, buffer) {
  await page.setInputFiles("#master-cv-file", { name, mimeType, buffer });
  await page.click("#master-cv-upload");
}

async function seriousAxeViolations() {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return result.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => `${v.id} x${v.nodes.length}`);
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ acceptDownloads: true, locale: "en-GB", timezoneId: "UTC" });
  await context.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => networkLog.push(`${response.status()} ${response.request().method()} ${response.url()}`));
  await page.goto("/");
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const screenshot = testInfo.outputPath("failure-screenshot.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("failure-screenshot", { path: screenshot, contentType: "image/png" });
  const state = testInfo.outputPath("page-state.txt");
  const message = await page.locator("#message").textContent().catch(() => "(unavailable)");
  writeFileSync(state, `#message: ${message}\nURL: ${page.url()}\n\nConsole errors:\n${consoleErrors.join("\n") || "(none)"}\n\nLast 30 responses:\n${networkLog.slice(-30).join("\n")}\n`);
  await testInfo.attach("page-state", { path: state, contentType: "text/plain" });
});

test.afterAll(async () => {
  writeFileSync(path.join(LOG_DIR, "browser-network-master-cv.log"), `${networkLog.join("\n")}\n`);
  await context.close();
});

test("M01 sign in and open the master CV panel", async () => {
  await page.fill("#access-key", ACCESS_KEY);
  await page.click("#login-button");
  await expect(page.locator("#app")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#master-cv-title")).toBeVisible();
  await expect(page.locator("#master-cv-status")).toContainText("No master CV");
});

test("M02 deleting all profile facts needs the exact typed phrase; cancel keeps everything", async () => {
  await page.click("#delete-profile-data");
  const dialog = page.locator("#confirm-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#confirm-ok")).toBeDisabled();
  await page.fill("#confirm-input", "delete profile data");
  await expect(page.locator("#confirm-ok")).toBeDisabled();
  await page.click("#confirm-cancel");
  await expect(dialog).toBeHidden();
  const before = (await items()).length;

  await page.click("#delete-profile-data");
  await page.fill("#confirm-input", "DELETE PROFILE DATA");
  await expect(page.locator("#confirm-ok")).toBeEnabled();
  await expectMessage(() => page.click("#confirm-ok"), `Deleted ${before} profile fact(s). Your original notes and CV files were kept.`);
  expect(await items()).toHaveLength(0);
});

test("M03 a fact can be added by hand and is confirmed immediately", async () => {
  const name = page.locator('.facts-section[data-section="name"]');
  await name.getByRole("button", { name: "Add full name" }).click();
  await page.fill("#add-name-text", "Manual Synthetic Name");
  await expectMessage(() => name.getByRole("button", { name: "Save new full name" }).click(), "Full name added to your confirmed profile.");
  await expect(name.locator("li.fact")).toContainText("Manual Synthetic Name");
  await expect(name.locator("li.fact")).toContainText("Added by you");
});

test("M04 a PDF is uploaded, its text is read in the browser by the vendored pdf.js and stored privately", async () => {
  await expectMessage(() => upload(PDF_NAME, PDF_TYPE, PDF_BYTES), `characters from “${PDF_NAME}”`);
  await expect(page.locator("#message")).toContainText("fact(s) proposed for your review");
  const card = versionCard(PDF_NAME);
  await expect(card.locator(".extraction")).toContainText("Text read");
  await expect(card.locator(".extraction")).toContainText("pdfjs-dist 6.4.299");
  const { versions } = await apiGet("/api/cv/versions");
  const version = versions.find((v) => v.file?.name === PDF_NAME);
  expect(version.extraction).toMatchObject({ status: "extracted", parser: "pdfjs-dist", parserVersion: "6.4.299", pageCount: 1, warnings: [] });
  const { text } = await apiGet(`/api/cv/versions/${version.id}/text`);
  expect(text).toBe(SYNTHETIC_CV_LINES.filter(Boolean).join("\n"));
  expect(JSON.stringify(versions)).not.toMatch(/private\/(uploads|cv)\//);
});

test("M05 every proposal is grounded in the extracted text and shows where it came from", async () => {
  const { versions } = await apiGet("/api/cv/versions");
  const version = versions.find((v) => v.file?.name === PDF_NAME);
  const { text } = await apiGet(`/api/cv/versions/${version.id}/text`);
  const proposed = (await items()).filter((item) => item.status === "proposed");
  expect(new Set(proposed.map((item) => item.section))).toEqual(
    new Set(["name", "headline", "email", "phone", "link", "summary", "years_experience", "experience", "education", "certification", "skill"]),
  );
  for (const item of proposed) {
    expect(item.source).toMatchObject({ type: "cv_extraction", cvVersionId: version.id });
    const source = text.slice(item.source.span.start, item.source.span.end);
    for (const value of Object.values(item.value).flat()) expect(source, `${item.section} value "${value}"`).toContain(value);
  }
  await expect(proposal("email")).toContainText("As written in the CV:");
  await expect(proposal("email")).toContainText(`From CV “${PDF_NAME}”`);
  await expect(proposal("name")).toContainText("Already confirmed: “Manual Synthetic Name”");
});

test("M06 a proposal is confirmed as it is, with two API requests (confirm, then reload the facts)", async () => {
  const before = networkLog.length;
  await expectMessage(() => proposal("email").getByRole("button", { name: "Confirm Email" }).click(), "Email confirmed.");
  // The request budget per review action keeps a person far inside the production limit of 120
  // API requests a minute (the E2E Worker runs with a higher limit; see scripts/start-worker.js).
  const apiCalls = networkLog.slice(before).filter((line) => line.includes(`${API_ORIGIN}/api/`)).map((line) => line.replace(/\/api\/profile\/items\/[0-9a-f-]{36}\//, "/api/profile/items/:id/"));
  expect(apiCalls).toEqual([`200 POST ${API_ORIGIN}/api/profile/items/:id/confirm`, `200 GET ${API_ORIGIN}/api/profile/items`]);
  const email = (await items()).find((item) => item.section === "email");
  expect(email).toMatchObject({ status: "confirmed", value: { text: "alex.synthetic@example.test" }, userEdited: false });
  await expect(page.locator('.facts-section[data-section="email"] li.fact')).toContainText(`From CV “${PDF_NAME}”`);
});

test("M07 a proposal is edited before confirming and marked as edited", async () => {
  await proposal("headline").getByRole("button", { name: "Edit Headline before confirming" }).click();
  const input = proposal("headline").locator("input");
  await expect(input).toHaveValue("Programme Manager (synthetic test CV)");
  await input.fill("Programme Manager (edited synthetic)");
  await expectMessage(() => proposal("headline").getByRole("button", { name: "Confirm Headline" }).click(), "Headline confirmed.");
  const headline = (await items()).find((item) => item.section === "headline" && item.status === "confirmed");
  expect(headline).toMatchObject({ value: { text: "Programme Manager (edited synthetic)" }, userEdited: true });
  await expect(page.locator('.facts-section[data-section="headline"] li.fact')).toContainText("edited by you");
});

test("M08 replacing a confirmed single value needs an explicit choice; cancel keeps it", async () => {
  await proposal("name").getByRole("button", { name: "Confirm Full name" }).click();
  await expect(page.locator("#confirm-dialog")).toBeVisible();
  await expect(page.locator("#confirm-title")).toHaveText("Replace your confirmed full name?");
  await expect(page.locator("#confirm-text")).toContainText("Manual Synthetic Name");
  await expectMessage(() => page.click("#confirm-cancel"), "Kept your confirmed full name.");
  let names = (await items()).filter((item) => item.section === "name");
  expect(names.find((item) => item.status === "confirmed").value.text).toBe("Manual Synthetic Name");
  expect(names.find((item) => item.source.type === "cv_extraction").status).toBe("proposed");

  await proposal("name").getByRole("button", { name: "Confirm Full name" }).click();
  await expectMessage(() => page.click("#confirm-ok"), "Full name confirmed (it replaced the previous value).");
  names = (await items()).filter((item) => item.section === "name");
  expect(names.map((item) => [item.value.text, item.status]).sort()).toEqual([["Alex Synthetic", "confirmed"], ["Manual Synthetic Name", "superseded"]]);
});

test("M09 a proposal is rejected", async () => {
  await expectMessage(() => proposal("phone").getByRole("button", { name: "Reject Phone" }).click(), "Phone proposal rejected.");
  expect((await items()).find((item) => item.section === "phone").status).toBe("rejected");
  await expect(proposal("phone")).toHaveCount(0);
});

test("M10 the PDF becomes the active master CV", async () => {
  await expectMessage(() => versionCard(PDF_NAME).getByRole("button", { name: `Make ${PDF_NAME} the active master CV` }).click(), `“${PDF_NAME}” is now your active master CV.`);
  await expect(page.locator("#master-cv-status")).toContainText(`Active master CV: “${PDF_NAME}”`);
  await expect(versionCard(PDF_NAME).locator(".pill")).toHaveText("Active master CV");
});

test("M11 a DOCX version is read by the DOCX parser and proposes nothing already confirmed or proposed", async () => {
  await expectMessage(() => upload(DOCX_NAME, DOCX_TYPE, DOCX_BYTES), `characters from “${DOCX_NAME}”`);
  const { versions } = await apiGet("/api/cv/versions");
  const docx = versions.find((v) => v.file?.name === DOCX_NAME);
  expect(docx.extraction).toMatchObject({ status: "extracted", parser: "nisco-docx", parserVersion: "1.0.0", pageCount: null, warnings: ["headers_included"] });
  const fromDocx = (await items()).filter((item) => item.source.cvVersionId === docx.id);
  // Everything else in the DOCX is already confirmed or waiting for review from the PDF. The
  // original headline wording differs from the edited confirmed one, and the phone number was
  // rejected for the PDF only, so those two are proposed again.
  expect(fromDocx.map((item) => item.section).sort()).toEqual(["headline", "phone"]);
  await expect(versionCard(DOCX_NAME).locator(".extraction")).toContainText("page-header text was included");
});

test("M12 activating the DOCX leaves exactly one active version", async () => {
  await expectMessage(() => versionCard(DOCX_NAME).getByRole("button", { name: `Make ${DOCX_NAME} the active master CV` }).click(), `“${DOCX_NAME}” is now your active master CV.`);
  const { versions, activeId } = await apiGet("/api/cv/versions");
  expect(versions.filter((v) => v.active).map((v) => v.file.name)).toEqual([DOCX_NAME]);
  expect(activeId).toBe(versions.find((v) => v.file?.name === DOCX_NAME).id);
  await expect(versionCard(PDF_NAME).locator(".pill")).toHaveText("Inactive");
});

test("M13 the same file uploaded again is refused as a duplicate", async () => {
  await expectMessage(() => upload("Same bytes again.pdf", PDF_TYPE, PDF_BYTES), "This exact file is already one of your CV versions.");
  expect((await apiGet("/api/cv/versions")).versions).toHaveLength(2);
});

test("M14 an HTML file named .pdf is refused and nothing is stored", async () => {
  await expectMessage(() => upload("spoofed.pdf", PDF_TYPE, Buffer.from("<html><script>alert(1)</script></html>")), "The file content is not a valid PDF or DOCX document.");
  expect((await apiGet("/api/cv/versions")).versions).toHaveLength(2);
});

test("M15 a scanned PDF without a text layer is reported, not guessed at", async () => {
  await expectMessage(() => upload("Scanned synthetic.pdf", PDF_TYPE, SCANNED_BYTES), "Could not read text from “Scanned synthetic.pdf”: the PDF has no text layer");
  const scanned = (await apiGet("/api/cv/versions")).versions.find((v) => v.file?.name === "Scanned synthetic.pdf");
  expect(scanned.extraction).toMatchObject({ status: "failed", characters: 0, warnings: ["no_text_layer"] });
  expect((await items()).filter((item) => item.source.cvVersionId === scanned.id)).toHaveLength(0);
  await expect(versionCard("Scanned synthetic.pdf").locator(".extraction")).toContainText("Text could not be read");
});

test("M16 the download returns exactly the uploaded bytes", async () => {
  const [download] = await Promise.all([page.waitForEvent("download"), versionCard(PDF_NAME).getByRole("button", { name: `Download ${PDF_NAME}` }).click()]);
  expect(download.suggestedFilename()).toBe(PDF_NAME);
  expect((await readFile(await download.path())).equals(PDF_BYTES)).toBe(true);
});

test("M17 the extracted text can be reviewed in the page", async () => {
  const details = versionCard(PDF_NAME).locator("details.cv-text");
  await details.locator("summary").click();
  await expect(details.locator("pre")).toContainText("Example Holdings");
});

test("M18 the remaining proposals from one CV are rejected together", async () => {
  const docx = (await apiGet("/api/cv/versions")).versions.find((v) => v.file?.name === DOCX_NAME);
  await page.locator(`#proposals [data-source="cv:${docx.id}"]`).getByRole("button", { name: `Reject all remaining proposals from ${DOCX_NAME}` }).click();
  await expectMessage(() => page.click("#confirm-ok"), `Rejected 2 proposal(s) from “${DOCX_NAME}”.`);
  expect((await items()).filter((item) => item.source.cvVersionId === docx.id && item.status === "proposed")).toHaveLength(0);
  await expect(page.locator(`#proposals [data-source="cv:${docx.id}"]`)).toHaveCount(0);
});

test("M19 an earlier private upload is registered as a CV version and read", async () => {
  await page.setInputFiles("#cv-file", { name: "Earlier synthetic.docx", mimeType: DOCX_TYPE, buffer: EARLIER_DOCX });
  await expectMessage(() => page.click("#upload-cv"), "Uploaded Earlier synthetic.docx privately.");
  const earlier = (await apiGet("/api/files")).files.find((file) => file.name === "Earlier synthetic.docx");
  await page.selectOption("#register-upload-file", earlier.id);
  await expectMessage(() => page.click("#register-upload"), "characters from “Earlier synthetic.docx”");
  await expect(versionCard("Earlier synthetic.docx")).toBeVisible();
  const row = page.locator("#files-list li", { hasText: "Earlier synthetic.docx" });
  await expect(row).toContainText("CV version (manage it under Master CV)");
  await expect(row.locator("button.danger")).toHaveCount(0);
});

test("M19b Confirm all adds a CV's proposals in one step and never replaces a confirmed fact", async () => {
  const SINGLE = ["name", "headline", "summary", "years_experience", "email", "phone", "location_text", "remote_preference", "skills_text", "experience_text", "preferred_titles_text"];
  const earlier = (await apiGet("/api/cv/versions")).versions.find((v) => v.file?.name === "Earlier synthetic.docx");
  const all = await items();
  const before = all.filter((item) => item.source.cvVersionId === earlier.id && item.status === "proposed");
  const confirmedBefore = all.filter((item) => item.status === "confirmed");
  const expectedLeft = before.filter((item) => SINGLE.includes(item.section) && confirmedBefore.some((fact) => fact.section === item.section));
  expect(before.length).toBeGreaterThan(expectedLeft.length);

  const group = page.locator(`#proposals [data-source="cv:${earlier.id}"]`);
  await group.getByRole("button", { name: `Confirm all ${before.length} proposals from Earlier synthetic.docx` }).click();
  await expect(page.locator("#confirm-dialog")).toContainText("exactly as written in the CV");
  const confirmed = before.length - expectedLeft.length;
  const left = expectedLeft.length ? ` ${expectedLeft.length} left below for you to check.` : "";
  await expectMessage(() => page.click("#confirm-ok"), `Confirmed ${confirmed} fact(s) from “Earlier synthetic.docx”.${left}`);

  const after = await items();
  for (const fact of confirmedBefore) expect(after.find((item) => item.id === fact.id)).toMatchObject({ status: "confirmed", value: fact.value });
  expect(after.filter((item) => item.status === "superseded").length).toBe(all.filter((item) => item.status === "superseded").length);
  const stillProposed = after.filter((item) => item.source.cvVersionId === earlier.id && item.status === "proposed").map((item) => item.id).sort();
  expect(stillProposed).toEqual(expectedLeft.map((item) => item.id).sort());
  await expect(group.locator("article.proposal")).toHaveCount(expectedLeft.length);
});

test("M20 without a session the CV, profile and export endpoints refuse access", async () => {
  const { versions } = await apiGet("/api/cv/versions");
  for (const pathname of ["/api/cv/versions", `/api/cv/versions/${versions[0].id}/download`, `/api/cv/versions/${versions[0].id}/text`, "/api/profile/items", "/api/profile/export"]) {
    const response = await page.request.get(`${API_ORIGIN}${pathname}`, { headers: { origin: APP_ORIGIN } });
    expect(response.status(), pathname).toBe(401);
  }
  const forged = await page.request.get(`${API_ORIGIN}/api/profile/export`, { headers: { origin: APP_ORIGIN, authorization: "Bearer v1.forged.token" } });
  expect(forged.status()).toBe(401);
});

test("M21 the export contains the profile and document metadata but no storage keys or secrets", async () => {
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export-profile")]);
  expect(download.suggestedFilename()).toMatch(/^career-ai-profile-export-\d{4}-\d{2}-\d{2}\.json$/);
  const raw = await readFile(await download.path(), "utf8");
  const data = JSON.parse(raw);
  expect(Object.keys(data)).toEqual(expect.arrayContaining(["legacyProfile", "snapshots", "profileItems", "cvVersions", "uploadedFiles"]));
  expect(data.profileItems.some((item) => item.section === "email" && item.status === "confirmed")).toBe(true);
  const pdf = data.cvVersions.find((v) => v.file?.name === PDF_NAME);
  expect(pdf.extractedText).toContain("Alex Synthetic");
  expect(pdf.file.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(raw).not.toMatch(/private\/(uploads|cv)\//);
  expect(raw).not.toContain(ACCESS_KEY);
  expect(raw).not.toContain(await token());
});

test("M22 deleting a CV needs the typed phrase, removes the file and keeps confirmed facts with their history", async () => {
  const { versions } = await apiGet("/api/cv/versions");
  const pdf = versions.find((v) => v.file?.name === PDF_NAME);
  const confirmedFromPdf = (await items()).filter((item) => item.source.cvVersionId === pdf.id && item.status === "confirmed").map((item) => item.id);
  expect(confirmedFromPdf.length).toBeGreaterThan(0);

  await versionCard(PDF_NAME).getByRole("button", { name: `Delete ${PDF_NAME} permanently` }).click();
  await expect(page.locator("#confirm-ok")).toBeDisabled();
  await page.fill("#confirm-input", "delete");
  await expect(page.locator("#confirm-ok")).toBeDisabled();
  await page.fill("#confirm-input", "DELETE");
  await expectMessage(() => page.click("#confirm-ok"), `“${PDF_NAME}” was deleted.`);

  await expect(versionCard(PDF_NAME)).toHaveCount(0);
  const after = await apiGet("/api/cv/versions?includeDeleted=true");
  expect(after.versions.find((v) => v.id === pdf.id)).toMatchObject({ status: "deleted", file: null });
  const download = await page.request.get(`${API_ORIGIN}/api/cv/versions/${pdf.id}/download`, { headers: { authorization: `Bearer ${await token()}`, origin: APP_ORIGIN } });
  expect(download.status()).toBe(410);
  expect((await apiGet("/api/files")).files.map((file) => file.name)).not.toContain(PDF_NAME);
  const remaining = await items();
  expect(remaining.filter((item) => item.source.cvVersionId === pdf.id && item.status === "proposed")).toHaveLength(0);
  for (const id of confirmedFromPdf) expect(remaining.find((item) => item.id === id).source.cvDeleted).toBe(true);
  await expect(page.locator('.facts-section[data-section="email"] li.fact')).toContainText("From a CV you have since deleted");
});

test("M23 the profile tab and the confirmation dialog have no critical or serious accessibility violations", async ({}, testInfo) => {
  const screenshot = testInfo.outputPath("master-cv-profile.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("profile-tab", { path: screenshot, contentType: "image/png" });
  expect(await seriousAxeViolations()).toEqual([]);
  await page.click("#delete-profile-data");
  await expect(page.locator("#confirm-dialog")).toBeVisible();
  expect(await seriousAxeViolations()).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#confirm-dialog")).toBeHidden();
});

test("M24 nothing overflows horizontally at 360 px", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("M25 no console errors and no CSP violations (pdf.js ran under the production CSP)", async () => {
  expect(networkLog.some((line) => /^200 GET .*\/vendor\/pdfjs\/pdf\.worker\.min\.js$/.test(line))).toBe(true);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
