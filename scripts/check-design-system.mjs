import { readFileSync } from "node:fs";

const css = readFileSync("styles.css", "utf8");
const html = readFileSync("index.html", "utf8");
const requiredTokens = ["--navy", "--navy2", "--gold", "--gold2", "--ink", "--muted", "--paper", "--white", "--line"];
const missing = requiredTokens.filter(token => !new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:").test(css));
const checks = [
  ["brand colour tokens", missing.length === 0, missing.length ? `Missing: ${missing.join(", ")}` : "All required brand tokens exist"],
  ["visible keyboard focus", /:focus-visible/.test(css), "Add a clear :focus-visible style"],
  ["reduced motion", /prefers-reduced-motion/.test(css), "Respect prefers-reduced-motion"],
  ["responsive breakpoints", /@media[^{}]*(max-width|min-width)/.test(css), "Responsive media queries are required"],
  ["semantic navigation", /<nav\b/.test(html), "Use a semantic nav landmark"],
  ["viewport configuration", /name="viewport"/.test(html), "Add the responsive viewport meta tag"]
];
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log("Design system foundation checks passed.");
