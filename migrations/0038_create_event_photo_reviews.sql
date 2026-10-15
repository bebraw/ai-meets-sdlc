CREATE TABLE IF NOT EXISTS event_photo_reviews (
  photo_id TEXT PRIMARY KEY,
  review_json TEXT NOT NULL CHECK (json_valid(review_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL
);
