import { HttpError } from "./errors";

/** Headers on every API response. The API only returns JSON or file downloads, never HTML. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers },
  });
}

export function errorResponse(error: HttpError): Response {
  const body: Record<string, unknown> = { error: error.code, message: error.message, ...error.details };
  if (error.fields && Object.keys(error.fields).length > 0) body.fields = error.fields;
  return json(body, error.status, error.headers ?? {});
}

/** Returns a copy of `response` with extra headers (used to add CORS headers last). */
export function withHeaders(response: Response, headers: Record<string, string>): Response {
  if (Object.keys(headers).length === 0) return response;
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
  return copy;
}
