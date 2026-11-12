import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Migration 0002 applied to a copy of the 0001 schema that holds the kinds of data the 0001-era
 * code allowed: duplicate URLs, unsafe links, unvalidated scores, duplicate applications and
 * arbitrary statuses. Uses a separate empty database so the main test database is untouched.
 */
const db = () => env.MIGRATION_TEST_DB;
const [m0001, m0002] = env.TEST_MIGRATIONS;

async function resetMigrationDb(): Promise<void> {
  const objects = await db()
    .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type IN ('table', 'trigger', 'index')")
    .all<{ type: string; name: string }>();
  for (const { name } of objects.results.filter((o) => o.type === "trigger")) await db().exec(`DROP TRIGGER IF EXISTS ${name}`);
  // Child tables first: foreign keys are enforced, as in D1.
  const tables = objects.results.filter((o) => o.type === "table").map((o) => o.name);
  const ordered = [...tables.filter((name) => name === "applications"), ...tables.filter((name) => name !== "applications")];
  for (const name of ordered) await db().exec(`DROP TABLE IF EXISTS ${name}`);
}

async function seedLegacyData(): Promise<void> {
  await db().batch([
    db().prepare(`INSERT INTO jobs (id, title, company, location, url, description, match_score, created_at) VALUES
      ('j1', 'PM', 'A', 'Riyadh', 'https://ex.com/1', 'd', 0, '2026-11-01'),
      ('j2', 'PM', 'A', 'Riyadh', 'https://ex.com/1', 'd', 150, '2026-11-02'),
      ('j3', 'PM', 'B', 'Riyadh', 'javascript:alert(1)', 'd', NULL, '2026-11-03'),
      ('j4', 'PM', 'C', '', '', 'd', 88, '2026-11-04'),
      ('j5', 'PM', 'D', '', 'https://ex.com/5?utm_source=x', 'd', NULL, '2026-11-05')`),
    db().prepare(`INSERT INTO applications (id, job_id, status, notes, updated_at) VALUES
      ('a1', 'j1', 'applied', 'older', '2026-11-05'),
      ('a2', 'j1', 'prepared', 'newer', '2026-11-06'),
      ('a3', 'j4', 'totally-made-up', 'legacy status', '2026-11-07')`),
    db().prepare("INSERT INTO profile (id, data, updated_at) VALUES (1, '\"just a string\"', '2026-11-01')"),
  ]);
}

describe("migration 0002 over 0001 data", () => {
  beforeEach(async () => {
    expect(m0001?.name).toBe("0001_init.sql");
    expect(m0002?.name).toBe("0002_phase1_integrity.sql");
    await resetMigrationDb();
    await applyD1Migrations(db(), [m0001!]);
    await seedLegacyData();
    await applyD1Migrations(db(), [m0001!, m0002!]);
  });

  it("keeps every existing row", async () => {
    const counts = await db().prepare("SELECT (SELECT COUNT(*) FROM jobs) AS jobs, (SELECT COUNT(*) FROM applications) AS apps, (SELECT COUNT(*) FROM profile) AS profiles").first();
    expect(counts).toEqual({ jobs: 5, apps: 3, profiles: 1 });
  });

  it("sets canonical URLs without failing on existing duplicates", async () => {
    const rows = await db().prepare("SELECT id, canonical_url FROM jobs ORDER BY id").all();
    expect(rows.results).toEqual([
      { id: "j1", canonical_url: "https://ex.com/1" },
      { id: "j2", canonical_url: null },
      { id: "j3", canonical_url: null },
      { id: "j4", canonical_url: null },
      { id: "j5", canonical_url: "https://ex.com/5?utm_source=x" },
    ]);
    await expect(
      db().prepare("INSERT INTO jobs (id, title, company, description, canonical_url, created_at) VALUES ('j9', 'x', 'x', 'x', 'https://ex.com/1', 'x')").run(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("marks every pre-existing score as unverified and leaves unscored jobs pending", async () => {
    const rows = await db().prepare("SELECT id, match_score, match_status, match_scored_at FROM jobs ORDER BY id").all();
    expect(rows.results).toEqual([
      { id: "j1", match_score: 0, match_status: "legacy_unverified", match_scored_at: null },
      { id: "j2", match_score: 150, match_status: "legacy_unverified", match_scored_at: null },
      { id: "j3", match_score: null, match_status: "pending", match_scored_at: null },
      { id: "j4", match_score: 88, match_status: "legacy_unverified", match_scored_at: null },
      { id: "j5", match_score: null, match_status: "pending", match_scored_at: null },
    ]);
  });

  it("archives older duplicate applications instead of deleting them", async () => {
    const rows = await db().prepare("SELECT id, status, notes, archived_at IS NOT NULL AS archived, created_at FROM applications ORDER BY id").all();
    expect(rows.results).toEqual([
      { id: "a1", status: "applied", notes: "older", archived: 1, created_at: "2026-11-05" },
      { id: "a2", status: "prepared", notes: "newer", archived: 0, created_at: "2026-11-06" },
      { id: "a3", status: "totally-made-up", notes: "legacy status", archived: 0, created_at: "2026-11-07" },
    ]);
  });

  it("enforces one active application per job and the status allow-list for new writes", async () => {
    await expect(
      db().prepare("INSERT INTO applications (id, job_id, status, notes, updated_at) VALUES ('a9', 'j1', 'prepared', '', 'x')").run(),
    ).rejects.toThrow(/UNIQUE/);
    await expect(
      db().prepare("INSERT INTO applications (id, job_id, status, notes, updated_at) VALUES ('a9', 'j3', 'submitted', '', 'x')").run(),
    ).rejects.toThrow(/invalid application status/);
    await expect(db().prepare("UPDATE applications SET status = 'hacked' WHERE id = 'a2'").run()).rejects.toThrow(/invalid application status/);
    // A legacy invalid status can still be read and its notes edited without touching status.
    await db().prepare("UPDATE applications SET notes = 'edited' WHERE id = 'a3'").run();
    expect(await db().prepare("SELECT status FROM applications WHERE id = 'a3'").first()).toEqual({ status: "totally-made-up" });
  });

  it("rejects an invalid match_status value", async () => {
    await expect(db().prepare("UPDATE jobs SET match_status = 'great' WHERE id = 'j1'").run()).rejects.toThrow(/CHECK/);
  });

  it("creates the documents and discovery_runs tables", async () => {
    const tables = await db().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('documents', 'discovery_runs') ORDER BY name").all();
    expect(tables.results).toEqual([{ name: "discovery_runs" }, { name: "documents" }]);
  });

  it("is recorded once and is not re-applied", async () => {
    await applyD1Migrations(db(), [m0001!, m0002!]);
    const applied = await db().prepare("SELECT name FROM d1_migrations ORDER BY id").all();
    expect(applied.results).toEqual([{ name: "0001_init.sql" }, { name: "0002_phase1_integrity.sql" }]);
  });
});
