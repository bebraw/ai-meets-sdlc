# Photo exploration concepts

Two local, interactive prototypes for choosing a direction before implementing
a production alternative to the photo bank:

- **A / The daybook** (`/timeline/`): an editorial sequence through nine chapters,
  with a sticky chapter rail, large photographs and horizontal filmstrips.
- **B / The photo atlas** (`/atlas/`): a scrollable, draggable wall arranged by
  capture time and three thematic lanes, with zoom and hour jumps.

Run `npm run photos:prototypes`, then open <http://127.0.0.1:3085/>. Override the
port with `PHOTO_PROTOTYPE_PORT` if needed. The server binds only to loopback.
These files are outside the production site's routes and asset directory.

Both use the live **anonymous public** catalog and existing public image
derivatives. No private organizer metadata, original files, email, uploads,
curation changes or new Cloudflare resources are involved. Both start with
highlights; the full public collection, photographer filters, thematic lenses,
photo previews, keyboard navigation, fullscreen, sharing-copy downloads and
links back to the current media bank work. Photographer credit and CC BY 4.0
remain visible. Theme preference is stored under a separate prototype key.

Chapter boundaries are rounded Finnish local times from the recording-verified
programme. They express time context rather than identity in the photograph.
The atlas uses capture time horizontally and curated categories vertically;
nearby frames stack, with hover/focus bringing a card forward.

The timeline is the chosen direction. Its second iteration adds:

- Search across speaker names, talk titles, captions, tags and photographers,
  ignoring case and accents.
- Speaker programme and talk filters, plus eight topic threads. These intersect
  with the existing lenses, collection and photographer controls.
- Talk titles and speaker programme links alongside frames, with further talk
  and topic exploration inside the preview.
- Links into the livestream at a frame's calibrated capture time for talks and
  panels, and URLs that retain discovery filters and the current chapter.

Speaker discovery uses reviewed talk links where available, otherwise programme
timing. It never treats a scheduled speaker as a confirmed person in a photo;
the public catalog currently has no confirmed person tags. Time-based matches
are identified in preview context. Topic threads group existing photo tags;
they do not add inferred tags to the catalog. No public archive total is shown.

Useful things to try:

1. Find a panel photo, then something from a break.
2. Follow a photographer through the day.
3. Switch to the sponsor or branded-beer lens.
4. Compare highlights with the full public collection.
5. Open a preview and move through neighboring moments with the arrow keys.

Try searching for `Sini Tistelgren`, selecting a talk, or following **Generative
UI**. Open a frame, follow a programme or topic link, and reload a filtered URL.
The earlier atlas remains available for comparison. These are local concepts,
not finished production navigation.
