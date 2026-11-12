import { authMode, requireAccessKeyConfigured, sessionTtlSeconds } from "../auth";
import { constantTimeEqual } from "../auth/crypto";
import { clientKey, enforceRateLimit } from "../auth/rate-limit";
import { issueSessionToken } from "../auth/session";
import { badRequest, HttpError, unauthorized } from "../http/errors";
import { readJson } from "../http/body";
import { json } from "../http/responses";
import type { RequestContext } from "../http/router";
import { FieldErrors, readString, rejectUnknownKeys, requireObject } from "../http/validation";

/**
 * POST /api/session: exchanges the private access key for a short-lived session token.
 * Rate limited per client IP. Only available in "key" mode.
 */
export async function createSession({ request, env }: RequestContext): Promise<Response> {
  if (authMode(env) !== "key") {
    throw new HttpError(400, "use_cloudflare_access", "This deployment signs in through Cloudflare Access.");
  }
  await enforceRateLimit(env.AUTH_RATE_LIMITER, clientKey(request, "auth"));
  const secret = requireAccessKeyConfigured(env);

  const body = requireObject(await readJson(request, 4096));
  const errors = new FieldErrors();
  rejectUnknownKeys(body, ["accessKey"], errors);
  const accessKey = readString(body, "accessKey", { max: 512, required: true }, errors);
  errors.throwIfAny();
  if (accessKey === undefined) throw badRequest("accessKey is required.");

  if (!(await constantTimeEqual(accessKey, secret))) {
    console.warn(JSON.stringify({ event: "sign_in_failed" }));
    throw unauthorized("That access key is not correct.");
  }
  const session = await issueSessionToken(secret, sessionTtlSeconds(env));
  return json({ token: session.token, expiresAt: session.expiresAt, mode: "key" }, 201);
}

/** GET /api/session: confirms the caller is signed in and reports how. */
export async function getSession({ auth }: RequestContext): Promise<Response> {
  return json({ authenticated: true, ...auth });
}
