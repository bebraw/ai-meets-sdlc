CREATE TABLE speaker_slides (
  slide_id TEXT PRIMARY KEY,
  speaker_id TEXT NOT NULL,
  talk_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('pdf', 'powerpoint')),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 26214400),
  content_hash TEXT NOT NULL,
  may_publish INTEGER NOT NULL DEFAULT 0 CHECK (may_publish IN (0, 1)),
  published_at TEXT,
  uploaded_at TEXT NOT NULL,
  UNIQUE (talk_id, format),
  CHECK (published_at IS NULL OR (format = 'pdf' AND may_publish = 1))
);

-- File removal is retried by scheduled cleanup if R2 is unavailable.
CREATE TABLE speaker_slide_garbage (
  r2_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TRIGGER digest_speaker_slides_added AFTER INSERT ON speaker_slides BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_slides', 'added'); END;

CREATE TRIGGER digest_speaker_slides_updated AFTER UPDATE ON speaker_slides BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_slides', 'updated'); END;

CREATE TRIGGER digest_speaker_slides_deleted AFTER DELETE ON speaker_slides BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_slides', 'deleted'); END;
