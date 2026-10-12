-- Durable work survives provider outages and local address removal.
CREATE TABLE newsletter_mailrelay_sync (
  subscriber_id TEXT PRIMARY KEY REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1,
  desired_status TEXT NOT NULL CHECK(desired_status IN ('subscribed', 'unsubscribed')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'synced', 'failed', 'blocked')),
  needs_enrollment INTEGER NOT NULL DEFAULT 1 CHECK(needs_enrollment IN (0, 1)),
  email_ciphertext TEXT,
  email_iv TEXT,
  remote_id INTEGER,
  remote_status TEXT,
  checked_at TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT
);
CREATE INDEX newsletter_mailrelay_due ON newsletter_mailrelay_sync(state, next_attempt_at, checked_at);
CREATE TABLE newsletter_mailrelay_control (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  scope TEXT,
  lease_id TEXT,
  lease_until TEXT NOT NULL DEFAULT '',
  next_request_at TEXT NOT NULL DEFAULT ''
);
INSERT INTO newsletter_mailrelay_control(id) VALUES(1);

-- No registration or unconfirmed signup is transferred to Mailrelay.
INSERT INTO newsletter_mailrelay_sync(subscriber_id, desired_status, email_ciphertext, email_iv)
SELECT id, status, email_ciphertext, email_iv FROM newsletter_subscribers WHERE status = 'subscribed';

CREATE TRIGGER newsletter_mailrelay_confirmed AFTER UPDATE OF status ON newsletter_subscribers
WHEN NEW.status = 'subscribed' AND OLD.status != 'subscribed'
BEGIN INSERT INTO newsletter_mailrelay_sync(subscriber_id, desired_status, email_ciphertext, email_iv) VALUES(NEW.id, 'subscribed', NEW.email_ciphertext, NEW.email_iv) ON CONFLICT(subscriber_id) DO UPDATE SET revision = revision + 1, desired_status = 'subscribed', state = 'pending', needs_enrollment = 1, email_ciphertext = excluded.email_ciphertext, email_iv = excluded.email_iv, next_attempt_at = '', attempts = 0, error_code = NULL; END;

CREATE TRIGGER newsletter_mailrelay_unsubscribed AFTER UPDATE OF status ON newsletter_subscribers
WHEN NEW.status = 'unsubscribed' AND OLD.status != 'unsubscribed' AND (OLD.confirmed_at IS NOT NULL OR EXISTS(SELECT 1 FROM newsletter_mailrelay_sync WHERE subscriber_id = NEW.id))
BEGIN INSERT INTO newsletter_mailrelay_sync(subscriber_id, desired_status, needs_enrollment, email_ciphertext, email_iv) VALUES(NEW.id, 'unsubscribed', 0, OLD.email_ciphertext, OLD.email_iv) ON CONFLICT(subscriber_id) DO UPDATE SET revision = revision + 1, desired_status = 'unsubscribed', state = 'pending', needs_enrollment = 0, email_ciphertext = COALESCE(excluded.email_ciphertext, email_ciphertext), email_iv = COALESCE(excluded.email_iv, email_iv), next_attempt_at = '', attempts = 0, error_code = NULL; END;
