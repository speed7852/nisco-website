import { describe, expect, it } from "vitest";
import { locationEligibility, matchesRole, roleTerms } from "../../src/discovery/filters";
import { htmlToText, truncate } from "../../src/domain/text";
import { emptyProfile } from "../../src/domain/profile";

describe("locationEligibility (audit S01)", () => {
  it.each([
    ["Riyadh", false, "target_location"],
    ["Jeddah, Saudi Arabia", false, "target_location"],
    ["Bengaluru, India", false, "target_location"],
    ["Remote - India", true, "target_location"],
    ["Remote (EMEA)", true, "target_location"],
    ["Worldwide", true, "global_remote"],
    ["Remote", true, "global_remote"],
    ["Anywhere in the world", true, "remote_restricted_elsewhere"],
    ["", true, "global_remote"],
    ["Fully remote, worldwide", false, "global_remote"],
  ])("%j (remote=%s) -> %s", (location, remote, reason) => {
    expect(locationEligibility(location, remote).reason).toBe(reason);
  });

  it.each([
    ["Berlin", true],
    ["Remote - USA only", true],
    ["United States", true],
    ["Remote, Germany", true],
    ["London, UK", false],
    ["Indianapolis, Indiana", false],
  ])("excludes %j (remote=%s)", (location, remote) => {
    expect(locationEligibility(location, remote).eligible).toBe(false);
  });
});

describe("role terms", () => {
  it("adds the profile's target roles to the defaults", () => {
    const terms = roleTerms({ ...emptyProfile(), roles: "Head of Service Management; Release Manager\nPMO Lead" });
    expect(terms).toEqual(expect.arrayContaining(["pmo", "head of service management", "release manager", "pmo lead"]));
  });

  it("matches titles case-insensitively", () => {
    const terms = roleTerms(null);
    expect(matchesRole("Senior PROGRAM MANAGER, Digital", terms)).toBe(true);
    expect(matchesRole("Frontend Engineer", terms)).toBe(false);
  });
});

describe("htmlToText", () => {
  it("removes tags, scripts and styles and decodes entities", () => {
    const html = "<p>Lead the <b>PMO</b> &amp; ITIL&nbsp;team.</p><script>alert(1)</script><style>p{}</style><ul><li>Budget</li><li>Risk</li></ul>";
    expect(htmlToText(html)).toBe("Lead the PMO & ITIL team.\n• Budget\n• Risk");
  });

  it("decodes numeric entities", () => {
    expect(htmlToText("Caf&#233; &#x2014; ok")).toBe("Café — ok");
  });

  it("truncates with an ellipsis", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });
});
