/**
 * Parses and validates a match assessment returned by the model.
 *
 * Accepted: a JSON object, a JSON string, JSON inside ``` fences, or JSON preceded/followed by
 * prose. The score must be a number (or numeric text such as "85" or "85%") and is clamped to
 * 0-100. Anything else is rejected with a reason; a rejected response must never overwrite a
 * stored score.
 */

export interface MatchAssessment {
  score: number;
  matched: string[];
  gaps: string[];
  rationale: string;
}

export type ParseResult =
  | { ok: true; assessment: MatchAssessment; clamped: boolean }
  | { ok: false; reason: string };

const MAX_LIST_ITEMS = 20;
const MAX_ITEM_CHARS = 200;
const MAX_RATIONALE_CHARS = 2_000;

export function parseMatchAssessment(output: unknown): ParseResult {
  const candidate = typeof output === "string" ? extractJsonObject(output) : output;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return { ok: false, reason: "no_json_object" };
  }
  const record = candidate as Record<string, unknown>;
  const rawScore = parseScore(record.score);
  if (rawScore === null) return { ok: false, reason: "invalid_score" };
  const score = Math.round(Math.min(100, Math.max(0, rawScore)));
  return {
    ok: true,
    clamped: score !== Math.round(rawScore),
    assessment: {
      score,
      matched: stringList(record.matched),
      gaps: stringList(record.gaps),
      rationale: typeof record.rationale === "string" ? record.rationale.trim().slice(0, MAX_RATIONALE_CHARS) : "",
    },
  };
}

function parseScore(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const match = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*%?\s*$/.exec(value);
    if (match?.[1] !== undefined) return Number(match[1]);
  }
  return null;
}

function stringList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" && value.trim() !== "" ? [value] : [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, MAX_ITEM_CHARS))
    .filter((item) => item !== "")
    .slice(0, MAX_LIST_ITEMS);
}

/** Finds the first complete JSON object in text: whole string, fenced block, or embedded object. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1] !== undefined) {
    const inner = tryParse(fenced[1].trim());
    if (inner !== undefined) return inner;
  }

  // Scan for balanced braces, respecting JSON strings, and try each top-level object in turn.
  for (let start = trimmed.indexOf("{"); start !== -1; start = trimmed.indexOf("{", start + 1)) {
    const end = matchingBrace(trimmed, start);
    if (end === -1) continue;
    const parsed = tryParse(trimmed.slice(start, end + 1));
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
