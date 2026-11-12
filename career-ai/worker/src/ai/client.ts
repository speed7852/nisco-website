import { AI_MODEL, AI_TIMEOUT_MS } from "../config";
import type { AiBinding, ChatMessage } from "../env";

export class AiCallError extends Error {
  constructor(readonly reason: "timeout" | "inference_failed", detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "AiCallError";
  }
}

/** Calls Workers AI with a timeout. Errors and timeouts become AiCallError. */
export async function runChat(
  ai: AiBinding,
  messages: ChatMessage[],
  options: { maxTokens: number; temperature: number; timeoutMs?: number },
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiCallError("timeout")), options.timeoutMs ?? AI_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      ai.run(AI_MODEL, { messages, max_tokens: options.maxTokens, temperature: options.temperature }),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof AiCallError) throw error;
    throw new AiCallError("inference_failed", error instanceof Error ? error.message.slice(0, 200) : undefined);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Extracts the model output from the shapes Workers AI returns:
 * `{ response: string }`, `{ response: object }` (JSON mode), `{ result: { response } }`,
 * OpenAI-style `{ choices: [{ message: { content } }] }`, or a bare string.
 */
export function extractModelOutput(result: unknown): unknown {
  if (typeof result === "string") return result;
  if (typeof result !== "object" || result === null) return undefined;
  const record = result as Record<string, unknown>;
  if ("response" in record) return record.response;
  const nested = record.result;
  if (typeof nested === "object" && nested !== null && "response" in nested) {
    return (nested as Record<string, unknown>).response;
  }
  const choices = record.choices;
  if (Array.isArray(choices)) {
    const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message;
    return message?.content;
  }
  return undefined;
}
