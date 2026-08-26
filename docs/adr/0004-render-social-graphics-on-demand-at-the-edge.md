# ADR 0004: Render social graphics on demand at the edge

- Status: Accepted
- Date: 2026-08-26

## Context

The site build exported every presentation slide as LinkedIn, X, and Bluesky
JPEGs by launching a locally installed Chromium binary. Cloudflare Workers
Builds does not include a compatible browser, so the production build failed
after the static pages had been generated. Installing or discovering a browser
inside that build environment would couple deployment to an image detail that
the application does not control.

The promotion workspace decision also requires durable links tied to a talk,
not to the talk's current position in the schedule. Rasterization inputs are
fully determined by the generated deck, referenced assets, output preset, and
renderer contract, so unchanged graphics should not consume another browser
session after a deployment or a request from another Cloudflare location.

## Decision

Make the normal build browser-free. After generating the static site, emit a
social render manifest with stable slide IDs and a SHA-256 version for each
slide-and-preset output. Stable public filenames use the slide ID; numbered
filenames remain redirect aliases for previously shared links.

Render a versioned asset in the Worker through Cloudflare Browser Rendering
only when it is absent from both caches:

1. Redirect the stable path to its immutable `?v=<sha256>` URL.
2. Check Cloudflare's Cache API for a location-local response.
3. Check R2 for the deterministic object key shared by all locations.
4. On a current-version miss, launch Browser Rendering, intercept every browser
   request, fulfill only the generated deck and allowlisted static assets from
   the deployment's `ASSETS` binding, and block other network access.
5. Verify the active slide, viewport dimensions, decoded images, and output
   byte limit before writing the JPEG to R2 and the Cache API.
6. Close the browser in a `finally` block and return a retryable `503` if the
   render fails.

The version for one output incorporates the exact slide HTML, bytes of assets
referenced by that slide, shared deck dependencies, preset, and renderer
contract. A local export command remains available for visual review, but it is
not part of the production build.

## Consequences

- Workers Builds no longer needs Chromium and does not spend build time
  regenerating 69 JPEGs.
- A talk-title, speaker-photo, or other slide-local change invalidates only the
  affected slides; shared layout, script, font, or renderer changes invalidate
  all dependent outputs.
- Cache API hits avoid an R2 read in a warm location, while R2 makes the first
  successful render reusable across locations and deployments.
- Stable slide-ID paths survive schedule reordering, while content-addressed
  URLs can be cached for a year as immutable.
- The deployment requires a Browser Rendering binding and a separate R2 bucket.
- Simultaneous first requests can still race and perform duplicate renders;
  this bounded cold-start cost does not justify Durable Object coordination at
  the current 69-asset scale. R2 remains the authoritative result after either
  render completes.
- Old versioned graphics remain in R2 until an explicit lifecycle decision is
  made, preserving previously shared links at a small storage cost.

## Alternatives considered

### Install Chromium in Workers Builds

Rejected because the build image does not promise a compatible browser and the
deployment would continue to regenerate every output even when inputs were
unchanged.

### Commit generated JPEGs to the repository

Rejected because it adds large derived binaries, merge churn, and a manual
requirement to keep source data and promotional outputs synchronized.

### Render every graphic after each deployment

Rejected because known content hashes provide a more precise invalidation key.
Eager warming may be added operationally later, but it should request the same
manifest URLs and therefore use the same cache contract.

### Coordinate every miss with a Durable Object

Deferred because it adds another stateful component to eliminate only rare,
bounded first-request races. Reconsider if render concurrency or cost becomes
material.
