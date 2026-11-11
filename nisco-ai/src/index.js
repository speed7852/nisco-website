import { handleMcp } from "./mcp.js";
const SYSTEM_PROMPT = \`Language policy:
- Support English and Modern Standard Arabic. Detect the latest user message language and reply in that language unless the visitor asks otherwise.
- For Arabic, use clear professional Modern Standard Arabic. Preserve NISCO facts and approved prices exactly, and identify prices as Indian rupees (INR), not Saudi riyals.
- Never translate or alter the public email nisco.in@outlook.com.
- Keep answers concise, ask one focused question at a time, and do not mix languages unless the visitor does.

You are NISCO AI, the virtual business representative for NISCO. NISCO's brand promise is "Built to Rise. Driven to Grow." Be warm, concise, professional and commercially helpful. Use plain, easy-to-understand language and ask one focused question at a time.

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
  if (/[؀-ۿ]/.test(message)) {
    if (/سعر|الأسعار|التكلفة|كم يكلف|كم السعر|تكلفة/.test(message)) {
      if (/صيانة/.test(message)) return "تبدأ صيانة المواقع لدى NISCO من 2,000 روبية هندية شهرياً. تعتمد الخطة النهائية على المنصة والتحديثات والنسخ الاحتياطي والأمان ونطاق الدعم.";
      if (/روبوت|شات بوت|محادث/.test(message)) return "يبدأ إعداد روبوت المحادثة بالذكاء الاصطناعي لدى NISCO من 10,000 روبية هندية. يعتمد السعر النهائي على المحتوى ومسار الاستفسارات والتكاملات ومتطلبات النشر.";
      if (/أتمتة|تلقائي|لوحة معلومات|باور بي آي/.test(message)) return "تبدأ خدمات أتمتة الأعمال من 15,000 روبية هندية. تعتمد التكلفة النهائية على العمليات والتكاملات والتقارير ومدى التعقيد.";
      if (/موقع|ويب|متجر إلكتروني/.test(message)) return "يبدأ إنشاء موقع الأعمال لدى NISCO من 15,000 روبية هندية. السعر استرشادي ويعتمد العرض النهائي على نطاق العمل والمحتوى والتكاملات.";
      return "الأسعار الاسترشادية في الهند: موقع الأعمال 15,000 روبية هندية، أتمتة الأعمال 15,000 روبية، روبوت المحادثة 10,000 روبية، صيانة الموقع 2,000 روبية شهرياً، ودعم الأتمتة 3,000 روبية شهرياً. هذه أسعار بداية وليست عروضاً نهائية.";
    }
    if (/تواصل|واتساب|رقم الهاتف|البريد|شخص|موظف/.test(message)) return "يمكنك التواصل مع NISCO عبر البريد الإلكتروني nisco.in@outlook.com. يمكنني أيضاً مساعدتك في إعداد استفسار لفريق NISCO.";
    if (/أين|الموقع|مقر|المدينة/.test(message)) return "يقع مقر NISCO في تشيناي، الهند، ويمكن للفريق مناقشة المشاريع المناسبة عن بُعد مع الشركات في الهند.";
  }

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


const ADMIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NISCO Admin</title><style>body{font:15px system-ui;background:#f3f5f8;color:#172536;margin:0}header{background:#101d2d;color:white;padding:18px 5%;font-weight:800}main{max-width:1000px;margin:24px auto;padding:0 14px}.card{background:white;border:1px solid #ddd;border-radius:12px;padding:18px;margin:14px 0}input,select{padding:11px;border:1px solid #ccd4df;border-radius:7px;margin:5px}button{padding:10px 14px;border:0;border-radius:7px;background:#14263c;color:white}table{width:100%;border-collapse:collapse;min-width:600px}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}.wrap{overflow:auto}.hidden{display:none}.row{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.stats{display:flex;gap:10px}.stats div{background:white;padding:14px;border:1px solid #ddd;border-radius:9px;flex:1}.stats b{display:block;font-size:24px}.muted{color:#667}</style></head><body><header>NISCO ADMIN</header><main><section id="login" class="card"><h2>Admin sign in</h2><form id="form"><input id="token" type="password" placeholder="Admin API token" required><button>Sign in</button></form><p id="notice"></p></section><section id="app" class="hidden"><p id="appNotice" role="status"></p><div class="row"><h1>Customer enquiries</h1><button id="refresh">Refresh</button></div><div class="stats"><div>Total<b id="total">0</b></div><div>Today<b id="today">0</b></div><div>Services<b id="services">0</b></div></div><div class="card"><input id="q" placeholder="Search enquiries"><select id="period"><option value="">All dates</option><option value="today">Today</option><option value="7">7 days</option><option value="30">30 days</option></select><button id="filter">Search</button></div><div class="card wrap"><table><thead><tr><th>Customer</th><th>Service</th><th>Requirement</th><th>Date</th><th></th></tr></thead><tbody id="rows"></tbody></table></div><h2>Audit activity</h2><div id="audit" class="card"></div><button id="logout">Sign out</button></section></main><script>
const $=x=>document.getElementById(x);let list=[];async function api(p,o={}){let r;try{r=await fetch(p,{credentials:"same-origin",cache:"no-store",...o,headers:{"Content-Type":"application/json",...(o.headers||{})}})}catch(e){throw Error("Network error: "+e.message)}let raw=await r.text(),d;try{d=JSON.parse(raw)}catch{throw Error("Server returned HTTP "+r.status+" with an unreadable response: "+raw.slice(0,160))}if(!r.ok)throw Error(d.error||("HTTP "+r.status));return d}function esc(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}async function load(){try{let d=await api('/admin/leads?q='+encodeURIComponent($('q').value)+'&period='+$('period').value);list=d.leads;$('total').textContent=d.total;$('today').textContent=d.today;$('services').textContent=d.service_count;$('rows').innerHTML=list.map(x=>'<tr><td>'+esc(x.name)+'<br>'+esc(x.email||x.phone)+'</td><td>'+esc(x.service)+'</td><td>'+esc(x.summary)+'</td><td>'+esc(new Date(x.created_at).toLocaleString())+'</td><td><button data-id="'+esc(x.id)+'">Delete</button></td></tr>').join('');let a=await api('/admin/audit');$('audit').textContent=a.events.map(x=>x.action+' — '+x.created_at).join('\n')||'No activity'}catch(e){$('appNotice').textContent='Dashboard error: '+e.message}}$('form').addEventListener('submit',async e=>{e.preventDefault();const n=$('notice'),b=$('form').querySelector('button');n.textContent='Checking token…';b.disabled=true;b.textContent='Checking…';try{await api('/admin/login',{method:'POST',body:JSON.stringify({token:$('token').value.trim()})});n.textContent='Login successful. Loading enquiries…';$('token').value='';$('login').classList.add('hidden');$('app').classList.remove('hidden');await load()}catch(x){n.textContent='Sign-in failed: '+x.message}finally{b.disabled=false;b.textContent='Sign in'}});$('refresh').onclick=load;$('filter').onclick=load;$('logout').onclick=async()=>{await api('/admin/logout',{method:'POST',body:'{}'});$('app').classList.add('hidden');$('login').classList.remove('hidden')};$('rows').onclick=async e=>{let b=e.target.closest('[data-id]');if(b&&confirm('Permanently delete this enquiry?')){await api('/admin/delete-lead',{method:'POST',body:JSON.stringify({lead_id:b.dataset.id})});await load()}};(async()=>{try{await api('/admin/session');$('login').classList.add('hidden');$('app').classList.remove('hidden');await load()}catch{}})();
</script></body></html>`;
function adminCookie(v,age){return "nisco_admin="+v+"; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age="+age}
function b64(v){return btoa(String.fromCharCode(...v)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
async function adminSign(p,s){let d=b64(new TextEncoder().encode(JSON.stringify(p))),k=await crypto.subtle.importKey("raw",new TextEncoder().encode(s),{name:"HMAC",hash:"SHA-256"},false,["sign"]),sig=await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(d));return d+"."+b64(new Uint8Array(sig))}
async function adminValid(req,s){try{let x=(req.headers.get("Cookie")||"").split(";").map(v=>v.trim()).find(v=>v.startsWith("nisco_admin="));if(!x)return false;let t=x.slice(12),d=t.split(".")[0],p=JSON.parse(atob(d.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-d.length%4)%4)));return p.exp>Date.now()/1000&&await adminSign(p,s)===t}catch{return false}}
async function adminRoute(req,env,url){if(!env.ADMIN_API_TOKEN)return json({error:"Admin is not configured."},503,"");let p=url.pathname;if(p==="/admin"||p==="/admin/")return new Response(ADMIN_HTML,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Frame-Options":"DENY","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"}});if(req.method==="POST"&&p==="/admin/login"){if(req.headers.get("Origin")!==url.origin)return json({error:"Origin denied."},403,"");let b=await readJsonLimited(req,2048);if(b.error)return json({error:b.error},b.status,"");if(b.data?.token!==env.ADMIN_API_TOKEN)return json({error:"Invalid admin token."},401,"");let v=await adminSign({exp:Date.now()/1000+28800},env.ADMIN_API_TOKEN);return new Response('{"success":true}',{headers:{"Content-Type":"application/json","Cache-Control":"no-store","Set-Cookie":adminCookie(v,28800)}})}if(req.method==="POST"&&p==="/admin/logout"){if(req.headers.get("Origin")!==url.origin)return json({error:"Origin denied."},403,"");return new Response('{"success":true}',{headers:{"Content-Type":"application/json","Set-Cookie":adminCookie("",0)}})}const auth=req.headers.get("Authorization")||"";const bearerOk=p==="/admin/delete-lead"&&auth.startsWith("Bearer ")&&auth.slice(7)===env.ADMIN_API_TOKEN;const sessionOk=await adminValid(req,env.ADMIN_API_TOKEN);if(!sessionOk&&!bearerOk)return json({error:"Unauthorized."},401,"");if(req.method==="GET"&&p==="/admin/session")return json({authenticated:true},200,"");if(req.method==="GET"&&p==="/admin/leads"){let q=(url.searchParams.get("q")||"").slice(0,100),period=url.searchParams.get("period"),w=[],v=[];if(q){w.push("(name LIKE ? OR email LIKE ? OR phone LIKE ? OR summary LIKE ?)");v.push("%"+q+"%","%"+q+"%","%"+q+"%","%"+q+"%")}if(period==="today")w.push("date(created_at)=date('now')");if(period==="7"||period==="30"){w.push("created_at>=?");v.push(new Date(Date.now()-Number(period)*86400000).toISOString())}let clause=w.length?" WHERE "+w.join(" AND "):"",rows=await env.DB.prepare("SELECT id,created_at,name,email,phone,service,summary,source FROM leads"+clause+" ORDER BY created_at DESC LIMIT 500").bind(...v).all(),total=await env.DB.prepare("SELECT COUNT(*) n FROM leads").first(),today=await env.DB.prepare("SELECT COUNT(*) n FROM leads WHERE date(created_at)=date('now')").first(),services=await env.DB.prepare("SELECT COUNT(DISTINCT service) n FROM leads").first();return json({leads:rows.results||[],total:total?.n||0,today:today?.n||0,service_count:services?.n||0},200,"")}if(req.method==="GET"&&p==="/admin/audit"){let a=await env.DB.prepare("SELECT created_at,action FROM security_audit_log ORDER BY created_at DESC LIMIT 20").all();return json({events:a.results||[]},200,"")}if(req.method==="POST"&&p==="/admin/delete-lead"){const origin=req.headers.get("Origin");const bearerAuth=(req.headers.get("Authorization")||"").startsWith("Bearer ");if(origin&&origin!==url.origin)return json({error:"Origin denied."},403,"");if(!origin&&!bearerAuth)return json({error:"Origin denied."},403,"");let b=await readJsonLimited(req,1024);if(b.error)return json({error:b.error},b.status,"");let id=b.data?.lead_id||"";if(!/^[0-9a-f-]{36}$/i.test(id))return json({error:"Invalid lead ID."},400,"");let d=await env.DB.prepare("DELETE FROM leads WHERE id=?").bind(id).run();if(d.meta?.changes===1)await env.DB.prepare("INSERT INTO security_audit_log (created_at,action) VALUES (?, 'admin-lead-deleted')").bind(new Date().toISOString()).run();return json({success:true,deleted:d.meta?.changes===1},200,"")}return json({error:"Not found"},404,"")}


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
    const url=new URL(request.url),pathname=url.pathname;
    if(pathname==="/mcp") return handleMcp(request,env);
    if(pathname==="/admin"||pathname.startsWith("/admin/")){if(!["/admin","/admin/"].includes(pathname)&&request.headers.get("Origin")&&request.headers.get("Origin")!==url.origin)return new Response("Origin denied",{status:403});if(!env.DB&&!["/admin","/admin/"].includes(pathname))return json({error:"Database unavailable."},503,"");return adminRoute(request,env,url)}
    const origin=request.headers.get("Origin")||"",allowed=env.ALLOWED_ORIGIN||"https://nisco-website.pages.dev";
    if(origin&&origin!==allowed)return new Response("Origin not allowed",{status:403});
    if(!origin&&pathname!=="/admin/delete-lead")return new Response("Origin required",{status:403});
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":allowed,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Max-Age":"86400","Vary":"Origin"}});
    if(request.method!=="POST"||!["/chat","/enquiry","/admin/delete-lead"].includes(pathname))return json({error:"Not found"},404,allowed);
    if(!env.DB)return json({error:"Enquiry storage is not configured yet."},503,allowed);
    if(pathname==="/admin/delete-lead"){if(!env.ADMIN_API_TOKEN)return json({error:"Administrative deletion is not configured."},503,allowed);const auth=request.headers.get("Authorization")||"";if(!auth.startsWith("Bearer ")||auth.slice(7)!==env.ADMIN_API_TOKEN)return json({error:"Unauthorized."},401,allowed);const parsed=await readJsonLimited(request,1024);if(parsed.error)return json({error:parsed.error},parsed.status,allowed);const id=typeof parsed.data?.lead_id==="string"?parsed.data.lead_id.trim():"";if(!/^[0-9a-f-]{36}$/i.test(id))return json({error:"A valid lead_id is required."},400,allowed);const deleted=await env.DB.prepare("DELETE FROM leads WHERE id=?").bind(id).run();if(deleted.meta?.changes===1)await env.DB.prepare("INSERT INTO security_audit_log (created_at,action) VALUES (?, 'admin-lead-deleted')").bind(new Date().toISOString()).run();return json({success:true,deleted:deleted.meta?.changes===1},200,allowed)}
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
      const phone = typeof enquiry.phone === "string" ? enquiry.phone.trim() : "";
      const business = typeof enquiry.business === "string" ? enquiry.business.trim() : "";
      const service = typeof enquiry.service === "string" ? enquiry.service.trim() : "";
      const budget = typeof enquiry.budget === "string" ? enquiry.budget.trim() : "";
      const requirement = typeof enquiry.requirement === "string" ? enquiry.requirement.trim() : "";
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!name || name.length > 100 || !emailPattern.test(customerEmail) || customerEmail.length > 254 ||
          phone.length > 30 || business.length > 120 || !service || service.length > 120 || budget.length > 80 ||
          !requirement || requirement.length > 1200 || enquiry.consent !== true) {
        return json({ error: "Please complete the required fields and agree to share your enquiry." }, 400, allowed);
      }
      const details = [
        "A new enquiry has been submitted through the NISCO website.",
        "",
        "Name: " + name,
        "Customer email: " + customerEmail,
        "Phone: " + (phone || "Not provided"),
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
          "INSERT INTO leads (id, created_at, name, email, phone, preferred_contact, service, summary, timeline, consent, source) VALUES (?, ?, ?, ?, ?, 'email', ?, ?, '', 1, 'website-form')"
        ).bind(
          crypto.randomUUID(), new Date().toISOString(), name, customerEmail, phone,
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
