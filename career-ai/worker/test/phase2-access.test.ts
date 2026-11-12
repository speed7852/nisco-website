import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { router } from "../src/app";
import { base64UrlEncode } from "../src/auth/crypto";
import { issueSessionToken } from "../src/auth/session";
import type { JsonWebKeySet } from "../src/auth/access-jwt";
import { call, listProfileItems, makeEnv, session, submitExtraction, SYNTHETIC_CV_TEXT, TEST_ACCESS_KEY, uploadCv } from "./helpers";

const ID = "00000000-0000-4000-8000-000000000000";
const concrete = (path: string) => path.replace(/:id/g, ID);
const personalRoutes = router.list().filter((route) => route.personal);
const authRoutes = router.list().filter((route) => route.auth);

describe("single-user access to CV and profile data", () => {
  it("marks every Phase 2 CV and profile route as personal and authenticated", () => {
    const paths = personalRoutes.map((route) => `${route.method} ${route.path}`);
    expect(paths.length).toBe(20);
    for (const route of router.list().filter((r) => r.path.startsWith("/api/cv/") || r.path.startsWith("/api/profile/"))) {
      expect(route.personal && route.auth, `${route.method} ${route.path}`).toBe(true);
    }
  });

  it.each(authRoutes.map((route) => [route.method, route.path] as const))("%s %s returns 401 without a session", async (method, path) => {
    const result = await call(makeEnv(), method, concrete(path), { body: method === "GET" ? undefined : {} });
    expect(result.status).toBe(401);
  });

  it.each(personalRoutes.map((route) => [route.method, route.path] as const))("%s %s returns 401 with the raw key, an expired session or a session for another key", async (method, path) => {
    const expired = (await issueSessionToken(TEST_ACCESS_KEY, 300, Date.now() - 3_600_000)).token;
    const foreign = (await issueSessionToken("some-other-deployment-key", 3600)).token;
    for (const token of [TEST_ACCESS_KEY, expired, foreign]) {
      expect((await call(makeEnv(), method, concrete(path), { token, body: method === "GET" ? undefined : {} })).status).toBe(401);
    }
  });

  it.each(personalRoutes.filter((r) => r.method !== "GET").map((route) => [route.method, route.path] as const))(
    "%s %s refuses writes from a foreign website even with a valid session",
    async (method, path) => {
      const api = await session();
      expect((await api.call(method, concrete(path), { origin: "https://attacker.example", body: {} })).status).toBe(403);
    },
  );

  it("cannot read a CV through another route's ID space", async () => {
    const api = await session();
    const upload = await uploadCv(api);
    const versionId = upload.body.version.id;
    // A CV version ID is not a file ID and vice versa.
    expect((await api.call("GET", `/api/files/${versionId}`)).status).toBe(404);
    expect((await api.call("GET", `/api/cv/versions/${upload.body.version.file!.documentId}/download`)).status).toBe(404);
  });
});

describe("Cloudflare Access mode: only the owner identity", () => {
  const TEAM = "https://synthetic-team.cloudflareaccess.com";
  const AUD = "synthetic-aud";
  let privateKey: CryptoKey;
  let jwks: JsonWebKeySet;
  const fetchJwks = async () => jwks;
  const enc = (value: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
  const token = async (email: string) => {
    const now = Math.floor(Date.now() / 1000);
    const body = `${enc({ alg: "RS256", kid: "k1" })}.${enc({ iss: TEAM, aud: [AUD], exp: now + 600, sub: email, email })}`;
    return `${body}.${base64UrlEncode(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(body)))}`;
  };
  const accessEnv = (allowed: string) => makeEnv({ AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ACCESS_ALLOWED_EMAILS: allowed });

  beforeAll(async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    privateKey = pair.privateKey;
    jwks = { keys: [{ ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey), kid: "k1" }] };
  });

  it("lets the allow-listed owner in", async () => {
    const result = await call(accessEnv("owner@example.test"), "GET", "/api/cv/versions", {
      headers: { "cf-access-jwt-assertion": await token("owner@example.test") },
      options: { fetchJwks },
    });
    expect(result.status).toBe(200);
  });

  it("refuses any other Access identity with 403", async () => {
    for (const path of ["/api/cv/versions", "/api/profile/items", "/api/profile/export"]) {
      const result = await call(accessEnv("owner@example.test"), "GET", path, {
        headers: { "cf-access-jwt-assertion": await token("someone-else@example.test") },
        options: { fetchJwks },
      });
      expect(result.status, path).toBe(403);
    }
  });

  it("fails closed for CV and profile data when no owner email is configured", async () => {
    const result = await call(accessEnv(""), "GET", "/api/profile/items", {
      headers: { "cf-access-jwt-assertion": await token("anyone@example.test") },
      options: { fetchJwks },
    });
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("owner_not_configured");
  });
});

describe("privacy: no CV content or storage keys in logs or responses", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never logs CV text, extracted values or R2 keys, and never returns storage keys", async () => {
    const logged: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }
    const canary = "CANARY-7f3a-synthetic-secret-phrase";
    const api = await session();
    const responses: string[] = [];
    const record = async <T,>(promise: Promise<{ body: T }>) => {
      const result = await promise;
      responses.push(JSON.stringify(result.body));
      return result;
    };
    const upload = await record(uploadCv(api));
    const versionId = upload.body.version.id;
    await record(submitExtraction(api, versionId, { status: "extracted", parser: "pdfjs-dist", parserVersion: "6.4.299", text: `${SYNTHETIC_CV_TEXT}\n\nSUMMARY\n${canary}` }));
    const items = (await listProfileItems(api)).items;
    responses.push(JSON.stringify(items));
    await record(api.call("POST", `/api/profile/items/${items[0]!.id}/confirm`));
    await record(api.call("POST", `/api/cv/versions/${versionId}/activate`));
    await record(api.call("GET", "/api/cv/versions"));
    await record(api.call("GET", "/api/profile/export"));
    // Failing paths must not leak either.
    await record(submitExtraction(api, versionId, { status: "extracted", parser: "nisco-docx", parserVersion: "1.0.0", text: canary }));
    await record(api.call("DELETE", `/api/cv/versions/${versionId}`, { body: { confirm: "DELETE" } }));

    const logs = logged.join("\n");
    expect(logs).not.toContain(canary);
    expect(logs).not.toContain("alex.synthetic@example.test");
    expect(logs).not.toContain("Alex Synthetic");
    expect(logs).not.toContain("private/");
    for (const body of responses) expect(body).not.toMatch(/private\/(uploads|cv)\//);
  });
});
