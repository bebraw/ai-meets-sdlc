CREATE TABLE IF NOT EXISTS speaker_contacts (
  speaker_id TEXT PRIMARY KEY,
  email_ciphertext TEXT NOT NULL,
  email_iv TEXT NOT NULL,
  email_fingerprint TEXT NOT NULL UNIQUE,
  email_confirmed_at TEXT,
  retention_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS speaker_workspace_access (
  speaker_id TEXT PRIMARY KEY,
  invite_token_hash TEXT NOT NULL UNIQUE,
  access_generation INTEGER NOT NULL DEFAULT 1 CHECK (access_generation > 0),
  invite_created_at TEXT NOT NULL,
  invite_expires_at TEXT NOT NULL,
  last_sent_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (speaker_id) REFERENCES speaker_contacts (speaker_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS speaker_workspace_access_expires_at_idx
  ON speaker_workspace_access (invite_expires_at);

CREATE TABLE IF NOT EXISTS speaker_workspace_sessions (
  token_hash TEXT PRIMARY KEY,
  speaker_id TEXT NOT NULL,
  access_generation INTEGER NOT NULL CHECK (access_generation > 0),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (speaker_id) REFERENCES speaker_workspace_access (speaker_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS speaker_workspace_sessions_speaker_id_idx
  ON speaker_workspace_sessions (speaker_id);

CREATE INDEX IF NOT EXISTS speaker_workspace_sessions_expires_at_idx
  ON speaker_workspace_sessions (expires_at);

CREATE TABLE IF NOT EXISTS speaker_content_revisions (
  revision_id TEXT PRIMARY KEY,
  speaker_id TEXT NOT NULL,
  base_content_hash TEXT NOT NULL,
  content_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS speaker_content_revisions_one_draft_idx
  ON speaker_content_revisions (speaker_id)
  WHERE state = 'draft';

CREATE UNIQUE INDEX IF NOT EXISTS speaker_content_revisions_one_submitted_idx
  ON speaker_content_revisions (speaker_id)
  WHERE state = 'submitted';

CREATE INDEX IF NOT EXISTS speaker_content_revisions_speaker_updated_idx
  ON speaker_content_revisions (speaker_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS speaker_content_revisions_state_updated_idx
  ON speaker_content_revisions (state, updated_at DESC);
