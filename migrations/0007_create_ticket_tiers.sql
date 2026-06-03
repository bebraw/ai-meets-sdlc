CREATE TABLE IF NOT EXISTS ticket_tiers (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  price_label TEXT,
  currency TEXT,
  capacity INTEGER NOT NULL,
  discount_coupon_id TEXT,
  available_from TEXT,
  available_until TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_tiers_active_sort
  ON ticket_tiers (is_active, sort_order);
