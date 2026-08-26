# ADR 0006: Speaker-initiated magic-link access

- Status: Accepted
- Date: 2026-08-26
- Supersedes: The organizer-sent invitation flow in ADR 0003

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

The organizer assigns one email address to each canonical speaker in the admin
interface. Saving the mapping does not send mail. A speaker visits `/speaker/`,
enters that address, completes Turnstile when configured, and receives a
short-lived, single-use magic link from `info@sdlcai.org`.

Login requests use a generic accepted response for both mapped and unmapped
addresses. Keyed fingerprints, rather than plaintext addresses or IP
addresses, support per-address and per-client throttling in D1. Magic-link
tokens are generated with Web Crypto, stored only as keyed hashes, expire after
15 minutes, and are consumed before a session is issued. The existing
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

Changing a speaker's assigned email revokes existing sessions and outstanding
magic links for that speaker. Saving the same email does not unnecessarily sign
the speaker out.

## Consequences

- The organizer only has to maintain the speaker-to-email mapping.
- Speakers can recover access without asking for another invitation.
- The public endpoint cannot be used to enumerate speaker addresses through
  its response body or status.
- Turnstile, D1 throttling, short expiry, and single use limit email abuse and
  replay.
- Dinner information is visibly part of the workspace while remaining private
  operational data with its own consent, deadline, and retention rules.
- The old invitation and shared-dinner routes can be removed after their
  respective access and retention deadlines.

## Alternatives considered

### Continue organizer-sent invitations

Rejected as the primary flow because it couples access to manual delivery and
creates avoidable organizer work. It remains temporarily for compatibility.

### Put dinner fields in speaker content revisions

Rejected because dinner answers should take effect immediately, must never be
published, and do not require editorial approval.

### Match shared dinner responses to speakers by name

Rejected because names are not stable identifiers and an incorrect match could
associate sensitive food information with the wrong person.
