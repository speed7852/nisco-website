import { describe, expect, it } from "vitest";
import { isSafeLink, normaliseJobUrl } from "../../src/domain/urls";

describe("normaliseJobUrl: scheme safety (audit P07)", () => {
  it.each([
    "javascript:alert(document.domain)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://jobs.example.com/1",
    "ftp://jobs.example.com/1",
    "file:///etc/passwd",
    "vbscript:msgbox",
    "//jobs.example.com/1",
    "jobs.example.com/1",
    "https://user:pass@jobs.example.com/1",
    "https://localhost/job",
    "   ",
  ])("rejects %s", (url) => {
    expect(normaliseJobUrl(url).ok).toBe(false);
  });

  it("rejects URLs longer than 2048 characters", () => {
    expect(normaliseJobUrl(`https://jobs.example.com/${"a".repeat(2100)}`).ok).toBe(false);
  });

  it("accepts https and keeps the URL as entered", () => {
    const result = normaliseJobUrl("  https://Jobs.Example.com/role/42?utm_source=x  ");
    expect(result).toEqual({ ok: true, url: "https://Jobs.Example.com/role/42?utm_source=x", canonical: "https://jobs.example.com/role/42" });
  });
});

describe("normaliseJobUrl: canonical form for de-duplication (audit S01)", () => {
  const canonical = (url: string) => {
    const result = normaliseJobUrl(url);
    if (!result.ok) throw new Error(result.reason);
    return result.canonical;
  };

  it("collapses tracking-parameter variants to one canonical URL", () => {
    const variants = [
      "https://jobs.example.com/rpm?utm_source=a",
      "https://jobs.example.com/rpm?utm_source=b&utm_medium=email",
      "https://jobs.example.com/rpm/?gclid=123",
      "https://jobs.example.com/rpm#apply",
      "https://JOBS.example.com/rpm?fbclid=9&ref=feed",
      "https://jobs.example.com/rpm?trk=public_jobs&trackingId=abc&refId=x",
    ];
    expect(new Set(variants.map(canonical))).toEqual(new Set(["https://jobs.example.com/rpm"]));
  });

  it("keeps parameters that identify the job and sorts them", () => {
    expect(canonical("https://jobs.example.com/view?jk=2&id=1&utm_campaign=z")).toBe("https://jobs.example.com/view?id=1&jk=2");
    expect(canonical("https://jobs.example.com/view?id=1")).not.toBe(canonical("https://jobs.example.com/view?id=2"));
  });

  it("keeps the root path", () => {
    expect(canonical("https://jobs.example.com/")).toBe("https://jobs.example.com/");
  });
});

describe("isSafeLink", () => {
  it.each([
    ["https://jobs.example.com", true],
    ["javascript:alert(1)", false],
    ["http://jobs.example.com", false],
    ["", false],
    [null, false],
    ["not a url", false],
  ])("%s -> %s", (value, expected) => {
    expect(isSafeLink(value)).toBe(expected);
  });
});
