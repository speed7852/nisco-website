import { authenticate, authMode } from "./auth";
import type { JwksFetcher } from "./auth/access-jwt";
import { clientKey, enforceRateLimit } from "./auth/rate-limit";
import type { Env } from "./env";
import { corsHeaders, isAllowedOrigin, parseAllowedOrigins } from "./http/cors";
import { HttpError, notFound } from "./http/errors";
import { errorResponse, json, withHeaders } from "./http/responses";
import { Router, type RequestContext } from "./http/router";
import { createApplication, listApplicationsRoute, updateApplicationRoute } from "./routes/applications";
import { listDiscoveryRuns } from "./routes/discovery";
import { createDraft } from "./routes/drafts";
import { downloadFile, listFiles, reconcileFiles, removeFile, uploadFile } from "./routes/files";
import { createJob, getJobRoute, listJobsRoute, matchJob } from "./routes/jobs";
import { readProfile, writeProfile } from "./routes/profile";
import { createSession, getSession } from "./routes/session";

/** Every API route. `auth: false` only for health and sign-in. */
export const router = new Router()
  .add("GET", "/health", async ({ env }) => json({ ok: true, service: env.APP_NAME }), { auth: false })
  .add("POST", "/api/session", createSession, { auth: false })
  .add("GET", "/api/session", getSession, { auth: true })
  .add("GET", "/api/profile", readProfile, { auth: true })
  .add("PUT", "/api/profile", writeProfile, { auth: true })
  .add("GET", "/api/jobs", listJobsRoute, { auth: true })
  .add("POST", "/api/jobs", createJob, { auth: true })
  .add("GET", "/api/jobs/:id", getJobRoute, { auth: true })
  .add("POST", "/api/jobs/:id/match", matchJob, { auth: true })
  .add("GET", "/api/applications", listApplicationsRoute, { auth: true })
  .add("POST", "/api/applications", createApplication, { auth: true })
  .add("PATCH", "/api/applications/:id", updateApplicationRoute, { auth: true })
  .add("PUT", "/api/applications/:id", updateApplicationRoute, { auth: true })
  .add("POST", "/api/ai/draft", createDraft, { auth: true })
  .add("GET", "/api/files", listFiles, { auth: true })
  .add("POST", "/api/files", uploadFile, { auth: true })
  .add("POST", "/api/files/reconcile", reconcileFiles, { auth: true })
  .add("GET", "/api/files/:id", downloadFile, { auth: true })
  .add("DELETE", "/api/files/:id", removeFile, { auth: true })
  .add("GET", "/api/discovery/runs", listDiscoveryRuns, { auth: true });

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface AppOptions {
  /** Test seam for Cloudflare Access key retrieval. */
  fetchJwks?: JwksFetcher;
}

/**
 * Request pipeline: CORS preflight -> route lookup -> origin check for writes -> API rate limit ->
 * authentication -> handler. HttpErrors become JSON error responses; anything else is logged with
 * a request ID and returned as a generic 500 without internal details.
 */
export async function handleRequest(request: Request, env: Env, options: AppOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const requestId = crypto.randomUUID();
  let cors: Record<string, string> = { vary: "Origin" };

  try {
    const credentials = authMode(env) === "access";
    cors = corsHeaders(origin, allowed, credentials);

    if (request.method === "OPTIONS") {
      return isAllowedOrigin(origin, allowed)
        ? new Response(null, { status: 204, headers: cors })
        : new Response(null, { status: 403, headers: { vary: "Origin" } });
    }

    const match = router.match(request.method, url.pathname);
    if (match.kind === "not_found") throw notFound("Route");
    if (match.kind === "method_not_allowed") {
      throw new HttpError(405, "method_not_allowed", "Method not allowed.", undefined, undefined, { allow: match.allow.join(", ") });
    }

    // Browsers always send Origin on cross-site writes. Refuse writes from origins we do not serve.
    if (origin !== null && UNSAFE_METHODS.has(request.method) && !isAllowedOrigin(origin, allowed)) {
      throw new HttpError(403, "origin_not_allowed", "Requests from this website are not allowed.");
    }
    if (url.pathname.startsWith("/api/")) {
      await enforceRateLimit(env.API_RATE_LIMITER, clientKey(request, "api"));
    }

    const ctx: RequestContext = {
      request,
      env,
      url,
      params: match.params,
      auth: match.route.auth ? await authenticate(request, env, options.fetchJwks) : null,
      requestId,
    };
    return withHeaders(await match.route.handler(ctx), cors);
  } catch (error) {
    if (error instanceof HttpError) return withHeaders(errorResponse(error), cors);
    console.error(
      JSON.stringify({
        event: "unhandled_error",
        requestId,
        method: request.method,
        path: url.pathname,
        message: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      }),
    );
    return withHeaders(json({ error: "internal_error", message: "Something went wrong. Try again.", requestId }, 500), cors);
  }
}
