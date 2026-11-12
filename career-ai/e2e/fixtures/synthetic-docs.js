// Generates synthetic PDF and DOCX files at test time, so no binary CV (real or fake) is ever
// committed. Every value below is invented for tests: example.test addresses, a +966 50 000 0000
// placeholder number, "Example Holdings", "Fictional Bank".
import { crc32, deflateRawSync } from "node:zlib";

/** The same synthetic CV the Worker tests use (worker/test/helpers.ts SYNTHETIC_CV_TEXT). */
export const SYNTHETIC_CV_LINES = [
  "Alex Synthetic",
  "Programme Manager (synthetic test CV)",
  "alex.synthetic@example.test | +966 50 000 0000 | https://example.test/alex",
  "",
  "SUMMARY",
  "Synthetic summary for automated tests only. 12+ years of experience in PMO governance.",
  "",
  "PROFESSIONAL EXPERIENCE",
  "Senior Programme Manager at Example Holdings",
  "Jan 2020 – Present",
  "• Led a synthetic PMO of 5 people.",
  "• Ran ITIL service transition for a fictional bank.",
  "Project Manager | Fictional Bank | 2016 - 2019",
  "• Delivered a synthetic core-banking upgrade.",
  "",
  "EDUCATION",
  "Example University",
  "BSc Computer Science, 2012",
  "",
  "CERTIFICATIONS",
  "• PMP (Synthetic Institute), 2018",
  "• ITIL 4 Foundation",
  "",
  "SKILLS",
  "PMO governance, ITIL; Stakeholder management | Budgeting",
];

// ---------------------------------------------------------------------------------------------
// PDF: one or more pages of Helvetica text (WinAnsi encoding), or a page with no text layer at all.

const WIN_ANSI = { "–": 0x96, "—": 0x97, "•": 0x95, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94 };

function pdfString(text) {
  let out = "";
  for (const char of text) {
    const code = WIN_ANSI[char] ?? char.codePointAt(0);
    if (code > 0xff) throw new Error(`Character ${char} is not supported by the synthetic PDF generator.`);
    if (char === "(" || char === ")" || char === "\\") out += `\\${char}`;
    else if (code < 0x20 || code > 0x7e) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += char;
  }
  return `(${out})`;
}

/**
 * @param {string[][]} pages lines of text per page; an empty page array draws a rectangle only
 *   (an image-like page with no text layer, as a scanned CV would have)
 */
export function buildPdf(pages = [SYNTHETIC_CV_LINES]) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(null);
  const pagesId = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids = [];
  for (const lines of pages) {
    let stream;
    if (lines.length === 0) {
      stream = "0.85 g 72 600 300 120 re f";
    } else {
      stream = lines
        .map((line, index) => (line === "" ? "" : `BT /F1 11 Tf 56 ${780 - index * 15} Td ${pdfString(line)} Tj ET`))
        .filter(Boolean)
        .join("\n");
    }
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// ---------------------------------------------------------------------------------------------
// ZIP and DOCX

/**
 * Builds a ZIP archive. Options exist so tests can produce hostile archives.
 * @param {{ name: string, data: string|Buffer, store?: boolean, flags?: number, declaredSize?: number }[]} entries
 */
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const data = entry.store ? raw : deflateRawSync(raw);
    const method = entry.store ? 0 : 8;
    const size = entry.declaredSize ?? raw.length;
    const flags = entry.flags ?? 0x0800;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** WordprocessingML for a list of paragraphs. */
export function documentXml(paragraphs, { root = "w:document", wrapper = "w:body" } = {}) {
  const body = paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<${root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><${wrapper}>${body}</${wrapper}></${root}>`;
}

/**
 * @param {string[]} paragraphs
 * @param {{ header?: string[], documentXml?: string, extraEntries?: object[] }} [options]
 */
export function buildDocx(paragraphs = SYNTHETIC_CV_LINES, options = {}) {
  const entries = [
    {
      name: "[Content_Types].xml",
      data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    { name: "word/document.xml", data: options.documentXml ?? documentXml(paragraphs) },
  ];
  if (options.header) entries.push({ name: "word/header1.xml", data: documentXml(options.header, { root: "w:hdr", wrapper: "w:sdt" }) });
  entries.push(...(options.extraEntries ?? []));
  return buildZip(entries);
}
