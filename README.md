# SDLCAI

Website for the SDLCAI seminar, subtitled "AI meets SDLC", held 13 October 2026 at Marsio Saastamoinen Foundation Stage, Espoo, Finland.

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
- `site/data/`: shared seminar, schedule, speaker, and sponsor data used by the
  public site, public presentation slides, and protected event materials.
- `assets/`: logo, favicon, fonts, and referenced media.
- `worker/index.ts`: Cloudflare Worker, interest form endpoint, and scheduled
  backups.
- `migrations/`: D1 schema.
- `scripts/`: local helper scripts for dotenv, backup decryption, and build
  verification.
- `docs/cloudflare.md`: Cloudflare provisioning, secrets, backup, and deployment
  notes.

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

The build creates a content-addressed manifest for every LinkedIn, X, and
Bluesky graphic. In production, the Worker renders a JPEG on its first request
and reuses it from the Cloudflare cache or R2 thereafter; the build itself does
not require Chromium. To materialize all JPEGs into `build/` for local static
previewing, run `npm run slides:export:social` after a build. That optional
command requires a local Chromium-compatible browser.

Serve the generated build locally:

```bash
npm run serve
```

Format and validate:

```bash
npm run format
npm run format:check
npm run validate
npm run layout:check
npm run a11y:check
```

`layout:check` runs browser-based responsive layout checks, including a focused
accessibility guard for non-inline touch targets smaller than 24 by 24 CSS
pixels. `a11y:check` runs axe-core against every generated route at mobile and
desktop widths. `quality:gate` includes both checks.

## Worker Development

Copy `.env.example` to `.env`, set local `EMAIL_ENCRYPTION_KEY`,
`ADMIN_USERNAME`, and `ADMIN_PASSWORD` values, then generate Wrangler's
`.dev.vars`:

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

`worker:dev` builds the site, verifies the generated output and social render
manifest, and then starts Wrangler. Local development can exercise stable URL
redirects and cached R2 objects. Use the explicit local export command above
for browser-rendered previews; Browser Rendering itself runs on Cloudflare.

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

The public slide library is available at `/slides/`, with a keyboard/swipe deck
at `/slides/deck/` and a screen schedule at `/slides/schedule/`. It includes
per-slide LinkedIn, X, and Bluesky downloads generated from the same event data.
Stable filenames are based on slide IDs rather than schedule order. Each stable
URL redirects to a SHA-256-versioned URL, so unchanged inputs reuse the same
image across deployments.

The deployed Worker also serves `/admin/` and `/admin/slides/` behind HTTP Basic
auth. Event materials under `/assets/slides/`, including the Aalto-exclusive
registration ad, use the same protection. The admin desk lists interested
people and links to `/api/admin/interests.csv` for CSV export.

The schedule and session deck derive from `site/data/seminar.json`,
`site/data/schedule.json`, `site/data/speakers.json`, and
`site/data/sponsors.json`. Sponsor data records the package tier and whether the
contract includes between-talk placement; validation requires Epic and Tech
sponsors to receive that placement and excludes Brand and Location sponsors.

## Deployment

Deploy through Cloudflare Workers Builds or locally with:

```bash
npm run deploy
```

See [Cloudflare setup](docs/cloudflare.md) for provisioning, secrets, backup, and
deployment notes.
