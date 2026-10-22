# SDLCAI 2026 video release

The approved release contains the revised event highlights, ten talks and three
Q&A sessions. The user authorized public publication after the audio check.

- [YouTube channel](https://www.youtube.com/@SDLCAI)
- [Seminar playlist](https://www.youtube.com/playlist?list=PLA44jDnIP4sk)
- [Archived programme](https://www.sdlcai.org/2026/schedule/)

`release.json` preserves the titles, descriptions, chapters, source paths,
caption and thumbnail files, playlist order, YouTube IDs and publication state.
Upload the 4K masters, rather than the smaller review proxies. The playlist starts
with `mood-v07-4k.mp4`, followed by the talks and Q&A sessions in seminar order.
The 14 masters total approximately 199 GB.

## Audio check

`audio-audit.json` records the technical source and final-master checks;
`audit_audio.py` reproduces the sampled comparisons. No remix was needed.

The original camera recordings contain AAC audio at 48 kHz across eight channels.
The primary camera's first two channels carry the complete programme mix; its
other channels are silent. The secondary camera contains the same programme
feed alongside individual microphones. Its higher aggregate bitrate covers more
active channels and does not identify a better complete stereo recording.
No original uncompressed programme master was found among the available files.

All 13 spoken masters use the selected programme feed through 48 kHz, 24-bit
stereo WAV intermediates and final AAC-LC encoding configured at 384 kbps. Actual
average AAC bitrate varies with the signal. Across 39 sampled windows, the final
4K masters matched their WAV intermediates with no measured timing offset and
a minimum correlation of 0.999987. No clipped samples were found in the sampled
primary programme channels.

The revised highlights master retains the approved audio unchanged: all 6,001
AAC packets and their timestamps match the accepted previous version. Full
decoding also passed.

These are technical checks combined with the user's accepted playback review.
They do not represent a fresh listening review by the assistant or establish
perceptual quality from correlation alone.

## Archive integration

Individual talk links belong in the site's existing recording-link editor and
canonical `speaker_recording_links` table. The public schedule then displays
**Watch talk** beside the existing presentation materials. The collection-level
highlights and playlist links, and session Q&A links, live in
`site/data/recordings.json`. All fourteen URLs are approved for public release
and connected to the archive. YouTube makes the videos available automatically
when processing finishes.

All fourteen titles and descriptions were compared with their saved YouTube
Studio values; results are in `metadata-verification.json`. Current public
slide PDFs from the site were added for Ohans and Tapio, including Tapio's PDF
in the joint research Q&A description.

## YouTube release progress

Phone verification enabled long uploads and custom thumbnails. The new channel
then reached its daily upload and custom-thumbnail limits. The user completed
advanced-feature verification, and Studio confirmed all three feature tiers as
enabled. The final four uploads were accepted and all fourteen custom thumbnails
and English subtitle tracks have been saved.

All fourteen 4K transfers are complete and public publication has been requested.
The user explicitly approved publishing the final four while YouTube's content
checks were still pending. Studio confirmed that each will become public when
standard-definition processing finishes.

Transfer, processing and public publication are distinct states in `release.json`.
The archive contains the approved recording URLs, including videos still
processing on YouTube. Check per-item status before describing the whole
collection as publicly watchable.

## Release screenshots

These captures preserve the site integration as reviewed on 22 October 2026.
They are historical snapshots, rather than a current publication-status report.

- [Homepage channel link](../../../output/images/sdlcai-youtube-channel-live.png)
  shows the YouTube link beside the seminar archive.
- [First talk link](../../../output/images/sdlcai-mo-recording-live.jpg) shows
  Mo's recording during the initial archive integration, before the other talk
  links were added.
- [Archive overview](../../../output/images/sdlcai-recordings-archive-live.jpg)
  shows the recording resources, highlights and playlist links before the archive
  navigation was renamed.
- [Schedule introduction](../../../output/images/sdlcai-talks-and-qa-live.jpg)
  shows the final “Talks & recordings” navigation and links to the playlist and
  event highlights.
