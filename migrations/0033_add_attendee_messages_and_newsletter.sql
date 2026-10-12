CREATE TABLE attendee_message_preferences (
  email_hash TEXT PRIMARY KEY,
  unsubscribed_at TEXT NOT NULL
);

CREATE TABLE attendee_message_campaigns (
  id TEXT PRIMARY KEY,
  preview_token TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE attendee_message_deliveries (
  campaign_id TEXT NOT NULL REFERENCES attendee_message_campaigns(id) ON DELETE CASCADE,
  email_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'failed', 'unknown', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  message_id TEXT,
  PRIMARY KEY(campaign_id, email_hash)
);
CREATE INDEX attendee_message_delivery_status ON attendee_message_deliveries(campaign_id, status);

CREATE TABLE newsletter_subscribers (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL UNIQUE,
  email_ciphertext TEXT,
  email_iv TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'subscribed', 'unsubscribed')),
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  confirmed_at TEXT,
  unsubscribed_at TEXT,
  confirmation_hash TEXT UNIQUE,
  confirmation_expires_at TEXT
);
CREATE TABLE newsletter_consent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscriber_id TEXT NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('requested', 'confirmed', 'unsubscribed')),
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX newsletter_events_subscriber ON newsletter_consent_events(subscriber_id, id);
CREATE TABLE newsletter_signup_limits (
  ip_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

CREATE TRIGGER newsletter_requested_insert AFTER INSERT ON newsletter_subscribers
BEGIN INSERT INTO newsletter_consent_events(subscriber_id, action, consent_version, consent_text, occurred_at) VALUES(NEW.id, 'requested', NEW.consent_version, NEW.consent_text, NEW.requested_at); END;
CREATE TRIGGER newsletter_requested_update AFTER UPDATE OF confirmation_hash ON newsletter_subscribers
WHEN NEW.confirmation_hash IS NOT NULL AND NEW.confirmation_hash IS NOT OLD.confirmation_hash
BEGIN INSERT INTO newsletter_consent_events(subscriber_id, action, consent_version, consent_text, occurred_at) VALUES(NEW.id, 'requested', NEW.consent_version, NEW.consent_text, NEW.requested_at); END;
CREATE TRIGGER newsletter_confirmed AFTER UPDATE OF status ON newsletter_subscribers
WHEN NEW.status = 'subscribed' AND OLD.status != 'subscribed'
BEGIN INSERT INTO newsletter_consent_events(subscriber_id, action, consent_version, consent_text, occurred_at) VALUES(NEW.id, 'confirmed', NEW.consent_version, NEW.consent_text, NEW.confirmed_at); END;
CREATE TRIGGER newsletter_unsubscribed AFTER UPDATE OF status ON newsletter_subscribers
WHEN NEW.status = 'unsubscribed' AND OLD.status != 'unsubscribed'
BEGIN INSERT INTO newsletter_consent_events(subscriber_id, action, consent_version, consent_text, occurred_at) VALUES(NEW.id, 'unsubscribed', NEW.consent_version, NEW.consent_text, NEW.unsubscribed_at); END;
