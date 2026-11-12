/**
 * Public job feeds. Each source turns its own payload into FeedJob records; nothing else in the
 * app knows a feed's field names. Add a source by adding an entry to FEED_SOURCES.
 *
 * Both current sources are free public APIs. Remote OK asks API users to link back to the
 * original listing and credit Remote OK, which the stored URL and `source` field do.
 */

export interface FeedJob {
  source: string;
  title: string;
  company: string;
  location: string;
  url: string;
  /** Raw description; may be HTML. Cleaned before storage. */
  description: string;
  remote: boolean;
}

export interface FeedSource {
  name: string;
  url: string;
  parse(payload: unknown): FeedJob[];
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const tags = (value: unknown): string => (Array.isArray(value) ? value.filter((t) => typeof t === "string").join(", ") : "");

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
}

export const arbeitnow: FeedSource = {
  name: "Arbeitnow",
  url: "https://www.arbeitnow.com/api/job-board-api?page=1",
  parse(payload) {
    const data = typeof payload === "object" && payload !== null ? (payload as { data?: unknown }).data : undefined;
    return records(data).map((item) => ({
      source: "Arbeitnow",
      title: text(item.title),
      company: text(item.company_name) || "Unknown company",
      location: text(item.location),
      url: text(item.url),
      description: text(item.description) || tags(item.tags),
      remote: item.remote === true,
    }));
  },
};

export const remoteOk: FeedSource = {
  name: "Remote OK",
  url: "https://remoteok.com/api",
  parse(payload) {
    return records(payload)
      .filter((item) => text(item.position) !== "") // the first element is a legal notice, not a job
      .map((item) => ({
        source: "Remote OK",
        title: text(item.position),
        company: text(item.company) || "Unknown company",
        location: text(item.location),
        url: text(item.url) || text(item.apply_url),
        description: text(item.description) || tags(item.tags),
        remote: true,
      }));
  },
};

export const FEED_SOURCES: readonly FeedSource[] = [arbeitnow, remoteOk];
