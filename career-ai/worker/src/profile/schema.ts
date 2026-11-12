import { HttpError } from "../http/errors";
import { FieldErrors, requireObject, type JsonObject } from "../http/validation";

/**
 * The structured candidate profile: sections, their fields and validation.
 *
 * Every fact is one `profile_items` row with a status (proposed, confirmed, rejected, superseded).
 * Single-value sections hold at most one confirmed value; multi-value sections hold lists.
 * The section lists must match the trigger and unique index in migrations/0003_phase2_cv_profile.sql.
 * The browser renders its forms from SECTION_SPECS (served by GET /api/profile/items).
 */

export const SINGLE_VALUE_SECTIONS = [
  "name",
  "headline",
  "summary",
  "years_experience",
  "email",
  "phone",
  "location_text",
  "remote_preference",
  "skills_text",
  "experience_text",
  "preferred_titles_text",
] as const;

export const MULTI_VALUE_SECTIONS = [
  "link",
  "skill",
  "experience",
  "education",
  "certification",
  "preferred_title",
  "approved_location",
] as const;

export const PROFILE_SECTIONS = [...SINGLE_VALUE_SECTIONS, ...MULTI_VALUE_SECTIONS] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export function isProfileSection(value: unknown): value is ProfileSection {
  return typeof value === "string" && (PROFILE_SECTIONS as readonly string[]).includes(value);
}

export function isSingleValue(section: ProfileSection): boolean {
  return (SINGLE_VALUE_SECTIONS as readonly string[]).includes(section);
}

export const REMOTE_PREFERENCES = ["remote_only", "remote_or_onsite", "hybrid", "onsite_only"] as const;

export interface FieldSpec {
  name: string;
  label: string;
  kind: "text" | "multiline" | "list" | "choice";
  max: number;
  required?: boolean;
  choices?: readonly { value: string; label: string }[];
}

export interface SectionSpec {
  section: ProfileSection;
  label: string;
  group: "contact" | "summary" | "skills" | "experience" | "education" | "certifications" | "preferences" | "notes";
  single: boolean;
  fields: FieldSpec[];
  /** Counted when reporting which parts of the profile are still missing. */
  expected: boolean;
}

const text = (max: number, label = "Text"): FieldSpec[] => [{ name: "text", label, kind: max > 300 ? "multiline" : "text", max, required: true }];

export const SECTION_SPECS: Record<ProfileSection, SectionSpec> = {
  name: { section: "name", label: "Full name", group: "contact", single: true, fields: text(120, "Full name"), expected: true },
  email: { section: "email", label: "Email", group: "contact", single: true, fields: text(254, "Email address"), expected: true },
  phone: { section: "phone", label: "Phone", group: "contact", single: true, fields: text(40, "Phone number"), expected: false },
  location_text: { section: "location_text", label: "Current location", group: "contact", single: true, fields: text(300, "Location"), expected: false },
  link: { section: "link", label: "Links", group: "contact", single: false, fields: text(300, "Link (http or https)"), expected: false },
  headline: { section: "headline", label: "Headline", group: "summary", single: true, fields: text(200, "Headline"), expected: true },
  summary: { section: "summary", label: "Summary", group: "summary", single: true, fields: text(4000, "Summary"), expected: true },
  years_experience: { section: "years_experience", label: "Years of experience", group: "summary", single: true, fields: text(2, "Years (whole number)"), expected: false },
  skill: { section: "skill", label: "Skills", group: "skills", single: false, fields: text(100, "Skill"), expected: true },
  skills_text: { section: "skills_text", label: "Skills (free text)", group: "notes", single: true, fields: text(4000, "Skills"), expected: false },
  experience: {
    section: "experience",
    label: "Employment history",
    group: "experience",
    single: false,
    expected: true,
    fields: [
      { name: "role", label: "Role or title", kind: "text", max: 150 },
      { name: "employer", label: "Employer", kind: "text", max: 150 },
      { name: "start", label: "Start (as written)", kind: "text", max: 40 },
      { name: "end", label: "End (as written)", kind: "text", max: 40 },
      { name: "location", label: "Location", kind: "text", max: 120 },
      { name: "heading", label: "Heading as written in the CV", kind: "text", max: 300 },
      { name: "achievements", label: "Achievements (one per line)", kind: "list", max: 600 },
    ],
  },
  experience_text: { section: "experience_text", label: "Experience (free text)", group: "notes", single: true, fields: text(20000, "Experience"), expected: false },
  education: {
    section: "education",
    label: "Education",
    group: "education",
    single: false,
    expected: true,
    fields: [
      { name: "qualification", label: "Qualification", kind: "text", max: 200 },
      { name: "institution", label: "Institution", kind: "text", max: 200 },
      { name: "start", label: "Start (as written)", kind: "text", max: 40 },
      { name: "end", label: "End (as written)", kind: "text", max: 40 },
      { name: "heading", label: "Heading as written in the CV", kind: "text", max: 300 },
      { name: "details", label: "Details", kind: "multiline", max: 1000 },
    ],
  },
  certification: {
    section: "certification",
    label: "Certifications",
    group: "certifications",
    single: false,
    expected: false,
    fields: [
      { name: "name", label: "Certification", kind: "text", max: 200, required: true },
      { name: "issuer", label: "Issuer", kind: "text", max: 150 },
      { name: "date", label: "Date (as written)", kind: "text", max: 40 },
    ],
  },
  preferred_title: { section: "preferred_title", label: "Preferred job titles", group: "preferences", single: false, fields: text(120, "Job title"), expected: true },
  preferred_titles_text: { section: "preferred_titles_text", label: "Target roles (free text)", group: "notes", single: true, fields: text(2000, "Target roles"), expected: false },
  approved_location: { section: "approved_location", label: "Approved locations", group: "preferences", single: false, fields: text(120, "Location"), expected: true },
  remote_preference: {
    section: "remote_preference",
    label: "Remote-work preference",
    group: "preferences",
    single: true,
    expected: true,
    fields: [
      {
        name: "value",
        label: "Preference",
        kind: "choice",
        max: 20,
        required: true,
        choices: [
          { value: "remote_only", label: "Remote only" },
          { value: "remote_or_onsite", label: "Remote or on-site" },
          { value: "hybrid", label: "Hybrid" },
          { value: "onsite_only", label: "On-site only" },
        ],
      },
    ],
  },
};

export type ItemValue = Record<string, string | string[]>;

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[+()\d\s./-]{6,40}$/;
const LINK = /^(https?:\/\/|www\.)\S{3,}$/i;
const YEARS = /^\d{1,2}$/;

/**
 * Validates and normalises a value for a section: trims strings, drops empty optional fields,
 * rejects unknown fields and wrong types. Throws a 400 with field-level messages.
 */
export function validateItemValue(section: ProfileSection, input: unknown): ItemValue {
  const spec = SECTION_SPECS[section];
  const body: JsonObject = requireObject(input, "Value");
  const errors = new FieldErrors();
  const allowed = spec.fields.map((field) => field.name);
  for (const key of Object.keys(body)) if (!allowed.includes(key)) errors.add(key, "Unknown field.");

  const value: ItemValue = {};
  for (const field of spec.fields) {
    const raw = body[field.name];
    if (field.kind === "list") {
      if (raw === undefined || raw === null) continue;
      if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) {
        errors.add(field.name, "Must be a list of text lines.");
        continue;
      }
      const lines = raw.map((entry: string) => entry.trim()).filter(Boolean);
      if (lines.length > 30) errors.add(field.name, "At most 30 lines.");
      else if (lines.some((line) => line.length > field.max)) errors.add(field.name, `Each line must be ${field.max} characters or fewer.`);
      else if (lines.length > 0) value[field.name] = lines;
      continue;
    }
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
      if (field.required) errors.add(field.name, "Required.");
      continue;
    }
    if (typeof raw !== "string") {
      errors.add(field.name, "Must be text.");
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.length > field.max) {
      errors.add(field.name, `Must be ${field.max} characters or fewer.`);
      continue;
    }
    if (field.kind === "choice" && !field.choices?.some((choice) => choice.value === trimmed)) {
      errors.add(field.name, `Must be one of: ${field.choices?.map((choice) => choice.value).join(", ")}.`);
      continue;
    }
    value[field.name] = trimmed;
  }

  const textValue = typeof value.text === "string" ? value.text : "";
  if (section === "email" && textValue && !EMAIL.test(textValue)) errors.add("text", "Not a valid email address.");
  if (section === "phone" && textValue && (!PHONE.test(textValue) || (textValue.match(/\d/g) ?? []).length < 6)) {
    errors.add("text", "Not a valid phone number.");
  }
  if (section === "link" && textValue && !LINK.test(textValue)) errors.add("text", "Links must start with http://, https:// or www.");
  if (section === "years_experience" && textValue && (!YEARS.test(textValue) || Number(textValue) > 60)) {
    errors.add("text", "Must be a whole number from 0 to 60.");
  }
  if (section === "experience" && !value.role && !value.employer && !value.heading) {
    errors.add("role", "Give at least a role, an employer or a heading.");
  }
  if (section === "education" && !value.qualification && !value.institution && !value.heading) {
    errors.add("qualification", "Give at least a qualification, an institution or a heading.");
  }
  errors.throwIfAny(`Some ${spec.label.toLowerCase()} fields are invalid.`);
  return value;
}

export function requireSection(value: unknown): ProfileSection {
  if (!isProfileSection(value)) throw new HttpError(400, "invalid_request", "Unknown profile section.", { section: "Unknown section." });
  return value;
}

/** Comparison key for de-duplication: case-insensitive, whitespace-collapsed, field-order independent. */
export function comparableValue(value: ItemValue): string {
  const normalise = (entry: string) => entry.toLowerCase().replace(/\s+/g, " ").trim();
  const keys = Object.keys(value).sort();
  return JSON.stringify(
    keys.map((key) => {
      const entry = value[key];
      return [key, Array.isArray(entry) ? entry.map(normalise) : normalise(entry ?? "")];
    }),
  );
}

/** Every string in the value, for the grounding check. */
export function valueStrings(value: ItemValue): string[] {
  return Object.values(value).flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
}
