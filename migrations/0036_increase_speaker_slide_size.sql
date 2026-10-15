-- Preserve uploads and publication states while raising the limit to 50 MiB.
CREATE TABLE speaker_slides_larger_files (
  slide_id TEXT PRIMARY KEY,
  speaker_id TEXT NOT NULL,
  talk_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('pdf', 'powerpoint', 'html')),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 52428800),
  content_hash TEXT NOT NULL,
  may_publish INTEGER NOT NULL DEFAULT 0 CHECK (may_publish IN (0, 1)),
  published_at TEXT,
  uploaded_at TEXT NOT NULL,
  UNIQUE (talk_id, format),
  CHECK (published_at IS NULL OR (format = 'pdf' AND may_publish = 1))
);

INSERT INTO speaker_slides_larger_files SELECT * FROM speaker_slides;
DROP TABLE speaker_slides;
ALTER TABLE speaker_slides_larger_files RENAME TO speaker_slides;

CREATE TRIGGER digest_speaker_slides_added AFTER INSERT ON speaker_slides BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_slides', 'added'); END;
CREATE TRIGGER digest_speaker_slides_updated AFTER UPDATE ON speaker_slides BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_slides', 'updated'); END;
CREATE TRIGGER digest_speaker_slides_deleted AFTER DELETE ON speaker_slides BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_slides', 'deleted'); END;
