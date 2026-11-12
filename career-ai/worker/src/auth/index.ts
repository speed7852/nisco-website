import { DEFAULT_SESSION_TTL_SECONDS } from "../config";
import type { Env } from "../env";
import { forbidden, serviceUnavailable, unauthorized } from "../http/errors";
import { AccessJwtError, verifyAccessJwt, type JwksFetcher } from "./access-jwt";
import { verifySessionToken } from "./session";

export type AuthMode = "key" | "access";

export type AuthContext =
  | { mode: "key"; expiresAt: string }
  | { mode: "access"; email: string | null; subject: string | null };

/** Reads AUTH_MODE. Anything other than "key" or "access" is a configuration error (fail closed). */
export function authMode(env: Env): AuthMode {
  const mode = (env.AUTH_MODE ?? "key").trim().toLowerCase();
  if (mode === "key" || mode === "access") return mode;
  throw serviceUnavailable("auth_misconfigured", "Sign-in is not configured correctly. Check AUTH_MODE.");
}

export function sessionTtlSeconds(env: Env): number {
  const parsed = Number(env.SESSION_TTL_SECONDS);
  return Number.isInteger(parsed) && parsed >= 300 && parsed <= 86_400 ? parsed : DEFAULT_SESSION_TTL_SECONDS;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/**
 * CV and profile routes hold personal data. In key mode, holding the private key is the owner
 * identity. In Access mode, a verified Access identity is accepted only when ACCESS_ALLOWED_EMAILS
 * names the owner explicitly (authenticate() has already checked the email is on that list); an
 * empty list fails closed instead of trusting any identity the Access policy lets through.
 */
export function requireOwnerIdentity(auth: AuthContext | null, env: Env): void {
  if (!auth) throw unauthorized();
  if (auth.mode === "key") return;
  const allowList = (env.ACCESS_ALLOWED_EMAILS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (allowList.length === 0) {
    throw serviceUnavailable("owner_not_configured", "Set ACCESS_ALLOWED_EMAILS to the owner's email before using CV and profile data.");
  }
  if (!auth.email) throw forbidden("not_allowed", "This account is not allowed to use Career AI.");
}

export function requireAccessKeyConfigured(env: Env): string {
  const key = env.APP_ACCESS_KEY;
  if (!key) throw serviceUnavailable("setup_required", "The private access key has not been configured.");
  return key;
}

/**
 * Authenticates an API request. Throws 401 for missing/invalid credentials, 403 for a verified
 * Access identity that is not on the allow-list, and 503 when sign-in is not configured.
 */
export async function authenticate(request: Request, env: Env, fetchJwks?: JwksFetcher): Promise<AuthContext> {
  const mode = authMode(env);

  if (mode === "key") {
    const secret = requireAccessKeyConfigured(env);
    const token = bearerToken(request);
    if (!token) throw unauthorized();
    const check = await verifySessionToken(token, secret);
    if (!check.ok) throw unauthorized(check.reason === "expired" ? "Your session has expired. Sign in again." : "Sign in to continue.");
    return { mode: "key", expiresAt: check.expiresAt };
  }

  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.ACCESS_AUD?.trim();
  if (!teamDomain || !audience) {
    throw serviceUnavailable("auth_misconfigured", "Cloudflare Access is selected but not configured.");
  }
  const token = request.headers.get("cf-access-jwt-assertion") ?? cookieValue(request, "CF_Authorization");
  if (!token) throw unauthorized("Sign in through Cloudflare Access.");

  let claims;
  try {
    claims = await verifyAccessJwt(token, { teamDomain, audience }, fetchJwks ? { fetchJwks } : {});
  } catch (error) {
    if (error instanceof AccessJwtError) {
      console.warn(JSON.stringify({ event: "access_jwt_rejected", reason: error.reason }));
      throw unauthorized("Sign in through Cloudflare Access.");
    }
    throw error;
  }

  const allowList = (env.ACCESS_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  if (allowList.length > 0 && (!email || !allowList.includes(email))) {
    throw forbidden("not_allowed", "This account is not allowed to use Career AI.");
  }
  return { mode: "access", email, subject: claims.sub ?? null };
}
