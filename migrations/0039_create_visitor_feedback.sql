-- No attendee/email identifiers, network metadata, or plaintext answers.
CREATE TABLE visitor_feedback (
  id TEXT PRIMARY KEY,
  receipt_hash TEXT NOT NULL UNIQUE,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX visitor_feedback_expiry ON visitor_feedback(expires_at);

-- Independent marginal counts only: no combinations, comments, dates or IDs.
CREATE TABLE visitor_feedback_totals (
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0),
  PRIMARY KEY(question, answer)
);
