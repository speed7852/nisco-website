const SYSTEM_PROMPT = `You are NISCO AI, the virtual business representative for NISCO. NISCO's brand promise is "Built to Rise. Driven to Grow." Be warm, concise, professional and commercially helpful. Use plain, easy-to-understand language and ask one focused question at a time.

NISCO is based in Chennai, India and serves suitable businesses across India. Public contact: Catchnoor@live.in and WhatsApp +91 98945 77373.

NISCO's services:
1. Digital Marketing: social media and content, SEO, digital campaigns, branding and lead generation. This is quoted after understanding the goals; no public starting price is published.
2. Digital Solutions: business website development, website maintenance, web apps, SaaS and e-commerce.
3. Business Transformation: process improvement, Excel/Google Sheets automation, workflow automation, reporting and Power BI dashboards, and IT consulting.
4. AI Chatbots: website chatbot setup, business FAQ configuration, guided enquiries and consent-based lead capture.
5. Business Services: real-estate-related services, cattle feed and livestock supplies, trading and future ventures. Availability is subject to the specific activity, local regulations and applicable authorisations; do not imply every service is currently available.

Approved India starting prices (INR):
- Business website: ₹15,000 onwards.
- Business automation: ₹15,000 onwards.
- AI chatbot: ₹10,000 onwards.
- Website maintenance: ₹2,000 per month onwards.
- Automation support: ₹3,000 per month onwards.
These are indicative starting prices, not fixed quotations. Final pricing depends on scope, content, integrations and delivery requirements. Domain, hosting, paid licences, third-party subscriptions, taxes and advertising spend are excluded unless the written quotation says otherwise. Do not invent any other price.

Your job is to understand what a visitor needs, ask focused qualifying questions, recommend the relevant NISCO service, and prepare a clear enquiry brief. Ask one question at a time. Do not overwhelm visitors.

Important boundaries:
- Do not invent guarantees, client names, case studies, delivery dates, stock, property listings, licences, regulatory status, or service availability.
- Do not promise a delivery date or final quotation. Explain that the NISCO team will confirm scope, price and timeline in writing.
- Do not claim an enquiry was submitted unless the capture_lead operation succeeds.
- Never ask for passwords, payment card details, government IDs, or sensitive personal data.
- Never send messages, make purchases, publish content, or commit NISCO to a contract.
- You may save an enquiry only after the visitor explicitly asks NISCO to contact them or submit the enquiry AND clearly agrees that their details may be shared with the NISCO team.
- Before saving, collect at least one contact method (email or phone), the service they need, a short summary, and explicit consent. Ask for a name only if they are comfortable sharing it.
- If a visitor asks for a human, share the public email and WhatsApp details. Do not claim that a human has been notified unless a lead is successfully saved.
- For unrelated questions, answer briefly when useful, then politely steer back to NISCO.

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

const GUIDED_FLOWS = [
  {
    pattern: /website maintenance|maintenance enquiry/,
    service: "Website maintenance",
    firstQuestion: "Certainly. Is your website already live? If so, which platform is it built on, and what kind of maintenance or support do you need?"
  },
  {
    pattern: /automation support/,
    service: "Automation support",
    firstQuestion: "What automation or reporting solution do you already use, and what would you like NISCO to maintain or improve?"
  },
  {
    pattern: /ai chatbot|chatbot enquiry/,
    service: "AI chatbot",
    firstQuestion: "What should your chatbot help visitors do—for example, answer FAQs, qualify enquiries, collect leads, or support bookings?"
  },
  {
    pattern: /business automation|business transformation/,
    service: "Business automation",
    firstQuestion: "Which business process would you like to improve or automate—for example, customer enquiries, reporting, approvals, bookings, or repetitive admin tasks?"
  },
  {
    pattern: /digital marketing/,
    service: "Digital Marketing",
    firstQuestion: "What does your business do, and what would you most like to improve—brand awareness, customer enquiries, sales, or online visibility?"
  },
  {
    pattern: /website/,
    service: "Business website",
    firstQuestion: "Absolutely. What type of website do you need—for example, a business website, online store, portfolio, or something else?"
  }
];

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

function getBusinessInfoReply(message) {
  const lower = message.toLowerCase();
  const asksPrice = /\b(price|pricing|cost|how much|rate|charges|starting price|budget)\b/.test(lower);
  if (asksPrice) {
    if (/maintenance/.test(lower)) return "Website maintenance starts from ₹2,000 per month. The final plan depends on the website platform, updates, backups, security and support scope.";
    if (/automation support/.test(lower)) return "Automation support starts from ₹3,000 per month. The final plan depends on the workflows, reporting and support required.";
    if (/chatbot|ai assistant/.test(lower)) return "NISCO AI chatbot setup starts from ₹10,000. The final price depends on the FAQ content, enquiry flow, integrations and deployment requirements.";
    if (/automation|power bi|dashboard|workflow/.test(lower)) return "Business automation starts from ₹15,000. The final price depends on the process, integrations, reporting and complexity.";
    if (/website|web site|online store|ecommerce|e-commerce/.test(lower)) return "A NISCO business website starts from ₹15,000. The listed package covers a responsive website of up to five core pages, contact/enquiry links, basic on-page SEO setup, deployment and handover. Final scope is confirmed in a written quotation.";
    return "NISCO's indicative India starting prices are: business website ₹15,000; business automation ₹15,000; AI chatbot ₹10,000; website maintenance ₹2,000/month; and automation support ₹3,000/month. Digital marketing and other business services are quoted after understanding the requirement. These are starting prices, not fixed quotations. Domain, hosting, paid licences, third-party subscriptions, taxes and advertising spend are excluded unless stated in the quotation.";
  }
  if (/\b(contact|whatsapp|phone number|email address|speak to someone|human|call you)\b/.test(lower)) {
    return "You can contact NISCO in Chennai, India at Catchnoor@live.in or on WhatsApp at +91 98945 77373. If you would like the team to review a specific requirement, I can help prepare an enquiry.";
  }
  if (/\b(where are you|location|based in|which city)\b/.test(lower)) {
    return "NISCO is based in Chennai, India and can discuss suitable remote projects with businesses across India.";
  }
  return "";
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

    const alreadySaved = assistantMessages.some(m =>
      /your enquiry has been recorded successfully for the nisco team/i.test(m.content)
    );
    if (alreadySaved) {
      return json({
        reply: "You're very welcome. Your enquiry is already recorded with the NISCO team. If you have another requirement, choose a service below to start a new enquiry.",
        lead_saved: true
      }, 200, allowed);
    }

    const starter = userMessages.find(m => /please guide me through a (website|digital marketing|business transformation|business automation|ai chatbot|website maintenance|automation support) enquiry/i.test(m.content));
    if (starter) {
      const flow = GUIDED_FLOWS.find(item => item.pattern.test(starter.content));
      if (!flow) return json({ reply: "Please tell me which NISCO service you would like to discuss: website, automation, AI chatbot, digital marketing or ongoing support." }, 200, allowed);

      const service = flow.service;
      const firstQuestion = flow.firstQuestion;
      const askedFirst = assistantMessages.some(m => m.content === firstQuestion);
      const contactPrompt = "To prepare your enquiry, please share the email address or phone number the NISCO team should use to contact you.";
      const consentPrompt = "Before I save this enquiry, may I share the details you've provided with the NISCO team so they can contact you?";
      const askedContact = assistantMessages.some(m => m.content === contactPrompt);
      const askedConsent = assistantMessages.some(m => m.content === consentPrompt);

      if (!askedFirst) return json({ reply: firstQuestion }, 200, allowed);

      const emailMatch = [...userMessages].reverse().map(m => m.content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)).find(Boolean);
      const phoneMatch = [...userMessages].reverse().map(m => m.content.match(/(?:\+?\d[\d\s().-]{7,}\d)/)).find(Boolean);
      const email = emailMatch ? emailMatch[0] : "";
      const phone = phoneMatch ? phoneMatch[0].trim() : "";
      const requirementMessages = userMessages
        .filter(m => m !== starter && !m.content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) && !m.content.match(/(?:\+?\d[\d\s().-]{7,}\d)/))
        .map(m => m.content.trim())
        .filter(m => m && !/^(yes|yes please|i agree|i consent|okay|ok|sure|no|no thanks|thanks|thank you)$/i.test(m));
      const summary = requirementMessages.join(" | ").slice(0, 2000);

      if (!askedContact) return json({ reply: contactPrompt }, 200, allowed);
      if (!email && !phone) return json({ reply: "I couldn't identify an email address or phone number in that message. Please enter the contact email or phone number you'd like the NISCO team to use." }, 200, allowed);
      if (!askedConsent) return json({ reply: consentPrompt }, 200, allowed);

      const affirmative = /^(yes|yes please|i agree|i consent|okay|ok|sure|that's fine|go ahead|you may share)$/i.test(lower);
      if (!affirmative) {
        if (/^(no|no thanks|i do not consent|don't share)$/i.test(lower)) {
          return json({ reply: "No problem. I haven't shared or saved your details. If you change your mind, let me know." }, 200, allowed);
        }
        return json({ reply: "Please reply Yes if you agree to share these enquiry details with the NISCO team, or No if you do not." }, 200, allowed);
      }

      try {
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
      } catch (error) {
        console.error("NISCO lead capture failed", error);
      }
      return json({ reply: "I couldn't save the enquiry just now. Your details haven't been submitted. Please try again shortly." }, 200, allowed);
    }

    const businessInfoReply = getBusinessInfoReply(lastUserMessage);
    if (businessInfoReply) return json({ reply: businessInfoReply }, 200, allowed);

    try {
      const data = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...body.messages],
        max_tokens: 500,
        temperature: 0.25
      });
      const reply = data.response || data.content || "How else can I help with NISCO's services?";
      return json({ reply: String(reply) }, 200, allowed);
    } catch (error) {
      console.error("NISCO AI error", error);
      return json({ error: "Something went wrong. Please try again shortly." }, 500, allowed);
    }
  }
};
