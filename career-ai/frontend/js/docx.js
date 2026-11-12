// DOCX text extraction for the browser (also runs in Node 22 for tests). No dependencies.
//
// A DOCX file is a ZIP archive; the text lives in word/document.xml (and page headers in
// word/header*.xml). This parser:
// - reads only the ZIP central directory and the few entries it needs;
// - refuses encrypted, ZIP64 and oversized entries, and stops inflating past a size limit, so a
//   "zip bomb" cannot exhaust memory;
// - never parses XML with a general parser: it refuses any DTD/entity declaration and only reads the
//   text inside <w:t> elements, so nothing in the document is ever executed or resolved;
// - skips deleted tracked-change text and field codes.

export const DOCX_PARSER = { name: "nisco-docx", version: "1.0.0" };

export const DOCX_LIMITS = {
  maxEntries: 2_000,
  /** Decompressed size of any single XML part. */
  maxXmlBytes: 10 * 1024 * 1024,
  /** Decompressed/compressed ratio above which an entry is treated as a zip bomb. */
  maxRatio: 200,
};

export class DocxError extends Error {
  /** @param {"encrypted"|"too_large"|"unsupported_content"|"parse_error"} code */
  constructor(code, message) {
    super(message);
    this.name = "DocxError";
    this.code = code;
  }
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function findEndOfCentralDirectory(view) {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === SIG_EOCD) return offset;
  }
  throw new DocxError("parse_error", "Not a ZIP archive (end of central directory not found).");
}

function readCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff || size === 0xffffffff) throw new DocxError("unsupported_content", "ZIP64 archives are not supported.");
  if (count > DOCX_LIMITS.maxEntries) throw new DocxError("too_large", "The archive has too many entries.");
  if (offset + size > bytes.byteLength) throw new DocxError("parse_error", "The archive is truncated.");

  const entries = [];
  let cursor = offset;
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== SIG_CENTRAL) throw new DocxError("parse_error", "Corrupt central directory.");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return { view, entries };
}

async function inflateRaw(data, limit) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new DocxError("too_large", "A part of the document expands beyond the size limit.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function readEntry(bytes, view, entry) {
  if (entry.flags & 0x1) throw new DocxError("encrypted", "The document is encrypted or password protected.");
  if (entry.uncompressedSize > DOCX_LIMITS.maxXmlBytes) throw new DocxError("too_large", "A part of the document is too large.");
  if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > DOCX_LIMITS.maxRatio) {
    throw new DocxError("too_large", "A part of the document is compressed suspiciously well (possible zip bomb).");
  }
  const local = entry.localOffset;
  if (local + 30 > bytes.byteLength || view.getUint32(local, true) !== SIG_LOCAL) throw new DocxError("parse_error", "Corrupt local file header.");
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength) throw new DocxError("parse_error", "The archive is truncated.");
  const data = bytes.subarray(start, end);
  const limit = Math.min(DOCX_LIMITS.maxXmlBytes, Math.max(entry.uncompressedSize, 1));
  if (entry.method === 0) {
    if (data.byteLength > DOCX_LIMITS.maxXmlBytes) throw new DocxError("too_large", "A part of the document is too large.");
    return data;
  }
  if (entry.method === 8) return inflateRaw(data, limit);
  throw new DocxError("unsupported_content", `Unsupported compression method ${entry.method}.`);
}

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeXmlText(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Extracts visible text from WordprocessingML. Exported for tests. */
export function wordXmlToText(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new DocxError("unsupported_content", "The document contains a DTD, which is not allowed.");
  let out = "";
  let inText = false;
  let skipDepth = 0;
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^>]*?)?)(\/?)>|([^<]+)/g;
  for (const match of xml.matchAll(tag)) {
    const [, closing, name, , selfClosing, textNode] = match;
    if (textNode !== undefined) {
      if (inText && skipDepth === 0) out += decodeXmlText(textNode);
      continue;
    }
    const isSkipped = name === "w:delText" || name === "w:instrText";
    if (isSkipped && !selfClosing) skipDepth += closing ? -1 : 1;
    if (name === "w:t") inText = !closing && !selfClosing;
    else if (!closing && (name === "w:tab" || name === "w:ptab")) out += "\t";
    else if (!closing && (name === "w:br" || name === "w:cr")) out += "\n";
    else if (closing && name === "w:p") out += "\n";
    // A table row becomes one line: each cell's last paragraph break turns into a tab.
    else if (closing && name === "w:tc") out = `${out.replace(/\n$/, "")}\t`;
    else if (closing && name === "w:tr") out = `${out.replace(/\t$/, "")}\n`;
  }
  return out.replace(/\t+\n/g, "\n");
}

/** @param {Uint8Array} bytes @returns {Promise<{ text: string, warnings: string[] }>} */
export async function extractDocxText(bytes) {
  const { view, entries } = readCentralDirectory(bytes);
  const body = entries.find((entry) => entry.name === "word/document.xml");
  if (!body) throw new DocxError("unsupported_content", "word/document.xml not found: not a Word document.");
  const headers = entries.filter((entry) => /^word\/header\d+\.xml$/.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
  const decoder = new TextDecoder();
  const warnings = [];
  let headerText = "";
  for (const header of headers.slice(0, 3)) {
    const text = wordXmlToText(decoder.decode(await readEntry(bytes, view, header))).trim();
    if (text && !headerText.includes(text)) headerText += `${text}\n`;
  }
  if (headerText) warnings.push("headers_included");
  const bodyText = wordXmlToText(decoder.decode(await readEntry(bytes, view, body)));
  return { text: `${headerText}${headerText ? "\n" : ""}${bodyText}`, warnings };
}
