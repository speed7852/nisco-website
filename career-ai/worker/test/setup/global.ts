import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import { clearJwksCache } from "../../src/auth/access-jwt";

// Bring the local test database up to the latest schema (the same SQL files production uses).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Local D1/R2 state is shared between tests in this runtime, so every test starts from empty tables.
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM applications"),
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("DELETE FROM profile"),
    env.DB.prepare("DELETE FROM documents"),
    env.DB.prepare("DELETE FROM discovery_runs"),
  ]);
  let cursor: string | undefined;
  do {
    const page = await env.PRIVATE_FILES.list(cursor ? { cursor } : {});
    if (page.objects.length > 0) await env.PRIVATE_FILES.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  clearJwksCache();
});
