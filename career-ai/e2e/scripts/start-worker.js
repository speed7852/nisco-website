// Starts the real Career AI Worker for the browser journey, isolated from every Cloudflare account:
//
// 1. Fresh state: local D1 and R2 live in a new temporary directory, deleted when the run ends.
// 2. No Workers AI and no cron: the config is generated from worker/wrangler.toml with the [ai] and
//    [triggers] sections removed, so the Worker has no AI binding at all and never fetches feeds.
//    Assessments and drafts therefore exercise their real failure paths.
// 3. No credentials: Cloudflare token/account variables are removed from the environment, and HOME
//    and XDG_CONFIG_HOME point at the temporary directory, so a stored `wrangler login` is invisible.
// 4. `wrangler dev --local`: remote bindings disabled. The generated config contains no database_id.
//
// Logs go to e2e/logs/worker.log (uploaded by CI when the journey fails).
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ACCESS_KEY, API_PORT, APP_ORIGIN, LOG_DIR, WORKER_DIR } from "../e2e.config.js";

const CREDENTIAL_VARIABLES = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CF_API_TOKEN",
  "CF_ACCOUNT_ID",
  "CF_API_KEY",
  "CF_EMAIL",
];

mkdirSync(LOG_DIR, { recursive: true });
const log = createWriteStream(path.join(LOG_DIR, "worker.log"), { flags: "w" });
const say = (text) => {
  log.write(`${text}\n`);
  process.stdout.write(`${text}\n`);
};

const wrangler = path.join(WORKER_DIR, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
if (!existsSync(wrangler)) {
  console.error("career-ai/worker/node_modules is missing. Run `npm ci` in career-ai/worker first (the journey uses its pinned Wrangler).");
  process.exit(1);
}

const root = mkdtempSync(path.join(tmpdir(), "career-ai-e2e-"));
const stateDir = path.join(root, "state");
const homeDir = path.join(root, "home");
mkdirSync(homeDir);
let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  rmSync(root, { recursive: true, force: true });
};

// --- Generate the test configuration from the production one ----------------------------------

function removeSection(toml, name) {
  return toml.replace(new RegExp(`^\\[${name}\\]\\n(?:(?!\\[)[^\\n]*(?:\\n|$))*`, "m"), "");
}

const production = readFileSync(path.join(WORKER_DIR, "wrangler.toml"), "utf8");
let config = removeSection(removeSection(production, "ai"), "triggers");
const requireReplace = (pattern, replacement, what) => {
  if (!pattern.test(config)) throw new Error(`worker/wrangler.toml: expected ${what}; update scripts/start-worker.js`);
  config = config.replace(pattern, replacement);
};
requireReplace(/^main = "src\/index\.ts"$/m, `main = ${JSON.stringify(path.join(WORKER_DIR, "src", "index.ts"))}`, 'main = "src/index.ts"');
requireReplace(/^migrations_dir = "migrations"$/m, `migrations_dir = ${JSON.stringify(path.join(WORKER_DIR, "migrations"))}`, 'migrations_dir = "migrations"');

const forbidden = [
  [/^\[ai\]/m, "an [ai] section"],
  [/binding = "AI"/, "an AI binding"],
  [/^\[triggers\]/m, "cron triggers"],
  [/^\s*database_id\s*=/m, "a D1 database_id"],
  [/^\s*remote\s*=\s*true/m, "a remote binding"],
];
for (const [pattern, what] of forbidden) {
  if (pattern.test(config)) throw new Error(`Generated test config still contains ${what}; refusing to start.`);
}
const configPath = path.join(root, "wrangler.e2e.toml");
writeFileSync(configPath, config);
copyFileSync(configPath, path.join(LOG_DIR, "wrangler.e2e.toml"));

// --- Environment without credentials --------------------------------------------------------------

const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir, XDG_CONFIG_HOME: homeDir, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" };
for (const name of CREDENTIAL_VARIABLES) delete env[name];

say(`[e2e] scratch directory ${root}`);
say(`[e2e] config: Workers AI removed, cron removed, no database_id, credentials removed from environment`);

// --- Apply migrations to the empty local database ------------------------------------------------------

const migrate = spawnSync(
  wrangler,
  ["d1", "migrations", "apply", "nisco-career-ai-db", "--local", "--persist-to", stateDir, "--config", configPath],
  { cwd: WORKER_DIR, env, encoding: "utf8" },
);
say(migrate.stdout ?? "");
if (migrate.stderr) say(migrate.stderr);
if (migrate.status !== 0) {
  say(`[e2e] migrations failed (exit ${migrate.status})`);
  cleanup();
  process.exit(1);
}

// --- Start the Worker ---------------------------------------------------------------------------------------

const child = spawn(
  wrangler,
  [
    "dev",
    "--local",
    "--ip", "127.0.0.1",
    "--port", String(API_PORT),
    "--persist-to", stateDir,
    "--config", configPath,
    "--show-interactive-dev-session=false",
    "--var", `APP_ACCESS_KEY:${ACCESS_KEY}`,
    "--var", `ALLOWED_ORIGINS:${APP_ORIGIN}`,
  ],
  { cwd: WORKER_DIR, env, stdio: ["ignore", "pipe", "pipe"] },
);
child.stdout.on("data", (chunk) => say(chunk.toString().trimEnd()));
child.stderr.on("data", (chunk) => say(chunk.toString().trimEnd()));
child.on("exit", (code, signal) => {
  say(`[e2e] wrangler dev exited (code ${code}, signal ${signal})`);
  cleanup();
  process.exit(code ?? 0);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    child.kill("SIGTERM");
    setTimeout(() => {
      child.kill("SIGKILL");
      cleanup();
      process.exit(0);
    }, 5_000).unref();
  });
}
process.on("exit", cleanup);
