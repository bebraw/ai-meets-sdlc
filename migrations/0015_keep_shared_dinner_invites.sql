-- Preserve existing invitation hashes, including links created before token storage.
CREATE TABLE speaker_dinner_shared_invites_new (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  token_ciphertext TEXT,
  token_iv TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO speaker_dinner_shared_invites_new
  (id, token_hash, token_ciphertext, token_iv, created_at, expires_at, updated_at)
SELECT id, token_hash, token_ciphertext, token_iv, created_at, expires_at, updated_at
FROM speaker_dinner_shared_invites;

DROP TABLE speaker_dinner_shared_invites;
ALTER TABLE speaker_dinner_shared_invites_new RENAME TO speaker_dinner_shared_invites;
