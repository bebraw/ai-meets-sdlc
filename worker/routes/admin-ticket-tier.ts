import {
  normalizeCurrency,
  normalizeInteger,
  normalizeOptionalText,
  normalizeScheduleDate,
  normalizeStripeId,
  normalizeTicketTierId,
} from "../utils/normalize";
import { jsonResponse } from "../utils/response";

export async function handleAdminTicketTierMutation(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse(
      { error: "Ticket tier storage is not configured" },
      503,
    );
  }

  const formData = await request.formData();
  const action = normalizeOptionalText(formData.get("action"), 20);
  const id = normalizeTicketTierId(formData.get("id"));

  if (action === "delete") {
    if (!id) return jsonResponse({ error: "Choose a ticket tier" }, 400);

    const references = await env.INTERESTS.prepare(
      `SELECT
        (
          SELECT COUNT(*)
          FROM orders
          WHERE ticket_tier_id = ?
        ) + (
          SELECT COUNT(*)
          FROM ticket_reservations
          WHERE ticket_tier_id = ?
        ) AS count`,
    )
      .bind(id, id)
      .first<{ count: number }>();

    if (Number(references?.count ?? 0) > 0) {
      return jsonResponse(
        {
          error:
            "This tier has orders or reservations. Deactivate it instead of deleting it.",
        },
        409,
      );
    }

    await env.INTERESTS.prepare("DELETE FROM ticket_tiers WHERE id = ?")
      .bind(id)
      .run();

    return jsonResponse({ ok: true, deleted_id: id });
  }

  const label = normalizeOptionalText(formData.get("label"), 120);
  const priceId = normalizeStripeId(
    normalizeOptionalText(formData.get("price_id"), 255),
    255,
  );
  const priceLabel = normalizeOptionalText(formData.get("price_label"), 80);
  const currency = normalizeCurrency(formData.get("currency"));
  const capacity = normalizeInteger(formData.get("capacity"), 0, 100000);
  const discountCouponId = normalizeStripeId(
    normalizeOptionalText(formData.get("discount_coupon_id"), 255),
    255,
  );
  const titoReleaseSlug = normalizeOptionalText(
    formData.get("tito_release_slug"),
    255,
  );
  const availableFrom = normalizeScheduleDate(formData.get("available_from"));
  const availableUntil = normalizeScheduleDate(formData.get("available_until"));
  const sortOrder = normalizeInteger(formData.get("sort_order"), 0, 9999);
  const isActive = formData.get("is_active") === "yes" ? 1 : 0;

  if (!id) {
    return jsonResponse(
      {
        error: "Enter a tier ID using letters, numbers, underscores, or dashes",
      },
      400,
    );
  }

  if (!label) {
    return jsonResponse({ error: "Enter a tier label" }, 400);
  }

  if (!priceId) {
    return jsonResponse({ error: "Enter a Stripe Price ID" }, 400);
  }

  if (capacity < 1) {
    return jsonResponse({ error: "Capacity must be at least 1" }, 400);
  }

  if (availableFrom && availableUntil) {
    if (Date.parse(availableUntil) <= Date.parse(availableFrom)) {
      return jsonResponse({ error: "Sale end must be after sale start" }, 400);
    }
  }

  const now = new Date().toISOString();

  await env.INTERESTS.prepare(
    `INSERT INTO ticket_tiers (
      id,
      label,
      stripe_price_id,
      price_label,
      currency,
      capacity,
      discount_coupon_id,
      tito_release_slug,
      available_from,
      available_until,
      sort_order,
      is_active,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      stripe_price_id = excluded.stripe_price_id,
      price_label = excluded.price_label,
      currency = excluded.currency,
      capacity = excluded.capacity,
      discount_coupon_id = excluded.discount_coupon_id,
      tito_release_slug = excluded.tito_release_slug,
      available_from = excluded.available_from,
      available_until = excluded.available_until,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at`,
  )
    .bind(
      id,
      label,
      priceId,
      priceLabel || null,
      currency || null,
      capacity,
      discountCouponId || null,
      titoReleaseSlug || null,
      availableFrom || null,
      availableUntil || null,
      sortOrder,
      isActive,
      now,
      now,
    )
    .run();

  return jsonResponse({ ok: true });
}
