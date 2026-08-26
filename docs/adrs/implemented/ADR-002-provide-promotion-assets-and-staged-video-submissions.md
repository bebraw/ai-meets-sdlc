# ADR-002: Provide Promotion Assets and Staged Video Submissions

**Status:** Implemented

**Date:** 2026-08-26

## Context

The build already derives LinkedIn, X, and Bluesky graphics from the event slide
data. Speakers need easy access to the graphics associated with their own talk
after entering the Speaker Workspace. Organizers also want to encourage an
optional one-to-two-minute video in which a speaker introduces their topic for
event promotion.

Generated social filenames currently depend on slide ordering. A reordered
schedule should not break a speaker-facing link. Video upload is a separate
trust and moderation problem: browser uploads can be large, video must be
transcoded, and submitting a video must not imply permission to publish or edit
it in any way.

## Decision

Add a Promotion area to the Speaker Workspace. It presents the current social
graphics for the authenticated speaker's assigned talks, grouped by platform
and format, with direct preview and download actions.

Generate a promotion manifest keyed by stable `speaker_id` and `talk_id` rather
than asking the portal to infer ownership from a slide number or filename. The
graphics remain derived artifacts of the canonical event data. This decision
does not require a particular rasterization location: build-time and on-demand
edge rendering are both valid if they produce the same versioned manifest and
artifact contract.

Use Cloudflare Stream Direct Creator Uploads for promotional video:

1. The authenticated backend validates the speaker and assigned talk and asks
   Stream for a one-time direct upload.
2. The browser uploads directly to Stream rather than passing video bytes
   through the Worker. Use a resumable upload when file size or connection
   quality warrants it.
3. Set the creator to `speaker_id`, attach `talk_id` metadata, cap duration at
   120 seconds, and keep playback private while the submission is a draft.
4. Record the Stream UID and workflow state in D1, and update processing state
   only from a verified Stream webhook.
5. Give both speaker and organizer a private preview. Only an organizer can mark
   the video approved for promotional use or request a downloadable derivative.

The upload UI should describe the requested format, explain that submission is
optional, show progress and processing state, and encourage completion without
blocking other speaker tasks. Store an explicit permission record covering
whether organizers may caption, crop, excerpt, edit, and publish the video.
Retention for source video, published derivatives, and permission evidence must
be defined independently of speaker-profile retention.

## Trigger

Speakers needed direct access to their own promotional graphics, while the
organizer needed a safe way to request and moderate short topic videos without
proxying large uploads through the application Worker.

## Consequences

**Positive:**

- Speakers do not have to locate assets in the public slide library or decode
  slide-number-based filenames.
- Stable manifest keys survive schedule reordering.
- Video bytes bypass the Worker, avoiding Worker request-size and execution-time
  constraints.
- A submitted video is private by default and cannot accidentally become a
  public endorsement.
- Raster rendering can move from CI to the edge without redesigning the speaker
  experience, provided the manifest and cache contract remain stable.

**Negative:**

- Stream, a private upload-creation endpoint, webhook verification, D1 workflow
  metadata, and organizer moderation UI become required infrastructure.

**Neutral:**

- Video retention and recorded permissions remain independent of public
  speaker-profile retention.

## Alternatives Considered

### Ask speakers to download assets from the public slide library

Rejected as the primary workflow because it is organized around the full deck,
not the authenticated speaker and their assigned talk. The public library may
remain available as a secondary route.

### Upload videos through the application Worker into R2

Rejected because it makes the Worker proxy large, unreliable requests and
leaves transcoding, playback adaptation, and media processing to the
application.

### Publish a video immediately after upload

Rejected because processing success is not editorial approval, and publication
requires a separate, explicit permission and moderation decision.
