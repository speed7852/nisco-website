import { listCvVersions, reviewStatus, setReviewStatus, toCvVersionDto } from "../db/cv-versions";
import { listDocuments, toDocumentDto } from "../db/documents";
import {
  countsByCv,
  deleteAllItems,
  deleteItem,
  findConfirmedInSection,
  getItem,
  insertItem,
  listItems,
  parseValue,
  setStatusStatement,
  toProfileItemDto,
  updateValueStatement,
  type ProfileItemRow,
} from "../db/profile-items";
import { getLegacyProfileRaw, insertSnapshot, listSnapshots } from "../db/profile-snapshots";
import { readJson, readOptionalJson } from "../http/body";
import { badRequest, conflict, HttpError, notFound } from "../http/errors";
import { json, SECURITY_HEADERS } from "../http/responses";
import type { RequestContext } from "../http/router";
import { FieldErrors, rejectUnknownKeys, requireIdParam, requireObject } from "../http/validation";
import { legacyFieldValues } from "../profile/legacy";
import { insertProposalsDeduplicated, sectionStates } from "../profile/proposals";
import { comparableValue, isSingleValue, PROFILE_SECTIONS, requireSection, SECTION_SPECS, validateItemValue, type ItemValue } from "../profile/schema";

/**
 * The structured candidate profile. Facts become confirmed only through an explicit request from
 * the user: adding a fact manually, confirming a proposal, or "Confirm all" for one CV
 * (`confirmRemainingProposals` in routes/cv.ts, which never replaces a confirmed fact). A single-value section never has its
 * confirmed value replaced without `replaceConfirmed: true`.
 */

const DELETE_ALL_CONFIRMATION = "DELETE PROFILE DATA";

async function refreshReview(db: D1Database, cvVersionId: string | null, now: string): Promise<void> {
  if (!cvVersionId) return;
  const [versions, counts] = await Promise.all([listCvVersions(db, false), countsByCv(db)]);
  const version = versions.find((row) => row.id === cvVersionId);
  if (version) await setReviewStatus(db, version.id, reviewStatus(version, counts.get(version.id)), now);
}

async function requireItem(db: D1Database, id: string | undefined): Promise<ProfileItemRow> {
  const row = await getItem(db, requireIdParam(id));
  if (!row) throw notFound("Profile item");
  return row;
}

/** Rejects a value that would duplicate a confirmed fact in the same multi-value section. */
async function assertNotDuplicateConfirmed(db: D1Database, row: { section: ProfileItemRow["section"]; id?: string }, value: ItemValue): Promise<void> {
  if (isSingleValue(row.section)) return;
  const key = comparableValue(value);
  const existing = (await findConfirmedInSection(db, row.section)).find((other) => other.id !== row.id && comparableValue(parseValue(other)) === key);
  if (existing) throw conflict("already_confirmed", "The same value is already confirmed in this section.", { existingId: existing.id });
}

/** GET /api/profile/items: every item, section definitions and what is still missing. */
export async function listProfileItems({ env }: RequestContext): Promise<Response> {
  const rows = await listItems(env.DB);
  const states = sectionStates(rows, PROFILE_SECTIONS);
  return json({
    sections: PROFILE_SECTIONS.map((section) => ({ ...SECTION_SPECS[section], state: states[section] })),
    items: rows.map(toProfileItemDto),
    missing: PROFILE_SECTIONS.filter((section) => SECTION_SPECS[section].expected && states[section] === "missing"),
  });
}

function readReplaceFlag(body: Record<string, unknown>, errors: FieldErrors): boolean {
  const value = body.replaceConfirmed;
  if (value === undefined) return false;
  if (typeof value !== "boolean") errors.add("replaceConfirmed", "Must be true or false.");
  return value === true;
}

/** Statements that move the current confirmed value of a single-value section to superseded. */
async function supersedeStatements(db: D1Database, row: { section: ProfileItemRow["section"]; id?: string }, replace: boolean, now: string) {
  if (!isSingleValue(row.section)) return [];
  const current = (await findConfirmedInSection(db, row.section)).filter((other) => other.id !== row.id);
  if (current.length === 0) return [];
  if (!replace) {
    throw conflict("confirmed_value_exists", `${SECTION_SPECS[row.section].label} already has a confirmed value. Replace it explicitly to continue.`, {
      existing: toProfileItemDto(current[0]!),
    });
  }
  return current.map((other) => setStatusStatement(db, other.id, "superseded", now));
}

/** POST /api/profile/items: adds a fact entered by the user (confirmed, source "manual"). */
export async function createProfileItem({ request, env }: RequestContext): Promise<Response> {
  const body = requireObject(await readJson(request));
  const errors = new FieldErrors();
  rejectUnknownKeys(body, ["section", "value", "replaceConfirmed"], errors);
  const replace = readReplaceFlag(body, errors);
  errors.throwIfAny();
  const section = requireSection(body.section);
  const value = validateItemValue(section, body.value);
  const now = new Date().toISOString();
  await assertNotDuplicateConfirmed(env.DB, { section }, value);
  const supersede = await supersedeStatements(env.DB, { section }, replace, now);
  if (supersede.length > 0) await env.DB.batch(supersede);
  const id = await insertItem(env.DB, { section, value, status: "confirmed", source: "manual" }, now);
  const row = await getItem(env.DB, id);
  return json({ ok: true, item: row ? toProfileItemDto(row) : null }, 201);
}

/** PATCH /api/profile/items/:id: edits the value of a proposed or confirmed item. */
export async function updateProfileItem({ request, env, params }: RequestContext): Promise<Response> {
  const row = await requireItem(env.DB, params.id);
  if (row.status !== "proposed" && row.status !== "confirmed") {
    throw conflict("not_editable", "Only proposed or confirmed items can be edited.");
  }
  const body = requireObject(await readJson(request));
  const errors = new FieldErrors();
  rejectUnknownKeys(body, ["value"], errors);
  errors.throwIfAny();
  const value = validateItemValue(row.section, body.value);
  if (row.status === "confirmed") await assertNotDuplicateConfirmed(env.DB, row, value);
  await updateValueStatement(env.DB, row.id, value, new Date().toISOString()).run();
  return json({ ok: true, item: toProfileItemDto((await getItem(env.DB, row.id))!) });
}

/**
 * POST /api/profile/items/:id/confirm: { value?, replaceConfirmed? }.
 * Confirms a proposed (or previously rejected) item, optionally with an edited value.
 */
export async function confirmProfileItem({ request, env, params }: RequestContext): Promise<Response> {
  const row = await requireItem(env.DB, params.id);
  if (row.status !== "proposed" && row.status !== "rejected") throw conflict("not_confirmable", "Only proposed or rejected items can be confirmed.");
  const body = requireObject(await readOptionalJson(request));
  const errors = new FieldErrors();
  rejectUnknownKeys(body, ["value", "replaceConfirmed"], errors);
  const replace = readReplaceFlag(body, errors);
  errors.throwIfAny();
  const edited = body.value !== undefined;
  let value: ItemValue;
  try {
    value = validateItemValue(row.section, edited ? body.value : parseValue(row));
  } catch (error) {
    if (!edited && error instanceof HttpError) {
      throw new HttpError(400, "edit_before_confirming", "This value does not pass validation. Edit it before confirming.", error.fields);
    }
    throw error;
  }
  const now = new Date().toISOString();
  await assertNotDuplicateConfirmed(env.DB, row, value);
  const supersede = await supersedeStatements(env.DB, row, replace, now);
  await env.DB.batch([
    ...supersede,
    ...(edited ? [updateValueStatement(env.DB, row.id, value, now)] : []),
    setStatusStatement(env.DB, row.id, "confirmed", now),
  ]);
  await refreshReview(env.DB, row.source_cv_version_id, now);
  return json({ ok: true, item: toProfileItemDto((await getItem(env.DB, row.id))!), superseded: supersede.length });
}

/** POST /api/profile/items/:id/reject: declines a proposal. */
export async function rejectProfileItem({ env, params }: RequestContext): Promise<Response> {
  const row = await requireItem(env.DB, params.id);
  if (row.status !== "proposed") throw conflict("not_rejectable", "Only proposed items can be rejected.");
  const now = new Date().toISOString();
  await setStatusStatement(env.DB, row.id, "rejected", now).run();
  await refreshReview(env.DB, row.source_cv_version_id, now);
  return json({ ok: true, item: toProfileItemDto((await getItem(env.DB, row.id))!) });
}

/** DELETE /api/profile/items/:id: removes one item. */
export async function deleteProfileItem({ env, params }: RequestContext): Promise<Response> {
  const row = await requireItem(env.DB, params.id);
  await deleteItem(env.DB, row.id);
  await refreshReview(env.DB, row.source_cv_version_id, new Date().toISOString());
  return json({ ok: true, deleted: row.id });
}

/** DELETE /api/profile/items with { "confirm": "DELETE PROFILE DATA" }: removes every structured item. */
export async function deleteAllProfileItems({ request, env }: RequestContext): Promise<Response> {
  const body = requireObject(await readJson(request, 1024));
  if (body.confirm !== DELETE_ALL_CONFIRMATION) {
    throw badRequest(`To delete all structured profile data, send { "confirm": "${DELETE_ALL_CONFIRMATION}" }.`, {
      confirm: `Type ${DELETE_ALL_CONFIRMATION} to confirm.`,
    });
  }
  const deleted = await deleteAllItems(env.DB);
  const now = new Date().toISOString();
  for (const version of await listCvVersions(env.DB, false)) await setReviewStatus(env.DB, version.id, reviewStatus(version), now);
  return json({ ok: true, deleted, keptLegacyProfile: true });
}

/**
 * POST /api/profile/legacy/proposals: proposes the current Phase 1 profile fields, verbatim, for
 * review. Takes an immutable snapshot first. Never confirms or overwrites anything.
 */
export async function proposeFromLegacyProfile({ env }: RequestContext): Promise<Response> {
  const legacy = await getLegacyProfileRaw(env.DB);
  if (!legacy) throw notFound("Phase 1 profile");
  const now = new Date().toISOString();
  const snapshotId = await insertSnapshot(env.DB, { reason: "legacy_proposals", data: legacy.data, originalUpdatedAt: legacy.updated_at, now });
  const values = legacyFieldValues(legacy.data);
  const created = await insertProposalsDeduplicated(
    env.DB,
    values.map((entry) => ({
      section: entry.section,
      value: { text: entry.text },
      status: "proposed",
      source: "legacy_profile",
      sourceSnapshotId: snapshotId,
      sourceField: entry.field,
      position: entry.position,
    })),
    { now },
  );
  return json({ ok: true, snapshotId, fields: values.length, proposalsCreated: created });
}

/** GET /api/profile/export: everything Career AI holds about the profile and CVs, as JSON. */
export async function exportProfile({ env }: RequestContext): Promise<Response> {
  const [legacy, snapshots, items, versions, counts, documents] = await Promise.all([
    getLegacyProfileRaw(env.DB),
    listSnapshots(env.DB),
    listItems(env.DB),
    listCvVersions(env.DB, true),
    countsByCv(env.DB),
    listDocuments(env.DB),
  ]);
  const cvVersions = [];
  for (const row of versions) {
    let extractedText: string | null = null;
    if (row.extracted_text_key) extractedText = (await (await env.PRIVATE_FILES.get(row.extracted_text_key))?.text()) ?? null;
    cvVersions.push({ ...toCvVersionDto(row, counts.get(row.id)), extractedText });
  }
  const exportedAt = new Date().toISOString();
  const body = {
    format: "nisco-career-ai-profile-export",
    formatVersion: 1,
    exportedAt,
    note: "Personal data. Original CV files are not embedded; download them from Career AI. Storage keys are not included.",
    legacyProfile: legacy ? { data: legacy.data, updatedAt: legacy.updated_at } : null,
    snapshots: snapshots.map((row) => ({ id: row.id, reason: row.reason, data: row.data, originalUpdatedAt: row.original_updated_at, createdAt: row.created_at })),
    profileItems: items.map(toProfileItemDto),
    cvVersions,
    uploadedFiles: documents.map(toDocumentDto),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="career-ai-profile-export-${exportedAt.slice(0, 10)}.json"`,
    },
  });
}
