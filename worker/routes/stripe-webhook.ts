import type { StripeEvent } from "../types";
import {
  getVerifiedLocalCheckoutOrder,
  updateTicketReservationFromSession,
  upsertOrderFromCheckoutSession,
} from "../domain/orders";
import {
  getOrderStatusFromSession,
  isStripeCheckoutSession,
  verifyStripeWebhookSignature,
} from "../utils/stripe";
import { jsonResponse } from "../utils/response";

export async function handleStripeWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ error: "Stripe webhook is not configured" }, 503);
  }

  if (!env.INTERESTS || !env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Order tracking is not configured" }, 503);
  }

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  if (
    !(await verifyStripeWebhookSignature({
      payload,
      secret: env.STRIPE_WEBHOOK_SECRET,
      signature,
    }))
  ) {
    return jsonResponse({ error: "Invalid Stripe signature" }, 400);
  }

  let event: StripeEvent;

  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return jsonResponse({ error: "Invalid Stripe payload" }, 400);
  }

  const session = isStripeCheckoutSession(event.data?.object)
    ? event.data.object
    : null;

  if (
    session &&
    (event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed" ||
      event.type === "checkout.session.expired")
  ) {
    if (!(await getVerifiedLocalCheckoutOrder(env, session))) {
      console.warn(
        "Ignoring Stripe Checkout event without matching local order",
        {
          eventId: event.id,
          eventType: event.type,
          stripeSessionId: session.id,
        },
      );

      return jsonResponse({ received: true, ignored: true });
    }

    const orderStatus = getOrderStatusFromSession(event.type, session);

    await upsertOrderFromCheckoutSession({
      env,
      eventId: event.id,
      session,
      orderStatus,
    });
    await updateTicketReservationFromSession({
      env,
      orderStatus,
      session,
    });
  }

  return jsonResponse({ received: true });
}
