ALTER TABLE speaker_dinner_shared_responses ADD COLUMN email_ciphertext TEXT;
ALTER TABLE speaker_dinner_shared_responses ADD COLUMN email_iv TEXT;
ALTER TABLE speaker_dinner_shared_responses ADD COLUMN email_revision INTEGER NOT NULL DEFAULT 0;

ALTER TABLE speaker_email_campaigns ADD COLUMN include_dinner INTEGER NOT NULL DEFAULT 0;
ALTER TABLE speaker_email_campaigns ADD COLUMN speaker_text_body TEXT NOT NULL DEFAULT '';
ALTER TABLE speaker_email_campaigns ADD COLUMN dinner_text_body TEXT NOT NULL DEFAULT '';
ALTER TABLE speaker_email_campaigns ADD COLUMN confirmation_token TEXT;
CREATE UNIQUE INDEX speaker_email_campaigns_confirmation_idx ON speaker_email_campaigns (confirmation_token);

ALTER TABLE speaker_email_deliveries ADD COLUMN source_ids TEXT;
ALTER TABLE speaker_email_deliveries ADD COLUMN email_fingerprint TEXT;
ALTER TABLE speaker_email_deliveries ADD COLUMN claim_token TEXT;
