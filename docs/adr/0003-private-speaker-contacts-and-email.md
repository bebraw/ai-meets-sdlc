# ADR 0003: Keep speaker contacts private and use transactional email

- Status: Accepted
- Date: 2026-08-26

## Context

Organizers need to store speaker email addresses, send private workspace
invitations, and contact confirmed speakers about deadlines, event logistics,
available social graphics, and optional promotional-video submissions.

The current public speaker data is version controlled, included in static build
artifacts, and imported into the Worker bundle. It is therefore not an
appropriate location for private contact information. The application already
uses AES-GCM ciphertext plus purpose-specific keyed HMAC fingerprints for other
private D1 records.

Cloudflare Email Service separates outbound Email Sending from inbound Email
Routing. Email Sending is intended for transactional messages and notifications,
not newsletters or marketing campaigns.

## Decision

Store speaker contact details in private D1 tables, separate from public speaker
profiles. At minimum, `speaker_contacts` contains:

- `speaker_id` as its stable key;
- normalized email encrypted with AES-GCM and its IV;
- a purpose-specific keyed HMAC fingerprint for equality and duplicate checks;
- verification, eligibility, creation, update, and retention timestamps.

Do not put plaintext email addresses in public JSON, generated assets, analytics
events, application logs, or routine delivery-history rows. An email change is
not active until the new address has been verified.

Use a Worker `send_email` binding for one separately addressed message per
speaker. Restrict the binding to the selected `sdlcai.org` sender address. Every
message has both text and HTML bodies, a recognizable sender, and a reply-to
address. Use Email Routing to forward replies from the domain address to an
organizer-controlled, verified destination.

Provide organizer workflows for:

- sending or deliberately rotating a private portal invitation;
- selecting active speakers and composing an operational announcement;
- previewing both bodies and sending a test message;
- confirming the recipient count before sending;
- recording a campaign and per-speaker delivery result;
- retrying transient failures without resending successful deliveries;
- suppressing addresses that have opted out, hard-bounced, or complained.

Creating an invitation and sending it are one organizer action. Only a hash of
the long-lived capability is retained after creation. Ordinary announcements do
not contain or rotate that capability. A future passwordless login flow should
use a short-lived, single-use token and an HttpOnly session.

Use Cloudflare Email Sending only for messages arising from the speaker's event
relationship, such as access, deadlines, program review, logistics, and speaker
promotion tasks. A newsletter, sponsor promotion, or broader marketing campaign
requires a dedicated campaign provider and a separate opt-in and unsubscribe
model.

Document speaker-contact processing, service providers, communication purposes,
access, correction, and retention in the privacy policy. Operational and
optional promotional communication preferences remain separate even when they
share the same address.

## Consequences

- Private contact details do not leak into Git history, public build output, or
  the Worker bundle.
- Existing application-level encryption and keyed lookup primitives can be
  reused with new purpose strings.
- Domain onboarding must establish the Cloudflare-provided SPF, DKIM, DMARC,
  and bounce records, and arbitrary-recipient sending requires an eligible
  Cloudflare plan.
- The Worker needs an email binding, delivery APIs, templates, admin UI, and
  bounce/complaint synchronization.
- The current shared admin authentication cannot attribute sends to an
  individual organizer; stronger organizer identity is needed if that audit
  distinction becomes necessary.
- Marketing remains deliberately outside the application email capability.

## Alternatives considered

### Add email to `speakers.json`

Rejected because the file is public, version controlled, used at build time,
and imported by the deployed Worker.

### Export a CSV and send all messages manually

Rejected as the normal workflow because it spreads plaintext contact data,
does not connect invitations to the correct speaker identity, and provides no
reliable per-recipient status or suppression handling. A controlled export may
remain an emergency administrative tool.

### Use Cloudflare Email Sending for newsletters and marketing

Rejected because the service is limited to transactional email. If that product
boundary changes, adopting campaign functionality still requires a separate
consent and unsubscribe decision.
