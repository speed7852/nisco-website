const SYSTEM_PROMPT = `You are NISCO AI, the virtual business representative for NISCO. NISCO's brand promise is "Built to Rise. Driven to Grow." Be warm, concise, professional and commercially helpful. Use plain, easy-to-understand language and ask one focused question at a time.

NISCO is based in Chennai, India and serves suitable businesses across India. Public contact email: nisco.in@outlook.com. Do not publish or provide a business phone or WhatsApp number.

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
- If a visitor asks for a human, share only the public email address nisco.in@outlook.com. Do not claim that a human has been notified unless a lead is successfully saved.
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
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin"
    }
  });
}

async function readJsonLimited(request, maxBytes) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maxBytes) return { error: "Request is too large.", status: 413 };
  if (!request.body) return { error: "Request body is required.", status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return { error: "Request is too large.", status: 413 }; }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { data: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch { return { error: "Invalid JSON request.", status: 400 }; }
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
    return "You can contact NISCO in Chennai, India at nisco.in@outlook.com. If you would like the team to review a specific requirement, I can help prepare an enquiry.";
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


const ADMIN_HTML = String.raw\`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101d2d"><title>NISCO Admin</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f8;color:#182333;font:15px system-ui,-apple-system,Segoe UI,sans-serif}.top{background:#101d2d;color:white;padding:18px max(18px,calc((100% - 1080px)/2));display:flex;justify-content:space-between;align-items:center}.brand{font-weight:850;letter-spacing:2px}.brand b{color:#c9a96e}main{max-width:1080px;margin:28px auto;padding:0 16px}.panel{background:#fff;border:1px solid #e2e7ee;border-radius:14px;padding:20px;box-shadow:0 6px 24px #10203008}.login{max-width:420px;margin:9vh auto}h1{margin:0 0 8px}.muted,small{color:#657184}label{display:block;font-weight:650;margin:14px 0 6px}input,select{width:100%;padding:12px;border:1px solid #cbd3de;border-radius:8px;font:inherit;background:white}button{border:0;border-radius:8px;background:#101d2d;color:white;padding:11px 15px;font-weight:650;cursor:pointer}button.gold{background:#c9a96e;color:#182333}button.danger{background:#a52d36}.hidden{display:none!important}.row{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.stat{background:white;border:1px solid #e2e7ee;border-radius:12px;padding:16px}.stat strong{display:block;font-size:26px}.toolbar{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:9px;margin:18px 0}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:690px}th,td{text-align:left;padding:12px 9px;border-bottom:1px solid #e7ebf0;vertical-align:top}th{font-size:12px;color:#657184;text-transform:uppercase}td small{display:block;margin-top:4px}.actions{display:flex;gap:6px}.actions button{padding:8px 10px}.status{padding:10px;background:#edf1f5;border-radius:8px;margin:12px 0}.detail{white-space:pre-wrap;line-height:1.6}.empty{text-align:center;padding:30px;color:#657184}@media(max-width:650px){.toolbar{grid-template-columns:1fr 1fr}.toolbar input{grid-column:1/-1}.stats{grid-template-columns:1fr 1fr}.panel{padding:14px}}
</style></head><body><header class="top"><div class="brand">NISCO<b>.</b> ADMIN</div><button id="logout" class="hidden">Sign out</button></header><main>
<section id="login" class="panel login"><h1>Admin sign in</h1><p class="muted">Private access to NISCO customer enquiries.</p><form id="loginForm"><label for="token">Admin access token</label><input id="token" type="password" autocomplete="current-password" required><button class="gold" style="width:100%;margin-top:16px">Sign in securely</button></form><p id="loginMsg" class="muted" role="status"></p></section>
<section id="dashboard" class="hidden"><div class="row"><div><h1>Enquiry dashboard</h1><p class="muted">Live records from NISCO D1</p></div><button id="refresh">Refresh</button></div><div class="stats"><div class="stat"><span class="muted">Total enquiries</span><strong id="total">—</strong></div><div class="stat"><span class="muted">Today</span><strong id="today">—</strong></div><div class="stat"><span class="muted">Services</span><strong id="services">—</strong></div></div><div id="msg" class="status">Loading…</div>
<div class="toolbar"><input id="search" placeholder="Search name, email, phone or details"><select id="service"><option value="">All services</option></select><select id="period"><option value="">Any date</option><option value="today">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select><button id="apply" class="gold">Apply</button></div>
<div class="panel tablewrap"><table><thead><tr><th>Customer</th><th>Service</th><th>Enquiry</th><th>Received</th><th>Actions</th></tr></thead><tbody id="leads"></tbody></table><div id="empty" class="empty hidden">No enquiries match these filters.</div></div><h2>Recent admin activity</h2><div class="panel" id="audit"><p class="muted">Loading…</p></div></section>
<section id="detail" class="panel hidden"><div class="row"><h2>Enquiry details</h2><button id="back">Back</button></div><div id="detailBody" class="detail"></div></section></main>
<script>
const $=id=>document.getElementById(id);let records=[];
async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});let d={};try{d=await r.json()}catch{}if(!r.ok)throw Error(d.error||'Request failed ('+r.status+')');return d}
function show(id){['login','dashboard','detail'].forEach(x=>$(x).classList.toggle('hidden',x!==id));$('logout').classList.toggle('hidden',id==='login')}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginMsg').textContent='Signing in…';try{await api('/admin/login',{method:'POST',body:JSON.stringify({token:$('token').value})});$('token').value='';show('dashboard');await load()}catch(err){$('loginMsg').textContent=err.message;$('token').value=''}});
$('logout').onclick=async()=>{try{await api('/admin/logout',{method:'POST',body:'{}'})}catch{}show('login')};$('refresh').onclick=load;$('apply').onclick=load;
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function load(){$('msg').textContent='Refreshing…';try{const q=new URLSearchParams({q:$('search').value,service:$('service').value,period:$('period').value});const d=await api('/admin/leads?'+q);records=d.leads||[];$('total').textContent=d.total;$('today').textContent=d.today;$('services').textContent=d.service_count;const selected=$('service').value;const options=[...new Set(records.map(x=>x.service).filter(Boolean))].sort();$('service').innerHTML='<option value="">All services</option>'+options.map(x=>'<option>'+esc(x)+'</option>').join('');$('service').value=selected;$('leads').innerHTML=records.map(x=>'<tr><td><strong>'+esc(x.name||'Not provided')+'</strong><small>'+esc(x.email||x.phone||'No contact')+'</small></td><td>'+esc(x.service)+'</td><td>'+esc(x.summary).slice(0,220)+'<small>'+esc(x.source)+'</small></td><td>'+esc(new Date(x.created_at).toLocaleString())+'</td><td><div class="actions"><button data-view="'+esc(x.id)+'">View</button><button class="danger" data-delete="'+esc(x.id)+'">Delete</button></div></td></tr>').join('');$('empty').classList.toggle('hidden',records.length!==0);$('msg').textContent='Updated just now · '+records.length+' record(s) shown';const a=await api('/admin/audit');$('audit').innerHTML=a.events.length?a.events.map(x=>'<p><strong>'+esc(x.action)+'</strong><small>'+esc(new Date(x.created_at).toLocaleString())+'</small></p>').join(''):'<p class="muted">No admin activity yet.</p>'}catch(e){$('msg').textContent=e.message;if(e.message.includes('Unauthorized'))show('login')}}
$('leads').addEventListener('click',async e=>{const v=e.target.closest('[data-view]'),d=e.target.closest('[data-delete]');if(v){const x=records.find(y=>y.id===v.dataset.view);if(x){$('detailBody').textContent=Object.entries(x).map(([k,val])=>k.replaceAll('_',' ').toUpperCase()+': '+(val??'')).join('\\n\\n');show('detail')}}if(d){const x=records.find(y=>y.id===d.dataset.delete);if(!x||!confirm('Permanently delete this enquiry?'))return;try{await api('/admin/delete-lead',{method:'POST',body:JSON.stringify({lead_id:x.id})});await load()}catch(err){alert(err.message)}}});
$('back').onclick=()=>show('dashboard');(async()=>{try{await api('/admin/session');show('dashboard');await load()}catch{show('login')}})();
</script></body></html>\`;

function adminCookie(value, maxAge) {
  return "nisco_admin=" + value + "; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function signAdminSession(payload, secret) {
  const data = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return data + "." + base64url(sig);
}
async function isAdminSession(request, secret) {
  try {
    const cookie = (request.headers.get("Cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith("nisco_admin="));
    if (!cookie) return false;
    const token = cookie.slice("nisco_admin=".length);
    const [data, signature] = token.split(".");
    if (!data || !signature) return false;
    const raw = atob(data.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - data.length % 4) % 4));
    const payload = JSON.parse(raw);
    if (!payload || payload.exp <= Math.floor(Date.now() / 1000)) return false;
    const expected = await signAdminSession(payload, secret);
    return expected === token;
  } catch { return false; }
}
async function adminRoute(request, env, url) {
  if (!env.ADMIN_API_TOKEN) return json({ error: "Admin access is not configured." }, 503, "");
  const path = url.pathname;
  if (path === "/admin" || path === "/admin/") {
    return new Response(ADMIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" } });
  }
  if (request.method === "POST" && path === "/admin/login") {
    if (request.headers.get("Origin") !== url.origin) return json({ error: "Origin not allowed." }, 403, "");
    const parsed = await readJsonLimited(request, 2048);
    if (parsed.error) return json({ error: parsed.error }, parsed.status, "");
    if (parsed.data?.token !== env.ADMIN_API_TOKEN) return json({ error: "Invalid admin token." }, 401, "");
    const session = await signAdminSession({ exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 }, env.ADMIN_API_TOKEN);
    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": adminCookie(session, 8 * 60 * 60) } });
  }
  if (request.method === "POST" && path === "/admin/logout") {
    if (request.headers.get("Origin") !== url.origin) return json({ error: "Origin not allowed." }, 403, "");
    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": adminCookie("", 0), "Cache-Control": "no-store" } });
  }
  if (!await isAdminSession(request, env.ADMIN_API_TOKEN)) return json({ error: "Unauthorized." }, 401, "");
  if (request.method === "GET" && path === "/admin/session") return json({ authenticated: true }, 200, "");
  if (request.method === "GET" && path === "/admin/leads") {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
    const service = (url.searchParams.get("service") || "").trim().slice(0, 120);
    const period = url.searchParams.get("period") || "";
    const clauses = [], values = [];
    if (q) { clauses.push("(name LIKE ? OR email LIKE ? OR phone LIKE ? OR summary LIKE ?)"); const like = "%" + q.replace(/[%_]/g, "\\export default {
  async scheduled") + "%"; values.push(like, like, like, like); }
    if (service) { clauses.push("service = ?"); values.push(service); }
    if (period === "today") clauses.push("date(created_at) = date('now')");
    if (period === "7" || period === "30") { clauses.push("created_at >= ?"); values.push(new Date(Date.now() - Number(period) * 86400000).toISOString()); }
    const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
    const rows = await env.DB.prepare("SELECT id, created_at, name, email, phone, preferred_contact, service, summary, timeline, consent, source FROM leads" + where + " ORDER BY created_at DESC LIMIT 500").bind(...values).all();
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads").first();
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE date(created_at) = date('now')").first();
    const services = await env.DB.prepare("SELECT COUNT(DISTINCT service) AS n FROM leads").first();
    return json({ leads: rows.results || [], total: total?.n || 0, today: today?.n || 0, service_count: services?.n || 0 }, 200, "");
  }
  if (request.method === "GET" && path === "/admin/audit") {
    const rows = await env.DB.prepare("SELECT created_at, action FROM security_audit_log ORDER BY created_at DESC LIMIT 20").all();
    return json({ events: rows.results || [] }, 200, "");
  }
  if (request.method === "POST" && path === "/admin/delete-lead") {
    if (request.headers.get("Origin") !== url.origin) return json({ error: "Origin not allowed." }, 403, "");
    const parsed = await readJsonLimited(request, 1024);
    if (parsed.error) return json({ error: parsed.error }, parsed.status, "");
    const id = typeof parsed.data?.lead_id === "string" ? parsed.data.lead_id.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "A valid lead_id is required." }, 400, "");
    const deleted = await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(id).run();
    if (deleted.meta?.changes === 1) await env.DB.prepare("INSERT INTO security_audit_log (created_at, action) VALUES (?, 'admin-lead-deleted')").bind(new Date().toISOString()).run();
    return json({ success: true, deleted: deleted.meta?.changes === 1 }, 200, "");
  }
  return json({ error: "Not found" }, 404, "");
}


export default {
  async scheduled(controller, env) {
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare("DELETE FROM leads WHERE created_at < ?").bind(cutoff).run();
    await env.DB.prepare("DELETE FROM lead_consent_challenges WHERE expires_at < ? OR used_at IS NOT NULL").bind(now).run();
    await env.DB.prepare("DELETE FROM security_audit_log WHERE created_at < ?").bind(new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString()).run();
    await env.DB.prepare("INSERT INTO security_audit_log (created_at, action) VALUES (?, 'scheduled-retention-cleanup')").bind(now).run();
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      if (!["/admin", "/admin/"].includes(pathname) && request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) return new Response("Origin not allowed", { status: 403 });
      if (!env.DB && !["/admin", "/admin/"].includes(pathname)) return json({ error: "Enquiry storage is not configured yet." }, 503, "");
      return adminRoute(request, env, url);
    }
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "https://nisco-website.pages.dev";
    if (origin && origin !== allowed) return new Response("Origin not allowed", { status: 403 });
    if (!origin && pathname !== "/admin/delete-lead") return new Response("Origin required", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400", "Vary": "Origin" } });
    if (request.method !== "POST" || !["/chat", "/enquiry", "/admin/delete-lead"].includes(pathname)) return json({ error: "Not found" }, 404, allowed);
    if (!env.DB) return json({ error: "Enquiry storage is not configured yet." }, 503, allowed);
    if (pathname === "/admin/delete-lead") {
      if (!env.ADMIN_API_TOKEN) return json({ error: "Administrative deletion is not configured." }, 503, allowed);
      const auth = request.headers.get("Authorization") || "";
      if (!auth.startsWith("Bearer ") || auth.slice(7) !== env.ADMIN_API_TOKEN) return json({ error: "Unauthorized." }, 401, allowed);
      const parsed = await readJsonLimited(request, 1024);
      if (parsed.error) return json({ error: parsed.error }, parsed.status, allowed);
      const leadId = typeof parsed.data?.lead_id === "string" ? parsed.data.lead_id.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(leadId)) return json({ error: "A valid lead_id is required." }, 400, allowed);
      const deleted = await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(leadId).run();
      if (deleted.meta?.changes === 1) await env.DB.prepare("INSERT INTO security_audit_log (created_at, action) VALUES (?, 'admin-lead-deleted')").bind(new Date().toISOString()).run();
      return json({ success: true, deleted: deleted.meta?.changes === 1 }, 200, allowed);
    }
    const limiter = pathname === "/enquiry" ? env.ENQUIRY_RATE_LIMITER : env.CHAT_RATE_LIMITER;
    if (!limiter) return json({ error: "Request protection is not configured yet." }, 503, allowed);
    const clientKey = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success: withinLimit } = await limiter.limit({ key: clientKey });
    if (!withinLimit) return json({ error: "Too many requests. Please wait a moment and try again." }, 429, allowed);

    if (pathname === "/enquiry") {
      if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
        return json({ error: "Email delivery is not configured yet. Please try again later." }, 503, allowed);
      }
      if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) return json({ error: "Content-Type must be application/json." }, 415, allowed);
      const parsed = await readJsonLimited(request, 6000);
      if (parsed.error) return json({ error: parsed.error }, parsed.status, allowed);
      const enquiry = parsed.data;
      if (!enquiry || typeof enquiry !== "object" || Array.isArray(enquiry)) return json({ error: "Invalid enquiry." }, 400, allowed);
      if (typeof enquiry.website === "string" && enquiry.website.trim()) return json({ success: true }, 200, allowed);
      const name = typeof enquiry.name === "string" ? enquiry.name.trim() : "";
      const customerEmail = typeof enquiry.email === "string" ? enquiry.email.trim() : "";
      const business = typeof enquiry.business === "string" ? enquiry.business.trim() : "";
      const service = typeof enquiry.service === "string" ? enquiry.service.trim() : "";
      const budget = typeof enquiry.budget === "string" ? enquiry.budget.trim() : "";
      const requirement = typeof enquiry.requirement === "string" ? enquiry.requirement.trim() : "";
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!name || name.length > 100 || !emailPattern.test(customerEmail) || customerEmail.length > 254 ||
          business.length > 120 || !service || service.length > 120 || budget.length > 80 ||
          !requirement || requirement.length > 1200 || enquiry.consent !== true) {
        return json({ error: "Please complete the required fields and agree to share your enquiry." }, 400, allowed);
      }
      const details = [
        "A new enquiry has been submitted through the NISCO website.",
        "",
        "Name: " + name,
        "Customer email: " + customerEmail,
        "Business: " + (business || "Not provided"),
        "Service: " + service,
        "Budget: " + (budget || "Not provided"),
        "",
        "Requirement:",
        requirement,
        "",
        "Source: NISCO website consultation form"
      ].join("\n");
      try {
        const mailResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "accept": "application/json",
            "api-key": env.BREVO_API_KEY,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            sender: { name: "NISCO Website", email: env.BREVO_SENDER_EMAIL },
            to: [{ email: "nisco.in@outlook.com", name: "NISCO" }],
            replyTo: { email: customerEmail, name },
            subject: "New NISCO enquiry: " + service,
            textContent: details
          })
        });
        if (!mailResponse.ok) {
          console.error("NISCO email delivery failed", mailResponse.status);
          return json({ error: "We couldn't send your enquiry just now. Please try again shortly." }, 502, allowed);
        }
        const messageId = (await mailResponse.json()).messageId || "";
        await env.DB.prepare(
          "INSERT INTO leads (id, created_at, name, email, phone, preferred_contact, service, summary, timeline, consent, source) VALUES (?, ?, ?, ?, '', 'email', ?, ?, '', 1, 'website-form')"
        ).bind(
          crypto.randomUUID(), new Date().toISOString(), name, customerEmail,
          service, ("Business: " + business + " | Budget: " + budget + " | " + requirement).slice(0, 2000)
        ).run();
        return json({ success: true, message_id: messageId }, 200, allowed);
      } catch (error) {
        console.error("NISCO enquiry processing failed", error);
        return json({ error: "We couldn't send your enquiry just now. Please try again shortly." }, 502, allowed);
      }
    }
    if (!env.AI) return json({ error: "Cloudflare Workers AI binding is not configured yet." }, 503, allowed);

    if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) return json({ error: "Content-Type must be application/json." }, 415, allowed);
    const parsed = await readJsonLimited(request, 12000);
    if (parsed.error) return json({ error: parsed.error }, parsed.status, allowed);
    const body = parsed.data;
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request." }, 400, allowed);
    if (!validMessages(body.messages)) return json({ error: "Please send a valid message (up to 2,000 characters)." }, 400, allowed);

    if (body.consent_token) {
      const lastMessage = body.messages.filter(m => m.role === "user").at(-1)?.content.trim().toLowerCase() || "";
      const affirmative = /^(yes|yes please|yes[, ]+i agree|i agree|i consent|okay|ok|sure|that's fine|go ahead|you may share)[.! ]*$/i.test(lastMessage);
      const negative = /^(no|no thanks|i do not consent|don't share)[.! ]*$/i.test(lastMessage);
      if (!affirmative && !negative) return json({ reply: "Please reply Yes to agree to share your enquiry with NISCO, or No to decline." }, 200, allowed);
      const challenge = await env.DB.prepare("SELECT * FROM lead_consent_challenges WHERE id = ?").bind(String(body.consent_token).slice(0, 64)).first();
      if (!challenge || challenge.used_at || Date.parse(challenge.expires_at) <= Date.now()) return json({ reply: "This consent request has expired. Please start a new enquiry if you would like the NISCO team to contact you." }, 200, allowed);
      if (negative) {
        await env.DB.prepare("UPDATE lead_consent_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(new Date().toISOString(), challenge.id).run();
        return json({ reply: "No problem. I haven't saved or shared your details." }, 200, allowed);
      }
      const consumed = await env.DB.prepare("UPDATE lead_consent_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?").bind(new Date().toISOString(), challenge.id, new Date().toISOString()).run();
      if (consumed.meta?.changes !== 1) return json({ reply: "This consent request has already been used or has expired. Please start a new enquiry." }, 200, allowed);
      try {
        const saved = await captureLead({ email: challenge.email, phone: challenge.phone, preferred_contact: challenge.email ? "email" : "phone", service: challenge.service, summary: challenge.summary, consent: true }, env);
        if (!saved?.ok) return json({ reply: "I couldn't save the enquiry just now. Your details haven't been submitted. Please try again shortly." }, 200, allowed);
        return json({ reply: "Thank you. Your enquiry has been recorded successfully for the NISCO team. They can review your requirements and contact you using the details you provided.", lead_saved: true }, 200, allowed);
      } catch (error) { console.error("NISCO lead capture failed", error); return json({ reply: "I couldn't save the enquiry just now. Your details haven't been submitted. Please try again shortly." }, 200, allowed); }
    }

    const userMessages = body.messages.filter(m => m.role === "user");
    const assistantMessages = body.messages.filter(m => m.role === "assistant");
    const lastUserMessage = userMessages[userMessages.length - 1]?.content || "";
    const lower = lastUserMessage.trim().toLowerCase();

    const starter = userMessages.find(m => /please guide me through (?:a|an) (website|digital marketing|business transformation|business automation|ai chatbot|website maintenance|automation support) enquiry/i.test(m.content));
    if (starter) {
      const flow = GUIDED_FLOWS.find(item => item.pattern.test(starter.content));
      if (!flow) return json({ reply: "Please tell me which NISCO service you would like to discuss: website, automation, AI chatbot, digital marketing or ongoing support." }, 200, allowed);

      const service = flow.service;
      const firstQuestion = flow.firstQuestion;
      const askedFirst = assistantMessages.some(m => m.content === firstQuestion);
      const contactPrompt = "To prepare your enquiry, please share the email address or phone number the NISCO team should use to contact you.";
      const consentPrompt = "Before I save this enquiry: your contact details and requirement summary will be stored in NISCO's enquiry database for the team to review and follow up. No automatic WhatsApp or email will be sent. Do you agree to share and save these details?";
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
      if (!askedConsent) {
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await env.DB.prepare("INSERT INTO lead_consent_challenges (id, created_at, expires_at, email, phone, service, summary) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(token, new Date().toISOString(), expiresAt, email, phone, service, summary || service).run();
        return json({ reply: consentPrompt, consent_token: token }, 200, allowed);
      }
      return json({ reply: consentPrompt + " Please use the consent prompt shown above to continue." }, 200, allowed);
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
