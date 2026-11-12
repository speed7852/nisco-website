import { base64UrlDecode, utf8 } from "./crypto";

/**
 * Verifies a Cloudflare Access JWT (the `Cf-Access-Jwt-Assertion` header or `CF_Authorization`
 * cookie) for "access" mode. Checks, in order: token shape, algorithm (RS256 only), signing key
 * from the team's JWKS, signature, issuer, audience, expiry and not-before.
 *
 * Reference: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

export interface AccessConfig {
  /** e.g. https://your-team.cloudflareaccess.com */
  teamDomain: string;
  /** Application Audience (AUD) tag from the Access application. */
  audience: string;
}

export interface AccessClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  sub?: string;
  email?: string;
}

export interface JsonWebKeySet {
  keys: (JsonWebKey & { kid?: string })[];
}

export type JwksFetcher = (url: string) => Promise<JsonWebKeySet>;

export class AccessJwtError extends Error {
  constructor(readonly reason: string) {
    super(`Access token rejected: ${reason}`);
    this.name = "AccessJwtError";
  }
}

const JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map<string, { fetchedAt: number; keys: JsonWebKeySet["keys"] }>();

export function normaliseTeamDomain(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
}

const defaultFetchJwks: JwksFetcher = async (url) => {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new AccessJwtError(`jwks_http_${response.status}`);
  return (await response.json()) as JsonWebKeySet;
};

async function findKey(
  teamDomain: string,
  kid: string,
  fetchJwks: JwksFetcher,
  nowMs: number,
): Promise<JsonWebKey | undefined> {
  const url = `${teamDomain}/cdn-cgi/access/certs`;
  const cached = jwksCache.get(url);
  const fresh = cached && nowMs - cached.fetchedAt < JWKS_TTL_MS;
  let key = fresh ? cached.keys.find((candidate) => candidate.kid === kid) : undefined;
  if (!key) {
    // Unknown kid or stale cache: refetch once, which also handles Access key rotation.
    const jwks = await fetchJwks(url);
    if (!jwks || !Array.isArray(jwks.keys)) throw new AccessJwtError("jwks_invalid");
    jwksCache.set(url, { fetchedAt: nowMs, keys: jwks.keys });
    key = jwks.keys.find((candidate) => candidate.kid === kid);
  }
  return key;
}

function decodeJsonPart(part: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new AccessJwtError("malformed");
  }
}

export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  options: { fetchJwks?: JwksFetcher; nowMs?: number; leewaySeconds?: number } = {},
): Promise<AccessClaims> {
  const nowMs = options.nowMs ?? Date.now();
  const leeway = options.leewaySeconds ?? 60;
  const teamDomain = normaliseTeamDomain(config.teamDomain);

  const parts = token.split(".");
  if (parts.length !== 3) throw new AccessJwtError("malformed");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodeJsonPart(headerPart);
  const claims = decodeJsonPart(payloadPart);

  if (header.alg !== "RS256") throw new AccessJwtError("unsupported_alg");
  if (typeof header.kid !== "string" || header.kid === "") throw new AccessJwtError("missing_kid");

  const jwk = await findKey(teamDomain, header.kid, options.fetchJwks ?? defaultFetchJwks, nowMs);
  if (!jwk) throw new AccessJwtError("unknown_kid");

  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(signaturePart);
  } catch {
    throw new AccessJwtError("malformed");
  }
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, utf8(`${headerPart}.${payloadPart}`));
  if (!valid) throw new AccessJwtError("bad_signature");

  if (claims.iss !== teamDomain) throw new AccessJwtError("bad_issuer");
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(config.audience)) throw new AccessJwtError("bad_audience");

  const nowSeconds = nowMs / 1000;
  if (typeof claims.exp !== "number" || claims.exp + leeway <= nowSeconds) throw new AccessJwtError("expired");
  if (typeof claims.nbf === "number" && claims.nbf - leeway > nowSeconds) throw new AccessJwtError("not_yet_valid");

  const verified: AccessClaims = { iss: teamDomain, aud: audiences.filter((a): a is string => typeof a === "string"), exp: claims.exp };
  if (typeof claims.nbf === "number") verified.nbf = claims.nbf;
  if (typeof claims.iat === "number") verified.iat = claims.iat;
  if (typeof claims.sub === "string") verified.sub = claims.sub;
  if (typeof claims.email === "string") verified.email = claims.email;
  return verified;
}

/** Test helper: clears the in-memory JWKS cache. */
export function clearJwksCache(): void {
  jwksCache.clear();
}
