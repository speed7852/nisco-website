import { MAX_JSON_BODY_BYTES } from "../config";
import { badRequest, payloadTooLarge } from "./errors";

/**
 * Reads a request body while counting bytes, and stops as soon as `maxBytes` is exceeded.
 * Content-Length is never trusted: a client can omit it (chunked upload) or send a wrong value.
 */
export async function readBodyBytes(request: Request, maxBytes: number, limitMessage: string): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge(limitMessage);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Parses a JSON request body. Malformed or missing JSON is a 400, never a 500. */
export async function readJson(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const bytes = await readBodyBytes(request, maxBytes, `Request body must be smaller than ${Math.round(maxBytes / 1024)} KB.`);
  const text = new TextDecoder().decode(bytes).trim();
  if (text === "") throw badRequest("A JSON request body is required.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest("Request body is not valid JSON.");
  }
}
