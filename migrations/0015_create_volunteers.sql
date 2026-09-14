CREATE TABLE volunteers (
  volunteer_id TEXT PRIMARY KEY,
  details_ciphertext TEXT NOT NULL,
  details_iv TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
