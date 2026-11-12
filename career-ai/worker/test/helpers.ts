import { env } from "cloudflare:workers";
import { handleRequest, type AppOptions } from "../src/app";
import type { AiBinding, AiChatInput, Env, RateLimiter } from "../src/env";
import type { CareerProfile } from "../src/domain/profile";

/** Synthetic values only. Nothing here is a real person, key or document. */
export const TEST_ACCESS_KEY = "test-only-access-key-0123456789abcdef";
export const APP_ORIGIN = "https://career-ai-deploy.nisco-career-ai.pages.dev";

export const SYNTHETIC_PROFILE: CareerProfile = {
  name: "Test Candidate",
  headline: "IT programme manager (synthetic test profile)",
  years: 12,
  location: "Riyadh, Saudi Arabia; open to remote",
  summary: "Synthetic summary used only in automated tests.",
  skills: "PMO governance, ITIL, stakeholder management, budgeting",
  experience: "Led a synthetic PMO for a fictional company. Ran ITIL service transition for a fictional bank.",
  roles: "Programme Manager, PMO Lead",
};

/**
 * Workers AI stand-in. Responses are queued per test; a call with nothing queued throws, so a
 * test can never fall through to the real (remote, billable) Workers AI binding.
 */
export class AiStub implements AiBinding {
  readonly calls: { model: string; inputs: AiChatInput }[] = [];
  private readonly queue: (unknown | Error | (() => Promise<unknown>))[] = [];

  respond(...responses: (unknown | Error | (() => Promise<unknown>))[]): this {
    this.queue.push(...responses);
    return this;
  }

  async run(model: string, inputs: AiChatInput): Promise<unknown> {
    this.calls.push({ model, inputs });
    if (this.queue.length === 0) throw new Error("AiStub: no response queued for this call");
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "function") return (next as () => Promise<unknown>)();
    return next;
  }

  /** The user message of call `index`, where the profile and job are fenced. */
  prompt(index = 0): string {
    return this.calls[index]?.inputs.messages.find((message) => message.role === "user")?.content ?? "";
  }
}

export const allowAll: RateLimiter = { limit: async () => ({ success: true }) };

export interface TestEnv extends Env {
  AI: AiStub;
}

/** Overrides may replace any binding, but AI can only ever be an AiStub. */
export type EnvOverrides = Partial<Omit<Env, "AI">> & { AI?: AiStub };

/** The test environment: real local D1/R2 from the pool, stubbed AI, permissive rate limits. */
export function makeEnv(overrides: EnvOverrides = {}): TestEnv {
  const { AI = new AiStub(), ...rest } = overrides;
  return { ...env, API_RATE_LIMITER: allowAll, AUTH_RATE_LIMITER: allowAll, ...rest, AI };
}

export interface ApiResult<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}

export interface CallOptions {
  body?: unknown;
  rawBody?: BodyInit;
  token?: string | null;
  headers?: Record<string, string>;
  origin?: string | null;
  options?: AppOptions;
}

export async function call<T = Record<string, unknown>>(
  testEnv: Env,
  method: string,
  path: string,
  opts: CallOptions = {},
): Promise<ApiResult<T>> {
  const headers = new Headers(opts.headers);
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.origin !== null) headers.set("origin", opts.origin ?? APP_ORIGIN);
  let body: BodyInit | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set("content-type", "application/json");
  }
  const request = new Request(`https://api.test${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
  const response = await handleRequest(request, testEnv, opts.options);
  const text = new TextDecoder().decode(await response.arrayBuffer());
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON bodies (file downloads) are returned as text
  }
  return { status: response.status, body: parsed as T, headers: response.headers };
}

export async function signIn(testEnv: Env): Promise<string> {
  const result = await call<{ token: string }>(testEnv, "POST", "/api/session", { body: { accessKey: TEST_ACCESS_KEY } });
  if (result.status !== 201) throw new Error(`sign-in failed: ${result.status}`);
  return result.body.token;
}

/** A signed-in test session: environment plus a bound `call`. */
export async function session(overrides: EnvOverrides = {}) {
  const testEnv = makeEnv(overrides);
  const token = await signIn(testEnv);
  return {
    env: testEnv,
    ai: testEnv.AI,
    token,
    call: <T = Record<string, unknown>>(method: string, path: string, opts: CallOptions = {}) =>
      call<T>(testEnv, method, path, { token, ...opts }),
  };
}

/**
 * Saves the Phase 1 profile AND confirms the same facts in the structured profile. Since Phase 2,
 * matching, drafts and discovery use only explicitly confirmed facts, so tests that need a usable
 * profile confirm it, exactly as the user would. Use saveLegacyProfileOnly for the unconfirmed case.
 */
export async function saveProfile(api: Awaited<ReturnType<typeof session>>, profile: CareerProfile = SYNTHETIC_PROFILE): Promise<void> {
  await saveLegacyProfileOnly(api, profile);
  const facts: [string, string][] = [
    ["name", profile.name],
    ["headline", profile.headline],
    ["years_experience", profile.years === null ? "" : String(profile.years)],
    ["location_text", profile.location],
    ["summary", profile.summary],
    ["skills_text", profile.skills],
    ["experience_text", profile.experience],
    ["preferred_titles_text", profile.roles],
  ];
  for (const [section, text] of facts) {
    if (!text) continue;
    const result = await api.call("POST", "/api/profile/items", { body: { section, value: { text }, replaceConfirmed: true } });
    if (result.status !== 201) throw new Error(`confirming ${section} failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
}

/** Saves only the Phase 1 profile, which is never used for matching until its facts are confirmed. */
export async function saveLegacyProfileOnly(api: Awaited<ReturnType<typeof session>>, profile: CareerProfile = SYNTHETIC_PROFILE): Promise<void> {
  const result = await api.call("PUT", "/api/profile", { body: profile });
  if (result.status !== 200) throw new Error(`profile save failed: ${result.status}`);
}

export async function createJob(
  api: Awaited<ReturnType<typeof session>>,
  overrides: Partial<{ title: string; company: string; location: string; url: string; description: string }> = {},
): Promise<string> {
  const result = await api.call<{ id: string }>("POST", "/api/jobs", {
    body: {
      title: "Programme Manager",
      company: "Example Co",
      location: "Riyadh",
      url: `https://jobs.example.com/${crypto.randomUUID()}`,
      description: "Synthetic job description: PMO governance and ITIL required.",
      ...overrides,
    },
  });
  if (result.status !== 201) throw new Error(`job create failed: ${result.status} ${JSON.stringify(result.body)}`);
  return result.body.id;
}

export function aiJson(value: unknown): { response: string } {
  return { response: JSON.stringify(value) };
}

/** Wraps a D1 binding and counts prepared statements, to prove per-run work is bounded. */
export function countingDb(db: D1Database): { db: D1Database; statements: string[] } {
  const statements: string[] = [];
  const proxy = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => {
          statements.push(sql.replace(/\s+/g, " ").trim());
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { db: proxy, statements };
}

// ---- Synthetic files ---------------------------------------------------------------------------

export function syntheticPdf(extraBytes = 0): Uint8Array {
  const body = "%PDF-1.4\n% synthetic test document\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n";
  const bytes = new Uint8Array(body.length + extraBytes);
  bytes.set(new TextEncoder().encode(body));
  return bytes;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds an uncompressed ZIP archive. Enough structure for signature detection tests. */
export function buildZip(entries: { name: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

export function syntheticDocx(extraEntries: { name: string; content: string }[] = []): Uint8Array {
  return buildZip([
    { name: "[Content_Types].xml", content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: "word/document.xml", content: "<w:document><w:body><w:p><w:r><w:t>Synthetic CV</w:t></w:r></w:p></w:body></w:document>" },
    ...extraEntries,
  ]);
}

export function streamOf(bytes: Uint8Array, chunkSize = 64 * 1024): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// ---- Phase 2: synthetic CVs ----------------------------------------------------------------------

/** A synthetic CV. Every person, employer and number in it is fictional. */
export const SYNTHETIC_CV_TEXT = `Alex Synthetic
Programme Manager (synthetic test CV)
alex.synthetic@example.test | +966 50 000 0000 | https://example.test/alex

SUMMARY
Synthetic summary for automated tests only. 12+ years of experience in PMO governance.

PROFESSIONAL EXPERIENCE
Senior Programme Manager at Example Holdings
Jan 2020 – Present
• Led a synthetic PMO of 5 people.
• Ran ITIL service transition for a fictional bank.
Project Manager | Fictional Bank | 2016 - 2019
• Delivered a synthetic core-banking upgrade.

EDUCATION
Example University
BSc Computer Science, 2012

CERTIFICATIONS
• PMP (Synthetic Institute), 2018
• ITIL 4 Foundation

SKILLS
PMO governance, ITIL; Stakeholder management | Budgeting`;

export async function uploadCv(
  api: Awaited<ReturnType<typeof session>>,
  bytes: Uint8Array = syntheticPdf(),
  name = "Synthetic CV.pdf",
  type = "application/pdf",
) {
  return api.call<{ version: { id: string; file: { documentId: string; name: string; sha256: string } | null } }>("POST", "/api/cv/versions", {
    rawBody: bytes,
    headers: { "content-type": type, "x-file-name": /%/.test(name) ? name : encodeURIComponent(name) },
  });
}

export async function submitExtraction(
  api: Awaited<ReturnType<typeof session>>,
  versionId: string,
  body: Record<string, unknown> = { status: "extracted", parser: "pdfjs-dist", parserVersion: "6.4.299", text: SYNTHETIC_CV_TEXT, pageCount: 1, warnings: [] },
) {
  return api.call<{ proposalsCreated: number; version: { extraction: { status: string; warnings: string[] }; review: { status: string; proposed: number } } }>(
    "POST",
    `/api/cv/versions/${versionId}/extraction`,
    { body },
  );
}

export interface ItemDto {
  id: string;
  section: string;
  value: Record<string, string | string[]>;
  status: string;
  source: { type: string; cvVersionId: string | null; cvDeleted: boolean; snapshotId: string | null; field: string | null; span: { start: number; end: number } | null };
  userEdited: boolean;
}

export async function listProfileItems(api: Awaited<ReturnType<typeof session>>) {
  return (await api.call<{ items: ItemDto[]; missing: string[]; sections: { section: string; state: string }[] }>("GET", "/api/profile/items")).body;
}
