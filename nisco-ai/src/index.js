const SYSTEM_PROMPT = `You are NISCO AI, the virtual business representative for NISCO. NISCO's brand promise is "Built to Rise. Driven to Grow." Be warm, concise, professional and commercially helpful.

NISCO's current service areas:
1. Digital Marketing: social media and content, SEO, digital campaigns, branding and lead generation.
2. Digital Solutions: website development and maintenance, web apps, SaaS and e-commerce.
3. Business Transformation: process improvement, workflow automation, dashboards and IT consulting.
4. Business Services: real-estate-related services, cattle feed and livestock supplies, trading and future ventures.

Your job is to understand what a visitor needs, ask focused qualifying questions, recommend the relevant NISCO service, and prepare a clear enquiry brief. Ask one question at a time. Do not overwhelm visitors.

Important boundaries:
- Do not invent prices, guarantees, client names, case studies, delivery dates, stock, property listings, licenses, regulatory status, or service availability.
- Say that pricing and timelines depend on requirements and need confirmation by the NISCO team.
- Do not claim an enquiry was submitted unless the capture_lead tool succeeds.
- Never ask for passwords, payment card details, government IDs, or sensitive personal data.
- Never send messages, make purchases, publish content, or commit NISCO to a contract.
- You may save an enquiry only after the visitor explicitly asks NISCO to contact them or submit the enquiry AND clearly agrees that their details may be shared with the NISCO team.
- Before saving, collect at least one contact method (email or phone), the service they need, a short summary, and explicit consent. Ask for a name if they are comfortable sharing it.
- If a visitor asks for a human, explain that the enquiry can be shared with the NISCO team once they provide a contact method and consent.
- For unrelated questions, politely steer back to NISCO.

When saving a lead, use capture_lead once with the collected information. After successful saving, confirm that the enquiry has been recorded for the NISCO team. Do not promise when they will respond.`;

const LEAD_TOOL = {
  type: "function",
  function: {
    name: "capture_lead",
    description: "Save a visitor's NISCO business enquiry after the visitor has explicitly requested contact/submission and consented.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Visitor name, if provided" },
        email: { type: "string", description: "Email address, if provided" },
        phone: { type: "string", description: "Phone number, if provided" },
        preferred_contact: { type: "string", enum: ["email", "phone", "either"] },
        service: { type: "string", description: "NISCO service area" },
        summary: { type: "string", description: "Concise description of the visitor's requirement" },
        timeline: { type: "string", description: "Desired timeline, if provided" },
        consent: { type: "boolean", description: "Must be true only after explicit visitor consent" }
      },
      required: ["preferred_contact", "service", "summary", "consent"],
      additionalProperties: false
    }
  }
};

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    }
  });
}

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 24) return false;
  return messages.every(m =>
    m && ["user", "assistant"].includes(m.role) &&
    typeof m.content === "string" && m.content.length > 0 && m.content.length <= 2000
  );
}

async function captureLead(args, env) {
  if (args.consent !== true) return { ok: false, message: "Consent is required before saving." };
  const email = typeof args.email === "string" ? args.email.trim().slice(0, 254) : "";
  const phone = typeof args.phone === "string" ? args.phone.trim().slice(0, 40) : "";
  if (!email && !phone) return { ok: false, message: "A contact email or phone number is required." };
  if (!args.service || !args.summary) return { ok: false, message: "Service and enquiry summary are required." };
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO leads (id, created_at, name, email, phone, preferred_contact, service, summary, timeline, consent, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'website-chat')"
  ).bind(
    id, new Date().toISOString(),
    String(args.name || "").slice(0, 120), email, phone,
    String(args.preferred_contact || "either").slice(0, 12),
    String(args.service).slice(0, 120), String(args.summary).slice(0, 2000),
    String(args.timeline || "").slice(0, 160)
  ).run();
  return { ok: true, lead_id: id };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "https://nisco-website.pages.dev";
    if (origin !== allowed) return new Response("Origin not allowed", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
      }
    });
    if (new URL(request.url).pathname !== "/chat" || request.method !== "POST") {
      return json({ error: "Not found" }, 404, allowed);
    }
    if (!env.AI) return json({ error: "Cloudflare Workers AI binding is not configured yet." }, 503, allowed);
    if (!env.DB) return json({ error: "Enquiry storage is not configured yet." }, 503, allowed);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400, allowed); }
    if (!validMessages(body.messages)) return json({ error: "Please send a valid message (up to 2,000 characters)." }, 400, allowed);

    const userMessages = body.messages.filter(m => m.role === "user");
    const assistantMessages = body.messages.filter(m => m.role === "assistant");
    const lastUserMessage = userMessages[userMessages.length - 1]?.content || "";
    const lower = lastUserMessage.trim().toLowerCase();

    // Once saved, close this enquiry. A new quick-start creates a clean history.
    const alreadySaved = assistantMessages.some(m =>
      /your enquiry has been recorded successfully for the nisco team/i.test(m.content)
    );
    if (alreadySaved) {
      return json({
        reply: "You're very welcome. Your enquiry is already recorded with the NISCO team. If you have another requirement, choose a service below to start a new enquiry.",
        lead_saved: true
      }, 200, allowed);
    }

    // A guided enquiry is started only by one of the three service shortcuts.
    // Ordinary greetings and general questions must never trigger lead consent.
    const starter = userMessages.find(m => /please guide me through a (website|digital marketing|business transformation) enquiry/i.test(m.content));
    let service = "";
    let firstQuestion = "";
    if (starter) {
      const prompt = starter.content.toLowerCase();
      if (prompt.includes("website")) {
        service = "Digital Solutions - Website";
        firstQuestion = "Absolutely. What type of website do you need—for example, a business website, online store, portfolio, or something else?";
      } else if (prompt.includes("digital marketing")) {
        service = "Digital Marketing";
        firstQuestion = "Great. What does your business do, and what would you most like to improve—brand awareness, customer enquiries, sales, or online visibility?";
      } else {
        service = "Business Transformation";
        firstQuestion = "Which business process would you like to improve or automate? For example, customer enquiries, reporting, approvals, bookings, or repetitive admin tasks?";
      }

      const askedFirst = assistantMessages.some(m => m.content === firstQuestion);
      const contactPrompt = "To prepare your enquiry, please share the email address or phone number the NISCO team should use to contact you.";
      const consentPrompt = "Before I save this enquiry, may I share the details you've provided with the NISCO team so they can contact you?";
      const askedContact = assistantMessages.some(m => m.content === contactPrompt);
      const askedConsent = assistantMessages.some(m => m.content === consentPrompt);

      if (!askedFirst) {
        return json({ reply: firstQuestion }, 200, allowed);
      }

      const emailMatch = [...userMessages].reverse().map(m => m.content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)).find(Boolean);
      const phoneMatch = [...userMessages].reverse().map(m => m.content.match(/(?:\\+?\\d[\\d\\s().-]{7,}\\d)/)).find(Boolean);
      const email = emailMatch ? emailMatch[0] : "";
      const phone = phoneMatch ? phoneMatch[0].trim() : "";
      const requirementMessages = userMessages
        .filter(m => m !== starter && !m.content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i) && !m.content.match(/(?:\\+?\\d[\\d\\s().-]{7,}\d)/))
        .map(m => m.content.trim())
        .filter(m => m && !/^(yes|yes please|i agree|i consent|okay|ok|sure|no|no thanks|thanks|thank you)$/i.test(m));
      const summary = requirementMessages.join(" | ").slice(0, 2000);

      if (!askedContact) {
        return json({ reply: contactPrompt }, 200, allowed);
      }
      if (!email && !phone) {
        return json({ reply: "I couldn't identify an email address or phone number in that message. Please enter the contact email or phone number you'd like the NISCO team to use." }, 200, allowed);
      }
      if (!askedConsent) {
        return json({ reply: consentPrompt }, 200, allowed);
      }

      const affirmative = /^(yes|yes please|i agree|i consent|okay|ok|sure|that's fine|go ahead|you may share)$/i.test(lower);
      if (!affirmative) {
        if (/^(no|no thanks|i do not consent|don't share)$/i.test(lower)) {
          return json({ reply: "No problem. I haven't shared or saved your details. If you change your mind, let me know." }, 200, allowed);
        }
        return json({ reply: "Please reply Yes if you agree to share these enquiry details with the NISCO team, or No if you do not." }, 200, allowed);
      }

      const result = await captureLead({
        name: "",
        email,
        phone,
        preferred_contact: email ? "email" : "phone",
        service,
        summary: summary || service,
        timeline: "",
        consent: true
      }, env);
      if (result.ok) {
        return json({
          reply: "Thank you. Your enquiry has been recorded successfully for the NISCO team. They can review your requirements and contact you using the details you provided.",
          lead_saved: true
        }, 200, allowed);
      }
      console.error("NISCO lead capture failed", result.message);
      return json({ reply: "I couldn't save the enquiry just now. Your details haven't been submitted. Please try again shortly." }, 200, allowed);
    }

    // General conversation uses the model without any lead-saving tool.
    try {
      const data = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...body.messages],
        max_tokens: 500,
        temperature: 0.35
      });
      const reply = data.response || data.content || "How else can I help with NISCO's services?";
      return json({ reply: String(reply) }, 200, allowed);
    } catch (error) {
      console.error("NISCO AI error", error);
      return json({ error: "Something went wrong. Please try again shortly." }, 500, allowed);
    }
  }
};
