import { assessJob } from "../ai/matching";
import { findJobIdByCanonicalUrl, getJob, insertJob, listJobs, toJobDto } from "../db/jobs";
import { getProfile } from "../db/profile";
import { profileHasFacts } from "../domain/profile";
import { normaliseJobUrl } from "../domain/urls";
import { readJson } from "../http/body";
import { conflict, notFound } from "../http/errors";
import { json } from "../http/responses";
import type { RequestContext } from "../http/router";
import { FieldErrors, readString, rejectUnknownKeys, requireIdParam, requireObject } from "../http/validation";

export async function listJobsRoute({ env, url }: RequestContext): Promise<Response> {
  const shortlistedOnly = url.searchParams.get("shortlisted") === "true";
  const rows = await listJobs(env.DB, { shortlistedOnly, limit: 200 });
  return json({ jobs: rows.map(toJobDto) });
}

export async function getJobRoute({ env, params }: RequestContext): Promise<Response> {
  const job = await getJob(env.DB, requireIdParam(params.id));
  if (!job) throw notFound("Job");
  return json({ job: toJobDto(job) });
}

/** POST /api/jobs: saves a job found by the user. The link is optional but must be https. */
export async function createJob({ request, env }: RequestContext): Promise<Response> {
  const body = requireObject(await readJson(request));
  const errors = new FieldErrors();
  rejectUnknownKeys(body, ["title", "company", "location", "url", "description"], errors);
  const title = readString(body, "title", { max: 200, required: true }, errors);
  const company = readString(body, "company", { max: 200, required: true }, errors);
  const location = readString(body, "location", { max: 300 }, errors) ?? "";
  const rawUrl = readString(body, "url", { max: 2048 }, errors) ?? "";
  const description = readString(body, "description", { max: 20_000, required: true }, errors);

  let url = "";
  let canonicalUrl: string | null = null;
  if (rawUrl !== "") {
    const checked = normaliseJobUrl(rawUrl);
    if (checked.ok) {
      url = checked.url;
      canonicalUrl = checked.canonical;
    } else {
      errors.add("url", checked.reason);
    }
  }
  errors.throwIfAny("Some job fields are invalid.");

  if (canonicalUrl) {
    const existingId = await findJobIdByCanonicalUrl(env.DB, canonicalUrl);
    if (existingId) throw conflict("duplicate_job", "This job is already saved.", { existingId });
  }

  const id = crypto.randomUUID();
  try {
    await insertJob(env.DB, {
      id,
      title: title ?? "",
      company: company ?? "",
      location,
      url,
      canonicalUrl,
      description: description ?? "",
      source: "manual",
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    // Two saves of the same link at once: the unique index wins and the second becomes a 409.
    if (canonicalUrl && error instanceof Error && /UNIQUE/i.test(error.message)) {
      const existingId = await findJobIdByCanonicalUrl(env.DB, canonicalUrl);
      throw conflict("duplicate_job", "This job is already saved.", { existingId });
    }
    throw error;
  }
  const saved = await getJob(env.DB, id);
  return json({ ok: true, id, job: saved ? toJobDto(saved) : null }, 201);
}

/** POST /api/jobs/:id/match: assesses one job against the saved profile now. */
export async function matchJob({ env, params }: RequestContext): Promise<Response> {
  const job = await getJob(env.DB, requireIdParam(params.id));
  if (!job) throw notFound("Job");
  const stored = await getProfile(env.DB);
  if (!stored || !profileHasFacts(stored.profile)) {
    throw conflict("profile_required", "Save your career profile (headline, summary, skills or experience) before assessing jobs.");
  }
  const outcome = await assessJob(env, job, stored.profile);
  return json({
    status: outcome.status,
    shortlisted: outcome.shortlisted,
    reason: outcome.status === "needs_review" ? outcome.reason : undefined,
    clamped: outcome.status === "scored" ? outcome.clamped : undefined,
    job: toJobDto(outcome.job),
  });
}
