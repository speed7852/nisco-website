/**
 * CORS for the browser app. Only origins listed exactly in ALLOWED_ORIGINS receive CORS headers;
 * there are no wildcard or pattern matches, so other Pages preview deployments are not trusted.
 */

/** HTTPS origins, plus plain-HTTP loopback origins for local development (only if listed). */
const ORIGIN_PATTERN = /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1))(:\d{1,5})?$/i;

export function parseAllowedOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const entry of (value ?? "").split(",")) {
    const origin = entry.trim().replace(/\/+$/, "");
    if (ORIGIN_PATTERN.test(origin)) origins.add(origin.toLowerCase());
  }
  return origins;
}

export function isAllowedOrigin(origin: string | null, allowed: Set<string>): origin is string {
  return origin !== null && allowed.has(origin.toLowerCase());
}

export function corsHeaders(origin: string | null, allowed: Set<string>, allowCredentials: boolean): Record<string, string> {
  if (!isAllowedOrigin(origin, allowed)) return { vary: "Origin" };
  const headers: Record<string, string> = {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-file-name",
    "access-control-expose-headers": "content-disposition, retry-after",
    "access-control-max-age": "600",
    vary: "Origin",
  };
  if (allowCredentials) headers["access-control-allow-credentials"] = "true";
  return headers;
}
