# Public event feed

`GET https://www.sdlcai.org/event.json` publishes schema version 1. The schema is
available at `/event.schema.json`. Both endpoints support anonymous cross-origin
GET/HEAD requests, `Cache-Control: public, max-age=300`, and ETag revalidation.

`npm run build` generates both files and fails on schema errors, duplicate IDs,
unresolved speaker/topic references, or missing same-site paths and HTML IDs.
Talk IDs come from `site/data/schedule.json` and must remain unchanged when
renaming talks. Each talk now has its own destination; existing schedule section
anchors remain intact. Feed URLs are discovered from the rendered website, so
template anchor changes are picked up in the same build. Preserve old anchors as
aliases when changing an existing destination where practical.

The seminar, schedule and speaker source data supply the feed. The rendered home
page supplies the event description and public registration action. Schedule
blocks with talks supply topic labels and summaries. Individual talk times are
omitted because only block times are published. Current placeholder abstracts
(“Abstract forthcoming” or text saying the topic is “still to be decided”) become
`null` with `details-pending`; confirmed abstracts become plain text. Cancellation
must not be inferred from missing content.

The deployed site also publishes approved D1 speaker content without a rebuild.
The feed uses the same public canonical reader and talk conflict checks as the
HTML renderer, applying names, biographies, titles and abstracts to the validated
build snapshot. Only fields in the public contract are copied. Drafts, workspace
test accounts, contact data, and private ticket or slide material are excluded.
Canonical read failures return 503 with `no-store`, allowing consumers to retain
their last valid snapshot instead of replacing it with older bundled content.

`revision` is SHA-256 of the public dataset (including `updatedAt`, excluding the
revision itself). The build timestamp is the latest modification time of feed
source files, not the time of each build/request. Live revisions use the later of
that timestamp and the public canonical records' update times. Repeated reads of
unchanged data retain the same revision and ETag. A fresh checkout can change the
source timestamp and thus the revision even when text is unchanged.

## Lecture integration

The lecture application is maintained separately from this repository. Its
refresh step should fetch and schema-validate the complete candidate snapshot,
check unique IDs and references, and report removed session IDs or broken
interest mappings before replacing its saved snapshot. Persist the last valid
snapshot and revision together; network, HTTP, parse, validation, and mapping
failures must retain that snapshot. Unknown additive fields are allowed in v1.

Hold the snapshot steady throughout a lecture. Refresh only between runs or on
explicit presenter request, never per participant request or model invocation.
Display the source URL, content `updatedAt`, and local snapshot refresh time.
Keep lecture-specific ticket links, QR codes, allocation and interest mappings
separate from the public dataset. A 304 response reuses the saved snapshot.
