import type {
  AdminCfpProposalRow,
  AdminInterestRow,
  AdminOrderRow,
} from "../types";
import { getFeatureFlags } from "../domain/feature-flags";
import { getAdminScheduleEntries } from "../domain/schedule";
import {
  getTicketTierAvailability,
  getTicketTiers,
} from "../domain/ticket-tiers";
import { decryptText } from "../utils/crypto";
import {
  normalizeAdminPageLimit,
  normalizeAdminPageOffset,
} from "../utils/normalize";
import { jsonResponse } from "../utils/response";

export async function handleAdminDashboard(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.INTERESTS || !env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Admin storage is not configured" }, 503);
  }

  const url = new URL(request.url);
  const limit = normalizeAdminPageLimit(url.searchParams.get("limit"));
  const offset = normalizeAdminPageOffset(url.searchParams.get("offset"));
  const featureFlags = await getFeatureFlags(env);
  const tiers = await getTicketTiers(env, { includeInactive: true });
  const availability = await getTicketTierAvailability(env, tiers, new Date());
  const [
    interestRows,
    orderRows,
    interestCount,
    orderCount,
    cfpRows,
    cfpCount,
  ] = await Promise.all([
    env.INTERESTS.prepare(
      `SELECT
        email_ciphertext,
        email_iv,
        name_ciphertext,
        name_iv,
        organization_ciphertext,
        organization_iv,
        created_at
      FROM interests
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<AdminInterestRow>(),
    env.INTERESTS.prepare(
      `SELECT
        stripe_session_id,
        ticket_tier_label,
        email_ciphertext,
        email_iv,
        quantity,
        amount_total,
        currency,
        payment_status,
        order_status,
        created_at
      FROM orders
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<AdminOrderRow>(),
    env.INTERESTS.prepare("SELECT COUNT(*) AS count FROM interests").first<{
      count: number;
    }>(),
    env.INTERESTS.prepare("SELECT COUNT(*) AS count FROM orders").first<{
      count: number;
    }>(),
    env.INTERESTS.prepare(
      `SELECT
          format,
          email_ciphertext,
          email_iv,
          id,
          name_ciphertext,
          name_iv,
          organization_ciphertext,
          organization_iv,
          title_ciphertext,
          title_iv,
          summary_ciphertext,
          summary_iv,
          bio_ciphertext,
          bio_iv,
          created_at
        FROM cfp_proposals
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<AdminCfpProposalRow>(),
    env.INTERESTS.prepare("SELECT COUNT(*) AS count FROM cfp_proposals").first<{
      count: number;
    }>(),
  ]);
  const interests = await Promise.all(
    (interestRows.results ?? []).map((row) =>
      decryptAdminInterest(row, env.EMAIL_ENCRYPTION_KEY),
    ),
  );
  const orders = await Promise.all(
    (orderRows.results ?? []).map((row) =>
      decryptAdminOrder(row, env.EMAIL_ENCRYPTION_KEY),
    ),
  );
  const cfpProposals = await Promise.all(
    (cfpRows.results ?? []).map((row) =>
      decryptAdminCfpProposal(row, env.EMAIL_ENCRYPTION_KEY),
    ),
  );

  return jsonResponse({
    counts: {
      cfp_proposals: Number(cfpCount?.count ?? 0),
      interests: Number(interestCount?.count ?? 0),
      orders: Number(orderCount?.count ?? 0),
    },
    cfp_proposals: cfpProposals,
    feature_flags: featureFlags,
    limit,
    offset,
    ok: true,
    interests,
    orders,
    schedule_entries: await getAdminScheduleEntries(env),
    tiers: availability.map((tier) => ({
      available_from: tier.availableFrom ?? null,
      available_quantity: tier.availableQuantity,
      available_until: tier.availableUntil ?? null,
      capacity: tier.capacity,
      currency: tier.currency ?? null,
      discount_coupon_id: tier.discountCouponId ?? null,
      id: tier.id,
      is_active: tier.isActive,
      is_on_sale: tier.isOnSale,
      label: tier.label,
      price_id: tier.priceId,
      price_label: tier.priceLabel ?? null,
      reserved_quantity: tier.reservedQuantity,
      sort_order: tier.sortOrder,
      tito_release_slug: tier.titoReleaseSlug ?? null,
    })),
  });
}

async function decryptAdminInterest(
  row: AdminInterestRow,
  keyMaterial: string,
) {
  return {
    created_at: row.created_at,
    email: await decryptText(row.email_ciphertext, row.email_iv, keyMaterial),
    name:
      row.name_ciphertext && row.name_iv
        ? await decryptText(row.name_ciphertext, row.name_iv, keyMaterial)
        : null,
    organization:
      row.organization_ciphertext && row.organization_iv
        ? await decryptText(
            row.organization_ciphertext,
            row.organization_iv,
            keyMaterial,
          )
        : null,
  };
}

async function decryptAdminOrder(row: AdminOrderRow, keyMaterial: string) {
  return {
    amount_total: row.amount_total,
    created_at: row.created_at,
    currency: row.currency,
    email:
      row.email_ciphertext && row.email_iv
        ? await decryptText(row.email_ciphertext, row.email_iv, keyMaterial)
        : null,
    order_status: row.order_status,
    payment_status: row.payment_status,
    quantity: row.quantity,
    stripe_session_id: row.stripe_session_id,
    ticket_tier_label: row.ticket_tier_label,
  };
}

async function decryptAdminCfpProposal(
  row: AdminCfpProposalRow,
  keyMaterial: string,
) {
  return {
    bio:
      row.bio_ciphertext && row.bio_iv
        ? await decryptText(row.bio_ciphertext, row.bio_iv, keyMaterial)
        : null,
    created_at: row.created_at,
    email: await decryptText(row.email_ciphertext, row.email_iv, keyMaterial),
    format: row.format,
    id: row.id,
    name: await decryptText(row.name_ciphertext, row.name_iv, keyMaterial),
    organization:
      row.organization_ciphertext && row.organization_iv
        ? await decryptText(
            row.organization_ciphertext,
            row.organization_iv,
            keyMaterial,
          )
        : null,
    summary: await decryptText(
      row.summary_ciphertext,
      row.summary_iv,
      keyMaterial,
    ),
    title: await decryptText(row.title_ciphertext, row.title_iv, keyMaterial),
  };
}
