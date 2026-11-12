/**
 * File type detection from content, not from the name or the browser-supplied MIME type.
 * Only PDF and DOCX are accepted for CV uploads.
 */

export type SupportedFileType = "pdf" | "docx";

export const FILE_TYPES: Record<SupportedFileType, { mime: string; extension: string }> = {
  pdf: { mime: "application/pdf", extension: ".pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: ".docx" },
};

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);
const PDF_MAGIC = ascii("%PDF-");
const ZIP_LOCAL_HEADER = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const DOCX_REQUIRED_ENTRIES = [ascii("[Content_Types].xml"), ascii("word/document.xml")];
/** Macro-enabled Word content is refused even when named .docx. */
const DOCX_FORBIDDEN_ENTRIES = [ascii("word/vbaProject.bin")];

function startsWith(bytes: Uint8Array, prefix: Uint8Array, offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) if (bytes[offset + i] !== prefix[i]) return false;
  return true;
}

function contains(bytes: Uint8Array, needle: Uint8Array): boolean {
  const first = needle[0];
  outer: for (let i = 0; i <= bytes.length - needle.length; i += 1) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < needle.length; j += 1) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

export function detectFileType(bytes: Uint8Array): SupportedFileType | null {
  // The PDF header must appear within the first 1024 bytes (ISO 32000 allows leading junk there).
  const head = bytes.subarray(0, 1024 + PDF_MAGIC.length);
  for (let offset = 0; offset <= 1024; offset += 1) {
    if (startsWith(head, PDF_MAGIC, offset)) return "pdf";
  }
  if (startsWith(bytes, ZIP_LOCAL_HEADER)) {
    // A DOCX is a ZIP whose entry names are stored as plain ASCII in its headers.
    if (DOCX_FORBIDDEN_ENTRIES.some((entry) => contains(bytes, entry))) return null;
    if (DOCX_REQUIRED_ENTRIES.every((entry) => contains(bytes, entry))) return "docx";
  }
  return null;
}

export function typeFromFileName(name: string): SupportedFileType | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}

/**
 * Turns the X-File-Name header (URI-encoded by the browser) into a safe display name: no path,
 * no control characters, at most 150 characters. Returns null when the header cannot be decoded.
 */
export function sanitiseFileName(header: string | null): string | null {
  if (header === null) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(header);
  } catch {
    return null;
  }
  const base = decoded.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").replace(/\s+/g, " ").trim();
  if (cleaned === "" || cleaned === "." || cleaned === "..") return null;
  if (cleaned.length <= 150) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 150 - extension.length) + extension;
}
