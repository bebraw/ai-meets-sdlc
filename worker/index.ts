type JsonObject = Record<string, unknown>;

interface TurnstileOutcome {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
}

interface EncryptedText {
  ciphertext: string;
  iv: string;
}

interface BackupManifest {
  rows_hash?: string;
}

interface StripeCheckoutSession {
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

interface StripeEvent {
  data?: {
    object?: unknown;
  };
  id?: string;
  type?: string;
}

interface TicketTier {
  availableFrom?: string | undefined;
  availableUntil?: string | undefined;
  capacity: number;
  currency?: string | undefined;
  discountCouponId?: string | undefined;
  id: string;
  label: string;
  priceId: string;
  priceLabel?: string | undefined;
  sortOrder: number;
}

interface TicketTierAvailability extends TicketTier {
  availableQuantity: number;
  isOnSale: boolean;
  reservedQuantity: number;
}

const CHECKOUT_RESERVATION_SECONDS = 30 * 60;
const CHECKOUT_RESERVATION_MS = CHECKOUT_RESERVATION_SECONDS * 1000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/ticket-tiers") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return handleTicketTiers(env);
    }

    if (url.pathname === "/api/checkout") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return handleCheckout(request, env);
    }

    if (url.pathname === "/api/order") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return handleOrderStatus(request, env);
    }

    if (url.pathname === "/api/stripe-webhook") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return handleStripeWebhook(request, env);
    }

    if (url.pathname === "/api/interest") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return handleInterest(request, env);
    }

    const response = await env.ASSETS.fetch(request);

    if (response.headers.get("content-type")?.includes("text/html")) {
      return injectRuntimeConfig(response, env);
    }

    return response;
  },

  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!env.INTEREST_BACKUPS) return;

    ctx.waitUntil(backupInterests(env));
  },
} satisfies ExportedHandler<Env>;

async function handleTicketTiers(env: Env): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Ticket inventory is not configured" }, 503);
  }

  const tiers = getTicketTiers(env);

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

async function handleCheckout(request: Request, env: Env): Promise<Response> {
  if (!isCheckoutEnabled(env)) {
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
  const tiers = getTicketTiers(env);

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
    "metadata[event]": "AI meets SDLC",
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

async function handleOrderStatus(
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

async function handleStripeWebhook(
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

async function upsertOrderFromCheckoutSession({
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

async function verifyStripeWebhookSignature({
  payload,
  secret,
  signature,
}: {
  payload: string;
  secret: string;
  signature: string;
}): Promise<boolean> {
  const parts = parseStripeSignature(signature);

  if (!parts.timestamp || parts.signatures.length === 0) return false;

  const now = Math.floor(Date.now() / 1000);

  if (Math.abs(now - parts.timestamp) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedPayload = `${parts.timestamp}.${payload}`;
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload),
  );
  const expectedSignature = hexEncode(new Uint8Array(signatureBytes));

  return parts.signatures.some((value) =>
    timingSafeEqualHex(value, expectedSignature),
  );
}

function parseStripeSignature(signature: string): {
  signatures: string[];
  timestamp: number;
} {
  const parsed = signature.split(",").reduce(
    (accumulator, part) => {
      const [key, value] = part.split("=", 2);

      if (key === "t" && value) {
        accumulator.timestamp = Number(value);
      } else if (key === "v1" && value) {
        accumulator.signatures.push(value);
      }

      return accumulator;
    },
    { signatures: [] as string[], timestamp: 0 },
  );

  return Number.isFinite(parsed.timestamp)
    ? parsed
    : { signatures: parsed.signatures, timestamp: 0 };
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function getOrderStatusFromSession(
  eventType: string | undefined,
  session: StripeCheckoutSession,
): string {
  if (eventType === "checkout.session.expired") return "expired";
  if (eventType === "checkout.session.async_payment_failed") return "failed";
  if (session.payment_status === "paid") return "paid";

  return "pending";
}

function isStripeCheckoutSession(
  value: unknown,
): value is StripeCheckoutSession {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
  );
}

function getTicketTiers(env: Env): TicketTier[] {
  if (!env.STRIPE_TICKET_TIERS_JSON) return [];

  try {
    const parsed = JSON.parse(env.STRIPE_TICKET_TIERS_JSON);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((value, index) => normalizeTicketTier(value, index))
      .filter((tier): tier is TicketTier => Boolean(tier))
      .sort((left, right) => left.sortOrder - right.sortOrder);
  } catch (error) {
    console.error("Invalid STRIPE_TICKET_TIERS_JSON", {
      message: error instanceof Error ? error.message : "Invalid JSON",
    });

    return [];
  }
}

function normalizeTicketTier(value: unknown, index: number): TicketTier | null {
  if (typeof value !== "object" || value === null) return null;

  const source = value as Record<string, unknown>;
  const id = typeof source.id === "string" ? source.id.trim() : "";
  const label = typeof source.label === "string" ? source.label.trim() : "";
  const priceId =
    typeof source.price_id === "string"
      ? source.price_id.trim()
      : typeof source.priceId === "string"
        ? source.priceId.trim()
        : "";
  const capacity =
    typeof source.capacity === "number" && Number.isInteger(source.capacity)
      ? source.capacity
      : 0;

  if (!id || !label || !priceId || capacity < 1) return null;

  return {
    availableFrom: normalizeTierDate(
      source.available_from ?? source.availableFrom,
    ),
    availableUntil: normalizeTierDate(
      source.available_until ?? source.availableUntil,
    ),
    capacity,
    currency:
      typeof source.currency === "string" ? source.currency.trim() : undefined,
    discountCouponId: getTierString(
      source,
      "discount_coupon_id",
      "discountCouponId",
    ),
    id,
    label,
    priceId,
    priceLabel:
      typeof source.price_label === "string"
        ? source.price_label.trim()
        : typeof source.priceLabel === "string"
          ? source.priceLabel.trim()
          : undefined,
    sortOrder:
      typeof source.sort_order === "number" &&
      Number.isFinite(source.sort_order)
        ? source.sort_order
        : typeof source.sortOrder === "number" &&
            Number.isFinite(source.sortOrder)
          ? source.sortOrder
          : index,
  };
}

function getTierString(
  source: Record<string, unknown>,
  snakeCaseKey: string,
  camelCaseKey: string,
): string | undefined {
  const value =
    typeof source[snakeCaseKey] === "string"
      ? source[snakeCaseKey]
      : typeof source[camelCaseKey] === "string"
        ? source[camelCaseKey]
        : "";
  const normalized = value.trim();

  return normalized || undefined;
}

function normalizeTierDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function getTicketTierAvailability(
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
      isOnSale: isAfterStart && isBeforeEnd,
      reservedQuantity,
    };
  });
}

async function holdTicketReservation({
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

async function attachTicketReservationToSession({
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

async function updateTicketReservationFromSession({
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

async function releaseTicketReservation({
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

async function handleInterest(request: Request, env: Env): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Interest storage is not configured" }, 503);
  }

  if (!env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Encryption is not configured" }, 503);
  }

  const formData = await request.formData();
  const email = normalizeEmail(formData.get("email"));
  const name = normalizeOptionalText(formData.get("name"), 120);
  const organization = normalizeOptionalText(formData.get("organization"), 160);
  const consent = formData.get("consent") === "yes";
  const turnstileToken = getTurnstileToken(formData);

  if (!email || !isLikelyEmail(email)) {
    return jsonResponse({ error: "Enter a valid email address" }, 400);
  }

  if (!consent) {
    return jsonResponse({ error: "Consent is required" }, 400);
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const turnstileOutcome = await verifyTurnstile({
      request,
      secret: env.TURNSTILE_SECRET_KEY,
      token: turnstileToken,
    });

    if (!turnstileOutcome.success) {
      console.warn("Turnstile verification failed", {
        errors: turnstileOutcome["error-codes"] ?? [],
        hostname: turnstileOutcome.hostname,
        hasToken: Boolean(turnstileToken),
      });

      return jsonResponse({ error: "Verification failed" }, 400);
    }
  }

  const keyMaterial = env.EMAIL_ENCRYPTION_KEY;
  const emailHash = await hashEmail(email, keyMaterial);
  const encryptedEmail = await encryptText(email, keyMaterial);
  const encryptedName = name ? await encryptText(name, keyMaterial) : null;
  const encryptedOrganization = organization
    ? await encryptText(organization, keyMaterial)
    : null;
  const consentText =
    "I agree to be contacted about AI meets SDLC seminar registration.";
  const createdAt = new Date().toISOString();

  try {
    await env.INTERESTS.prepare(
      `INSERT INTO interests (
        email_hash,
        email_ciphertext,
        email_iv,
        name_ciphertext,
        name_iv,
        organization_ciphertext,
        organization_iv,
        consent_text,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        emailHash,
        encryptedEmail.ciphertext,
        encryptedEmail.iv,
        encryptedName?.ciphertext ?? null,
        encryptedName?.iv ?? null,
        encryptedOrganization?.ciphertext ?? null,
        encryptedOrganization?.iv ?? null,
        consentText,
        createdAt,
      )
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return jsonResponse({
        ok: true,
        duplicate: true,
        message: "You are already on the interest list.",
      });
    }

    throw error;
  }

  return jsonResponse({
    ok: true,
    message: "Thanks. We will notify you when registration opens.",
  });
}

async function verifyTurnstile({
  request,
  secret,
  token,
}: {
  request: Request;
  secret: string;
  token: string;
}): Promise<TurnstileOutcome> {
  if (!token) {
    return { success: false, "error-codes": ["missing-input-response"] };
  }

  const payload = new FormData();
  payload.append("secret", secret);
  payload.append("response", token);

  const ip = request.headers.get("CF-Connecting-IP");

  if (ip) {
    payload.append("remoteip", ip);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: payload,
    },
  );
  const outcome = (await response.json()) as TurnstileOutcome;

  return outcome;
}

async function backupInterests(env: Env): Promise<void> {
  const { results } = await env.INTERESTS.prepare(
    "SELECT * FROM interests ORDER BY created_at ASC",
  ).all();
  const rows = results ?? [];
  const rowsHash = await sha256Hex(JSON.stringify(rows));
  const latestBackup = await getLatestBackupManifest(env);

  if (latestBackup?.rows_hash === rowsHash) return;

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify(
    {
      exported_at: exportedAt,
      rows,
    },
    null,
    2,
  );
  const key = `interests/${exportedAt.slice(0, 10)}.json`;

  await env.INTEREST_BACKUPS.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { rows_hash: rowsHash },
  });

  await env.INTEREST_BACKUPS.put(
    "interests/latest.json",
    JSON.stringify(
      {
        key,
        exported_at: exportedAt,
        row_count: rows.length,
        rows_hash: rowsHash,
      },
      null,
      2,
    ),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { rows_hash: rowsHash },
    },
  );
}

async function getLatestBackupManifest(
  env: Env,
): Promise<BackupManifest | null> {
  const latestBackup = await env.INTEREST_BACKUPS.get("interests/latest.json");

  if (!latestBackup) return null;

  if (latestBackup.customMetadata?.rows_hash) {
    return { rows_hash: latestBackup.customMetadata.rows_hash };
  }

  try {
    const manifest = await latestBackup.json();

    return isBackupManifest(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

function isBackupManifest(value: unknown): value is BackupManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    (!("rows_hash" in value) || typeof value.rows_hash === "string")
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function injectRuntimeConfig(
  response: Response,
  env: Env,
): Promise<Response> {
  const html = await response.text();

  return new Response(
    html
      .replaceAll("__TURNSTILE_SITE_KEY__", env.TURNSTILE_SITE_KEY ?? "")
      .replaceAll(
        "__CHECKOUTS_ENABLED__",
        isCheckoutEnabled(env) ? "true" : "false",
      ),
    response,
  );
}

function isCheckoutEnabled(env: Env): boolean {
  return env.CHECKOUTS_ENABLED === "true";
}

async function encryptText(
  value: string,
  keyMaterial: string,
): Promise<EncryptedText> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(keyMaterial);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );

  return {
    ciphertext: base64Encode(new Uint8Array(ciphertext)),
    iv: base64Encode(iv),
  };
}

async function hashEmail(email: string, keyMaterial: string): Promise<string> {
  const key = await importHmacKey(keyMaterial);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(email),
  );

  return base64Encode(new Uint8Array(signature));
}

async function importAesKey(keyMaterial: string): Promise<CryptoKey> {
  const bytes = await deriveBytes(keyMaterial, "email-encryption");

  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"]);
}

async function importHmacKey(keyMaterial: string): Promise<CryptoKey> {
  const bytes = await deriveBytes(keyMaterial, "email-hash");

  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function deriveBytes(
  secret: string,
  purpose: string,
): Promise<ArrayBuffer> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${purpose}:${secret}`),
  );

  return digest;
}

function normalizeEmail(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeQuantity(value: FormDataEntryValue | null): number {
  if (typeof value !== "string") return 0;

  const quantity = Number(value);

  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 10
    ? quantity
    : 0;
}

function normalizeStripeId(value: string | null, maxLength: number): string {
  if (typeof value !== "string") return "";

  return value.trim().slice(0, maxLength);
}

function normalizeOptionalText(
  value: FormDataEntryValue | null,
  maxLength: number,
): string {
  if (typeof value !== "string") return "";

  return value.trim().slice(0, maxLength);
}

function getTurnstileToken(formData: FormData): string {
  const values = formData
    .getAll("cf-turnstile-response")
    .map((value) => normalizeOptionalText(value, 2048))
    .filter(Boolean);

  return values.at(-1) ?? "";
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getRequestOrigin(request: Request): string {
  const url = new URL(request.url);

  return `${url.protocol}//${url.host}`;
}

function jsonResponse(payload: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function hexEncode(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
