# SDLCAI 2026 talk takeaway graphics

Twenty draft images accompany the protected talk previews: a 1200 × 630 landscape
and a 1080 × 1350 portrait card for each of the ten talks. The cards use Finlandica,
the SDLCAI palette and logo, and existing speaker portraits from `assets/speakers/`.
The card footer displays `sdlcai.org`; the text handoffs include the recording
and timestamped source links for review and reuse.

`cards.json` contains the editorial headline and three concise paraphrases for
each talk. Each `takeaway` number refers to a one-based entry in that talk's
`takeaways` array in the video content library. Timestamps and source links are
derived from those entries. Headlines are editorial framing, not quotations.
The graphics focus on the speaker's engineering argument; the text handoffs
retain the full editorial qualifications for review.

Run `npm run talks:graphics:export` after changing copy, photos, fonts or layout.
The renderer is `scripts/talk-graphics.mjs`; the export command checks font and
image loading, text fit, dimensions and a 1,000,000-byte budget per PNG. It closes
the export browser when finished and does not start a development server.

Commit `exports/` and `manifest.json` with source edits. The build checks their
input version and image hashes, then copies the images, post copy and alt text
into `/admin/talk-previews/`. It also creates `takeaway-graphics.zip` with twenty
PNGs and ten text handoffs. No draft images or handoffs are copied into the public
assets directory. Review the images and their source passages before publication.
