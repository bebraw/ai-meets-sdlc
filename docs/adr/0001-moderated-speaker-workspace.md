# ADR 0001: Use a moderated self-service workspace for speakers

- Status: Accepted
- Date: 2026-08-26

## Context

The site already gives a speaker a private capability link for submitting and
updating their dinner response. Speakers should also be able to maintain the
public information that describes them and their assigned talk:

- name and professional role;
- biography and profile photo;
- website and social profile links;
- assigned talk title and description.

The public site, slide decks, and downloadable promotion material are generated
from version-controlled JSON during the static build. Allowing a speaker to
write directly to those files, or serving unreviewed D1 values on only some
surfaces, would create inconsistent public content and bypass organizer review.
Speaker names are also mutable and therefore cannot safely identify records or
public anchors.

## Decision

Build one authenticated Speaker Workspace on top of the existing per-speaker
access pattern. A speaker may edit their profile and the content of talks
already assigned to them, but cannot change immutable identity, scheduling, or
publication fields.

The immutable identifiers are:

- `speaker_id`;
- `talk_id`;
- the relationship between a speaker and an assigned talk;
- schedule placement and publication state.

Use those identifiers in URLs, generated asset manifests, database records, and
cross-references. Preserve aliases for existing name-derived public anchors
when identifiers are introduced.

Speaker edits are stored as private, versioned D1 revisions with a state such
as `draft`, `submitted`, `approved`, or `rejected`. Submission does not change
the public event program. The organizer reviews a field-level diff, and an
approved revision is applied to the version-controlled speaker and schedule
data before the normal build and deployment. Git remains the canonical source
for published event content and generated artifacts.

The first version may bootstrap access from the existing private speaker link.
Redeeming the capability should establish a secure session so the secret does
not have to accompany each page request. The authentication boundary must allow
a later move to short-lived, single-use email magic links without changing the
profile and revision model.

Apply field-specific validation before a revision can be submitted or
published:

- render biography and talk-description Markdown through a sanitizing policy;
- accept only HTTPS social URLs on expected provider hosts where applicable;
- stage profile photos in a private upload area, decode and re-encode them to a
  bounded 400 by 400 WebP derivative, and publish only the reviewed derivative;
- impose explicit length and file-size limits and never trust a browser-supplied
  MIME type or filename.

## Consequences

- Speakers have one place to maintain all of their public information.
- Organizers retain editorial control and can inspect revision history.
- The public site, slide decks, and promotional assets remain consistent because
  they continue to share one canonical data source.
- Publishing an approved edit is not instantaneous: it requires an organizer
  action and a successful build/deployment.
- D1 migrations, revision APIs, organizer review UI, stable talk identifiers,
  image staging, and session handling are required.
- Public Markdown, URLs, and images gain an explicit trust boundary instead of
  flowing directly from form input into generated HTML.

## Alternatives considered

### Write speaker edits directly to the public JSON

Rejected because a deployed Worker cannot safely update the Git repository,
and accepting unreviewed edits into canonical content would remove the existing
review and build checks.

### Serve D1 profile values directly on the public site

Rejected because the static site, slide decks, and downloaded graphics would
then disagree until they were regenerated, and it would create two competing
sources of truth.

### Build separate forms for each editable feature

Rejected because profile, talk, dinner, promotion, and future speaker tasks
share identity, authorization, deadlines, and organizer review requirements.
One workspace avoids several incompatible invitation and access systems.
