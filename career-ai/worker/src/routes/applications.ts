import {
  findActiveApplicationIdForJob,
  getActiveApplication,
  insertApplication,
  listActiveApplications,
  toApplicationDto,
  updateApplication,
} from "../db/applications";
import { getJob } from "../db/jobs";
import { APPLICATION_STATUSES, APPROVAL_GATED_STATUSES, MAX_NOTES_LENGTH, type ApplicationStatus } from "../domain/applications";
import { readJson } from "../http/body";
import { badRequest, conflict, HttpError, notFound } from "../http/errors";
import { json } from "../http/responses";
import type { RequestContext } from "../http/router";
import {
  FieldErrors,
  isUuid,
  readEnum,
  readString,
  rejectUnknownKeys,
  requireIdParam,
  requireObject,
  type JsonObject,
} from "../http/validation";

/** "submitted" needs an approval record, which does not exist until a later phase. Refuse it explicitly. */
function refuseApprovalGatedStatus(body: JsonObject): void {
  if ((APPROVAL_GATED_STATUSES as readonly unknown[]).includes(body.status)) {
    throw new HttpError(
      409,
      "approval_required",
      "\"submitted\" can only be recorded against an approval of specific documents, which is not available yet. If you applied yourself, use \"applied\".",
    );
  }
}

export async function listApplicationsRoute({ env }: RequestContext): Promise<Response> {
  const rows = await listActiveApplications(env.DB);
  return json({ applications: rows.map(toApplicationDto) });
}

export async function createApplication({ request, env }: RequestContext): Promise<Response> {
  const body = requireObject(await readJson(request));
  refuseApprovalGatedStatus(body);
  const errors = new FieldErrors();
  rejectUnknownKeys(body, ["jobId", "status", "notes"], errors);
  if (!isUuid(body.jobId)) errors.add("jobId", "A valid job ID is required.");
  const status = readEnum(body, "status", APPLICATION_STATUSES, errors) ?? "prepared";
  const notes = readString(body, "notes", { max: MAX_NOTES_LENGTH }, errors) ?? "";
  errors.throwIfAny("Some application fields are invalid.");
  const jobId = (body.jobId as string).toLowerCase();

  if (!(await getJob(env.DB, jobId))) throw notFound("Job");
  const existingId = await findActiveApplicationIdForJob(env.DB, jobId);
  if (existingId) throw conflict("duplicate_application", "This job is already in your tracker.", { existingId });

  const id = crypto.randomUUID();
  try {
    await insertApplication(env.DB, { id, jobId, status, notes, now: new Date().toISOString() });
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      throw conflict("duplicate_application", "This job is already in your tracker.", {
        existingId: await findActiveApplicationIdForJob(env.DB, jobId),
      });
    }
    throw error;
  }
  const saved = await getActiveApplication(env.DB, id);
  return json({ ok: true, id, application: saved ? toApplicationDto(saved) : null }, 201);
}

/** PATCH (or PUT) /api/applications/:id: partial update. Omitted fields keep their stored values. */
export async function updateApplicationRoute({ request, env, params }: RequestContext): Promise<Response> {
  const id = requireIdParam(params.id);
  const body = requireObject(await readJson(request));
  refuseApprovalGatedStatus(body);
  const errors = new FieldErrors();
  rejectUnknownKeys(body, ["status", "notes"], errors);
  const status: ApplicationStatus | undefined = readEnum(body, "status", APPLICATION_STATUSES, errors);
  const notes = readString(body, "notes", { max: MAX_NOTES_LENGTH }, errors);
  errors.throwIfAny("Some application fields are invalid.");
  if (status === undefined && notes === undefined) throw badRequest("Send a status, notes, or both.");

  if (!(await getActiveApplication(env.DB, id))) throw notFound("Application");
  const changes: { status?: ApplicationStatus; notes?: string } = {};
  if (status !== undefined) changes.status = status;
  if (notes !== undefined) changes.notes = notes;
  const updated = await updateApplication(env.DB, id, changes, new Date().toISOString());
  if (!updated) throw notFound("Application");
  const saved = await getActiveApplication(env.DB, id);
  return json({ ok: true, application: saved ? toApplicationDto(saved) : null });
}
