CREATE TABLE speaker_slide_links (
  talk_id TEXT PRIMARY KEY,
  speaker_id TEXT NOT NULL,
  url TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER digest_speaker_slide_links_added AFTER INSERT ON speaker_slide_links BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_slide_links', 'added'); END;

CREATE TRIGGER digest_speaker_slide_links_updated AFTER UPDATE ON speaker_slide_links BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_slide_links', 'updated'); END;

CREATE TRIGGER digest_speaker_slide_links_deleted AFTER DELETE ON speaker_slide_links BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_slide_links', 'deleted'); END;
