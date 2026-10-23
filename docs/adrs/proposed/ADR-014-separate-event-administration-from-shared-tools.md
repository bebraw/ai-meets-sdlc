# ADR-014: Separate event administration from shared tools

**Status:** Proposed — separate follow-up task; implementation deferred

**Date:** 2026-10-23

## Context

The admin desk currently presents its workspaces under SDLCAI 2026. The content
inventory also uses the 2026 production dataset. A possible 2027 event will need
its own records while the 2026 archive and post-production work remain available.
Mailing-list management serves SDLCAI across events and should remain independent
of the selected event.

## Decision

Propose a shared SDLCAI admin area with an explicit event workspace for each
edition. Treat 2026 as an event dataset, and review both navigation and stored
data before implementing the separation.

| Scope                        | Tools and records                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared SDLCAI administration | News subscribers, consent and unsubscribe history; common account and service settings where applicable.                                                              |
| Individual event             | Programme and talks, speaker participation, attendees, badges, volunteers, event messages, feedback, Q&A, hospitality, photos, posters and post-production inventory. |
| Requires scope review        | Organizer and speaker identities versus their event roles; interest lists and their original signup purpose; shared media reuse; activity-log views and exports.      |

Use a stable event identifier with a display label such as **SDLCAI 2026**. An
event selector should change the event workspace while shared tools remain
directly accessible. The route shape, schema and storage arrangement remain
design choices for the follow-up task.

Keep news subscriptions separate from event participation: attending an event
must not create marketing consent, and creating a new event must not copy private
attendee records into it.

## Trigger

After adding the 2026 content inventory, the organizer identified the need to
support a possible 2027 dataset without placing year-independent tools under 2026. This is separate from the completed post-production inventory work.

## Follow-up scope and acceptance criteria

1. Map each workspace, API, database table, storage prefix, backup and scheduled
   job to shared or event scope. Review retention and access links alongside the
   data they affect.
2. Design navigation that visibly identifies the current event and provides a
   shared mailing-list workspace. Define compatibility for existing admin,
   speaker and staff links.
3. Plan a reversible migration that assigns existing event records to 2026 and
   preserves published URLs, media permissions and subscription history.
4. Scope event reads, writes, exports, email recipients, cleanup and backups
   explicitly. Include browser-local inventory shortlists and other saved state.
5. Verify with two event fixtures that records, actions and saved selections
   remain isolated, while the shared mailing list remains available from either
   event context. Do not publish or populate a 2027 event until it is created.

## Consequences

**Positive:**

- The 2026 archive and production work can coexist with preparation for another
  event.
- Shared subscriptions keep their consent and unsubscribe history across years.
- Explicit event context reduces the chance of acting on the wrong dataset.

**Negative:**

- Navigation changes alone are insufficient; existing APIs, storage and lifecycle
  jobs need a coordinated scope review and migration.

**Neutral:**

- The current admin remains operational while this proposal is considered.
- Shared versus event-specific organizer and speaker records need a decision
  before implementation.

## Alternatives Considered

### Rename the admin heading and add a year selector only

This improves labeling but does not establish separate datasets or scope
mutations, exports and cleanup.

### Copy the entire admin and database for each year

This provides isolation but duplicates shared subscriptions and services, making
cross-event consent and maintenance harder to manage.
