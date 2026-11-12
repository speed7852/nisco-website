import { valueStrings, type ItemValue, type ProfileSection } from "./schema";

/**
 * Fixed-rule structuring of extracted CV text into PROPOSED profile items.
 *
 * Rules, not AI. Every string in every proposal is an exact substring of the CV text, and each
 * proposal records the character span it came from. `groundedOnly` re-checks that invariant before
 * anything is returned, so a rule bug can only drop a proposal, never invent one. Dates are kept as
 * written. Employer and role are filled for "Role at Employer", and for a title written next to an
 * employer ("Title" above "Employer | Location | Dates", or "Title | Employer | Dates") only when
 * exactly one of the two contains a job-title word; otherwise the heading is kept verbatim for the
 * user to assign. Preferences (preferred titles, approved locations, remote preference) are never
 * extracted: they are the user's choices. The current location is contact information, not a
 * preference: it is proposed only from a pipe-separated contact line that also holds the email or
 * phone number.
 */

export interface Proposal {
  section: ProfileSection;
  value: ItemValue;
  start: number;
  end: number;
}

export const STRUCTURER_VERSION = "rules-1.1.0";
const MAX_PROPOSALS = 200;

interface Line {
  text: string;
  start: number;
  end: number;
  blankBefore: boolean;
}

type Block = "summary" | "experience" | "education" | "certifications" | "skills" | "other";

/** Section headings recognised, compared case-insensitively without trailing colons. */
export const HEADINGS: Record<Exclude<Block, "other">, readonly string[]> = {
  summary: ["summary", "professional summary", "profile", "professional profile", "about me", "career summary", "executive summary", "career objective", "objective"],
  experience: ["experience", "work experience", "professional experience", "employment history", "employment", "career history", "work history", "relevant experience"],
  education: ["education", "academic background", "academic qualifications", "education and training", "qualifications"],
  certifications: ["certifications", "certification", "certificates", "licenses", "licences", "licenses and certifications", "professional certifications", "certifications and training"],
  skills: ["skills", "key skills", "core skills", "technical skills", "core competencies", "competencies", "areas of expertise", "expertise", "skills and competencies"],
};
const OTHER_HEADINGS = ["languages", "projects", "references", "interests", "hobbies", "publications", "awards", "volunteering", "additional information", "personal details"];

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE = `(?:${MONTH}\\.?\\s+\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})`;
const DATE_END = `(?:${DATE}|present|current|now|today|date)`;
const RANGE = new RegExp(`(${DATE})\\s*(?:–|—|-|to|until)\\s*(${DATE_END})\\b`, "i");
const YEAR = /\b(?:19|20)\d{2}\b/;
const BULLET = /^(?:[•▪◦●∙·\-*–]|\d{1,2}[.)])\s+/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+|00)?\d[\d\s().-]{6,}\d/g;
const LINK = /\b(?:https?:\/\/|www\.)[^\s,;|<>()"']+/gi;
const INSTITUTION = /\b(?:university|college|institute|school|academy|polytechnic)\b/i;
const QUALIFICATION = /\b(?:b\.?sc|b\.?a|b\.?eng|b\.?tech|b\.?com|m\.?sc|m\.?a|mba|m\.?eng|m\.?tech|ph\.?d|bachelor|master|diploma|doctorate|associate degree)\b/i;
/**
 * Words that mark a job title. Used only to tell a title from an employer when a CV writes both
 * next to each other; it never creates a value, it only decides which field an existing one goes in.
 */
const ROLE_WORDS =
  /\b(?:manager|lead|leader|head|director|consultant|specialist|associate|analyst|engineer|developer|programmer|architect|officer|coordinator|co-ordinator|administrator|executive|supervisor|advisor|adviser|assistant|intern|trainee|designer|scientist|accountant|technician|representative|president|controller|auditor|planner|tester|clerk|secretary|teacher|lecturer)\b/i;
const MAX_ROLE = 150;
const MAX_EMPLOYER = 150;
const MAX_LOCATION = 120;

/** A whole contact-line part that is a phone number: 8-16 digits and phone punctuation, not a year range. */
function isPhoneLike(part: string): boolean {
  const digits = (part.match(/\d/g) ?? []).length;
  return /^(?:\+|00)?[\d\s().-]+$/.test(part) && digits >= 8 && digits <= 16 && !/^\d{4}\s*[-–—]\s*\d{4}$/.test(part);
}

/** A sentence rather than a heading: long, or a full stop after eight or more words. */
const isProse = (value: string) => value.length > 120 || (/[.!?]$/.test(value) && value.split(/\s+/).length >= 8);

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  let blankBefore = false;
  for (const raw of text.split("\n")) {
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed === "") {
      blankBefore = true;
    } else {
      lines.push({ text: trimmed, start: offset + leading, end: offset + leading + trimmed.length, blankBefore });
      blankBefore = false;
    }
    offset += raw.length + 1;
  }
  return lines;
}

const normaliseHeading = (value: string) => value.toLowerCase().replace(/[:：]\s*$/, "").replace(/\s+/g, " ").trim();

/** Returns the block a heading line opens, and any content written after "Heading:" on the same line. */
function headingOf(line: Line): { block: Block; rest: Line | null } | null {
  const colon = /^([^:：]{2,40})[:：]\s*(.*)$/.exec(line.text);
  const candidate = colon ? colon[1] ?? "" : line.text;
  if (candidate.length > 40) return null;
  const key = normaliseHeading(candidate);
  for (const [block, names] of Object.entries(HEADINGS) as [Exclude<Block, "other">, readonly string[]][]) {
    if (names.includes(key)) {
      const restText = colon?.[2] ?? "";
      if (!restText) return { block, rest: null };
      const restStart = line.end - restText.length;
      return { block, rest: { text: restText, start: restStart, end: line.end, blankBefore: false } };
    }
  }
  if (OTHER_HEADINGS.includes(key)) return { block: "other", rest: null };
  return null;
}

/** A line slice [from, to) within the text, trimmed, as an exact substring with offsets. */
function slice(text: string, from: number, to: number): { text: string; start: number; end: number } | null {
  const raw = text.slice(from, to);
  const leading = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return { text: trimmed, start: from + leading, end: from + leading + trimmed.length };
}

function stripBullet(text: string, line: Line): { text: string; start: number; end: number } | null {
  const bullet = BULLET.exec(line.text);
  return bullet ? slice(text, line.start + bullet[0].length, line.end) : { text: line.text, start: line.start, end: line.end };
}

function proposeContact(text: string, lines: Line[], out: Proposal[]): number {
  const email = EMAIL.exec(text);
  if (email) out.push({ section: "email", value: { text: email[0] }, start: email.index, end: email.index + email[0].length });

  const contactArea = lines.slice(0, 15);
  const contactEnd = contactArea.at(-1)?.end ?? 0;
  for (const match of text.slice(0, contactEnd).matchAll(PHONE)) {
    const candidate = match[0];
    const digits = (candidate.match(/\d/g) ?? []).length;
    if (digits < 8 || digits > 16) continue;
    if (/^\d{4}\s*[-–]\s*\d{4}$/.test(candidate.trim())) continue; // a year range, not a phone
    const index = match.index ?? 0;
    out.push({ section: "phone", value: { text: candidate }, start: index, end: index + candidate.length });
    break;
  }

  let links = 0;
  for (const match of text.matchAll(LINK)) {
    const url = match[0].replace(/[.,]+$/, "");
    const index = match.index ?? 0;
    out.push({ section: "link", value: { text: url }, start: index, end: index + url.length });
    if ((links += 1) >= 5) break;
  }

  // Name: an early line that looks like a personal name (2-5 words of letters only).
  let nameIndex = -1;
  for (let i = 0; i < Math.min(6, lines.length); i += 1) {
    const line = lines[i];
    if (!line || headingOf(line)) continue;
    const words = line.text.split(/\s+/);
    if (
      line.text.length <= 60 &&
      words.length >= 2 &&
      words.length <= 5 &&
      words.every((word) => /^\p{L}[\p{L}'.-]*$/u.test(word))
    ) {
      out.push({ section: "name", value: { text: line.text }, start: line.start, end: line.end });
      nameIndex = i;
      break;
    }
  }
  // Headline: the next line, if it is short prose rather than contact details or a heading.
  const next = nameIndex >= 0 ? lines[nameIndex + 1] : undefined;
  if (
    next &&
    !headingOf(next) &&
    next.text.length >= 3 &&
    next.text.length <= 150 &&
    !/@|https?:\/\/|www\./i.test(next.text) &&
    (next.text.match(/\d/g) ?? []).length < 6
  ) {
    out.push({ section: "headline", value: { text: next.text }, start: next.start, end: next.end });
  }

  const nameText = nameIndex >= 0 ? lines[nameIndex]?.text : undefined;
  // Current location: the part of a pipe-separated contact line, e.g.
  // "City, Country | +00 000 | name@example.test", that is not the email, a phone number or a link.
  // Only the lines above the first section heading are the contact area.
  const firstHeading = lines.findIndex((line) => headingOf(line) !== null);
  const contactLines = lines.slice(0, firstHeading >= 0 ? Math.min(firstHeading, 6) : 6);
  contact: for (const line of contactLines) {
    if (!line.text.includes("|")) continue;
    const parts = line.text.split("|").map((part) => part.trim());
    if (!parts.some((part) => EMAIL.test(part) || isPhoneLike(part))) continue;
    let cursor = line.start;
    for (const part of line.text.split("|")) {
      const at = text.indexOf(part, cursor);
      if (at < 0) break;
      cursor = at + part.length;
      const segment = slice(text, at, at + part.length);
      if (!segment || segment.text.length < 3 || segment.text.length > MAX_LOCATION) continue;
      if (/@|https?:\/\/|www\.|\.com\//i.test(segment.text) || (segment.text.match(/\d/g) ?? []).length > 2) continue;
      if (!/\p{L}/u.test(segment.text) || segment.text === nameText) continue;
      out.push({ section: "location_text", value: { text: segment.text }, start: segment.start, end: segment.end });
      break contact;
    }
  }
  return nameIndex;
}

/**
 * The parts written before the date range on a date line, split on "|":
 * "Employer | Location | Jan 2020 – Present" gives ["Employer", "Location"]. Without a pipe the
 * whole prefix is one part.
 */
function datePrefixParts(lineText: string, rangeIndex: number): string[] {
  const prefix = lineText.slice(0, rangeIndex).replace(/[\s|,–—-]+$/, "");
  return prefix.split("|").map((part) => part.trim()).filter(Boolean);
}

/**
 * Fills role, employer and location from text already in the entry's header lines or on its date
 * line, only when the reading is unambiguous. Otherwise they stay empty and the verbatim heading is
 * left for the user to assign.
 *
 * @param headers header lines above the date line, top to bottom
 * @param parts   pipe-separated parts before the date range on the date line
 */
function assignRoleAndEmployer(value: ItemValue, headers: string[], parts: string[]): void {
  const pair = (a: string | undefined, b: string | undefined): boolean => {
    if (!a || !b) return false;
    const aIsRole = ROLE_WORDS.test(a);
    if (aIsRole === ROLE_WORDS.test(b)) return false; // two titles, or none: ambiguous
    const [role, employer] = aIsRole ? [a, b] : [b, a];
    if (role.length > MAX_ROLE || employer.length > MAX_EMPLOYER) return false;
    value.role = role;
    value.employer = employer;
    return true;
  };
  const roleAt = (candidate: string | undefined): boolean => {
    const match = /^(.{2,150}?)\s+at\s+(.{2,150})$/i.exec(candidate ?? "");
    if (!match?.[1] || !match[2]) return false;
    value.role = match[1];
    value.employer = match[2];
    return true;
  };
  const location = (candidate: string | undefined) => {
    if (candidate && candidate.length <= MAX_LOCATION) value.location = candidate;
  };
  const split = (line: string) => line.split("|").map((part) => part.trim()).filter(Boolean);

  const above = headers.at(-1);
  if (above !== undefined && parts.length > 0) {
    // "Title" on its own line above "Employer | Location | Dates" (or the reverse).
    if (pair(above, parts[0]) && parts.length === 2) location(parts[1]);
    return;
  }
  if (above !== undefined) {
    if (roleAt(headers[0])) return;
    const headerParts = split(headers[0] ?? "");
    if (headers.length === 1 && headerParts.length >= 2) {
      // "Title | Employer | Location" above a date line.
      if (pair(headerParts[0], headerParts[1]) && headerParts.length === 3) location(headerParts[2]);
      return;
    }
    if (headers.length === 2) pair(headers[0], headers[1]); // "Employer" above "Title", or the reverse
    return;
  }
  // Everything on the date line: "Title | Employer | Location | Dates".
  if (parts.length === 1) {
    roleAt(parts[0]);
    return;
  }
  if (pair(parts[0], parts[1]) && parts.length === 3) location(parts[2]);
}

function proposeExperience(text: string, block: Line[], out: Proposal[]): void {
  const anchors = block.map((line, index) => ({ index, match: RANGE.exec(line.text) })).filter((a) => a.match !== null);
  if (anchors.length === 0) {
    const first = block[0];
    const last = block.at(-1);
    if (first && last) {
      const whole = slice(text, first.start, Math.min(last.end, first.start + 20_000));
      if (whole) out.push({ section: "experience_text", value: { text: whole.text }, start: whole.start, end: whole.end });
    }
    return;
  }

  // Parts written before the date range on the date line itself, e.g. "Employer | Location |".
  const prefixes = anchors.map((anchor) => datePrefixParts(block[anchor.index]?.text ?? "", anchor.match?.index ?? 0));

  // Header lines: contiguous non-bullet lines directly above each date line, at most two, or one
  // when the date line already names the employer. Word lists carry no bullet characters, so a
  // sentence-like line is treated as the previous entry's last bullet, not as a header.
  const headers = anchors.map((anchor, k) => {
    const floor = k === 0 ? 0 : (anchors[k - 1]?.index ?? 0) + 1;
    const limit = (prefixes[k]?.length ?? 0) > 0 ? 1 : 2;
    const found: Line[] = [];
    for (let i = anchor.index - 1; i >= floor && found.length < limit; i -= 1) {
      const line = block[i];
      if (!line || BULLET.test(line.text) || RANGE.test(line.text) || isProse(line.text)) break;
      found.unshift(line);
      if (line.blankBefore) break;
    }
    return found;
  });

  anchors.forEach((anchor, k) => {
    const line = block[anchor.index];
    const match = anchor.match;
    if (!line || !match) return;
    const value: ItemValue = {};
    const matchStart = line.start + match.index;
    const startDate = match[1] ?? "";
    const endDate = match[2] ?? "";
    const startAt = text.indexOf(startDate, matchStart);
    const endAt = text.indexOf(endDate, startAt + startDate.length);
    if (startAt >= 0) value.start = startDate;
    if (endAt >= 0) value.end = endDate;

    const headerLines = headers[k] ?? [];
    let headingSpan: { text: string; start: number; end: number } | null = null;
    if (headerLines.length > 0) {
      headingSpan = slice(text, headerLines[0]!.start, headerLines.at(-1)!.end);
    } else {
      // Heading written on the date line itself, e.g. "Project Manager | Fictional Bank | 2016 - 2019".
      headingSpan = slice(text, line.start, matchStart);
      if (headingSpan) headingSpan = slice(text, headingSpan.start, headingSpan.end - (/[|,–—-]\s*$/.exec(headingSpan.text)?.[0].length ?? 0));
    }
    if (headingSpan) {
      value.heading = headingSpan.text;
      assignRoleAndEmployer(value, headerLines.map((header) => header.text), prefixes[k] ?? []);
    }

    const contentEnd = k + 1 < anchors.length ? anchors[k + 1]!.index - (headers[k + 1]?.length ?? 0) : block.length;
    const achievements: string[] = [];
    let spanEnd = line.end;
    for (let i = anchor.index + 1; i < contentEnd && achievements.length < 30; i += 1) {
      const content = block[i];
      if (!content) continue;
      const item = stripBullet(text, content);
      if (item && item.text.length <= 600) {
        achievements.push(item.text);
        spanEnd = item.end;
      }
    }
    if (achievements.length > 0) value.achievements = achievements;
    if (!value.heading && !value.role && !value.employer) return;
    const spanStart = headerLines[0]?.start ?? line.start;
    out.push({ section: "experience", value, start: spanStart, end: Math.max(spanEnd, line.end) });
  });
}

function proposeEducation(text: string, block: Line[], out: Proposal[]): void {
  const groups: Line[][] = [];
  for (const line of block) {
    const startsNew = groups.length === 0 || line.blankBefore || (INSTITUTION.test(line.text) && (groups.at(-1)?.some((l) => INSTITUTION.test(l.text)) ?? false));
    if (startsNew) groups.push([line]);
    else groups.at(-1)?.push(line);
  }
  for (const group of groups.slice(0, 15)) {
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last) continue;
    const value: ItemValue = { heading: first.text };
    const institution = group.find((line) => INSTITUTION.test(line.text));
    if (institution) {
      // "Qualification, Example University, Country, 2009": keep the institution part alone, and the
      // parts before it as the qualification when they name one.
      const parts = institution.text.split(",");
      const at = parts.findIndex((part) => INSTITUTION.test(part));
      const institutionPart = parts.length > 1 ? parts[at]?.trim() : institution.text;
      if (institutionPart && institutionPart.length <= 200) value.institution = institutionPart;
      const before = parts.length > 1 && at > 0 ? parts.slice(0, at).join(",").trim() : "";
      if (before && QUALIFICATION.test(before) && before.length <= 200) value.qualification = before;
    }
    const qualificationLine = value.qualification ? undefined : group.find((line) => QUALIFICATION.test(line.text));
    if (qualificationLine) {
      // Drop a trailing ", 2012" style date from the qualification; keep the date separately.
      const trailing = /[,–—-]?\s*(?:\d{4}\s*[-–—]\s*)?(?:19|20)\d{2}\s*$/.exec(qualificationLine.text);
      const qualification = trailing ? qualificationLine.text.slice(0, trailing.index).trim() : qualificationLine.text;
      if (qualification && qualification.length <= 200) value.qualification = qualification;
    }
    for (const line of group) {
      const range = RANGE.exec(line.text);
      if (range?.[1] && range[2]) {
        value.start = range[1];
        value.end = range[2];
        break;
      }
      const year = YEAR.exec(line.text);
      if (year && !value.end) value.end = year[0];
    }
    if (group.length > 1) {
      const details = slice(text, group[1]!.start, last.end);
      if (details && details.text.length <= 1000) value.details = details.text;
    }
    out.push({ section: "education", value, start: first.start, end: last.end });
  }
}

function proposeCertifications(text: string, block: Line[], out: Proposal[]): void {
  for (const line of block.slice(0, 30)) {
    const item = stripBullet(text, line);
    if (!item || item.text.length > 260) continue;
    const value: ItemValue = {};
    let name = item.text;
    const date = /(?:\(|,|–|—|-)?\s*((?:\d{1,2}\/)?(?:19|20)\d{2})\)?\s*$/.exec(name);
    if (date?.[1]) {
      value.date = date[1];
      name = name.slice(0, date.index).trim();
    }
    const issuer = /^(.+?)\s*\(([^()]{2,150})\)\s*,?$/.exec(name);
    if (issuer?.[1] && issuer[2]) {
      name = issuer[1].trim();
      value.issuer = issuer[2].trim();
    }
    name = name.replace(/[,–—-]\s*$/, "").trim();
    if (name.length < 2 || name.length > 200) continue;
    value.name = name;
    out.push({ section: "certification", value, start: item.start, end: item.end });
  }
}

function proposeSkills(text: string, block: Line[], out: Proposal[]): void {
  let count = 0;
  for (const line of block) {
    let item = stripBullet(text, line);
    if (!item) continue;
    // "Category: skill, skill, skill": the category is a label, not a skill.
    const label = /^[^:：,;|]{2,40}[:：]\s+/.exec(item.text);
    if (label && /[,;|]/.test(item.text.slice(label[0].length))) item = slice(text, item.start + label[0].length, item.end);
    if (!item) continue;
    let cursor = item.start;
    for (const part of item.text.split(/[,;|•·]/)) {
      const at = text.indexOf(part, cursor);
      cursor = at + part.length;
      const skill = slice(text, at, at + part.length);
      if (!skill || skill.text.length < 2 || skill.text.length > 100) continue;
      out.push({ section: "skill", value: { text: skill.text }, start: skill.start, end: skill.end });
      if ((count += 1) >= 60) return;
    }
  }
}

/** True when every string in the proposal is an exact substring of its recorded span. */
export function isGrounded(text: string, proposal: Proposal): boolean {
  if (!(Number.isInteger(proposal.start) && Number.isInteger(proposal.end))) return false;
  if (proposal.start < 0 || proposal.end > text.length || proposal.start >= proposal.end) return false;
  const span = text.slice(proposal.start, proposal.end);
  const strings = valueStrings(proposal.value);
  return strings.length > 0 && strings.every((entry) => entry.length > 0 && span.includes(entry));
}

/** Structures extracted CV text into proposals. Pure and deterministic. */
export function structureCvText(text: string): Proposal[] {
  const lines = splitLines(text);
  const proposals: Proposal[] = [];
  proposeContact(text, lines, proposals);

  const blocks: { block: Block; lines: Line[] }[] = [];
  for (const line of lines) {
    const heading = headingOf(line);
    if (heading) {
      blocks.push({ block: heading.block, lines: heading.rest ? [heading.rest] : [] });
      continue;
    }
    blocks.at(-1)?.lines.push(line);
  }

  for (const { block, lines: blockLines } of blocks) {
    if (blockLines.length === 0) continue;
    if (block === "summary") {
      const summary = slice(text, blockLines[0]!.start, Math.min(blockLines.at(-1)!.end, blockLines[0]!.start + 4000));
      if (summary) proposals.push({ section: "summary", value: { text: summary.text }, start: summary.start, end: summary.end });
      const years = /(\d{1,2})\+?\s*(?:years|yrs)\b/i.exec(summary?.text ?? "");
      if (summary && years?.[1] && Number(years[1]) <= 60) {
        const at = summary.start + years.index;
        proposals.push({ section: "years_experience", value: { text: years[1] }, start: at, end: at + years[1].length });
      }
    } else if (block === "experience") proposeExperience(text, blockLines, proposals);
    else if (block === "education") proposeEducation(text, blockLines, proposals);
    else if (block === "certifications") proposeCertifications(text, blockLines, proposals);
    else if (block === "skills") proposeSkills(text, blockLines, proposals);
  }

  return proposals.filter((proposal) => isGrounded(text, proposal)).slice(0, MAX_PROPOSALS);
}
