import { base64UrlDecode, base64UrlEncode, utf8 } from "./crypto";

/**
 * Short-lived session tokens for "key" mode.
 *
 * The browser sends the private access key once (POST /api/session) and receives a signed token
 * that expires after SESSION_TTL_SECONDS. Only the token is kept in the browser, never the key.
 * Format: `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`.
 * The signing key is derived from APP_ACCESS_KEY, so rotating that secret signs everyone out.
 */

const VERSION = "v1";
const KEY_CONTEXT = "nisco-career-ai/session/v1:";

interface SessionPayload {
  iat: number;
  exp: number;
  sid: string;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", utf8(KEY_CONTEXT + secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function issueSessionToken(
  secret: string,
  ttlSeconds: number,
  nowMs = Date.now(),
): Promise<{ token: string; expiresAt: string }> {
  const iat = Math.floor(nowMs / 1000);
  const payload: SessionPayload = { iat, exp: iat + ttlSeconds, sid: crypto.randomUUID() };
  const body = `${VERSION}.${base64UrlEncode(utf8(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), utf8(body));
  return { token: `${body}.${base64UrlEncode(signature)}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export type SessionCheck = { ok: true; expiresAt: string } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export async function verifySessionToken(token: string, secret: string, nowMs = Date.now()): Promise<SessionCheck> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: "malformed" };
  const [version, payloadPart, signaturePart] = parts as [string, string, string];

  let signature: Uint8Array;
  let payload: unknown;
  try {
    signature = base64UrlDecode(signaturePart);
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // crypto.subtle.verify compares the HMAC in constant time.
  const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), signature, utf8(`${version}.${payloadPart}`));
  if (!valid) return { ok: false, reason: "bad_signature" };

  if (typeof payload !== "object" || payload === null) return { ok: false, reason: "malformed" };
  const exp = (payload as Partial<SessionPayload>).exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  if (exp * 1000 <= nowMs) return { ok: false, reason: "expired" };
  return { ok: true, expiresAt: new Date(exp * 1000).toISOString() };
}
