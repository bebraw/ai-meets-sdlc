# Video analysis archive

The `2026-10-22` snapshot covers the 14 final SDLCAI 2026 deliveries in
`metadata/upload-package-final-v08.json` in the external post-production archive.
It contains summaries, takeaways, quotation and clip candidates, cross-session
themes, attribution evidence, and the saved Whisper and Parakeet results.

Start with `2026-10-22/content-library.json`. The selected wording and reasons are
in `2026-10-22/editorial-choices.json`; `validation-report.json` records the checks.
Earlier review reports retain the findings at each pass, including ambiguities
subsequently resolved by editorial choice. Direct listening was not performed.
The final Q&A quotation uses a session label because its individual speaker is
unconfirmed. Contextual corrections are lightly edited wording, not verified
verbatim transcription.

`sources/` preserves caption snapshots and metadata; `items/` holds the initial
editorial inputs. `assemble_library.py` assembles those inputs and applies the
review passes in order. The scripts use `library_tools.ROOT` for the external
archive and require the original media, FFmpeg, and the locally installed ASR
tools when regenerating extracts or recognition results. They are local editorial
utilities and are not part of the site build.

All timestamps refer to the final edited videos, with title cards included.
Audio extracts, sampled images, logs, and Python caches remain local and are
ignored. No source media or captions were changed by this analysis.

All fourteen public YouTube URLs and start-time links were added on 23 October
2026, including chapters, takeaways, quotations, clips and cross-session evidence.
Run `python3 output/video-analysis/2026-10-22/public_links.py` to refresh these
links from the release manifest and regenerate `page-blocks.json`; the external
media drive is not needed. Local review links remain available for editing.
The protected content inventory at `/admin/content-inventory/` uses this library
at build time. Editorial candidates are not embedded in public JavaScript.
