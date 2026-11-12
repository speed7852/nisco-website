// Extracts text from a CV file in the browser. The result is sent to the Worker for validation and
// structuring; nothing here decides what becomes part of the profile.
//
// PDF: the vendored, integrity-checked pdf.js (vendor/pdfjs), with script evaluation disabled; its
// parsing runs in pdf.js's own Web Worker. Scanned PDFs without a text layer are reported, not
// guessed at (OCR is not supported). DOCX: ./docx.js. Every outcome is reported honestly as
// extracted, partial or failed with warning codes the Worker understands.
import { DOCX_PARSER, DocxError, extractDocxText } from "./docx.js";
import { joinTextItems } from "./pdf-text.js";

export const LIMITS = { maxPages: 50, timeoutMs: 45_000, maxChars: 200_000, shortText: 200 };

function withTimeout(promise, ms, onTimeout) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(Object.assign(new Error("timeout"), { code: "timeout" }));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function extractPdf(bytes) {
  const pdfjs = await import("../vendor/pdfjs/pdf.min.js");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.js", import.meta.url).href;
  const task = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    stopAtErrors: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  const warnings = [];
  try {
    const pdf = await withTimeout(task.promise, LIMITS.timeoutMs, () => task.destroy());
    const pages = Math.min(pdf.numPages, LIMITS.maxPages);
    if (pdf.numPages > LIMITS.maxPages) warnings.push("page_limit_reached");
    const texts = [];
    for (let number = 1; number <= pages; number += 1) {
      const page = await withTimeout(pdf.getPage(number), LIMITS.timeoutMs);
      const content = await withTimeout(page.getTextContent(), LIMITS.timeoutMs);
      texts.push(joinTextItems(content.items));
      page.cleanup();
    }
    return { text: texts.filter(Boolean).join("\n\n"), pageCount: pdf.numPages, parser: { name: "pdfjs-dist", version: pdfjs.version }, warnings };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/**
 * @param {File} file
 * @returns {Promise<{ status: "extracted"|"partial"|"failed", text: string, pageCount: number|null,
 *   parser: string, parserVersion: string, warnings: string[] }>}
 */
export async function extractCvText(file) {
  const isPdf = /\.pdf$/i.test(file.name);
  const parser = isPdf ? { name: "pdfjs-dist", version: "0.0.0" } : DOCX_PARSER;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let result;
  try {
    if (isPdf) result = await extractPdf(bytes);
    else result = { ...(await withTimeout(extractDocxText(bytes), LIMITS.timeoutMs)), pageCount: null, parser: DOCX_PARSER };
  } catch (error) {
    let code = "parse_error";
    if (error?.name === "PasswordException") code = "password_protected";
    else if (error instanceof DocxError) code = error.code;
    else if (error?.code === "timeout") code = "timeout";
    const version = isPdf ? (await import("../vendor/pdfjs/pdf.min.js").then((m) => m.version).catch(() => "0.0.0")) : parser.version;
    return { status: "failed", text: "", pageCount: null, parser: parser.name, parserVersion: version, warnings: [code] };
  }

  let text = result.text.replace(/\r\n?/g, "\n");
  const warnings = [...result.warnings];
  if (text.length > LIMITS.maxChars) {
    text = text.slice(0, LIMITS.maxChars);
    warnings.push("truncated");
  }
  let status = "extracted";
  if (text.trim() === "") {
    status = "failed";
    warnings.push(isPdf ? "no_text_layer" : "no_text");
  } else if (warnings.includes("page_limit_reached") || warnings.includes("truncated")) {
    status = "partial";
  } else if (text.trim().length < LIMITS.shortText) {
    status = "partial";
    warnings.push("short_text");
  }
  return { status, text, pageCount: result.pageCount, parser: result.parser.name, parserVersion: result.parser.version, warnings };
}
