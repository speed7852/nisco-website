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
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 12) return false;
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

    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...body.messages];
    try {
      for (let step = 0; step < 4; step++) {
        const data = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages,
          tools: [{
            name: "capture_lead",
            description: LEAD_TOOL.function.description,
            parameters: LEAD_TOOL.function.parameters
          }],
          max_tokens: 650,
          temperature: 0.35
        });
        const calls = Array.isArray(data.tool_calls) ? data.tool_calls : [];
        if (!calls.length) {
          const reply = data.response || data.content || "How else can I help with your NISCO enquiry?";
          return json({ reply: String(reply) }, 200, allowed);
        }

        for (const call of calls) {
          if (call.name !== "capture_lead") continue;
          const result = await captureLead(call.arguments || {}, env);
          messages.push({
            role: "assistant",
            content: JSON.stringify({ tool: call.name, arguments: call.arguments || {} })
          });
          messages.push({ role: "tool", content: JSON.stringify(result) });
        }
      }
      return json({ reply: "I've gathered the details. Is there anything else you'd like to add to your enquiry?" }, 200, allowed);
    } catch (error) {
      console.error("NISCO AI error", error);
      return json({ error: "Something went wrong. Please try again shortly." }, 500, allowed);
    }
  }
};
