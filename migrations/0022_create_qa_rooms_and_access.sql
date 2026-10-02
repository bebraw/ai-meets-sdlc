-- QA grants are reusable until explicitly revoked. Tokens are hashed for lookup
-- and encrypted so administrators can copy the same invitation again.
CREATE TABLE qa_rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  object_name TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO qa_rooms VALUES
  ('industry-perspectives-morning', 'Industry perspectives', 'sdlcai-2026:industry-perspectives-morning', 0, '2026-10-02T00:00:00Z'),
  ('views-from-academia', 'Views from academia', 'sdlcai-2026:views-from-academia', 1, '2026-10-02T00:00:00Z'),
  ('views-from-industry', 'Views from industry', 'sdlcai-2026:views-from-industry', 2, '2026-10-02T00:00:00Z'),
  ('academia', 'Academia', 'sdlcai-2026:academia', 3, '2026-10-02T00:00:00Z');

CREATE TABLE qa_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_room_id TEXT REFERENCES qa_rooms(id),
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO qa_settings (id) VALUES (1);

CREATE TABLE qa_access_grants (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('moderator', 'mc')),
  token_hash TEXT NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE qa_staff_sessions (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES qa_access_grants(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX qa_sessions_grant ON qa_staff_sessions(grant_id);
CREATE INDEX qa_sessions_expiry ON qa_staff_sessions(expires_at);
