// Serves career-ai/frontend the way Cloudflare Pages would, for the browser journey:
// - every response carries the headers from frontend/_headers (production CSP, framing, HSTS, ...);
// - the only differences from production are the API origin in the CSP connect-src and in config.js,
//   which point at the local Worker. Both substitutions are checked and fail loudly if not found.
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { API_ORIGIN, APP_PORT, FRONTEND_DIR, LOG_DIR, PRODUCTION_API_ORIGIN } from "../e2e.config.js";
import { headersFor, localRules } from "./headers.js";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

const rules = localRules();
const productionConfig = readFileSync(path.join(FRONTEND_DIR, "config.js"), "utf8");
if (!productionConfig.includes(PRODUCTION_API_ORIGIN)) throw new Error("frontend/config.js no longer contains the production API origin; update e2e.config.js");
const localConfig = productionConfig.replaceAll(PRODUCTION_API_ORIGIN, API_ORIGIN);

mkdirSync(LOG_DIR, { recursive: true });
const log = createWriteStream(path.join(LOG_DIR, "frontend.log"), { flags: "w" });

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  let status = 200;
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      status = 405;
      response.writeHead(status).end();
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = path.resolve(FRONTEND_DIR, relative);
    // Pages never serves _headers or dotfiles, and nothing outside the frontend directory.
    if (!file.startsWith(FRONTEND_DIR + path.sep) || path.basename(file).startsWith(".") || path.basename(file) === "_headers") {
      status = 404;
      response.writeHead(status).end();
      return;
    }
    const body = relative === "config.js" ? Buffer.from(localConfig) : await readFile(file);
    const headers = Object.fromEntries(headersFor(rules, pathname));
    headers["content-type"] = CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
    response.writeHead(status, headers);
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    status = 404;
    if (!response.headersSent) response.writeHead(status);
    response.end();
  } finally {
    log.write(`${new Date().toISOString()} ${request.method} ${url.pathname} ${status}\n`);
  }
});

server.listen(APP_PORT, "127.0.0.1", () => {
  console.log(`Serving ${FRONTEND_DIR} at http://127.0.0.1:${APP_PORT} with production headers (API: ${API_ORIGIN})`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
