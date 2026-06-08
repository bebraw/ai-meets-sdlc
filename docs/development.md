# Development

## Requirements

- Node 24 or newer. The repository includes `.node-version` for Cloudflare
  Workers Builds and local version managers.
- npm
- Wrangler access to the Cloudflare account for Worker, D1, R2, and Turnstile
  setup.

## Local Site Development

Install dependencies:

```bash
npm install
```

Build the static site:

```bash
npm run build
```

Format and validate:

```bash
npm run format
npm run format:check
npm run validate
```

## Worker Development

Copy `.env.example` to `.env`, then set local values there. `.env` is the
source of truth for local development. Generate Wrangler's `.dev.vars` from it:

```bash
npm run dev:env
```

Do not edit `.dev.vars` directly; it is generated for `wrangler dev`.

Apply the local D1 migration:

```bash
npm run db:migrate:local
```

Run the Worker locally:

```bash
npm run worker:dev
```

`worker:dev` builds the site, verifies that `build/index.html` exists, and then
starts Wrangler.

## Ticket Sales

Ticket purchases use the provider selected by `CHECKOUT_PROVIDER`, either
`stripe` or `tito`. Configure these Worker environment variables before opening
sales:

- `CHECKOUTS_ENABLED=true`
- `CHECKOUT_PROVIDER=stripe` or `CHECKOUT_PROVIDER=tito`

For Stripe checkout, set:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

For Tito checkout, set:

- `TITO_EVENT_PATH`
- `tito_release_slug` on each public ticket tier in `/admin`

Checkout is disabled unless the admin-managed checkout flag is enabled. The
`CHECKOUTS_ENABLED` Worker variable remains the default before a flag value has
been saved in `/admin`; keep it `false` in production while testing locally.

`STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL` are optional. When omitted, the
Worker derives them from the current request origin.

Ticket tiers are maintained in the authenticated admin interface and stored in
D1. Each tier defines the available pool, Stripe Price ID, optional Tito release
slug, capacity, optional discount coupon, and optional sale window. Starting
Stripe Checkout creates a 30-minute hold for the selected tier, and paid orders
keep consuming local capacity. Tito checkout redirects to Tito's hosted checkout
and leaves final inventory, payment, and confirmation handling to Tito.

Stripe webhooks update the local D1 `orders` table. Buyer email is encrypted
before storage, while Stripe session/payment IDs and payment status remain
queryable for operations.

Export decrypted order rows with:

```bash
EMAIL_ENCRYPTION_KEY=... npm run --silent orders:export -- --remote
```

See [Stripe testing](stripe-testing.md) for the local test flow.

## Call For Proposals

The public CFP form is controlled by `CFP_ENABLED` and the admin-managed `cfp`
feature flag. Keep it disabled until the public CFP should accept submissions:

```bash
CFP_ENABLED=false
```

When enabled:

- The CFP section and navigation link appear on the public page.
- `POST /api/cfp` accepts proposals.
- Accepted formats are `poster` and `pitch_15`.
- Proposal summaries must be at least 80 characters.
- The submitter must accept the consent text that CFP acceptance covers only
  the event participation ticket.

CFP submissions require local D1 and `EMAIL_ENCRYPTION_KEY`. The Worker stores
encrypted presenter email, name, organization, title, summary, and bio in
`cfp_proposals`, plus a keyed email hash for deduplication/search operations.
Plaintext proposal details are visible only after decryption in the authenticated
admin dashboard.

Use `/admin` to:

- enable or disable the `cfp` feature flag without redeploying
- review decrypted CFP proposals
- use a CFP proposal as the starting point for a schedule entry

The schedule form can prefill entry type, title, presenter, organization, and
description from a selected CFP proposal.

## Interest List

The interest form stores submissions in Cloudflare D1. Email, name, and
organization are encrypted before insert, and a keyed email hash is stored for
deduplication. Plaintext contact details are not stored in D1 or R2.

Scheduled backups export encrypted D1 rows to R2. A latest-backup manifest
stores a hash of the encrypted rows so unchanged scheduled runs do not write
duplicate backup objects.

Decrypt a downloaded backup with:

```bash
EMAIL_ENCRYPTION_KEY=... npm run interests:decrypt -- backup.json
```

Export contact details for follow-up email from production D1 with:

```bash
EMAIL_ENCRYPTION_KEY=... npm run --silent interests:export -- --remote > contacts.csv
```

The export script also supports local D1 and downloaded backups:

```bash
EMAIL_ENCRYPTION_KEY=... npm run --silent interests:export -- --local
EMAIL_ENCRYPTION_KEY=... npm run --silent interests:export -- --input backup.json
EMAIL_ENCRYPTION_KEY=... npm run --silent interests:export -- --remote --format json
```
