INSERT OR IGNORE INTO canonical_speaker_content (
  speaker_id,
  content_json,
  photo_path,
  sort_order,
  updated_at,
  updated_by
) VALUES (
  'juho-vepsalainen',
  '{"profile":{"bio":"Juho Vepsäläinen is an SDLCAI organizer using this private account to test the speaker workspace before inviting the event speakers.","devto":"","github":"","linkedin":"","name":"Juho Vepsäläinen","role":"SDLCAI organizer / test account","scholar":"","website":"","x":""},"talks":[{"abstract":"This private placeholder lets the organizer exercise the complete speaker workflow without adding a session to the official program.","id":"juho-vepsalainen-test-session","title":"Private test session"}]}',
  '/assets/organizers/juho.webp',
  9,
  '2026-09-04T00:00:00Z',
  'migration-0011'
);
