import { getProfile, saveProfile } from "../db/profile";
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
  await saveProfile(env.DB, profile, now);
  return json({ ok: true, profile, updatedAt: now });
}
