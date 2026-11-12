/**
 * NISCO Career AI API - Cloudflare Worker entry point.
 *
 * fetch:     HTTP API used by the Pages app (see app.ts for the route table).
 * scheduled: twice-daily job discovery (see wrangler.toml [triggers] and discovery/run.ts).
 *
 * The app prepares material for one job seeker. It never submits applications or contacts employers.
 */
import { handleRequest } from "./app";
import { runDiscovery } from "./discovery/run";
import type { Env } from "./env";

export default {
  async fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(controller, env): Promise<void> {
    await runDiscovery(env, controller.cron);
  },
} satisfies ExportedHandler<Env>;

export type { Env } from "./env";
