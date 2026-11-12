import type { CareerProfile } from "../domain/profile";

/**
 * Which discovered jobs are worth saving.
 *
 * Role: the title must contain one of the role terms (defaults below plus the profile's target roles).
 * Location: the job must be in Saudi Arabia or India, in a region that includes them, or remote
 * with no restriction to some other country. "Remote - USA only" or a Berlin role flagged remote
 * is excluded; "Worldwide" or a blank remote location is kept.
 */

export const DEFAULT_ROLE_TERMS = [
  "pmo",
  "program manager",
  "programme manager",
  "project manager",
  "service delivery",
  "it operations",
  "transformation manager",
  "delivery manager",
  "portfolio manager",
] as const;

/** Places in the target markets. Matched as whole words, so "india" does not match "Indiana". */
export const TARGET_PLACES = [
  "saudi arabia",
  "saudi",
  "ksa",
  "riyadh",
  "jeddah",
  "dammam",
  "khobar",
  "madinah",
  "medina",
  "makkah",
  "mecca",
  "india",
  "chennai",
  "bengaluru",
  "bangalore",
  "hyderabad",
  "mumbai",
  "pune",
  "delhi",
  "new delhi",
  "noida",
  "gurgaon",
  "gurugram",
  "kolkata",
] as const;

/** Regions that include Saudi Arabia or India, so a remote role limited to them is still eligible. */
export const TARGET_REGIONS = ["emea", "mena", "middle east", "gcc", "apac", "asia", "asia pacific"] as const;

const GLOBAL_REMOTE_WORDS = ["remote", "worldwide", "anywhere", "global", "globally", "work from anywhere", "fully"];

function wordPattern(terms: readonly string[]): RegExp {
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  return new RegExp(`\\b(?:${escaped.join("|")})\\b`, "i");
}

const TARGET_PATTERN = wordPattern([...TARGET_PLACES, ...TARGET_REGIONS]);
const GLOBAL_PATTERN = wordPattern(GLOBAL_REMOTE_WORDS);

export function roleTerms(profile: CareerProfile | null): string[] {
  const fromProfile = (profile?.roles ?? "")
    .split(/[,;\n]/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 3 && term.length <= 60);
  return [...new Set([...DEFAULT_ROLE_TERMS, ...fromProfile])];
}

export function matchesRole(title: string, terms: readonly string[]): boolean {
  const lower = title.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

export type LocationDecision = { eligible: true; reason: "target_location" | "global_remote" } | { eligible: false; reason: "remote_restricted_elsewhere" | "not_target_location" };

export function locationEligibility(location: string, remote: boolean): LocationDecision {
  const lower = location.toLowerCase();
  if (TARGET_PATTERN.test(lower)) return { eligible: true, reason: "target_location" };
  const isRemote = remote || /\bremote\b/i.test(lower);
  if (!isRemote) return { eligible: false, reason: "not_target_location" };
  // Remove words that mean "anywhere" and punctuation; whatever is left is a restriction.
  const remainder = lower
    .replace(new RegExp(GLOBAL_PATTERN.source, "gi"), " ")
    .replace(/[^a-z]+/g, " ")
    .trim();
  return remainder === "" ? { eligible: true, reason: "global_remote" } : { eligible: false, reason: "remote_restricted_elsewhere" };
}
