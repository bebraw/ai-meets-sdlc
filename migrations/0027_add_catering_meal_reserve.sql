-- Keep meal planning separate from attendee identities and badge quantities.
ALTER TABLE attendee_roster ADD COLUMN catering_reserved_meals INTEGER NOT NULL DEFAULT 0
  CHECK (catering_reserved_meals BETWEEN 0 AND 2000);
