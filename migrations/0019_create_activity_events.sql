-- A compact organizer activity trail. Never store submitted values, tokens, or emails.
CREATE TABLE activity_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('speaker', 'admin')),
  actor_id TEXT NOT NULL,
  subject_speaker_id TEXT,
  category TEXT NOT NULL,
  action TEXT NOT NULL
);

CREATE INDEX activity_events_recent_idx ON activity_events(event_id DESC);
CREATE INDEX activity_events_speaker_idx ON activity_events(subject_speaker_id, event_id DESC);
