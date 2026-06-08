# SDLCAI

Website for the SDLCAI seminar, held 13 October 2026 at Marsio Saastamoinen Foundation Stage, Espoo, Finland.

The site is built with Gustwind and HTMLisp, styled with Tailwind CSS, and
deployed as a Cloudflare Worker with static assets. The production domain is
`sdlcai.org`.

## Project Structure

- `site/layouts/index.html`: main page markup and client-side behavior.
- `site/tailwind.css`: font faces, Tailwind theme variables, and global styles.
- `assets/`: logo, favicon, fonts, and referenced media.
- `worker/index.ts`: Cloudflare Worker, Stripe Checkout endpoint, interest form
  endpoint, Stripe webhook order tracking, and scheduled backups.
- `migrations/`: D1 schema.
- `scripts/`: local helper scripts for dotenv, backup decryption, and build
  verification.

## Documentation

- [Development](docs/development.md): local setup, Worker development, ticket
  sales, and export helper commands.
- [Cloudflare setup](docs/cloudflare.md): provisioning, secrets, backup, and
  deployment notes.
- [Feature flags](docs/feature-flags.md): runtime flags and checkout provider
  configuration.
- [Stripe testing](docs/stripe-testing.md): Stripe Checkout and webhook testing
  instructions.

## Deployment

Deploy through Cloudflare Workers Builds or locally with:

```bash
npm run deploy
```

See [Cloudflare setup](docs/cloudflare.md) for provisioning, secrets, backup, and
deployment notes.
