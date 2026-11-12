#!/usr/bin/env bash
# Migration 0003 drill: apply, verify, roll back from a backup, re-apply. LOCAL ONLY.
#
#   cd career-ai/worker && npm ci && bash scripts/migration-0003-drill.sh
#
# What it proves, on a throwaway local D1 database seeded with synthetic Phase 1 data:
#   1. 0003 leaves the original profile row byte-identical and keeps a verbatim snapshot of it;
#   2. it creates one "proposed" item per non-empty legacy field, verbatim, and nothing confirmed;
#   3. existing files (documents) are untouched;
#   4. a backup exported before 0003 restores the database exactly to its Phase 1 state
#      (no Phase 2 tables, migrations 0001-0002 only, profile byte-identical);
#   5. 0003 applies again cleanly after the restore.
#
# Isolation: a new temporary directory holds the config and state; Cloudflare credential
# variables are removed and HOME points at the temporary directory, so a stored `wrangler login`
# is invisible; every command uses --local and the config has a placeholder database_id.
set -euo pipefail

WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRANGLER="$WORKER_DIR/node_modules/.bin/wrangler"
[ -x "$WRANGLER" ] || { echo "Run npm ci in career-ai/worker first." >&2; exit 1; }

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/career-ai-migration-drill-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/migrations" "$ROOT/home"
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL CF_API_TOKEN CF_ACCOUNT_ID CF_API_KEY CF_EMAIL
export HOME="$ROOT/home" XDG_CONFIG_HOME="$ROOT/home" WRANGLER_SEND_METRICS=false CI=1
cd "$ROOT"

cat > wrangler.toml <<'TOML'
name = "career-ai-migration-drill"
main = "unused.js"
compatibility_date = "2026-11-10"
[[d1_databases]]
binding = "DB"
database_name = "drill-db"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "migrations"
TOML

d1() { "$WRANGLER" d1 "$@" drill-db --local 2>/dev/null; }
query() { d1 execute --json --command "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s)[0].results)))'; }
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1"; echo "      expected: $3"; echo "      actual:   $2"; exit 1; fi; }

echo "== 1. Phase 1 schema (0001, 0002) with synthetic data"
cp "$WORKER_DIR/migrations/0001_"*.sql "$WORKER_DIR/migrations/0002_"*.sql migrations/
"$WRANGLER" d1 migrations apply drill-db --local >/dev/null 2>&1
d1 execute --command "INSERT INTO profile (id, data, updated_at) VALUES (1, '{\"name\":\"Synthetic Person\",\"headline\":\"PMO lead\",\"years\":12,\"location\":\"Riyadh; open to remote\",\"summary\":\"Line one.\\nLine two with \\\"quotes\\\" & ampersand.\",\"skills\":\"PMO, ITIL\",\"experience\":\"\",\"roles\":\"Programme Manager, PMO Lead\"}', '2026-11-01T00:00:00Z');
INSERT INTO documents (id, r2_key, kind, original_name, content_type, size_bytes, sha256, created_at) VALUES ('d1', 'private/uploads/d1', 'upload', 'Old synthetic CV.pdf', 'application/pdf', 10, 'ab', '2026-11-02');" >/dev/null
PROFILE_BEFORE="$(query "SELECT data, updated_at FROM profile")"
DOCS_BEFORE="$(query "SELECT * FROM documents")"

echo "== 2. Backup before 0003 (the local equivalent of a Time Travel bookmark or d1 export)"
"$WRANGLER" d1 export drill-db --local --output backup-before-0003.sql >/dev/null 2>&1
echo "      backup: $(wc -l < backup-before-0003.sql) lines"

echo "== 3. Apply 0003"
cp "$WORKER_DIR/migrations/0003_"*.sql migrations/
"$WRANGLER" d1 migrations apply drill-db --local >/dev/null 2>&1
check "legacy profile row byte-identical" "$(query "SELECT data, updated_at FROM profile")" "$PROFILE_BEFORE"
check "documents untouched" "$(query "SELECT * FROM documents")" "$DOCS_BEFORE"
check "one snapshot, verbatim copy of the profile" \
  "$(query "SELECT COUNT(*) AS n, MAX(reason) AS reason, MAX(data = (SELECT data FROM profile WHERE id = 1)) AS same FROM profile_snapshots")" \
  '[{"n":1,"reason":"migration_0003","same":1}]'
check "proposals: one per non-empty field, verbatim, none confirmed" \
  "$(query "SELECT section, json_extract(value, '\$.text') AS text, status, source, source_field FROM profile_items ORDER BY position")" \
  '[{"section":"name","text":"Synthetic Person","status":"proposed","source":"legacy_profile","source_field":"name"},{"section":"headline","text":"PMO lead","status":"proposed","source":"legacy_profile","source_field":"headline"},{"section":"years_experience","text":"12","status":"proposed","source":"legacy_profile","source_field":"years"},{"section":"location_text","text":"Riyadh; open to remote","status":"proposed","source":"legacy_profile","source_field":"location"},{"section":"summary","text":"Line one.\nLine two with \"quotes\" & ampersand.","status":"proposed","source":"legacy_profile","source_field":"summary"},{"section":"skills_text","text":"PMO, ITIL","status":"proposed","source":"legacy_profile","source_field":"skills"},{"section":"preferred_titles_text","text":"Programme Manager, PMO Lead","status":"proposed","source":"legacy_profile","source_field":"roles"}]'
check "no CV versions created" "$(query "SELECT COUNT(*) AS n FROM cv_versions")" '[{"n":0}]'
check "snapshots cannot be modified" \
  "$(d1 execute --command "UPDATE profile_snapshots SET data = '{}'" >/dev/null 2>&1 && echo updated || echo refused)" "refused"

echo "== 4. Roll back: discard the database and restore the backup"
rm -rf .wrangler
d1 execute --file backup-before-0003.sql >/dev/null
check "migrations recorded: 0001 and 0002 only" \
  "$(query "SELECT COUNT(*) AS n, SUM(name LIKE '0001%') AS m1, SUM(name LIKE '0002%') AS m2, SUM(name LIKE '0003%') AS m3 FROM d1_migrations")" \
  '[{"n":2,"m1":1,"m2":1,"m3":0}]'
check "no Phase 2 tables" \
  "$(query "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('profile_items','profile_snapshots','cv_versions')")" '[{"n":0}]'
check "profile byte-identical after restore" "$(query "SELECT data, updated_at FROM profile")" "$PROFILE_BEFORE"
check "documents identical after restore" "$(query "SELECT * FROM documents")" "$DOCS_BEFORE"

echo "== 5. Re-apply 0003 after the restore"
"$WRANGLER" d1 migrations apply drill-db --local >/dev/null 2>&1
check "0003 recorded again" "$(query "SELECT COUNT(*) AS n FROM d1_migrations WHERE name LIKE '0003%'")" '[{"n":1}]'
check "7 proposals again" "$(query "SELECT COUNT(*) AS n FROM profile_items WHERE status = 'proposed'")" '[{"n":7}]'

echo "Migration 0003 drill passed."
