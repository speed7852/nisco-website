// Shared settings for the Career AI browser journey. Everything here is local and synthetic.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const E2E_DIR = here;
export const WORKER_DIR = path.resolve(here, "../worker");
export const FRONTEND_DIR = path.resolve(here, "../frontend");
/** Worker and server logs, kept out of Playwright's outputDir (which it empties at start-up). */
export const LOG_DIR = path.join(here, "logs");

export const API_PORT = Number(process.env.CAREER_AI_E2E_API_PORT ?? 8799);
export const APP_PORT = Number(process.env.CAREER_AI_E2E_APP_PORT ?? 4174);
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
export const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;

/** Synthetic key given to the local Worker only. Not a real credential. */
export const ACCESS_KEY = "e2e-synthetic-access-key-not-a-secret-0123456789";

/** The production API origin as written in frontend/config.js and frontend/_headers. */
export const PRODUCTION_API_ORIGIN = "https://nisco-career-ai-api.speedhome7852.workers.dev";
