// Unit tests for the browser DOCX parser (frontend/js/docx.js), run with node --test.
// All documents are generated here from synthetic text; no binary fixture is committed.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DOCX_LIMITS, DOCX_PARSER, DocxError, extractDocxText, wordXmlToText } from "../../frontend/js/docx.js";
import { SYNTHETIC_CV_LINES, buildDocx, buildZip, documentXml } from "../fixtures/synthetic-docs.js";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DocxError, `expected DocxError, got ${error}`);
    assert.equal(error.code, code);
    return true;
  });
}

describe("wordXmlToText", () => {
  test("reads paragraphs, tabs, line breaks and table cells", () => {
    const xml = `<w:document ${W}><w:body>
      <w:p><w:r><w:t>Line one</w:t><w:tab/><w:t>after tab</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Split </w:t></w:r><w:r><w:t>run</w:t><w:br/><w:t>next line</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`;
    assert.equal(wordXmlToText(xml).trim(), "Line one\tafter tab\nSplit run\nnext line\nCell A\tCell B");
  });

  test("decodes the predefined and numeric XML entities only", () => {
    const xml = `<w:p ${W}><w:r><w:t>R&amp;D &lt;PMO&gt; &quot;q&quot; &apos;a&apos; &#8211; &#x2022; &unknown;</w:t></w:r></w:p>`;
    assert.equal(wordXmlToText(xml), "R&D <PMO> \"q\" 'a' – • &unknown;\n");
  });

  test("skips deleted tracked changes and field codes but keeps inserted text", () => {
    const xml = `<w:p ${W}><w:del><w:r><w:delText>removed</w:delText></w:r></w:del><w:ins><w:r><w:t>kept</w:t></w:r></w:ins>`
      + `<w:r><w:instrText> HYPERLINK "https://example.test" </w:instrText></w:r><w:r><w:t> text</w:t></w:r></w:p>`;
    assert.equal(wordXmlToText(xml), "kept text\n");
  });

  test("ignores text outside w:t (attributes, other elements)", () => {
    const xml = `<w:p ${W}><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Visible</w:t></w:r><w:bookmarkStart w:name="hidden"/></w:p>`;
    assert.equal(wordXmlToText(xml), "Visible\n");
  });

  test("refuses DTDs and entity declarations (no XXE or billion-laughs expansion)", () => {
    for (const xml of [
      `<!DOCTYPE w:document [<!ENTITY x "boom">]><w:document ${W}><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>`,
      `<?xml version="1.0"?><!ENTITY lol "lol"><w:p/>`,
      `<!doctype html><w:p/>`,
    ]) {
      assert.throws(() => wordXmlToText(xml), (error) => error instanceof DocxError && error.code === "unsupported_content");
    }
  });
});

describe("extractDocxText", () => {
  test("extracts the synthetic CV paragraph by paragraph", async () => {
    const { text, warnings } = await extractDocxText(buildDocx());
    assert.deepEqual(warnings, []);
    assert.equal(text, `${SYNTHETIC_CV_LINES.join("\n")}\n`);
  });

  test("includes page-header text first and says so", async () => {
    const { text, warnings } = await extractDocxText(buildDocx(["Body paragraph"], { header: ["Header: Alex Synthetic"] }));
    assert.deepEqual(warnings, ["headers_included"]);
    assert.equal(text, "Header: Alex Synthetic\n\nBody paragraph\n");
  });

  test("reads stored (uncompressed) entries too", async () => {
    const bytes = buildZip([{ name: "word/document.xml", data: documentXml(["Stored entry"]), store: true }]);
    assert.equal((await extractDocxText(bytes)).text, "Stored entry\n");
  });

  test("works on a Uint8Array view with a non-zero offset", async () => {
    const docx = buildDocx(["Offset view"]);
    const padded = new Uint8Array(docx.length + 7);
    padded.set(docx, 7);
    assert.equal((await extractDocxText(padded.subarray(7))).text, "Offset view\n");
  });

  test("rejects files that are not ZIP archives", async () => {
    await rejectsWith(extractDocxText(new TextEncoder().encode("%PDF-1.4 not a zip")), "parse_error");
    await rejectsWith(extractDocxText(new Uint8Array(0)), "parse_error");
  });

  test("rejects archives without word/document.xml", async () => {
    await rejectsWith(extractDocxText(buildZip([{ name: "xl/workbook.xml", data: "<workbook/>" }])), "unsupported_content");
  });

  test("rejects encrypted entries", async () => {
    await rejectsWith(extractDocxText(buildZip([{ name: "word/document.xml", data: documentXml(["x"]), flags: 0x0801 }])), "encrypted");
  });

  test("rejects a document that declares more than the size limit", async () => {
    const bytes = buildZip([{ name: "word/document.xml", data: documentXml(["x"]), declaredSize: DOCX_LIMITS.maxXmlBytes + 1 }]);
    await rejectsWith(extractDocxText(bytes), "too_large");
  });

  test("rejects zip bombs by compression ratio", async () => {
    const bomb = `${documentXml(["x"])}${" ".repeat(2 * 1024 * 1024)}`;
    await rejectsWith(extractDocxText(buildZip([{ name: "word/document.xml", data: bomb }])), "too_large");
  });

  test("stops inflating at the declared size even when the header lies", async () => {
    // Declares 1 KB but inflates to ~400 KB at a ratio under the ratio cap.
    const noisy = Array.from({ length: 40_000 }, (_, i) => `${(i * 7919) % 9973}`).join(",");
    const bytes = buildZip([{ name: "word/document.xml", data: documentXml([noisy]), declaredSize: 1024 }]);
    await rejectsWith(extractDocxText(bytes), "too_large");
  });

  test("rejects ZIP64 markers and truncated archives", async () => {
    const zip64 = buildDocx();
    zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10);
    await rejectsWith(extractDocxText(zip64), "unsupported_content");

    const truncated = buildDocx();
    truncated.writeUInt32LE(truncated.length, truncated.length - 22 + 16);
    await rejectsWith(extractDocxText(truncated), "parse_error");
  });

  test("rejects unsupported compression methods", async () => {
    const bytes = buildZip([{ name: "word/document.xml", data: documentXml(["x"]), store: true }]);
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt16LE(14, central + 10); // LZMA
    await rejectsWith(extractDocxText(bytes), "unsupported_content");
  });

  test("rejects a DTD inside the document part", async () => {
    const bytes = buildDocx([], { documentXml: `<!DOCTYPE x [<!ENTITY a "b">]><w:document ${W}/>` });
    await rejectsWith(extractDocxText(bytes), "unsupported_content");
  });

  test("identifies itself with a version the Worker accepts", () => {
    assert.equal(DOCX_PARSER.name, "nisco-docx");
    assert.match(DOCX_PARSER.version, /^\d{1,3}\.\d{1,4}\.\d{1,6}$/);
  });
});
