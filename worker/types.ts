export type JsonObject = Record<string, unknown>;

export interface TurnstileOutcome {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
}

export interface EncryptedText {
  ciphertext: string;
  iv: string;
}

export interface BackupManifest {
  rows_hash?: string;
}

export interface StripeCheckoutSession {
  amount_total?: number | null;
  currency?: string | null;
  customer_details?: {
    email?: string | null;
  } | null;
  customer_email?: string | null;
  id: string;
  metadata?: Record<string, string>;
  payment_intent?: string | null;
  payment_status?: string | null;
  status?: string | null;
}

export interface StripeEvent {
  data?: {
    object?: unknown;
  };
  id?: string;
  type?: string;
}

export interface TicketTier {
  availableFrom?: string | undefined;
  availableUntil?: string | undefined;
  capacity: number;
  currency?: string | undefined;
  discountCouponId?: string | undefined;
  id: string;
  isActive: boolean;
  label: string;
  priceId: string;
  priceLabel?: string | undefined;
  sortOrder: number;
}

export interface TicketTierAvailability extends TicketTier {
  availableQuantity: number;
  isOnSale: boolean;
  reservedQuantity: number;
}

export interface TicketTierRow {
  available_from: string | null;
  available_until: string | null;
  capacity: number;
  currency: string | null;
  discount_coupon_id: string | null;
  id: string;
  is_active: number;
  label: string;
  price_label: string | null;
  sort_order: number;
  stripe_price_id: string;
}

export interface AdminInterestRow {
  created_at: string;
  email_ciphertext: string;
  email_iv: string;
  name_ciphertext: string | null;
  name_iv: string | null;
  organization_ciphertext: string | null;
  organization_iv: string | null;
}

export interface AdminOrderRow {
  amount_total: number | null;
  created_at: string;
  currency: string | null;
  email_ciphertext: string | null;
  email_iv: string | null;
  order_status: string;
  payment_status: string;
  quantity: number;
  stripe_session_id: string;
  ticket_tier_label: string | null;
}

export interface AdminCfpProposalRow {
  bio_ciphertext: string | null;
  bio_iv: string | null;
  created_at: string;
  email_ciphertext: string;
  email_iv: string;
  format: string;
  id: number;
  name_ciphertext: string;
  name_iv: string;
  organization_ciphertext: string | null;
  organization_iv: string | null;
  summary_ciphertext: string;
  summary_iv: string;
  title_ciphertext: string;
  title_iv: string;
}

export interface ScheduleEntryRow {
  cfp_proposal_id: number | null;
  created_at: string;
  description: string | null;
  ends_at: string | null;
  entry_type: string;
  id: number;
  is_published: number;
  location: string | null;
  organization: string | null;
  presenter: string | null;
  sort_order: number;
  starts_at: string;
  title: string;
  updated_at: string;
}

export interface FeatureFlagRow {
  description: string | null;
  enabled: number;
  key: string;
  label: string;
  updated_at: string;
}

export interface LocalCheckoutOrder {
  quantity: number;
  reservation_id: string | null;
  stripe_price_id: string | null;
  ticket_tier_id: string | null;
}
