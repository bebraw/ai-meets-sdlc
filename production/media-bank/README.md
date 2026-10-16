# SDLCAI photo media bank

The media bank contains 314 photos from the 13 October 2026 seminar:
188 JPEGs from the first two collections and 126 photos from Jaakko Hollmén
(124 HEIC originals and two JPEGs). All three collections are published under
CC BY 4.0, with credit to the named photographer. Jaakko's collection adds
23 highlights and 103 alternates after license confirmation and visual review
on 16 October 2026. `jaakko-import.json` records the confirmation, the original
20 highlight candidates and four excluded
files: two Q&A screenshots and two videos retained in the source folder.
The original photo folder is read-only input. Generated files stay in
`output/media-bank/`, outside the public site build and Git.

## Credits and clock calibration

`sources.json` records the user-confirmed settings:

- Fujifilm X-T3: Juho Vepsäläinen; retain the original clock time and EXIF
  timezone (`+03:00`).
- Insta360 Ace Pro: Bulent Sahin; retain the original recorded clock time and
  interpret it as Finnish local time (`+03:00` on the event date). The initial
  minus-one-hour correction was removed with the user's approval after
  checking the livestream's 08:51:05 Finnish start and Sini's introduction
  at recording 5:26:14 against `IMG_20261013_141709_015.jpg` (14:17:12).
- All three collections: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
  with the named photographer credited. The user confirmed unrestricted reuse
  under this license.
- Jaakko Hollmén: retain original iPhone/Pixel capture times and EXIF timezone
  (`+03:00`). The organizer confirmed CC BY 4.0 with credit to Jaakko Hollmén
  on 16 October 2026.

The catalog preserves the raw EXIF timestamp, original timezone value,
confirmed clock shift, corrected UTC timestamp, and corrected local timestamp.
The source photos are never rewritten. Full-resolution downloads return the
unchanged source files, including HEIC files with their original filenames and
file type; corrected timestamps accompany them in the catalog. Public sharing
downloads are always JPEGs.

## Prepare and review

Requires Node, the repository's npm dependencies, and ImageMagick (`magick`).

```sh
npm run photos:prepare -- --input /Users/juhovepsalainen/Projects/sdlcai/photos
npm run photos:review
```

Append another credited collection without replacing earlier imports:

```sh
npm run photos:prepare -- --input "/path/to/new collection" --append --source jaakko
npm run photos:seed
```

Configure the photographer in `sources.json` first. `--source` assigns the
collection's credit independently of its camera models. JPEG and HEIC inputs
are accepted; screenshots and videos are excluded. Capture timezone mismatches
stop the import. File checksums deduplicate repeated imports, and the ignored
`source.json` manifest preserves original paths across separate input folders.

Open <http://127.0.0.1:3010/>. The server binds only to the local machine.
It supports search; category, tag, photographer, shortlist, talk and person filters;
full-size previews; comparison of conservative similar-frame suggestions;
caption, alt text and tag editing; and individual or ZIP downloads.

The initial categorization and shortlist are versioned in `initial-curation.json`
and are used when a local review file does not exist. Further review decisions
are saved atomically in `production/media-bank/curation.json`.
This mutable file is ignored by Git. Back it up using the **Back up review decisions**
download. Reload stale drafts before saving; the server rejects conflicting
edits instead of replacing a newer decision.

The initial visual review categorized and captioned the first 188 photos and shortlisted
45 highlights: two dedicated presentation photos for each of the ten talks,
two complementary views of each of the three panels, 15 atmospheric photos,
the group photograph, two closing acknowledgements and a session introduction
showcasing the sponsors. The atmosphere selection
covers arrival, the audience and an audience question, foyer conversations,
refreshments, venue details, poster displays and the afterparty, including
the branded SDLCAI Lager cans.
Other frames are retained as alternates. Similar-frame groups are suggestions
to compare, not automatic duplicate deletions.

All 126 Jaakko photos have reviewed categories, captions, tags and programme context.
The first 20 highlights add talk and panel views, group photography, welcome
signage, food, branded water and beer, posters and the production desk.
The broader review also highlights the badges, audience Q&A and production team,
bringing this collection to 23 highlights and 103 alternates.

The broader review preserves all 65 previous highlights and adds 11 complementary
frames, bringing the default selection to 76. The four requested additions are
`DSCF6639.jpeg` (registration desk), `IMG_4692.HEIC` (production team),
`IMG_4648.HEIC` (audience Q&A) and `DSCF6576.jpeg` (coffee service).
The seven further additions cover seated audience atmosphere (`DSCF6569.jpeg`),
badges (`IMG_4590.HEIC`), recording activity (`DSCF6604.jpeg`), conversations in
the auditorium (`DSCF6616.jpeg`) and lounge (`DSCF6682.jpeg`), the closing recap
(`IMG_20261013_170242_081.jpg`) and afterparty conversations
(`IMG_20261013_174444_095.jpg`). Captions describe each setting; visible
Wunderdog and AIMBITION banners and branded refreshments receive matching tags.

Search **sponsors** in the public gallery for selected views of the sponsor
thank-you screen, branded stage, Swarmia/AIMBITION banners and Aalto lettering.
These photos are also tagged with the visible sponsor names, covering all seven
sponsors in `site/data/sponsors.json`. Tags describe visible branding; they do
not identify people.

All 314 photos have reviewed visual tags for objects and activities, including
presentation slides, panels, group photos, pastries, coffee, branded drinks,
camera equipment and production desks. Orientation tags come from the image
dimensions. Tags describe visible content; they do not identify people or infer
off-stage talk topics from timestamps. Private drafts remain private.
The Tag dropdown lists tags available in the visitor's collection and combines
with the other filters. Photo previews show their tags. Filter URLs preserve
both the chosen tag and whether the visitor is browsing highlights or all
published photos, including after a reload.

Talk associations use visible slide text and stage-sequence context. They do
not identify people. `depictedSpeakerIds` starts empty and is reserved for
human-confirmed assignments; the editor requires evidence when setting it.
`talks.json` preserves the public talk-title snapshot used for this review.
`recording-timeline.json` records the actual running order from the livestream's
broadcast metadata and timestamped introductions, endings and Q&A handovers.
The published schedule is only a coarse reference: for example, Jenni's talk
continued past 10:30, and the research Q&A continued past 12:30.

Every photo has `eventContext`: programme segment, session, time bounds, related
talk context, recording offset when available, and the association basis.
In the first two collections, visual/slide review agrees with the recording for 92 photos; five
reviewed frames sit within 90 seconds of a handover; six additional stage/audience
frames have timing-only talk context. The other 85 retain event context such as
registration, breaks, lunch, closing, group photography or the afterparty.
Off-stage photos never acquire speaker associations from the clock alone.
Timing disagreement is retained as `conflict`, rather than silently replacing
an organizer's reviewed association.

The gallery displays related talk authors and supports searching their names
and talk titles. These are programme associations, separate from confirmed
people tags. Timing-only associations do not grant original-download access.
The recording reference is unlisted, so its URL stays in the ignored local
evidence report rather than the public gallery or Git.

## Outputs and collections

- `inventory.json`: immutable import metadata and checksums.
- `catalog.json` and `catalog.csv`: current metadata, programme context and
  review decisions. CSV includes programme segment/title, talk context IDs and
  association confidence.
- `collections.json`: highlights, category collections, related-talk collections,
  and any confirmed-person collections.
- `CREDITS.txt`: photographer and license attribution for each original.
- `contact-sheets/`: contact sheets with corrected local times.
- `images/`: 480 px thumbnails, 1,800 px previews, and 3,200 px sharing JPEGs.
  These are resized without upscaling, re-encoded, stripped of source metadata,
  and given a credit/license comment. They use about 203 MB for the initial set.
- `upload-plan.json`: private R2 object keys for the originals and derivatives.
  Preparation does not upload or publish anything.

Export a ZIP containing photos, `CREDITS.txt` and the collection's catalog:

```sh
npm run photos:export
npm run photos:export -- --collection group-photo --size original
npm run photos:export -- --collection talk-non-engineers-vibe-code-production
```

The default export is the 45-photo highlight collection at sharing size.
Use the review interface for arbitrary selections. ZIP creation streams
already-compressed JPEGs without recompressing them.

To refresh contact sheets and exports after editing:

```sh
npm run photos:metadata
npm run photos:seed
```

Set `MEDIA_BANK_FONT` to a font name or font file if ImageMagick cannot find its
default contact-sheet font. macOS defaults to its installed Arial font;
other systems use DejaVu Sans.

## Validation

```sh
node --test test/media-bank.test.mjs
npm run photos:check
```

The browser check uses a temporary copy of review state. It verifies all 314
source checksums, the 65 recording-verified Insta360 times, categorization and shortlist,
filtering, durable edits, stale-write rejection, local-origin mutation checks,
human-confirmation requirements, ZIP credits and original downloads, and
responsive layout/accessibility at 320, 390 and 1,440 px. It leaves source files
and real review decisions unchanged.

## Hosting integration

The public gallery is at <https://sdlcai.org/photos/> and opens with the 76
highlights. Clear the selection filter to explore all published alternates.
Visitors can search, filter, preview, copy attribution, and download sharing
copies individually or in a ZIP with credits and catalog metadata.
The catalog request waits until the page has loaded and painted, then starts
during an idle period with a one-second timeout. Browsers without idle callbacks
use a timer after the initial paint. Navigation and theme switching remain
available while photo controls show a loading state. Failed requests offer a
retry without reloading the page or losing filter URLs. The local review and
organizer galleries use the same loading behavior.
The preview's **Full screen** control expands the photograph, using the larger
sharing image while retaining navigation and photographer credit. Escape or
**Exit full screen** restores the details panel; **Close** returns to the gallery.
Browsers without native fullscreen support use a viewport-filling preview.

Organizers curate at <https://sdlcai.org/admin/photos/> using the existing admin
login. Hosted edits live in D1's `event_photo_reviews` table, over the versioned
initial review decisions. Saves reject stale revisions. Notes and association
evidence are organizer-only. Rejected and unreviewed photos are excluded from
public catalogs and their image/download endpoints. Derivatives have a five-minute
public cache lifetime; visibility changes can take that long to expire from caches.
Review rows are backed up to the private `INTEREST_BACKUPS` bucket after saves
and by the daily backup job, under `event-photos/`.

The speaker workspace links to <https://sdlcai.org/photos/?mine=1>. An active
speaker login grants full-resolution access to photos associated with their
assigned talks and any photos with a human-confirmed tag for that speaker.
Session association does not assert that the speaker appears in a frame.
Original downloads are checked on every request and are never publicly cached.
Organizer access includes all originals. Existing speaker login expiry and
revocation rules apply; this feature does not create or send new invitations.

Originals and derivatives use the existing **private** R2 bucket
`ai-meets-sdlc-speaker-uploads`, under `event-photos/sdlcai-2026/`. Public images
are served by the Worker rather than by exposing the bucket. The initial 752
objects use approximately 797 MB (594 MB originals + 203 MB derivatives).
Jaakko's 504 additional objects are uploaded to the same private prefix; HEIC
original keys end in `original.heic`, while derivatives remain JPEGs.
R2 Standard's 10 GB free allowance covers this set if sufficient account-wide
allowance remains; beyond the allowance storage is $0.015/GB-month, and R2
internet egress is free. See [current R2 pricing](https://developers.cloudflare.com/r2/pricing/).
Worker requests and D1 usage are separate from R2 storage pricing.

To prepare the immutable hosted manifest and upload photo files:

```sh
npm run photos:seed
npm run photos:upload             # Show the target without uploading
npm run photos:upload -- --remote # Upload using the configured Cloudflare account
```

The upload verifies local hashes, writes a resumable checkpoint under the ignored
output directory, and leaves bucket visibility private. The hosted seed excludes
local absolute paths and mutable review notes. Changing it does not overwrite
hosted D1 review decisions. Local and hosted review state are separate; export
the organizer catalog before moving decisions between them.

The deployment workflow applies migration `0038_create_event_photo_reviews.sql`
before deploying. After a push, verify the Quality and Deploy runs for that exact
commit, then check the live gallery and protected original endpoints.

```sh
npm run worker:test-build
node --test test/media-bank.test.mjs test/event-photos.integration.test.mjs
node --test test/photo-context.test.mjs
npm run photos:browser-check
```

Hosted tests use isolated D1/R2 state and repository-owned sample images, so CI
does not need access to the original photo folder. They verify licensed ZIPs,
speaker/session access, revoked access, review privacy, concurrent saves and
responsive accessibility. The hosted browser check is part of the quality gate.

Useful next collections include speaker-confirmed portraits, poster sessions,
sponsor activity, and selected venue/audience photos for future event promotion.
Confirmed-person filters become visible in the public gallery once organizers
have added human-confirmed tags.

The visual review supports these concrete reuse opportunities:

- **Event recap:** a sequence from `IMG_4573.HEIC` (welcome sign),
  `DSCF6569.jpeg` (audience), `DSCF6586.jpeg` (opening talk), `DSCF6668.jpeg`
  (panel), `DSCF6576.jpeg` (coffee), `DSCF6682.jpeg` (conversation),
  `IMG_20261013_170242_081.jpg` (key themes), `DSCF6722.jpeg` (group) and
  `IMG_20261013_174444_095.jpg` (afterparty). These provide a nine-frame story
  for a recap article or carousel.
- **Event team appreciation:** registration (`DSCF6639.jpeg`), recording
  (`DSCF6604.jpeg`), the production team (`IMG_4692.HEIC`) and badges
  (`IMG_4590.HEIC`). [Browse selected production photos](https://sdlcai.org/photos/?category=behind-the-scenes).
- **Sponsor follow-up:** the Wunderdog banner in the audience Q&A, AIMBITION
  beside the recording activity, Swarmia/AIMBITION beside the stage, and the
  closing sponsor acknowledgement. [Browse sponsor highlights](https://sdlcai.org/photos/?tag=sponsors).
- **Vertical social stories:** `IMG_4573.HEIC`, `IMG_4590.HEIC`,
  `IMG_4648.HEIC`, `IMG_4692.HEIC` and `IMG_4705.HEIC` provide portrait images
  of the welcome sign, badges, audience, crew and branded drinks. They share
  the same Jaakko Hollmén credit and CC BY 4.0 license. [Browse portrait highlights](https://sdlcai.org/photos/?tag=portrait-orientation).
