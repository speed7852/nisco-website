import { beforeAll, describe, expect, it } from "vitest";
import { AccessJwtError, verifyAccessJwt, type JsonWebKeySet } from "../src/auth/access-jwt";
import { base64UrlEncode } from "../src/auth/crypto";
import { call, makeEnv } from "./helpers";

/**
 * Cloudflare Access JWT validation, with a locally generated RSA key standing in for the Access
 * team's signing key. Nothing here contacts Cloudflare.
 */
const TEAM = "https://synthetic-team.cloudflareaccess.com";
const AUD = "synthetic-audience-tag";
const KID = "test-kid-1";

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let jwks: JsonWebKeySet;
let fetches = 0;
const fetchJwks = async (url: string) => {
  fetches += 1;
  expect(url).toBe(`${TEAM}/cdn-cgi/access/certs`);
  return jwks;
};

const enc = (value: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));

async function sign(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: KID }, key = privateKey) {
  const body = `${enc(header)}.${enc(claims)}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body));
  return `${body}.${base64UrlEncode(signature)}`;
}

const now = () => Math.floor(Date.now() / 1000);
const validClaims = () => ({ iss: TEAM, aud: [AUD], exp: now() + 600, nbf: now() - 10, iat: now() - 10, sub: "user-1", email: "owner@example.test" });

beforeAll(async () => {
  const algorithm = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  const pair = (await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"])) as CryptoKeyPair;
  const other = (await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  jwks = { keys: [{ ...publicJwk, kid: KID, alg: "RS256", use: "sig" }] };
});

const verify = (token: string) => verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD }, { fetchJwks });
const rejects = async (token: string, reason: string) => {
  await expect(verify(token)).rejects.toThrow(AccessJwtError);
  await expect(verify(token)).rejects.toMatchObject({ reason });
};

describe("verifyAccessJwt", () => {
  it("accepts a valid token signed by the team key", async () => {
    const claims = await verify(await sign(validClaims()));
    expect(claims.email).toBe("owner@example.test");
  });

  it("accepts a string audience and a team domain without https://", async () => {
    const token = await sign({ ...validClaims(), aud: AUD });
    const claims = await verifyAccessJwt(token, { teamDomain: "synthetic-team.cloudflareaccess.com/", audience: AUD }, { fetchJwks });
    expect(claims.sub).toBe("user-1");
  });

  it("rejects the wrong audience", async () => rejects(await sign({ ...validClaims(), aud: ["another-app"] }), "bad_audience"));
  it("rejects the wrong issuer", async () => rejects(await sign({ ...validClaims(), iss: "https://evil.cloudflareaccess.com" }), "bad_issuer"));
  it("rejects an expired token", async () => rejects(await sign({ ...validClaims(), exp: now() - 120 }), "expired"));
  it("rejects a token without exp", async () => {
    const { exp: _exp, ...claims } = validClaims();
    await rejects(await sign(claims), "expired");
  });
  it("rejects a token that is not yet valid", async () => rejects(await sign({ ...validClaims(), nbf: now() + 600 }), "not_yet_valid"));
  it("rejects a signature from a different key", async () =>
    rejects(await sign(validClaims(), { alg: "RS256", kid: KID }, otherPrivateKey), "bad_signature"));
  it("rejects alg none and HS256", async () => {
    await rejects(`${enc({ alg: "none", kid: KID })}.${enc(validClaims())}.`, "unsupported_alg");
    await rejects(await sign(validClaims(), { alg: "HS256", kid: KID }), "unsupported_alg");
  });
  it("rejects an unknown key ID after refetching the key set once", async () => {
    const before = fetches;
    await expect(verify(await sign(validClaims(), { alg: "RS256", kid: "rotated-away" }))).rejects.toMatchObject({ reason: "unknown_kid" });
    expect(fetches - before).toBeLessThanOrEqual(1);
  });
  it("rejects a modified payload", async () => {
    const [header, , signature] = (await sign(validClaims())).split(".");
    await rejects(`${header}.${enc({ ...validClaims(), email: "attacker@example.test" })}.${signature}`, "bad_signature");
  });
  it("rejects malformed tokens", async () => {
    await rejects("not.a.jwt!", "malformed");
    await rejects("onlyonepart", "malformed");
  });
});

describe("AUTH_MODE=access end to end", () => {
  const accessEnv = (overrides = {}) =>
    makeEnv({ AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ACCESS_ALLOWED_EMAILS: "", ...overrides });

  it("accepts a valid Cf-Access-Jwt-Assertion header", async () => {
    const token = await sign(validClaims());
    const result = await call(accessEnv(), "GET", "/api/session", { headers: { "cf-access-jwt-assertion": token }, options: { fetchJwks } });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ authenticated: true, mode: "access", email: "owner@example.test" });
    expect(result.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("accepts the CF_Authorization cookie", async () => {
    const token = await sign(validClaims());
    const result = await call(accessEnv(), "GET", "/api/profile", { headers: { cookie: `a=b; CF_Authorization=${token}` }, options: { fetchJwks } });
    expect(result.status).toBe(200);
  });

  it("rejects requests without an Access token and ignores session tokens", async () => {
    expect((await call(accessEnv(), "GET", "/api/profile", { options: { fetchJwks } })).status).toBe(401);
    expect((await call(accessEnv(), "GET", "/api/profile", { token: "v1.x.y", options: { fetchJwks } })).status).toBe(401);
  });

  it("refuses key sign-in when Access is selected", async () => {
    const result = await call(accessEnv(), "POST", "/api/session", { body: { accessKey: "anything" } });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("use_cloudflare_access");
  });

  it("enforces the optional email allow-list with 403", async () => {
    const token = await sign(validClaims());
    const blocked = await call(accessEnv({ ACCESS_ALLOWED_EMAILS: "someone-else@example.test" }), "GET", "/api/profile", {
      headers: { "cf-access-jwt-assertion": token },
      options: { fetchJwks },
    });
    expect(blocked.status).toBe(403);
    const allowed = await call(accessEnv({ ACCESS_ALLOWED_EMAILS: " OWNER@example.test " }), "GET", "/api/profile", {
      headers: { "cf-access-jwt-assertion": token },
      options: { fetchJwks },
    });
    expect(allowed.status).toBe(200);
  });

  it("fails closed with 503 when Access is selected but not configured", async () => {
    const result = await call(makeEnv({ AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" }), "GET", "/api/profile");
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("auth_misconfigured");
  });
});
