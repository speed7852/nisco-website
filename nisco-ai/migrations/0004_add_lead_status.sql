ALTER TABLE leads ADD COLUMN status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','in_progress','won','closed'));
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
