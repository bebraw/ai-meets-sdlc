# SDLCAI 2026 YouTube stream package

## Channel branding

The evergreen channel graphics use the official logo and Finlandica fonts:

- `exports/sdlcai-channel-banner-v01.png` — 2560 × 1440 banner, with essential
  content inside the central all-devices crop.
- `exports/sdlcai-channel-profile-v01.png` — 800 × 800 picture, padded for the
  circular profile crop.
- `exports/sdlcai-channel-watermark-v01.png` — 150 × 150 video watermark, set
  to appear at the end of videos.

Editable SVGs are in `source/` and are included in `npm run youtube:export`.
The channel uses the SDLCAI name and `@SDLCAI` handle, with links to
<https://sdlcai.org/> and <https://sdlcai.org/2026/>. The business contact matches
the public contact page: `info@futurefrontend.com`.

Historical setup screenshots accompany the graphics:

- [Studio preview](exports/sdlcai-channel-studio-preview-v01.png) shows the
  banner, profile picture and channel details before publication.
- [Published channel](exports/sdlcai-channel-published-v01.png) shows the
  branding in place before the seminar recordings were uploaded.

## Recommended title

SDLCAI 2026 — AI Meets SDLC | Live from Aalto University

## Description

Join SDLCAI live from Marsio at Aalto University in Espoo, Finland, on 13 October 2026.

SDLCAI is a focused one-day seminar about what happens when AI moves beyond isolated coding assistants and into the full software development lifecycle. Expect concrete industry cases, research-driven perspectives, technical judgement, and direct discussion about engineering quality, adoption, evaluation, governance, testing, developer experience, and organizational change.

Announced speakers include Mo Khazali, Ohans Emmanuel, Jenni Kylmäkoski, Jussi Hacklin, Viljami Kuosmanen, Zak Allal, Sini Tistelgrén, Dr Muhammad Waseem, and Tapio Pitkäranta.

PROGRAM — ESPOO LOCAL TIME (UTC+3)

08:50 Opening  
09:00 Industry perspectives  
10:30 Break  
11:00 Views from academia  
12:30 Lunch and posters  
13:30 Views from industry  
15:00 Afternoon break  
15:30 Academia  
17:00 Wrap-up

The program is subject to change. See the latest schedule and speaker details on the event website.

Event: https://sdlcai.org/  
Schedule: https://sdlcai.org/schedule/  
Speakers: https://sdlcai.org/speakers/

SDLCAI is organized by Toska Osuuskunta, the cooperative behind Future Frontend, React Finland, and GraphQL Finland.

#SDLCAI #SoftwareEngineering #ArtificialIntelligence

## Graphics

- `exports/sdlcai-2026-thumbnail.png` — 3840 × 2160 YouTube thumbnail
- `exports/sdlcai-2026-starting-soon.png` — 1920 × 1080 pre-stream slate
- `exports/sdlcai-2026-short-break.png` — 1920 × 1080 break slate
- `exports/sdlcai-2026-thanks.png` — 1920 × 1080 end slate

Editable SVG masters are in `source/`. Re-export all PNGs with:

```sh
npm run youtube:export
```

The package follows the site's dark palette, Finlandica type system, and official square logo from `assets/logo.svg`.
