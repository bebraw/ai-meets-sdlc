-- Keep identity links encrypted alongside the roster, without copying dinner diets.
ALTER TABLE attendee_roster ADD COLUMN catering_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendee_roster ADD COLUMN catering_ciphertext TEXT;
ALTER TABLE attendee_roster ADD COLUMN catering_iv TEXT;
