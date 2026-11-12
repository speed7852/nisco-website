import { listItems, insertItemStatement, parseValue, type NewProfileItem } from "../db/profile-items";
import { comparableValue, type ProfileSection } from "./schema";

/**
 * Inserts proposals, skipping any whose value already exists in the same section as a confirmed or
 * proposed item (from any source) or as a rejected item from the same CV version. Re-importing the
 * same CV, or the same Phase 1 profile, therefore never duplicates work and never touches
 * confirmed facts. Returns the number inserted.
 */
export async function insertProposalsDeduplicated(
  db: D1Database,
  proposals: NewProfileItem[],
  options: { now: string; rejectedFromCvVersionId?: string },
): Promise<number> {
  if (proposals.length === 0) return 0;
  const existing = await listItems(db, { statuses: ["confirmed", "proposed", "rejected"] });
  const seen = new Set<string>();
  for (const row of existing) {
    if (row.status === "rejected" && row.source_cv_version_id !== options.rejectedFromCvVersionId) continue;
    seen.add(`${row.section}|${comparableValue(parseValue(row))}`);
  }
  const statements = [];
  for (const proposal of proposals) {
    const key = `${proposal.section}|${comparableValue(proposal.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    statements.push(insertItemStatement(db, proposal, options.now));
  }
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  return statements.length;
}

export type SectionState = "confirmed" | "unconfirmed" | "missing";

/** Sections whose free-text counterpart also satisfies them when reporting what is missing. */
const SATISFIED_BY: Partial<Record<ProfileSection, ProfileSection>> = {
  skill: "skills_text",
  experience: "experience_text",
  preferred_title: "preferred_titles_text",
};

export function sectionStates(
  rows: { section: ProfileSection; status: string }[],
  sections: readonly ProfileSection[],
): Record<ProfileSection, SectionState> {
  const has = (section: ProfileSection | undefined, status: string) =>
    section !== undefined && rows.some((row) => row.section === section && row.status === status);
  const states = {} as Record<ProfileSection, SectionState>;
  for (const section of sections) {
    const alternative = SATISFIED_BY[section];
    if (has(section, "confirmed") || has(alternative, "confirmed")) states[section] = "confirmed";
    else if (has(section, "proposed") || has(alternative, "proposed")) states[section] = "unconfirmed";
    else states[section] = "missing";
  }
  return states;
}
