CREATE TABLE IF NOT EXISTS speaker_photo_revisions (
  photo_revision_id TEXT PRIMARY KEY,
  speaker_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  width INTEGER NOT NULL CHECK (width = 400),
  height INTEGER NOT NULL CHECK (height = 400),
  state TEXT NOT NULL CHECK (state IN ('submitted', 'approved', 'rejected')),
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS speaker_photo_revisions_one_submitted_idx
  ON speaker_photo_revisions (speaker_id)
  WHERE state = 'submitted';

CREATE INDEX IF NOT EXISTS speaker_photo_revisions_speaker_updated_idx
  ON speaker_photo_revisions (speaker_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS speaker_photo_revisions_state_updated_idx
  ON speaker_photo_revisions (state, updated_at DESC);
