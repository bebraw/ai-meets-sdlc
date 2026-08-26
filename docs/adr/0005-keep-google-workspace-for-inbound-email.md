# ADR 0005: Keep Google Workspace for inbound email

- Status: Accepted
- Date: 2026-08-26
- Supersedes: ADR 0003 for inbound reply handling only

## Context

ADR 0003 selected Cloudflare Email Routing to forward replies sent to the
application's outbound address. The domain already has a real
`info@sdlcai.org` mailbox hosted by Google Workspace, so forwarding is
unnecessary and would compete with Google's root-domain MX records.

Cloudflare Email Sending and Email Routing are independent services. Email
Sending authenticates outbound application mail with records under the
`cf-bounce` subdomain, while Google Workspace can continue to own inbound mail
delivery and the root-domain email records.

## Decision

Keep Google Workspace as the inbound provider for `sdlcai.org`. The public
sender and reply-to address remains `SDLCAI <info@sdlcai.org>`, and replies are
delivered directly to that Google-hosted mailbox.

Use Cloudflare Email Sending only for transactional application messages. Keep
its `cf-bounce` MX, SPF, and DKIM records separate from Google's root-domain MX,
SPF, and DKIM records. Do not enable Cloudflare Email Routing for the domain.

The future Worker `send_email` binding remains restricted to
`info@sdlcai.org`. Both Cloudflare-generated application messages and messages
sent manually from Google Workspace must remain authenticated and aligned with
the domain's DMARC policy.

All other contact privacy, verification, announcement scope, suppression, and
delivery-audit decisions in ADR 0003 remain in force.

## Consequences

- Speakers can reply to the same recognizable address that sent the message.
- Organizers can receive and answer replies in the existing Google mailbox.
- No forwarding destination, routing rule, or inbound Email Worker is needed.
- Root-domain MX changes must continue to be managed as Google Workspace
  infrastructure; enabling Cloudflare Email Routing would conflict with it.
- Cloudflare Email Sending can be changed or removed independently without
  changing inbound Google delivery.

## Alternatives considered

### Forward `info@sdlcai.org` through Cloudflare Email Routing

Rejected because a hosted Google mailbox already exists and should receive mail
directly. Forwarding adds another delivery hop and requires Cloudflare to own
the root-domain MX records.

### Use an external organizer address as reply-to

Rejected because it exposes a different address and prevents the established
`info@sdlcai.org` mailbox from being the consistent public contact point.

### Make application email one-way

Rejected because `info@sdlcai.org` implies that replies are welcome, and silent
drops or bounced replies would be a poor speaker experience.
