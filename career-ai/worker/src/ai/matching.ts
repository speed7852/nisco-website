import { AI_MODEL, MATCH_PROMPT_VERSION } from "../config";
import type { Env } from "../env";
import type { CareerProfile } from "../domain/profile";
import { getJob, isShortlisted, recordAssessment, recordAssessmentFailure, type JobRow } from "../db/jobs";
import { AiCallError, extractModelOutput, runChat } from "./client";
import { parseMatchAssessment, type MatchAssessment } from "./parse";
import { buildMatchMessages } from "./prompts";

export type MatchOutcome =
  | { status: "scored"; assessment: MatchAssessment; clamped: boolean; shortlisted: boolean; job: JobRow }
  | { status: "needs_review"; reason: string; shortlisted: boolean; job: JobRow };

/**
 * Assesses one job against the saved profile and records the result.
 *
 * On success the score (clamped to 0-100), matched skills, gaps and rationale are stored.
 * On a timeout, inference error or invalid response, the job is marked "needs_review" and its
 * previous score is kept: a failed parse never becomes a score of 0.
 */
export async function assessJob(env: Env, job: JobRow, profile: CareerProfile, now = new Date()): Promise<MatchOutcome> {
  const timestamp = now.toISOString();
  let reason: string;
  try {
    const output = extractModelOutput(
      await runChat(env.AI, buildMatchMessages(profile, job), { maxTokens: 600, temperature: 0.1 }),
    );
    const parsed = parseMatchAssessment(output);
    if (parsed.ok) {
      await recordAssessment(env.DB, job.id, parsed.assessment, { model: AI_MODEL, promptVersion: MATCH_PROMPT_VERSION, now: timestamp });
      const updated = (await getJob(env.DB, job.id)) ?? job;
      return { status: "scored", assessment: parsed.assessment, clamped: parsed.clamped, shortlisted: isShortlisted(updated), job: updated };
    }
    reason = `invalid_model_output:${parsed.reason}`;
  } catch (error) {
    if (!(error instanceof AiCallError)) throw error;
    reason = error.reason;
  }
  await recordAssessmentFailure(env.DB, job.id, reason, timestamp);
  const updated = (await getJob(env.DB, job.id)) ?? job;
  console.warn(JSON.stringify({ event: "match_needs_review", jobId: job.id, reason }));
  return { status: "needs_review", reason, shortlisted: isShortlisted(updated), job: updated };
}
