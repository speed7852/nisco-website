const PROTOCOL_VERSION = "2025-06-18";
const TOOLS = [
  { name: "list_enquiries", description: "List recent NISCO customer enquiries. Returns at most 50 records.", inputSchema: { type: "object", properties: { search: { type: "string", description: "Optional search across customer, email, phone, service and summary." }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } }, additionalProperties: false } },
  { name: "get_enquiry", description: "Retrieve one enquiry by its exact ID.", inputSchema: { type: "object", properties: { lead_id: { type: "string" } }, required: ["lead_id"], additionalProperties: false } },
  { name: "update_enquiry_status", description: "Set an enquiry status to new, contacted, in_progress, won or closed.", inputSchema: { type: "object", properties: { lead_id: { type: "string" }, status: { type: "string", enum: ["new", "contacted", "in_progress", "won", "closed"] } }, required: ["lead_id", "status"], additionalProperties: false } },
  { name: "delete_enquiry", description: "Permanently delete one enquiry by exact ID. This action cannot be undone.", inputSchema: { type: "object", properties: { lead_id: { type: "string" } }, required: ["lead_id"], additionalProperties: false } },
  { name: "get_dashboard_stats", description: "Get total, today's and status counts for NISCO enquiries.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }
];
function reply(id, result, error) {
  return Response.json(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result }, { headers: { "Cache-Control": "no-store" } });
}
function textResult(value, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError };
}
function validId(id) { return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id); }
export async function handleMcp(request, env) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) return new Response("Content-Type must be application/json", { status: 415 });
  const token = env.MCP_API_TOKEN || env.ADMIN_API_TOKEN;
  if (!token) return Response.json({ error: "MCP authentication is not configured." }, { status: 503 });
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== token) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  if (!env.DB) return Response.json({ error: "Database unavailable" }, { status: 503 });
  let message;
  try { message = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return reply(message?.id ?? null, null, { code: -32600, message: "Invalid JSON-RPC request" });
  if (message.method === "notifications/initialized" || message.method.startsWith("notifications/")) return new Response(null, { status: 202 });
  const id = message.id ?? null;
  if (message.method === "initialize") {
    return reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "nisco-mcp", version: "1.0.0" }, instructions: "NISCO enquiry management tools. Treat customer records as confidential. Confirm before destructive actions." });
  }
  if (message.method === "ping") return reply(id, {});
  if (message.method === "tools/list") return reply(id, { tools: TOOLS });
  if (message.method !== "tools/call") return reply(id, null, { code: -32601, message: "Method not found" });
  const name = message.params?.name;
  const args = message.params?.arguments || {};
  try {
    let value;
    if (name === "list_enquiries") {
      const limit = Math.max(1, Math.min(50, Number.isInteger(args.limit) ? args.limit : 20));
      const search = typeof args.search === "string" ? args.search.trim().slice(0, 100) : "";
      const where = search ? " WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR service LIKE ? OR summary LIKE ?" : "";
      const pattern = "%" + search + "%";
      const rows = await env.DB.prepare("SELECT id,created_at,name,email,phone,preferred_contact,service,summary,timeline,source,status,lead_score,lead_priority FROM leads" + where + " ORDER BY created_at DESC LIMIT ?").bind(...(search ? [pattern, pattern, pattern, pattern, pattern, limit] : [limit])).all();
      value = { enquiries: rows.results || [], count: (rows.results || []).length };
    } else if (name === "get_enquiry") {
      if (!validId(args.lead_id)) throw new Error("A valid lead_id is required.");
      value = await env.DB.prepare("SELECT id,created_at,name,email,phone,preferred_contact,service,summary,timeline,source,status FROM leads WHERE id=?").bind(args.lead_id).first();
      if (!value) throw new Error("Enquiry not found.");
    } else if (name === "update_enquiry_status") {
      if (!validId(args.lead_id)) throw new Error("A valid lead_id is required.");
      if (!["new", "contacted", "in_progress", "won", "closed"].includes(args.status)) throw new Error("Invalid status.");
      const updated = await env.DB.prepare("UPDATE leads SET status=? WHERE id=?").bind(args.status, args.lead_id).run();
      if (updated.meta?.changes !== 1) throw new Error("Enquiry not found.");
      await env.DB.prepare("INSERT INTO security_audit_log (created_at,action) VALUES (?,?)").bind(new Date().toISOString(), "mcp-status-updated:" + args.lead_id + ":" + args.status).run();
      value = { success: true, lead_id: args.lead_id, status: args.status };
    } else if (name === "delete_enquiry") {
      if (!validId(args.lead_id)) throw new Error("A valid lead_id is required.");
      const deleted = await env.DB.prepare("DELETE FROM leads WHERE id=?").bind(args.lead_id).run();
      if (deleted.meta?.changes !== 1) throw new Error("Enquiry not found.");
      await env.DB.prepare("INSERT INTO security_audit_log (created_at,action) VALUES (?,?)").bind(new Date().toISOString(), "mcp-lead-deleted:" + args.lead_id).run();
      value = { success: true, deleted: true, lead_id: args.lead_id };
    } else if (name === "get_dashboard_stats") {
      const total = await env.DB.prepare("SELECT COUNT(*) AS count FROM leads").first();
      const today = await env.DB.prepare("SELECT COUNT(*) AS count FROM leads WHERE date(created_at)=date('now')").first();
      const statuses = await env.DB.prepare("SELECT status,COUNT(*) AS count FROM leads GROUP BY status ORDER BY status").all();
      const priorities = await env.DB.prepare("SELECT lead_priority,COUNT(*) AS count FROM leads GROUP BY lead_priority ORDER BY lead_priority").all();
      value = { total: total?.count || 0, today: today?.count || 0, statuses: statuses.results || [], priorities: priorities.results || [] };
    } else {
      return reply(id, null, { code: -32602, message: "Unknown tool" });
    }
    return reply(id, { ...textResult(value) });
  } catch (error) {
    return reply(id, textResult({ error: error.message }, true));
  }
}
