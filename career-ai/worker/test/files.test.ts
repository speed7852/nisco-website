import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "../src/config";
import { DOCX_MIME, session, streamOf, syntheticDocx, syntheticPdf } from "./helpers";

type FileDto = { id: string; name: string; contentType: string; sizeBytes: number; kind: string };

async function upload(api: Awaited<ReturnType<typeof session>>, bytes: Uint8Array | ReadableStream<Uint8Array>, name: string, type: string, headers: Record<string, string> = {}) {
  return api.call<{ file: FileDto }>("POST", "/api/files", {
    rawBody: bytes,
    // Browsers send the name URI-encoded (see frontend/app.js); headers must be ASCII.
    headers: { "content-type": type, "x-file-name": /%/.test(name) ? name : encodeURIComponent(name), ...headers },
  });
}

const r2Count = async () => (await env.PRIVATE_FILES.list()).objects.length;

describe("upload size limit (audit P19, P20)", () => {
  it("rejects an oversized upload that declares its Content-Length (P19)", async () => {
    const api = await session();
    const big = syntheticPdf(MAX_UPLOAD_BYTES);
    const result = await upload(api, big, "cv.pdf", "application/pdf", { "content-length": String(big.byteLength) });
    expect(result.status).toBe(413);
    expect(await r2Count()).toBe(0);
  });

  it("rejects an oversized streamed upload without Content-Length by counting bytes (P20)", async () => {
    const api = await session();
    const result = await upload(api, streamOf(syntheticPdf(MAX_UPLOAD_BYTES)), "cv.pdf", "application/pdf");
    expect(result.status).toBe(413);
    expect(await r2Count()).toBe(0);
  });

  it("accepts a file exactly at the limit", async () => {
    const api = await session();
    const pdf = syntheticPdf();
    const exact = new Uint8Array(MAX_UPLOAD_BYTES);
    exact.set(pdf);
    expect((await upload(api, streamOf(exact), "cv.pdf", "application/pdf")).status).toBe(201);
  });
});

describe("upload type checks", () => {
  it.each([
    ["HTML disguised as PDF", new TextEncoder().encode("<html><script>alert(1)</script></html>"), "cv.pdf", "application/pdf"],
    ["text/html declared", syntheticPdf(), "cv.pdf", "text/html"],
    ["PDF bytes named .docx", syntheticPdf(), "cv.docx", DOCX_MIME],
    ["DOCX bytes named .pdf", syntheticDocx(), "cv.pdf", "application/pdf"],
    ["DOCX declared as PDF", syntheticDocx(), "cv.docx", "application/pdf"],
    ["legacy .doc name", syntheticPdf(), "cv.doc", "application/msword"],
    ["macro-enabled document", syntheticDocx([{ name: "word/vbaProject.bin", content: "x" }]), "cv.docx", DOCX_MIME],
    ["executable name", syntheticPdf(), "cv.pdf.exe", "application/pdf"],
  ])("rejects %s with 415", async (_label, bytes, name, type) => {
    const api = await session();
    const result = await upload(api, bytes, name, type);
    expect(result.status).toBe(415);
    expect(await r2Count()).toBe(0);
  });

  it("rejects a malformed file-name header with 400, not 500 (P21)", async () => {
    const api = await session();
    const result = await upload(api, syntheticPdf(), "%E0%A4%A", "application/pdf");
    expect(result.status).toBe(400);
    expect((await upload(api, syntheticPdf(), "", "application/pdf")).status).toBe(400);
  });

  it("rejects an empty file", async () => {
    const api = await session();
    expect((await upload(api, new Uint8Array(0), "cv.pdf", "application/pdf")).status).toBe(400);
  });
});

describe("stored uploads can be found, downloaded and deleted (audit P22, P23)", () => {
  it("records each upload in D1 and lists it (P22, P23)", async () => {
    const api = await session();
    const pdf = await upload(api, syntheticPdf(), "Synthetic CV.pdf", "application/pdf");
    const docx = await upload(api, syntheticDocx(), "Synthetic CV.docx", "application/octet-stream");
    expect(pdf.status).toBe(201);
    expect(docx.status).toBe(201);
    expect(docx.body.file.contentType).toBe(DOCX_MIME);

    const list = await api.call<{ files: FileDto[] }>("GET", "/api/files");
    expect(list.body.files.map((file) => file.name).sort()).toEqual(["Synthetic CV.docx", "Synthetic CV.pdf"]);
    const rows = await env.DB.prepare("SELECT r2_key, sha256 FROM documents").all<{ r2_key: string; sha256: string }>();
    expect(rows.results).toHaveLength(2);
    for (const row of rows.results) {
      expect(row.r2_key.startsWith("private/uploads/")).toBe(true);
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await env.PRIVATE_FILES.head(row.r2_key)).not.toBeNull();
    }
  });

  it("downloads the exact bytes as an attachment", async () => {
    const api = await session();
    const bytes = syntheticPdf();
    const { body } = await upload(api, bytes, "résumé test.pdf", "application/pdf");
    const download = await api.call<string>("GET", `/api/files/${body.file.id}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(download.headers.get("content-disposition")).toContain("attachment;");
    expect(download.headers.get("content-disposition")).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%20test.pdf");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(download.body).toBe(new TextDecoder().decode(bytes));
  });

  it("deletes the R2 object and the record", async () => {
    const api = await session();
    const { body } = await upload(api, syntheticPdf(), "cv.pdf", "application/pdf");
    expect((await api.call("DELETE", `/api/files/${body.file.id}`)).status).toBe(200);
    expect(await r2Count()).toBe(0);
    expect((await api.call("GET", `/api/files/${body.file.id}`)).status).toBe(404);
    expect((await api.call("DELETE", `/api/files/${body.file.id}`)).status).toBe(404);
  });

  it("registers files uploaded before migration 0002 so they can be managed", async () => {
    const api = await session();
    await env.PRIVATE_FILES.put("private/0b0e2f6c-legacy", syntheticPdf(), {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { originalName: "Old CV.pdf" },
    });
    const first = await api.call("POST", "/api/files/reconcile");
    expect(first.body).toMatchObject({ scanned: 1, registered: 1 });
    const again = await api.call("POST", "/api/files/reconcile");
    expect(again.body).toMatchObject({ scanned: 1, registered: 0 });
    const list = await api.call<{ files: FileDto[] }>("GET", "/api/files");
    expect(list.body.files[0]).toMatchObject({ name: "Old CV.pdf", kind: "legacy_upload" });
  });
});
