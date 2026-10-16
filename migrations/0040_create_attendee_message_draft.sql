CREATE TABLE attendee_message_draft (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  subject TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

INSERT INTO attendee_message_draft (id) VALUES (1);
