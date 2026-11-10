import test from "node:test";
import assert from "node:assert/strict";
import { handleMcp } from "./mcp.js";

function request(body, token = "test-secret") {
  return new Request("https://example.workers.dev/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body)
  });
}

test("MCP endpoint rejects unauthenticated requests", async () => {
  const response = await handleMcp(request({ jsonrpc: "2.0", id: 1, method: "initialize" }, ""), { ADMIN_API_TOKEN: "test-secret", DB: {} });
  assert.equal(response.status, 401);
});

test("MCP initialize advertises tools capability", async () => {
  const response = await handleMcp(request({ jsonrpc: "2.0", id: 1, method: "initialize" }), { ADMIN_API_TOKEN: "test-secret", DB: {} });
  const body = await response.json();
  assert.equal(body.result.serverInfo.name, "nisco-mcp");
  assert.equal(body.result.capabilities.tools.listChanged, false);
});

test("MCP tools list exposes supported NISCO operations", async () => {
  const response = await handleMcp(request({ jsonrpc: "2.0", id: 2, method: "tools/list" }), { ADMIN_API_TOKEN: "test-secret", DB: {} });
  const body = await response.json();
  assert.deepEqual(body.result.tools.map(tool => tool.name), ["list_enquiries", "get_enquiry", "update_enquiry_status", "delete_enquiry", "get_dashboard_stats"]);
});
