ALTER TABLE speaker_dinner_responses
  ADD COLUMN attendance_override_ciphertext TEXT;

ALTER TABLE speaker_dinner_responses
  ADD COLUMN attendance_override_iv TEXT CHECK (
    (attendance_override_ciphertext IS NULL AND attendance_override_iv IS NULL) OR
    (attendance_override_ciphertext IS NOT NULL AND attendance_override_iv IS NOT NULL)
  );

ALTER TABLE speaker_dinner_responses
  ADD COLUMN dinner_revision INTEGER NOT NULL DEFAULT 0 CHECK (dinner_revision >= 0);
