import { badRequest } from "./errors";

/**
 * Small, dependency-free validators. Each collects field-level messages so the client can show
 * all problems at once; call `throwIfAny()` at the end.
 */
export class FieldErrors {
  readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }

  get any(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  throwIfAny(message = "Some fields are invalid."): void {
    if (this.any) throw badRequest(message, this.errors);
  }
}

export type JsonObject = Record<string, unknown>;

/** Accepts only a plain JSON object. Arrays, strings, numbers, booleans and null are rejected. */
export function requireObject(value: unknown, what = "Request body"): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`${what} must be a JSON object.`);
  }
  return value as JsonObject;
}

export function rejectUnknownKeys(body: JsonObject, allowed: readonly string[], errors: FieldErrors): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) errors.add(key, "Unknown field.");
  }
}

interface StringRule {
  max: number;
  required?: boolean;
}

/** Reads an optional or required string field, trimmed. Returns undefined when absent. */
export function readString(body: JsonObject, key: string, rule: StringRule, errors: FieldErrors): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    if (rule.required) errors.add(key, "Required.");
    return undefined;
  }
  if (typeof value !== "string") {
    errors.add(key, "Must be text.");
    return undefined;
  }
  const trimmed = value.trim();
  if (rule.required && trimmed === "") {
    errors.add(key, "Required.");
    return undefined;
  }
  if (trimmed.length > rule.max) {
    errors.add(key, `Must be ${rule.max} characters or fewer.`);
    return undefined;
  }
  return trimmed;
}

export function readEnum<T extends string>(
  body: JsonObject,
  key: string,
  allowed: readonly T[],
  errors: FieldErrors,
  required = false,
): T | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    if (required) errors.add(key, "Required.");
    return undefined;
  }
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    errors.add(key, `Must be one of: ${allowed.join(", ")}.`);
    return undefined;
  }
  return value as T;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Validates an ID taken from the URL path. */
export function requireIdParam(value: string | undefined, name = "id"): string {
  if (!isUuid(value)) throw badRequest(`The ${name} in the URL is not a valid ID.`, { [name]: "Invalid ID." });
  return value.toLowerCase();
}
