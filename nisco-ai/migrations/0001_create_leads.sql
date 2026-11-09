CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT,
  email TEXT,
  phone TEXT,
  preferred_contact TEXT,
  service TEXT NOT NULL,
  summary TEXT NOT NULL,
  timeline TEXT,
  consent INTEGER NOT NULL CHECK (consent = 1),
  source TEXT NOT NULL DEFAULT 'website-chat'
);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
