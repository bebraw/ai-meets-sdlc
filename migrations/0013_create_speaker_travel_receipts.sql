CREATE TABLE IF NOT EXISTS speaker_receipt_access (
  speaker_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

-- Receipt records deliberately have no cascading link to expiring workspace
-- contacts or sessions. Organizers need these after the event.
CREATE TABLE IF NOT EXISTS speaker_travel_receipts (
  receipt_id TEXT PRIMARY KEY,
  speaker_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  details_ciphertext TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'processed', 'deleted')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS speaker_travel_receipts_speaker_idx
  ON speaker_travel_receipts (speaker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS speaker_travel_receipts_status_idx
  ON speaker_travel_receipts (status, created_at DESC);
