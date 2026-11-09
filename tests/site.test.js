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
  assert.match(config, /Catchnoor@live\.in/);
  assert.match(config, /919894577373/);
  assert.match(config, /Chennai/);
  assert.match(html, /Chennai, India/);
  assert.match(html, /Smarter Digital\.<br>Stronger/);
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

test("enquiry form requires consent and prepares a WhatsApp draft", () => {
  assert.match(html, /id="nisco-enquiry-form"/);
  assert.match(html, /id="enquiry-consent" required/);
  assert.match(script, /https:\/\/wa\.me\//);
  assert.match(script, /press Send in WhatsApp/);
  assert.match(html, /not submitted automatically/i);
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
  assert.match(chat, /startFreshConversation/);\n  assert.match(chat, /I need an AI chatbot/);\n  assert.match(chat, /Website maintenance/);\n  assert.match(chat, /Grow my business/);
});

test("new sections have responsive styles", () => {
  assert.match(css, /\.package-grid/);
  assert.match(css, /\.enquiry-form/);
  assert.match(css, /@media\(max-width:680px\)/);
});
