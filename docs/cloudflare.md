# Cloudflare Setup

This site is deployed as a Cloudflare Worker with static assets, D1 for the interest list, R2 for encrypted backups, Turnstile for bot protection, and a scheduled Worker trigger for daily backup export.

## Bindings

`wrangler.jsonc` expects these bindings:

| Binding                | Type           | Purpose                                                 |
| ---------------------- | -------------- | ------------------------------------------------------- |
| `ASSETS`               | Workers Assets | Serves the Gustwind build output from `build/`.         |
| `INTERESTS`            | D1             | Stores encrypted interest list submissions.             |
| `INTEREST_BACKUPS`     | R2             | Stores daily encrypted JSON backups.                    |
| `TURNSTILE_SITE_KEY`   | Worker var     | Public Turnstile widget site key injected into HTML.    |
| `TURNSTILE_SECRET_KEY` | Secret         | Server-side Turnstile verification key.                 |
| `EMAIL_ENCRYPTION_KEY` | Secret         | Key material for encrypting/de-duplicating submissions. |

## Local Testing

Copy the example dotenv file and set a local-only encryption key:

```bash
cp .env.example .env
```

Generate a strong local value for `EMAIL_ENCRYPTION_KEY`, for example:

```bash
openssl rand -base64 32
```

Turnstile is optional locally. If `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are empty, the form hides the widget and the Worker skips Turnstile verification.

Prepare Wrangler's local `.dev.vars`, apply the local D1 migration, and start the Worker:

```bash
npm run dev:env
npm run db:migrate:local
npm run worker:dev
```

## Production Provisioning

Create the D1 database and copy the returned `database_id` into `wrangler.jsonc`:

```bash
wrangler d1 create ai-meets-sldc-interests
```

Create the R2 backup bucket:

```bash
wrangler r2 bucket create ai-meets-sldc-interest-backups
```

Create a Turnstile widget in the Cloudflare dashboard, then set:

- `TURNSTILE_SITE_KEY` in `wrangler.jsonc`
- `TURNSTILE_SECRET_KEY` as a Worker secret

Set production secrets:

```bash
wrangler secret put EMAIL_ENCRYPTION_KEY
wrangler secret put TURNSTILE_SECRET_KEY
```

Use a strong `EMAIL_ENCRYPTION_KEY` and keep it outside version control. Losing it means existing encrypted submissions and backups cannot be decrypted.

Apply the D1 migration remotely:

```bash
wrangler d1 migrations apply ai-meets-sldc-interests --remote
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

The D1 migration creates `interests` with:

- encrypted email, name, and organization
- AES-GCM IV values for each encrypted field
- keyed HMAC email hash for deduplication
- consent text
- creation timestamp

Plaintext email is not stored in D1 or R2.
