import type { TicketTier } from "../types";
import { getTicketTiers } from "../domain/ticket-tiers";
import { getAdminClientKeyHash } from "../utils/admin-auth";
import { encryptText, hashEmail } from "../utils/crypto";
import {
  isLikelyEmail,
  normalizeEmail,
  normalizeOptionalText,
  normalizeQuantity,
} from "../utils/normalize";
import { jsonResponse } from "../utils/response";

export async function handleAdminRegister(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.INTERESTS || !env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Admin storage is not configured" }, 503);
  }

  const formData = await request.formData();
  const email = normalizeEmail(formData.get("email"));
  const quantity = normalizeQuantity(formData.get("quantity"));
  const ticketTierId = normalizeOptionalText(formData.get("ticket_tier"), 80);
  const tier = (await getTicketTiers(env, { includeInactive: true })).find(
    (candidate) => candidate.id === ticketTierId,
  );

  if (!email || !isLikelyEmail(email)) {
    return jsonResponse({ error: "Enter a valid email address" }, 400);
  }

  if (!quantity) {
    return jsonResponse({ error: "Choose between 1 and 10 tickets" }, 400);
  }

  if (!tier) {
    return jsonResponse({ error: "Choose a ticket tier" }, 400);
  }

  if (!tier.isActive) {
    return jsonResponse({ error: `${tier.label} is inactive` }, 400);
  }

  const order = await insertManualRegistration({
    clientKeyHash: await getAdminClientKeyHash(request, env),
    email,
    env,
    quantity,
    tier,
  });

  if (!order) {
    return jsonResponse(
      { error: `${tier.label} does not have enough tickets left` },
      409,
    );
  }

  return jsonResponse({ ok: true, order });
}

async function insertManualRegistration({
  clientKeyHash,
  email,
  env,
  quantity,
  tier,
}: {
  clientKeyHash: string;
  email: string;
  env: Env;
  quantity: number;
  tier: TicketTier;
}) {
  const now = new Date().toISOString();
  const sessionId = `admin_manual_${crypto.randomUUID()}`;
  const encryptedEmail = await encryptText(email, env.EMAIL_ENCRYPTION_KEY);
  const emailHash = await hashEmail(email, env.EMAIL_ENCRYPTION_KEY);
  const result = await env.INTERESTS.prepare(
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
    )
    SELECT ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, 'manual', 'manual',
      'paid', NULL, NULL, ?, ?
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
      sessionId,
      tier.id,
      tier.label,
      tier.priceId,
      emailHash,
      encryptedEmail.ciphertext,
      encryptedEmail.iv,
      quantity,
      tier.currency ?? null,
      now,
      now,
      tier.id,
      tier.id,
      now,
      quantity,
      tier.capacity,
    )
    .run();

  if (result.meta.changes !== 1) return null;

  await env.INTERESTS.prepare(
    `INSERT INTO admin_registration_audit (
      order_stripe_session_id,
      email_hash,
      ticket_tier_id,
      quantity,
      client_key_hash,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(sessionId, emailHash, tier.id, quantity, clientKeyHash, now)
    .run();

  return {
    amount_total: null,
    created_at: now,
    currency: tier.currency ?? null,
    email,
    order_status: "paid",
    payment_status: "manual",
    quantity,
    stripe_session_id: sessionId,
    ticket_tier_label: tier.label,
  };
}
