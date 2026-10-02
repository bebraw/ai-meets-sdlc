# ADR-012: Integrate event Q&A with revocable staff links

- Status: Implemented
- Date: 2026-10-02

## Context and trigger

SDLCAI needs the moderated question workflow from `bebraw/qa-app` inside the
existing site and admin interface. `bebraw/vibe-template` provides the model of
an independently addressable, persistent room. Event staff need reusable access
on multiple devices, with admin revocation after the event.

## Decision

Use the current Gustwind pages, Worker router, shared styles, and admin
authentication. Adapt the prototype's audience/moderator/MC workflow and the
template's room isolation without introducing a second frontend framework or
copying the single-choice voting capability. Each participant may vote once for
each approved question, excluding their own question.

D1 stores room registration, the active-room pointer with a revision, staff
grants, and staff sessions. Migration 0022 seeds the four presentation sessions.
Room IDs and object names are stable and independent of titles or schedule
order. An admin can add rooms. Audience entry starts closed; every room starts
paused.

Each registered room has a SQLite-backed `QaRoom` Durable Object containing its
questions, votes, status, current screen selection, rate limits, and staff audit.
Synchronous storage transactions preserve one active question and consistent
mutations. Idempotent submission IDs, unique vote keys, question revisions, and
expected screen selections prevent duplicate submissions, repeated votes, lost
moderator edits, and stale MC actions. Switching the event's active room never
moves stored questions or votes.

`QaUpdates` is an event-wide SSE notification hub. It holds transient stream
connections and broadcasts only a change signal. Clients fetch a fresh,
authorized server-rendered fragment; the hub does not contain question content,
participant identifiers, credentials, or authoritative room state. Periodic
notifications recheck authorization and reconcile missed signals. Clients poll
when SSE is unavailable. Native HTML forms remain usable without JavaScript.
Dirty edits survive updates; attendee drafts require explicit review when the
active room changes.

## Access and visibility

Admin creates named moderator or MC grants with random 256-bit tokens. A link
carries its token in the fragment; the client clears that fragment from browser
history, and an explicit POST exchanges it for an HttpOnly, SameSite=Strict,
Secure production cookie. The link is never consumed and has no automatic
expiry. A browser session lasts 14 days and can be replaced using the same link.
Admin revocation disables the grant and deletes all its sessions. Each protected
read and write verifies both the session and the live grant.

D1 stores a purpose-specific keyed token hash and an encrypted token so an admin
can retrieve the same link later. Session tokens are stored only as keyed
hashes. The existing encryption secret provides key material. This is separate
from the speaker workflow's single-use magic links.

The signed, HttpOnly attendee cookie lasts 18 hours. Room-specific participant
hashes support vote deduplication and let authors see their own pending questions.
Everyone else, including MCs and public presentation views, sees only approved
questions. Only moderators and admins see pending, hidden, and answered items.
All roles and participant keys come from server authentication. Requests are
bounded, mutations require the same origin, HTML is escaped, CSV export defends
against spreadsheet formulas, and responses are uncached and excluded from
indexing. Per-browser and generous per-IP rate limits tolerate a shared venue
network; raw IP addresses are not persisted. Staff audit records contain actor,
action, question ID, and time without submitted values or tokens.

## Consequences and alternatives

Rooms remain available across Worker restarts and deployments. Archiving retains
data and closes the room; confirmed clearing deletes questions and votes. The
existing D1/R2 backup job does not cover room storage. Admin CSV exports provide
an event record; automated Durable Object exports can be added if a broader
recovery requirement emerges.

Anonymous voting limits one browser rather than one human. Clearing cookies or
changing devices allows a new identity. Named logins would give stronger voter
identity but add friction inappropriate for this event. Bearer staff links can
be forwarded; creating separate named grants gives admins individual revocation
and audit attribution without maintaining user accounts.

A standalone prototype would duplicate hosting and admin controls, and its
global in-memory store would lose state. A direct copy of the room template
would bring an unrelated UI and one-choice voting contract. A broadcast of full
room snapshots would require role-specific private streams; signal-only SSE
keeps visibility checks in the Worker.

## Validation

Unit and integration tests cover signed cookies, reusable grants, role boundaries,
pending-question privacy, persistence, duplicate submissions/votes, simultaneous
actions, stale writes, room switching, origin and payload validation, safe
rendering, revocation, clearing, exports, and private-free notifications. The
browser check covers actual forms, live moderation and voting, screen updates,
mobile layout, accessibility, long projector questions, draft preservation,
revocation redirects, and native submission. It is part of the quality gate.
