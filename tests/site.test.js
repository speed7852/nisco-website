import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, script, chat, config, headers, worker] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  readFile(new URL("../script.js", import.meta.url), "utf8"),
  readFile(new URL("../assets/nisco-chat.js", import.meta.url), "utf8"),
  readFile(new URL("../assets/nisco-india-config.js", import.meta.url), "utf8"),
  readFile(new URL("../_headers", import.meta.url), "utf8"),
  readFile(new URL("../nisco-ai/src/index.js", import.meta.url), "utf8")
]);

test("NISCO brand, markets and approved positioning are present", () => {
  assert.match(config, /nisco\.in@outlook\.com/);
  assert.match(config, /Chennai/);
  assert.match(html, /India &amp; Saudi Arabia/);
  assert.match(html, /Built to Rise\.<br><span>Driven to Grow\.<\/span>/);
  assert.match(html, /assets\/nisco-logo\.svg/);
});

test("premium homepage has the approved visual sections", () => {
  for (const section of ["hero-rise", "services-section", "why-section", "proof-strip", "work-section", "insights-section", "consultation-section"]) {
    assert.match(html, new RegExp(section));
  }
  assert.match(html, /Digital Solutions/);
  assert.match(html, /AI &amp; Automation/);
  assert.match(html, /Cloud &amp; Integration/);
  assert.match(css, /Playfair Display/);
  assert.match(css, /--navy:#06182a/);
  assert.match(css, /--gold:#e7b650/);
});

test("enquiry form collects consent and submits directly to NISCO", () => {
  assert.match(html, /id="nisco-enquiry-form"/);
  assert.match(html, /id="enquiry-consent" required/);
  assert.match(html, /id="enquiry-email" name="email" type="email".*required/);
  assert.match(html, /sent directly to the NISCO team/i);
  assert.match(html, /nisco\.in@outlook\.com/);
  assert.match(script, /\/enquiry/);
  assert.match(script, /Sending your enquiry securely to NISCO/);
  assert.doesNotMatch(html, /Catchnoor@live\.in|98945\s?77373|wa\.me/i);
});

test("portfolio examples are accurately qualified", () => {
  assert.match(html, /Al Jawdah business website/);
  assert.match(html, /IN-HOUSE DEMONSTRATION/);
  assert.match(html, /do not represent independently verified client performance results/i);
  assert.match(html, /planned multi-role learning platform concept/i);
});

test("existing NISCO AI widget and Worker endpoint remain present", () => {
  assert.match(html, /id="nisco-chat-panel"/);
  assert.match(html, /assets\/nisco-chat\.js/);
  assert.match(chat, /nisco-ai\.speedhome7852\.workers\.dev\/chat/);
  assert.match(chat, /startFreshConversation/);
  assert.match(chat, /I need an AI chatbot/);
});

test("responsive and accessible foundations remain configured", () => {
  assert.match(css, /\.service-grid/);
  assert.match(css, /\.enquiry-form/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /Permissions-Policy:/);
});


test("homepage scroll reveals target real sections and remain accessible", () => {
  for (const selector of [
    ".services-intro", ".service-card", ".why-image", ".why-copy",
    ".proof-grid > div", ".work-heading", ".work-card",
    ".insights-inner > div", ".consultation-copy", ".enquiry-form",
    ".footer-main > div"
  ]) assert.ok(script.includes(selector), "Missing reveal target: " + selector);
  assert.match(css, /\.js-motion-enabled \.reveal/);
  assert.match(css, /\.reveal\.is-visible/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("consultation form preserves optional phone number end to end", () => {
  assert.match(html, /id="enquiry-phone" name="phone"/);
  assert.match(script, /phone: String\(values\.get\("phone"\) \|\| ""\)\.trim\(\)/);
  assert.match(worker, /const phone = typeof enquiry\.phone === "string" \? enquiry\.phone\.trim\(\) : ""/);
  assert.match(worker, /"Phone: " \+ \(phone \|\| "Not provided"\)/);
  assert.match(worker, /VALUES \(\?, \?, \?, \?, \?, 'email', \?, \?, '', 1, 'website-form'\)/);
});

test("consultation button restores its original label after sending", () => {
  assert.match(script, /submit\.dataset\.defaultHtml = submit\.innerHTML/);
  assert.match(script, /submit\.innerHTML = submit\.dataset\.defaultHtml/);
  assert.match(html, /Request a Consultation/);
});


test("approved premium hero uses Riyadh skyline photography, not the legacy summit image", () => {
  assert.match(html, /Riyadh skyline at night featuring Kingdom Centre Tower/);
  assert.match(css, /images\\.unsplash\\.com\\/photo-1663900108404-a05e8bf82cda/);
  assert.doesNotMatch(css, /background-image:url\\(\\"assets\\/nisco-hero\\.jpg\\"\\)/);
  assert.match(html, /India and Saudi Arabia flags over a Riyadh skyline/);
});
