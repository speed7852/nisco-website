import { describe, expect, it } from "vitest";
import { call, makeEnv, session } from "./helpers";

describe("routing and error handling", () => {
  it("returns 404 for unknown routes", async () => {
    const result = await call(makeEnv(), "GET", "/api/nothing-here");
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("not_found");
  });

  it("returns 405 with an Allow header for a wrong method", async () => {
    const result = await call(makeEnv(), "DELETE", "/api/profile");
    expect(result.status).toBe(405);
    expect(result.headers.get("allow")).toContain("GET");
  });

  it("returns a generic 500 with a request ID and no internal details for unexpected failures", async () => {
    const api = await session();
    const brokenDb = { prepare: () => { throw new Error("SQLITE internal secret detail"); } } as unknown as D1Database;
    const result = await api.call("GET", "/api/profile", {});
    expect(result.status).toBe(200);
    const broken = await call({ ...api.env, DB: brokenDb }, "GET", "/api/profile", { token: api.token });
    expect(broken.status).toBe(500);
    expect(broken.body.error).toBe("internal_error");
    expect(typeof broken.body.requestId).toBe("string");
    expect(JSON.stringify(broken.body)).not.toContain("SQLITE");
  });

  it("returns 400 when a JSON body is required but missing", async () => {
    const api = await session();
    expect((await api.call("POST", "/api/jobs", {})).status).toBe(400);
  });
});
