CREATE TABLE attendee_roster (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  ciphertext TEXT,
  iv TEXT,
  updated_at TEXT NOT NULL
);
INSERT INTO attendee_roster (id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE registration_access_grants (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE registration_staff_sessions (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES registration_access_grants(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX registration_session_expiry ON registration_staff_sessions(expires_at);

CREATE TABLE attendee_arrivals (
  attendee_id TEXT PRIMARY KEY,
  arrived_at TEXT,
  arrived_by TEXT,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE attendee_arrival_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  attendee_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('arrived', 'undo')),
  occurred_at TEXT NOT NULL
);
CREATE TRIGGER attendee_arrival_insert AFTER INSERT ON attendee_arrivals
WHEN NEW.arrived_at IS NOT NULL
BEGIN
  INSERT INTO attendee_arrival_events (attendee_id, actor_id, action, occurred_at)
  VALUES (NEW.attendee_id, NEW.arrived_by, 'arrived', NEW.arrived_at); END;
CREATE TRIGGER attendee_arrival_update AFTER UPDATE ON attendee_arrivals
WHEN OLD.arrived_at IS NOT NEW.arrived_at
BEGIN
  INSERT INTO attendee_arrival_events (attendee_id, actor_id, action, occurred_at)
  VALUES (NEW.attendee_id, NEW.arrived_by, CASE WHEN NEW.arrived_at IS NULL THEN 'undo' ELSE 'arrived' END,
    COALESCE(NEW.arrived_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))); END;
CREATE TRIGGER digest_attendee_roster_updated AFTER UPDATE ON attendee_roster
BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('attendee_roster', 'updated'); END;
CREATE TRIGGER digest_attendee_arrivals_added AFTER INSERT ON attendee_arrivals
BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('attendee_arrivals', 'added'); END;
CREATE TRIGGER digest_attendee_arrivals_updated AFTER UPDATE ON attendee_arrivals
BEGIN INSERT INTO organizer_data_changes (table_name, operation) VALUES ('attendee_arrivals', 'updated'); END;
