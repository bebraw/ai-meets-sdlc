INSERT OR IGNORE INTO canonical_speaker_content (
  speaker_id,
  content_json,
  photo_path,
  sort_order,
  updated_at,
  updated_by
) VALUES (
  'joongi-shin',
  '{"profile":{"bio":"Joongi Shin is a postdoctoral researcher at Aalto University investigating how emerging technologies and AI can support human creativity and design. His research spans human-computer interaction, user-centred design, collaborative creativity, and generative AI. He received his PhD in Industrial Design from KAIST in 2021.","devto":"","github":"","linkedin":"https://www.linkedin.com/in/joongi-shin/","name":"Joongi Shin","role":"Postdoctoral Researcher at Aalto University","scholar":"","website":"https://www.joongishin.com/","x":""},"talks":[{"abstract":"Joongi Shin will give a talk related to user interfaces. The exact title and abstract are forthcoming.","id":"joongi-shin-ui-perspective","title":"Mystery talk"}]}',
  '/assets/speakers/joongi-shin.jpg',
  10,
  '2026-09-14T00:00:00Z',
  'migration-0014'
);
