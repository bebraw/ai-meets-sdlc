# Speaker PDF conversions

The four PDFs in `conversions.json` were converted on 15 October 2026 and attached
to production `speaker_slides` records in D1, with their files in the private
`ai-meets-sdlc-speaker-uploads` R2 bucket. The manifest records the resulting
file identities and SHA-256 hashes for verification.

D1 remains the canonical store for current attachments, sharing permission, and
publication state. The manifest preserves the conversion history while D1 can
receive later uploads and publication changes. Deployments resolve the live
attachments from D1.

Local copies are in `output/pdf/speaker-slides/`, which Git ignores. Publish a
permitted PDF through the admin speaker workspace when post-event materials are
ready. The original PowerPoints and existing web links remain attached.

All eight current PDFs were approved by the organizer and published on
15 October 2026. `publications.json` records the exact files, hashes, and public
URLs at publication. This includes the four original speaker PDFs and the four
conversions below. Later replacements still require publication through the
admin speaker workspace; the approval applies to these recorded files.

The schedule lists materials near the top and beneath each talk title. Admins
can classify external links as presentations or related resources, and add
recording links when edited videos are ready. Recording links appear as
**Watch talk** in both places.

## Conversion notes

| Speaker         | Source                    | PDF pages | Notes                                                                                                                        |
| --------------- | ------------------------- | --------: | ---------------------------------------------------------------------------------------------------------------------------- |
| Joongi Shin     | PowerPoint                |        51 | Source fonts and all visible slides preserved.                                                                               |
| Jussi Hacklin   | PowerPoint                |         8 | Source Jost fonts used for the export.                                                                                       |
| Muhammad Waseem | PowerPoint                |        29 | Two hidden slides omitted. Original confidentiality footer preserved.                                                        |
| Mo Khazali      | Animated web presentation |       161 | Blank opening frame omitted; videos and animations become still frames. Searchable text and ten section bookmarks preserved. |

The PowerPoints were exported with LibreOffice 26.8.1 using the source fonts.
Mo's presentation was exported from its settled frames in Chrome and compressed
with Ghostscript while retaining native pages containing emoji. Every final PDF
page was visually reviewed. Each file is below the 50 MiB upload limit.

Mo's source marks the chart on PDF page 122 as a placeholder. The chart is
preserved for post-production review. Its
[animated source](https://sdlcai-1978-film.mojavad.workers.dev/) remains available.

## Verify an attachment

Look up the current PDF row by `talk_id` and `format = 'pdf'` in production D1.
Compare its `slide_id`, `r2_key`, `byte_size`, and `content_hash` with the manifest.
Download the matching R2 object and verify its SHA-256 hash against both D1 and
the manifest. Matching object bytes and attachment hashes establish the identity
of the reviewed conversion.
