CREATE TABLE IF NOT EXISTS profile(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,title TEXT NOT NULL,company TEXT NOT NULL,location TEXT,url TEXT,description TEXT NOT NULL,match_score REAL,status TEXT NOT NULL DEFAULT 'saved',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),status TEXT NOT NULL DEFAULT 'prepared',notes TEXT,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_jobs_score ON jobs(match_score DESC);
CREATE INDEX IF NOT EXISTS idx_apps_updated ON applications(updated_at DESC);
