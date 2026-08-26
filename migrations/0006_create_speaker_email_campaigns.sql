ALTER TABLE speaker_contacts
  ADD COLUMN operational_email_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (operational_email_enabled IN (0, 1));

ALTER TABLE speaker_contacts
  ADD COLUMN promotion_email_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (promotion_email_enabled IN (0, 1));

ALTER TABLE speaker_contacts
  ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'active'
  CHECK (delivery_status IN ('active', 'suppressed'));

CREATE TABLE IF NOT EXISTS speaker_email_campaigns (
  campaign_id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('operational', 'promotion')),
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'partial', 'failed')),
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS speaker_email_campaigns_created_at_idx
  ON speaker_email_campaigns (created_at DESC);

CREATE TABLE IF NOT EXISTS speaker_email_deliveries (
  campaign_id TEXT NOT NULL,
  speaker_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  sent_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, speaker_id),
  FOREIGN KEY (campaign_id) REFERENCES speaker_email_campaigns (campaign_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS speaker_email_deliveries_status_idx
  ON speaker_email_deliveries (campaign_id, status);
