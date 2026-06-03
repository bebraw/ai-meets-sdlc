# Cloudflare Setup

This site is deployed as a Cloudflare Worker with static assets, D1 for the interest list, R2 for encrypted backups, Stripe Checkout for ticket sales, Turnstile for bot protection, and a scheduled Worker trigger for daily backup export.

## Bindings

`wrangler.jsonc` expects these bindings:

| Binding                    | Type           | Purpose                                                            |
| -------------------------- | -------------- | ------------------------------------------------------------------ |
| `ADMIN_PASSWORD`           | Secret         | Protects `/admin` and `/api/admin/*` with Basic Auth.              |
| `ASSETS`                   | Workers Assets | Serves the Gustwind build output from `build/`.                    |
| `CHECKOUTS_ENABLED`        | Worker var     | Enables Checkout only when set exactly to `true`.                  |
| `CFP_ENABLED`              | Worker var     | Enables the public CFP form only when set exactly to `true`.       |
| `INTERESTS`                | D1             | Stores encrypted interest submissions and orders.                  |
| `INTEREST_BACKUPS`         | R2             | Stores daily encrypted JSON backups.                               |
| `STRIPE_CANCEL_URL`        | Var/secret     | Optional explicit Checkout cancellation URL.                       |
| `STRIPE_SECRET_KEY`        | Secret         | Creates server-side Stripe Checkout Sessions.                      |
| `STRIPE_SUCCESS_URL`       | Var/secret     | Optional explicit Checkout success URL.                            |
| `STRIPE_TICKET_TIERS_JSON` | Var/secret     | JSON ticket tier definitions with Stripe Price IDs and capacities. |
| `STRIPE_WEBHOOK_SECRET`    | Secret         | Verifies Stripe webhook events before order updates.               |
| `TURNSTILE_SITE_KEY`       | Worker var     | Public Turnstile widget site key injected into HTML.               |
| `TURNSTILE_SECRET_KEY`     | Secret         | Server-side Turnstile verification key.                            |
| `EMAIL_ENCRYPTION_KEY`     | Secret         | Key material for encrypting/de-duplicating submissions.            |

## Local Testing

Copy the example dotenv file and set a local-only encryption key:

```bash
cp .env.example .env
```

Generate a strong local value for `EMAIL_ENCRYPTION_KEY`, for example:

```bash
openssl rand -base64 32
```

Stripe and Turnstile are optional locally. Checkout is disabled unless
`CHECKOUTS_ENABLED=true`, and the CFP form is disabled unless
`CFP_ENABLED=true`. If `STRIPE_SECRET_KEY`, `STRIPE_TICKET_TIERS_JSON`, or
`STRIPE_WEBHOOK_SECRET` are empty, the related Stripe endpoint returns a
configuration error after checkout has been enabled. If `TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY` are empty, the Worker skips Turnstile verification for the
legacy interest endpoint.

See [Stripe testing](stripe-testing.md) for the full local Checkout and webhook
verification flow.

Prepare Wrangler's local `.dev.vars`, apply the local D1 migration, and start the Worker:

```bash
npm run dev:env
npm run db:migrate:local
npm run worker:dev
```

## Production Provisioning

The repository includes `.node-version` with Node 24 because Gustwind requires
Node 24 or newer. Cloudflare's build image also accepts a `NODE_VERSION`
environment variable, but the checked-in version file keeps the Git integration
aligned without dashboard-only configuration.

Create the D1 database and copy the returned `database_id` into `wrangler.jsonc`:

```bash
wrangler d1 create ai-meets-sdlc-interests
```

Create the R2 backup bucket:

```bash
wrangler r2 bucket create ai-meets-sdlc-interest-backups
```

Create a Turnstile widget in the Cloudflare dashboard, then set:

- `TURNSTILE_SITE_KEY` in `wrangler.jsonc`
- `TURNSTILE_SECRET_KEY` as a Worker secret

Create a Stripe Product and Price for each ticket tier, then set:

- `CHECKOUTS_ENABLED` to `true` only after local Checkout and webhook testing has passed
- `CFP_ENABLED` to `true` only when the public call for proposals should be visible
- `STRIPE_TICKET_TIERS_JSON` to the ticket tier definitions, for example:

```json
[
  {
    "id": "early",
    "label": "Early bird",
    "price_id": "price_...",
    "price_label": "EUR 199",
    "discount_coupon_id": "coupon_...",
    "capacity": 40,
    "available_until": "2026-07-31T20:59:59Z",
    "sort_order": 1
  },
  {
    "id": "regular",
    "label": "Regular",
    "price_id": "price_...",
    "price_label": "EUR 299",
    "capacity": 80,
    "available_from": "2026-08-01T00:00:00Z",
    "available_until": "2026-09-30T20:59:59Z",
    "sort_order": 2
  },
  {
    "id": "late",
    "label": "Late bird",
    "price_id": "price_...",
    "price_label": "EUR 399",
    "capacity": 30,
    "available_from": "2026-10-01T00:00:00Z",
    "sort_order": 3
  }
]
```

`discount_coupon_id` is optional. When present on the selected tier, the Worker
passes that Stripe Coupon ID to Checkout as an automatic discount for that
session. Tiers without a configured coupon continue to allow Stripe promotion
codes in Checkout.

- `STRIPE_SECRET_KEY` to the restricted or secret key that can create Checkout Sessions
- `STRIPE_WEBHOOK_SECRET` to the signing secret for a Stripe webhook endpoint pointed at `/api/stripe-webhook`
- optionally `STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL` if the default domain-derived URLs are not suitable

The Worker exposes `/api/ticket-tiers` for current public availability. During
Checkout creation it creates an atomic `ticket_reservations` hold if paid orders
plus active holds can still fit inside the tier capacity. Checkout sessions are
created with a 30-minute expiration, and Stripe webhooks release or complete the
hold when the session is paid, expired, or failed.

The authenticated admin interface is available at `/admin` after setting
`ADMIN_PASSWORD`. The browser shows the native Basic Auth prompt; use any
username and the configured password. The admin API decrypts interest-list and
order emails plus CFP proposals for display, shows configured ticket tiers
including optional `discount_coupon_id` values, and can create manual paid registrations. Manual
registrations are inserted atomically against the same tier capacity calculation
used by public checkout. Failed admin authentication attempts are rate limited
through D1, and manual registrations write an audit row containing the order ID,
ticket tier, quantity, keyed email hash, and hashed client key. For production,
also put `/admin` and `/api/admin/*` behind Cloudflare Access or a WAF rule. The
dashboard returns a bounded page of decrypted rows, defaulting to 50 and capped
at 100; use the export scripts for full decrypted exports.

Subscribe the webhook endpoint to these Checkout events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

Set production secrets:

```bash
wrangler secret put EMAIL_ENCRYPTION_KEY
wrangler secret put ADMIN_PASSWORD
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_TICKET_TIERS_JSON
wrangler secret put STRIPE_WEBHOOK_SECRET
```

`wrangler.jsonc` keeps `CHECKOUTS_ENABLED` at `false` by default. Change that
Worker var to `true` in Cloudflare, or in `wrangler.jsonc` before a deployment,
only when you are ready to open Checkout.

`CFP_ENABLED` also defaults to `false`. Change it to `true` only when you are
ready to show the CFP form. The public CFP accepts posters and 15 minute pitches;
longer slots are curated separately. The consent text states that acceptance
covers only the event participation ticket.

Use a strong `EMAIL_ENCRYPTION_KEY` and keep it outside version control. Losing it means existing encrypted submissions and backups cannot be decrypted.

Apply the D1 migration remotely:

```bash
npm run db:migrate:remote
```

Deploy:

```bash
npm run deploy
```

## Backups

The Worker has a daily scheduled trigger:

```json
"crons": ["17 2 * * *"]
```

It exports encrypted D1 rows to R2 under:

```text
interests/YYYY-MM-DD.json
```

Before writing a full backup, the Worker hashes the encrypted interest and CFP
row export and compares it against `interests/latest.json`. If the hash has not
changed, the scheduled run exits without writing a new backup. When rows have
changed, the Worker writes the dated backup and updates `interests/latest.json`
with the latest key, export time, row counts, and row hash.

The backups intentionally contain ciphertext and keyed hashes, not plaintext personal data.

## Decrypting a Backup

Download a backup JSON file from R2, then run:

```bash
EMAIL_ENCRYPTION_KEY=... npm run interests:decrypt -- backup.json
```

The script prints CSV with:

- `email`
- `name`
- `organization`
- `created_at`

## Data Model

The D1 migrations create `interests` with:

- encrypted email, name, and organization
- AES-GCM IV values for each encrypted field
- keyed HMAC email hash for deduplication
- consent text
- creation timestamp

Plaintext email is not stored in D1 or R2.

They also create `orders` with:

- Stripe Checkout Session ID and Payment Intent ID
- ticket tier ID, display label, Stripe Price ID, reservation ID, and reservation expiry
- encrypted buyer email plus keyed HMAC email hash
- ticket quantity, amount, currency, checkout status, payment status, and order status
- creation and update timestamps

They also create `ticket_reservations` with:

- reservation ID, ticket tier ID, quantity, and status
- optional Stripe Checkout Session ID
- reservation expiry and timestamps

They also create admin security tables with:

- hashed admin client keys and authentication attempt timestamps for throttling
- manual registration audit rows without plaintext email or IP addresses

They also create `cfp_proposals` with:

- encrypted presenter email, name, organization, proposal title, summary, and bio
- CFP format (`poster` or `pitch_15`)
- keyed HMAC email hash, consent text, and creation timestamp

Export decrypted order details with:

```bash
EMAIL_ENCRYPTION_KEY=... npm run --silent orders:export -- --remote
```
