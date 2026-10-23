-- Seeded once from production/content-inventory/2026/distribution-drafts.json.
-- Later deployments must preserve the editors' saved copy and tracking details.
CREATE TABLE publication_queue (
  event_id TEXT NOT NULL,
  id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('linkedin','website','newsletter')),
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','ready','scheduled','published')),
  publication_date TEXT NOT NULL DEFAULT '',
  publication_url TEXT NOT NULL DEFAULT '',
  graphic_format TEXT NOT NULL DEFAULT 'portrait' CHECK (graphic_format IN ('portrait','landscape')),
  assets_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(assets_json)),
  sources_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sources_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT,
  PRIMARY KEY (event_id, id)
);

INSERT INTO publication_queue (id,event_id,channel,position,title,subtitle,summary,body,alt_text,notes,status,publication_date,publication_url,graphic_format,assets_json,sources_json) VALUES ('delivery-01','2026','linkedin',1,'Where the delivery flow slows down','','','AI adoption gives teams plenty of activity to count. Understanding what changes for the people waiting on the work takes a closer look.

At SDLCAI, Mo Khazali used the history of factory automation to examine the relationship between new tools and the system of work around them.

His software examples connect shared platforms, daily problem-solving and repeatable quality checks with measures of delivery flow and customer value.

A useful exercise for a team reviewing its AI adoption: follow one recent change from request to production. Record where it waited, why it needed rework and how its outcome was evaluated.

Compare those observations with the adoption figures when deciding what to change next.

Read the summary, follow the source timestamps and watch the talk:
https://sdlcai.org/2026/talks/mo-khazali-industry-perspective/

Where does work spend the most time waiting in your team?

#SDLCAI #SoftwareEngineering','Measure the bottleneck. Mo Khazali at SDLCAI 2026. Three paraphrased talk takeaways: 1. Tool activity alone does not establish customer value. 2. Turn recurring mistakes into checks and shared blueprints. 3. Track flow, failures, rework and customer outcomes. sdlcai.org','The change-tracing exercise is an editorial application of the talk.','draft','','','portrait','[{"format": "portrait", "url": "https://sdlcai.org/2026/talks/mo-khazali-industry-perspective/summary-portrait.png?v=a0042a15f37d", "width": 1080, "height": 1350}, {"format": "landscape", "url": "https://sdlcai.org/2026/talks/mo-khazali-industry-perspective/summary-landscape.png?v=8ee88668bdfc", "width": 1200, "height": 630}]','[{"label": "Mo Khazali — talk summary", "url": "https://sdlcai.org/2026/talks/mo-khazali-industry-perspective/"}, {"label": "Tool activity and delivery measures 6:43–12:34", "url": "https://www.youtube.com/watch?v=l8quIPHmakI&t=403s"}, {"label": "Measuring outcomes and auditing the flow 31:43–35:39", "url": "https://www.youtube.com/watch?v=l8quIPHmakI&t=1903s"}]');

INSERT INTO publication_queue (id,event_id,channel,position,title,subtitle,summary,body,alt_text,notes,status,publication_date,publication_url,graphic_format,assets_json,sources_json) VALUES ('delivery-02','2026','linkedin',2,'The work between a prototype and production','','','A prototype is working. Who takes responsibility for getting it into production?

At SDLCAI, Sini Tistelgrén described an AI factory connecting six stations: intent, design, build, verify, release and operate.

Her argument brings the surrounding work into view: architecture, access, security, acceptance criteria, release ownership and operational feedback.

She uses an illustrative delivery-address change to show how these controls could fit together. The value is in making the production path explicit while people remain responsible for its controls and exceptions.

For a practical starting point, she recommends one bounded value stream and a baseline. That gives a team a place to examine lead time, failed changes and the cost of accepted delivery.

Read the summary, follow the source timestamps and watch the talk:
https://sdlcai.org/2026/talks/ai-factory-fundamentals/

Which handoff needs the most attention in your path from prototype to production?

#SDLCAI #SoftwareDelivery','A prototype still needs a production path. Sini Tistelgrén at SDLCAI 2026. Three paraphrased talk takeaways: 1. Include architecture, access, release, operations and support. 2. Make control ownership and approval boundaries explicit. 3. Start with a bounded value stream and measure accepted delivery. sdlcai.org','Keep the delivery-address example explicitly illustrative.','draft','','','portrait','[{"format": "portrait", "url": "https://sdlcai.org/2026/talks/ai-factory-fundamentals/summary-portrait.png?v=89890b25e749", "width": 1080, "height": 1350}, {"format": "landscape", "url": "https://sdlcai.org/2026/talks/ai-factory-fundamentals/summary-landscape.png?v=c70531855357", "width": 1200, "height": 630}]','[{"label": "Sini Tistelgrén — talk summary", "url": "https://sdlcai.org/2026/talks/ai-factory-fundamentals/"}, {"label": "The work after a prototype 1:34–3:58", "url": "https://www.youtube.com/watch?v=tOGTv8fR4Wc&t=94s"}, {"label": "The six stations 6:30–8:04", "url": "https://www.youtube.com/watch?v=tOGTv8fR4Wc&t=390s"}, {"label": "Starting with a bounded value stream 26:11–27:44", "url": "https://www.youtube.com/watch?v=tOGTv8fR4Wc&t=1571s"}]');

INSERT INTO publication_queue (id,event_id,channel,position,title,subtitle,summary,body,alt_text,notes,status,publication_date,publication_url,graphic_format,assets_json,sources_json) VALUES ('delivery-03','2026','linkedin',3,'Keeping the reasons behind a change available','','','A repository can show what changed while leaving the reasons difficult to find.

At SDLCAI, Muhammad Waseem examined the work of understanding, reviewing and maintaining software as code generation becomes easier.

His argument connects review capacity with knowledge that source code may leave implicit: decision reasons, rejected options, constraints and ownership. A change can look reasonable in one file while raising questions elsewhere in the system.

One useful review exercise is to pick a consequential change and check whether the next person can recover the reasoning behind it. What was the intended outcome? Which alternatives were considered? What evidence would tell the team to revisit the decision?

Keeping that explanation useful also needs an owner as the system evolves.

Read the summary, follow the source timestamps and watch the talk:
https://sdlcai.org/2026/talks/genai-software-engineering/

How does your team preserve the reasons a future reviewer will need?

#SDLCAI #SoftwareArchitecture','Understanding remains the hard part. Muhammad Waseem at SDLCAI 2026. Three paraphrased talk takeaways: 1. Check whether a change preserves the wider system. 2. Record decision reasons, constraints and rejected options. 3. Combine deterministic checks with human judgement and value gates. sdlcai.org','The review exercise is an editorial application of the talk.','draft','','','portrait','[{"format": "portrait", "url": "https://sdlcai.org/2026/talks/genai-software-engineering/summary-portrait.png?v=525cfaa9647a", "width": 1080, "height": 1350}, {"format": "landscape", "url": "https://sdlcai.org/2026/talks/genai-software-engineering/summary-landscape.png?v=7edb9638b1a7", "width": 1200, "height": 630}]','[{"label": "Muhammad Waseem — talk summary", "url": "https://sdlcai.org/2026/talks/genai-software-engineering/"}, {"label": "Understanding and the review bottleneck 11:01–14:58", "url": "https://www.youtube.com/watch?v=o_WaA-EaBqo&t=661s"}, {"label": "Knowledge and decision context 14:59–16:58", "url": "https://www.youtube.com/watch?v=o_WaA-EaBqo&t=899s"}, {"label": "Checks, human judgement and value gates 22:26–24:07", "url": "https://www.youtube.com/watch?v=o_WaA-EaBqo&t=1346s"}]');

INSERT INTO publication_queue (id,event_id,channel,position,title,subtitle,summary,body,alt_text,notes,status,publication_date,publication_url,graphic_format,assets_json,sources_json) VALUES ('archive-announcement','2026','website',4,'SDLCAI 2026 recordings and talk summaries are now available','Explore the talks through their key points, recordings and shareable graphics.','Revisit SDLCAI 2026 through ten talk summaries, fourteen recordings, research posters and photos, with timestamped key points and graphics to share.','The SDLCAI 2026 archive is now available. It brings together recordings of all ten talks and three Q&A sessions, an event highlights film, research posters and photographs from the seminar on 13 October 2026 at Marsio, Aalto University, Espoo.

The [ten talk summaries](https://sdlcai.org/2026/talks/) offer a way into the material. Each page pairs a summary with timestamped key points, chapters, the recording and available presentation materials. Landscape and portrait takeaway cards include speaker photos, with suggested post copy and image alt text available to download.

For senior engineers and delivery leaders considering how AI changes their teams’ work, these three talks make a useful starting point:

- [Mo Khazali on delivery flow](https://sdlcai.org/2026/talks/mo-khazali-industry-perspective/): how shared platforms, continuous learning and quality checks connect AI adoption with customer outcomes.
- [Sini Tistelgrén on the production path](https://sdlcai.org/2026/talks/ai-factory-fundamentals/): the architecture, ownership and operational work that connects a prototype with an accepted change in production.
- [Muhammad Waseem on system understanding](https://sdlcai.org/2026/talks/genai-software-engineering/): why review, decision context and knowledge of the wider system remain central as code generation becomes easier.

The research sessions explore [agentic probes in discovery](https://sdlcai.org/2026/talks/agentic-discovery/) and [generative interfaces for everyday users](https://sdlcai.org/2026/talks/joongi-shin-ui-perspective/), bringing further questions about how teams build and evaluate ideas.

You can also [explore the three research posters](https://sdlcai.org/2026/posters/), [browse the photos](https://sdlcai.org/2026/photos/) or [watch the talks and Q&A through the programme](https://sdlcai.org/2026/schedule/).

Thank you to the speakers, poster presenters, attendees, volunteers, sponsors and Aalto University for making the day possible.

[Explore the SDLCAI 2026 archive](https://sdlcai.org/2026/) and [subscribe for future SDLCAI updates](https://sdlcai.org/subscribe/).','','','draft','','','portrait','[]','[]');

INSERT INTO publication_queue (id,event_id,channel,position,title,subtitle,summary,body,alt_text,notes,status,publication_date,publication_url,graphic_format,assets_json,sources_json) VALUES ('archive-newsletter','2026','newsletter',5,'SDLCAI 2026: recordings, summaries and takeaway cards','Three starting points on delivery flow, production readiness and system understanding.','','Hi,

You can now revisit SDLCAI 2026 through fourteen recordings, ten talk summaries, research posters and photos from the seminar on 13 October at Aalto University.

If you’re deciding where to start, here are three talks about the work around AI-assisted implementation:

- [Mo Khazali on delivery flow](https://sdlcai.org/2026/talks/mo-khazali-industry-perspective/). Examine where work waits, what causes rework and how the team measures customer outcomes.
- [Sini Tistelgrén on the production path](https://sdlcai.org/2026/talks/ai-factory-fundamentals/). Follow the architecture, verification, release and operational work that a prototype still needs.
- [Muhammad Waseem on system understanding](https://sdlcai.org/2026/talks/genai-software-engineering/). Consider how reviewers and future maintainers recover the reasons behind a change.

Each talk page includes a summary, timestamped key points and a link to the recording. You can also download landscape and portrait takeaway cards, with suggested post copy and image alt text, to share with your colleagues.

[Explore all ten talk summaries](https://sdlcai.org/2026/talks/)

The wider archive includes [all recordings and Q&A](https://sdlcai.org/2026/schedule/), [three research posters](https://sdlcai.org/2026/posters/) and [photos from the day](https://sdlcai.org/2026/photos/).

Thank you to everyone who helped make SDLCAI happen.

Juho
SDLCAI','','Use the newsletter template’s existing unsubscribe footer when preparing the campaign. This is an unscheduled draft.','draft','','','portrait','[]','[]');

