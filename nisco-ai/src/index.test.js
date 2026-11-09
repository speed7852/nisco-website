import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";

function harness() {
  const inserts = [];
  const env = {
    ALLOWED_ORIGIN: "https://nisco-website.pages.dev",
    AI: { run: async () => ({ response: "NISCO can help with that." }) },
    DB: { prepare(sql) { return { bind(...values) { return { async run() { inserts.push({ sql, values }); return { success: true }; } }; } }; } }
  };
  async function send(messages, origin = env.ALLOWED_ORIGIN) {
    const request = new Request("https://worker.test/chat", {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ messages })
    });
    const response = await worker.fetch(request, env);
    const raw = await response.text();
    let body; try { body = JSON.parse(raw); } catch { body = { error: raw }; }
    return { status: response.status, body };
  }
  return { send, inserts, env };
}
const starter = "I need a website. Please guide me through a website enquiry and ask one question at a time. Start by asking what type of website I need.";
const firstQuestion = "Absolutely. What type of website do you need—for example, a business website, online store, portfolio, or something else?";
const contactPrompt = "To prepare your enquiry, please share the email address or phone number the NISCO team should use to contact you.";
const consentPrompt = "Before I save this enquiry, may I share the details you've provided with the NISCO team so they can contact you?";

test("validates origin, method, path and payload", async () => {
  const h = harness();
  assert.equal((await h.send([{ role: "user", content: "Hi" }], "https://evil.test")).status, 403);
  const bad = await worker.fetch(new Request("https://worker.test/chat", { method: "GET", headers: { Origin: h.env.ALLOWED_ORIGIN } }), h.env);
  assert.equal(bad.status, 404);
  assert.equal((await h.send([])).status, 400);
});
test("normal greeting never triggers lead consent", async () => {
  const h = harness();
  const r = await h.send([{ role: "user", content: "Hello" }]);
  assert.match(r.body.reply, /NISCO can help/);
  assert.equal(h.inserts.length, 0);
});
test("email enquiry progresses once and saves only after consent", async () => {
  const h = harness();
  let history = [{ role: "user", content: starter }];
  let r = await h.send(history); assert.equal(r.body.reply, firstQuestion);
  history.push({ role: "assistant", content: firstQuestion }, { role: "user", content: "I need a five-page business website." });
  r = await h.send(history); assert.equal(r.body.reply, contactPrompt);
  history.push({ role: "assistant", content: contactPrompt }, { role: "user", content: "Test@gmail.com" });
  r = await h.send(history); assert.equal(r.body.reply, consentPrompt);
  history.push({ role: "assistant", content: consentPrompt }, { role: "user", content: "Yes" });
  r = await h.send(history);
  assert.equal(r.body.lead_saved, true);
  assert.equal(h.inserts.length, 1);
  assert.equal(h.inserts[0].values[3], "Test@gmail.com");
  assert.match(h.inserts[0].values[7], /five-page business website/i);
});
test("phone enquiry saves with phone contact", async () => {
  const h = harness();
  const history = [
    { role: "user", content: starter }, { role: "assistant", content: firstQuestion },
    { role: "user", content: "Online store for handmade products" },
    { role: "assistant", content: contactPrompt }, { role: "user", content: "+966 50 123 4567" },
    { role: "assistant", content: consentPrompt }, { role: "user", content: "Yes" }
  ];
  const r = await h.send(history);
  assert.equal(r.body.lead_saved, true);
  assert.equal(h.inserts.length, 1);
  assert.equal(h.inserts[0].values[4], "+966 50 123 4567");
});
test("does not save when consent is declined", async () => {
  const h = harness();
  const history = [
    { role: "user", content: starter }, { role: "assistant", content: firstQuestion },
    { role: "user", content: "Business website" }, { role: "assistant", content: contactPrompt },
    { role: "user", content: "test@example.com" }, { role: "assistant", content: consentPrompt },
    { role: "user", content: "No" }
  ];
  const r = await h.send(history);
  assert.match(r.body.reply, /haven't shared or saved/i);
  assert.equal(h.inserts.length, 0);
});
test("saved conversation cannot create duplicate lead", async () => {
  const h = harness();
  const history = [
    { role: "assistant", content: "Thank you. Your enquiry has been recorded successfully for the NISCO team." },
    { role: "user", content: "Thanks" }
  ];
  const r = await h.send(history);
  assert.equal(r.body.lead_saved, true);
  assert.equal(h.inserts.length, 0);
});
test("database failure never reports a successful submission", async () => {
  const h = harness();
  h.env.DB.prepare = () => ({ bind: () => ({ run: async () => { throw new Error("D1 unavailable"); } }) });
  const history = [
    { role: "user", content: starter }, { role: "assistant", content: firstQuestion },
    { role: "user", content: "Business website" }, { role: "assistant", content: contactPrompt },
    { role: "user", content: "test@example.com" }, { role: "assistant", content: consentPrompt },
    { role: "user", content: "Yes" }
  ];
  const r = await h.send(history);
  assert.equal(r.body.lead_saved, undefined);
  assert.match(r.body.reply, /couldn't save/i);
});


test("answers with approved India starting prices without saving a lead", async () => {
  const h = harness();
  const r = await h.send([{ role: "user", content: "How much does an AI chatbot cost?" }]);
  assert.match(r.body.reply, /starts from ₹10,000/i);
  assert.equal(h.inserts.length, 0);
});

test("shows the complete approved price list when asked generally", async () => {
  const h = harness();
  const r = await h.send([{ role: "user", content: "Can you share your pricing?" }]);
  assert.match(r.body.reply, /business website ₹15,000/i);
  assert.match(r.body.reply, /AI chatbot ₹10,000/i);
  assert.match(r.body.reply, /website maintenance ₹2,000\/month/i);
  assert.match(r.body.reply, /automation support ₹3,000\/month/i);
  assert.equal(h.inserts.length, 0);
});

test("AI chatbot enquiry is guided and saved only after explicit consent", async () => {
  const h = harness();
  const starter = "I need an AI chatbot. Please guide me through an AI chatbot enquiry and ask one question at a time. Start by asking what I want the chatbot to do.";
  const firstQuestion = "What should your chatbot help visitors do—for example, answer FAQs, qualify enquiries, collect leads, or support bookings?";
  const history = [{ role: "user", content: starter }];
  let r = await h.send(history);
  assert.equal(r.body.reply, firstQuestion);
  history.push({ role: "assistant", content: firstQuestion }, { role: "user", content: "Answer FAQs and collect website enquiries." });
  r = await h.send(history);
  assert.equal(r.body.reply, contactPrompt);
  history.push({ role: "assistant", content: contactPrompt }, { role: "user", content: "owner@example.com" });
  r = await h.send(history);
  assert.equal(r.body.reply, consentPrompt);
  history.push({ role: "assistant", content: consentPrompt }, { role: "user", content: "Yes, I agree" });
  r = await h.send(history);
  assert.equal(r.body.lead_saved, true);
  assert.equal(h.inserts.length, 1);
  assert.equal(h.inserts[0].values[6], "AI chatbot");
  assert.match(h.inserts[0].values[7], /Answer FAQs and collect website enquiries/i);
});

test("website maintenance enquiry uses its own guided flow", async () => {
  const h = harness();
  const starter = "I need website maintenance. Please guide me through a website maintenance enquiry and ask one question at a time. Start by asking about my current website.";
  const r = await h.send([{ role: "user", content: starter }]);
  assert.match(r.body.reply, /Is your website already live/i);
  assert.equal(h.inserts.length, 0);
});
