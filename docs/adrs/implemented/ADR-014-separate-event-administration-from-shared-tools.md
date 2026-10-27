# ADR-014: Separate event administration from shared tools

**Status:** Implemented

**Date:** 2026-10-23

**Implemented:** 2026-10-27

## Context

The admin desk currently presents its workspaces under SDLCAI 2026. The content
inventory also uses the 2026 production dataset. A possible 2027 event will need
its own records while the 2026 archive and post-production work remain available.
Mailing-list management serves SDLCAI across events and should remain independent
of the selected event.

## Decision

Use shared SDLCAI administration at `/admin/` and explicit event workspaces at
`/events/<event-id>/admin/`. Each event owns a separate D1 database and separate
upload, export and backup R2 bindings. The existing database remains the 2026
dataset and temporarily houses shared newsletter tables; newsletter operations
explicitly use the shared environment. New event schemas exclude those tables.

The configured event catalog provides stable IDs, labels and resource bindings.
Database ownership metadata is checked before event operations. New events start
empty and do not inherit identities, attendees, access links, consent, content or
deadlines. Organizer and speaker entries describe participation in an edition;
only the admin account and common services are shared.

| Scope                        | Tools and records                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared SDLCAI administration | News subscribers, consent and unsubscribe history; common account and service settings where applicable.                                                              |
| Individual event             | Programme and talks, speaker participation, attendees, badges, volunteers, event messages, feedback, Q&A, hospitality, photos, posters and post-production inventory. |
| Reviewed boundaries          | Speaker/organizer participation, original-purpose interest lists, activity and exports remain event-specific. Public brand assets can be deliberately reused.         |

Use a stable event identifier with a display label such as **SDLCAI 2026**. The
event selector changes the event workspace while shared tools remain
directly accessible. Existing unprefixed admin tool, speaker, staff and media links stay attached to 2026. Shared news remains directly accessible from every event. Selection is
carried in URLs, so simultaneous tabs cannot change each other's event.

Keep news subscriptions separate from event participation: attending an event
must not create marketing consent, and creating a new event must not copy private
attendee records into it.

## Trigger

After adding the 2026 content inventory, the organizer identified the need to
support a possible 2027 dataset without placing year-independent tools under 2026. This is separate from the completed post-production inventory work.

## Implementation and acceptance criteria

The [scope inventory and operational guide](../../event-administration.md) maps
all current tables, API groups, resources, backups, scheduled jobs, access links
and browser-local state. The following criteria are implemented:

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

Edition-specific bundled tools are only available for their owning event until
an adapter is explicitly added; they cannot fall back to 2026 content in a future
workspace. Portable administration starts empty. The schema-only bootstrap and
additive 2026 ownership marker make the migration reversible. Integration tests
and Chromium/WebKit checks exercise two event fixtures; production has only 2026.

## Consequences

**Positive:**

- The 2026 archive and production work can coexist with preparation for another
  event.
- Shared subscriptions keep their consent and unsubscribe history across years.
- Explicit event context reduces the chance of acting on the wrong dataset.

**Negative:**

- Each additional edition requires explicit resource provisioning and its own
  content adapters for edition-specific materials.

**Neutral:**

- Existing admin tools remain operational through compatible 2026 routes.
- Speaker and organizer participation stays event-specific; shared account
  settings and newsletter consent stay independent of participation.

## Alternatives Considered

### Rename the admin heading and add a year selector only

This improves labeling but does not establish separate datasets or scope
mutations, exports and cleanup.

### Copy the entire admin and database for each year

This provides isolation but duplicates shared subscriptions and services, making
cross-event consent and maintenance harder to manage.
