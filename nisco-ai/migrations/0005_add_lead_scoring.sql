ALTER TABLE leads ADD COLUMN lead_score INTEGER NOT NULL DEFAULT 0 CHECK (lead_score BETWEEN 0 AND 100);
ALTER TABLE leads ADD COLUMN lead_priority TEXT NOT NULL DEFAULT 'standard' CHECK (lead_priority IN ('standard','high'));
CREATE INDEX IF NOT EXISTS idx_leads_priority_score ON leads(lead_priority, lead_score DESC);
