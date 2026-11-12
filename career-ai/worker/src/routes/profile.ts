import { getProfile, saveProfile } from "../db/profile";
import { getLegacyProfileRaw, insertSnapshot } from "../db/profile-snapshots";
import { validateProfile } from "../domain/profile";
import { readJson } from "../http/body";
import { json } from "../http/responses";
import type { RequestContext } from "../http/router";

export async function readProfile({ env }: RequestContext): Promise<Response> {
  const stored = await getProfile(env.DB);
  return json({ profile: stored?.profile ?? null, updatedAt: stored?.updatedAt ?? null });
}

export async function writeProfile({ request, env }: RequestContext): Promise<Response> {
  const profile = validateProfile(await readJson(request));
  const now = new Date().toISOString();
  // Keep a recoverable, immutable copy of the previous Phase 1 profile before overwriting it.
  const previous = await getLegacyProfileRaw(env.DB);
  if (previous) await insertSnapshot(env.DB, { reason: "before_legacy_edit", data: previous.data, originalUpdatedAt: previous.updated_at, now });
  await saveProfile(env.DB, profile, now);
  return json({ ok: true, profile, updatedAt: now });
}
