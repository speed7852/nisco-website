import type { ProfileSection } from "./schema";

/**
 * Phase 1 profile fields and the structured section each one is PROPOSED into, verbatim.
 * Must match the mapping in migrations/0003_phase2_cv_profile.sql.
 * "location" was "current base and preferred locations" free text, so it maps to location_text,
 * never to approved locations. Free-text skills, experience and roles are not split.
 */
export const LEGACY_FIELD_MAP: readonly { field: string; section: ProfileSection; position: number }[] = [
  { field: "name", section: "name", position: 1 },
  { field: "headline", section: "headline", position: 2 },
  { field: "years", section: "years_experience", position: 3 },
  { field: "location", section: "location_text", position: 4 },
  { field: "summary", section: "summary", position: 5 },
  { field: "skills", section: "skills_text", position: 6 },
  { field: "experience", section: "experience_text", position: 7 },
  { field: "roles", section: "preferred_titles_text", position: 8 },
];

/**
 * Reads the stored Phase 1 profile text and returns each non-empty field verbatim. Numbers become
 * their decimal text (as SQLite's CAST does in the migration). Returns [] for anything that is not a
 * JSON object, so malformed historical rows produce no proposals.
 */
export function legacyFieldValues(raw: string): { field: string; section: ProfileSection; position: number; text: string }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
  const record = parsed as Record<string, unknown>;
  const values: { field: string; section: ProfileSection; position: number; text: string }[] = [];
  for (const mapping of LEGACY_FIELD_MAP) {
    const value = record[mapping.field];
    const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : null;
    if (text !== null && text.trim() !== "") values.push({ ...mapping, text });
  }
  return values;
}
