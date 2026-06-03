CREATE TABLE IF NOT EXISTS cfp_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  format TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  email_ciphertext TEXT NOT NULL,
  email_iv TEXT NOT NULL,
  name_ciphertext TEXT NOT NULL,
  name_iv TEXT NOT NULL,
  organization_ciphertext TEXT,
  organization_iv TEXT,
  title_ciphertext TEXT NOT NULL,
  title_iv TEXT NOT NULL,
  summary_ciphertext TEXT NOT NULL,
  summary_iv TEXT NOT NULL,
  bio_ciphertext TEXT,
  bio_iv TEXT,
  consent_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfp_proposals_created_at
  ON cfp_proposals (created_at);

CREATE INDEX IF NOT EXISTS idx_cfp_proposals_format
  ON cfp_proposals (format);
