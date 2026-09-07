# SDLCAI 2026 social promotion

Ready-to-upload feed graphics for the 13 October 2026 seminar. The designs use
the site's dark palette (`#101010`, `#f6f4ef`, `#b7b0a4`), Finlandica fonts,
official square logo, and halftone texture.

## Upload files

| Placement                            | PNG                                                          | Dimensions  |
| ------------------------------------ | ------------------------------------------------------------ | ----------- |
| Bluesky or X feed                    | [sdlcai-2026-bsky-x.png](exports/sdlcai-2026-bsky-x.png)     | 1600 × 900  |
| Facebook landscape feed              | [sdlcai-2026-facebook.png](exports/sdlcai-2026-facebook.png) | 1200 × 630  |
| Square feed post on any of the three | [sdlcai-2026-square.png](exports/sdlcai-2026-square.png)     | 1080 × 1080 |

Use one image per post. Each composition has been laid out for its own aspect
ratio. All three exports stay below a conservative 1,000,000-byte file budget.

[Preview all formats](exports/sdlcai-2026-preview.png).

## Suggested post copy

AI across the full software development lifecycle. Join industry practitioners
and researchers at SDLCAI on 13 October 2026, at Marsio, Aalto University, Espoo.
Explore the program and get tickets: https://sdlcai.org/ #SDLCAI

## Alt text

SDLCAI — AI meets SDLC. A one-day seminar bringing together industry and
research on AI across the full software development lifecycle. 13 October 2026,
Marsio, Aalto University, Espoo, Finland. Program and tickets: sdlcai.org.
Warm-white typography on a charcoal background with a bold date panel.

## Edit and export

Editable SVG masters are in [source/](source/). Edit the text and layout there,
then regenerate the PNGs and preview from the repository root:

```sh
npm run social:export
```

The exporter uses the project's Playwright dependency and Chromium. If Chromium
is not already installed, run `npx playwright install chromium`. An existing
Chromium-compatible browser can also be selected with `LAYOUT_BROWSER_PATH`.

Keep the SVGs in this folder structure so their relative font and logo links
resolve. PNG uploads are self-contained. The exporter checks brand-font loading,
logo decoding, text fit, and output size before completing.

## Website Open Graph image

The site publishes `exports/sdlcai-2026-facebook.png` at `/og.png` and the
existing per-page OG paths. `scripts/og-image-plugin.mjs` copies the PNG without
re-rendering it, so production builds need neither installed Finlandica fonts
nor Chromium. The old SVG rasterizer depended on system fonts, causing wider
fallback text to overlap the date panel on production.

After editing this graphic, run `npm run social:export` and commit the updated
PNG. Bump the OG image version in `site/layouts/BaseLayout.html`,
`site/dataSources.ts`, and `scripts/verify-build-output.mjs` when changing it so
new shares request the updated image. The build verifier checks image dimensions,
page metadata, and that every generated OG image matches this PNG exactly.

The existing Bluesky and LinkedIn profile headers remain in this directory's
root. Presentation-derived social images use the separate
`npm run slides:export:social` command.
