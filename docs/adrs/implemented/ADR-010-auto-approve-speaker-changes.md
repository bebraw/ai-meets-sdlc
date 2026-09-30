# ADR-010: Auto-approve speaker changes

- Status: Implemented
- Date: 2026-09-30
- Amends: [ADR-001](./ADR-001-use-a-moderated-self-service-workspace-for-speakers.md), [ADR-002](./ADR-002-provide-promotion-assets-and-staged-video-submissions.md), and [ADR-009](./ADR-009-send-daily-speaker-review-digests-with-scoped-approval-links.md)

## Context and trigger

The organizer trusts invited speakers to maintain their own profiles, talks, and media. Requiring approval for every change adds unnecessary work and delays publication.

## Decision

Authenticated speakers can save private drafts and explicitly publish profile and talk changes. Publication updates canonical content and records an approved revision in one D1 batch. Validation, immutable assignments, authentication, origin checks, and stale-version protection remain enforced.

New photo uploads publish automatically after image processing and validation. Verified Stream completion webhooks automatically approve valid videos for use within their recorded permissions. Video approval does not itself publish a public video URL or widen consent.

Existing pending reviews retain their organizer review paths and digest support. This change does not bulk-approve historical submissions. New automatically approved submissions do not enter the review digest.

## Consequences

Speakers can publish without waiting and start a new draft immediately. Revision history and activity logging remain available. Organizers no longer preview every new change before it is published.

## Alternatives

Keeping mandatory review preserves organizer control but retains the bottleneck. Per-speaker trust flags add configuration without a current need because the organizer trusts all invited speakers.
