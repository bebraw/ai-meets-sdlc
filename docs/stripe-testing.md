# Stripe Testing

Use Stripe test mode for every command and dashboard action below. The local
Worker expects test keys, a test Price ID, and the webhook signing secret from
`stripe listen`.

## 1. Create Test Stripe Resources

Create a Stripe Product and one-time Price for each test ticket tier in the
Stripe dashboard, then copy the test Price IDs:

```text
price_early_...
price_regular_...
price_late_...
```

If a tier should receive an automatic discount, create a test Coupon in Stripe
and copy its Coupon ID:

```text
coupon_...
```

Copy the test secret key:

```text
sk_test_...
```

## 2. Prepare Local Environment

Copy the example file if needed:

```bash
cp .env.example .env
```

Set at least these values in `.env`:

```bash
EMAIL_ENCRYPTION_KEY=replace-with-a-local-secret
CHECKOUTS_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=
```

Apply local migrations, including the `orders` table:

```bash
npm run db:migrate:local
```

After starting the Worker, open `/admin` and create the test ticket tiers there.
Use the Stripe test Price IDs and any test Coupon IDs from step 1.

## 3. Start Stripe Webhook Forwarding

In a separate terminal, run:

```bash
stripe listen \
  --forward-to localhost:8787/api/stripe-webhook \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired
```

Stripe prints a webhook signing secret:

```text
Ready! Your webhook signing secret is 'whsec_...'
```

Add that value to `.env`:

```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```

Keep the `stripe listen` terminal running.

## 4. Start the Worker

In another terminal, run:

```bash
npm run worker:dev
```

Open the local Worker URL, usually:

```text
http://localhost:8787
```

## 5. Complete a Checkout

Use the ticket form and continue to Stripe Checkout.

Use Stripe's basic successful test card:

```text
4242 4242 4242 4242
```

Use any future expiry date, any three-digit CVC, and any postal code.

After payment, Stripe redirects back to:

```text
/?checkout=success&session_id={CHECKOUT_SESSION_ID}#tickets
```

The page then calls `/api/order` and should show the tracked order status.

## 6. Verify Local D1 Tracking

Check the stored order without decrypting email:

```bash
./node_modules/.bin/wrangler d1 execute ai-meets-sdlc-interests --local \
  --command "SELECT stripe_session_id, ticket_tier_id, ticket_tier_label, reservation_id, quantity, amount_total, currency, checkout_status, payment_status, order_status, reservation_expires_at, created_at, updated_at FROM orders ORDER BY created_at DESC LIMIT 5"
```

Check active and completed holds:

```bash
./node_modules/.bin/wrangler d1 execute ai-meets-sdlc-interests --local \
  --command "SELECT id, ticket_tier_id, quantity, status, stripe_session_id, expires_at, updated_at FROM ticket_reservations ORDER BY created_at DESC LIMIT 5"
```

Export orders with decrypted buyer email:

```bash
EMAIL_ENCRYPTION_KEY=... npm run --silent orders:export -- --local
```

The `orders` table should contain:

- `order_status = paid` after `checkout.session.completed`
- `ticket_tier_id` and `stripe_price_id` matching the selected tier
- `reservation_id` and `reservation_expires_at` set about 30 minutes after Checkout start
- a `ticket_reservations` row that moves from `held` to `completed` after payment
- encrypted `email_ciphertext` and `email_iv`
- no plaintext buyer email

## 7. Failure And Edge Checks

Run these before production:

- Checkout feature flag: set `CHECKOUTS_ENABLED=false`, restart the Worker, and
  confirm `/api/checkout` returns `Ticket checkout is not open yet`.
- Missing Stripe env or tiers: clear `STRIPE_SECRET_KEY` or delete/deactivate
  ticket tiers in `/admin`, restart the Worker if needed, and confirm checkout
  returns a configuration error.
- Sold-out tier: set a tier capacity to `1`, start one Checkout without paying,
  then try to start another Checkout for the same tier and confirm the atomic
  reservation insert rejects the second request until the first hold expires or
  receives an expired webhook.
- Invalid webhook secret: set a wrong `STRIPE_WEBHOOK_SECRET`, resend an event
  from the Stripe CLI, and confirm `/api/stripe-webhook` rejects it.
- Duplicate webhook delivery: resend the same event from Stripe and confirm the
  order row updates in place instead of duplicating.
- Cancelled Checkout: start Checkout, return without paying, and confirm the
  local pending row stays queryable.

## 8. Production Webhook

In Stripe Workbench, add a webhook endpoint:

```text
https://sdlcai.org/api/stripe-webhook
```

Subscribe to:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
```

Set the production `STRIPE_WEBHOOK_SECRET` from that endpoint in Cloudflare:

```bash
wrangler secret put STRIPE_WEBHOOK_SECRET
```
