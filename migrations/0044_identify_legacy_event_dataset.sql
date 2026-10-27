-- Ownership metadata only: no existing content, links, permissions or consent move.
CREATE TABLE event_dataset (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  event_id TEXT NOT NULL UNIQUE
);
INSERT INTO event_dataset (id, event_id) VALUES (1, '2026');
