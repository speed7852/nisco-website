/**
 * An error that maps directly to an HTTP response. Throw it from any handler; the router turns it
 * into `{ error, message, fields?, ...details }` with the given status. Messages must be safe to
 * show to the user: never include stack traces, SQL or secrets.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, fields?: Record<string, string>): HttpError =>
  new HttpError(400, "invalid_request", message, fields);

export const notFound = (what: string): HttpError => new HttpError(404, "not_found", `${what} not found.`);

export const conflict = (code: string, message: string, details?: Record<string, unknown>): HttpError =>
  new HttpError(409, code, message, undefined, details);

export const payloadTooLarge = (message: string): HttpError => new HttpError(413, "payload_too_large", message);

export const unsupportedMediaType = (message: string): HttpError =>
  new HttpError(415, "unsupported_file_type", message);

export const unauthorized = (message = "Sign in to continue."): HttpError =>
  new HttpError(401, "unauthorized", message);

export const forbidden = (code: string, message: string): HttpError => new HttpError(403, code, message);

export const serviceUnavailable = (code: string, message: string): HttpError => new HttpError(503, code, message);

export const tooManyRequests = (): HttpError =>
  new HttpError(429, "rate_limited", "Too many requests. Wait a minute and try again.", undefined, undefined, {
    "retry-after": "60",
  });
