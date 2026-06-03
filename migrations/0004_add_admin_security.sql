CREATE TABLE IF NOT EXISTS admin_auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_key_hash TEXT NOT NULL,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_auth_attempts_client_created
  ON admin_auth_attempts (client_key_hash, created_at);

CREATE TABLE IF NOT EXISTS admin_registration_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_stripe_session_id TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  ticket_tier_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  client_key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_registration_audit_created_at
  ON admin_registration_audit (created_at);
