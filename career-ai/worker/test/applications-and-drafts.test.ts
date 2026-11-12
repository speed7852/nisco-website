import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createJob, saveProfile, session } from "./helpers";

type AppBody = { id: string; application: { id: string; status: string; notes: string } };

async function trackedApplication(status = "applied", notes = "Applied on the employer portal") {
  const api = await session();
  const jobId = await createJob(api);
  const created = await api.call<AppBody>("POST", "/api/applications", { body: { jobId, status, notes } });
  expect(created.status).toBe(201);
  return { api, jobId, id: created.body.id };
}

const stored = (id: string) => env.DB.prepare("SELECT status, notes FROM applications WHERE id = ?").bind(id).first<{ status: string; notes: string }>();

describe("application tracker (audit P14-P18)", () => {
  it("returns 404 for an unknown job and 400 for a malformed job ID (P14)", async () => {
    const api = await session();
    expect((await api.call("POST", "/api/applications", { body: { jobId: "00000000-0000-4000-8000-000000000000" } })).status).toBe(404);
    expect((await api.call("POST", "/api/applications", { body: { jobId: "does-not-exist" } })).status).toBe(400);
    expect((await api.call("POST", "/api/applications", { body: {} })).status).toBe(400);
  });

  it("refuses a second application for the same job with 409 (P15)", async () => {
    const { api, jobId, id } = await trackedApplication();
    const again = await api.call("POST", "/api/applications", { body: { jobId } });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: "duplicate_application", existingId: id });
  });

  it("returns 404 when updating an unknown application (P16)", async () => {
    const api = await session();
    expect((await api.call("PATCH", "/api/applications/00000000-0000-4000-8000-000000000000", { body: { status: "offer" } })).status).toBe(404);
    expect((await api.call("PATCH", "/api/applications/nope", { body: { status: "offer" } })).status).toBe(400);
  });

  it("keeps the status on a notes-only update (P17)", async () => {
    const { api, id } = await trackedApplication("applied");
    const result = await api.call<AppBody>("PATCH", `/api/applications/${id}`, { body: { notes: "Follow up on Monday" } });
    expect(result.status).toBe(200);
    expect(await stored(id)).toEqual({ status: "applied", notes: "Follow up on Monday" });
  });

  it("keeps the notes on a status-only update, including through PUT", async () => {
    const { api, id } = await trackedApplication("applied", "Original notes");
    await api.call("PUT", `/api/applications/${id}`, { body: { status: "interview" } });
    expect(await stored(id)).toEqual({ status: "interview", notes: "Original notes" });
  });

  it("rejects a status outside the allow-list (P18)", async () => {
    const { api, id } = await trackedApplication();
    const result = await api.call<{ fields: Record<string, string> }>("PATCH", `/api/applications/${id}`, { body: { status: "totally-made-up" } });
    expect(result.status).toBe(400);
    expect(result.body.fields.status).toMatch(/Must be one of/);
    expect((await stored(id))?.status).toBe("applied");
  });

  it("refuses 'submitted' because no approval record exists yet", async () => {
    const { api, id, jobId } = await trackedApplication("prepared");
    const update = await api.call("PATCH", `/api/applications/${id}`, { body: { status: "submitted" } });
    expect(update.status).toBe(409);
    expect(update.body.error).toBe("approval_required");
    await env.DB.prepare("DELETE FROM applications").run();
    const create = await api.call("POST", "/api/applications", { body: { jobId, status: "submitted" } });
    expect(create.status).toBe(409);
  });

  it("enforces the status allow-list in the database too", async () => {
    const { id } = await trackedApplication();
    await expect(env.DB.prepare("UPDATE applications SET status = 'submitted' WHERE id = ?").bind(id).run()).rejects.toThrow(/invalid application status/);
  });

  it("rejects an empty update and unknown fields", async () => {
    const { api, id } = await trackedApplication();
    expect((await api.call("PATCH", `/api/applications/${id}`, { body: {} })).status).toBe(400);
    expect((await api.call("PATCH", `/api/applications/${id}`, { body: { status: "offer", jobId: "x" } })).status).toBe(400);
  });

  it("lists active applications with their job", async () => {
    const { api } = await trackedApplication();
    const list = await api.call<{ applications: { job: { title: string } }[] }>("GET", "/api/applications");
    expect(list.body.applications).toHaveLength(1);
    expect(list.body.applications[0]?.job.title).toBe("Programme Manager");
  });
});

describe("drafts use the saved profile only (audit P24)", () => {
  it("builds the prompt from the saved profile and refuses profile data in the request", async () => {
    const api = await session();
    await saveProfile(api);
    const jobId = await createJob(api);

    const injected = await api.call("POST", "/api/ai/draft", {
      body: { jobId, task: "cover_letter", profile: { experience: "Invented: 20 years at a famous company" } },
    });
    expect(injected.status).toBe(400);

    api.ai.respond({ response: "Dear hiring team, ... [TO CONFIRM: PMP]" });
    const result = await api.call<{ draft: string; approvalRequired: boolean; profileUpdatedAt: string }>("POST", "/api/ai/draft", {
      body: { jobId, task: "cover_letter" },
    });
    expect(result.status).toBe(200);
    expect(result.body.approvalRequired).toBe(true);
    expect(result.body.profileUpdatedAt).toBeTruthy();
    const prompt = api.ai.prompt();
    expect(prompt).toContain("Synthetic summary used only in automated tests.");
    expect(prompt).not.toContain("Invented");
    expect(prompt).toContain("<<<JOB_POSTING_START>>>");
  });

  it("requires a saved profile, a known job and a valid task", async () => {
    const api = await session();
    const jobId = await createJob(api);
    expect((await api.call("POST", "/api/ai/draft", { body: { jobId, task: "cover_letter" } })).status).toBe(409);
    await saveProfile(api);
    expect((await api.call("POST", "/api/ai/draft", { body: { jobId, task: "anything" } })).status).toBe(400);
    expect((await api.call("POST", "/api/ai/draft", { body: { jobId: "00000000-0000-4000-8000-000000000000", task: "cover_letter" } })).status).toBe(404);
    expect(api.ai.calls).toHaveLength(0);
  });

  it("returns 502 when the AI service fails", async () => {
    const api = await session();
    await saveProfile(api);
    const jobId = await createJob(api);
    api.ai.respond(new Error("upstream"));
    const result = await api.call("POST", "/api/ai/draft", { body: { jobId, task: "recruiter_message" } });
    expect(result.status).toBe(502);
    expect(result.body.error).toBe("ai_unavailable");
  });
});
