# ADRs

This directory stores Architecture Decision Records for decisions that are
significant enough to shape future work in the repository.

Add or update an ADR when a change establishes a lasting technical constraint,
selects between credible architectural alternatives, accepts a meaningful
trade-off, or replaces, narrows, or broadens an earlier decision. Skip ADRs for
small, reversible, or purely tactical choices.

ADRs are grouped by lifecycle status:

- `proposed/` stores draft ADRs and the reusable ADR template.
- `accepted/` stores approved ADRs whose decisions are not fully implemented.
- `implemented/` stores decisions reflected in the repository. Superseded
  records stay there as historical decisions.

## Proposed ADRs

| ADR                                       | Status   | Summary                            |
| ----------------------------------------- | -------- | ---------------------------------- |
| [ADR-000](./proposed/ADR-000-template.md) | Proposed | Template for drafting future ADRs. |

## Accepted ADRs

No accepted-only ADRs are currently pending implementation.

## Implemented ADRs

| ADR                                                                                           | Status      | Summary                                                                                      |
| --------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| [ADR-001](./implemented/ADR-001-use-a-moderated-self-service-workspace-for-speakers.md)       | Implemented | Give speakers a moderated workspace while keeping immutable identity and assignment fields.  |
| [ADR-002](./implemented/ADR-002-provide-promotion-assets-and-staged-video-submissions.md)     | Implemented | Give speakers stable promotion assets and privately moderated Stream video uploads.          |
| [ADR-003](./implemented/ADR-003-keep-speaker-contacts-private-and-use-transactional-email.md) | Implemented | Keep encrypted speaker contacts in D1 and scope application email to event communication.    |
| [ADR-004](./implemented/ADR-004-render-social-graphics-on-demand-at-the-edge.md)              | Implemented | Render and cache content-addressed social graphics with Browser Rendering and R2.            |
| [ADR-005](./implemented/ADR-005-keep-google-workspace-for-inbound-email.md)                   | Implemented | Keep Google Workspace for replies while Cloudflare sends transactional application messages. |
| [ADR-006](./implemented/ADR-006-use-speaker-initiated-magic-link-access.md)                   | Implemented | Let mapped speakers request short-lived, single-use magic links.                             |
| [ADR-007](./implemented/ADR-007-allow-organizer-authored-speaker-revisions.md)                | Implemented | Let organizers prefill or approve speaker content through the shared revision workflow.      |
| [ADR-008](./implemented/ADR-008-use-d1-as-the-canonical-store-for-mutable-speaker-content.md) | Implemented | Publish mutable speaker content from versioned D1 records while Git retains event structure. |

## Creating a New ADR

1. Copy [`ADR-000-template.md`](./proposed/ADR-000-template.md).
2. Rename it using the next sequential ID:
   `proposed/ADR-NNN-short-title.md`.
3. Fill in context, decision, trigger, consequences, and alternatives.
4. Move an approved decision to `accepted/` while implementation is pending.
5. Move it to `implemented/` only after the repository implements the decision.
6. If it supersedes or amends an earlier ADR, link both records explicitly.
7. Update the lifecycle table in this file.

## Search Tips

```bash
rg "Status:" docs/adrs
rg "Superseded by|Amends|Amended by" docs/adrs
rg "database|auth|deploy" docs/adrs
```
