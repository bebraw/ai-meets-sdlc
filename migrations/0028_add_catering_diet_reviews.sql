-- Manual classifications and catering notes remain encrypted and admin-only.
ALTER TABLE attendee_roster ADD COLUMN catering_reviews_ciphertext TEXT;
ALTER TABLE attendee_roster ADD COLUMN catering_reviews_iv TEXT;
