import { describe, expect, it } from "vitest";
import { DISCOVERY_LIMITS } from "../src/config";
import { arbeitnow, remoteOk } from "../src/discovery/feeds";
import { runDiscovery } from "../src/discovery/run";
import { aiJson, createJob, listProfileItems, saveLegacyProfileOnly, session, submitExtraction, uploadCv } from "./helpers";

/** Matching, drafts and discovery must use only facts the user has explicitly confirmed. */
describe("only confirmed facts reach the AI", () => {
  it("does not assess or draft from the unconfirmed Phase 1 profile", async () => {
    const api = await session();
    await saveLegacyProfileOnly(api);
    const jobId = await createJob(api);
    expect((await api.call("POST", `/api/jobs/${jobId}/match`)).body.error).toBe("profile_required");
    expect((await api.call("POST", "/api/ai/draft", { body: { jobId, task: "cover_letter" } })).body.error).toBe("profile_required");
    expect(api.ai.calls).toHaveLength(0);
  });

  it("does not use unreviewed CV proposals, then uses facts once confirmed", async () => {
    const api = await session();
    const upload = await uploadCv(api);
    await submitExtraction(api, upload.body.version.id);
    const jobId = await createJob(api);
    expect((await api.call("POST", `/api/jobs/${jobId}/match`)).status).toBe(409);

    const items = (await listProfileItems(api)).items;
    const summary = items.find((entry) => entry.section === "summary")!;
    await api.call("POST", `/api/profile/items/${summary.id}/confirm`);
    api.ai.respond(aiJson({ score: 70 }));
    expect((await api.call("POST", `/api/jobs/${jobId}/match`)).status).toBe(200);
    const prompt = api.ai.prompt();
    expect(prompt).toContain("Synthetic summary for automated tests only.");
    // Proposed but unconfirmed facts are absent.
    expect(prompt).not.toContain("alex.synthetic@example.test");
    expect(prompt).not.toContain("Example Holdings");
    expect(prompt).not.toContain("PMP");
  });

  it("discovery skips scoring without confirmed facts and uses confirmed titles as search terms", async () => {
    const api = await session();
    await saveLegacyProfileOnly(api, { name: "", headline: "", years: null, location: "", summary: "s", skills: "", experience: "", roles: "Release Manager" });
    const feeds = (items: unknown[]) =>
      (async (input: RequestInfo | URL) =>
        new Response(JSON.stringify(String(input) === remoteOk.url ? [{ legal: "x" }, ...items] : { data: [] }))) as typeof fetch;
    const job = { position: "Release Manager", company: "Fictional", location: "Worldwide", url: "https://remoteok.com/remote-jobs/rm", description: "d" };
    const deps = { fetch: feeds([job]), now: () => new Date(), sources: [arbeitnow, remoteOk], limits: { ...DISCOVERY_LIMITS } };

    const unconfirmed = await runDiscovery(api.env, "0 3 * * *", deps);
    expect(unconfirmed.assessment.skippedReason).toBe("no_profile");
    expect(unconfirmed.inserted).toBe(0); // "Release Manager" is not a default term and is not confirmed

    await api.call("POST", "/api/profile/items", { body: { section: "preferred_title", value: { text: "Release Manager" } } });
    await api.call("POST", "/api/profile/items", { body: { section: "summary", value: { text: "Confirmed synthetic summary." } } });
    api.ai.respond(aiJson({ score: 60 }));
    const confirmed = await runDiscovery(api.env, "0 15 * * *", deps);
    expect(confirmed.inserted).toBe(1);
    expect(confirmed.assessment.attempted).toBe(1);
  });
});
