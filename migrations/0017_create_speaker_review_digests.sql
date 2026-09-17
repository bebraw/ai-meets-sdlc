CREATE TABLE speaker_review_digests (
  digest_date TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'empty', 'failed')),
  attempt_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  lease_until TEXT NOT NULL,
  revision_count INTEGER NOT NULL DEFAULT 0,
  message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

-- Only keyed token hashes are retained, never the approval links themselves.
-- A link authorizes approval of one immutable submitted revision, not admin access.
CREATE TABLE speaker_review_tokens (
  token_hash TEXT PRIMARY KEY,
  digest_date TEXT NOT NULL REFERENCES speaker_review_digests(digest_date) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES speaker_content_revisions(revision_id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  base_content_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX speaker_review_tokens_expiry_idx ON speaker_review_tokens(expires_at);
CREATE INDEX speaker_review_tokens_revision_idx ON speaker_review_tokens(revision_id);
