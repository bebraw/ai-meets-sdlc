import { normalizeStripeId } from "../utils/normalize";
import { jsonResponse } from "../utils/response";

export async function handleOrderStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Order tracking is not configured" }, 503);
  }

  const url = new URL(request.url);
  const sessionId = normalizeStripeId(url.searchParams.get("session_id"), 255);

  if (!sessionId) {
    return jsonResponse({ error: "Missing checkout session ID" }, 400);
  }

  const order = await env.INTERESTS.prepare(
    `SELECT
      stripe_session_id,
      ticket_tier_id,
      ticket_tier_label,
      quantity,
      amount_total,
      currency,
      checkout_status,
      payment_status,
      order_status,
      updated_at
    FROM orders
    WHERE stripe_session_id = ?`,
  )
    .bind(sessionId)
    .first<{
      amount_total: number | null;
      checkout_status: string;
      currency: string | null;
      order_status: string;
      payment_status: string;
      quantity: number;
      stripe_session_id: string;
      ticket_tier_id: string | null;
      ticket_tier_label: string | null;
      updated_at: string;
    }>();

  if (!order) {
    return jsonResponse({ error: "Order not found" }, 404);
  }

  return jsonResponse({
    ok: true,
    order: {
      amount_total: order.amount_total,
      checkout_status: order.checkout_status,
      currency: order.currency,
      order_status: order.order_status,
      payment_status: order.payment_status,
      quantity: order.quantity,
      session_id: order.stripe_session_id,
      ticket_tier_id: order.ticket_tier_id,
      ticket_tier_label: order.ticket_tier_label,
      updated_at: order.updated_at,
    },
  });
}
