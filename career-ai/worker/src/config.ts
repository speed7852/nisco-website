/** Application constants. Change limits here, not inline. */

export const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
/** Bump when the matching prompt or parser changes, so stored assessments show which version made them. */
export const MATCH_PROMPT_VERSION = "match-v2";
export const DRAFT_PROMPT_VERSION = "draft-v2";
export const AI_TIMEOUT_MS = 25_000;

/** A job is shortlisted when its last validated score is at least this value. 79 is not; 80 is. */
export const SHORTLIST_THRESHOLD = 80;
/** Automatic (scheduled) assessment attempts per job before it waits for a manual re-assessment. */
export const MAX_MATCH_ATTEMPTS = 3;

export const MAX_JSON_BODY_BYTES = 64 * 1024;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;

export const DISCOVERY_LIMITS = {
  /** Feed items examined per source per run. */
  maxItemsPerFeed: 300,
  /** New jobs inserted per run across all sources. */
  maxNewJobsPerRun: 25,
  /** Workers AI calls per run (new jobs and retries share this budget). */
  maxAiCallsPerRun: 8,
  fetchTimeoutMs: 15_000,
  /** Extra attempts after a failed feed request (network error or HTTP 5xx). */
  fetchRetries: 1,
  /** Characters of cleaned description stored per job. */
  descriptionStoreChars: 8_000,
  /** Characters of description sent to the model. */
  descriptionPromptChars: 3_000,
} as const;

export type DiscoveryLimits = { [K in keyof typeof DISCOVERY_LIMITS]: number };
