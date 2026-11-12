// Reads Cloudflare Pages `_headers` rules so the local server sends the same headers as production.
// Format: an unindented path pattern, followed by indented "Name: value" lines.
// Patterns support `*` (any characters) and `:name` (one path segment), as Pages does.
import { readFileSync } from "node:fs";
import path from "node:path";
import { API_ORIGIN, FRONTEND_DIR, PRODUCTION_API_ORIGIN } from "../e2e.config.js";

function patternToRegex(pattern) {
  const source = pattern
    .split(/(\*|:[A-Za-z]\w*)/)
    .map((part) => (part === "*" ? ".*" : part.startsWith(":") ? "[^/]+" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}$`);
}

export function parseHeadersFile(text) {
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      rules.push({ source: line.trim(), pattern: patternToRegex(line.trim()), headers: [] });
      continue;
    }
    const rule = rules.at(-1);
    const colon = line.indexOf(":");
    if (!rule || colon === -1) throw new Error(`Unreadable _headers line: ${line}`);
    rule.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

/** Production rules from frontend/_headers, unchanged. */
export function productionRules() {
  return parseHeadersFile(readFileSync(path.join(FRONTEND_DIR, "_headers"), "utf8"));
}

/**
 * The production rules with exactly one change: the CSP connect-src entry for the production API
 * points at the local Worker instead. Throws if that entry is missing, so the test can never run
 * with a CSP that silently differs from production in some other way.
 */
export function localRules() {
  let replaced = 0;
  const rules = productionRules().map((rule) => ({
    ...rule,
    headers: rule.headers.map(([name, value]) => {
      if (name.toLowerCase() !== "content-security-policy") return [name, value];
      if (!value.includes(PRODUCTION_API_ORIGIN)) throw new Error("CSP no longer allows the production API origin; update e2e.config.js");
      replaced += 1;
      return [name, value.replaceAll(PRODUCTION_API_ORIGIN, API_ORIGIN)];
    }),
  }));
  if (replaced === 0) throw new Error("No Content-Security-Policy found in frontend/_headers");
  return rules;
}

/** Headers for a request path: every matching rule applies, later rules override earlier ones. */
export function headersFor(rules, pathname) {
  const headers = new Map();
  for (const rule of rules) {
    if (!rule.pattern.test(pathname)) continue;
    for (const [name, value] of rule.headers) headers.set(name.toLowerCase(), value);
  }
  return headers;
}
