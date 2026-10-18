# ADR-006: Use Speaker-Initiated Magic-Link Access

**Status:** Implemented

**Date:** 2026-08-26

**Amends:** [ADR-003](./ADR-003-keep-speaker-contacts-private-and-use-transactional-email.md) by replacing organizer-sent invitations as the primary access flow

## Context

The organizer already knows which email address belongs to each confirmed
speaker. Asking the organizer to create and send a long-lived invitation adds
work and makes access depend on a one-time outreach action. Speakers also need
one private place for content, promotion, media, and dinner logistics instead
of a separate dinner invitation system.

Email remains private operational data. A public sign-in form must not reveal
whether an address belongs to a speaker, and it must not become an email abuse
vector. Dinner responses include health-adjacent dietary information and must
not enter the public-content revision or Git publishing workflow.

## Decision

The organizer assigns a primary email and an optional secondary email to each
canonical speaker in the admin interface. Saving the mapping does not send mail.
A speaker visits `/speaker/`, enters either address, completes Turnstile when
configured, and receives a single-use magic link from `info@sdlcai.org` at that
address. Both addresses are encrypted, unique across all speaker mappings, and
share contact retention and suppression. Announcement delivery uses only the
primary address and its existing preferences; signing in through a secondary
address does not confirm the primary address for promotional email.

Login requests use a generic accepted response for both mapped and unmapped
addresses. Keyed fingerprints, rather than plaintext addresses or IP
addresses, support per-address and per-client throttling in D1. Magic-link
tokens are generated with Web Crypto, stored only as keyed hashes, expire after
24 hours (or the workspace access deadline if sooner), and are consumed before
a session is issued. Requesting another link does not invalidate an earlier
unexpired link, allowing for delayed or out-of-order email delivery. The existing
HTTP-only, secure speaker session cookie remains the authenticated browser
session.

For compatibility, already-issued workspace invitation links continue to work
until their configured expiry. The admin UI no longer makes organizer-sent
invitations the primary access path.

The existing encrypted `speaker_dinner_responses` record is exposed inside the
authenticated speaker workspace. Speakers can save attendance, meal
preference, food requirements, and cross-contamination concerns directly. This
data is saved independently of public profile and talk revisions, remains
available to the existing caterer export, and follows the existing dinner
deadline and retention window. Existing personal dinner links continue to see
the same record. Unmapped shared-link responses remain available only as a
legacy path until their retention deadline.

Organizers can record a speaker's dinner attendance at `/admin/dinner/`, including
after the RSVP deadline and until the retention deadline. An encrypted attendance
setting takes precedence over the original response while preserving that
response, its food notes, consent and speaker reply timestamp. Clearing the
setting restores the speaker's original response, or awaiting reply if none
exists. Manual attendance does not fabricate a speaker response or dietary
details. Each speaker card links to these controls from the speaker admin page.

Dinner summaries, the caterer CSV, speaker admin and both speaker access paths
use the same effective attendance and identify organizer settings. A later
speaker save replaces the setting with the new response. Revision checks reject
stale organizer saves, including when a speaker replies concurrently. Attendance
changes appear in the private activity log without food values. Migration 0024
adds the encrypted setting and dinner revision to the existing retained record.

Changing or removing either assigned address revokes existing sessions and
outstanding magic links for that speaker. Saving the same addresses does not
unnecessarily sign the speaker out. Migration 0041 adds secondary email storage,
database uniqueness guards, and the address fingerprint on magic links to track
confirmation independently.

## Trigger

The organizer already knew each confirmed speaker's email address and wanted a
login page where speakers could request their own access instead of waiting for
manually created invitations.

## Consequences

**Positive:**

- The organizer only has to maintain the speaker-to-email mapping.
- Speakers can recover access without asking for another invitation.
- The public endpoint cannot be used to enumerate speaker addresses through
  its response body or status.
- Turnstile, D1 throttling, short expiry, and single use limit email abuse and
  replay.

**Negative:**

- The access flow depends on transactional email delivery and abuse controls.
- The 24-hour link window accommodates corporate email delays and speakers
  returning later; links remain single-use and contact changes revoke them.
- The old invitation and shared-dinner routes must be retained until their
  respective access and retention deadlines.

**Neutral:**

- Dinner information is visibly part of the workspace while remaining private
  operational data with its own consent, deadline, and retention rules.

## Alternatives Considered

### Continue organizer-sent invitations

Rejected as the primary flow because it couples access to manual delivery and
creates avoidable organizer work. It remains temporarily for compatibility.

### Put dinner fields in speaker content revisions

Rejected because dinner answers should take effect immediately, must never be
published, and do not require editorial approval.

### Match shared dinner responses to speakers by name

Rejected because names are not stable identifiers and an incorrect match could
associate sensitive food information with the wrong person.
