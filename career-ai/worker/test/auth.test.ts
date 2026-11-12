import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { router } from "../src/app";
import { constantTimeEqual } from "../src/auth/crypto";
import { issueSessionToken, verifySessionToken } from "../src/auth/session";
import type { RateLimiter } from "../src/env";
import { APP_ORIGIN, call, makeEnv, signIn, TEST_ACCESS_KEY } from "./helpers";

/** Every authenticated route, with a syntactically valid ID where one is needed. */
const ID = "00000000-0000-4000-8000-000000000000";
const PROTECTED: [string, string][] = [
  ["GET", "/api/session"],
  ["GET", "/api/profile"],
  ["PUT", "/api/profile"],
  ["GET", "/api/jobs"],
  ["POST", "/api/jobs"],
  ["GET", `/api/jobs/${ID}`],
  ["POST", `/api/jobs/${ID}/match`],
  ["GET", "/api/applications"],
  ["POST", "/api/applications"],
  ["PATCH", `/api/applications/${ID}`],
  ["PUT", `/api/applications/${ID}`],
  ["POST", "/api/ai/draft"],
  ["GET", "/api/files"],
  ["POST", "/api/files"],
  ["POST", "/api/files/reconcile"],
  ["GET", `/api/files/${ID}`],
  ["DELETE", `/api/files/${ID}`],
  ["GET", "/api/discovery/runs"],
];

describe("authentication on every API route", () => {
  it("covers every route registered with auth", () => {
    for (const [method, path] of PROTECTED) {
      const match = router.match(method, path);
      expect(match.kind === "found" && match.route.auth, `${method} ${path}`).toBe(true);
    }
  });

  it.each(PROTECTED)("%s %s returns 401 without a session", async (method, path) => {
    const result = await call(makeEnv(), method, path, { body: method === "GET" || method === "DELETE" ? undefined : {} });
    expect(result.status).toBe(401);
  });

  it.each(PROTECTED)("%s %s returns 401 with the raw access key instead of a session token", async (method, path) => {
    const result = await call(makeEnv(), method, path, { token: TEST_ACCESS_KEY });
    expect(result.status).toBe(401);
  });

  it("returns 503 setup_required when no access key is configured (P04)", async () => {
    const result = await call(makeEnv({ APP_ACCESS_KEY: "" }), "GET", "/api/jobs", { token: "x" });
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("setup_required");
  });

  it("fails closed on an unknown AUTH_MODE", async () => {
    const result = await call(makeEnv({ AUTH_MODE: "none" }), "GET", "/api/jobs");
    expect(result.status).toBe(503);
  });
});

describe("sign-in and session tokens", () => {
  it("rejects a wrong key with 401 and issues a token for the right one", async () => {
    const testEnv = makeEnv();
    expect((await call(testEnv, "POST", "/api/session", { body: { accessKey: "wrong" } })).status).toBe(401);
    const ok = await call<{ token: string; expiresAt: string }>(testEnv, "POST", "/api/session", { body: { accessKey: TEST_ACCESS_KEY } });
    expect(ok.status).toBe(201);
    expect(ok.body.token.startsWith("v1.")).toBe(true);
    expect(ok.body.token).not.toContain(TEST_ACCESS_KEY);
    const me = await call(testEnv, "GET", "/api/session", { token: ok.body.token });
    expect(me.body).toMatchObject({ authenticated: true, mode: "key" });
  });

  it("validates the sign-in body", async () => {
    const testEnv = makeEnv();
    expect((await call(testEnv, "POST", "/api/session", { rawBody: "{bad", headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await call(testEnv, "POST", "/api/session", { body: { accessKey: TEST_ACCESS_KEY, extra: 1 } })).status).toBe(400);
    expect((await call(testEnv, "POST", "/api/session", { body: ["x"] })).status).toBe(400);
  });

  it("rejects expired, tampered and foreign tokens", async () => {
    const expired = await issueSessionToken(TEST_ACCESS_KEY, 300, Date.now() - 3_600_000);
    expect(await verifySessionToken(expired.token, TEST_ACCESS_KEY)).toEqual({ ok: false, reason: "expired" });

    const { token } = await issueSessionToken(TEST_ACCESS_KEY, 300);
    const [v, payload, signature] = token.split(".");
    const forgedPayload = btoa(JSON.stringify({ iat: 0, exp: 9_999_999_999, sid: "x" })).replace(/=+$/, "");
    expect((await verifySessionToken(`${v}.${forgedPayload}.${signature}`, TEST_ACCESS_KEY)).ok).toBe(false);
    expect((await verifySessionToken(`${v}.${payload}.AAAA`, TEST_ACCESS_KEY)).ok).toBe(false);
    expect((await verifySessionToken(token, "a-different-rotated-key")).ok).toBe(false);
    expect((await verifySessionToken("not-a-token", TEST_ACCESS_KEY)).ok).toBe(false);

    const result = await call(makeEnv(), "GET", "/api/profile", { token: expired.token });
    expect(result.status).toBe(401);
    expect(result.body.message).toMatch(/expired/);
  });

  it("compares secrets in constant time and correctly", async () => {
    expect(await constantTimeEqual("same-secret", "same-secret")).toBe(true);
    expect(await constantTimeEqual("same-secret", "same-secreT")).toBe(false);
    expect(await constantTimeEqual("short", "a-much-longer-secret-value")).toBe(false);
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After when the sign-in limiter refuses", async () => {
    const deny: RateLimiter = { limit: async () => ({ success: false }) };
    const result = await call(makeEnv({ AUTH_RATE_LIMITER: deny }), "POST", "/api/session", { body: { accessKey: TEST_ACCESS_KEY } });
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("60");
  });

  it("returns 429 on API routes when the API limiter refuses, before authentication", async () => {
    const deny: RateLimiter = { limit: async () => ({ success: false }) };
    expect((await call(makeEnv({ API_RATE_LIMITER: deny }), "GET", "/api/jobs")).status).toBe(429);
  });

  it("keys limits by client IP", async () => {
    const keys: string[] = [];
    const record: RateLimiter = { limit: async ({ key }) => (keys.push(key), { success: true }) };
    await call(makeEnv({ AUTH_RATE_LIMITER: record, API_RATE_LIMITER: record }), "POST", "/api/session", {
      body: { accessKey: "wrong" },
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });
    expect(keys).toEqual(["api:203.0.113.7", "auth:203.0.113.7"]);
  });

  it("uses the real Workers Rate Limiting binding from wrangler.toml (10 sign-ins per minute)", async () => {
    const testEnv = makeEnv({ AUTH_RATE_LIMITER: env.AUTH_RATE_LIMITER });
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await call(testEnv, "POST", "/api/session", { body: { accessKey: "wrong" }, headers: { "cf-connecting-ip": ip } })).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe("health, CORS and origin checks", () => {
  it("health does not reveal authentication configuration", async () => {
    const result = await call(makeEnv(), "GET", "/health");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, service: "NISCO Career AI" });
  });

  it("allows only the exact configured origins", async () => {
    const testEnv = makeEnv();
    const token = await signIn(testEnv);
    const allowed = await call(testEnv, "GET", "/api/jobs", { token });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);

    for (const origin of ["https://evil.nisco-career-ai.pages.dev", "https://attacker.example", "null"]) {
      const result = await call(testEnv, "GET", "/api/jobs", { token, origin });
      expect(result.headers.get("access-control-allow-origin"), origin).toBeNull();
    }
  });

  it("answers preflight for allowed origins and refuses others", async () => {
    const preflight = (origin: string) =>
      call(makeEnv(), "OPTIONS", "/api/jobs", { origin, headers: { "access-control-request-method": "POST" } });
    const ok = await preflight(APP_ORIGIN);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-headers")).toContain("authorization");
    expect((await preflight("https://other-branch.nisco-career-ai.pages.dev")).status).toBe(403);
  });

  it("refuses writes from a foreign Origin even with a valid session", async () => {
    const testEnv = makeEnv();
    const token = await signIn(testEnv);
    const result = await call(testEnv, "PUT", "/api/profile", { token, origin: "https://attacker.example", body: {} });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe("origin_not_allowed");
  });

  it("sends security headers on API responses", async () => {
    const result = await call(makeEnv(), "GET", "/health");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("content-security-policy")).toContain("default-src 'none'");
  });
});
