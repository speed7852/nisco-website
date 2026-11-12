import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { insertItemStatement } from "../src/db/profile-items";
import { listProfileItems, saveLegacyProfileOnly, session, submitExtraction, SYNTHETIC_PROFILE, syntheticPdf, uploadCv, type ItemDto } from "./helpers";

const item = (items: ItemDto[], section: string) => items.find((entry) => entry.section === section)!;

async function withProposals() {
  const api = await session();
  const upload = await uploadCv(api);
  await submitExtraction(api, upload.body.version.id);
  return { api, versionId: upload.body.version.id, items: (await listProfileItems(api)).items };
}

describe("structured profile listing", () => {
  it("serves section definitions and reports expected sections as missing", async () => {
    const api = await session();
    const body = await listProfileItems(api);
    expect(body.sections.map((section) => section.section)).toContain("experience");
    expect(body.missing).toEqual(expect.arrayContaining(["name", "email", "headline", "summary", "skill", "experience", "education", "preferred_title", "approved_location", "remote_preference"]));
  });

  it("marks sections confirmed, unconfirmed or missing", async () => {
    const { api, items } = await withProposals();
    await api.call("POST", `/api/profile/items/${item(items, "name").id}/confirm`);
    const body = await listProfileItems(api);
    const state = (section: string) => body.sections.find((entry) => entry.section === section)?.state;
    expect(state("name")).toBe("confirmed");
    expect(state("summary")).toBe("unconfirmed");
    expect(state("approved_location")).toBe("missing");
  });
});

describe("review decisions", () => {
  it("confirms, edits-and-confirms and rejects proposals, recording provenance", async () => {
    const { api, items, versionId } = await withProposals();
    const name = item(items, "name");
    expect(name.source).toMatchObject({ type: "cv_extraction", cvVersionId: versionId, span: { start: 0, end: 14 } });

    expect((await api.call("POST", `/api/profile/items/${name.id}/confirm`)).status).toBe(200);
    const headline = item(items, "headline");
    const edited = await api.call<{ item: ItemDto }>("POST", `/api/profile/items/${headline.id}/confirm`, { body: { value: { text: "Programme Manager" } } });
    expect(edited.body.item).toMatchObject({ status: "confirmed", userEdited: true, value: { text: "Programme Manager" } });
    expect((await api.call("POST", `/api/profile/items/${item(items, "phone").id}/reject`)).status).toBe(200);

    const after = (await listProfileItems(api)).items;
    expect(item(after, "name").status).toBe("confirmed");
    expect(item(after, "phone").status).toBe("rejected");
  });

  it("never replaces a confirmed single value without explicit replaceConfirmed", async () => {
    const api = await session();
    const manual = await api.call<{ item: ItemDto }>("POST", "/api/profile/items", { body: { section: "headline", value: { text: "Confirmed headline" } } });
    expect(manual.status).toBe(201);
    const upload = await uploadCv(api);
    await submitExtraction(api, upload.body.version.id);
    const proposal = (await listProfileItems(api)).items.find((entry) => entry.section === "headline" && entry.status === "proposed")!;

    const refused = await api.call("POST", `/api/profile/items/${proposal.id}/confirm`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "confirmed_value_exists", existing: { id: manual.body.item.id } });
    expect(item((await listProfileItems(api)).items.filter((entry) => entry.status === "confirmed"), "headline").value).toEqual({ text: "Confirmed headline" });

    const replaced = await api.call<{ superseded: number }>("POST", `/api/profile/items/${proposal.id}/confirm`, { body: { replaceConfirmed: true } });
    expect(replaced.body.superseded).toBe(1);
    const statuses = (await listProfileItems(api)).items.filter((entry) => entry.section === "headline").map((entry) => [entry.value.text, entry.status]);
    expect(statuses).toEqual(expect.arrayContaining([["Confirmed headline", "superseded"], ["Programme Manager (synthetic test CV)", "confirmed"]]));
  });

  it("refuses a duplicate confirmed value in a list section", async () => {
    const api = await session();
    expect((await api.call("POST", "/api/profile/items", { body: { section: "skill", value: { text: "ITIL" } } })).status).toBe(201);
    const duplicate = await api.call("POST", "/api/profile/items", { body: { section: "skill", value: { text: " itil " } } });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("already_confirmed");
  });

  it("requires an edit before confirming a value that fails validation", async () => {
    const api = await session();
    await saveLegacyProfileOnly(api, { ...SYNTHETIC_PROFILE, years: 12 });
    await env.DB.prepare("UPDATE profile SET data = json_set(data, '$.years', 'about twelve') WHERE id = 1").run();
    await api.call("POST", "/api/profile/legacy/proposals");
    const years = (await listProfileItems(api)).items.find((entry) => entry.section === "years_experience")!;
    const refused = await api.call("POST", `/api/profile/items/${years.id}/confirm`);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("edit_before_confirming");
    expect((await api.call("POST", `/api/profile/items/${years.id}/confirm`, { body: { value: { text: "12" } } })).status).toBe(200);
  });

  it("validates manual items and rejects unknown sections and statuses", async () => {
    const api = await session();
    expect((await api.call("POST", "/api/profile/items", { body: { section: "salary", value: { text: "1" } } })).status).toBe(400);
    expect((await api.call("POST", "/api/profile/items", { body: { section: "email", value: { text: "nope" } } })).status).toBe(400);
    expect((await api.call("POST", "/api/profile/items", { body: { section: "skill", value: { text: "PMO" }, status: "confirmed" } })).status).toBe(400);
    await expect(env.DB.prepare("INSERT INTO profile_items (id, section, value, status, source, created_at, updated_at) VALUES ('x', 'salary', '{}', 'confirmed', 'manual', 'n', 'n')").run()).rejects.toThrow(/invalid profile section/);
  });

  it("edits, deletes and 404s", async () => {
    const api = await session();
    const created = await api.call<{ item: ItemDto }>("POST", "/api/profile/items", { body: { section: "approved_location", value: { text: "Riyadh" } } });
    const id = created.body.item.id;
    const patched = await api.call<{ item: ItemDto }>("PATCH", `/api/profile/items/${id}`, { body: { value: { text: "Jeddah" } } });
    expect(patched.body.item).toMatchObject({ value: { text: "Jeddah" }, userEdited: true, status: "confirmed" });
    expect((await api.call("DELETE", `/api/profile/items/${id}`)).status).toBe(200);
    expect((await api.call("DELETE", `/api/profile/items/${id}`)).status).toBe(404);
    expect((await api.call("POST", "/api/profile/items/00000000-0000-4000-8000-000000000000/confirm")).status).toBe(404);
  });

  it("rejects every remaining proposal from a CV and marks its review complete", async () => {
    const { api, versionId } = await withProposals();
    const result = await api.call<{ rejected: number; version: { review: { status: string } } }>("POST", `/api/cv/versions/${versionId}/proposals/reject`);
    expect(result.body.rejected).toBeGreaterThan(10);
    expect(result.body.version.review.status).toBe("reviewed");
    expect((await listProfileItems(api)).items.every((entry) => entry.status === "rejected")).toBe(true);
  });
});

describe("confirm all remaining proposals from a CV", () => {
  type ConfirmAll = { confirmed: number; skipped: { wouldReplace: number; duplicate: number; needsEdit: number }; version: { review: { status: string } } };
  const confirmAll = (api: Awaited<ReturnType<typeof session>>, versionId: string) =>
    api.call<ConfirmAll>("POST", `/api/cv/versions/${versionId}/proposals/confirm`);

  it("confirms every proposal as it is, fills the profile and marks the review complete", async () => {
    const { api, versionId, items } = await withProposals();
    const result = await confirmAll(api, versionId);
    expect(result.status).toBe(200);
    expect(result.body.confirmed).toBe(items.length);
    expect(result.body.skipped).toEqual({ wouldReplace: 0, duplicate: 0, needsEdit: 0 });
    expect(result.body.version.review.status).toBe("reviewed");
    const after = await listProfileItems(api);
    expect(after.items.every((entry) => entry.status === "confirmed" && !entry.userEdited)).toBe(true);
    expect(after.items.map((entry) => entry.value)).toEqual(items.map((entry) => entry.value));
    expect(after.missing).not.toContain("experience");
  });

  it("never replaces or duplicates a confirmed fact, and leaves those proposals for one-by-one review", async () => {
    // Facts confirmed by hand after the upload: proposals made before them still carry the same
    // section (name) or the same value (skill "ITIL").
    const { api, versionId } = await withProposals();
    await api.call("POST", "/api/profile/items", { body: { section: "name", value: { text: "Manual Synthetic Name" } } });
    await api.call("POST", "/api/profile/items", { body: { section: "skill", value: { text: "ITIL" } } });

    const result = await confirmAll(api, versionId);
    expect(result.body.skipped).toMatchObject({ wouldReplace: 1, duplicate: 1 });
    expect(result.body.version.review.status).toBe("in_review");
    const after = (await listProfileItems(api)).items;
    expect(after.filter((entry) => entry.section === "name" && entry.status === "confirmed").map((entry) => entry.value)).toEqual([{ text: "Manual Synthetic Name" }]);
    expect(after.filter((entry) => entry.status === "proposed").map((entry) => entry.section).sort()).toEqual(["name", "skill"]);
    expect(after.some((entry) => entry.status === "superseded")).toBe(false);
  });

  it("leaves a value that fails validation for the user to edit", async () => {
    const { api, versionId } = await withProposals();
    await insertItemStatement(env.DB, { section: "link", value: { text: "example.test/no-scheme" }, status: "proposed", source: "cv_extraction", sourceCvVersionId: versionId }, new Date().toISOString()).run();
    const result = await confirmAll(api, versionId);
    expect(result.body.skipped.needsEdit).toBe(1);
    const left = (await listProfileItems(api)).items.filter((entry) => entry.status === "proposed");
    expect(left.map((entry) => entry.value)).toEqual([{ text: "example.test/no-scheme" }]);
  });

  it("confirms only this CV's proposals, is idempotent, and refuses a deleted or unknown CV", async () => {
    const { api, versionId } = await withProposals();
    const other = await uploadCv(api, syntheticPdf(16), "Second synthetic CV.pdf");
    expect((await confirmAll(api, versionId)).body.confirmed).toBeGreaterThan(10);
    expect((await confirmAll(api, versionId)).body.confirmed).toBe(0);
    const items = (await listProfileItems(api)).items;
    expect(items.filter((entry) => entry.status === "confirmed").every((entry) => entry.source.cvVersionId === versionId)).toBe(true);
    expect((await api.call("POST", "/api/cv/versions/00000000-0000-4000-8000-000000000000/proposals/confirm")).status).toBe(404);
    await api.call("DELETE", `/api/cv/versions/${other.body.version.id}`, { body: { confirm: "DELETE" } });
    expect((await confirmAll(api, other.body.version.id)).status).toBe(410);
  });
});

describe("the Phase 1 profile is preserved", () => {
  it("keeps GET/PUT /api/profile unchanged and snapshots the previous value before each overwrite", async () => {
    const api = await session();
    await saveLegacyProfileOnly(api);
    const first = await env.DB.prepare("SELECT data FROM profile WHERE id = 1").first<{ data: string }>();
    await saveLegacyProfileOnly(api, { ...SYNTHETIC_PROFILE, headline: "Changed headline" });
    const read = await api.call<{ profile: typeof SYNTHETIC_PROFILE }>("GET", "/api/profile");
    expect(read.body.profile.headline).toBe("Changed headline");
    const snapshots = await env.DB.prepare("SELECT reason, data FROM profile_snapshots").all<{ reason: string; data: string }>();
    expect(snapshots.results).toEqual([{ reason: "before_legacy_edit", data: first!.data }]);
    await expect(env.DB.prepare("UPDATE profile_snapshots SET data = 'x'").run()).rejects.toThrow(/immutable/);
  });

  it("proposes Phase 1 fields verbatim, never confirms them and does not duplicate on repeat", async () => {
    const api = await session();
    await saveLegacyProfileOnly(api);
    const first = await api.call<{ proposalsCreated: number; snapshotId: string }>("POST", "/api/profile/legacy/proposals");
    expect(first.body.proposalsCreated).toBe(8);
    const items = (await listProfileItems(api)).items;
    expect(items.every((entry) => entry.status === "proposed" && entry.source.type === "legacy_profile")).toBe(true);
    expect(item(items, "skills_text").value).toEqual({ text: SYNTHETIC_PROFILE.skills });
    expect(item(items, "experience_text").value).toEqual({ text: SYNTHETIC_PROFILE.experience });
    expect(item(items, "location_text").source).toMatchObject({ field: "location", snapshotId: first.body.snapshotId });
    expect(items.some((entry) => entry.section === "approved_location")).toBe(false);
    const again = await api.call<{ proposalsCreated: number }>("POST", "/api/profile/legacy/proposals");
    expect(again.body.proposalsCreated).toBe(0);
    const legacy = await api.call<{ profile: typeof SYNTHETIC_PROFILE }>("GET", "/api/profile");
    expect(legacy.body.profile).toEqual(SYNTHETIC_PROFILE);
  });

  it("returns 404 when there is no Phase 1 profile", async () => {
    const api = await session();
    expect((await api.call("POST", "/api/profile/legacy/proposals")).status).toBe(404);
  });
});

describe("export and delete", () => {
  it("exports profile items, snapshots, the Phase 1 profile, CV metadata and text, without storage keys", async () => {
    const { api, versionId } = await withProposals();
    await saveLegacyProfileOnly(api);
    const exported = await api.call<Record<string, unknown>>("GET", "/api/profile/export");
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toMatch(/^attachment; filename="career-ai-profile-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = exported.body as {
      format: string;
      legacyProfile: { data: string };
      profileItems: unknown[];
      cvVersions: { id: string; extractedText: string; file: { sha256: string } }[];
      uploadedFiles: unknown[];
    };
    expect(body.format).toBe("nisco-career-ai-profile-export");
    expect(JSON.parse(body.legacyProfile.data)).toEqual(SYNTHETIC_PROFILE);
    expect(body.profileItems.length).toBeGreaterThan(10);
    expect(body.cvVersions[0]).toMatchObject({ id: versionId, extractedText: expect.stringContaining("Alex Synthetic") });
    expect(body.cvVersions[0]?.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.uploadedFiles).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("private/");
  });

  it("deletes all structured items only with typed confirmation and keeps the Phase 1 profile", async () => {
    const { api } = await withProposals();
    await saveLegacyProfileOnly(api);
    expect((await api.call("DELETE", "/api/profile/items", { body: { confirm: "yes" } })).status).toBe(400);
    const deleted = await api.call<{ deleted: number; keptLegacyProfile: boolean }>("DELETE", "/api/profile/items", { body: { confirm: "DELETE PROFILE DATA" } });
    expect(deleted.status).toBe(200);
    expect(deleted.body.keptLegacyProfile).toBe(true);
    expect((await listProfileItems(api)).items).toEqual([]);
    expect((await api.call<{ profile: unknown }>("GET", "/api/profile")).body.profile).toEqual(SYNTHETIC_PROFILE);
  });
});
