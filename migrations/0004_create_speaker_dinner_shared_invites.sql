CREATE TABLE IF NOT EXISTS speaker_dinner_shared_invites (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS speaker_dinner_shared_responses (
  response_id TEXT PRIMARY KEY,
  name_ciphertext TEXT NOT NULL,
  name_iv TEXT NOT NULL,
  response_ciphertext TEXT NOT NULL,
  response_iv TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  responded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS speaker_dinner_shared_responses_responded_at_idx
  ON speaker_dinner_shared_responses (responded_at);
