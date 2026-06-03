CREATE TABLE IF NOT EXISTS schedule_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  entry_type TEXT NOT NULL,
  title TEXT NOT NULL,
  presenter TEXT,
  organization TEXT,
  description TEXT,
  location TEXT,
  cfp_proposal_id INTEGER,
  is_published INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cfp_proposal_id) REFERENCES cfp_proposals (id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_entries_public
  ON schedule_entries (is_published, starts_at, sort_order);

CREATE INDEX IF NOT EXISTS idx_schedule_entries_cfp_proposal
  ON schedule_entries (cfp_proposal_id);
