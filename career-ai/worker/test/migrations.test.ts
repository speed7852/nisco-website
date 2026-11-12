import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Migration 0002 applied to a copy of the 0001 schema that holds the kinds of data the 0001-era
 * code allowed: duplicate URLs, unsafe links, unvalidated scores, duplicate applications and
 * arbitrary statuses. Uses a separate empty database so the main test database is untouched.
 */
const db = () => env.MIGRATION_TEST_DB;
const [m0001, m0002, m0003] = env.TEST_MIGRATIONS;

async function resetMigrationDb(): Promise<void> {
  const objects = await db()
    .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type IN ('table', 'trigger', 'index')")
    .all<{ type: string; name: string }>();
  for (const { name } of objects.results.filter((o) => o.type === "trigger")) await db().exec(`DROP TRIGGER IF EXISTS ${name}`);
  // Child tables first: foreign keys are enforced, as in D1.
  const childFirst = ["applications", "profile_items", "cv_versions"];
  const tables = objects.results.filter((o) => o.type === "table").map((o) => o.name);
  const ordered = [...childFirst.filter((name) => tables.includes(name)), ...tables.filter((name) => !childFirst.includes(name))];
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

/**
 * Migration 0003 over 0002-era data. The Phase 1 profile must be preserved byte for byte, copied to
 * an immutable snapshot and offered only as PROPOSALS; documents are untouched.
 */
describe("migration 0003 over 0002 data", () => {
  const LEGACY = JSON.stringify({
    name: "Synthetic Person",
    headline: "PMO lead",
    years: 12,
    location: "Riyadh; open to remote",
    summary: 'Line one.\nLine two with "quotes" & ampersand.',
    skills: "PMO, ITIL",
    experience: "",
    roles: "Programme Manager, PMO Lead",
  });

  async function migrateWith(profileData: string | null) {
    await resetMigrationDb();
    await applyD1Migrations(db(), [m0001!, m0002!]);
    if (profileData !== null) {
      await db().prepare("INSERT INTO profile (id, data, updated_at) VALUES (1, ?, '2026-11-01T00:00:00Z')").bind(profileData).run();
    }
    await db().prepare("INSERT INTO documents (id, r2_key, kind, original_name, content_type, size_bytes, sha256, created_at) VALUES ('d1', 'private/uploads/d1', 'upload', 'Old CV.pdf', 'application/pdf', 10, 'ab', '2026-11-02')").run();
    await applyD1Migrations(db(), [m0001!, m0002!, m0003!]);
  }

  it("is the third migration", () => {
    expect(m0003?.name).toBe("0003_phase2_cv_profile.sql");
  });

  it("leaves the Phase 1 profile byte-identical and snapshots it", async () => {
    await migrateWith(LEGACY);
    expect(await db().prepare("SELECT data, updated_at FROM profile WHERE id = 1").first()).toEqual({ data: LEGACY, updated_at: "2026-11-01T00:00:00Z" });
    expect((await db().prepare("SELECT reason, data, original_updated_at FROM profile_snapshots").all()).results).toEqual([
      { reason: "migration_0003", data: LEGACY, original_updated_at: "2026-11-01T00:00:00Z" },
    ]);
  });

  it("creates verbatim, unconfirmed proposals and never splits or maps to approved locations", async () => {
    await migrateWith(LEGACY);
    const rows = await db().prepare("SELECT section, source_field, value, status, source FROM profile_items ORDER BY position").all();
    expect(rows.results).toEqual([
      { section: "name", source_field: "name", value: '{"text":"Synthetic Person"}', status: "proposed", source: "legacy_profile" },
      { section: "headline", source_field: "headline", value: '{"text":"PMO lead"}', status: "proposed", source: "legacy_profile" },
      { section: "years_experience", source_field: "years", value: '{"text":"12"}', status: "proposed", source: "legacy_profile" },
      { section: "location_text", source_field: "location", value: '{"text":"Riyadh; open to remote"}', status: "proposed", source: "legacy_profile" },
      { section: "summary", source_field: "summary", value: JSON.stringify({ text: 'Line one.\nLine two with "quotes" & ampersand.' }), status: "proposed", source: "legacy_profile" },
      { section: "skills_text", source_field: "skills", value: '{"text":"PMO, ITIL"}', status: "proposed", source: "legacy_profile" },
      { section: "preferred_titles_text", source_field: "roles", value: '{"text":"Programme Manager, PMO Lead"}', status: "proposed", source: "legacy_profile" },
    ]);
    const ids = await db().prepare("SELECT id FROM profile_items").all<{ id: string }>();
    for (const { id } of ids.results) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it.each([
    ["a bare JSON string", '"just a string"'],
    ["a JSON array", "[1,2,3]"],
    ["invalid JSON", "{not json"],
  ])("does not fail on %s: preserves it, snapshots it, proposes nothing", async (_label, data) => {
    await migrateWith(data);
    expect(await db().prepare("SELECT data FROM profile WHERE id = 1").first()).toEqual({ data });
    expect(await db().prepare("SELECT data FROM profile_snapshots").first()).toEqual({ data });
    expect(await db().prepare("SELECT COUNT(*) AS n FROM profile_items").first()).toEqual({ n: 0 });
  });

  it("works with no Phase 1 profile at all", async () => {
    await migrateWith(null);
    expect(await db().prepare("SELECT (SELECT COUNT(*) FROM profile_snapshots) AS s, (SELECT COUNT(*) FROM profile_items) AS i").first()).toEqual({ s: 0, i: 0 });
  });

  it("leaves documents untouched and creates no CV versions by itself", async () => {
    await migrateWith(LEGACY);
    expect(await db().prepare("SELECT id, r2_key, original_name FROM documents").all().then((r) => r.results)).toEqual([
      { id: "d1", r2_key: "private/uploads/d1", original_name: "Old CV.pdf" },
    ]);
    expect(await db().prepare("SELECT COUNT(*) AS n FROM cv_versions").first()).toEqual({ n: 0 });
  });

  it("enforces its constraints: one active CV, one confirmed single value, immutable snapshots", async () => {
    await migrateWith(LEGACY);
    await db().prepare("INSERT INTO documents (id, r2_key, kind, original_name, content_type, size_bytes, created_at) VALUES ('d2', 'k2', 'upload', 'b.pdf', 'application/pdf', 1, 'n')").run();
    await db().prepare("INSERT INTO cv_versions (id, document_id, status, created_at, updated_at) VALUES ('v1', 'd1', 'active', 'n', 'n')").run();
    await expect(db().prepare("INSERT INTO cv_versions (id, document_id, status, created_at, updated_at) VALUES ('v2', 'd2', 'active', 'n', 'n')").run()).rejects.toThrow(/UNIQUE/);
    await expect(db().prepare("INSERT INTO cv_versions (id, document_id, status, created_at, updated_at) VALUES ('v3', NULL, 'inactive', 'n', 'n')").run()).rejects.toThrow(/CHECK/);
    await expect(db().prepare("DELETE FROM documents WHERE id = 'd1'").run()).rejects.toThrow(/FOREIGN KEY/);
    await db().prepare("UPDATE profile_items SET status = 'confirmed' WHERE section = 'name'").run();
    await expect(db().prepare("INSERT INTO profile_items (id, section, value, status, source, created_at, updated_at) VALUES ('x', 'name', '{\"text\":\"Other\"}', 'confirmed', 'manual', 'n', 'n')").run()).rejects.toThrow(/UNIQUE/);
    await expect(db().prepare("UPDATE profile_snapshots SET data = 'tampered'").run()).rejects.toThrow(/immutable/);
    await expect(db().prepare("INSERT INTO profile_items (id, section, value, status, source, created_at, updated_at) VALUES ('y', 'skill', 'not json', 'proposed', 'manual', 'n', 'n')").run()).rejects.toThrow(/CHECK/);
  });

  it("is recorded once and is not re-applied", async () => {
    await migrateWith(LEGACY);
    await applyD1Migrations(db(), [m0001!, m0002!, m0003!]);
    expect((await db().prepare("SELECT name FROM d1_migrations ORDER BY id").all()).results).toEqual([
      { name: "0001_init.sql" },
      { name: "0002_phase1_integrity.sql" },
      { name: "0003_phase2_cv_profile.sql" },
    ]);
    expect(await db().prepare("SELECT COUNT(*) AS n FROM profile_items").first()).toEqual({ n: 7 });
  });
});
