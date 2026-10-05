# SDLCAI

Website for the SDLCAI seminar, subtitled "AI meets SDLC", held 13 October 2026 at Marsio Saastamoinen Foundation Stage, Espoo, Finland.

The site is built with Gustwind and HTMLisp, styled with Tailwind CSS, and
deployed as a Cloudflare Worker with static assets. The production domain is
`sdlcai.org`.

The seminar is sold out. The homepage shows a brief notice with ticket information
at `/checkout/` and links to the YouTube livestream. Public registration links, the Tito widget,
and the old interest-signup form are removed; the event feed exposes ticket
information without a registration action.

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
- `worker/qa*.ts`: audience questions, persistent session rooms, and revocable
  moderator/MC access.
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

The layout checker closes Chromium before starting Mobile Safari/WebKit to
reduce memory pressure. Each WebKit check has a 35-second deadline, including
navigation and font/layout evaluation, followed by up to 5 seconds for context
cleanup. Failures report the route and viewport and preserve the original error
if cleanup also stalls. Browser shutdown falls back to terminating the
validation-owned process after 5 seconds.

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
`/admin/interests/`, `/admin/volunteers/`, `/admin/activity/`, `/admin/qa/`,
`/admin/attendees/`, and `/admin/slides/`. Organizers sign in through the
password-manager-compatible form at `/admin/login/`; a signed, secure cookie
keeps the browser session active for seven days. HTTP Basic credentials remain
accepted when supplied proactively by scripts, but unauthenticated browser
requests no longer receive a Basic auth challenge. Event materials under
`/assets/slides/`, including the Aalto-exclusive registration ad, use the same
protection. Organizers can prefill or approve speaker profile, talk, social, and
portrait revisions from the speakers workspace, and monitor each speaker's
private presentation setup and dinner response. Approved changes publish to
versioned D1 records; Git retains stable IDs, talk ownership, session times,
and the seed/fallback copy. Published talk order and session placement live in D1.
The activity log stores the time, actor account, speaker target, and kind of
successful change without copying submitted values. It starts when migration
`0019_create_activity_events.sql` and the corresponding Worker are deployed;
the shared admin account does not identify individual organizers.

The schedule structure and session deck scaffold derive from
`site/data/seminar.json`, `site/data/schedule.json`, `site/data/speakers.json`,
and `site/data/sponsors.json`; the Worker resolves mutable speaker and talk copy
from D1. Sponsor data records the package tier and whether the contract includes
between-talk placement; validation requires Epic and Tech sponsors to receive
that placement and excludes Brand and Location sponsors.

## Discussion tables

At `/admin/discussion-tables/`, organizers can review eight program-based topics
and download an eight-page A4 PDF for the standing tables. Each page has two
oppositely oriented labels and a base panel. Print A4 portrait, single-sided,
at actual size, fold on the two dashed lines (99 and 198 mm), and tape the
open edge underneath to form a standing triangular tent.

Topic titles, starter questions, and program connections live in
`site/data/discussion-tables.json`. After editing them, regenerate with
`npm run tables:export` (requires [uv](https://docs.astral.sh/uv/)). The export
script installs its declared Python dependencies in an isolated environment and
uses the site's Finlandica fonts. It writes `output/pdf/sdlcai-2026-discussion-tables.pdf`
and the protected copy under `/assets/slides/`. The normal build uses the committed
PDF without Python or a browser; build verification detects stale source or PDF files.

## Audience Q&A

`/qa/` lets attendees submit questions without a name or sign-in and vote once
per question from their browser. New questions are visible only to their author
and moderators until approved. Moderators can approve, edit, hide, or add
questions; MCs select one approved question for `/qa/screen/` and mark it
answered. `/qa/present/` provides a read-only approved queue. Live updates use
server-sent notifications, with polling on connection failures. Forms also work
without JavaScript; refresh manually for new questions.

Manage the event at `/admin/qa/`:

1. Choose **Make active** for a session and **Open questions**. Four session rooms
   are seeded; additional rooms can be created. Every room starts paused, and
   the audience entry starts closed.
2. Create a named **Moderator** or **MC** access link and copy it to that person.
   Links work on multiple devices and after sign-out, and stay valid until
   explicitly revoked. Signing in creates a 14-day browser session; the same
   link can create another session whenever needed.
3. Share `https://sdlcai.org/qa/` with attendees and open `/qa/screen/` on the
   projector. Switch the active room between sessions; questions and votes stay
   in their original room. Attendee drafts survive a switch and require an
   explicit review before moving to the new session.
4. After the event, close audience entry, export questions if wanted, archive
   rooms, and **Revoke access** on each staff link. Revocation invalidates the
   link and every browser session created through it. Archiving retains data;
   clearing a room requires typing `CLEAR` and deletes its questions and votes.

The anonymous participant cookie lasts 18 hours. It identifies a browser,
not a person: clearing cookies or changing browsers can allow another vote.
No raw IP addresses or attendee contact details are stored in QA room data.
Staff action history is available through the protected
`/api/admin/qa/history?room=<room-id>` endpoint.

Apply `0022_create_qa_rooms_and_access.sql` before deploying. `wrangler.jsonc`
adds the SQLite Durable Object classes `QaRoom` and `QaUpdates`; Wrangler applies
their `qa-v1` migration on deployment. The existing `EMAIL_ENCRYPTION_KEY` secures
staff access and participant cookies. No additional secrets or dependencies are
needed. Room contents live in Durable Object storage and are not included in
the site's existing D1/R2 backup job; use the per-room CSV export for an event
record. See [ADR-012](docs/adrs/implemented/ADR-012-integrate-event-qa-with-revocable-staff-links.md).

Run `npm run qa:browser-check` after a build for the complete audience,
moderator, MC, projector, access-revocation, and native-form flow. It uses an
isolated local Worker and is included in `quality:gate`.

## Speaker publishing

Trusted speakers can save drafts or publish profile and talk changes immediately.
Validated photo uploads publish automatically, and processed videos are automatically
approved for promotional use within their recorded permissions. Authentication,
validation, stale-edit protection, revision history, and activity logging remain in place.
Existing pending submissions still use organizer review; new publications bypass the queue.

See [ADR-010](docs/adrs/implemented/ADR-010-auto-approve-speaker-changes.md).

## Daily speaker review digest

At 09:00 Europe/Helsinki, the Worker emails `info@sdlcai.org` a digest of
submitted speaker profile and talk changes awaiting review. It includes current
and proposed text (long fields are excerpted), with a private **Review and
approve** link for each revision. Drafts, approved revisions, and the private
organizer test speaker are excluded. Pending work is repeated daily until
reviewed; an empty review queue sends no email.

The email link opens `/speaker-review/<token>` with every changed field in full.
No admin sign-in is needed. **Approve and publish changes** submits an explicit
same-origin POST and publishes through the same version-checked D1 transaction
as admin approval. GET/HEAD requests never publish or consume the link, so mail
scanners cannot approve by following URLs. A link grants only approval of that
revision, expires after seven days, and stops working when the revision is
reviewed or its content changes. Concurrent published edits require reconciliation
in `/admin/speakers/`; requesting changes also uses the existing admin workflow.
Email approvals are recorded as `email:info@sdlcai.org` in the revision audit.

Apply `0017_create_speaker_review_digests.sql` before deploying. No new service
bindings or secrets are needed: the feature uses D1, the existing `EMAIL`
binding, and purpose-specific hashes derived from `EMAIL_ENCRYPTION_KEY`.
Google Workspace continues to receive inbound mail; approval by email reply is
not supported. These private links should not be forwarded.

`SPEAKER_REVIEW_DIGEST_ENABLED` enables both digests and email approval links.
The hourly `0 * * * *` trigger checks Helsinki local time, so 09:00 follows DST.
A D1 date claim and 30-minute lease prevent overlapping sends; failed runs can
retry on later hours, at most four attempts per day. A completed or empty day's
digest is never resent. As with other external email sends, a provider accepting
a message immediately before a process failure can cause a duplicate on retry.
Daily maintenance at `17 2 * * *` still runs independently, deleting expired
approval hashes and delivery records older than 30 days. Email bodies and raw
approval tokens are not stored in delivery records or application logs.

## Schedule editor

At `/admin/schedule/`, drag talks within or between sessions, then select
**Save changes** to publish the complete running order. Up/Down buttons and a
session selector provide keyboard and mobile alternatives. Changes stay in the
browser until saved; reloading a dirty draft asks before discarding it. A stale
save is rejected without overwriting the published schedule.

Migration `0016_create_schedule_order.sql` seeds the versioned schedule from
the bundled JSON. Apply it before deploying. All scheduled talks must appear
exactly once. Session times and talk ownership remain in Git; adding or removing
talks or sessions requires a migration updating the stored schedule too.

Public schedule pages, session decks, screen schedules, the slide library,
speaker session labels, and the event feed use the published order. Slide links
use stable `slideId` values; numeric `slide` links remain supported. Generated
graphics include the schedule in their cache version. Public HTML falls back to
the bundled schedule without caching if D1 is unavailable; admin reads and saves,
the feed, and new graphics fail closed.

## Volunteers

At `/admin/volunteers/`, organizers can add, edit, and remove volunteers by
name, email, and optional free-text task. Records are private and encrypted
using the existing `EMAIL_ENCRYPTION_KEY`. Stale edits and removals are rejected
until the list is reloaded. Apply `0015_create_volunteers.sql` before deploying
this section; no new bindings or secrets are needed.

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

`deploy` runs `quality:build` (build, types, integration tests, and generated-site
validation), applies pending production D1 migrations, and then deploys the Worker.
A failed migration stops deployment. It does not install or launch browsers.
Workers Builds can keep `npm run worker:build` as the build command and
`npm run deploy` as the deploy command.

GitHub Actions runs the complete `quality:gate`, including responsive layout,
slides, and accessibility checks, on pull requests and pushes to `main`. Its
Ubuntu runner installs Chromium, WebKit, and their OS dependencies. Require the
`Quality gate` status check in branch protection to block merges on failures.
Cloudflare Workers Builds runs independently of this workflow.

See [Cloudflare setup](docs/cloudflare.md) for provisioning, secrets, backup, and
deployment notes.

Administrators can add dinner guests manually from **Add Guest** on `/admin/dinner/`.
Each save creates a separate encrypted response alongside shared RSVP guests,
with attending guests included in the caterer CSV as “added by admin”. The form
records the administrator’s confirmation that the guest agreed to the processing.
Manual additions remain available until dinner data retention ends and use the
existing dinner cleanup and backup exclusions; no additional migration is needed.

### Organizer digests

The hourly Worker cron also sends these transactional emails to `info@sdlcai.org`:

- **Poster proposals:** daily from 09:00 Europe/Helsinki, listing submitted,
  shortlisted and waitlisted proposals until a final decision is recorded. The
  email includes proposal titles, presenter names and a link to `/admin/posters/`.
  It shows the oldest 50 pending proposals and the total pending count.
- **Data modifications:** Mondays from 09:00 Europe/Helsinki (with catch-up on
  later days), summarizing additions, updates and deletions since the previous
  completed digest. It covers registration interests, posters, speaker contacts,
  published speaker/talk content, content/photo revisions, videos, presentation
  and dinner responses, travel receipts, volunteers and programme order.
  Counts include automated cleanup and repeated writes; private field values,
  authentication activity, email delivery records and repository changes are
  excluded. Tracking begins when migration `0018` is applied; it cannot reconstruct
  earlier changes.

Empty digests send no email. `POSTER_REVIEW_DIGEST_ENABLED` and
`DATA_CHANGE_DIGEST_ENABLED` independently control delivery. The existing speaker
review digest remains separate. Apply D1 migrations before deploying the Worker
(the normal `npm run deploy` does this).

Delivery records in `organizer_digests` prevent ordinary duplicate cron deliveries
and allow up to four attempts per period, with a 30-minute lease between attempts.
Weekly retries keep their original change cutoff; later changes carry into the
next digest, including after a failed week. As with the speaker digest, a crash
between provider acceptance and recording success can result in a duplicate.
`organizer_data_changes` stores only table names, operations and timestamps, not
copies of personal data. Adding another application table requires adding its
tracking triggers to a migration and its display label to the digest.

## Attendee management and registration desk

Apply `0023_create_attendee_registration.sql` before deploying. At
`/admin/attendees/`, import Tito and Webropol CSVs separately using the same
column-mapping workflow previously used by badges. Map individual ticket codes and attendee
emails, preview the rows, then import. A ticket code identifies a registration
within its source; without a code, attendee email is the identity. Keep the
same identity columns on subsequent imports. Correcting a ticket code or an
email-only identity also updates its import key while keeping the attendee ID.
Re-imports update matching
registrations, retain their IDs, arrival records and badge choices, and leave
omitted registrations in place. Ticket status accepts active/valid/confirmed/
paid/complete/completed/issued/registered/assigned and cancelled/canceled/void/
voided/refunded/expired/deleted. Unknown mapped statuses reject the import.
If no status column is mapped, all imported rows are active; filter inactive
tickets out of the source export first.

Create a named staff link for each person handling registration. The link opens
`/registration/access/` and requires **Open registration desk** to sign in. Links
remain reusable until revoked; the HttpOnly browser session lasts 14 days.
Revocation ends every session for that link. Registration staff can search by
name/email or look up an exact ticket code and mark an active registration as
arrived. They cannot edit attendees, import data, undo arrivals, print badges,
or open organizer tools. Q&A and registration links grant separate access.

Arrival writes are atomic, reject repeat/stale submissions, record the staff
link and time, and compare the roster revision shown to staff with the current
registration list. Changes require staff to reload and verify the ticket again.
Writes recheck registration changes and revoked access inside SQL.
Organizers can edit attendee details, cancel tickets, choose badge inclusion,
and undo mistakes. A cancelled ticket cannot be checked in. The desk refreshes
every 15 seconds while visible; unfinished edits pause refreshes. Edit drafts
survive filtering, reloads and saves to other attendees. Corrections to the same
attendee still require resolving a stale draft before saving. Retry and sign-out
remain available if the initial list cannot load. The list is
a copy of the imported export: it does not check live provider payment/refund
status or update Tito/Webropol. Refresh the export before opening registration.

The badge studio automatically loads active, badge-selected registrations from
the current list. Arrival is independent of badge inclusion. Imports, attendee
corrections and inclusion choices belong in `/admin/attendees/`.

Names, companies, emails and ticket codes are encrypted in the D1 roster.
Arrival history stores record IDs, actor IDs, action and time without contact
details. Daily R2 backups include the encrypted roster, arrivals and history,
and omit staff credentials. **Download attendee list** exports a private JSON
copy with contact details for event use. Retention cleanup must remove attendee
data from the D1 roster, related badge copies, downloaded files and R2 backups.
No new bindings, secrets or dependencies are needed.

Run `npm run attendees:browser-check` after a build for imports, scoped staff
sign-in, ticket lookup, arrival tracking, automatic badge loading, revocation and layout.

## Organizers and badge printing

Apply `0020_create_organizers_and_badges.sql` before deploying this version.
`/admin/organizers/` is the canonical organizer editor: homepage visibility and
attending/badge inclusion are independent. The existing nine homepage organizers
are seeded once, visible on the homepage, with badge inclusion off until selected.

At `/admin/badges/`, preview and generate badges from the current attendee and
team records. Active, badge-selected attendees, public speakers, selected
organizers, and attending volunteers load automatically. Manage names, contact
details and inclusion in their own workspaces; volunteer inclusion is controlled
in `/admin/volunteers/`. Badge-only name/company adjustments allow line breaks
without editing registration data. Save print settings and these adjustments
for reprints. A source correction invalidates outdated text and duplicate
confirmations. Matching emails still require explicit review before printing.

Earlier saved badge lists remain encrypted and downloadable. Unmatched earlier
CSV/manual rows remain available for printing until represented by a registration;
a cancelled or excluded current registration cannot revive its earlier badge.
Import those registrations in Attendees to move them into the current roster.
Use **Retire earlier badge**, then **Save print settings**, for obsolete earlier
rows, including rows without emails. **Restore retired earlier badges** clears
these choices without changing current registrations or team inclusion.
Earlier exclusions become retirement choices too, so restoring an excluded
CSV/manual badge makes it printable even without an email or ticket code.
The original snapshot keeps its earlier inclusion choices for downloads.
The badge studio has no CSV import, manual person creation, or roster editing.
The 2,000-person limit applies to the attendee roster; the combined badge run
includes additional team and earlier records. Print preferences are bounded by
request and encrypted storage size rather than a combined record count.

Printer settings start at 100 mm diameter with one badge per PDF page. Adjust
bleed, safe margin, top clearance, readable font sizes, trim guide, and repeated
front/back pages as needed. Print buttons recheck layout and font coverage and
block unresolved problems. Custom TTF/OTF fonts are tab-local and must be loaded
again after a reload. The bundled Noto Sans is licensed under the SIL Open Font
License; its source and license are in `assets/badges/`.

Use 100% print scale, enable background graphics, disable headers/footers, and
confirm dimensions and duplex order with the printer. Browser PDFs use RGB, not
CMYK/PDF-X. Print a physical proof before the full run.

Run `npm run badges:browser-check` after a build to test live records, duplicate
handling, long/Unicode names, print preferences, source updates, responsive layout,
and actual print pagination. Test proof files are temporary files under `/tmp/`.
See [ADR-011](docs/adrs/implemented/ADR-011-manage-organizers-and-validated-badge-printing.md).
