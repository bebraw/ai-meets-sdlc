import type {
  LocalCheckoutOrder,
  StripeCheckoutSession,
  TicketTier,
} from "../types";
import { encryptText, hashEmail } from "../utils/crypto";
import {
  normalizeEmail,
  normalizeOptionalText,
  normalizeQuantity,
  normalizeStripeId,
} from "../utils/normalize";

export async function upsertOrderFromCheckoutSession({
  env,
  eventId,
  orderStatus,
  session,
}: {
  env: Env;
  eventId?: string | undefined;
  orderStatus: string;
  session: StripeCheckoutSession;
}): Promise<void> {
  const email = normalizeEmail(
    session.customer_details?.email ?? session.customer_email ?? null,
  );
  const encryptedEmail =
    email && env.EMAIL_ENCRYPTION_KEY
      ? await encryptText(email, env.EMAIL_ENCRYPTION_KEY)
      : null;
  const emailHash =
    email && env.EMAIL_ENCRYPTION_KEY
      ? await hashEmail(email, env.EMAIL_ENCRYPTION_KEY)
      : null;
  const quantity = normalizeQuantity(session.metadata?.quantity ?? null) || 1;
  const ticketTierId = normalizeOptionalText(
    session.metadata?.ticket_tier ?? null,
    80,
  );
  const ticketTierLabel = normalizeOptionalText(
    session.metadata?.ticket_tier_label ?? null,
    120,
  );
  const ticketPriceId = normalizeStripeId(
    session.metadata?.ticket_price_id ?? null,
    255,
  );
  const reservationId = normalizeOptionalText(
    session.metadata?.reservation_id ?? null,
    80,
  );
  const reservationExpiresAt = normalizeOptionalText(
    session.metadata?.reservation_expires_at ?? null,
    40,
  );
  const updatedAt = new Date().toISOString();

  await env.INTERESTS.prepare(
    `INSERT INTO orders (
      stripe_session_id,
      stripe_payment_intent_id,
      ticket_tier_id,
      ticket_tier_label,
      stripe_price_id,
      reservation_id,
      email_hash,
      email_ciphertext,
      email_iv,
      quantity,
      amount_total,
      currency,
      checkout_status,
      payment_status,
      order_status,
      stripe_event_id,
      reservation_expires_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stripe_session_id) DO UPDATE SET
      stripe_payment_intent_id = excluded.stripe_payment_intent_id,
      ticket_tier_id = COALESCE(excluded.ticket_tier_id, orders.ticket_tier_id),
      ticket_tier_label = COALESCE(
        excluded.ticket_tier_label,
        orders.ticket_tier_label
      ),
      stripe_price_id = COALESCE(excluded.stripe_price_id, orders.stripe_price_id),
      reservation_id = COALESCE(excluded.reservation_id, orders.reservation_id),
      email_hash = COALESCE(excluded.email_hash, orders.email_hash),
      email_ciphertext = COALESCE(
        excluded.email_ciphertext,
        orders.email_ciphertext
      ),
      email_iv = COALESCE(excluded.email_iv, orders.email_iv),
      quantity = excluded.quantity,
      amount_total = excluded.amount_total,
      currency = excluded.currency,
      checkout_status = excluded.checkout_status,
      payment_status = excluded.payment_status,
      order_status = excluded.order_status,
      stripe_event_id = COALESCE(excluded.stripe_event_id, orders.stripe_event_id),
      reservation_expires_at = COALESCE(
        excluded.reservation_expires_at,
        orders.reservation_expires_at
      ),
      updated_at = excluded.updated_at`,
  )
    .bind(
      session.id,
      session.payment_intent ?? null,
      ticketTierId || null,
      ticketTierLabel || null,
      ticketPriceId || null,
      reservationId || null,
      emailHash,
      encryptedEmail?.ciphertext ?? null,
      encryptedEmail?.iv ?? null,
      quantity,
      session.amount_total ?? null,
      session.currency ?? null,
      session.status ?? "open",
      session.payment_status ?? "unpaid",
      orderStatus,
      eventId ?? null,
      reservationExpiresAt || null,
      updatedAt,
      updatedAt,
    )
    .run();
}

export async function getVerifiedLocalCheckoutOrder(
  env: Env,
  session: StripeCheckoutSession,
): Promise<LocalCheckoutOrder | null> {
  if (
    session.metadata?.event !== "SDLCAI" &&
    session.metadata?.event !== "AI meets SDLC"
  ) {
    return null;
  }

  const reservationId = normalizeOptionalText(
    session.metadata?.reservation_id ?? null,
    80,
  );
  const ticketTierId = normalizeOptionalText(
    session.metadata?.ticket_tier ?? null,
    80,
  );
  const ticketPriceId = normalizeStripeId(
    session.metadata?.ticket_price_id ?? null,
    255,
  );
  const quantity = normalizeQuantity(session.metadata?.quantity ?? null);

  if (!reservationId || !ticketTierId || !ticketPriceId || !quantity) {
    return null;
  }

  const order = await env.INTERESTS.prepare(
    `SELECT quantity, reservation_id, ticket_tier_id, stripe_price_id
    FROM orders
    WHERE stripe_session_id = ?`,
  )
    .bind(session.id)
    .first<LocalCheckoutOrder>();

  if (!order) return null;

  if (
    order.quantity !== quantity ||
    order.reservation_id !== reservationId ||
    order.ticket_tier_id !== ticketTierId ||
    order.stripe_price_id !== ticketPriceId
  ) {
    return null;
  }

  const reservation = await env.INTERESTS.prepare(
    `SELECT id
    FROM ticket_reservations
    WHERE id = ?
      AND stripe_session_id = ?
      AND ticket_tier_id = ?`,
  )
    .bind(reservationId, session.id, ticketTierId)
    .first<{ id: string }>();

  return reservation ? order : null;
}

export async function holdTicketReservation({
  env,
  expiresAt,
  quantity,
  tier,
}: {
  env: Env;
  expiresAt: string;
  quantity: number;
  tier: TicketTier;
}): Promise<string> {
  const now = new Date().toISOString();
  const reservationId = crypto.randomUUID();
  const result = await env.INTERESTS.prepare(
    `INSERT INTO ticket_reservations (
      id,
      ticket_tier_id,
      quantity,
      status,
      expires_at,
      created_at,
      updated_at
    )
    SELECT ?, ?, ?, 'held', ?, ?, ?
    WHERE (
      SELECT COALESCE(SUM(quantity), 0)
      FROM orders
      WHERE ticket_tier_id = ?
        AND order_status = 'paid'
    ) + (
      SELECT COALESCE(SUM(quantity), 0)
      FROM ticket_reservations
      WHERE ticket_tier_id = ?
        AND status = 'held'
        AND expires_at > ?
    ) + ? <= ?`,
  )
    .bind(
      reservationId,
      tier.id,
      quantity,
      expiresAt,
      now,
      now,
      tier.id,
      tier.id,
      now,
      quantity,
      tier.capacity,
    )
    .run();

  return result.meta.changes === 1 ? reservationId : "";
}

export async function attachTicketReservationToSession({
  env,
  reservationId,
  sessionId,
}: {
  env: Env;
  reservationId: string;
  sessionId: string;
}): Promise<void> {
  const now = new Date().toISOString();

  await env.INTERESTS.prepare(
    `UPDATE ticket_reservations
    SET stripe_session_id = ?, updated_at = ?
    WHERE id = ?`,
  )
    .bind(sessionId, now, reservationId)
    .run();
}

export async function updateTicketReservationFromSession({
  env,
  orderStatus,
  session,
}: {
  env: Env;
  orderStatus: string;
  session: StripeCheckoutSession;
}): Promise<void> {
  const reservationId = normalizeOptionalText(
    session.metadata?.reservation_id ?? null,
    80,
  );

  if (!reservationId) return;

  await releaseTicketReservation({
    env,
    reservationId,
    status: orderStatus === "paid" ? "completed" : "released",
  });
}

export async function releaseTicketReservation({
  env,
  reservationId,
  status,
}: {
  env: Env;
  reservationId: string;
  status: "completed" | "released";
}): Promise<void> {
  const now = new Date().toISOString();

  await env.INTERESTS.prepare(
    `UPDATE ticket_reservations
    SET status = ?, updated_at = ?
    WHERE id = ? AND status = 'held'`,
  )
    .bind(status, now, reservationId)
    .run();
}
