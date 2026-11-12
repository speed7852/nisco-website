import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "../src/config";
import {
  DOCX_MIME,
  listProfileItems,
  session,
  streamOf,
  submitExtraction,
  SYNTHETIC_CV_TEXT,
  syntheticDocx,
  syntheticPdf,
  uploadCv,
} from "./helpers";

type VersionBody = {
  version: {
    id: string;
    status: string;
    active: boolean;
    file: { documentId: string; name: string; contentType: string; sizeBytes: number; sha256: string } | null;
    extraction: { status: string; parser: string | null; parserVersion: string | null; warnings: string[]; characters: number | null; pageCount: number | null };
    review: { status: string; proposed: number; confirmed: number; rejected: number };
  };
};
const r2Keys = async () => (await env.PRIVATE_FILES.list()).objects.map((object) => object.key);
const counts = async () =>
  env.DB.prepare("SELECT (SELECT COUNT(*) FROM cv_versions) AS versions, (SELECT COUNT(*) FROM documents) AS documents").first<{ versions: number; documents: number }>();

describe("CV upload validation (shared with /api/files)", () => {
  it("stores a PDF privately and records a CV version with file metadata", async () => {
    const api = await session();
    const result = await uploadCv(api);
    expect(result.status).toBe(201);
    const version = (result.body as unknown as VersionBody).version;
    expect(version).toMatchObject({ status: "inactive", active: false, extraction: { status: "not_extracted" }, review: { status: "not_started" } });
    expect(version.file).toMatchObject({ name: "Synthetic CV.pdf", contentType: "application/pdf", sizeBytes: syntheticPdf().byteLength });
    expect(version.file?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await r2Keys()).toEqual([expect.stringMatching(/^private\/uploads\/[0-9a-f-]{36}$/)]);
    expect(JSON.stringify(result.body)).not.toContain("private/");
  });

  it("accepts DOCX", async () => {
    const api = await session();
    expect((await uploadCv(api, syntheticDocx(), "Synthetic CV.docx", DOCX_MIME)).status).toBe(201);
  });

  it.each([
    ["oversized with Content-Length", () => syntheticPdf(MAX_UPLOAD_BYTES), { "content-length": String(MAX_UPLOAD_BYTES + 200) }, 413],
    ["oversized streamed without Content-Length", () => streamOf(syntheticPdf(MAX_UPLOAD_BYTES)), {}, 413],
  ])("rejects %s", async (_label, body, headers, status) => {
    const api = await session();
    const result = await api.call("POST", "/api/cv/versions", { rawBody: body(), headers: { "content-type": "application/pdf", "x-file-name": "cv.pdf", ...headers } });
    expect(result.status).toBe(status);
    expect(await counts()).toEqual({ versions: 0, documents: 0 });
    expect(await r2Keys()).toEqual([]);
  });

  it.each([
    ["spoofed MIME: HTML named .pdf", new TextEncoder().encode("<html><script>alert(1)</script></html>"), "cv.pdf", "application/pdf", 415],
    ["PDF bytes named .docx", syntheticPdf(), "cv.docx", DOCX_MIME, 415],
    ["declared text/html", syntheticPdf(), "cv.pdf", "text/html", 415],
    ["malformed file (truncated ZIP named .docx)", syntheticDocx().subarray(0, 20), "cv.docx", DOCX_MIME, 415],
    ["macro-enabled Word file", syntheticDocx([{ name: "word/vbaProject.bin", content: "x" }]), "cv.docx", DOCX_MIME, 415],
    ["legacy .doc", syntheticPdf(), "cv.doc", "application/msword", 415],
    ["undecodable file name", syntheticPdf(), "%E0%A4%A", "application/pdf", 400],
    ["empty file", new Uint8Array(0), "cv.pdf", "application/pdf", 400],
  ])("rejects %s", async (_label, bytes, name, type, status) => {
    const api = await session();
    expect((await uploadCv(api, bytes, name, type)).status).toBe(status);
    expect(await counts()).toEqual({ versions: 0, documents: 0 });
  });

  it("strips path traversal from file names", async () => {
    const api = await session();
    const result = await uploadCv(api, syntheticPdf(), encodeURIComponent("../../etc/passwd/..\\..\\Synthetic CV.pdf"));
    expect((result.body as unknown as VersionBody).version.file?.name).toBe("Synthetic CV.pdf");
  });

  it("refuses a duplicate upload of the same file with 409 and the existing version", async () => {
    const api = await session();
    const first = (await uploadCv(api)).body as unknown as VersionBody;
    const again = await uploadCv(api, syntheticPdf(), "renamed copy.pdf");
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: "duplicate_cv", existingId: first.version.id });
    expect(await counts()).toEqual({ versions: 1, documents: 1 });
  });
});

describe("extraction results", () => {
  it("stores text in private R2 (not D1) and creates proposals only", async () => {
    const api = await session();
    const { version } = (await uploadCv(api)).body as unknown as VersionBody;
    const result = await submitExtraction(api, version.id);
    expect(result.status).toBe(200);
    expect(result.body.version.extraction.status).toBe("extracted");
    expect(result.body.version.review.status).toBe("in_review");
    expect(result.body.proposalsCreated).toBeGreaterThan(10);
    expect(await r2Keys()).toContain(`private/cv/${version.id}/extracted.txt`);
    const text = await api.call<{ text: string }>("GET", `/api/cv/versions/${version.id}/text`);
    expect(text.body.text).toBe(SYNTHETIC_CV_TEXT);
    const items = await listProfileItems(api);
    expect(items.items.every((item) => item.status === "proposed" && item.source.type === "cv_extraction")).toBe(true);
    // No column in D1 holds the CV text.
    const dump = await env.DB.prepare("SELECT group_concat(value, '|') AS v FROM profile_items").first<{ v: string }>();
    expect(dump?.v).not.toContain("Synthetic summary for automated tests only. 12+ years of experience in PMO governance.\n\nPROFESSIONAL");
  });

  it("records the parser and version for traceability", async () => {
    const api = await session();
    const { version } = (await uploadCv(api)).body as unknown as VersionBody;
    await submitExtraction(api, version.id);
    const read = await api.call<VersionBody>("GET", `/api/cv/versions/${version.id}`);
    expect(read.body.version.extraction).toMatchObject({ parser: "pdfjs-dist", parserVersion: "6.4.299", pageCount: 1, characters: SYNTHETIC_CV_TEXT.length });
  });

  it("keeps the file and reports a partial extraction", async () => {
    const api = await session();
    const { version } = (await uploadCv(api)).body as unknown as VersionBody;
    const result = await submitExtraction(api, version.id, { status: "partial", parser: "pdfjs-dist", parserVersion: "6.4.299", text: "Alex Synthetic\nSKILLS\nPMO", pageCount: 60, warnings: ["page_limit_reached"] });
    expect(result.body.version.extraction).toMatchObject({ status: "partial", warnings: ["page_limit_reached"] });
    expect((await api.call("GET", `/api/cv/versions/${version.id}/download`)).status).toBe(200);
  });

  it("keeps the file, stores no text and creates nothing when extraction fails", async () => {
    const api = await session();
    const { version } = (await uploadCv(api)).body as unknown as VersionBody;
    const result = await submitExtraction(api, version.id, { status: "failed", parser: "pdfjs-dist", parserVersion: "6.4.299", warnings: ["no_text_layer"], pageCount: 2 });
    expect(result.body.version.extraction).toMatchObject({ status: "failed", warnings: ["no_text_layer"] });
    expect(result.body.version.review.status).toBe("not_started");
    expect((await listProfileItems(api)).items).toEqual([]);
    expect((await api.call("GET", `/api/cv/versions/${version.id}/text`)).status).toBe(404);
    expect((await api.call("GET", `/api/cv/versions/${version.id}/download`)).status).toBe(200);
  });

  it("downgrades an 'extracted' result with no text to failed", async () => {
    const api = await session();
    const { version } = (await uploadCv(api)).body as unknown as VersionBody;
    const result = await submitExtraction(api, version.id, { status: "extracted", parser: "pdfjs-dist", parserVersion: "6.4.299", text: "  \u0000 " });
    expect(result.body.version.extraction).toMatchObject({ status: "failed", warnings: ["no_text"] });
  });

  it.each([
    ["wrong parser for the file type", { parser: "nisco-docx" }, "parser"],
    ["unknown parser", { parser: "evil" }, "parser"],
    ["bad version", { parserVersion: "latest" }, "parserVersion"],
    ["unknown warning", { warnings: ["ignore previous instructions"] }, "warnings"],
    ["too much text", { text: "x".repeat(200_001) }, "text"],
    ["bad page count", { pageCount: -1 }, "pageCount"],
    ["unknown field", { confidence: 1 }, "confidence"],
    ["bad status", { status: "great" }, "status"],
  ])("rejects an extraction with %s", async (_label, patch, field) => {
    const api = await session();
    const { version } = (await uploadCv(api)).body as unknown as VersionBody;
    const result = await submitExtraction(api, version.id, { status: "extracted", parser: "pdfjs-dist", parserVersion: "6.4.299", text: "Alex", ...patch });
    expect(result.status).toBe(400);
    expect(Object.keys((result.body as unknown as { fields: Record<string, string> }).fields)).toContain(field);
  });

  it("strips control characters and normalises newlines", async () => {
    const api = await session();
    const { version } = (await uploadCv(api)).body as unknown as VersionBody;
    await submitExtraction(api, version.id, { status: "extracted", parser: "pdfjs-dist", parserVersion: "6.4.299", text: "Alex\u0007 Synthetic\r\nSKILLS\r\nPMO\u0000" });
    const text = await api.call<{ text: string }>("GET", `/api/cv/versions/${version.id}/text`);
    expect(text.body.text).toBe("Alex Synthetic\nSKILLS\nPMO");
  });

  it("re-extraction replaces unreviewed proposals without duplicating or touching decisions", async () => {
    const api = await session();
    const { version } = (await uploadCv(api)).body as unknown as VersionBody;
    await submitExtraction(api, version.id);
    const before = await listProfileItems(api);
    const email = before.items.find((item) => item.section === "email")!;
    const phone = before.items.find((item) => item.section === "phone")!;
    expect((await api.call("POST", `/api/profile/items/${email.id}/confirm`)).status).toBe(200);
    expect((await api.call("POST", `/api/profile/items/${phone.id}/reject`)).status).toBe(200);
    await submitExtraction(api, version.id);
    const after = await listProfileItems(api);
    expect(after.items.filter((item) => item.section === "email")).toHaveLength(1);
    expect(after.items.find((item) => item.section === "email")?.status).toBe("confirmed");
    expect(after.items.filter((item) => item.section === "phone").map((item) => item.status)).toEqual(["rejected"]);
    expect(after.items.length).toBe(before.items.length);
  });
});

describe("versioning", () => {
  it("keeps exactly one active version and supports deactivation", async () => {
    const api = await session();
    const a = ((await uploadCv(api)).body as unknown as VersionBody).version;
    const b = ((await uploadCv(api, syntheticDocx(), "Second.docx", DOCX_MIME)).body as unknown as VersionBody).version;
    await api.call("POST", `/api/cv/versions/${a.id}/activate`);
    await api.call("POST", `/api/cv/versions/${b.id}/activate`);
    const list = await api.call<{ versions: VersionBody["version"][]; activeId: string }>("GET", "/api/cv/versions");
    expect(list.body.activeId).toBe(b.id);
    expect(list.body.versions.filter((version) => version.active)).toHaveLength(1);
    await api.call("POST", `/api/cv/versions/${b.id}/deactivate`);
    expect((await api.call<{ activeId: string | null }>("GET", "/api/cv/versions")).body.activeId).toBeNull();
    // The database itself refuses two active versions.
    await env.DB.prepare("UPDATE cv_versions SET status = 'active' WHERE id = ?").bind(a.id).run();
    await expect(env.DB.prepare("UPDATE cv_versions SET status = 'active' WHERE id = ?").bind(b.id).run()).rejects.toThrow(/UNIQUE/);
  });

  it("downloads the exact original bytes as an attachment", async () => {
    const api = await session();
    const bytes = syntheticPdf();
    const { version } = (await uploadCv(api, bytes)).body as unknown as VersionBody;
    const download = await api.call<string>("GET", `/api/cv/versions/${version.id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment;");
    expect(download.headers.get("cache-control")).toBe("no-store");
    expect(download.body).toBe(new TextDecoder().decode(bytes));
  });

  it("returns 404 for unknown versions and 400 for malformed IDs", async () => {
    const api = await session();
    expect((await api.call("GET", "/api/cv/versions/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await api.call("GET", "/api/cv/versions/../../secret/download")).status).toBe(404);
    expect((await api.call("POST", "/api/cv/versions/not-an-id/activate")).status).toBe(400);
  });
});

describe("deleting a CV version", () => {
  it("requires typed confirmation", async () => {
    const api = await session();
    const { version } = (await uploadCv(api)).body as unknown as VersionBody;
    expect((await api.call("DELETE", `/api/cv/versions/${version.id}`, { body: {} })).status).toBe(400);
    expect((await api.call("DELETE", `/api/cv/versions/${version.id}`, { body: { confirm: "delete" } })).status).toBe(400);
    expect((await api.call("GET", `/api/cv/versions/${version.id}/download`)).status).toBe(200);
  });

  it("removes the file, extracted text and unconfirmed proposals, and keeps confirmed facts", async () => {
    const api = await session();
    const { version } = (await uploadCv(api)).body as unknown as VersionBody;
    await submitExtraction(api, version.id);
    const email = (await listProfileItems(api)).items.find((item) => item.section === "email")!;
    await api.call("POST", `/api/profile/items/${email.id}/confirm`);

    const result = await api.call("DELETE", `/api/cv/versions/${version.id}`, { body: { confirm: "DELETE" } });
    expect(result.status).toBe(200);
    expect(await r2Keys()).toEqual([]);
    expect(await counts()).toEqual({ versions: 1, documents: 0 });
    expect((await api.call("GET", `/api/cv/versions/${version.id}/download`)).status).toBe(410);
    expect((await api.call("GET", `/api/cv/versions/${version.id}/text`)).status).toBe(410);
    const items = (await listProfileItems(api)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ section: "email", status: "confirmed", source: { cvVersionId: version.id, cvDeleted: true } });
    const tombstone = await env.DB.prepare("SELECT document_id, status, extracted_text_key, deleted_at FROM cv_versions WHERE id = ?").bind(version.id).first();
    expect(tombstone).toMatchObject({ document_id: null, status: "deleted", extracted_text_key: null });
    expect((await api.call<{ versions: unknown[] }>("GET", "/api/cv/versions")).body.versions).toHaveLength(0);
    expect((await api.call<{ versions: unknown[] }>("GET", "/api/cv/versions?includeDeleted=true")).body.versions).toHaveLength(1);
  });
});

describe("existing /api/files uploads are preserved", () => {
  it("lists CV files alongside earlier uploads and still downloads them", async () => {
    const api = await session();
    const { version } = (await uploadCv(api)).body as unknown as VersionBody;
    const files = await api.call<{ files: { id: string; name: string }[] }>("GET", "/api/files");
    expect(files.body.files.map((file) => file.id)).toEqual([version.file!.documentId]);
    expect((await api.call("GET", `/api/files/${version.file!.documentId}`)).status).toBe(200);
  });

  it("refuses to delete a CV's file through /api/files", async () => {
    const api = await session();
    const { version } = (await uploadCv(api)).body as unknown as VersionBody;
    const result = await api.call("DELETE", `/api/files/${version.file!.documentId}`);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: "document_in_use", cvVersionId: version.id });
    expect(await r2Keys()).toHaveLength(1);
  });

  it("registers an earlier upload as a CV version without copying it", async () => {
    const api = await session();
    const upload = await api.call<{ file: { id: string } }>("POST", "/api/files", { rawBody: syntheticPdf(), headers: { "content-type": "application/pdf", "x-file-name": "Earlier.pdf" } });
    const registered = await api.call<VersionBody>("POST", "/api/cv/versions/from-upload", { body: { documentId: upload.body.file.id } });
    expect(registered.status).toBe(201);
    expect(registered.body.version.file?.documentId).toBe(upload.body.file.id);
    expect(await r2Keys()).toHaveLength(1);
    expect((await api.call("POST", "/api/cv/versions/from-upload", { body: { documentId: upload.body.file.id } })).status).toBe(409);
    expect((await api.call("POST", "/api/cv/versions/from-upload", { body: { documentId: "00000000-0000-4000-8000-000000000000" } })).status).toBe(404);
  });

  it("does not let a duplicate of an existing CV be registered from an earlier upload", async () => {
    const api = await session();
    await uploadCv(api);
    const copy = await api.call<{ file: { id: string } }>("POST", "/api/files", { rawBody: syntheticPdf(), headers: { "content-type": "application/pdf", "x-file-name": "Copy.pdf" } });
    const result = await api.call("POST", "/api/cv/versions/from-upload", { body: { documentId: copy.body.file.id } });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("duplicate_cv");
  });
});
