# Cloudflare Setup

This site is deployed as a Cloudflare Worker with static assets, D1 for the
interest list and poster proposals, R2 for encrypted backups, Turnstile for bot
protection, and a scheduled Worker trigger for daily backup export.

## Bindings

`wrangler.jsonc` expects these bindings:

| Binding                    | Type           | Purpose                                                    |
| -------------------------- | -------------- | ---------------------------------------------------------- |
| `ASSETS`                   | Workers Assets | Serves the Gustwind build output from `build/`.            |
| `INTERESTS`                | D1             | Stores encrypted interest and poster proposal records.     |
| `INTEREST_BACKUPS`         | R2             | Stores daily encrypted JSON backups for both record types. |
| `ADMIN_USERNAME`           | Secret         | Username for HTTP Basic auth protecting `/admin/`.         |
| `ADMIN_PASSWORD`           | Secret         | Password for HTTP Basic auth protecting `/admin/`.         |
| `TURNSTILE_SITE_KEY`       | Worker var     | Public Turnstile widget site key injected into HTML.       |
| `TURNSTILE_HOSTNAMES`      | Worker var     | Comma-separated hostnames accepted from Siteverify.        |
| `TURNSTILE_SECRET_KEY`     | Secret         | Server-side Turnstile verification key.                    |
| `EMAIL_ENCRYPTION_KEY`     | Secret         | Key material for encryption and keyed fingerprints.        |
| `POSTER_PROPOSAL_DEADLINE` | Worker var     | ISO timestamp after which public proposals return `410`.   |

The production poster deadline is `2026-09-27T20:59:59Z`, which is 23:59 EEST
on 27 September 2026. Acceptance is rolling; the deadline only controls when
the public endpoint stops accepting submissions.

## Local Testing

Copy the example dotenv file and set a local-only encryption key:

```bash
cp .env.example .env
```

Generate a strong local value for `EMAIL_ENCRYPTION_KEY`, for example:

```bash
openssl rand -base64 32
```

Turnstile is optional locally. If both the site key and secret key are empty,
the form hides the widget and the Worker skips verification. If either key is
configured, both are required and submissions fail closed unless
`TURNSTILE_HOSTNAMES` is also configured. The local default is
`localhost,127.0.0.1`; the production value is
`sdlcai.org,www.sdlcai.org`. The Worker requires both an allowed hostname and
the `turnstile-spin-v2` action in successful Siteverify responses. The client
loads at most one Turnstile script even when a page contains more than one
widget.

`ADMIN_USERNAME` and `ADMIN_PASSWORD` are required locally to open `/admin/`.
Prepare Wrangler's local `.dev.vars`, apply all local D1 migrations, and start
the Worker:

```bash
npm run dev:env
npm run db:migrate:local
npm run worker:dev
```

The poster page is at `/posters/`. Test successful submission, duplicate
submission, required-field validation, Turnstile gating, admin status changes,
and both CSV downloads through the Worker rather than the static development
server.

## Production Provisioning

The repository includes `.node-version` with Node 24 because Gustwind requires
Node 24 or newer. Cloudflare's build image also accepts a `NODE_VERSION`
environment variable, but the checked-in version file keeps the Git integration
aligned without dashboard-only configuration.

Create the D1 database and copy the returned `database_id` into
`wrangler.jsonc`:

```bash
wrangler d1 create ai-meets-sdlc-interests
```

Create the R2 backup bucket:

```bash
wrangler r2 bucket create ai-meets-sdlc-interest-backups
```

Create a Turnstile widget in the Cloudflare dashboard, then set:

- `TURNSTILE_SITE_KEY` in `wrangler.jsonc`
- `TURNSTILE_HOSTNAMES` in `wrangler.jsonc`
- `TURNSTILE_SECRET_KEY` as a Worker secret

Set production secrets:

```bash
wrangler secret put ADMIN_USERNAME
wrangler secret put ADMIN_PASSWORD
wrangler secret put EMAIL_ENCRYPTION_KEY
wrangler secret put TURNSTILE_SECRET_KEY
```

Use a strong `EMAIL_ENCRYPTION_KEY` and keep it outside version control. Losing
it means existing encrypted submissions and backups cannot be decrypted.

## API and Admin Surface

The public `POST /api/poster-proposals` endpoint accepts browser form data as
`multipart/form-data` or `application/x-www-form-urlencoded`, capped at 32 KiB,
with these fields:

- `name` (the designated presenter), `email`, `organization`
- `authors`, `title`, `abstract`
- `poster_size` (`a0`, `a1`, or `either`)
- `supporting_url`, `setup_notes`
- `terms=yes`, `consent=yes`
- `cf-turnstile-response` when Turnstile is configured

It returns `201` for a new proposal, an idempotent success response for a
duplicate email-and-title fingerprint, validation errors as `400`, and `410`
after `POSTER_PROPOSAL_DEADLINE`; oversized submissions return `413`. Turnstile
tokens are always verified by the Worker when the secret is configured;
client-side gating is only a user experience safeguard.

The admin page is available at `/admin/`. It and every `/api/admin/` route are
protected with HTTP Basic auth. Admin responses containing personal data use
`Cache-Control: no-store`.

| Method | Endpoint                             | Purpose                                      |
| ------ | ------------------------------------ | -------------------------------------------- |
| `GET`  | `/api/admin/interests`               | Decrypted interest contacts as JSON.         |
| `GET`  | `/api/admin/interests.csv`           | Decrypted interest contacts as CSV.          |
| `GET`  | `/api/admin/poster-proposals`        | Decrypted proposals and total count as JSON. |
| `GET`  | `/api/admin/poster-proposals.csv`    | Decrypted proposals as CSV.                  |
| `POST` | `/api/admin/poster-proposals/status` | Change one proposal's review status.         |

The status endpoint accepts FormData containing `id` and `status`. Allowed
statuses are `submitted`, `shortlisted`, `accepted`, `waitlisted`,
`declined`, and `withdrawn`. In addition to Basic auth, a status change
requires a same-origin `Origin` header and
`x-admin-action: update-poster-status`. Returning a proposal to `submitted`
clears `reviewed_at`; every other status sets it to the update time.

CSV exports contain decrypted personal data. Store and share downloaded files
as confidential event-administration records.

## Data Model

Migration `0001_create_interests.sql` creates `interests` with:

- encrypted email, name, and organization plus AES-GCM IV values
- a keyed HMAC email hash for deduplication
- the consent text and creation timestamp

Migration `0002_create_poster_proposals.sql` creates `poster_proposals` with:

- encrypted name, email, organization, authors, title, abstract, supporting
  URL, and setup notes plus AES-GCM IV values
- a unique keyed fingerprint derived from normalized email and title for
  duplicate handling
- plaintext poster size, submitted terms and consent text, workflow status,
  and created, updated, and reviewed timestamps
- checks for the poster size and status enums and paired optional
  ciphertext/IV values
- indexes on `created_at` and `status`

Plaintext contact details, author details, abstracts, URLs, and setup notes are
not stored in D1 or R2. They are decrypted only for authenticated admin JSON and
CSV responses.

## Backups

The Worker has a daily scheduled trigger:

```json
"crons": ["17 2 * * *"]
```

The scheduled handler backs up both tables independently:

```text
interests/YYYY-MM-DD.json
interests/latest.json
poster-proposals/YYYY-MM-DD.json
poster-proposals/latest.json
```

For each table, the Worker hashes the encrypted row export and compares it with
the relevant `latest.json` manifest. If the hash is unchanged, it skips that
dated backup. When rows change, it writes a dated JSON export and updates the
manifest with the latest key, export time, row count, and row hash.

Backups intentionally contain ciphertext, IV values, keyed hashes or
fingerprints, workflow metadata, and the fixed consent/terms text—not decrypted
proposal or contact fields.

### Decrypting an interest backup

Download an interest backup JSON file from R2, then run:

```bash
EMAIL_ENCRYPTION_KEY=... npm run interests:decrypt -- backup.json
```

The script prints CSV with `email`, `name`, `organization`, and `created_at`.
Poster proposals are reviewed and exported through the authenticated admin
page; there is no separate proposal-backup decryption CLI.

## Migration and Rollout

The poster table is additive, so apply the D1 migration before deploying the
Worker and public form:

```bash
npm run db:migrate:remote
npm run deploy
```

For production rollout:

1. Confirm the D1 and R2 bindings, deadline, Turnstile site key, accepted
   hostnames, and all four secrets are configured. The Turnstile widget's
   dashboard allowlist must include both `sdlcai.org` and `www.sdlcai.org`.
2. Apply `0002_create_poster_proposals.sql` remotely and verify Wrangler reports
   the migration as applied.
3. Deploy the Worker and static build.
4. Open `/posters/`, verify the deadline and A0/A1 portrait terms, and submit a
   controlled test proposal.
5. Open `/admin/` with Basic auth, confirm the proposal decrypts, change its
   status, and verify both proposal and interest CSV exports.
6. After the next scheduled trigger, confirm the
   `poster-proposals/latest.json` manifest and its referenced dated object exist
   in R2.

If application rollback is needed, deploy the preceding Worker version. Leave
the additive table in place; removing it would destroy submitted proposals.

## Retention Follow-up

Schedule a manual proposal-retention review for no later than 31 January 2027.
During that reviewed operation, remove personal data for non-accepted proposals
from D1 and delete or replace historical `poster-proposals/` backup objects that
still contain those rows. A fresh accepted-only encrypted backup does not make
older objects safe to retain. For accepted proposals, remove contact details
and operational notes when they are no longer needed for event administration
or legal obligations; published title, author, and abstract information may
remain as part of the event record.

Treat the retention cleanup as a reviewed production operation: record
non-personal aggregate counts if needed, confirm the exact affected statuses,
take the approved deletion action, and verify both D1 and R2 afterward.
