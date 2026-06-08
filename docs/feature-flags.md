# Feature Flags

This project has two runtime feature flags. They are defined in
`worker/domain/feature-flags.ts`, exposed in `/admin`, and stored in D1 after
the feature flag migration has been applied.

Checkout provider selection is intentionally not a feature flag. Use
`CHECKOUT_PROVIDER=stripe` or `CHECKOUT_PROVIDER=tito` to choose the active
payment integration.

## How Flags Resolve

Each flag has two possible sources:

1. Environment default in `.env`, `.dev.vars`, or `wrangler.jsonc`.
2. Admin override stored in the `feature_flags` D1 table.

Admin overrides take precedence. If no row exists for a flag, the Worker uses
the matching environment variable. Environment variables are enabled only when
the value is exactly `true`.

The admin dashboard shows whether each flag is currently coming from `env` or
`admin`.

## Flags

| Admin key  | Environment default | Default | Purpose                                          |
| ---------- | ------------------- | ------- | ------------------------------------------------ |
| `checkout` | `CHECKOUTS_ENABLED` | `false` | Opens public ticket checkout.                    |
| `cfp`      | `CFP_ENABLED`       | `false` | Shows and enables the public call for proposals. |

## `checkout`

Controls whether visitors can start public ticket checkout from the site.

When disabled:

- The ticket form remains closed on the public page.
- `POST /api/checkout` returns `Ticket checkout is not open yet`.

When enabled:

- The public ticket form loads ticket tier availability from `/api/ticket-tiers`.
- `POST /api/checkout` validates the selected tier and quantity.
- The active payment provider is chosen by `CHECKOUT_PROVIDER`.

Enable this only after ticket tiers and the active payment provider are
configured.

## Checkout Provider

`CHECKOUT_PROVIDER` controls the payment provider used by public checkout.

Valid values:

- `stripe`
- `tito`

Any other value falls back to `stripe`.

When set to `stripe`:

- Public checkout uses Stripe Checkout.
- The Worker creates a local ticket reservation hold before creating a Stripe
  Checkout Session.
- Stripe webhooks update local order and reservation state.

When set to `tito`:

- Public checkout redirects visitors to Tito hosted checkout.
- The Worker validates the selected local tier and builds a Tito URL:
  `https://ti.to/{account}/{event}/with/{release}?{release}=quantity`.
- Tito is the system of record for payment, confirmation emails, refunds, and
  ticket inventory.

Tito mode requires:

- `TITO_EVENT_PATH`, for example `aalto/ai-meets-sdlc`.
- `tito_release_slug` set on every public ticket tier in `/admin`.
- Matching ticket capacity and sale windows in Tito. Local tier availability is
  still shown by the site, but Tito enforces final inventory.

Keep `checkout` disabled until the selected provider is fully configured.

## `cfp`

Controls whether the public call for proposals is visible and writable.

When disabled:

- The CFP navigation link and section are hidden.
- `POST /api/cfp` returns `CFP submissions are not open yet`.

When enabled:

- The CFP section is shown on the public page.
- Visitors can submit poster or 15 minute pitch proposals.

Enable this only when the public CFP should accept submissions.

## Local Use

For local development, copy `.env.example` to `.env`, then set defaults there.
`.env` is the source of truth for local values:

```bash
CHECKOUTS_ENABLED=false
CHECKOUT_PROVIDER=stripe
CFP_ENABLED=false
```

Prepare Wrangler's local vars and apply migrations:

```bash
npm run dev:env
npm run db:migrate:local
```

Do not edit `.dev.vars` directly. `npm run dev:env` regenerates it from `.env`
for Wrangler local development.

Start the Worker:

```bash
npm run worker:dev
```

After migrations have been applied, `/admin` can override the environment
defaults locally.

## Production Use

Production defaults live in `wrangler.jsonc` under `vars`:

```json
{
  "CHECKOUTS_ENABLED": "false",
  "CHECKOUT_PROVIDER": "stripe",
  "CFP_ENABLED": "false"
}
```

Keep production defaults disabled unless the feature should be open before any
admin override exists.

Apply remote migrations before using admin-managed flags:

```bash
npm run db:migrate:remote
```

Then use `/admin` to toggle flags without redeploying the Worker.

## Admin API

The admin UI saves flags through `POST /api/admin/feature-flag`.

The request must be authenticated with admin Basic Auth and include the mutation
header:

```text
x-admin-action: feature-flag
```

Form fields:

- `key`: one of `checkout` or `cfp`.
- `enabled`: set to `yes` to enable; omit or use any other value to disable.

The route writes the current label and description from
`worker/domain/feature-flags.ts` into D1, so display text stays aligned with the
code definition.

## Adding A New Flag

1. Add the definition to `FEATURE_FLAGS` in `worker/domain/feature-flags.ts`.
2. Add the environment key to `getEnvFeatureFlag`.
3. Add a typed helper such as `isExampleEnabled`.
4. Add the environment variable to `.env.example`, `wrangler.jsonc`, and
   `worker-configuration.d.ts`.
5. Use the helper in Worker routes or runtime config.
6. Document the new flag in this file.

No D1 migration is needed for a new flag key because the `feature_flags` table
stores flags by key.
