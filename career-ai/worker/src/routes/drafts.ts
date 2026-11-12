import { AiCallError, extractModelOutput, runChat } from "../ai/client";
import { buildDraftMessages, DRAFT_TASKS, type DraftTask } from "../ai/prompts";
import { DRAFT_PROMPT_VERSION } from "../config";
import { getJob } from "../db/jobs";
import { getProfile } from "../db/profile";
import { profileHasFacts } from "../domain/profile";
import { readJson } from "../http/body";
import { conflict, HttpError, notFound } from "../http/errors";
import { json } from "../http/responses";
import type { RequestContext } from "../http/router";
import { FieldErrors, isUuid, readEnum, rejectUnknownKeys, requireObject } from "../http/validation";

const TASKS = Object.keys(DRAFT_TASKS) as DraftTask[];

/**
 * POST /api/ai/draft: drafts text for one saved job from the SAVED profile only. Anything in the
 * browser form that has not been saved is ignored. Drafts are returned for review and not stored
 * (versioned documents arrive in a later phase). Nothing is sent to an employer.
 */
export async function createDraft({ request, env }: RequestContext): Promise<Response> {
  const body = requireObject(await readJson(request));
  const errors = new FieldErrors();
  rejectUnknownKeys(body, ["jobId", "task"], errors);
  if (!isUuid(body.jobId)) errors.add("jobId", "A valid job ID is required.");
  const task = readEnum(body, "task", TASKS, errors, true);
  errors.throwIfAny("Some draft fields are invalid.");

  const job = await getJob(env.DB, (body.jobId as string).toLowerCase());
  if (!job) throw notFound("Job");
  const stored = await getProfile(env.DB);
  if (!stored || !profileHasFacts(stored.profile)) {
    throw conflict("profile_required", "Save your career profile before drafting. Drafts use only saved facts.");
  }

  let output: unknown;
  try {
    output = extractModelOutput(
      await runChat(env.AI, buildDraftMessages(task as DraftTask, stored.profile, job), { maxTokens: 900, temperature: 0.3 }),
    );
  } catch (error) {
    if (error instanceof AiCallError) {
      throw new HttpError(502, "ai_unavailable", "The AI service did not respond. Try again in a minute.");
    }
    throw error;
  }
  const draft = typeof output === "string" ? output.trim() : output === undefined ? "" : JSON.stringify(output, null, 2);
  if (draft === "") throw new HttpError(502, "ai_empty_response", "The AI service returned an empty draft. Try again.");

  return json({
    draft,
    task,
    jobId: job.id,
    profileUpdatedAt: stored.updatedAt,
    promptVersion: DRAFT_PROMPT_VERSION,
    approvalRequired: true,
  });
}
