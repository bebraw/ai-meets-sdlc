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
- `assets/social/`: [social promotion pack](assets/social/README.md), including
  dark feed graphics for Bluesky, X, and Facebook. Re-export with
  `npm run social:export`.
- `worker/index.ts`: public/admin request routing and scheduled job orchestration.
- `worker/interests.ts`, `worker/poster-proposals.ts`, `worker/speaker-dinner.ts`:
  form handlers, validation, storage, and exports for each workflow.
- `worker/backups.ts`, `worker/receipt-backups.ts`: scheduled metadata backups
  and deduplicated encrypted receipt recovery snapshots.
- `worker/static-responses.ts`: asset mapping, caching, runtime config, and calendar.
- `worker/speaker-workspace.ts`: speaker and organizer workspace routing.
- `worker/speaker-login.ts`, `worker/speaker-admin.ts`,
  `worker/speaker-announcements.ts`, `worker/speaker-content.ts`,
  `worker/speaker-responses.ts`: sign-in, organizer review, email campaigns,
  speaker edits, and private dinner/presentation responses.
- `worker/speaker-content-validation.ts`, `worker/speaker-workspace-types.ts`,
  `worker/speaker-workspace-utils.ts`, `worker/form-utils.ts`: validation,
  shared contracts, configuration, security, and bounded request parsing.
- `worker/speaker-cleanup.ts`: expired workspace data and deleted receipt cleanup.
- `migrations/`: D1 schema.
- `scripts/`: local helper scripts for dotenv, backup decryption, and build
  verification.
- `docs/cloudflare.md`: Cloudflare provisioning, secrets, backup, and deployment
  notes.

## Development

The [public event feed](docs/event-feed.md) is generated and validated with the
site at `/event.json`, with its JSON Schema at `/event.schema.json`.

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
npm run layout:install-browsers
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

The deployed Worker serves a protected dashboard at `/admin/`, with focused
workspaces at `/admin/speakers/`, `/admin/dinner/`, `/admin/receipts/`, `/admin/posters/`,
`/admin/interests/`, and `/admin/slides/`. Organizers sign in through the
password-manager-compatible form at `/admin/login/`; a signed, secure cookie
keeps the browser session active for seven days. HTTP Basic credentials remain
accepted when supplied proactively by scripts, but unauthenticated browser
requests no longer receive a Basic auth challenge. Event materials under
`/assets/slides/`, including the Aalto-exclusive registration ad, use the same
protection. Organizers can prefill or approve speaker profile, talk, social, and
portrait revisions from the speakers workspace, and monitor each speaker's
private presentation setup and dinner response. Approved changes publish to
versioned D1 records; Git retains stable IDs, assignments, schedule placement,
and the seed/fallback copy.

The schedule structure and session deck scaffold derive from
`site/data/seminar.json`, `site/data/schedule.json`, `site/data/speakers.json`,
and `site/data/sponsors.json`; the Worker resolves mutable speaker and talk copy
from D1. Sponsor data records the package tier and whether the contract includes
between-talk placement; validation requires Epic and Tech sponsors to receive
that placement and excludes Brand and Location sponsors.

## Speaker travel receipts

At `/admin/receipts/`, enable uploads for the speakers whose travel expenses
have been agreed. Their private workspace then accepts PDF, JPEG, PNG, and
WebP receipts, with an expense description, date, original amount and currency,
and optional note. The limit is 10 MB per file and 30 receipts per speaker.
Speakers can download their own receipts and delete unprocessed submissions to
replace mistakes. Uploads use the existing speaker access period, currently
ending 31 October 2026; organizer review remains available afterwards.

The receipts inbox filters by speaker and processing status, provides original
file downloads and a CSV of all receipt details, and records processing notes
visible to the speaker. Marking a receipt processed does not transfer money.
CSV download links require organizer access; download the files separately when
saving accounting records.

Migration `0013_create_speaker_travel_receipts.sql` adds the private metadata
and upload-access tables. Apply it before deploying this feature:

```sh
npm run db:migrate:remote
```

Receipt files use the existing private `SPEAKER_UPLOADS` R2 bucket, under the
`travel-receipts/` prefix. Files and metadata use AES-GCM with a receipt-specific
context and a key derived from `EMAIL_ENCRYPTION_KEY`. Keep this encryption key
available while receipts are retained. No new bindings or secrets are needed.
Records do not cascade from speaker contacts and are not expired by dinner or
presentation cleanup. Organizers explicitly delete receipts after processing
and saving any required records. Failed object deletions are retried by the
daily cleanup. The daily scheduled backup includes active receipt records, upload-access
settings, and encrypted files in the private `INTEREST_BACKUPS` bucket. Unchanged
runs do not write duplicate objects; status changes reuse existing file copies.
See [receipt backup and recovery](docs/cloudflare.md#receipt-backup-and-recovery)
for retention and verified restore instructions.

## Deployment

Deploy through Cloudflare Workers Builds or locally with:

```bash
npm run deploy
```

`deploy` runs `quality:build` before invoking Wrangler: build, types, integration
tests, and generated-site validation. It does not install or launch browsers.
Workers Builds can keep `npm run worker:build` as the build command and
`npm run deploy` as the deploy command.

GitHub Actions runs the complete `quality:gate`, including responsive layout,
slides, and accessibility checks, on pull requests and pushes to `main`. Its
Ubuntu runner installs Chromium, WebKit, and their OS dependencies. Require the
`Quality gate` status check in branch protection to block merges on failures.
Cloudflare Workers Builds runs independently of this workflow.

See [Cloudflare setup](docs/cloudflare.md) for provisioning, secrets, backup, and
deployment notes.
