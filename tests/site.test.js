import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, script, chat, config] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  readFile(new URL("../script.js", import.meta.url), "utf8"),
  readFile(new URL("../assets/nisco-chat.js", import.meta.url), "utf8"),
  readFile(new URL("../assets/nisco-india-config.js", import.meta.url), "utf8")
]);

test("India contact details and Chennai positioning are configured", () => {
  assert.match(config, /nisco\.in@outlook\.com/);
  assert.doesNotMatch(config, /whatsapp|919894577373/i);
  assert.match(config, /Chennai/);
  assert.match(html, /Chennai, India/);
  assert.match(html, /TECHNOLOGY.*BUSINESS.*PEOPLE/);
  assert.match(html, /Built to Rise\.<br><span>Driven to Grow\.<\/span>/);
});

test("service packages show agreed INR starting prices", () => {
  assert.match(html, /Business Website/);
  assert.match(html, /₹15,000/);
  assert.match(html, /Business Automation/);
  assert.match(html, /AI Chatbot/);
  assert.match(html, /₹10,000/);
  assert.match(html, /₹2,000\/month/);
  assert.match(html, /₹3,000\/month/);
});

test("enquiry form collects customer email and submits directly to NISCO", () => {
  assert.match(html, /id="nisco-enquiry-form"/);
  assert.match(html, /id="enquiry-consent" required/);
  assert.match(html, /id="enquiry-email" name="email" type="email".*required/);
  assert.match(script, /\/enquiry/);
  assert.match(script, /Submit Enquiry/);
  assert.match(script, /Sending your enquiry securely to NISCO/);
  assert.doesNotMatch(script, /wa\.me|whatsapp/i);
  assert.match(html, /sent securely to NISCO/i);
  assert.match(html, /nisco\.in@outlook\.com/);
  assert.doesNotMatch(html, /Catchnoor@live\.in|98945\s?77373|wa\.me/i);
});

test("portfolio claims are clearly identified as project and in-house demo", () => {
  assert.match(html, /Al Jawdah business website/);
  assert.match(html, /IN-HOUSE DEMONSTRATION/);
  assert.match(html, /not represent independently verified client performance results/i);
});

test("existing NISCO AI widget and Worker endpoint remain present", () => {
  assert.match(html, /id="nisco-chat-panel"/);
  assert.match(html, /assets\/nisco-chat\.js/);
  assert.match(chat, /nisco-ai\.speedhome7852\.workers\.dev\/chat/);
  assert.match(chat, /startFreshConversation/);
  assert.match(chat, /I need an AI chatbot/);
  assert.match(chat, /Website maintenance/);
  assert.match(chat, /Grow my business/);
});

test("new sections have responsive styles", () => {
  assert.match(css, /\.package-grid/);
  assert.match(css, /\.enquiry-form/);
  assert.match(css, /@media\(max-width:680px\)/);
});
