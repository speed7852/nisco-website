/**
 * Job URL safety and canonicalisation.
 *
 * Only https URLs are accepted, which rules out javascript:, data:, file: and plain http links.
 * The canonical form is used for de-duplication: it drops the fragment and common tracking
 * parameters, sorts the remaining query parameters and removes a trailing slash. The URL shown
 * to the user is kept as entered (minus surrounding spaces).
 */

/** Query parameters that only track the click and never identify the job. */
export const TRACKING_PARAMETERS: ReadonlySet<string> = new Set([
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "fbclid",
  "msclkid",
  "twclid",
  "li_fat_id",
  "mc_cid",
  "mc_eid",
  "igshid",
  "_hsenc",
  "_hsmi",
  "ref",
  "ref_src",
  "referrer",
  "trk",
  "trkinfo",
  "trackingid",
  "refid",
]);
const TRACKING_PREFIXES = ["utm_"];
const MAX_URL_LENGTH = 2_048;

export type JobUrlResult = { ok: true; url: string; canonical: string } | { ok: false; reason: string };

function isTrackingParameter(name: string): boolean {
  const lower = name.toLowerCase();
  return TRACKING_PARAMETERS.has(lower) || TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function normaliseJobUrl(raw: string): JobUrlResult {
  const url = raw.trim();
  if (url === "") return { ok: false, reason: "URL is empty." };
  if (url.length > MAX_URL_LENGTH) return { ok: false, reason: `URL must be ${MAX_URL_LENGTH} characters or fewer.` };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: "Only https:// job links are accepted." };
  if (parsed.username || parsed.password) return { ok: false, reason: "Links containing credentials are not accepted." };
  if (!parsed.hostname.includes(".")) return { ok: false, reason: "Link must point to a public website." };

  parsed.hash = "";
  const kept = [...parsed.searchParams.entries()]
    .filter(([name]) => !isTrackingParameter(name))
    .sort(([a, valueA], [b, valueB]) => (a === b ? valueA.localeCompare(valueB) : a.localeCompare(b)));
  parsed.search = "";
  for (const [name, value] of kept) parsed.searchParams.append(name, value);
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";

  return { ok: true, url, canonical: parsed.toString() };
}

/** True only for links that are safe to render as clickable anchors. */
export function isSafeLink(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
