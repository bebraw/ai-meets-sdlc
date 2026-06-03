# AI Meets SDLC

Website for the AI meets SDLC seminar, held 13 October 2026 at Marsio Saastamoinen Foundation Stage, Espoo, Finland.

The site is built with Gustwind and HTMLisp, styled with Tailwind CSS, and
deployed as a Cloudflare Worker with static assets. The production domain is
`sdlcai.org`.

## Requirements

- Node 24 or newer. The repository includes `.node-version` for Cloudflare
  Workers Builds and local version managers.
- npm
- Wrangler access to the Cloudflare account for Worker, D1, R2, and Turnstile
  setup.

## Project Structure

- `site/layouts/index.html`: main page markup and client-side behavior.
- `site/tailwind.css`: font faces, Tailwind theme variables, and global styles.
- `assets/`: logo, favicon, fonts, and referenced media.
- `worker/index.ts`: Cloudflare Worker, Stripe Checkout endpoint, interest form
  endpoint, Stripe webhook order tracking, and scheduled backups.
- `migrations/`: D1 schema.
- `scripts/`: local helper scripts for dotenv, backup decryption, and build
  verification.
- `docs/cloudflare.md`: Cloudflare provisioning, secrets, backup, and deployment
  notes.
- `docs/stripe-testing.md`: Stripe Checkout and webhook testing instructions.

## Development

Install dependencies:

```bash
npm install
```

Run the Gustwind development server:

```bash
npm start
```

Build the static site:

```bash
npm run build
```

Serve the generated build locally:

```bash
npm run serve
```

Format and validate:

```bash
npm run format
npm run format:check
npm run validate
```

## Worker Development

Copy `.env.example` to `.env`, set a local `EMAIL_ENCRYPTION_KEY`, then generate
Wrangler's `.dev.vars`:

```bash
npm run dev:env
```

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

Ticket purchases use Stripe Checkout. Configure these Worker environment
variables before opening sales:

- `STRIPE_SECRET_KEY`
- `STRIPE_TICKET_TIERS_JSON`
- `STRIPE_WEBHOOK_SECRET`

`STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL` are optional. When omitted, the
Worker derives them from the current request origin.

`STRIPE_TICKET_TIERS_JSON` defines the available pools, their Stripe Price IDs,
capacities, and optional sale windows. Starting Stripe Checkout creates a
30-minute hold for the selected tier, and paid orders keep consuming capacity.

Stripe webhooks update the local D1 `orders` table. Buyer email is encrypted
before storage, while Stripe session/payment IDs and payment status remain
queryable for operations.

Export decrypted order rows with:

```bash
EMAIL_ENCRYPTION_KEY=... npm run --silent orders:export -- --remote
```

See [Stripe testing](docs/stripe-testing.md) for the local test flow.

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

## Deployment

Deploy through Cloudflare Workers Builds or locally with:

```bash
npm run deploy
```

See [Cloudflare setup](docs/cloudflare.md) for provisioning, secrets, backup, and
deployment notes.
