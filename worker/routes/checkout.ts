import type { StripeCheckoutSession } from "../types";
import { isCheckoutEnabled } from "../domain/feature-flags";
import {
  attachTicketReservationToSession,
  holdTicketReservation,
  releaseTicketReservation,
  upsertOrderFromCheckoutSession,
} from "../domain/orders";
import {
  getTicketTierAvailability,
  getTicketTiers,
} from "../domain/ticket-tiers";
import {
  isLikelyEmail,
  normalizeEmail,
  normalizeOptionalText,
  normalizeQuantity,
} from "../utils/normalize";
import { getRequestOrigin } from "../utils/request";
import { jsonResponse } from "../utils/response";

const CHECKOUT_RESERVATION_SECONDS = 30 * 60;
const CHECKOUT_RESERVATION_MS = CHECKOUT_RESERVATION_SECONDS * 1000;

export async function handleCheckout(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!(await isCheckoutEnabled(env))) {
    return jsonResponse({ error: "Ticket checkout is not open yet" }, 503);
  }

  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "Ticket checkout is not configured" }, 503);
  }

  if (!env.INTERESTS || !env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Order tracking is not configured" }, 503);
  }

  const formData = await request.formData();
  const email = normalizeEmail(formData.get("email"));
  const quantity = normalizeQuantity(formData.get("quantity"));
  const selectedTierId = normalizeOptionalText(formData.get("ticket_tier"), 80);
  const tiers = await getTicketTiers(env);

  if (tiers.length === 0) {
    return jsonResponse({ error: "Ticket tiers are not configured" }, 503);
  }

  const tierAvailability = await getTicketTierAvailability(
    env,
    tiers,
    new Date(),
  );
  const selectedTier = tierAvailability.find(
    (tier) => tier.id === selectedTierId,
  );
  const origin = getRequestOrigin(request);
  const successUrl =
    env.STRIPE_SUCCESS_URL ||
    `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}#tickets`;
  const cancelUrl = env.STRIPE_CANCEL_URL || `${origin}/#tickets`;

  if (!quantity) {
    return jsonResponse({ error: "Choose between 1 and 10 tickets" }, 400);
  }

  if (!selectedTier) {
    return jsonResponse({ error: "Choose an available ticket tier" }, 400);
  }

  if (!selectedTier.isOnSale) {
    return jsonResponse({ error: `${selectedTier.label} is not on sale` }, 400);
  }

  if (selectedTier.availableQuantity < quantity) {
    return jsonResponse(
      {
        error:
          selectedTier.availableQuantity > 0
            ? `Only ${selectedTier.availableQuantity} ${selectedTier.label} ticket${selectedTier.availableQuantity === 1 ? "" : "s"} left`
            : `${selectedTier.label} is sold out`,
      },
      409,
    );
  }

  if (email && !isLikelyEmail(email)) {
    return jsonResponse({ error: "Enter a valid email address" }, 400);
  }

  const reservationExpiresAt = new Date(
    Date.now() + CHECKOUT_RESERVATION_MS,
  ).toISOString();
  const reservationId = await holdTicketReservation({
    env,
    expiresAt: reservationExpiresAt,
    quantity,
    tier: selectedTier,
  });

  if (!reservationId) {
    return jsonResponse(
      { error: `${selectedTier.label} does not have enough tickets left` },
      409,
    );
  }

  const payload = new URLSearchParams({
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    expires_at: String(
      Math.floor(Date.now() / 1000) + CHECKOUT_RESERVATION_SECONDS,
    ),
    "line_items[0][price]": selectedTier.priceId,
    "line_items[0][quantity]": String(quantity),
    billing_address_collection: "auto",
    "metadata[event]": "SDLCAI",
    "metadata[event_date]": "2026-10-13",
    "metadata[reservation_id]": reservationId,
    "metadata[reservation_expires_at]": reservationExpiresAt,
    "metadata[ticket_price_id]": selectedTier.priceId,
    "metadata[ticket_tier]": selectedTier.id,
    "metadata[ticket_tier_label]": selectedTier.label,
  });

  if (selectedTier.discountCouponId) {
    payload.set("discounts[0][coupon]", selectedTier.discountCouponId);
    payload.set("metadata[discount_coupon_id]", selectedTier.discountCouponId);
  } else {
    payload.set("allow_promotion_codes", "true");
  }

  if (email) {
    payload.set("customer_email", email);
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: payload,
  });
  const session = (await response.json()) as StripeCheckoutSession & {
    error?: { message?: string };
    url?: string;
  };

  if (!response.ok || !session.url || !session.id) {
    await releaseTicketReservation({
      env,
      reservationId,
      status: "released",
    });

    console.error("Stripe Checkout session creation failed", {
      status: response.status,
      stripeSessionId: session.id,
      message: session.error?.message,
    });

    return jsonResponse(
      { error: session.error?.message || "Could not start checkout" },
      response.status >= 400 && response.status < 500 ? 400 : 502,
    );
  }

  await upsertOrderFromCheckoutSession({
    env,
    session: {
      ...session,
      customer_email: email || session.customer_email || null,
      metadata: {
        quantity: String(quantity),
        reservation_id: reservationId,
        reservation_expires_at: reservationExpiresAt,
        ...(selectedTier.discountCouponId
          ? { discount_coupon_id: selectedTier.discountCouponId }
          : {}),
        ticket_price_id: selectedTier.priceId,
        ticket_tier: selectedTier.id,
        ticket_tier_label: selectedTier.label,
        ...session.metadata,
      },
    },
    orderStatus: "pending",
  });

  await attachTicketReservationToSession({
    env,
    reservationId,
    sessionId: session.id,
  });

  return jsonResponse({ ok: true, session_id: session.id, url: session.url });
}
