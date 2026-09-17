# ADR-009: Send Daily Speaker Review Digests with Scoped Approval Links

**Status:** Implemented

**Date:** 2026-09-17

**Amends:** [ADR-001](./ADR-001-use-a-moderated-self-service-workspace-for-speakers.md), [ADR-008](./ADR-008-use-d1-as-the-canonical-store-for-mutable-speaker-content.md)

## Context

Speaker title and description submissions remain unpublished until organizer
approval, but discovering them currently requires visiting the admin workspace.
The organizer requested a daily digest at `info@sdlcai.org` with an easy way to
approve from the email. Cloudflare already sends transactional mail, while
Google Workspace owns inbound delivery.

## Decision

Send one daily digest of pending content revisions at 09:00 Europe/Helsinki.
Include changed profile and talk fields so the organizer sees the whole scope
of approval. Omit drafts and private test speakers, remind daily while work
remains pending, and send nothing for an empty queue.

Each approvable revision receives a random 256-bit capability in an HTTPS link.
Store only its purpose-specific HMAC, revision ID, exact content hash, base
content version, and seven-day expiry. It grants no general admin access.
The GET/HEAD review page only displays full before/after text; a same-origin
form POST with the displayed snapshot hash explicitly approves and publishes.
Reuse the admin review transaction, with additional token, expiry, and snapshot
conditions inside its D1 write. Already-reviewed, altered, or stale revisions
cannot be approved through an old link. Record the reviewer as the organizer
mailbox, since the capability cannot identify an individual mailbox user.

Conflict resolution and requesting changes remain in the authenticated admin
workspace. Keep Google Workspace inbound delivery and do not implement approval
by replying to mail or enabling Cloudflare Email Routing.

An hourly cron checks Helsinki time, including DST. A D1 row keyed by local date
claims the daily run with a 30-minute lease and at most four attempts. Successful
and empty runs are terminal for that date. Keep existing daily maintenance
separate; remove expired token hashes and delivery records older than 30 days.
Do not persist email bodies or raw capabilities in delivery metadata or logs.

## Trigger

The organizer wanted to notice speaker edits and approve them from an email
without repeatedly opening and signing into the admin workspace.

## Consequences

- Approval still publishes the exact reviewed D1 revision, with optimistic
  concurrency checks; it does not require a Git commit or redeployment.
- Following links, including mail scanners' GET/HEAD requests, cannot publish.
- Anyone holding a forwarded link can approve its one revision until it expires
  or is reviewed. Mailbox access and link confidentiality are the trust boundary.
- Delivery is retried after failures. A provider accepting a send just before a
  process failure or failed D1 completion write can cause a duplicate message;
  external email delivery and D1 cannot be one atomic transaction.
- Scheduled runs after 09:00 can recover a missed or failed daily attempt.
- The daily email is a snapshot; later submissions appear the following day,
  and revisions approved after sending show a no-longer-available review page.

## Alternatives Considered

### Link only to the authenticated admin workspace

Simpler, but retains the sign-in step. This remains the fallback for conflicts,
expired links, and requesting changes.

### Approve immediately on an email link's GET request

Rejected because scanners and prefetchers can follow links without a deliberate
organizer decision. An explicit confirmation POST is required.

### Parse approval replies or use interactive email forms

Deferred because inbound email belongs to Google Workspace and interactive
email support varies by client. An ordinary HTTPS link and accessible form
work with existing mail clients and hosting.
