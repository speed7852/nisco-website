import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside the real Workers runtime (workerd) with local, throwaway D1 and R2.
// Nothing here talks to Cloudflare: remote bindings are disabled and Workers AI is stubbed per test.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        remoteBindings: false,
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // A second, empty database used only by the migration test (it drops and rebuilds schemas).
          d1Databases: { MIGRATION_TEST_DB: "migration-test-db" },
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Synthetic test-only secret. Never a real key.
            APP_ACCESS_KEY: "test-only-access-key-0123456789abcdef",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup/global.ts"],
      include: ["test/**/*.test.ts"],
    },
  };
});
