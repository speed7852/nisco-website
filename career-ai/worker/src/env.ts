/**
 * Bindings and variables available to the Worker. Values come from wrangler.toml ([vars] and
 * bindings) and from Worker secrets set in Cloudflare (APP_ACCESS_KEY). Never hard-code secrets.
 */
export interface Env {
  APP_NAME: string;
  /** "key" (default) or "access". See docs/ACCESS.md. */
  AUTH_MODE?: string;
  /** Secret. Private access key exchanged for a short-lived session token in "key" mode. */
  APP_ACCESS_KEY?: string;
  /** Comma-separated exact origins allowed to call the API from a browser. */
  ALLOWED_ORIGINS?: string;
  SESSION_TTL_SECONDS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_ALLOWED_EMAILS?: string;

  DB: D1Database;
  PRIVATE_FILES: R2Bucket;
  AI: AiBinding;
  API_RATE_LIMITER?: RateLimiter;
  AUTH_RATE_LIMITER?: RateLimiter;
}

/** The subset of the Workers AI binding this app uses. Tests replace it with a stub. */
export interface AiBinding {
  run(model: string, inputs: AiChatInput): Promise<unknown>;
}

export interface AiChatInput {
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Workers Rate Limiting binding ([[ratelimits]] in wrangler.toml). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
