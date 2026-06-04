import {
  getTicketTierAvailability,
  getTicketTiers,
} from "../domain/ticket-tiers";
import { jsonResponse } from "../utils/response";

export async function handleTicketTiers(env: Env): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Ticket inventory is not configured" }, 503);
  }

  const tiers = await getTicketTiers(env);

  if (tiers.length === 0) {
    return jsonResponse({ error: "Ticket tiers are not configured" }, 503);
  }

  const availability = await getTicketTierAvailability(env, tiers, new Date());

  return jsonResponse({
    ok: true,
    tiers: availability.map((tier) => ({
      available_from: tier.availableFrom ?? null,
      available_quantity: tier.availableQuantity,
      available_until: tier.availableUntil ?? null,
      capacity: tier.capacity,
      currency: tier.currency ?? null,
      id: tier.id,
      is_on_sale: tier.isOnSale,
      label: tier.label,
      price_label: tier.priceLabel ?? null,
      reserved_quantity: tier.reservedQuantity,
    })),
  });
}
