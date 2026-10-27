-- Add the ten reviewed talk spotlights without replacing existing drafts.

-- Planned dates are not evidence of LinkedIn scheduling; rows remain drafts.

INSERT INTO publication_queue (id,event_id,channel,position,title,body,alt_text,notes,assets_json,sources_json) VALUES ('spotlight-mo','2026','linkedin','6','Talk spotlight: Measure the bottleneck','Measure the bottleneck

Mo Khazali uses automotive and factory-history analogies to argue that AI adoption needs a redesigned delivery system. Shared platforms, daily learning, early quality checks and customer-outcome measures matter more than token consumption or code output alone.

Three takeaways, paraphrased from the talk:

1. Tool activity alone does not establish customer value.

2. Turn recurring mistakes into checks and shared blueprints.

3. Track flow, failures, rework and customer outcomes.

The internal pilot comparison is observational; it does not isolate the effects of AI from changes to the delivery process.

Read the summary, follow the source timestamps and watch the full presentation:
https://sdlcai.org/2026/talks/mo-khazali-industry-perspective/

#sdlcai #SoftwareEngineering','Measure the bottleneck. Mo Khazali at SDLCAI 2026. Three paraphrased talk takeaways: 1. Tool activity alone does not establish customer value. 2. Turn recurring mistakes into checks and shared blueprints. 3. Track flow, failures, rework and customer outcomes. sdlcai.org','Talk spotlight, separate from the three longer delivery-series posts.

Use a real LinkedIn mention for Mo Khazali when a matching profile can be selected in the composer.

The internal pilot comparison is observational; it does not isolate the effects of AI from changes to the delivery process.

LinkedIn plan: 2026-10-29 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.','[{"format":"portrait","url":"https://sdlcai.org/2026/talks/mo-khazali-industry-perspective/summary-portrait.png?v=a0042a15f37d","width":1080,"height":1350},{"format":"landscape","url":"https://sdlcai.org/2026/talks/mo-khazali-industry-perspective/summary-landscape.png?v=8ee88668bdfc","width":1200,"height":630}]','[{"label":"Mo Khazali — talk summary","url":"https://sdlcai.org/2026/talks/mo-khazali-industry-perspective/"},{"label":"Takeaway 01 6:43–12:34","url":"https://www.youtube.com/watch?v=l8quIPHmakI&t=403s"},{"label":"Takeaway 02 25:43–28:51","url":"https://www.youtube.com/watch?v=l8quIPHmakI&t=1543s"},{"label":"Takeaway 03 31:43–35:39","url":"https://www.youtube.com/watch?v=l8quIPHmakI&t=1903s"},{"label":"Mo Khazali — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/mohammadkhazali/"}]') ON CONFLICT(event_id,id) DO NOTHING;

INSERT INTO publication_queue (id,event_id,channel,position,title,body,alt_text,notes,assets_json,sources_json) VALUES ('spotlight-ohans','2026','linkedin','7','Talk spotlight: Keep the delivery loop connected','Keep the delivery loop connected

Ohans Emmanuel describes a connected delivery workflow that treats agent output as something to verify. Shared intent, early plan review, paired models, visual system understanding, independent QA and production feedback form a loop from deciding what to build through learning from what ships.

Three takeaways, paraphrased from the talk:

1. Keep intent available to implementation, QA and operations.

2. Separate implementation from QA; combine adaptive and deterministic checks.

3. Feed production findings into the next plan and review.

These practices describe the speaker’s team experience. Pairing models and using a separate QA agent add scrutiny, without establishing independent failure modes. Read-only infrastructure access still requires controls over data disclosure.

Read the summary, follow the source timestamps and watch the full presentation:
https://sdlcai.org/2026/talks/ohans-emmanuel-industry-perspective/

#sdlcai #SoftwareEngineering','Keep the delivery loop connected. Ohans Emmanuel at SDLCAI 2026. Three paraphrased talk takeaways: 1. Keep intent available to implementation, QA and operations. 2. Separate implementation from QA; combine adaptive and deterministic checks. 3. Feed production findings into the next plan and review. sdlcai.org','Talk spotlight, separate from the three longer delivery-series posts.

Use a real LinkedIn mention for Ohans Emmanuel when a matching profile can be selected in the composer.

These practices describe the speaker’s team experience. Pairing models and using a separate QA agent add scrutiny, without establishing independent failure modes. Read-only infrastructure access still requires controls over data disclosure.

LinkedIn plan: 2026-11-03 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.','[{"format":"portrait","url":"https://sdlcai.org/2026/talks/ohans-emmanuel-industry-perspective/summary-portrait.png?v=901351193785","width":1080,"height":1350},{"format":"landscape","url":"https://sdlcai.org/2026/talks/ohans-emmanuel-industry-perspective/summary-landscape.png?v=6a73d765b716","width":1200,"height":630}]','[{"label":"Ohans Emmanuel — talk summary","url":"https://sdlcai.org/2026/talks/ohans-emmanuel-industry-perspective/"},{"label":"Takeaway 01 7:03–9:01","url":"https://www.youtube.com/watch?v=xi1AY-G3Ycc&t=423s"},{"label":"Takeaway 02 17:58–24:59","url":"https://www.youtube.com/watch?v=xi1AY-G3Ycc&t=1078s"},{"label":"Takeaway 03 24:59–31:58","url":"https://www.youtube.com/watch?v=xi1AY-G3Ycc&t=1499s"},{"label":"Ohans Emmanuel — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/ohans-emmanuel/"}]') ON CONFLICT(event_id,id) DO NOTHING;

INSERT INTO publication_queue (id,event_id,channel,position,title,body,alt_text,notes,assets_json,sources_json) VALUES ('spotlight-jenni','2026','linkedin','8','Talk spotlight: Leaders need hands-on experience','Leaders need hands-on experience

Jenni Kylmäkoski explains why leaders should build and use AI tools themselves. Her reporting tools and an unintended Jira change reveal practical lessons about onboarding, permissions, observability, learning time and maintaining shared AI assets as products.

Three takeaways, paraphrased from the talk:

1. Build tools for your own work and validate the outputs.

2. Give permissions, logs and recovery explicit attention.

3. Maintain shared AI assets as software products.

Read the summary, follow the source timestamps and watch the full presentation:
https://sdlcai.org/2026/talks/jenni-kylmakoski-industry-perspective/

#sdlcai #SoftwareEngineering','Leaders need hands-on experience. Jenni Kylmäkoski at SDLCAI 2026. Three paraphrased talk takeaways: 1. Build tools for your own work and validate the outputs. 2. Give permissions, logs and recovery explicit attention. 3. Maintain shared AI assets as software products. sdlcai.org','Talk spotlight, separate from the three longer delivery-series posts.

Use a real LinkedIn mention for Jenni Kylmäkoski when a matching profile can be selected in the composer.

LinkedIn plan: 2026-11-05 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.','[{"format":"portrait","url":"https://sdlcai.org/2026/talks/jenni-kylmakoski-industry-perspective/summary-portrait.png?v=9588c9a63b00","width":1080,"height":1350},{"format":"landscape","url":"https://sdlcai.org/2026/talks/jenni-kylmakoski-industry-perspective/summary-landscape.png?v=77ca4a42aa46","width":1200,"height":630}]','[{"label":"Jenni Kylmäkoski — talk summary","url":"https://sdlcai.org/2026/talks/jenni-kylmakoski-industry-perspective/"},{"label":"Takeaway 01 5:41–9:07","url":"https://www.youtube.com/watch?v=1bT23mhlzGg&t=341s"},{"label":"Takeaway 02 16:00–19:09","url":"https://www.youtube.com/watch?v=1bT23mhlzGg&t=960s"},{"label":"Takeaway 03 20:50–22:57","url":"https://www.youtube.com/watch?v=1bT23mhlzGg&t=1250s"},{"label":"Jenni Kylmäkoski — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/jennikylmakoski/"}]') ON CONFLICT(event_id,id) DO NOTHING;

INSERT INTO publication_queue (id,event_id,channel,position,title,body,alt_text,notes,assets_json,sources_json) VALUES ('spotlight-tapio','2026','linkedin','9','Talk spotlight: Make discovery tangible','Make discovery tangible

Tapio Pitkäranta presents agentic probes as tangible experiments that help people clarify problems and explore solutions. Examples from a probe factory and a healthcare process exercise show how faster implementation can move the bottleneck toward ideas, orchestration and validation.

Three takeaways, paraphrased from the talk:

1. Give people a probe they can inspect and challenge.

2. Test the understanding of the problem as well as the solution.

3. As building accelerates, ideas, orchestration and validation matter more.

The healthcare examples are exploratory work in progress and imagined process alternatives, rather than demonstrated clinical outcomes.

Read the summary, follow the source timestamps and watch the full presentation:
https://sdlcai.org/2026/talks/agentic-discovery/

#sdlcai #SoftwareEngineering','Make discovery tangible. Tapio Pitkäranta at SDLCAI 2026. Three paraphrased talk takeaways: 1. Give people a probe they can inspect and challenge. 2. Test the understanding of the problem as well as the solution. 3. As building accelerates, ideas, orchestration and validation matter more. sdlcai.org','Talk spotlight, separate from the three longer delivery-series posts.

Use a real LinkedIn mention for Tapio Pitkäranta when a matching profile can be selected in the composer.

The healthcare examples are exploratory work in progress and imagined process alternatives, rather than demonstrated clinical outcomes.

LinkedIn plan: 2026-11-10 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.','[{"format":"portrait","url":"https://sdlcai.org/2026/talks/agentic-discovery/summary-portrait.png?v=60740bf3d110","width":1080,"height":1350},{"format":"landscape","url":"https://sdlcai.org/2026/talks/agentic-discovery/summary-landscape.png?v=7e2fb0f77a13","width":1200,"height":630}]','[{"label":"Tapio Pitkäranta — talk summary","url":"https://sdlcai.org/2026/talks/agentic-discovery/"},{"label":"Takeaway 01 12:34–14:07","url":"https://www.youtube.com/watch?v=dGI7WlgL-JM&t=754s"},{"label":"Takeaway 02 12:34–14:35","url":"https://www.youtube.com/watch?v=dGI7WlgL-JM&t=754s"},{"label":"Takeaway 03 15:35–17:48","url":"https://www.youtube.com/watch?v=dGI7WlgL-JM&t=935s"},{"label":"Tapio Pitkäranta — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/tapio-pitkaranta/"}]') ON CONFLICT(event_id,id) DO NOTHING;

INSERT INTO publication_queue (id,event_id,channel,position,title,body,alt_text,notes,assets_json,sources_json) VALUES ('spotlight-joongi','2026','linkedin','10','Talk spotlight: Design for the user’s goal','Design for the user’s goal

Joongi Shin studies generative UI for people who want to complete a task, rather than design an interface. His comparison of prompts, editable subtask representations and follow-up surveys shows why helping users form and express their intentions matters alongside generating working software.

Three takeaways, paraphrased from the talk:

1. Help people envision outcomes and express what they need.

2. Evaluate both generation and the experience of using the result.

3. Questions can help, but repetitive or irrelevant prompts obstruct exploration.

The findings concern perceptions in the described study. Associations between generation effort and later usability perceptions do not establish causation or a universally best interaction method.

Read the summary, follow the source timestamps and watch the full presentation:
https://sdlcai.org/2026/talks/joongi-shin-ui-perspective/

#sdlcai #SoftwareEngineering','Design for the user’s goal. Joongi Shin at SDLCAI 2026. Three paraphrased talk takeaways: 1. Help people envision outcomes and express what they need. 2. Evaluate both generation and the experience of using the result. 3. Questions can help, but repetitive or irrelevant prompts obstruct exploration. sdlcai.org','Talk spotlight, separate from the three longer delivery-series posts.

Use a real LinkedIn mention for Joongi Shin when a matching profile can be selected in the composer.

The findings concern perceptions in the described study. Associations between generation effort and later usability perceptions do not establish causation or a universally best interaction method.

LinkedIn plan: 2026-11-12 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.','[{"format":"portrait","url":"https://sdlcai.org/2026/talks/joongi-shin-ui-perspective/summary-portrait.png?v=b2458965dbb1","width":1080,"height":1350},{"format":"landscape","url":"https://sdlcai.org/2026/talks/joongi-shin-ui-perspective/summary-landscape.png?v=528be693991b","width":1200,"height":630}]','[{"label":"Joongi Shin — talk summary","url":"https://sdlcai.org/2026/talks/joongi-shin-ui-perspective/"},{"label":"Takeaway 01 6:52–8:24","url":"https://www.youtube.com/watch?v=JTTq9MNefTU&t=412s"},{"label":"Takeaway 02 12:08–13:10","url":"https://www.youtube.com/watch?v=JTTq9MNefTU&t=728s"},{"label":"Takeaway 03 16:20–18:40","url":"https://www.youtube.com/watch?v=JTTq9MNefTU&t=980s"},{"label":"Joongi Shin — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/joongi-shin/"}]') ON CONFLICT(event_id,id) DO NOTHING;

INSERT INTO publication_queue (id,event_id,channel,position,title,body,alt_text,notes,assets_json,sources_json) VALUES ('spotlight-jussi','2026','linkedin','11','Talk spotlight: Support adoption around the tools','Support adoption around the tools

Jussi Hacklin describes how Elisa supports AI adoption within regulatory and customer-contract constraints. Legal collaboration, clear leadership expectations, practical guidance, shared tooling and bounded experiments form the basis for adoption across the software lifecycle.

Three takeaways, paraphrased from the talk:

1. Work with legal specialists on regulatory and contract restrictions.

2. Back leadership expectations with guidance, training and community.

3. Give tools and quotas clear ownership and visibility.

This account reflects Elisa’s operating context at the October 2026 event. Security depends on how components and data flows work together, as well as on the individual tools.

Read the summary, follow the source timestamps and watch the full presentation:
https://sdlcai.org/2026/talks/driving-ai-adoption-regulated-environment/

#sdlcai #SoftwareEngineering','Support adoption around the tools. Jussi Hacklin at SDLCAI 2026. Three paraphrased talk takeaways: 1. Work with legal specialists on regulatory and contract restrictions. 2. Back leadership expectations with guidance, training and community. 3. Give tools and quotas clear ownership and visibility. sdlcai.org','Talk spotlight, separate from the three longer delivery-series posts.

Use a real LinkedIn mention for Jussi Hacklin when a matching profile can be selected in the composer.

This account reflects Elisa’s operating context at the October 2026 event. Security depends on how components and data flows work together, as well as on the individual tools.

LinkedIn plan: 2026-11-17 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.','[{"format":"portrait","url":"https://sdlcai.org/2026/talks/driving-ai-adoption-regulated-environment/summary-portrait.png?v=2919c4da675e","width":1080,"height":1350},{"format":"landscape","url":"https://sdlcai.org/2026/talks/driving-ai-adoption-regulated-environment/summary-landscape.png?v=dddbbd0ffd4b","width":1200,"height":630}]','[{"label":"Jussi Hacklin — talk summary","url":"https://sdlcai.org/2026/talks/driving-ai-adoption-regulated-environment/"},{"label":"Takeaway 01 5:12–7:31","url":"https://www.youtube.com/watch?v=VpoYC7DaOjs&t=312s"},{"label":"Takeaway 02 7:32–9:37","url":"https://www.youtube.com/watch?v=VpoYC7DaOjs&t=452s"},{"label":"Takeaway 03 9:09–11:27","url":"https://www.youtube.com/watch?v=VpoYC7DaOjs&t=549s"},{"label":"Jussi Hacklin — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/jussihacklin/"}]') ON CONFLICT(event_id,id) DO NOTHING;

INSERT INTO publication_queue (id,event_id,channel,position,title,body,alt_text,notes,assets_json,sources_json) VALUES ('spotlight-viljami','2026','linkedin','12','Talk spotlight: More proposals need more review','More proposals need more review

Viljami Kuosmanen describes epilot''s experiment giving non-engineers coding agents through Slack. Shared documentation, preview links and engineer review enabled contributions across product, design, support and QA, while a deployment near miss exposed permission gaps and review became a bottleneck.

Three takeaways, paraphrased from the talk:

1. Put agents where the work and its context already happen.

2. Separate contribution, merge, CI and production permissions.

3. Contribution counts do not establish a delivery-speed improvement.

Contribution counts do not establish a delivery-speed improvement; the speaker explicitly says strong speed data is not yet available. The attempted production deployment was detected and stopped.

Read the summary, follow the source timestamps and watch the full presentation:
https://sdlcai.org/2026/talks/non-engineers-vibe-code-production/

#sdlcai #SoftwareEngineering','More proposals need more review. Viljami Kuosmanen at SDLCAI 2026. Three paraphrased talk takeaways: 1. Put agents where the work and its context already happen. 2. Separate contribution, merge, CI and production permissions. 3. Contribution counts do not establish a delivery-speed improvement. sdlcai.org','Talk spotlight, separate from the three longer delivery-series posts.

Use a real LinkedIn mention for Viljami Kuosmanen when a matching profile can be selected in the composer.

Contribution counts do not establish a delivery-speed improvement; the speaker explicitly says strong speed data is not yet available. The attempted production deployment was detected and stopped.

LinkedIn plan: 2026-11-19 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.','[{"format":"portrait","url":"https://sdlcai.org/2026/talks/non-engineers-vibe-code-production/summary-portrait.png?v=e5921dfc9139","width":1080,"height":1350},{"format":"landscape","url":"https://sdlcai.org/2026/talks/non-engineers-vibe-code-production/summary-landscape.png?v=578481b9995a","width":1200,"height":630}]','[{"label":"Viljami Kuosmanen — talk summary","url":"https://sdlcai.org/2026/talks/non-engineers-vibe-code-production/"},{"label":"Takeaway 01 2:36–6:22","url":"https://www.youtube.com/watch?v=SL6QypO5BxA&t=156s"},{"label":"Takeaway 02 17:37–19:38","url":"https://www.youtube.com/watch?v=SL6QypO5BxA&t=1057s"},{"label":"Takeaway 03 19:58–21:31","url":"https://www.youtube.com/watch?v=SL6QypO5BxA&t=1198s"},{"label":"Viljami Kuosmanen — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/anttiviljami/"}]') ON CONFLICT(event_id,id) DO NOTHING;

INSERT INTO publication_queue (id,event_id,channel,position,title,body,alt_text,notes,assets_json,sources_json) VALUES ('spotlight-sini','2026','linkedin','13','Talk spotlight: A prototype still needs a production path','A prototype still needs a production path

Sini Tistelgrén describes an AI factory as a delivery system built on intent, architecture, security, independent verification, ownership and operational feedback. She explains why a quick prototype still needs a production path, and proposes bounded loops with executable controls and evidence.

Three takeaways, paraphrased from the talk:

1. Include architecture, access, release, operations and support.

2. Make control ownership and approval boundaries explicit.

3. Start with a bounded value stream and measure accepted delivery.

The delivery-address scenario illustrates a proposed flow of controls; it is not an observed customer case.

Read the summary, follow the source timestamps and watch the full presentation:
https://sdlcai.org/2026/talks/ai-factory-fundamentals/

#sdlcai #SoftwareEngineering','A prototype still needs a production path. Sini Tistelgrén at SDLCAI 2026. Three paraphrased talk takeaways: 1. Include architecture, access, release, operations and support. 2. Make control ownership and approval boundaries explicit. 3. Start with a bounded value stream and measure accepted delivery. sdlcai.org','Talk spotlight, separate from the three longer delivery-series posts.

Use a real LinkedIn mention for Sini Tistelgrén when a matching profile can be selected in the composer.

The delivery-address scenario illustrates a proposed flow of controls; it is not an observed customer case.

LinkedIn plan: 2026-11-24 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.','[{"format":"portrait","url":"https://sdlcai.org/2026/talks/ai-factory-fundamentals/summary-portrait.png?v=89890b25e749","width":1080,"height":1350},{"format":"landscape","url":"https://sdlcai.org/2026/talks/ai-factory-fundamentals/summary-landscape.png?v=c70531855357","width":1200,"height":630}]','[{"label":"Sini Tistelgrén — talk summary","url":"https://sdlcai.org/2026/talks/ai-factory-fundamentals/"},{"label":"Takeaway 01 1:34–3:58","url":"https://www.youtube.com/watch?v=tOGTv8fR4Wc&t=94s"},{"label":"Takeaway 02 21:47–23:14","url":"https://www.youtube.com/watch?v=tOGTv8fR4Wc&t=1307s"},{"label":"Takeaway 03 26:11–27:44","url":"https://www.youtube.com/watch?v=tOGTv8fR4Wc&t=1571s"},{"label":"Sini Tistelgrén — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/stistelgren/"}]') ON CONFLICT(event_id,id) DO NOTHING;

INSERT INTO publication_queue (id,event_id,channel,position,title,body,alt_text,notes,assets_json,sources_json) VALUES ('spotlight-zak','2026','linkedin','14','Talk spotlight: Make experiments cheap to repeat','Make experiments cheap to repeat

Zak Allal argues that lowering the cost of repeating experiments can change scientific discovery. He describes a clinical research system built with supercomputing, Rust, Julia and C++, and presents a proposed continuous hearing atlas as an example of questioning the assumptions behind existing categories.

Three takeaways, paraphrased from the talk:

1. The cost of repetition shapes which questions are feasible.

2. Preserve configurations and invest in orchestration.

3. When results are unstable, examine the premise and methodology.

At the event, the proposed hearing model was presented as a preprint under review, with an intention to seek regulatory qualification. This research status does not imply completed peer review or regulatory approval.

Read the summary, follow the source timestamps and watch the full presentation:
https://sdlcai.org/2026/talks/zak-allal-industry-perspective/

#sdlcai #SoftwareEngineering','Make experiments cheap to repeat. Zak Allal at SDLCAI 2026. Three paraphrased talk takeaways: 1. The cost of repetition shapes which questions are feasible. 2. Preserve configurations and invest in orchestration. 3. When results are unstable, examine the premise and methodology. sdlcai.org','Talk spotlight, separate from the three longer delivery-series posts.

Use a real LinkedIn mention for Zak Allal when a matching profile can be selected in the composer.

At the event, the proposed hearing model was presented as a preprint under review, with an intention to seek regulatory qualification. This research status does not imply completed peer review or regulatory approval.

LinkedIn plan: 2026-11-26 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.','[{"format":"portrait","url":"https://sdlcai.org/2026/talks/zak-allal-industry-perspective/summary-portrait.png?v=5857093ff570","width":1080,"height":1350},{"format":"landscape","url":"https://sdlcai.org/2026/talks/zak-allal-industry-perspective/summary-landscape.png?v=ed02cb779533","width":1200,"height":630}]','[{"label":"Zak Allal — talk summary","url":"https://sdlcai.org/2026/talks/zak-allal-industry-perspective/"},{"label":"Takeaway 01 2:26–5:31","url":"https://www.youtube.com/watch?v=gVXx5fOUXbs&t=146s"},{"label":"Takeaway 02 11:48–13:12","url":"https://www.youtube.com/watch?v=gVXx5fOUXbs&t=708s"},{"label":"Takeaway 03 7:47–10:08","url":"https://www.youtube.com/watch?v=gVXx5fOUXbs&t=467s"},{"label":"Zak Allal — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/7862266955/"}]') ON CONFLICT(event_id,id) DO NOTHING;

INSERT INTO publication_queue (id,event_id,channel,position,title,body,alt_text,notes,assets_json,sources_json) VALUES ('spotlight-waseem','2026','linkedin','15','Talk spotlight: Understanding remains the hard part','Understanding remains the hard part

Muhammad Waseem argues that AI makes code generation easier while understanding, integration and ownership remain difficult. He examines repository context, decision rationale and agent-facing applications, then proposes deterministic checks, human judgement and gates for safety, architectural fit and measurable value.

Three takeaways, paraphrased from the talk:

1. Check whether a change preserves the wider system.

2. Record decision reasons, constraints and rejected options.

3. Combine deterministic checks with human judgement and value gates.

Read the summary, follow the source timestamps and watch the full presentation:
https://sdlcai.org/2026/talks/genai-software-engineering/

#sdlcai #SoftwareEngineering','Understanding remains the hard part. Muhammad Waseem at SDLCAI 2026. Three paraphrased talk takeaways: 1. Check whether a change preserves the wider system. 2. Record decision reasons, constraints and rejected options. 3. Combine deterministic checks with human judgement and value gates. sdlcai.org','Talk spotlight, separate from the three longer delivery-series posts.

Use a real LinkedIn mention for Muhammad Waseem when a matching profile can be selected in the composer.

LinkedIn plan: 2026-12-01 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.','[{"format":"portrait","url":"https://sdlcai.org/2026/talks/genai-software-engineering/summary-portrait.png?v=525cfaa9647a","width":1080,"height":1350},{"format":"landscape","url":"https://sdlcai.org/2026/talks/genai-software-engineering/summary-landscape.png?v=7edb9638b1a7","width":1200,"height":630}]','[{"label":"Muhammad Waseem — talk summary","url":"https://sdlcai.org/2026/talks/genai-software-engineering/"},{"label":"Takeaway 01 7:09–11:01","url":"https://www.youtube.com/watch?v=o_WaA-EaBqo&t=429s"},{"label":"Takeaway 02 14:59–16:58","url":"https://www.youtube.com/watch?v=o_WaA-EaBqo&t=899s"},{"label":"Takeaway 03 22:26–24:07","url":"https://www.youtube.com/watch?v=o_WaA-EaBqo&t=1346s"},{"label":"Muhammad Waseem — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/muhammad-waseem-phd-98023a17/"}]') ON CONFLICT(event_id,id) DO NOTHING;

-- Keep saved editorial copy and notes; standardise the requested hashtag and add the plan/profile reference.

UPDATE publication_queue SET body = replace(body,'#SDLCAI','#sdlcai'), notes = CASE WHEN instr(notes,'LinkedIn plan:') = 0 THEN notes || char(10) || char(10) || 'LinkedIn plan: 2026-12-03 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.' ELSE notes END, sources_json = CASE WHEN NOT EXISTS (SELECT 1 FROM json_each(sources_json) WHERE json_extract(value,'$.url') = 'https://www.linkedin.com/in/mohammadkhazali/') THEN json_insert(sources_json,'$[#]',json('{"label":"Mo Khazali — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/mohammadkhazali/"}')) ELSE sources_json END, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_id='2026' AND id='delivery-01' AND (instr(body,'#SDLCAI') > 0 OR instr(notes,'LinkedIn plan:') = 0);

UPDATE publication_queue SET body = replace(body,'#SDLCAI','#sdlcai'), notes = CASE WHEN instr(notes,'LinkedIn plan:') = 0 THEN notes || char(10) || char(10) || 'LinkedIn plan: 2026-12-08 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.' ELSE notes END, sources_json = CASE WHEN NOT EXISTS (SELECT 1 FROM json_each(sources_json) WHERE json_extract(value,'$.url') = 'https://www.linkedin.com/in/stistelgren/') THEN json_insert(sources_json,'$[#]',json('{"label":"Sini Tistelgrén — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/stistelgren/"}')) ELSE sources_json END, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_id='2026' AND id='delivery-02' AND (instr(body,'#SDLCAI') > 0 OR instr(notes,'LinkedIn plan:') = 0);

UPDATE publication_queue SET body = replace(body,'#SDLCAI','#sdlcai'), notes = CASE WHEN instr(notes,'LinkedIn plan:') = 0 THEN notes || char(10) || char(10) || 'LinkedIn plan: 2026-12-10 at 09:00 Europe/Paris. Awaiting verification in LinkedIn''s native scheduler.' ELSE notes END, sources_json = CASE WHEN NOT EXISTS (SELECT 1 FROM json_each(sources_json) WHERE json_extract(value,'$.url') = 'https://www.linkedin.com/in/muhammad-waseem-phd-98023a17/') THEN json_insert(sources_json,'$[#]',json('{"label":"Muhammad Waseem — LinkedIn profile for tagging","url":"https://www.linkedin.com/in/muhammad-waseem-phd-98023a17/"}')) ELSE sources_json END, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_id='2026' AND id='delivery-03' AND (instr(body,'#SDLCAI') > 0 OR instr(notes,'LinkedIn plan:') = 0);
