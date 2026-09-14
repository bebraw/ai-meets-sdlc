# SDLCAI 2026 email headers

Mailjet-ready PNG graphics matching the existing event identity.

| Graphic | Export | Dimensions | Display at |
| --- | --- | --- | --- |
| Full event header | [PNG](exports/sdlcai-2026-header.png) | 1200 × 600 | 600 × 300 |
| Compact header | [PNG](exports/sdlcai-2026-header-compact.png) | 1200 × 320 | 600 × 160 |

[Preview both headers](exports/sdlcai-2026-preview.png).

Upload one PNG to an image block in your Mailjet promo. Use the full content
width, preserve its aspect ratio, and link the image to https://sdlcai.org/.
The exports provide 2× resolution at a 600-pixel display width. Use the compact
version when the email body already introduces the event.

Suggested alt text for either image:

> SDLCAI — AI meets SDLC. 13 October 2026. Marsio, Aalto University, Espoo.

Repeat the date and venue in the email body, and add a live text link or button
for the program and tickets so the essential information is available with
images disabled.

## Edit and export

Editable SVG masters are in [source/](source/). They use the official logo and
local Finlandica fonts. No AI-generated artwork was used; these extend the
existing native SVG promo designs.

From the repository root:

```sh
npm run email:export
```

The exporter uses Playwright Chromium, checks font loading, logo decoding,
text safe areas, and a 500 KB budget per header, and regenerates the preview.
An existing browser can be selected with `LAYOUT_BROWSER_PATH`.
