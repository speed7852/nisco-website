# NISCO MCP Server

NISCO exposes a stateless Streamable HTTP MCP endpoint from the Cloudflare Worker.

- Endpoint: `https://nisco-ai.speedhome7852.workers.dev/mcp`
- Protocol version: `2025-06-18`
- Transport: Streamable HTTP (JSON-RPC over HTTP POST)
- Authentication: `Authorization: Bearer <token>`
- Token binding: `MCP_API_TOKEN` if configured; otherwise the existing `ADMIN_API_TOKEN` secret.
- Database: existing Cloudflare D1 database `nisco-ai-leads`.

## Available tools

| Tool | Purpose |
| --- | --- |
| `list_enquiries` | Search and list up to 50 enquiries |
| `get_enquiry` | Retrieve one enquiry by ID |
| `update_enquiry_status` | Set status to new, contacted, in_progress, won or closed |
| `delete_enquiry` | Permanently delete an enquiry |
| `get_dashboard_stats` | Retrieve total, today's and status counts |

## Security notes

- All requests require a bearer token. Never place the token in a public website or browser-side JavaScript.
- MCP tools are intended for trusted, authenticated MCP clients.
- Deletion is permanent. The calling AI client should obtain explicit user confirmation before calling `delete_enquiry`.
- Status changes and deletions are written to `security_audit_log`.
- Enquiry data contains personal information and must be handled confidentially.

## Connect an MCP client

Configure the client with the endpoint above and an HTTP Authorization header:

```http
Authorization: Bearer <your-admin-api-token>
```

Use a dedicated `MCP_API_TOKEN` secret in Cloudflare for MCP integrations when possible. If it is not set, the server currently accepts the existing `ADMIN_API_TOKEN` secret.

This deployment makes the MCP server available; each ChatGPT, Claude, or other MCP client still needs to be configured and authorized separately. The endpoint is not automatically connected to those clients.
