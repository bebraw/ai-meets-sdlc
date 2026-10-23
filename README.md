# SDLCAI

Website for the SDLCAI seminar, subtitled "AI meets SDLC", held 13 October 2026 at Marsio Saastamoinen Foundation Stage, Espoo, Finland.

The site is built with Gustwind and HTMLisp, styled with Tailwind CSS, and
deployed as a Cloudflare Worker with static assets. The production domain is
`sdlcai.org`.

The homepage introduces SDLCAI and offers double-confirmed mailing-list signup
for announcements about the next seminar. The 2026 event lives at `/2026/`, with
its programme, speaker profiles, photographs, event news and practical details
under that year. The main navigation links to the archive, contact details and
email updates. Former resource URLs permanently redirect into `/2026/`, keeping
query parameters and existing talk/section anchors intact.

The official channel is <https://www.youtube.com/@SDLCAI>, linked from the
homepage, 2026 archive, programme and shared footer. It is also included in
the site's identity links and event structured data. Channel branding sources
and exports are in [the YouTube asset package](assets/youtube/README.md).
When edited videos are published, add their URLs through the existing admin
recording-link controls so each talk's public materials include its recording.

Speaker materials still come from canonical D1 records and private R2 storage;
archiving does not change sharing permission or publication state. Admin tools,
speaker workspaces, registration access and public media APIs keep their URLs.
The existing public event feed remains available at `/event.json`, with the same
2026 dataset also available at `/2026/event.json`.

The public social mentions collection is at `/2026/social-mentions/`, linked
from the archive and its resource navigation. Its 67 selected posts, comments
and follow-ups are adapted from the Obsidian register
`SDLCAI/2026/Social mentions.md`, compiled through 21 October 2026. The companion
CSV remains the 19 October snapshot; M61–M70 are note-only additions. Public
summaries and source links live in
`site/data/social-mentions.json`; the page preserves the register's M-series
IDs, affiliations, criticism and participation context. Follow-up discussion
and Bluesky website feedback have separate categories. The two unverified
engagement signals, the Threads mention with an unverified date and event,
and research-only links are omitted. Keep summaries as
paraphrases and distinguish reported actions from measured outcomes when
updating the collection.

The public poster archive is at `/2026/posters/`, linked from the 2026 archive
and its resource navigation. It includes Moses Nderemani's **Minimum Viable
Disclosure**, Juho Vepsäläinen and Fernando Miguel Carvalho's **Hypermedia as
a Substrate for the Agentic Web: From Documents to Affordances**, and Udayanto
Dwi Atmojo's **Software Engineering in Safety and Mission Critical Applications**.
Original PDFs and WebP previews are stored under `assets/posters/2026/`; the page
content is in `site/layouts/posters.html`.
Minimum Viable Disclosure also links to its
[code and experiment repository](https://github.com/nderecash/disclosure-curve).

The protected **Content inventory** workspace at `/admin/content-inventory/`
brings together the fourteen recordings, 29 clip candidates, 22 quote candidates,
three posters, eight cross-session themes and four draft article/LinkedIn angles.
It is linked from **Post-production** on the admin desk and workspace menu.
Search or filter by type, review state and speaker, then save a browser-local
shortlist and copy or download an editorial handoff. The positioning targets
senior engineers and delivery leaders, with research context. Candidate excerpts
and series angles retain their editorial review requirements.

Inventory content comes from the build-time video content library and
`production/content-inventory/2026/plan.json`. It is rendered only into protected
admin HTML; the client script contains filtering and shortlist behavior. The
page also links to the photo media bank, full content library and public slides.

Protected **Talk previews** at `/admin/talk-previews/` turn the same content
library into ten draft companion pages. Each includes a summary, five paraphrased
key points with source timestamps, recording chapters, materials, session Q&A
where available and related talks connected through the library's themes.
Context and qualifications remain visible for editorial review. The pages are
linked from the inventory and admin navigation; they are not public archive
pages. The build-time adapter is `site/talk-previews.ts` and the layouts are
`site/layouts/admin-talk-preview.html` and `site/layouts/admin-talk-previews.html`.
Materials are rendered from the same published D1 links as the public programme,
so withdrawn files and later resource updates follow their existing permissions.
Review wording, context and source passages before any public release; exact
quotation candidates and private analysis artifacts are not included in these
views. `npm run content:browser-check` covers the inventory and talk previews.

Each preview also includes a branded takeaway graphic with the existing speaker
portrait, three sourced paraphrases, source timestamps and `sdlcai.org`. Download a
1200 × 630 landscape PNG or 1080 × 1350 portrait PNG, plus draft post copy and
alt text. The preview index offers all twenty images and ten text handoffs as a
ZIP. All downloads stay under `/admin/talk-previews/` and require admin access.
These are editorial drafts for review, not automatically published social posts.

Edit `production/talk-graphics/2026/cards.json`, then run
`npm run talks:graphics:export` to regenerate the PNGs and manifest. The export
uses code-native layouts, brand fonts and the repository's speaker portraits.
Commit the exports and manifest with the source edits. Builds verify source
and image hashes, dimensions and file budgets before copying the files into
protected routes; production builds do not need a browser to render the images.

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

The local [photo media bank](production/media-bank/README.md) catalogs event
photos, applies confirmed camera clock corrections, and provides curation,
collections and credited downloads. Start it with `npm run photos:review`
after preparing the source folder.

The public photo timeline is at `/2026/timeline/`, available from the 2026 archive,
its resource navigation, and the **Explore the photo timeline** button on
`/2026/photos/`. Its layout
is `site/layouts/photo-timeline.html`, with the approved daybook design and
discovery code in `assets/photo-timeline/`. It loads the anonymous public catalog
after the page shell paints, starts with highlights and supports chapters,
speaker programme, talk and topic discovery, photographer filters and shareable
filtered URLs. Programme associations describe context rather than confirmed
people in a photo. Each chapter has an integrated viewer: filmstrip selections
update its large image, caption, programme context and download links in place.
Previous/next controls and arrow keys stay within that chapter, and active frames
survive filter changes when still available. Explicit fullscreen keeps the
photographer credit visible. Theme changes use the
site's `sdlcai-theme` preference. No public archive total is displayed.

Run `npm run timeline:browser-check` after `npm run worker:test-build` for the
isolated Chromium/WebKit check of filters, integrated viewers, credits, themes, catalog
failure/retry and mobile layouts. It is also part of the CI asset browser group.
The earlier concepts under `prototypes/photo-exploration/` remain local sketches;
new production timeline changes belong in the files above.

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

The organizer-only slide library is available at `/slides/`, with a keyboard/swipe deck
at `/slides/deck/` and a screen schedule at `/slides/schedule/`. The separate
12-slide opening presentation is at `/slides/opening/`, linked from the admin
slide tools and slide library. It starts at the welcome slide for the host's
entrance. The optional pre-roll at `/slides/opening/?intro=1` has a **Play intro**
button for the two-minute film with sound; it reveals the welcome slide when
finished, so the film can run before the host steps on stage. Playback starts with
the native 4K master. **Use 1080p** switches to the smaller preview at the current
position if the venue connection or device struggles; load/decode errors also
fall back to 1080p automatically. Playback permission errors keep the play button
available instead of changing resolution. Arrow keys, Page
Up/Down, Home/End, swipe, and the presentation controls navigate the deck.
Continuing to the welcome slide pauses playback. Fullscreen is available from the
controls, which fade out while presenting. Speaker portraits and names use
approved speaker content, and their order follows the published programme.
The Pacman vector is reused from `https://slides.futurefrontend.com/opening`;
the conduct slide links to `https://berlincodeofconduct.org/en`.

The matching seven-slide closing deck is at `/slides/closing/`, also linked from
the admin slide tools and library. It recaps the programme's themes, thanks the
speakers, sponsors, organizers, volunteers, venue team, and attendees, then ends
with a group-photo cue followed by the afterparty. Both decks use the same
keyboard, swipe, and fullscreen controls and published speaker content. Run
`npm run slides:opening-check` to check both decks in Chromium and WebKit at four
viewport sizes. Set `OPENING_SCREENSHOTS` to save full-size review images (closing
slides have a `closing-` prefix).
Direct **Opening slides** and **Closing slides** shortcuts are also in the admin
desk's **Event day** section and **All workspaces** menu. The **Opening slides**
shortcut starts with the 4K film pre-roll, then continues to the welcome deck.

The closing camera icon is from [Lucide](https://lucide.dev/icons/camera), with
a lighter stroke for projection, under the [ISC license](assets/slides/lucide-LICENSE.txt).
The party-popper emoji is [Twemoji](https://github.com/jdecked/twemoji), originally
by Twitter, Inc. and other contributors, used unchanged under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its license is included
at `assets/slides/twemoji-LICENSE-GRAPHICS.txt`.

The session slide library includes
per-slide LinkedIn, X, and Bluesky downloads generated from the same event data.
The library and admin slides page also offer **Download all PNGs — 4K**.
It prepares a ZIP of all slides in current deck order, numbered for production,
at 3840 x 2160 with the slide counter hidden. Individual **Download PNG** links
in the library allow a corrected talk slide to be delivered separately later.
The download shows progress and can be cancelled; its versioned snapshot either
completes consistently or asks for a restart if uncached slides change midway.
Stable filenames are based on slide IDs rather than schedule order. Each stable
URL redirects to a SHA-256-versioned URL, so unchanged inputs reuse the same
image across deployments. All library, deck, screen schedule, 4K PNG, and render
manifest requests require organizer authentication. Social JPEGs and the speaker
promotion manifest require an active speaker or organizer session; speakers
access them from their workspace after sign-in. Authentication runs before
Cache API and R2 reads, and external responses use `no-store`.
For local PNG review, run `npm run build && npm run slides:export:video`.
Then `npm run slides:video-check` checks a real full-deck ZIP in Chromium and WebKit,
including retries, cancellation, changed-content recovery, and mobile controls.

The admin desk and **All workspaces** menu group tools in the same order:
**People** (attendees, badges, organizers, volunteers), **Program** (schedule,
speakers, posters), **Event day** (Q&A, screen assets, venue signs, discussion tables, intro video, break
music), **Hospitality** (dinner, travel receipts), and **Administration**
(activity log, interest list). Each workspace shows its related group links
and highlights the current page. The grouped menu also works without JavaScript;
with scripts enabled, Escape returns focus to the menu button, and clicking or
moving focus outside closes it.

The deployed Worker serves a protected dashboard at `/admin/`, with focused
workspaces at `/admin/speakers/`, `/admin/dinner/`, `/admin/receipts/`, `/admin/posters/`,
`/admin/interests/`, `/admin/volunteers/`, `/admin/activity/`, `/admin/qa/`,
`/admin/attendees/`, `/admin/intro/`, and `/admin/slides/`. Organizers sign in through the
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

At `/admin/intro/`, Draft 03 is the full two-minute Finnish demoscene opening
film: all ten talks follow the published session and speaker order, with static
names and talk titles, straight text cuts, and one continuously morphing shape.
The page has a 1080p review player, a native 3840×2160 master download, and the
CC BY 4.0 attribution for “Cipher” by Kevin MacLeod. The earlier three 36-second
prototypes, research references, and Draft 01 remain available for comparison.
The current immutable assets live under `intro/draft-03-20261013/`,
`intro/prototypes-02-20261010/`, and `intro/draft-01-20261010/` in the existing
`SOCIAL_EXPORTS` R2 bucket.
`/api/admin/intro/` exposes only explicitly allowlisted assets, requires the same
admin authentication as the page, and streams byte ranges for seeking. Draft
responses use `no-store`; no public bucket URL or new D1 state is needed. Keep
new revisions under new object keys.

Before rebuilding film scenes, run `node scripts/intro/sync_programme.mjs` to
validate and snapshot the live feed and schedule in `production/intro/`.
`draft-03-timeline.json` contains 2,880 contiguous frames at 24 fps; cumulative
timings are snapped to frame boundaries and retain the live programme revision.
Refresh `generated/draft-03-portraits/<speakerId>.png` from the snapshot's
`portraitUrl` values before building. `build_draft03.py` exposes
`build_draft03(ROOT, snapshot, timeline)` for Blender MCP and rejects mismatched
programme revisions. `build_draft03_titles.py` preserves the published wording,
checks native glyph bounds, and verifies static transforms and visibility cuts.

Save the editable scene to `output/intro/draft-03.blend`, then run
`render_draft03.py` inside Blender with `--qa` for representative title, pose,
and intermediate-morph frames. Its `--start`/`--end` arguments support disjoint
render ranges and resuming the full native 4K sequence. A changed scene needs
fresh frames: resumable rendering skips existing JPEGs. Once all frames and the
120-second `music.wav` and `music-credit.txt` are in `output/intro/draft-03/`,
run `python3 scripts/intro/finish_draft03.py`. It checks every source frame,
creates the 4K master and downsampled preview, and validates frame count,
duration, attribution metadata, faststart placement, and full decoding.
QA and export reports stay beside the rendered media.

For a title correction, refresh the live programme and run
`scripts/intro/update_draft03.py` inside the original Draft 03 Blender file. It
creates a dated scene and render directory, reuses unchanged native frames, and
leaves changed speaker intervals empty for fresh rendering. Pass that directory
to both `render_draft03.py --output <directory>` and
`finish_draft03.py --output <directory>`. The 13 October revision updates Waseem
and Sini's published titles while preserving the earlier scene and film.

The earlier `build_prototype_*.py`, `render_prototypes.py`, and
`finish_prototypes.py` scripts retain the 1080p comparison workflow.
Generated media stays in ignored `production/intro/generated/` and `output/intro/`,
outside public build assets.

Speakers upload PDF and PowerPoint (`.pptx`) files per talk under **Presentation
files** in `/speaker/`, up to 50 MB per file. Each format has its own slot;
uploading it again replaces that file. Files stay private and are available to
the talk's speakers and organizers. The optional **Allow this PDF to be published
with my talk** checkbox records permission for public sharing. PowerPoint files
remain private for venue use.

Organizers can also upload files supplied by a speaker under each talk's
**Upload file** action in `/admin/speakers/`. PDF, PowerPoint (`.pptx`), and
standalone HTML (`.html` or `.htm`) files are supported, up to 50 MB each.
Select the PDF permission checkbox only when the speaker has allowed public
sharing, then publish it separately. PowerPoint and HTML stay private; HTML
downloads as a file for local use. Admins can replace or remove any uploaded
format. Replacements withdraw the old PDF publication and require publishing
again. Apply `0035_add_html_speaker_slides.sql` before deployment; it preserves
existing files and publication states.

The 50 MB limit also requires `0036_increase_speaker_slide_size.sql`. It preserves
existing files and publication states; the normal deployment applies it.

The admin **Presentation** section shows setup, files, and public links in a
compact list, with each talk title shown once. **Upload file**, **Replace**, and
**Add public slide link** reveal editors when needed; **Cancel** discards the
editor's changes. **Setup details** contains venue guidance and its timestamp.
Each file's **⋯** menu contains its upload details and removal action.

In `/admin/speakers/`, use **Publish** beside a PDF when post-event material
is ready. If permission was obtained after upload, first select **The speaker
has allowed this PDF to be shared publicly** below the file. Publishing records
that permission for the existing PDF without replacing it. The corresponding
talk at `/schedule/` gains a **Slides (PDF)** download
link. **Unpublish**, removal, and replacement immediately withdraw the old
download; a replacement PDF requires permission and publication again. The
public archive outlives speaker login sessions. Apply migration
`0030_create_speaker_slides.sql` before deployment; `npm run deploy` applies it.
Run `npm run speaker-slides:browser-check` to verify upload, publication,
replacement, desktop/mobile layout, and accessibility with isolated storage.

For links supplied separately or after the event, choose **Add public slide link**
under the talk's **Presentation** in `/admin/speakers/`, enter **Slide URL (HTTPS)**,
and choose **Save slide link**. Saving immediately adds a **Slides** link to the public schedule,
alongside any published PDF. Use **Edit** to replace the URL, or **Remove link**
in the link's **⋯** menu to withdraw it. Links are independent of speaker uploads
and login expiry. If another admin tab has changed the link, reload speakers before saving
again. Apply `0031_create_speaker_slide_links.sql` before deploying this version;
`npm run deploy` applies pending migrations.

At `/admin/dinner/#entrance-sign`, use **Download A4 PDF** for the speakers’ dinner
entrance sign. Print on A4 at 100% / actual size. Regenerate it with
`uv run scripts/export-speaker-dinner-sign.py`; the exporter also updates the
protected copy under `/assets/slides/` for the normal site build.

At `/admin/dinner/`, select a speaker's attendance and choose **Save attendance**
to record plans on their behalf. **Use speaker response** restores their original
reply, or awaiting reply when none exists. Food notes and the original reply are
preserved; totals and the caterer CSV use the recorded attendance. A later speaker
save replaces the organizer setting. These controls remain available after the
RSVP deadline until dinner data retention ends. Apply migration
`0024_add_speaker_dinner_attendance_controls.sql` before deployment; the normal
`npm run deploy` command applies it. `npm run dinner:browser-check` validates the
workflow, mobile layout and accessibility with an isolated local database.

Use **Send speaker and dinner announcement** at `/admin/speakers/#announcements`
for a shared update. Select speakers, include attending dinner guests, or select
no speakers for a dinner-only message. The preview shows speaker-only,
dinner-only and overlapping recipients, plus contacts excluded from delivery.
The composer saves its draft and recipient choices in the current browser and
restores them after a reload. Restored drafts require a fresh recipient preview
and confirmation before sending. Use **Download .txt** for a portable backup.
Recipients are combined by normalized email address; each address receives one
separately addressed message. Optional speaker and dinner sections are appended
for their respective audiences, with both sections in the overlap's one email.
The optional closing / signature follows these sections for every recipient and
is included in previews, test messages, copied or downloaded messages, history
and retries. Apply migration `0032_add_announcement_closing.sql` before deploying;
the normal deployment command applies it.
The preview selector shows each version; test messages include all optional
sections. Saved speaker preferences, suppressed addresses and retention limits
apply even when the same address appears in the dinner audience. Dinner guests
receive operational event information only.

Add optional dinner-update emails when adding guests, or choose **Save email**
on existing guest cards at `/admin/dinner/`. Clear an address to stop dinner
updates. Emails are encrypted, excluded from catering exports and deleted with
dinner data. Names alone are never used to infer email addresses. Apply migration
`0031_add_dinner_announcements.sql`; the normal deployment command applies it.
Message history includes both audiences and failed-only retries. Preview tokens
bind the message and eligible addresses, reject stale previews and prevent
repeated submissions of the same confirmed preview. Campaign and delivery claims
prevent concurrent retries; an accepted send that cannot be recorded stays
claimed for manual investigation rather than being automatically retried.

The schedule structure and session deck scaffold derive from
`site/data/seminar.json`, `site/data/schedule.json`, `site/data/speakers.json`,
and `site/data/sponsors.json`; the Worker resolves mutable speaker and talk copy
from D1. Sponsor data records the package tier and whether the contract includes
between-talk placement; validation requires Epic and Tech sponsors to receive
that placement. Aimbition has an organizer-approved courtesy placement with the
smallest logo; Location sponsors remain excluded from the between-talk strip.

## Venue signs

For outdoor stands, `npm run signs:export:outdoor` creates A3 welcome signs in
portrait and landscape, with no arrows. Both use large SDLCAI and Marsio lettering
and 18 mm clear print margins. Print the PDFs on A3 at 100% / actual size. The
PDFs are in `output/pdf/`, 300 dpi PNGs are in `output/images/`, and the complete
set is in `output/sdlcai-2026-outdoor-signs-a3.zip`.

At `/admin/venue-signs/` under **Event day**, organizers can preview and download
seven A4 signs: welcome, left/right/straight-ahead directions, registration,
audience Q&A, and a session-level daily schedule. Download the complete seven-page
pack or individual PDFs. Print A4 portrait, single-sided, at 100% / actual size.
The signs have 14 mm printer-safe margins and work in colour or black and white.
Check a physical proof, scan the QR codes, and walk the venue route before
choosing arrow placements. Q&A links to `/qa/`; the schedule links to the full
published program at `/schedule/`.

Regenerate with `npm run signs:export` (requires `uv` and Poppler's `pdftoppm`).
The exporter uses `site/data/venue-signs.json`, the shared event date/venue and
session times, and the bundled Finlandica fonts. Talk titles and speaker order
are left to the linked live program. It verifies A4 size, page count, required
text, print margins, and font embedding, then renders the actual PDFs for
previews. Outputs are in `output/pdf/` and the protected `/assets/slides/` area.
The normal build uses committed PDFs and previews; build verification rejects
stale sources or changed exports. The fonts and artwork remain vector in PDFs.

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

## Visitor feedback

The voluntary SDLCAI 2026 survey is at `/feedback/`, based on the attendee
Google Form's eleven questions, plus a 0–10 likelihood-to-recommend question
and an optional reason. The revised questionnaire also has an optional comment
shown when a respondent selects **Other** among valuable parts. `/admin/feedback/` shows private ratings, Net Promoter
Score (NPS), choice distributions and paginated individual answers. Its public-link button
provides the generic URL for a later campaign in **Attendee messages**; creating
the form does not send invitations. Migration `0039_create_visitor_feedback.sql`
adds two D1 tables. Existing encryption, admin authentication and Turnstile
bindings are reused. Turnstile fails closed when unconfigured.

The recommendation question follows [Bain's NPS method](https://www.netpromotersystem.com/about/measuring-your-net-promoter-score/):
9–10 are promoters, 7–8 passives and 0–6 detractors. NPS is the percentage of
promoters minus the percentage of detractors, with **all answered recommendation
ratings**, including passives, in the denominator. Admin shows the rounded score
on a −100 to +100 scale, group counts, answer count and the 0–10 distribution.
The current form requires a valid 0–10 answer. Withdrawal removes the rating's contribution, while
expiry retains only its independent count, like the other ratings.

Questionnaire version **3** implements the survey-design review. Satisfaction
and value use distinct five-point scales with verbal labels. Each rating uses a
stepped slider with clickable numbers and a visible description of the chosen
answer. Untouched sliders submit no midpoint/default
answer; a rating or separate unscored option must be chosen explicitly. Keyboard
arrows and Home/End work, and screen readers receive the chosen verbal label.
Clearing an answer or resetting the form returns it to an unanswered state.
Numeric ratings and unscored choices remain mutually exclusive, and
non-attendance/unable-to-assess answers are stored as separate non-numeric
choices. Admin excludes these from rating averages and rating percentages and
shows their counts separately. Research–industry mix and return-intention choices
are balanced. Organization is rated on its own. Valuable parts allows up to three
choices, with separate poster/networking options, **Other**, and an exclusive
**None**. Other comments are optional, cleared when hidden and never aggregated.
The improvement prompt asks for one priority. All optional comments retain the
same privacy controls.

The owner confirmed there were no earlier responses before these revisions.
No historical comparison UI or data migration is needed. Already-open version 1
or 2 forms receive a reload message; version 3 is saved with encrypted answers.
Future wording or scale changes must consider existing responses and retained
totals before reusing the same aggregate keys.

Treat the score as directional feedback from respondents, with the answer count
attached to any marketing claim. It does not establish actual referrals or
represent all attendees. Invite attendees consistently and compare future events
only with consistent wording, timing and methods; avoid coaching respondents
toward particular scores. Recommendation comments remain private and are not
permission to publish testimonials. Bain's [reliability guidance](https://www.bain.com/contentassets/3217eb3c2803449abfd5fb23b06c3db1/loyalty_insights_2_creating_a_reliable_metric.pdf)
explains sample and response bias; its [follow-up guidance](https://www.netpromotersystem.com/about/history-of-net-promoter/)
supports asking why.

We collect no attendee, email, IP, user-agent or referrer identifiers with
answers. Optional comments can still contain personal data. Consent is an
unchecked, specific opt-in under notice `2026-10-16`; the notice and consent
are encrypted with the answers. A random 256-bit code generated in the browser
allows access, JSON download and withdrawal through `/feedback/response/`.
Only its SHA-256 hash is stored. The code travels in a URL fragment and POST
body, never in a query string. Losing the private link makes name/email lookup
impossible. Do not log request bodies, tokens or recipient-bearing URLs.

Raw feedback expires **90 days after submission**, as approved on 16 October 2026. Expired rows are excluded from all reads and deleted by daily cleanup or
an admin results visit. Independent counts are updated in the submission
transaction; there are no retained per-response combinations or comments in
these totals. Withdrawal before expiry atomically removes both the raw row
and its contribution to the totals, including under concurrent retries.
Raw feedback is deliberately excluded from the R2 backup jobs and there is no
admin raw-data export. Keep comments in the authenticated workspace and remove
unnecessary personal data using **Delete response**.

Cloudflare D1 Time Travel may retain deleted encrypted rows for up to another
30 days ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)).
After any D1 recovery, keep public feedback routes and admin results offline,
clear **all** restored raw feedback with `DELETE FROM visitor_feedback`, and
verify the table is empty before reopening. This prevents restoring withdrawn
or expired comments; restored totals may reflect an older snapshot. Do not
re-import raw feedback from manual database exports. Account owners must keep
the [Cloudflare DPA and transfer safeguards](https://www.cloudflare.com/cloudflare-customer-dpa/)
covered by the controller's processing records and review organizer access.
The controller and rights contact remain Toska Osuuskunta and
`info@futurefrontend.com`, as in the existing privacy policy. The dedicated
notice at `/privacy-policy/#visitor-feedback` covers processing, consent,
retention, recovery history and rights. This implements concrete GDPR controls;
it does not replace the controller's legal and organizational responsibilities.

For later personalization, personalize the email greeting while sending the
same public URL. Do not add email addresses, ticket IDs or campaign identifiers
to form links or answers, or record which recipient completed the survey.
This preserves separation between email delivery records and feedback.

Run `node --test test/feedback.test.mjs` for validation, encryption, access,
concurrency and expiry checks. After `npm run worker:test-build`, run
`npm run feedback:browser-check` for mobile/desktop, both themes, accessibility,
submission, private deletion and the protected admin view. Only Turnstile's
external provider is simulated; all data belongs to isolated local D1 storage.

## Deployment

Deploy through Cloudflare Workers Builds or locally with:

```bash
npm run deploy
```

`deploy` runs `quality:build` (build, types, integration tests, and generated-site
validation), applies pending production D1 migrations, and then deploys the Worker.
A failed migration stops deployment. It does not install or launch browsers.
In Workers Builds, leave the optional **Build command** empty and set the
**Deploy command** to `npm run deploy`. This builds and checks the site once per
deployment. Enable **Build cache** in Cloudflare to reuse npm downloads.

GitHub Actions runs four integration-test shards and four browser-check groups
in parallel on pull requests and pushes to `main`. Browser jobs use the
Playwright image with Chromium, WebKit, and their OS dependencies preinstalled.
All jobs restore npm, TypeScript, and Gustwind asset caches. Require the
`Quality gate` status check in branch protection to block merges on failures.
This aggregate check passes only when every shard and group succeeds. Run the
complete gate locally with `npm run quality:gate`; individual groups support
`npm run quality:gate -- --group=guests` or
`npm run quality:gate -- --group=integration --shard=1/4`.
Each gate stops the current check and skips subsequent checks on a nonzero exit
or an unexpected error log, including plain `console.error` calls and colored
Wrangler error output. Tests that deliberately trigger failures capture and
assert their exact logs only for the failing operation; missing or extra errors
fail those tests.
Cloudflare Workers Builds runs independently of this workflow.

`npm run build` and `npm run worker:dev` use Gustwind's incremental route cache
for local iterations. TypeScript also reuses `.cache/types.tsbuildinfo` while
checking changed inputs. `npm run worker:build`, tests, and deployment always
rebuild the site from scratch, while reusing content-addressed CSS/JS assets.
Use `npm run build:clean` for a clean local site build. To reset all compilation
caches, remove `build/`, `.cache/`, and `.gustwind/persistent-assets/`.

See [Cloudflare setup](docs/cloudflare.md) for provisioning, secrets, backup, and
deployment notes.

Administrators can add dinner guests manually from **Add Guest** on `/admin/dinner/`.
Each save creates a separate encrypted response alongside shared RSVP guests,
with attending guests included in the caterer CSV as “added by admin”. The form
records the administrator’s confirmation that the guest agreed to the processing.
Manual additions remain available until dinner data retention ends and use the
existing dinner cleanup and backup exclusions. Optional update emails use
migration `0031_add_dinner_announcements.sql` as described above.

### Organizer digests

The hourly Worker cron also sends these transactional emails to `info@sdlcai.org`:

- **Poster proposals:** daily from 09:00 Europe/Helsinki, listing submitted,
  shortlisted and waitlisted proposals until a final decision is recorded. The
  email includes proposal titles, presenter names and a link to `/admin/posters/`.
  It shows the oldest 50 pending proposals and the total pending count.
- **Data modifications:** Mondays from 09:00 Europe/Helsinki (with catch-up on
  later days), summarizing additions, updates and deletions since the previous
  completed digest. It covers registration interests, posters, speaker contacts,
  published speaker/talk content, content/photo revisions, videos, presentation files,
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

### Attendee messages and SDLCAI news

Apply `0033_add_attendee_messages_and_newsletter.sql` and
`0034_add_mailrelay_sync.sql` before deploying this
feature. **Send attendee messages** at `/admin/attendees/` opens
`/admin/attendee-messages/`. Start with the welcome or follow-up draft, edit the
copy, choose **Save draft** to resume editing on any device, send a test to your
own address, and preview the message and recipients. The saved draft loads when
you open the page. Unsaved edits warn before leaving, and stale saves from
another tab are rejected. Saving a draft never creates a send or stores a
recipient snapshot. The follow-up template includes feedback, the photo timeline,
the media bank, recording and presentation materials. Apply migration
`0040_create_attendee_message_draft.sql`; normal deployment applies it.
Confirm the review checkbox before sending. This sender is for SDLCAI 2026
operational information and event follow-up, without future event promotions.

The audience uses the same active registrations, accepted posters, and
volunteers as the attendee view. It excludes cancelled registrations, missing
addresses, and unsubscribes, and sends once per normalized email address.
Preview approval expires after two hours and is invalidated by copy or audience
changes. Each preview can create only one campaign. Each recipient receives a
separate message with an account-free unsubscribe link and RFC 8058 one-click
unsubscribe headers. Suppression is keyed to the address and survives imports.
Newsletter consent is separate and is never inferred from event registration.

The browser processes ten recipients per request. If interrupted, use
**Continue remaining recipients** in history. **Accepted** means provider
acceptance, not confirmed inbox delivery. The history includes provider message
IDs and recipient outcomes. Definitive provider rejections can be retried;
network errors or interruptions during acceptance remain **unknown** and are
never retried automatically. Reconcile unknown outcomes with provider logs
before any manual resend. The existing Cloudflare `EMAIL` binding and
`EMAIL_ENCRYPTION_KEY` are reused. No real emails are sent by the test suite.
Run `npm run mailing:browser-check` after the Worker test build to verify the
composer, consent form, and unsubscribe flow at mobile and desktop sizes using
mocked delivery.

Marketing signup is controlled by `NEWSLETTER_ENABLED` in `wrangler.jsonc`,
enabled for the post-event homepage. While off, homepage/footer signup entry points are
removed and the signup API rejects requests; `/subscribe/` explains that signup
is closed. Confirmation and unsubscribe links, plus admin consent management,
continue to work for existing subscriptions. `/admin/newsletter/` shows the flag
state, subscribers, and consent history. There is no marketing campaign sender.

Mailrelay is the marketing provider integration. Public signup and subscriber
sync are enabled for the SDLCAI account and group configured below. Cloudflare Email Service
is used only for transactional event and confirmation emails. The signup
flow uses the existing Turnstile widget/keys, verifies the `newsletter-signup`
action and configured hostnames server-side, requires explicit consent, and
confirms email ownership with a single-use 24-hour link. Repeated requests are
limited per address and keyed IP fingerprint. Contacts from Tito, Webropol, or
the old interest list are not imported into this list.

Daily cleanup removes pending subscriptions older than seven days, expired
resubscribe requests, and consent/suppression evidence one year after newsletter
unsubscribe. Unsubscribe immediately removes the encrypted newsletter address
from the active list. When provider removal is outstanding, the sync queue keeps
an encrypted recovery copy until that removal succeeds. Failed removals must be
resolved before retention cleanup can delete their evidence.
Daily R2 mailing snapshots preserve encrypted contacts, consent records, event
suppression, and delivery history for 30 days. Event communication records join
the manual attendee retention review by 31 January 2027. When restoring, preserve
newer unsubscribe records and reconcile all restored pending/unknown deliveries
against provider logs before resuming: an old snapshot is not proof that a send
was never accepted. Keep recovered marketing signup disabled until consent and
suppression records have been reconciled.

### Mailrelay subscriber synchronization

This integration reuses the subscriber-sync payload from
`monolisa/website/utils/mailrelay.ts`: initial `status: active`,
`replace_groups: false`, and `restore_if_deleted: false`. Only double-confirmed
SDLCAI news subscribers are enrolled. Attendees, legacy interests, and pending
signups are never transferred. No campaign or transactional Mailrelay sending
API is used; compose/paste HTML and send campaigns through Mailrelay's dashboard.
Use its recipient-specific unsubscribe link in every campaign.

Configure these server-side settings:

| Setting                    | Value                                                               |
| -------------------------- | ------------------------------------------------------------------- |
| `MAILRELAY_ACCOUNT_DOMAIN` | `sdlcai.ipzmarketing.com`                                           |
| `MAILRELAY_GROUP_ID`       | `"1"`, the SDLCAI news group                                        |
| `MAILRELAY_API_KEY`        | Worker secret, set with `npx wrangler secret put MAILRELAY_API_KEY` |
| `MAILRELAY_SYNC_ENABLED`   | `"true"` for the configured SDLCAI account and group                |
| `NEWSLETTER_ENABLED`       | Independent public signup flag; enabled (`"true"`)                  |

Keep the account and group dedicated to this mailing purpose. Review Mailrelay's
processing agreement and the privacy notice before opening signup. Enabling sync
does not enable public signup, and closing signup does not prevent existing
withdrawals from syncing. Switching sync off pauses all provider API requests;
local withdrawals remain queued. Never reuse MonoLisa's credentials or group.

In `/admin/newsletter/`, **Sync with Mailrelay** starts a full reconciliation,
including contacts checked recently, and processes one contact per resumable
request. Keep the page open until it reports **up to date**. **Stop after this
contact** pauses without losing progress. Each contact shows its provider
status, last check, and safe error code. **Retry failed syncs** retries permanent
errors after configuration/data fixes. Network/server failures retry with
backoff; HTTP 429 respects the provider's shared cooldown. A D1 lease serializes
all requests, spaced at least 1.5 seconds apart. A crashed lease expires after
two minutes; repeating sync is safe.

Confirmation and unsubscribe requests wake one pending contact in background.
The existing hourly cron processes up to ten contacts and checks older provider
states. **Run a full sync before every campaign**, and resolve pending/failed
removals before sending. Local withdrawals remove only the SDLCAI group,
preserving other groups and the provider's suppression status. Native provider
unsubscribes, spam complaints, deleted contacts, or removed group membership
withdraw the local subscription. Bounces, bans, and inactive statuses are shown
as blocked and never reactivated automatically. A fresh local confirmation can
restore group membership for an otherwise active contact; it cannot override
Mailrelay's unsubscribe/ban/deletion protections.

The first sync pins the account/group scope in D1. Changing either setting
returns `account_or_group_changed`, preventing old provider IDs from being used
in another account. To migrate accounts, first reconcile outstanding withdrawals
against the old account and plan a reviewed migration of confirmed consent and
suppression records. Restoring backups must include both Mailrelay tables,
preserve later withdrawals, and clear any restored lease before resuming.
Provider keys and raw error response bodies are never stored in D1 or backups.

### Registrations and arrivals

Use **Add attendee** at `/admin/attendees/` to create a manual registration.
Enter a name and either an attendee email or a ticket code; company and dietary
requirements are optional. Choose the attendee type and badge inclusion, then
select **Save new attendee**. Manual entries support editing, cancellation,
check-in, catering, and badge printing, and retain their details through CSV
imports. Their source is **Manual**. Reusing a manual ticket code or email-only
identity rejects the new entry; edit the existing person instead. Imported
registrations remain separate even when their identity matches a manual entry.
No additional migration is needed. Registration staff cannot add attendees.

Apply `0023_create_attendee_registration.sql` before deploying. At
`/admin/attendees/`, import Tito and Webropol CSVs separately using the same
column-mapping workflow previously used by badges. Map individual ticket codes and attendee
emails, preview the rows, then import. A ticket code identifies a registration
within its source; without a code, attendee email is the identity. Selecting
Tito imports unassigned tickets with a ticket code and blank attendee name and
email as **Unassigned ticket**. Map both attendee names and emails; purchaser
details are not used as a fallback. These tickets count toward catering but do
not produce named badges. Map **Order reference** to the registration/order
reference column if available; otherwise a Tito ticket reference such as
`ABCD-1` uses `ABCD` as its order reference. The preview and import result report
unassigned tickets and link to the appropriate spare badge quantity. Keep the
same identity columns on subsequent imports. Correcting a ticket code or an
email-only identity also updates its import key while keeping the attendee ID.
Re-imports update matching
registrations, retain their IDs, arrival records and badge choices, and leave
omitted registrations in place. Ticket status accepts active/valid/confirmed/
paid/complete/completed/issued/registered/assigned and cancelled/canceled/void/
voided/refunded/expired/deleted. Unknown mapped statuses reject the import.
If no status column is mapped, all imported rows are active; filter inactive
tickets out of the source export first.

For a separate Tito sponsor CSV, choose **Tito** as the registration source and
**Sponsor** under **Import attendee type**. Map names, companies, ticket codes,
emails and food restrictions as usual. Sponsors share the registration and
catering flows. The default import type keeps existing types and treats new rows
as attendees; selecting **Attendee** or **Sponsor** explicitly updates the type
of matching rows too. Organizers can also change **Attendee type** in the editor.
Earlier rosters without a type are treated as attendees. No migration is needed.

Create a named staff link for each person handling registration. The link opens
`/registration/access/` and requires **Open registration desk** to sign in. Links
remain reusable until revoked; the HttpOnly browser session lasts 14 days.
Revocation ends every session for that link. Registration staff can search by
name/email or look up an exact ticket code or order reference. An order lookup
shows its individual tickets and arrival statuses. Staff can select **Assign and
check in** on an active unassigned ticket, enter the holder's name, and confirm
that ticket's arrival. Assignment and arrival are atomic; concurrent claims,
cancelled tickets, stale lists, and revoked access are rejected. Later unassigned
CSV exports preserve desk-entered names and arrivals; a named Tito assignment
updates the same ticket. They cannot otherwise edit attendees, import data, undo arrivals, print badges,
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

Use **Reserved meals** in the catering summary for guests without a registration.
Imported unassigned tickets already count toward catering; reduce any earlier
reserve for those tickets to avoid counting them twice. Save the reserve before
copying or downloading the summary. It increases the catering headcount and
missing-diet total without creating attendees or badges. Reduce it as those
people join the named list. The reserve is saved with catering settings
and survives reimports; spare badge quantity is a separate print preference.
Apply `0027_add_catering_meal_reserve.sql` before deploying this version.

In **Combined requirements**, open **Review dietary responses** or choose
**Review people in this group**. Review one person at a time, select all relevant
categories, and add catering instructions for allergies or food preparation.
**Save and next** updates the summary and export without editing the original
response. **Needs clarification** stays in the open queue; **No restrictions**
and **Missing information** update their respective totals. Use the filters to
revisit saved decisions. Unsaved reviews block export and navigation until saved
or discarded. Identical responses can be classified separately per person.
Reviews are encrypted, admin-only, backed up with the roster, and survive
unchanged reimports. A changed source answer or mapping invalidates the decision
until reviewed again. Purging dinner data also clears manual dietary reviews.
Apply `0028_add_catering_diet_reviews.sql` before deploying this version.

The dinner catering summary at `/admin/dinner/` uses the same dietary review
queue and combined groups for attending speakers and guests. Dinner decisions
are saved separately from daytime catering decisions, preserve the original
meal and cross-contamination answers, and are invalidated when the person's
name or dietary answers change. The **Caterer CSV** adds `dietary_group`,
`dietary_review`, and `catering_instructions` columns for sorting meals. Dinner
reviews are encrypted and cleared with dinner data at the retention deadline
or on purge. Apply `0029_add_dinner_catering_reviews.sql` before deploying.

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
Set **Spare attendee badges** to cover unassigned Tito tickets and walk-ins.
These badges have the attendee logo and role with blank name/company areas.
The count is saved with print settings, included in attendee and full runs, and
can be printed separately with **Print / save PDF — spares**. The Tito import
preview links to Badge studio with the unassigned-ticket count prefilled; increase
it to include additional spares.
Set **Spare sponsor badges** for sponsors without a named registration. These
use the teal sponsor background and **SPONSOR** label with blank name/company
areas. Save the quantity with print settings. Sponsor and full runs include
these spares; **Print / save PDF — sponsor spares** prints only spare sponsor
badges. Attendee and sponsor quantities are independent whole numbers from 0
to 2,000 and do not create registrations or change catering totals. Sponsor
CSV previews prefill the sponsor quantity for unassigned tickets.
The 2,000-person limit applies to the attendee roster; the combined badge run
includes additional team and earlier records. Print preferences are bounded by
request and encrypted storage size rather than a combined record count.

Printer settings start at 100 mm diameter with one badge per PDF page. Adjust
bleed, safe margin, top clearance, readable font sizes, trim guide, and repeated
front/back pages as needed. Print buttons recheck layout and font coverage and
block unresolved problems. Custom TTF/OTF fonts are tab-local and must be loaded
again after a reload. The bundled Noto Sans is licensed under the SIL Open Font
License; its source and license are in `assets/badges/`.

Sponsor badges have a teal background and a **SPONSOR** label. They are included
in the full badge run and can be generated separately with
**Print / save PDF — sponsor**. Attendees use white, speakers black, and
organizers and volunteers orange.

The **Lanyard summary** at the top of Badge studio shows each badge type and
color, its included named badges, spare badges, and lanyards needed, plus the
combined total. It uses the complete current run, including unsaved spare counts;
search filters and repeated front/back pages do not change the quantity. Retired
earlier badges and people excluded in their source workspaces do not count.
Unresolved duplicate emails are flagged before purchasing. Use **Copy lanyard
summary** or **Download lanyard summary** to take the quantities shopping, and
**Reload people and settings** to pick up changes made in other workspaces.

Use 100% print scale, enable background graphics, disable headers/footers, and
confirm dimensions and duplex order with the printer. Browser PDFs use RGB, not
CMYK/PDF-X. Print a physical proof before the full run.

Run `npm run badges:browser-check` after a build to test spare badges, live records, duplicate
handling, long/Unicode names, print preferences, source updates, responsive layout,
and actual print pagination. Test proof files are temporary files under `/tmp/`.
See [ADR-011](docs/adrs/implemented/ADR-011-manage-organizers-and-validated-badge-printing.md).
