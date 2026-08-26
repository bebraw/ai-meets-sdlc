# ADR 0007: Allow organizer-authored speaker revisions

- Status: Accepted
- Date: 2026-08-26

## Context

ADR 0001 established a moderated speaker workspace and kept Git as the source
of truth for published profiles, talks, slides, and promotion graphics. That
workflow assumed speakers would create the first revision. In practice, the
organizer often already has usable biography, social, talk, and portrait
material, may need to correct a typo quickly, and cannot require every speaker
to sign in before the program can be prepared.

Creating a second organizer-only content store would make the public-data flow
ambiguous. Letting the deployed Worker update Git directly would also bypass
the existing validation, build, and deployment controls.

## Decision

Allow an authenticated organizer to author a speaker content revision from the
speaker admin page. The organizer editor covers the same mutable profile,
social-link, and assigned-talk fields as the speaker workspace and uses the
same server-side validation and immutable talk-ownership rules.

The organizer chooses one of two outcomes:

- save a `draft`, which prefills the speaker workspace if the speaker later
  signs in; or
- save an `approved` revision, which is ready for the existing copy-to-Git,
  build, and deployment step.

An organizer edit supersedes any active draft, submitted, or approved revision
for that speaker. Superseded records are retained as rejected revisions with an
organizer audit note. A canonical content hash prevents saving from an editor
opened against an older deployed profile.

Allow organizers to upload a replacement portrait through the same bounded
Images pipeline used by speakers. Organizer uploads are decoded, cropped,
re-encoded as a 400 by 400 WebP, stored privately in R2, and marked approved.
The derivative must still replace the canonical Git asset before it becomes
public.

## Consequences

- Profiles and talks can be prepared without waiting for speaker sign-in.
- Speakers see organizer-prefilled drafts in the same workspace and can
  continue editing them.
- Organizer and speaker edits share validation, revision history, immutable
  identifiers, and one publication path.
- Admin edits do not become public until the canonical JSON or WebP is applied
  to Git and deployed.
- The shared Basic-auth boundary records the actor as `admin`; it cannot
  distinguish individual organizers without a future admin identity system.

## Alternatives considered

### Require every speaker to create their own revision

Rejected because incomplete participation would block program preparation and
leave routine organizer typo fixes outside the application workflow.

### Publish organizer edits directly from D1

Rejected because the static website, decks, and generated graphics would have
different sources of truth until every surface was regenerated.

### Let the Worker commit directly to Git

Rejected for the same reason as ADR 0001: it would require repository
credentials at the edge and bypass the normal review, validation, and deploy
pipeline.
