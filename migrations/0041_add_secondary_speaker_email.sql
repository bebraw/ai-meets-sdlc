ALTER TABLE speaker_contacts ADD COLUMN secondary_email_ciphertext TEXT;
ALTER TABLE speaker_contacts ADD COLUMN secondary_email_iv TEXT;
ALTER TABLE speaker_contacts ADD COLUMN secondary_email_fingerprint TEXT;
ALTER TABLE speaker_contacts ADD COLUMN secondary_email_confirmed_at TEXT;

CREATE UNIQUE INDEX speaker_contacts_secondary_email_fingerprint_idx
  ON speaker_contacts (secondary_email_fingerprint);

-- Both addresses identify the same workspace. Prevent cross-column collisions
-- atomically, including when two organizers save contacts at the same time.
CREATE TRIGGER speaker_contact_email_insert_unique
BEFORE INSERT ON speaker_contacts
WHEN EXISTS (
  SELECT 1 FROM speaker_contacts
  WHERE speaker_id <> NEW.speaker_id AND (
    email_fingerprint IN (NEW.email_fingerprint, NEW.secondary_email_fingerprint)
    OR secondary_email_fingerprint IN (NEW.email_fingerprint, NEW.secondary_email_fingerprint)
  )
)
BEGIN SELECT RAISE(ABORT, 'Speaker email already assigned'); END;

CREATE TRIGGER speaker_contact_email_update_unique
BEFORE UPDATE OF email_fingerprint, secondary_email_fingerprint ON speaker_contacts
WHEN EXISTS (
  SELECT 1 FROM speaker_contacts
  WHERE speaker_id <> NEW.speaker_id AND (
    email_fingerprint IN (NEW.email_fingerprint, NEW.secondary_email_fingerprint)
    OR secondary_email_fingerprint IN (NEW.email_fingerprint, NEW.secondary_email_fingerprint)
  )
)
BEGIN SELECT RAISE(ABORT, 'Speaker email already assigned'); END;

-- Track which address proved ownership without confirming the other address.
ALTER TABLE speaker_magic_links ADD COLUMN email_fingerprint TEXT;
