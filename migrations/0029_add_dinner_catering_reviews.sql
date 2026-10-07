-- Dinner classifications and instructions have the same retention as dinner answers.
CREATE TABLE speaker_dinner_catering (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  reviews_ciphertext TEXT,
  reviews_iv TEXT,
  CHECK ((reviews_ciphertext IS NULL) = (reviews_iv IS NULL))
);

INSERT INTO speaker_dinner_catering (id) VALUES (1);

-- Digest tracking records only the table, operation and time.
CREATE TRIGGER digest_speaker_dinner_catering_added AFTER INSERT ON speaker_dinner_catering BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_dinner_catering', 'added'); END;

CREATE TRIGGER digest_speaker_dinner_catering_updated AFTER UPDATE ON speaker_dinner_catering BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_dinner_catering', 'updated'); END;

CREATE TRIGGER digest_speaker_dinner_catering_deleted AFTER DELETE ON speaker_dinner_catering BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_dinner_catering', 'deleted'); END;
