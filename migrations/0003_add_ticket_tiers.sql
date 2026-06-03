ALTER TABLE orders ADD COLUMN ticket_tier_id TEXT;
ALTER TABLE orders ADD COLUMN ticket_tier_label TEXT;
ALTER TABLE orders ADD COLUMN stripe_price_id TEXT;
ALTER TABLE orders ADD COLUMN reservation_id TEXT;
ALTER TABLE orders ADD COLUMN reservation_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_ticket_tier_id ON orders (ticket_tier_id);
CREATE INDEX IF NOT EXISTS idx_orders_reservation_id ON orders (reservation_id);
CREATE INDEX IF NOT EXISTS idx_orders_reservation_expires_at
  ON orders (reservation_expires_at);

CREATE TABLE IF NOT EXISTS ticket_reservations (
  id TEXT PRIMARY KEY,
  ticket_tier_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL,
  stripe_session_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_reservations_tier_status_expires
  ON ticket_reservations (ticket_tier_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_ticket_reservations_stripe_session_id
  ON ticket_reservations (stripe_session_id);
