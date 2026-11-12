import { DISCOVERY_LIMITS, type DiscoveryLimits } from "../config";
import { assessJob } from "../ai/matching";
import type { Env } from "../env";
import { htmlToText, truncate } from "../domain/text";
import { normaliseJobUrl } from "../domain/urls";
import { finishRun, startRun, type RunStatus } from "../db/discovery-runs";
import { existingCanonicalUrls, insertJobsIgnoringDuplicates, listJobsNeedingAssessment, type NewJob } from "../db/jobs";
import { getProfile } from "../db/profile";
import { FEED_SOURCES, type FeedSource } from "./feeds";
import { locationEligibility, matchesRole, roleTerms } from "./filters";

export interface DiscoveryDeps {
  fetch: typeof fetch;
  now: () => Date;
  sources: readonly FeedSource[];
  limits: DiscoveryLimits;
}

export function defaultDiscoveryDeps(): DiscoveryDeps {
  return { fetch: (input, init) => fetch(input, init), now: () => new Date(), sources: FEED_SOURCES, limits: { ...DISCOVERY_LIMITS } };
}

interface SourceSummary {
  source: string;
  ok: boolean;
  attempts: number;
  error?: string;
  items: number;
  eligible: number;
  skipped: { notHttps: number; roleMismatch: number; locationMismatch: number; duplicateInFeed: number };
}

export interface DiscoverySummary {
  runId: string;
  status: Exclude<RunStatus, "running">;
  sources: SourceSummary[];
  candidates: number;
  alreadyKnown: number;
  inserted: number;
  cappedNewJobs: number;
  assessment: { skippedReason?: "no_profile"; attempted: number; scored: number; needsReview: number };
}

/** Fetches a feed with a timeout and a bounded number of retries for network errors and HTTP 5xx. */
async function fetchFeed(source: FeedSource, deps: DiscoveryDeps): Promise<{ payload: unknown; attempts: number }> {
  let lastError = "unknown";
  let attempts = 0;
  for (let attempt = 1; attempt <= deps.limits.fetchRetries + 1; attempt += 1) {
    attempts = attempt;
    try {
      const response = await deps.fetch(source.url, {
        headers: { accept: "application/json", "user-agent": "NISCO-Career-AI/1.0 (personal job discovery)" },
        signal: AbortSignal.timeout(deps.limits.fetchTimeoutMs),
      });
      if (response.ok) return { payload: await response.json(), attempts: attempt };
      lastError = `http_${response.status}`;
      if (response.status < 500) break; // 4xx will not fix itself on retry
    } catch (error) {
      lastError = error instanceof Error ? error.name : "fetch_failed";
    }
  }
  throw Object.assign(new Error(lastError), { attempts });
}

/**
 * One scheduled discovery run. Work is bounded: feed items examined, new jobs inserted and AI calls
 * all have per-run caps, the profile is read once, and D1 lookups are batched. Jobs that could not
 * be scored stay queued (match_status pending/needs_review) and are retried by later runs until
 * MAX_MATCH_ATTEMPTS. The run and its counts are recorded in discovery_runs; no candidate data is
 * logged.
 */
export async function runDiscovery(env: Env, cron: string, deps: DiscoveryDeps = defaultDiscoveryDeps()): Promise<DiscoverySummary> {
  const runId = crypto.randomUUID();
  await startRun(env.DB, { id: runId, cron, startedAt: deps.now().toISOString() });

  const summary: DiscoverySummary = {
    runId,
    status: "ok",
    sources: [],
    candidates: 0,
    alreadyKnown: 0,
    inserted: 0,
    cappedNewJobs: 0,
    assessment: { attempted: 0, scored: 0, needsReview: 0 },
  };

  try {
    const stored = await getProfile(env.DB);
    const terms = roleTerms(stored?.profile ?? null);
    const candidates = new Map<string, NewJob>();

    for (const source of deps.sources) {
      const sourceSummary: SourceSummary = {
        source: source.name,
        ok: false,
        attempts: 0,
        items: 0,
        eligible: 0,
        skipped: { notHttps: 0, roleMismatch: 0, locationMismatch: 0, duplicateInFeed: 0 },
      };
      summary.sources.push(sourceSummary);
      try {
        const { payload, attempts } = await fetchFeed(source, deps);
        sourceSummary.attempts = attempts;
        const items = source.parse(payload).slice(0, deps.limits.maxItemsPerFeed);
        sourceSummary.items = items.length;
        for (const item of items) {
          const url = normaliseJobUrl(item.url);
          if (!url.ok) {
            sourceSummary.skipped.notHttps += 1;
            continue;
          }
          if (!item.title || !matchesRole(item.title, terms)) {
            sourceSummary.skipped.roleMismatch += 1;
            continue;
          }
          if (!locationEligibility(item.location, item.remote).eligible) {
            sourceSummary.skipped.locationMismatch += 1;
            continue;
          }
          if (candidates.has(url.canonical)) {
            sourceSummary.skipped.duplicateInFeed += 1;
            continue;
          }
          sourceSummary.eligible += 1;
          candidates.set(url.canonical, {
            id: crypto.randomUUID(),
            title: truncate(item.title, 200),
            company: truncate(item.company, 200),
            location: truncate(item.location || (item.remote ? "Remote" : ""), 300),
            url: url.url,
            canonicalUrl: url.canonical,
            description: truncate(htmlToText(item.description) || item.title, deps.limits.descriptionStoreChars),
            source: source.name,
            createdAt: deps.now().toISOString(),
          });
        }
        sourceSummary.ok = true;
      } catch (error) {
        sourceSummary.attempts = (error as { attempts?: number }).attempts ?? 1;
        sourceSummary.error = error instanceof Error ? error.message : "failed";
      }
    }

    summary.candidates = candidates.size;
    const known = await existingCanonicalUrls(env.DB, [...candidates.keys()]);
    summary.alreadyKnown = known.size;
    const fresh = [...candidates.values()].filter((job) => job.canonicalUrl !== null && !known.has(job.canonicalUrl));
    const toInsert = fresh.slice(0, deps.limits.maxNewJobsPerRun);
    summary.cappedNewJobs = fresh.length - toInsert.length;
    summary.inserted = await insertJobsIgnoringDuplicates(env.DB, toInsert);

    if (!stored) {
      summary.assessment.skippedReason = "no_profile";
    } else {
      // New jobs and earlier failures share one AI budget per run.
      const queue = await listJobsNeedingAssessment(env.DB, deps.limits.maxAiCallsPerRun);
      for (const job of queue) {
        summary.assessment.attempted += 1;
        const outcome = await assessJob(env, job, stored.profile, deps.now());
        if (outcome.status === "scored") summary.assessment.scored += 1;
        else summary.assessment.needsReview += 1;
      }
    }

    const okSources = summary.sources.filter((s) => s.ok).length;
    summary.status = okSources === summary.sources.length ? "ok" : okSources > 0 ? "partial" : "failed";
  } catch (error) {
    summary.status = "failed";
    console.error(JSON.stringify({ event: "discovery_error", runId, message: error instanceof Error ? error.message : "unknown" }));
  }

  await finishRun(env.DB, { id: runId, finishedAt: deps.now().toISOString(), status: summary.status, summary });
  console.log(JSON.stringify({ event: "discovery_run", cron, ...summary }));
  return summary;
}
