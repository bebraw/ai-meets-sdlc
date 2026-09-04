CREATE TABLE IF NOT EXISTS speaker_presentation_responses (
  speaker_id TEXT PRIMARY KEY,
  response_ciphertext TEXT NOT NULL,
  response_iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  responded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (speaker_id) REFERENCES canonical_speaker_content (speaker_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS speaker_presentation_responses_expires_at_idx
  ON speaker_presentation_responses (expires_at);
