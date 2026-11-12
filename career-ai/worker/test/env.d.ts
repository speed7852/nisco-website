import type { D1Migration } from "cloudflare:test";
import type { Env as WorkerEnv } from "../src/env";

// Bindings visible to tests through `env` from "cloudflare:workers".
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
      /** Empty database used only by test/migrations.test.ts. */
      MIGRATION_TEST_DB: D1Database;
    }
  }
}
