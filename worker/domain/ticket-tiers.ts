import type {
  TicketTier,
  TicketTierAvailability,
  TicketTierRow,
} from "../types";

export async function getTicketTiers(
  env: Env,
  options: { includeInactive?: boolean } = {},
): Promise<TicketTier[]> {
  if (!env.INTERESTS) return [];

  const rows = await env.INTERESTS.prepare(
    `SELECT
      id,
      label,
      stripe_price_id,
      price_label,
      currency,
      capacity,
      discount_coupon_id,
      available_from,
      available_until,
      sort_order,
      is_active
    FROM ticket_tiers
    ${options.includeInactive ? "" : "WHERE is_active = 1"}
    ORDER BY sort_order ASC, id ASC`,
  ).all<TicketTierRow>();

  return (rows.results ?? []).map((row) => ({
    availableFrom: row.available_from ?? undefined,
    availableUntil: row.available_until ?? undefined,
    capacity: row.capacity,
    currency: row.currency ?? undefined,
    discountCouponId: row.discount_coupon_id ?? undefined,
    id: row.id,
    isActive: row.is_active === 1,
    label: row.label,
    priceId: row.stripe_price_id,
    priceLabel: row.price_label ?? undefined,
    sortOrder: row.sort_order,
  }));
}

export async function getTicketTierAvailability(
  env: Env,
  tiers: TicketTier[],
  now: Date,
): Promise<TicketTierAvailability[]> {
  if (tiers.length === 0) return [];

  const activeReservationCutoff = now.toISOString();
  const placeholders = tiers.map(() => "?").join(", ");
  const paidOrders = await env.INTERESTS.prepare(
    `SELECT ticket_tier_id, SUM(quantity) AS reserved_quantity
    FROM orders
    WHERE ticket_tier_id IN (${placeholders})
      AND order_status = 'paid'
    GROUP BY ticket_tier_id`,
  )
    .bind(...tiers.map((tier) => tier.id))
    .all<{ reserved_quantity: number | null; ticket_tier_id: string }>();
  const heldReservations = await env.INTERESTS.prepare(
    `SELECT ticket_tier_id, SUM(quantity) AS reserved_quantity
    FROM ticket_reservations
    WHERE ticket_tier_id IN (${placeholders})
      AND status = 'held'
      AND expires_at > ?
    GROUP BY ticket_tier_id`,
  )
    .bind(...tiers.map((tier) => tier.id), activeReservationCutoff)
    .all<{ reserved_quantity: number | null; ticket_tier_id: string }>();
  const reservedByTier = new Map<string, number>();

  for (const row of [
    ...(paidOrders.results ?? []),
    ...(heldReservations.results ?? []),
  ]) {
    reservedByTier.set(
      row.ticket_tier_id,
      (reservedByTier.get(row.ticket_tier_id) ?? 0) +
        Number(row.reserved_quantity ?? 0),
    );
  }

  return tiers.map((tier) => {
    const reservedQuantity = reservedByTier.get(tier.id) ?? 0;
    const isAfterStart =
      !tier.availableFrom || now.getTime() >= Date.parse(tier.availableFrom);
    const isBeforeEnd =
      !tier.availableUntil || now.getTime() < Date.parse(tier.availableUntil);

    return {
      ...tier,
      availableQuantity: Math.max(0, tier.capacity - reservedQuantity),
      isOnSale: tier.isActive && isAfterStart && isBeforeEnd,
      reservedQuantity,
    };
  });
}
