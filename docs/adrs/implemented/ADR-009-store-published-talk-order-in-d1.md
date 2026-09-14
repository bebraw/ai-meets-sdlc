# ADR-009: Store Published Talk Order in D1

**Status:** Implemented

**Date:** 2026-09-14

**Amends:** [ADR-008](./ADR-008-use-d1-as-the-canonical-store-for-mutable-speaker-content.md)

## Context

Organizers need to reorder talks and move them between sessions through the
admin UI. The requested interaction is drag and drop with a separate save
button. Previously, schedule placement was compiled from Git into every public
page and deck.

## Decision

Store one versioned schedule document in D1, containing the fixed session IDs
and ordered talk IDs. Keep session definitions, times, talk IDs, and speaker
ownership in Git. Seed the document with migration 0016.

The editor holds a browser-local draft. Saving atomically replaces the published
document only when its revision still matches. Validate that every bundled talk
appears exactly once and that session IDs and order remain fixed. Admin session
authentication and same-origin action verification protect reads and writes.

Resolve the schedule once per response. Reorder marked generated HTML subtrees
on the server before resolving canonical speaker content. Update the deck,
session cards, screen schedule, website, speaker session labels, slide library,
and event feed from the same schedule contract. Stable slide IDs identify
individual slides even after reordering. Social renders include schedule content
in their version and render from the captured schedule snapshot.

## Consequences

- Publishing order changes no longer requires a deployment.
- Browser drafts are not published until Save changes is selected.
- Competing saves receive a conflict and keep the local draft available.
- Public schedule HTML is uncached and can use the bundled fallback during a D1
  outage. Admin operations, the feed, and new graphics fail closed.
- Changing the set of talks or sessions requires updating both the bundled
  scaffold and the D1 schedule with a migration.
- Runtime HTML parsing adds work per request, while reusing the existing markup
  avoids maintaining a second set of page templates.
- Schedule edits invalidate generated graphics; existing immutable graphics
  remain accessible by their historical version URLs.
