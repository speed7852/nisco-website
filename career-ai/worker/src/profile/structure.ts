import { valueStrings, type ItemValue, type ProfileSection } from "./schema";

/**
 * Fixed-rule structuring of extracted CV text into PROPOSED profile items.
 *
 * Rules, not AI. Every string in every proposal is an exact substring of the CV text, and each
 * proposal records the character span it came from. `groundedOnly` re-checks that invariant before
 * anything is returned, so a rule bug can only drop a proposal, never invent one. Dates are kept as
 * written. Employer and role are filled only for the unambiguous "Role at Employer" pattern;
 * otherwise the heading is kept verbatim for the user to assign. Preferences (preferred titles,
 * approved locations, remote preference) are never extracted: they are the user's choices.
 */

export interface Proposal {
  section: ProfileSection;
  value: ItemValue;
  start: number;
  end: number;
}

export const STRUCTURER_VERSION = "rules-1.0.0";
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
  return nameIndex;
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

  // Header lines: up to two contiguous non-bullet lines directly above each date line.
  const headers = anchors.map((anchor, k) => {
    const floor = k === 0 ? 0 : (anchors[k - 1]?.index ?? 0) + 1;
    const found: Line[] = [];
    for (let i = anchor.index - 1; i >= floor && found.length < 2; i -= 1) {
      const line = block[i];
      if (!line || BULLET.test(line.text) || RANGE.test(line.text)) break;
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
      const roleAt = /^(.{2,150}?)\s+at\s+(.{2,150})$/i.exec(headerLines[0]?.text ?? "");
      if (roleAt?.[1] && roleAt[2]) {
        value.role = roleAt[1];
        value.employer = roleAt[2];
      }
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
    if (institution && institution.text.length <= 200) value.institution = institution.text;
    const qualificationLine = group.find((line) => QUALIFICATION.test(line.text));
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
    const item = stripBullet(text, line);
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
