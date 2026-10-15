# SDLCAI photo media bank

The first collection contains 188 JPEGs from the 13 October 2026 seminar.
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
- Both collections: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
  with the named photographer credited. The user confirmed unrestricted reuse
  under this license.

The catalog preserves the raw EXIF timestamp, original timezone value,
confirmed clock shift, corrected UTC timestamp, and corrected local timestamp.
The source JPEGs are never rewritten. Full-resolution downloads return those
unchanged JPEGs; corrected timestamps accompany them in the catalog.

## Prepare and review

Requires Node, the repository's npm dependencies, and ImageMagick (`magick`).

```sh
npm run photos:prepare -- --input /Users/juhovepsalainen/Projects/sdlcai/photos
npm run photos:review
```

Open <http://127.0.0.1:3010/>. The server binds only to the local machine.
It supports search; category, photographer, shortlist, talk and person filters;
full-size previews; comparison of conservative similar-frame suggestions;
caption, alt text and tag editing; and individual or ZIP downloads.

The initial categorization and shortlist are versioned in `initial-curation.json`
and are used when a local review file does not exist. Further review decisions
are saved atomically in `production/media-bank/curation.json`.
This mutable file is ignored by Git. Back it up using the **Back up review decisions**
download. Reload stale drafts before saving; the server rejects conflicting
edits instead of replacing a newer decision.

The first visual pass categorizes and captions all 188 photos and shortlists
30 highlights. Other frames are retained as alternates. Similar-frame groups
are suggestions to compare, not automatic duplicate deletions.

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
Existing visual/slide review agrees with the recording for 92 photos; five
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

The default export is the 30-photo highlight collection at sharing size.
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

The browser check uses a temporary copy of review state. It verifies all 188
source checksums, the 65 recording-verified Insta360 times, categorization and shortlist,
filtering, durable edits, stale-write rejection, local-origin mutation checks,
human-confirmation requirements, ZIP credits and original downloads, and
responsive layout/accessibility at 320, 390 and 1,440 px. It leaves source files
and real review decisions unchanged.

## Hosting integration

The public gallery is at <https://sdlcai.org/photos/> and opens with the 30
highlights. Clear the selection filter to explore all published alternates.
Visitors can search, filter, preview, copy attribution, and download sharing
copies individually or in a ZIP with credits and catalog metadata.

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
