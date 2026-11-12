import { describe, expect, it } from "vitest";
import { corsHeaders, parseAllowedOrigins } from "../../src/http/cors";

describe("parseAllowedOrigins", () => {
  it("keeps exact https origins and loopback http origins only", () => {
    const origins = parseAllowedOrigins(
      " https://Nisco-Career-AI.pages.dev/ , http://127.0.0.1:4173, http://localhost:8788, http://evil.example, https://*.pages.dev, javascript:alert(1), ",
    );
    expect([...origins].sort()).toEqual(["http://127.0.0.1:4173", "http://localhost:8788", "https://nisco-career-ai.pages.dev"]);
  });

  it("returns no CORS grant for an empty or missing configuration", () => {
    expect(parseAllowedOrigins(undefined).size).toBe(0);
    expect(corsHeaders("https://nisco-career-ai.pages.dev", parseAllowedOrigins(""), false)).toEqual({ vary: "Origin" });
  });
});
