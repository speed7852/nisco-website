import type { RateLimiter } from "../env";
import { tooManyRequests } from "../http/errors";

/** Identifies the caller for rate limiting. Cloudflare sets cf-connecting-ip on every request. */
export function clientKey(request: Request, scope: string): string {
  return `${scope}:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;
}

/**
 * Applies a Workers Rate Limiting binding. If the binding is missing (misconfiguration), the
 * request is allowed and a warning is logged: rate limiting is a second layer behind
 * authentication, and failing closed would lock the owner out of their own data.
 */
export async function enforceRateLimit(limiter: RateLimiter | undefined, key: string): Promise<void> {
  if (!limiter) {
    console.warn(JSON.stringify({ event: "rate_limiter_missing", scope: key.split(":")[0] }));
    return;
  }
  const { success } = await limiter.limit({ key });
  if (!success) throw tooManyRequests();
}
