// Unit tests for frontend/js/extract.js (DOCX path and outcome classification) and for the
// synthetic PDF generator the browser journey uploads. The vendored pdf.js is a browser build; the
// PDF path through it is exercised in Chromium by tests/master-cv.spec.js. Here the generated PDF
// is checked with the same pdfjs-dist version's Node ("legacy") build and the same line joiner.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LIMITS, extractCvText } from "../../frontend/js/extract.js";
import { joinTextItems } from "../../frontend/js/pdf-text.js";
import { SYNTHETIC_CV_LINES, buildDocx, buildPdf } from "../fixtures/synthetic-docs.js";

const file = (bytes, name) => new File([bytes], name);

describe("extractCvText (DOCX)", () => {
  test("extracts the synthetic CV with parser name and version", async () => {
    const result = await extractCvText(file(buildDocx(), "Synthetic CV.docx"));
    assert.equal(result.status, "extracted");
    assert.equal(result.text, `${SYNTHETIC_CV_LINES.join("\n")}\n`);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.parser, "nisco-docx");
    assert.equal(result.pageCount, null);
  });

  test("marks very short text as partial", async () => {
    const result = await extractCvText(file(buildDocx(["Only a name"]), "short.docx"));
    assert.equal(result.status, "partial");
    assert.deepEqual(result.warnings, ["short_text"]);
  });

  test("marks a document without text as failed", async () => {
    const result = await extractCvText(file(buildDocx([]), "empty.docx"));
    assert.deepEqual({ status: result.status, text: result.text, warnings: result.warnings }, { status: "failed", text: "", warnings: ["no_text"] });
  });

  test("reports parser errors as a failed extraction instead of throwing", async () => {
    const result = await extractCvText(file(Buffer.from("not a zip"), "broken.docx"));
    assert.deepEqual({ status: result.status, warnings: result.warnings }, { status: "failed", warnings: ["parse_error"] });
  });

  test("truncates at the character limit and says so", async () => {
    const long = Array.from({ length: Math.ceil(LIMITS.maxChars / 50) + 10 }, (_, i) => `Synthetic line ${i} `.padEnd(49, "x"));
    const result = await extractCvText(file(buildDocx(long), "long.docx"));
    assert.equal(result.status, "partial");
    assert.ok(result.warnings.includes("truncated"));
    assert.equal(result.text.length, LIMITS.maxChars);
  });
});

describe("synthetic PDF generator", () => {
  async function pdfText(bytes) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, verbosity: 0 });
    const pdf = await task.promise;
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) pages.push(joinTextItems((await (await pdf.getPage(number)).getTextContent()).items));
    await task.destroy();
    return { numPages: pdf.numPages, text: pages.filter(Boolean).join("\n\n") };
  }

  test("produces a text layer that reads back as the synthetic CV lines", async () => {
    const { numPages, text } = await pdfText(buildPdf());
    assert.equal(numPages, 1);
    assert.equal(text, SYNTHETIC_CV_LINES.filter(Boolean).join("\n"));
  });

  test("escapes PDF string syntax and supports several pages", async () => {
    const { numPages, text } = await pdfText(buildPdf([["Page one (draft)"], ["Back\\slash – dash"]]));
    assert.equal(numPages, 2);
    assert.equal(text, "Page one (draft)\n\nBack\\slash – dash");
  });

  test("can produce a page with no text layer, like a scanned CV", async () => {
    assert.deepEqual(await pdfText(buildPdf([[]])), { numPages: 1, text: "" });
  });
});
