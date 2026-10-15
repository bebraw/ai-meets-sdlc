ALTER TABLE speaker_slide_links ADD COLUMN kind TEXT NOT NULL DEFAULT 'presentation'
  CHECK (kind IN ('presentation', 'resource'));

-- The organizer selected this publication as supporting material for Tapio's talk.
UPDATE speaker_slide_links SET kind = 'resource', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE talk_id = 'agentic-discovery'
  AND url = 'https://longshoreforrest.github.io/publications/agentic-discovery/';

CREATE TABLE speaker_recording_links (
  talk_id TEXT PRIMARY KEY,
  speaker_id TEXT NOT NULL,
  url TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER digest_speaker_recording_links_added AFTER INSERT ON speaker_recording_links BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_recording_links', 'added'); END;
CREATE TRIGGER digest_speaker_recording_links_updated AFTER UPDATE ON speaker_recording_links BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_recording_links', 'updated'); END;
CREATE TRIGGER digest_speaker_recording_links_deleted AFTER DELETE ON speaker_recording_links BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_recording_links', 'deleted'); END;
