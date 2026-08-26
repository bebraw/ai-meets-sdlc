CREATE TABLE IF NOT EXISTS speaker_magic_links (
  token_hash TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  speaker_id TEXT NOT NULL,
  access_generation INTEGER NOT NULL CHECK (access_generation > 0),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (speaker_id) REFERENCES speaker_workspace_access (speaker_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS speaker_magic_links_speaker_id_idx
  ON speaker_magic_links (speaker_id, created_at DESC);

CREATE INDEX IF NOT EXISTS speaker_magic_links_expires_at_idx
  ON speaker_magic_links (expires_at);

CREATE TABLE IF NOT EXISTS speaker_login_requests (
  request_id TEXT PRIMARY KEY,
  email_fingerprint TEXT NOT NULL,
  ip_fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'sent', 'suppressed', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS speaker_login_requests_email_created_idx
  ON speaker_login_requests (email_fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS speaker_login_requests_ip_created_idx
  ON speaker_login_requests (ip_fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS speaker_login_requests_created_at_idx
  ON speaker_login_requests (created_at);
