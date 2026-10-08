# ADR-013: Manage attendees with scoped registration access

**Status:** Implemented
**Date:** 2026-10-02
**Amends:** [ADR-011](./ADR-011-manage-organizers-and-validated-badge-printing.md)

## Context

The badge import workflow already combines Tito and Webropol exports. The event
also needs a shared registration list, ticket lookup, and arrival tracking.
Registration staff need easy sign-in without access to other organizer tools.
Q&A already establishes reusable, named, revocable staff links.

## Decision

Add `/admin/attendees/` using the badge workspace's CSV mapping and list design.
Store up to 2,000 attendees in one encrypted, revisioned D1 roster. Import uses
the source plus individual ticket code, or attendee email when no code exists,
as its stable identity. Refreshes update matching details without removing
omitted rows or changing stable IDs and badge choices. Reject ambiguous
identities and unknown mapped ticket statuses. Organizers can correct details,
cancel registrations and select badge inclusion. Identity corrections update the
source key while preserving record IDs; subsequent imports use the corrected key.

Organizers can also add individual manual registrations through **Add attendee**.
Use the same validated fields, encrypted roster, capacity bound, and optimistic
revision checks, with server-generated IDs and a separate `manual` source.
Reject duplicate identities within that source instead of updating an existing
person. Provider imports leave manual records unchanged. Manual entries support
the same organizer editing, arrival, catering, canonical identity mapping, and
badge inclusion flows; registration staff can only look them up and mark arrivals.
Existing rosters remain readable, and no migration is needed.

Capture an optional original dietary response in the encrypted roster. Detect
comma, semicolon and tab exports, Tito's food-restriction question and blank
active Void Status, and Webropol's metadata, two header rows and Finnish status
labels. Prefer attendee fields over repeated registrant fields. An unmapped
diet column preserves existing responses on refresh; a mapped blank replaces
the earlier response. Existing rosters without diets remain readable.

The organizer attendee page groups active registrations for catering, keeping
combined requirements together and original wording available. Classify common
English and Finnish diet labels; flag specific allergy details, unrecognized
wording and alternatives for review. Distinguish missing answers from explicit
no restrictions. Category counts overlap; combined groups count each response
once. Copy or download a text summary containing counts and original responses
without attaching attendee identities. The full roster determines totals,
regardless of filters or arrivals. Cancelled registrations are excluded. Include
public speakers automatically and read their meal preferences, food requirements
and cross-contamination concerns from live dinner responses. Dinner attendance
does not determine daytime catering attendance; private test speakers are not
added automatically. Combine dietary responses with exact email or unique name
matches to active registrations, without modifying the imported roster.

Shared dinner responses can match public speakers, organizers or active
attendees. Provide persistent mappings for aliases, an explicit additional-person
choice and daytime exclusions. Ambiguous and unmatched responses are marked as
pending and excluded from the headcount until mapped. Multiple responses mapped
to one organizer count once; preserve all supplied restrictions. Other guests
without a matched or mapped response still need a separate headcount.
Copy/download reports include the combined headcount and pending-mapping count.
Store only identity links in encrypted, separately revisioned roster columns;
read diets live so dinner updates, purge and retention apply to this view too.
Reject saves against changed source snapshots or mapping revisions. Disable
exports when catering sources are unavailable or mapping changes are unsaved.
Diet responses are omitted from registration staff API responses.

Include accepted poster presenters as attendees and all volunteers as organizers
in the admin roster, scoped desk list and catering headcount. Build these entries
live from their canonical workspaces, rather than copying them into imported
Tito/Webropol data. Repeated proposals and matching tickets share one entry;
volunteer membership takes the organizer role. Match normalized email first,
then a unique name. Ambiguous matches need an explicit registration link in
Catering mappings or an explicit separate-person choice. These identity links
apply to both registration and catering. Managed entries link to their source
workspace for editing. Badge selection does not control registration or meals.
Poster presenters' dinner meal preferences, restrictions and contamination
concerns join their entry through canonical names or explicit dinner aliases,
including when their imported ticket name differs. Dinner attendance does not
change their daytime attendance. Existing cancellations remain cancelled.
Preserve arrival history through source IDs when a ticket is imported later;
reject repeated arrivals across those identities. Removing a canonical source
removes its generated entry while retaining independent ticket registrations.
Migration 0026 increments the roster revision on relevant canonical changes,
so outstanding check-in confirmations fail when a volunteer or accepted poster
changes. Registration identity mapping changes also advance that revision;
dinner-only dietary mappings leave it unchanged. Desk responses omit dinner
data, proposal details and volunteer tasks.

Reuse the same diet classification, combined groups, review flags and original
response rendering on `/admin/dinner/`. Dinner totals include only attending
speaker and guest responses, including attendance recorded by organizers, and
match the individual caterer CSV. Show structured meal preferences and separate
counts for cross-contamination concerns and unsure answers. Filters do not alter
the totals. Copy/download summaries use the dinner date and omit identities;
keep missing dietary answers distinct from explicit no restrictions. Failed
loads disable export until refreshed. Both catering views share the response
adapter, group renderer and requirement export text.

Model sponsors as an attendee type within the same encrypted roster and Tito
source. The import type selector can classify a separate sponsor CSV or update
matching registrations; its default preserves existing types and creates new
rows as attendees. Editors can correct types, and both organizer and desk lists
show and filter them. Existing untyped records default to attendees. Sponsors
retain the same ticket identity, arrival history, dietary response and badge
inclusion rules. Catering includes active sponsors. Badges inherit this type,
use teal with a SPONSOR label, and support a separate sponsor print run.

Keep arrivals outside the encrypted roster, indexed by random attendee ID.
Writes compare the arrival revision and the roster revision displayed to staff,
verify current staff
access again inside SQL, and reject cancelled registrations. Database triggers
record successful arrival/undo actions atomically, with time and actor IDs but
no attendee values. Only organizers can undo an arrival. This separation keeps
refreshes from overwriting arrival history and avoids a global roster write
for each check-in.

Registration grants follow Q&A's interaction pattern, with separate
purpose-specific hashes, tables and cookies. Each link opens a fragment-token
access page and requires an explicit sign-in POST. Tokens are removed from
browser history before rendering and are never placed in server request URLs.
The reusable link remains valid until revoked; a hashed browser session lasts
14 days. Revocation removes every session for that link. Staff can read the
roster and mark arrivals at `/registration/`, without access to admin, badges,
Q&A moderation, attendee editing or imports. Every mutation checks origin and
an explicit action header. Private responses use no-store caching.

Simplify `/admin/badges/` to preview, layout checks and print generation. It
loads active, badge-selected attendees, public speakers, selected organizers and
attending volunteers directly from their canonical workspaces. Imports, contact
editing and badge inclusion live in those workspaces. Arrival status does not
control badge inclusion. Remove CSV imports, manual person creation, roster
editing and source refresh buttons from the badge studio.

The encrypted badge store now saves printer settings and name/company output
adjustments, with optimistic revisions. Each text adjustment or duplicate
confirmation carries a source fingerprint; source corrections invalidate stale
print preferences instead of overriding canonical data. Recheck current people
before generation and require review when records have changed.

Read the earlier snapshot format and preserve it encrypted and downloadable.
Unmatched earlier CSV/manual rows remain printable; current registration emails
suppress their earlier copies even when cancelled or excluded. Source-backed
earlier rows use current canonical data. Older volunteer exclusion choices are
honored until explicitly set in the volunteer workspace. No migration of private
attendee data is implicit. A saved, reversible retirement list excludes obsolete
earlier rows, including rows without email; it cannot exclude canonical people.
Earlier CSV/manual exclusions become retirement choices; restoring them makes
them printable without changing the original snapshot. The third saved format
records that conversion so subsequent reads do not reapply earlier exclusions.
Both earlier snapshot and print-preference formats remain readable, including
their volunteer inclusion choices. The original snapshot remains downloadable.
Keep the 2,000-attendee roster bound
without applying that bound to the combined live badge sources; preference
writes remain byte-limited.

Daily deduplicated R2 backups capture the encrypted roster and arrival ledger
in one D1 batch; access credentials are excluded. The weekly modification
digest counts roster and arrival writes without including private values.

## Consequences

No new bindings, services, dependencies or secrets are needed. Apply migration
0023, 0025 and 0026 before deployment. Imported tickets are snapshots; they cannot
verify provider refunds or cancellations that have happened since the export.
Organizers must refresh provider exports before registration opens.

Use individual ticket codes for multiple tickets sharing an email. Keep the
same identity mapping on subsequent imports. Entries from separate sources
remain separate, even when an email matches; the badge studio's existing
duplicate review identifies overlapping printing records. Cancel omitted
registrations explicitly instead of treating their omission as cancellation.

The roster is decrypted for authenticated list reads; this is appropriate for
the bounded event list but would need a different query model for larger
events. Unfinished attendee edit forms survive filters and list reloads, including
when hidden. Reloads advance draft revisions only when the edited attendee's
source details are unchanged; concurrent corrections still reject a stale save.
Initial read failures keep retry and sign-out usable. Multiple desks see changes
on a 15-second refresh; writes always check
current state. Staff devices need connectivity to confirm an arrival. Retention
cleanup must cover the roster, badge copies, downloads and encrypted backups.

## Validation

Unit checks cover CSV validation and source refresh identities. Local Worker
integration checks exercise authentication, origin verification, encrypted
storage, concurrent imports/arrivals, cancellation, undo history, reusable links,
sign-out, revocation and separation from Q&A/admin access. The browser check
covers the complete import-to-registration-to-badge flow, live badge sources,
print preference persistence, stale-source review, actual PDF output, mobile
layout and accessibility. Integration tests also cover compatibility with earlier
badge snapshots, retirement/restore, full-capacity combined lists, stale ticket
confirmations and source corrections invalidating print adjustments. Browser
coverage rejects malformed UTF-8 CSV uploads instead of accepting replacement
characters.
Diet checks cover both export layouts, Unicode and multiline responses, combined
requirements, review flags, missing versus explicit no restrictions, cancelled
exclusions, unmapped refreshes and legacy compatibility. Worker checks verify
encrypted storage, organizer-only responses and backup preservation. Browser
checks exercise automatic mapping, filtering-independent catering totals,
multiline diet editing, summary copy (including clipboard fallback), text download
and mobile accessibility.
