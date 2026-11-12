import { FieldErrors, readString, rejectUnknownKeys, requireObject } from "../http/validation";

/**
 * The master career profile. Every AI prompt uses only these saved facts, so they must be accurate.
 * Text fields are free text in Phase 1; structured experience entries arrive in a later phase.
 */
export interface CareerProfile {
  name: string;
  headline: string;
  years: number | null;
  location: string;
  summary: string;
  skills: string;
  experience: string;
  roles: string;
}

/** Maximum characters per text field. */
export const PROFILE_TEXT_LIMITS = {
  name: 120,
  headline: 200,
  location: 300,
  summary: 4_000,
  skills: 4_000,
  experience: 20_000,
  roles: 2_000,
} as const;

const TEXT_FIELDS = Object.keys(PROFILE_TEXT_LIMITS) as (keyof typeof PROFILE_TEXT_LIMITS)[];
const ALLOWED_FIELDS = [...TEXT_FIELDS, "years"] as const;

export function emptyProfile(): CareerProfile {
  return { name: "", headline: "", years: null, location: "", summary: "", skills: "", experience: "", roles: "" };
}

/**
 * Validates a profile submitted by the user. Rejects anything that is not a JSON object with the
 * known fields; JSON primitives, arrays and unknown keys are 400 errors.
 */
export function validateProfile(input: unknown): CareerProfile {
  const body = requireObject(input, "Profile");
  const errors = new FieldErrors();
  rejectUnknownKeys(body, ALLOWED_FIELDS, errors);

  const profile = emptyProfile();
  for (const field of TEXT_FIELDS) {
    profile[field] = readString(body, field, { max: PROFILE_TEXT_LIMITS[field] }, errors) ?? "";
  }
  profile.years = readYears(body.years, errors);
  errors.throwIfAny("Some profile fields are invalid.");
  return profile;
}

function readYears(value: unknown, errors: FieldErrors): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60) {
    errors.add("years", "Must be a whole number from 0 to 60.");
    return null;
  }
  return parsed;
}

/**
 * Reads a profile stored in D1. Rows written before validation existed may not match the shape,
 * so unknown values are dropped rather than trusted.
 */
export function parseStoredProfile(data: string): CareerProfile | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const profile = emptyProfile();
  for (const field of TEXT_FIELDS) {
    const text = source[field];
    if (typeof text === "string") profile[field] = text.slice(0, PROFILE_TEXT_LIMITS[field]);
  }
  const years = source.years;
  const parsedYears = typeof years === "number" ? years : typeof years === "string" ? Number(years) : NaN;
  profile.years = Number.isInteger(parsedYears) && parsedYears >= 0 && parsedYears <= 60 ? parsedYears : null;
  return profile;
}

export function profileHasFacts(profile: CareerProfile): boolean {
  return [profile.headline, profile.summary, profile.skills, profile.experience].some((text) => text.trim() !== "");
}
