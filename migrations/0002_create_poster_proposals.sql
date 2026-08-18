CREATE TABLE IF NOT EXISTS poster_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE,
  name_ciphertext TEXT NOT NULL,
  name_iv TEXT NOT NULL,
  email_ciphertext TEXT NOT NULL,
  email_iv TEXT NOT NULL,
  organization_ciphertext TEXT,
  organization_iv TEXT,
  authors_ciphertext TEXT NOT NULL,
  authors_iv TEXT NOT NULL,
  title_ciphertext TEXT NOT NULL,
  title_iv TEXT NOT NULL,
  abstract_ciphertext TEXT NOT NULL,
  abstract_iv TEXT NOT NULL,
  poster_size TEXT NOT NULL CHECK (poster_size IN ('a0', 'a1', 'either')),
  supporting_url_ciphertext TEXT,
  supporting_url_iv TEXT,
  setup_notes_ciphertext TEXT,
  setup_notes_iv TEXT,
  terms_text TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (
    status IN (
      'submitted',
      'shortlisted',
      'accepted',
      'waitlisted',
      'declined',
      'withdrawn'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  CHECK (
    (organization_ciphertext IS NULL AND organization_iv IS NULL)
    OR (organization_ciphertext IS NOT NULL AND organization_iv IS NOT NULL)
  ),
  CHECK (
    (supporting_url_ciphertext IS NULL AND supporting_url_iv IS NULL)
    OR (
      supporting_url_ciphertext IS NOT NULL
      AND supporting_url_iv IS NOT NULL
    )
  ),
  CHECK (
    (setup_notes_ciphertext IS NULL AND setup_notes_iv IS NULL)
    OR (setup_notes_ciphertext IS NOT NULL AND setup_notes_iv IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_poster_proposals_created_at
  ON poster_proposals (created_at);

CREATE INDEX IF NOT EXISTS idx_poster_proposals_status
  ON poster_proposals (status);
