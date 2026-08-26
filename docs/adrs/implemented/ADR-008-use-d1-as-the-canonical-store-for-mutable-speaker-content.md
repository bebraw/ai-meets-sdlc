# ADR-008: Use D1 as the Canonical Store for Mutable Speaker Content

**Status:** Implemented

**Date:** 2026-08-26

**Amends:** [ADR-001](./ADR-001-use-a-moderated-self-service-workspace-for-speakers.md), [ADR-007](./ADR-007-allow-organizer-authored-speaker-revisions.md)

## Context

ADR-001 and ADR-007 kept public speaker and talk content in Git. Approved D1
revisions had to be copied into JSON and portrait files, committed, and
deployed before becoming public. This retained a familiar review boundary, but
it also made the database revision and Git file two representations of the same
mutable content. Organizer and speaker edits could overlap with repository
changes, require manual reconciliation, or be lost through an incorrect copy.

Every mutable surface is already served through the Worker: public speaker and
schedule pages, presentation decks, speaker promotion manifests, and social
graphics generated on demand. Stable speaker and talk identifiers also make it
possible to keep event structure in Git while resolving current presentation
content at runtime.

## Decision

Use one versioned D1 record per speaker as the canonical source for mutable
speaker content:

- name, role, biography, and social links;
- the title and description of talks already assigned to the speaker; and
- the approved portrait's R2 key, content hash, and version.

Keep stable speaker and talk identifiers, talk ownership, schedule placement,
and other event structure in Git. The bundled speaker and schedule JSON seeds
new canonical rows during migration and remains a build scaffold and explicit
read-only fallback; it is no longer the publication target for approved edits.

Publish approved content and portrait revisions to D1 in the same D1 batch that
records the approval. Use a per-speaker content version for optimistic locking.
An edit opened against an older version receives a conflict response and must
be reviewed against the current record. Content revisions remain as audit
records, while only `draft` and `submitted` revisions are active work.

Add stable speaker and talk markers to generated HTML. The Worker replaces
marked values with a consistent D1 snapshot before returning public speaker,
schedule, and deck pages. Approved portraits are served from private R2 through
content-addressed public Worker URLs.

Social render assets declare the speaker IDs they depend on. Their effective
version combines the build-time asset digest with only those speakers' content
and portrait versions. Cache API and R2 objects remain content addressed, so an
edit invalidates affected graphics without regenerating unrelated slides. The
speaker promotion manifest is resolved from the same D1 snapshot at request
time.

Public HTML may fall back to bundled content if D1 cannot be read, with an
explicit response header and no-store caching. Authenticated reads and writes,
approval publication, promotion manifests, and newly requested renders fail
closed when canonical D1 data is unavailable.

## Trigger

The organizer asked whether mutable speaker data could live in a Cloudflare
database after identifying the merge-conflict risk of using Git as both the
application publication target and the repository for ongoing site work.

## Consequences

**Positive:**

- Speaker and organizer edits cannot create Git merge conflicts.
- Approval publishes all public HTML and promotional surfaces without a source
  edit, commit, build, or deployment.
- Per-speaker optimistic locking prevents silent overwrites while allowing
  unrelated speakers to be edited concurrently.
- Dependency-scoped versions retain the existing cache efficiency for social
  graphics.
- Git still governs stable event structure and provides a reviewable seed and
  emergency public fallback.

**Negative:**

- Public content now depends on D1 and Worker HTML rewriting at request time.
- Approved content changes do not receive Git pull-request review; the admin
  review UI and revision audit trail become the publication control.
- The D1 migration must be applied before deploying Worker code that expects
  canonical rows.
- Bundled fallback content can be older than D1 during an outage.

**Neutral:**

- Speaker submissions still require organizer approval.
- Portrait binaries remain in R2, and generated social JPEGs remain in their
  separate content-addressed R2 cache.
- Adding a speaker or changing talk ownership or schedule placement still
  requires a Git change and a seed migration.

## Alternatives Considered

### Continue copying approved revisions into Git

Rejected because it preserves duplicate mutable state, manual publication, and
the merge-conflict risk that motivated this decision.

### Let the Worker commit approved edits to Git

Rejected because it would place repository credentials at the edge, create
automated commits for routine content edits, and still require a successful
build and deployment before publication.

### Store each mutable field in normalized D1 tables

Deferred because each profile is read and versioned as one small document. A
single validated JSON value makes atomic publication, optimistic locking, and
snapshot reads simpler while stable IDs and assignments remain relationally
constrained by the bundled configuration.

### Use KV instead of D1

Rejected because the revision workflow, transactional approval, version checks,
and admin queries already depend on D1. KV would require a separate consistency
model and could not atomically publish content with its audit revision.
