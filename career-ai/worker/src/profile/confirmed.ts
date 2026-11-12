import type { CareerProfile } from "../domain/profile";
import { listItems, parseValue, type ProfileItemRow } from "../db/profile-items";
import type { ItemValue, ProfileSection } from "./schema";

/**
 * The profile used by matching, drafts and discovery: built ONLY from items the user has
 * explicitly confirmed. Proposed (extracted or carried-over) items and the Phase 1 profile row are
 * never used. The output is plain formatting of confirmed values; nothing is inferred or added.
 */

export interface ConfirmedProfile {
  profile: CareerProfile;
  confirmedCount: number;
  updatedAt: string | null;
  /** Confirmed preferred job titles, used as discovery role terms. */
  preferredTitles: string[];
}

const str = (value: ItemValue, key: string): string => {
  const entry = value[key];
  return typeof entry === "string" ? entry : "";
};

const join = (parts: string[], separator: string) => parts.filter((part) => part.trim() !== "").join(separator);

function formatExperience(value: ItemValue): string {
  const title = join([str(value, "role"), str(value, "employer")], " — ") || str(value, "heading");
  const dates = join([str(value, "start"), str(value, "end")], " – ");
  const header = join([title, dates ? `(${dates})` : "", str(value, "location")], " ");
  const achievements = Array.isArray(value.achievements) ? value.achievements.map((line) => `- ${line}`) : [];
  return join([header, ...achievements], "\n");
}

function formatEducation(value: ItemValue): string {
  const title = join([str(value, "qualification"), str(value, "institution")], ", ") || str(value, "heading");
  const dates = join([str(value, "start"), str(value, "end")], " – ");
  return join([title, dates ? `(${dates})` : "", str(value, "details")], " ");
}

function formatCertification(value: ItemValue): string {
  return join([str(value, "name"), str(value, "issuer") ? `(${str(value, "issuer")})` : "", str(value, "date")], " ");
}

const REMOTE_LABELS: Record<string, string> = {
  remote_only: "remote only",
  remote_or_onsite: "remote or on-site",
  hybrid: "hybrid",
  onsite_only: "on-site only",
};

export function buildConfirmedProfile(rows: ProfileItemRow[]): ConfirmedProfile | null {
  const confirmed = rows.filter((row) => row.status === "confirmed");
  if (confirmed.length === 0) return null;
  const by = (section: ProfileSection) => confirmed.filter((row) => row.section === section).map(parseValue);
  const first = (section: ProfileSection) => str(by(section)[0] ?? {}, "text");

  const yearsText = first("years_experience");
  const years = /^\d{1,2}$/.test(yearsText) ? Number(yearsText) : null;
  const approved = by("approved_location").map((value) => str(value, "text"));
  const remote = REMOTE_LABELS[str(by("remote_preference")[0] ?? {}, "value")] ?? "";
  const preferredTitles = by("preferred_title").map((value) => str(value, "text"));

  const profile: CareerProfile = {
    name: first("name"),
    headline: first("headline"),
    years: years !== null && years <= 60 ? years : null,
    location: join(
      [first("location_text"), approved.length ? `Approved locations: ${approved.join("; ")}` : "", remote ? `Remote preference: ${remote}` : ""],
      ". ",
    ),
    summary: first("summary"),
    skills: join([by("skill").map((value) => str(value, "text")).join(", "), first("skills_text")], "\n"),
    experience: join(
      [
        by("experience").map(formatExperience).join("\n\n"),
        first("experience_text"),
        by("education").length ? `Education:\n${by("education").map(formatEducation).join("\n")}` : "",
        by("certification").length ? `Certifications:\n${by("certification").map(formatCertification).join("\n")}` : "",
      ],
      "\n\n",
    ),
    roles: join([preferredTitles.join(", "), first("preferred_titles_text")], "\n"),
  };

  const updatedAt = confirmed.reduce<string | null>((latest, row) => {
    const at = row.decided_at ?? row.updated_at;
    return latest === null || at > latest ? at : latest;
  }, null);
  return { profile, confirmedCount: confirmed.length, updatedAt, preferredTitles };
}

export async function getConfirmedProfile(db: D1Database): Promise<ConfirmedProfile | null> {
  return buildConfirmedProfile(await listItems(db, { statuses: ["confirmed"] }));
}
