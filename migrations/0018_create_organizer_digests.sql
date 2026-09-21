-- Delivery leases prevent overlapping hourly runs from sending the same digest.
CREATE TABLE organizer_digests (
  kind TEXT NOT NULL CHECK (kind IN ('posters', 'data')),
  period TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'empty', 'failed')),
  attempt_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  lease_until TEXT NOT NULL,
  through_change_id INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, period)
);

-- Store only category, operation and time; never private values or auth tokens.
CREATE TABLE organizer_data_changes (
  change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('added', 'updated', 'deleted')),
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One-line trigger bodies also work with the test migration statement splitter.
CREATE TRIGGER digest_interests_added AFTER INSERT ON interests BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('interests', 'added'); END;

CREATE TRIGGER digest_interests_updated AFTER UPDATE ON interests BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('interests', 'updated'); END;

CREATE TRIGGER digest_interests_deleted AFTER DELETE ON interests BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('interests', 'deleted'); END;

CREATE TRIGGER digest_poster_proposals_added AFTER INSERT ON poster_proposals BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('poster_proposals', 'added'); END;

CREATE TRIGGER digest_poster_proposals_updated AFTER UPDATE ON poster_proposals BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('poster_proposals', 'updated'); END;

CREATE TRIGGER digest_poster_proposals_deleted AFTER DELETE ON poster_proposals BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('poster_proposals', 'deleted'); END;

CREATE TRIGGER digest_speaker_contacts_added AFTER INSERT ON speaker_contacts BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_contacts', 'added'); END;

CREATE TRIGGER digest_speaker_contacts_updated AFTER UPDATE ON speaker_contacts BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_contacts', 'updated'); END;

CREATE TRIGGER digest_speaker_contacts_deleted AFTER DELETE ON speaker_contacts BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_contacts', 'deleted'); END;

CREATE TRIGGER digest_canonical_speaker_content_added AFTER INSERT ON canonical_speaker_content BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('canonical_speaker_content', 'added'); END;

CREATE TRIGGER digest_canonical_speaker_content_updated AFTER UPDATE ON canonical_speaker_content BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('canonical_speaker_content', 'updated'); END;

CREATE TRIGGER digest_canonical_speaker_content_deleted AFTER DELETE ON canonical_speaker_content BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('canonical_speaker_content', 'deleted'); END;

CREATE TRIGGER digest_speaker_content_revisions_added AFTER INSERT ON speaker_content_revisions BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_content_revisions', 'added'); END;

CREATE TRIGGER digest_speaker_content_revisions_updated AFTER UPDATE ON speaker_content_revisions BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_content_revisions', 'updated'); END;

CREATE TRIGGER digest_speaker_content_revisions_deleted AFTER DELETE ON speaker_content_revisions BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_content_revisions', 'deleted'); END;

CREATE TRIGGER digest_speaker_photo_revisions_added AFTER INSERT ON speaker_photo_revisions BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_photo_revisions', 'added'); END;

CREATE TRIGGER digest_speaker_photo_revisions_updated AFTER UPDATE ON speaker_photo_revisions BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_photo_revisions', 'updated'); END;

CREATE TRIGGER digest_speaker_photo_revisions_deleted AFTER DELETE ON speaker_photo_revisions BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_photo_revisions', 'deleted'); END;

CREATE TRIGGER digest_speaker_video_submissions_added AFTER INSERT ON speaker_video_submissions BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_video_submissions', 'added'); END;

CREATE TRIGGER digest_speaker_video_submissions_updated AFTER UPDATE ON speaker_video_submissions BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_video_submissions', 'updated'); END;

CREATE TRIGGER digest_speaker_video_submissions_deleted AFTER DELETE ON speaker_video_submissions BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_video_submissions', 'deleted'); END;

CREATE TRIGGER digest_speaker_presentation_responses_added AFTER INSERT ON speaker_presentation_responses BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_presentation_responses', 'added'); END;

CREATE TRIGGER digest_speaker_presentation_responses_updated AFTER UPDATE ON speaker_presentation_responses BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_presentation_responses', 'updated'); END;

CREATE TRIGGER digest_speaker_presentation_responses_deleted AFTER DELETE ON speaker_presentation_responses BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_presentation_responses', 'deleted'); END;

CREATE TRIGGER digest_speaker_dinner_responses_added AFTER INSERT ON speaker_dinner_responses BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_dinner_responses', 'added'); END;

CREATE TRIGGER digest_speaker_dinner_responses_updated AFTER UPDATE ON speaker_dinner_responses BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_dinner_responses', 'updated'); END;

CREATE TRIGGER digest_speaker_dinner_responses_deleted AFTER DELETE ON speaker_dinner_responses BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_dinner_responses', 'deleted'); END;

CREATE TRIGGER digest_speaker_dinner_shared_responses_added AFTER INSERT ON speaker_dinner_shared_responses BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_dinner_shared_responses', 'added'); END;

CREATE TRIGGER digest_speaker_dinner_shared_responses_updated AFTER UPDATE ON speaker_dinner_shared_responses BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_dinner_shared_responses', 'updated'); END;

CREATE TRIGGER digest_speaker_dinner_shared_responses_deleted AFTER DELETE ON speaker_dinner_shared_responses BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_dinner_shared_responses', 'deleted'); END;

CREATE TRIGGER digest_speaker_travel_receipts_added AFTER INSERT ON speaker_travel_receipts BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_travel_receipts', 'added'); END;

CREATE TRIGGER digest_speaker_travel_receipts_updated AFTER UPDATE ON speaker_travel_receipts BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_travel_receipts', 'updated'); END;

CREATE TRIGGER digest_speaker_travel_receipts_deleted AFTER DELETE ON speaker_travel_receipts BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('speaker_travel_receipts', 'deleted'); END;

CREATE TRIGGER digest_volunteers_added AFTER INSERT ON volunteers BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('volunteers', 'added'); END;

CREATE TRIGGER digest_volunteers_updated AFTER UPDATE ON volunteers BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('volunteers', 'updated'); END;

CREATE TRIGGER digest_volunteers_deleted AFTER DELETE ON volunteers BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('volunteers', 'deleted'); END;

CREATE TRIGGER digest_schedule_order_added AFTER INSERT ON schedule_order BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('schedule_order', 'added'); END;

CREATE TRIGGER digest_schedule_order_updated AFTER UPDATE ON schedule_order BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('schedule_order', 'updated'); END;

CREATE TRIGGER digest_schedule_order_deleted AFTER DELETE ON schedule_order BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('schedule_order', 'deleted'); END;

