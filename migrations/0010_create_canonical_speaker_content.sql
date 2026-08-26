CREATE TABLE IF NOT EXISTS canonical_speaker_content (
  speaker_id TEXT PRIMARY KEY,
  content_json TEXT NOT NULL,
  content_version INTEGER NOT NULL DEFAULT 1 CHECK (content_version > 0),
  photo_path TEXT NOT NULL,
  photo_r2_key TEXT,
  photo_content_hash TEXT,
  photo_version INTEGER NOT NULL DEFAULT 1 CHECK (photo_version > 0),
  last_content_revision_id TEXT,
  last_photo_revision_id TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CHECK (
    (photo_r2_key IS NULL AND photo_content_hash IS NULL) OR
    (photo_r2_key IS NOT NULL AND photo_content_hash IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_speaker_content_sort_order_idx
  ON canonical_speaker_content (sort_order);

ALTER TABLE speaker_content_revisions
  ADD COLUMN base_content_version INTEGER;

UPDATE speaker_content_revisions
   SET base_content_version = 1
 WHERE base_content_version IS NULL;

CREATE INDEX IF NOT EXISTS speaker_content_revisions_base_version_idx
  ON speaker_content_revisions (speaker_id, base_content_version);

INSERT OR IGNORE INTO canonical_speaker_content (
  speaker_id,
  content_json,
  photo_path,
  sort_order,
  updated_at,
  updated_by
) VALUES
  (
    'mo-khazali',
    '{"profile":{"bio":"Mo Khazali is Group Associate Partner at Theodo. Over the last three years, he has led teams as Head of Mobile and Solutions Architect, helping deliver high-impact products while scaling engineering practices across clients and developer communities. He has spoken at dozens of international conferences, hosted React Native London, and now focuses on how organisations can use AI to migrate between technology stacks in ways that are verifiable, safe, and efficient.","devto":"","github":"","linkedin":"https://www.linkedin.com/in/mohammadkhazali/","name":"Mo Khazali","role":"Group Associate Partner at Theodo","scholar":"","website":"","x":"https://x.com/mo__javad"},"talks":[{"abstract":"Mo Khazali shares an industry perspective on applied AI in software development. The exact topic of his talk is still to be decided.","id":"mo-khazali-industry-perspective","title":"Mystery talk"}]}',
    '/assets/speakers/mo-khazali.webp',
    0,
    '2026-08-26T00:00:00Z',
    'migration-0010'
  ),
  (
    'ohans-emmanuel',
    '{"profile":{"bio":"Ohans Emmanuel is the co-founder and CEO of Coldtea.ai and a technical author with more than five published books. Since 2017, he has written extensively about software and product development, with his work reaching more than five million readers. He specialises in turning complex problems into simple, reliable systems and building delightful user interfaces that hold up in the real world.","devto":"","github":"https://github.com/ohansemmanuel","linkedin":"https://www.linkedin.com/in/ohans-emmanuel/","name":"Ohans Emmanuel","role":"Co-founder & CEO, Coldtea.ai","scholar":"","website":"https://coldtea.ai/","x":""},"talks":[{"abstract":"Ohans Emmanuel shares an industry perspective on applied AI in software development. The exact topic of his talk is still to be decided.","id":"ohans-emmanuel-industry-perspective","title":"Mystery talk"}]}',
    '/assets/speakers/ohans-emmanuel.webp',
    1,
    '2026-08-26T00:00:00Z',
    'migration-0010'
  ),
  (
    'jenni-kylmakoski',
    '{"profile":{"bio":"Jenni Kylmäkoski is an R&D leader at Nokia with experience in agile coaching, training, and product development leadership. Her work focuses on building motivated, high-performing teams and improving large R&D organisations through agile methods, DevOps, coaching leadership, continuous improvement, and collaboration across organisational boundaries.","devto":"","github":"","linkedin":"https://www.linkedin.com/in/jennikylmakoski/","name":"Jenni Kylmäkoski","role":"R&D Leader at Nokia","scholar":"","website":"","x":""},"talks":[{"abstract":"Jenni Kylmäkoski shares an industry perspective on applied AI in software development. The exact topic of her talk is still to be decided.","id":"jenni-kylmakoski-industry-perspective","title":"Mystery talk"}]}',
    '/assets/speakers/jenni-kylmakoski.webp',
    2,
    '2026-08-26T00:00:00Z',
    'migration-0010'
  ),
  (
    'jussi-hacklin',
    '{"profile":{"bio":"Jussi Hacklin has more than 20 years of experience leading technology and business organisations, creating digital services and products in-house and for clients across multiple industries. His background spans technology business creation, sales, product management, product development, agile transformation, piloting, and software development. He is a co-founder of Mideum, advises selected companies on technology and leadership, and was the first Finnish graduate of the University of Cambridge Judge CTO Programme.","devto":"","github":"","linkedin":"https://www.linkedin.com/in/jussihacklin/","name":"Jussi Hacklin","role":"Chief of Software Engineering at Elisa","scholar":"","website":"","x":""},"talks":[{"abstract":"How Elisa drove AI adoption across the SDLC beyond expectations through leadership, tooling, communities, and shared practices. The talk also covers how governance continues to evolve to manage costs in the new era of token-based development, while operating critical infrastructure under high levels of regulation.","id":"driving-ai-adoption-regulated-environment","title":"Driving AI adoption above targets in highly regulated environment"}]}',
    '/assets/speakers/jussi-hacklin.webp',
    3,
    '2026-08-26T00:00:00Z',
    'migration-0010'
  ),
  (
    'viljami-kuosmanen',
    '{"profile":{"bio":"Viljami Kuosmanen is a distinguished engineer and product engineer with more than 15 years of experience. Previously Head of Engineering at epilot, he scaled SaaS teams from early stage to more than 45 engineers while sustaining over 50% year-on-year MRR growth. His work spans SaaS, cloud, and AI, and his open-source libraries have been adopted by companies including AWS, GitHub, SAP, IBM, and Intel. He is the author of the [Product Engineer Manifesto](https://productengineer.org/), which encourages engineers to move beyond code into end-to-end product ownership.","devto":"https://dev.to/anttiviljami","github":"","linkedin":"https://www.linkedin.com/in/anttiviljami/","name":"Viljami Kuosmanen","role":"Distinguished Engineer at ePilot GmbH","scholar":"","website":"https://viljami.io/","x":""},"talks":[{"abstract":"In February, Viljami handed AI coding agents to every PM, designer, and support rep at epilot, then opened the whole codebase to them. He expected a few translation fixes. Instead, they shipped thousands of PRs: hundreds from people who had never written code, with dozens still contributing every week. Engineers review and merge, features go to customers, designers ship real UI, PMs ship features they had waited months for, and customer success builds its own tools. This talk shares what they learned, the guardrails they put in place, the parts that broke, and the day someone pushed unreviewed code to production.","id":"non-engineers-vibe-code-production","title":"I Let Non-Engineers Vibe-Code Our Production Codebase"}]}',
    '/assets/speakers/viljami-kuosmanen.webp',
    4,
    '2026-08-26T00:00:00Z',
    'migration-0010'
  ),
  (
    'zak-allal',
    '{"profile":{"bio":"Zak Allal is a physician and AI engineer working at the intersection of medicine, advanced technology, strategic intelligence, and the arts. His technical work spans secure AI architectures, full-stack systems engineering, cybersecurity, and applied AI. He is also a pianist and composer who has performed at Carnegie Hall.","devto":"","github":"","linkedin":"https://www.linkedin.com/in/zakallal","name":"Zak Allal","role":"Physician and AI Engineer","scholar":"","website":"https://www.zakallal.com/","x":"https://x.com/ZakAllalMD"},"talks":[{"abstract":"Zak Allal shares an industry perspective on applied AI in software development. The exact topic of his talk is still to be decided.","id":"zak-allal-industry-perspective","title":"Mystery talk"}]}',
    '/assets/speakers/zak-allal.webp',
    5,
    '2026-08-26T00:00:00Z',
    'migration-0010'
  ),
  (
    'sini-tistelgren',
    '{"profile":{"bio":"Sini Tistelgrén is Co-Founder, COO & Tech Lead at Aimbition. She has nearly 15 years of experience in IT, leading teams, shaping strategy, driving AI initiatives, and managing complex multi-vendor projects. Her work focuses on making AI adoption in software engineering practical and human-centred by aligning people, technology, and processes.","devto":"","github":"","linkedin":"https://www.linkedin.com/in/stistelgren/","name":"Sini Tistelgrén","role":"Co-Founder, COO & Tech Lead at Aimbition","scholar":"","website":"","x":""},"talks":[{"abstract":"Sini Tistelgrén shares an industry perspective on applied AI in software development. The exact topic of her talk is still to be decided but it will be related to AI factories.","id":"ai-factory-fundamentals","title":"AI Factory doesn''t eliminate the fundamentals – it just hides what''s missing, until it''s too late."}]}',
    '/assets/speakers/sini-tistelgren.webp',
    6,
    '2026-08-26T00:00:00Z',
    'migration-0010'
  ),
  (
    'muhammad-waseem',
    '{"profile":{"bio":"Dr Muhammad Waseem is the Vice Head of GPT Lab at Tampere University. His research focuses on software engineering, generative AI, software architecture, and AI-assisted software development. He is currently supervising PhD and master’s students and has authored more than 90 research papers published in leading software engineering venues, including JSS, IST, ICSE, ECSA, and others.","devto":"","github":"","linkedin":"","name":"Dr Muhammad Waseem","role":"Vice Head of GPT Lab, Tampere University","scholar":"https://scholar.google.com/citations?user=ufGtcBUAAAAJ&hl=en","website":"https://drmwaseem.com/","x":""},"talks":[{"abstract":"This talk examines the current role of Generative AI in software engineering, moving beyond the hype around coding assistants. It discusses where GenAI is already useful, such as implementation, testing, documentation, and refactoring, and where progress remains limited, such as requirements, architecture, and long-term maintenance. The talk also highlights key open questions around measurement, verification, security, developer expertise, and the future shape of software engineering work.","id":"genai-software-engineering","title":"GenAI in Software Engineering: What Works, What Fails, What’s Next"}]}',
    '/assets/speakers/muhammad-waseem.webp',
    7,
    '2026-08-26T00:00:00Z',
    'migration-0010'
  ),
  (
    'tapio-pitkaranta',
    '{"profile":{"bio":"Tapio Pitkäranta is Head of AI Development at Siili Solutions and a PhD candidate at Aalto University researching Software Agents and Generative AI. He has over 20 years of AI experience, spanning early semantic-web agent research, healthcare analytics entrepreneurship, and senior technology leadership across retail, healthcare, tax, and HR. He has served as CTO four times, including at RELEX Solutions during its unicorn-scale growth, and now focuses on applying agentic AI, multi-agent systems, and coding agents to real software delivery.","devto":"","github":"","linkedin":"https://www.linkedin.com/in/tapio-pitkaranta/","name":"Tapio Pitkäranta","role":"Head of AI Development at Siili Solutions","scholar":"","website":"","x":""},"talks":[{"abstract":"Abstract forthcoming.","id":"agentic-discovery","title":"Agentic Discovery"}]}',
    '/assets/speakers/tapio-pitkaranta.webp',
    8,
    '2026-08-26T00:00:00Z',
    'migration-0010'
  );

UPDATE canonical_speaker_content
   SET content_json = (
         SELECT revisions.content_json
           FROM speaker_content_revisions AS revisions
          WHERE revisions.speaker_id = canonical_speaker_content.speaker_id
            AND revisions.state = 'approved'
          ORDER BY revisions.updated_at DESC, revisions.revision_id DESC
          LIMIT 1
       ),
       last_content_revision_id = (
         SELECT revisions.revision_id
           FROM speaker_content_revisions AS revisions
          WHERE revisions.speaker_id = canonical_speaker_content.speaker_id
            AND revisions.state = 'approved'
          ORDER BY revisions.updated_at DESC, revisions.revision_id DESC
          LIMIT 1
       ),
       updated_at = COALESCE(
         (
           SELECT revisions.updated_at
             FROM speaker_content_revisions AS revisions
            WHERE revisions.speaker_id = canonical_speaker_content.speaker_id
              AND revisions.state = 'approved'
            ORDER BY revisions.updated_at DESC, revisions.revision_id DESC
            LIMIT 1
         ),
         updated_at
       ),
       updated_by = 'migration-0010-approved-revision'
 WHERE EXISTS (
   SELECT 1
     FROM speaker_content_revisions AS revisions
    WHERE revisions.speaker_id = canonical_speaker_content.speaker_id
      AND revisions.state = 'approved'
 );

UPDATE canonical_speaker_content
   SET photo_r2_key = (
         SELECT photos.r2_key
           FROM speaker_photo_revisions AS photos
          WHERE photos.speaker_id = canonical_speaker_content.speaker_id
            AND photos.state = 'approved'
          ORDER BY photos.updated_at DESC, photos.photo_revision_id DESC
          LIMIT 1
       ),
       photo_content_hash = (
         SELECT photos.content_hash
           FROM speaker_photo_revisions AS photos
          WHERE photos.speaker_id = canonical_speaker_content.speaker_id
            AND photos.state = 'approved'
          ORDER BY photos.updated_at DESC, photos.photo_revision_id DESC
          LIMIT 1
       ),
       last_photo_revision_id = (
         SELECT photos.photo_revision_id
           FROM speaker_photo_revisions AS photos
          WHERE photos.speaker_id = canonical_speaker_content.speaker_id
            AND photos.state = 'approved'
          ORDER BY photos.updated_at DESC, photos.photo_revision_id DESC
          LIMIT 1
       ),
       updated_at = COALESCE(
         (
           SELECT photos.updated_at
             FROM speaker_photo_revisions AS photos
            WHERE photos.speaker_id = canonical_speaker_content.speaker_id
              AND photos.state = 'approved'
            ORDER BY photos.updated_at DESC, photos.photo_revision_id DESC
            LIMIT 1
         ),
         updated_at
       ),
       updated_by = 'migration-0010-approved-photo'
 WHERE EXISTS (
   SELECT 1
     FROM speaker_photo_revisions AS photos
    WHERE photos.speaker_id = canonical_speaker_content.speaker_id
      AND photos.state = 'approved'
 );
