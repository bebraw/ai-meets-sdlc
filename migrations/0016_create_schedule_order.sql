CREATE TABLE schedule_order (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  groups_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL
);

INSERT INTO schedule_order (id, groups_json, updated_at) VALUES (
  1,
  '[{"id":"industry-perspectives-morning","talkIds":["mo-khazali-industry-perspective","ohans-emmanuel-industry-perspective","jenni-kylmakoski-industry-perspective"]},{"id":"views-from-academia","talkIds":["genai-software-engineering","agentic-discovery","joongi-shin-ui-perspective"]},{"id":"views-from-industry","talkIds":["driving-ai-adoption-regulated-environment","non-engineers-vibe-code-production","ai-factory-fundamentals"]},{"id":"academia","talkIds":["zak-allal-industry-perspective"]}]',
  '2026-09-14T00:00:00Z'
);
