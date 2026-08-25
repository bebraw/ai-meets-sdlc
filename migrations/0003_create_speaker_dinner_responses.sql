CREATE TABLE IF NOT EXISTS speaker_dinner_responses (
  speaker_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  response_ciphertext TEXT,
  response_iv TEXT,
  consent_text TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  responded_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (
    (response_ciphertext IS NULL AND response_iv IS NULL) OR
    (response_ciphertext IS NOT NULL AND response_iv IS NOT NULL)
  ),
  CHECK (
    (response_ciphertext IS NULL AND consent_text IS NULL AND responded_at IS NULL) OR
    (response_ciphertext IS NOT NULL AND consent_text IS NOT NULL AND responded_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS speaker_dinner_responses_expires_at_idx
  ON speaker_dinner_responses (expires_at);
