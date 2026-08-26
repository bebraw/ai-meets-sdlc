CREATE TABLE IF NOT EXISTS speaker_video_submissions (
  submission_id TEXT PRIMARY KEY,
  speaker_id TEXT NOT NULL,
  talk_id TEXT NOT NULL,
  stream_uid TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (
    state IN (
      'upload_pending',
      'processing',
      'ready',
      'approved',
      'changes_requested',
      'error',
      'superseded'
    )
  ),
  stream_state TEXT,
  duration_seconds REAL,
  error_code TEXT,
  may_caption INTEGER NOT NULL CHECK (may_caption IN (0, 1)),
  may_crop INTEGER NOT NULL CHECK (may_crop IN (0, 1)),
  may_excerpt INTEGER NOT NULL CHECK (may_excerpt IN (0, 1)),
  may_edit INTEGER NOT NULL CHECK (may_edit IN (0, 1)),
  may_publish INTEGER NOT NULL CHECK (may_publish IN (0, 1)),
  permission_text TEXT NOT NULL,
  permission_recorded_at TEXT NOT NULL,
  upload_expires_at TEXT NOT NULL,
  retention_until TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS speaker_video_submissions_one_active_talk_idx
  ON speaker_video_submissions (speaker_id, talk_id)
  WHERE state IN ('upload_pending', 'processing', 'ready');

CREATE INDEX IF NOT EXISTS speaker_video_submissions_speaker_updated_idx
  ON speaker_video_submissions (speaker_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS speaker_video_submissions_state_updated_idx
  ON speaker_video_submissions (state, updated_at DESC);
