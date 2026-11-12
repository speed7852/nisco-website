import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/http/errors";
import { comparableValue, PROFILE_SECTIONS, SECTION_SPECS, SINGLE_VALUE_SECTIONS, validateItemValue } from "../../src/profile/schema";
import { buildConfirmedProfile } from "../../src/profile/confirmed";
import { legacyFieldValues } from "../../src/profile/legacy";
import type { ProfileItemRow } from "../../src/db/profile-items";

const fails = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof HttpError ? error.fields ?? {} : { unexpected: String(error) };
  }
  return null;
};

describe("profile section schemas", () => {
  it("has a spec for every section and marks single-value sections", () => {
    for (const section of PROFILE_SECTIONS) expect(SECTION_SPECS[section].section).toBe(section);
    for (const section of SINGLE_VALUE_SECTIONS) expect(SECTION_SPECS[section].single).toBe(true);
  });

  it("trims text and drops empty optional fields", () => {
    expect(validateItemValue("experience", { role: "  Lead ", employer: "", achievements: [" a ", "", "b"] })).toEqual({ role: "Lead", achievements: ["a", "b"] });
  });

  it.each([
    ["email", { text: "not-an-email" }, "text"],
    ["phone", { text: "call me" }, "text"],
    ["link", { text: "javascript:alert(1)" }, "text"],
    ["years_experience", { text: "61" }, "text"],
    ["years_experience", { text: "twelve" }, "text"],
    ["remote_preference", { value: "sometimes" }, "value"],
    ["experience", { start: "2020" }, "role"],
    ["education", { start: "2010" }, "qualification"],
    ["certification", { issuer: "Body" }, "name"],
    ["skill", { text: "x".repeat(101) }, "text"],
    ["skill", { text: "ok", extra: "no" }, "extra"],
    ["experience", { role: "R", achievements: "not a list" }, "achievements"],
  ])("rejects invalid %s values", (section, value, field) => {
    const fields = fails(() => validateItemValue(section as never, value));
    expect(fields).not.toBeNull();
    expect(Object.keys(fields!)).toContain(field);
  });

  it("rejects non-object values", () => {
    expect(fails(() => validateItemValue("name", "Alex"))).not.toBeNull();
    expect(fails(() => validateItemValue("name", ["Alex"]))).not.toBeNull();
  });

  it("compares values ignoring case, spacing and field order", () => {
    expect(comparableValue({ text: "PMO  Governance" })).toBe(comparableValue({ text: "pmo governance" }));
    expect(comparableValue({ role: "A", employer: "B" })).toBe(comparableValue({ employer: "b", role: "a" }));
    expect(comparableValue({ text: "PMO" })).not.toBe(comparableValue({ text: "ITIL" }));
  });
});

describe("legacy profile mapping", () => {
  it("returns each non-empty field verbatim, with numbers as text", () => {
    const raw = JSON.stringify({ name: "Synthetic Person", years: 12, skills: "PMO, ITIL", experience: "", location: "Riyadh; remote", extra: "ignored" });
    expect(legacyFieldValues(raw).map(({ field, section, text }) => [field, section, text])).toEqual([
      ["name", "name", "Synthetic Person"],
      ["years", "years_experience", "12"],
      ["location", "location_text", "Riyadh; remote"],
      ["skills", "skills_text", "PMO, ITIL"],
    ]);
  });

  it.each([["not json"], ['"a bare string"'], ["[1,2]"], ["null"]])("produces nothing for malformed stored data %j", (raw) => {
    expect(legacyFieldValues(raw)).toEqual([]);
  });
});

describe("confirmed-only profile", () => {
  const row = (section: string, value: unknown, status = "confirmed"): ProfileItemRow =>
    ({ id: crypto.randomUUID(), section, value: JSON.stringify(value), status, source: "manual", source_cv_version_id: null, source_snapshot_id: null, source_field: null, source_start: null, source_end: null, user_edited: 0, position: 0, created_at: "2026-01-01", updated_at: "2026-01-01", decided_at: "2026-01-02" }) as ProfileItemRow;

  it("uses confirmed items only and returns null when nothing is confirmed", () => {
    expect(buildConfirmedProfile([row("summary", { text: "Proposed only" }, "proposed")])).toBeNull();
    const built = buildConfirmedProfile([
      row("summary", { text: "Confirmed summary" }),
      row("headline", { text: "Unreviewed headline" }, "proposed"),
      row("skill", { text: "PMO" }),
      row("skill", { text: "Rejected skill" }, "rejected"),
      row("preferred_title", { text: "Programme Manager" }),
      row("experience", { role: "Lead", employer: "Example Co", start: "2020", end: "Present", achievements: ["Did a thing"] }),
      row("approved_location", { text: "Riyadh" }),
      row("remote_preference", { value: "remote_or_onsite" }),
    ]);
    expect(built?.profile.summary).toBe("Confirmed summary");
    expect(built?.profile.headline).toBe("");
    expect(built?.profile.skills).toBe("PMO");
    expect(built?.profile.roles).toBe("Programme Manager");
    expect(built?.profile.experience).toContain("Lead — Example Co (2020 – Present)\n- Did a thing");
    expect(built?.profile.location).toBe("Approved locations: Riyadh. Remote preference: remote or on-site");
    expect(JSON.stringify(built)).not.toContain("Unreviewed");
    expect(JSON.stringify(built)).not.toContain("Rejected");
    expect(built?.preferredTitles).toEqual(["Programme Manager"]);
  });
});
