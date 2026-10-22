"""Assemble the private content library and validate its final-cut evidence."""
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from library_tools import HERE, ROOT, read_json, stamp


def save(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def ref(video, start, end):
    return {'videoId': video, 'start': start, 'end': end}


def theme(key, title, finding, references, implication):
    return dict(id=key, title=title, finding=finding, evidence=references, reuseImplication=implication)


SYNTHESIS = {
    'status': 'Editorial synthesis of the seminar, not an independent evaluation of speaker claims.',
    'overview': (
        'Across the seminar, faster generation repeatedly exposes work elsewhere in the system: '
        'deciding what to build, supplying context, understanding changes, checking them and operating the result. '
        'Mo Khazali frames this as delivery-system design; Ohans Emmanuel connects intent, build, QA and production feedback; '
        'Sini Tistelgrén describes the fundamentals between a prototype and accepted production delivery. '
        'Jenni Kylmäkoski, Jussi Hacklin and Viljami Kuosmanen offer different adoption experiences, with practical lessons '
        'about learning, shared assets, permissions and visible work. Muhammad Waseem makes decision rationale and system '
        'understanding central. The research sessions broaden this beyond code: Tapio Pitkäranta uses tangible probes '
        'for discovery, Joongi Shin studies the experience of people generating interfaces, and Zak Allal describes '
        'infrastructure for repeating scientific experiments. These are related perspectives rather than one demonstrated '
        'method. The Q&As preserve useful qualifications: building can change the problem being explored; documentation '
        'can become a burden; more output can overwhelm expert review; and activity metrics alone do not establish value. '
        'A strong editorial direction is therefore to ask what happens around generated output, supported by named examples '
        'and the limits of each example.'
    ),
    'themes': [
        theme('delivery-system', 'Generation changes the delivery system',
              'Mo, Ohans and Sini place generation inside a wider delivery flow. Viljami describes the review and testing work created by more proposals, while the research Q&A describes a similar evaluation constraint in peer review.',
              [ref('mo-talk',1903,2139),ref('ohans-talk',1499,1918),ref('sini-talk',94,238),ref('viljami-talk',1198,1291),ref('research-panel',1493,1640)],
              'Build an archive introduction around shifting constraints, then link to concrete examples rather than claiming a universal productivity multiplier.'),
        theme('context-and-rationale', 'Shared context includes the reasons behind decisions',
              'Accessible intent, codebase knowledge, architecture and decision reasons recur across the delivery talks. Waseem stresses that code does not contain all of an organisation’s knowledge. The final Q&A qualifies this with the maintenance burden of decision records.',
              [ref('ohans-talk',423,541),ref('viljami-talk',240,320),ref('sini-talk',580,829),ref('waseem-talk',899,1018),ref('final-panel',1469,1560)],
              'A practical article can compare shared intent, packaged documentation and decision records, including ownership and maintenance.'),
        theme('verification-and-ownership', 'Verification needs clear ownership and bounded permissions',
              'Jenni’s Jira incident and Viljami’s deployment near miss show why write permissions matter. Ohans separates implementation from QA; Sini separates authorship from approval; Waseem combines checks with human judgement. These proposals do not establish that adding a second model makes failures independent.',
              [ref('jenni-talk',960,1149),ref('viljami-talk',1057,1178),ref('ohans-talk',1078,1499),ref('sini-talk',1307,1394),ref('waseem-talk',1346,1447)],
              'Use a permissions-and-review story with explicit examples of who may propose, test, approve, merge and deploy.'),
        theme('adoption-and-learning', 'Adoption depends on usable assets and room to learn',
              'Jenni argues for protected learning time and treating shared AI assets as a product. Jussi describes guidance, training and community. Viljami describes learning through visible Slack work. Mo connects experimentation with continuous improvement. The approaches differ in how formal their training is.',
              [ref('jenni-talk',1160,1377),ref('jussi-talk',452,577),ref('viljami-talk',156,382),ref('mo-talk',1155,1543)],
              'Compare concrete adoption mechanisms; avoid presenting formal training or a particular chat tool as a requirement for every organisation.'),
        theme('discovery-and-iteration', 'Building can be part of discovering the problem',
              'Tapio’s probes make possible problems and solutions tangible. Joongi distinguishes envisioning an outcome from articulating it. In the research Q&A, Joongi explicitly qualifies a simple separation between discovery and implementation: building and testing can change the problem itself.',
              [ref('tapio-talk',754,875),ref('joongi-talk',412,504),ref('research-panel',836,983)],
              'Pair the probe explanation with the Q&A qualification in an article or discussion clip.'),
        theme('metrics-and-value', 'Use outcome measures and preserve their denominators',
              'Mo and Sini distinguish delivery outcomes from activity. Viljami’s contribution counts describe participation, not a causal productivity result. In the industry Q&A, absolute bugs discovered and bugs per release move differently. Joongi evaluates both generating and using an interface.',
              [ref('mo-talk',403,754),ref('sini-talk',1571,1664),ref('viljami-talk',1198,1291),ref('industry-panel',674,814),ref('joongi-talk',728,932)],
              'A measurement story can ask what changed for the customer or delivery flow, while keeping cost, adoption, volume and quality measures distinct.'),
        theme('experimentation-and-expertise', 'Repeatable experiments still need expert evaluation',
              'Zak argues that making experiments cheaper to repeat changes the questions researchers can investigate. The final Q&A discusses checkpoints, structured data and provenance. The research Q&A warns that increased output can overload expert review. Zak’s hearing work is presented as research under review.',
              [ref('zak-talk',146,331),ref('zak-talk',708,792),ref('zak-talk',981,1167),ref('final-panel',487,625),ref('research-panel',1493,1640)],
              'Connect research infrastructure to evaluation capacity without presenting a preprint as an established clinical result.'),
        theme('users-and-responsibility', 'Generated interfaces must serve the user’s task',
              'Joongi’s reported study distinguishes the goals of task-oriented users from designers and shows limits to follow-up questions. The research Q&A leaves accessibility responsibility unresolved. Generating an interface does not settle whether it is useful, accessible or fair to the user.',
              [ref('joongi-talk',149,302),ref('joongi-talk',790,1120),ref('research-panel',1222,1479)],
              'Use this as a product-design story that includes the generation experience and the resulting interface.'),
    ],
    'tensions': [
        theme('discovery-boundary', 'Separate discovery or learn through building',
              'Tapio’s distinction helps ask whether a team is exploring the right problem or engineering a solution. Joongi’s Q&A response cautions against making that boundary rigid: testing a built artefact can change the problem. Both perspectives should remain visible.',
              [ref('tapio-talk',138,291),ref('tapio-talk',754,875),ref('research-panel',836,983)],
              'Preserve the exchange rather than editing the qualification out of a discovery narrative.'),
        theme('approval-models', 'Approval models depend on the work and risk',
              'Viljami retains engineer review and merge for contributions. Sini discusses preapproved routine work and approval based on evidence, with independent verification. Ohans moves consequential review into implementation planning. These are different operating models, not proof of one universal review policy.',
              [ref('viljami-talk',1057,1178),ref('sini-talk',1307,1394),ref('ohans-talk',542,784)],
              'Compare the responsibility boundaries and the kinds of changes each speaker is describing.'),
        theme('context-maintenance', 'More context also creates maintenance work',
              'Several talks call for explicit knowledge and rationale. The final Q&A raises the cost of accumulating decision files for people and agents. The discussion does not supply a complete policy for pruning and maintaining them.',
              [ref('waseem-talk',899,1018),ref('viljami-talk',240,320),ref('final-panel',1469,1560)],
              'Follow an article about recording why with questions about ownership, relevance and maintenance.'),
        theme('cost-and-outcomes', 'Cost visibility and outcome measurement answer different questions',
              'Jussi’s quotas and the industry panel’s subscription and infrastructure discussion concern access and expenditure. Mo’s critique of activity metrics concerns whether the delivery system improves. Tracking token costs and rejecting token volume as proof of value are compatible positions.',
              [ref('jussi-talk',549,687),ref('industry-panel',390,672),ref('mo-talk',403,754)],
              'Keep adoption, expenditure and delivery impact separate in comparisons and headlines.'),
    ],
    'reusePlan': [
        {'use':'2026 archive and video cards','proposal':'Use each short summary as a starting point for a video card and each long summary for an archive entry. Preserve the official title, speaker and materials link.','inputs':['all per-video summaries'],'nextStep':'Add actual YouTube video URLs after upload; current review links are local.'},
        {'use':'Opening editorial article','proposal':'How faster generation changes the work around the code: context, verification, operations and choosing what to build.','inputs':['delivery-system','context-and-rationale','verification-and-ownership'],'nextStep':'Develop the argument with named speaker examples and keep it framed as seminar synthesis.'},
        {'use':'Newsletter series','proposal':'Three follow-ups: learning and adoption; decision rationale and review; probes, generative UI and scientific experiments.','inputs':['adoption-and-learning','context-maintenance','discovery-and-iteration','experimentation-and-expertise'],'nextStep':'Select one main example and one useful qualification per issue.'},
        {'use':'Clips and discussion prompts','proposal':'Start with the bottleneck message, the deployment near miss, the discovery qualification and the documentation burden. Longer Q&A ranges retain the question and caveats.','inputs':['mo-talk','viljami-talk','research-panel','final-panel'],'nextStep':'Watch and listen to the selected ranges, confirm wording and panel attribution, and tighten boundaries before rendering.'},
        {'use':'Channel introduction','proposal':'Use the existing 2:08 mood film as a candidate channel introduction or archive opener.','inputs':['mood'],'nextStep':'Approve the final film and preserve the required music and photograph credits when making derivatives.'},
    ],
    'discussionPrompts': [
        'Which constraint moved after generation became faster in your team, and what evidence shows it?',
        'Who owns the reasons behind architectural decisions, and who keeps them useful?',
        'Which changes can an agent propose, verify, approve, merge or deploy in your system?',
        'What have you learned about the problem only after building and testing a prototype?',
        'Which activity metric are you tempted to treat as an outcome, and what denominator is missing?',
    ],
}

VISUAL_NOTES = {
    'mo-talk': ['Blueprint slide says “Show the agent. Don’t tell it.” and points to code references.', 'Closing production-line slide connects the flow from idea to outcome and asks where the bottleneck is.'],
    'ohans-talk': ['Implementation-plan review is stated directly on the slide.', 'Visual QA slide combines repeated flows, LLM judgement and deterministic assertions.'],
    'jenni-talk': ['Mistakes slide lists context, harnesses, guardrails and validation.', 'Toolbox slide explicitly treats reusable assets as a product across development activities.'],
    'tapio-talk': ['Probe slide connects problem validation and solution proposals with human feedback.', 'Workshop slide shows orchestration of agentic engineering; no slide speed multiplier is reused as a general measured result.'],
    'joongi-talk': ['Slide contrasts prompt-only, subtask–UI and prompt-survey approaches.', 'Slide explicitly says “Prompt-survey can also fail”; this supports the technical term despite the ASR difference.'],
    'jussi-talk': ['Regulation, guidance, tooling and experiments are shown as separate practical work areas.', 'Closing slide supports the regulation-not-roadblock and clarity-over-quantity messages.'],
    'viljami-talk': ['Public shared work and thread context appear on the adoption slide.', 'Permissions slide states that agents and non-engineers open PRs and engineers review and merge; it also limits production access.'],
    'sini-talk': ['Prototype-to-production slide places code and testing within a larger production journey; the numerical estimate is not reused as our finding.', 'Control slide asks who requested, checked and accepted a change and how it can be undone.'],
    'zak-talk': ['Experiment repetition slide illustrates the cost-of-repeating argument.', 'Clinical Sense OS slide lists orchestration, Rust, Julia, C++, containers, a registry and experiments treated as Git.'],
    'waseem-talk': ['Slide describes an agent lacking onboarding and the reasons behind past decisions.', 'Closing slide asks to measure the system, write the why and grow skills.'],
    'research-panel': ['Panel and session-identification frame supports the discovery discussion setting.', 'Projected audience question explicitly raises accessibility responsibility and user labour.', 'Projected questions include research-process risks and a developer-versus-designer comparison; a question is not evidence that the study made that comparison.'],
    'industry-panel': ['Projected questions concern token budgets, quality, mental models and review workload.', 'Quality discussion frame includes the question to Viljami; sampled images do not independently establish every speaker turn.'],
    'final-panel': ['Projected question addresses Waseem about architecture decision records.', 'Projected question explicitly raises maintenance burden from thousands of decision files; individual quote attribution remains pending.'],
    'mood': ['Opening event footage shows the seminar identity and stage.', 'Second sampled frame is the “Ideas in conversation” graphic, consistent with the learning-and-community positioning.'],
}


def norm(text):
    return ' '.join(re.findall(r"\w+(?:'\w+)?", text.replace('’', "'").lower()))


def measured_duration(path):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(path)],text=True).strip())


def link_label(item):
    if item['kind']=='qa':
        return {'research-panel':'Research Q&A','industry-panel':'Industry Q&A','final-panel':'Final Q&A'}[item['id']]
    return ', '.join(item['speakerNames']) or 'Mood film'


def run():
    source_index = read_json(HERE/'source-index.json')
    excerpt_index = read_json(HERE/'excerpt-index.json')
    by_id = {x['id']:x for x in source_index['items']}
    assert len(by_id)==14
    assert set(VISUAL_NOTES)==set(by_id)
    assert {x.stem for x in (HERE/'items').glob('*.json')}==set(by_id)
    measures=[]; items=[]; visual=[]
    differences={
        'jenni-talk-q02':'Caption says “deliver some feature to a customer”; fresh ASR says “deliver some feature to your customer”. Resolve by listening before quoting.',
        'joongi-talk-q02':'Caption and sampled slide say “prompt-survey”; fresh ASR says “problem survey”. The slide supports the term, but exact spoken wording still needs listening.',
        'final-panel-q01':'Caption says “humans”; fresh ASR says “women”. Meaning and exact wording require listening. Individual speaker attribution is also unresolved.',
    }
    for source in source_index['items']:
        video_id=source['id']; raw=read_json(HERE/'items'/f'{video_id}.json')
        assert raw['id']==video_id
        cues=read_json(HERE/'sources'/f'{video_id}.json')['cues']
        assert hashlib.sha256((ROOT/source['captions']['srt']).read_bytes()).hexdigest()==source['captionSHA256']
        duration=source['durationSeconds']; actual=measured_duration(ROOT/source['reviewFile'])
        assert abs(actual-duration)<0.2,(video_id,actual,duration)
        assert (ROOT/source['reviewFile']).stat().st_size==source['mediaBytes']
        for entry in raw['takeaways']+raw['clipCandidates']:
            assert 0<=entry['start']<entry['end']<=duration,(video_id,entry)
        chapter_times=[x['outputSeconds'] for x in source['chapters']]
        assert chapter_times==sorted(chapter_times) and all(0<=t<duration for t in chapter_times)
        assert all(0<=c['start']<c['end']<=duration for c in cues)
        quotes=[]
        windows=[q for q in excerpt_index['quoteWindows'] if q['videoId']==video_id]
        assert len(windows)==len(raw['quoteCandidates'])
        caption_text=' '.join(norm(c['text']) for c in cues)
        for candidate,q in zip(raw['quoteCandidates'],windows):
            assert candidate['text']==q['text']
            assert caption_text.count(norm(candidate['text']))==1
            asr=read_json(HERE/q['asr'])
            asr_text=' '.join(t['text'].strip() for t in asr['transcription'])
            agrees=norm(candidate['text']) in norm(asr_text)
            assert agrees or q['id'] in differences,(q['id'],asr_text)
            assert not agrees or q['id'] not in differences
            assert abs(measured_duration(HERE/q['audio'])-(q['audioEnd']-q['audioStart']))<0.15
            quotes.append({**candidate,**q,'start':q['quoteStart'],'end':q['quoteEnd'],
                           'startTimecode':stamp(q['quoteStart']),'endTimecode':stamp(q['quoteEnd']),
                           'timingPrecision':'Subtitle cue span in the final edited video; not word-accurate.',
                           'captionMatch':'Unique normalized match in the final captions.',
                           'freshASRText':asr_text,'asrComparison':'Wording differs; listening required.' if not agrees else 'Candidate wording is present after case and punctuation normalization.',
                           'verificationNote':differences.get(q['id'],'Fresh local ASR agrees; editorial listening and approval remain pending.'),
                           'attributionStatus':'Confirm panel speaker before publication.' if source['kind']=='qa' else 'Named speaker in the source metadata or mood-film excerpt mapping.',
                           'publicationStatus':'Candidate only; not approved for publication.'})
            if 'originalContext' in candidate:
                original=candidate['originalContext']; assert original['videoId'] in by_id
                assert 0<=original['start']<original['end']<=by_id[original['videoId']]['durationSeconds']
        frames=[f for f in excerpt_index['frames'] if f['videoId']==video_id]
        assert len(frames)==len(raw['clipCandidates'])==len(VISUAL_NOTES[video_id])
        assert all((HERE/f['path']).exists() for f in frames)
        visual.append({'videoId':video_id,'scope':'One sampled midpoint frame per proposed clip, inspected by the assistant; not a full motion or audio review.',
                       'samples':[{**f,'observation':note} for f,note in zip(frames,VISUAL_NOTES[video_id])]})
        clips=[{**c,'id':f'{video_id}-clip-{n:02}','startTimecode':stamp(c['start']),'endTimecode':stamp(c['end']),
                'durationSeconds':round(c['end']-c['start'],3),'sampledFrame':f['path'],
                'status':'Candidate range; full viewing, listening, context and cut-boundary review required before rendering.'}
               for n,(c,f) in enumerate(zip(raw['clipCandidates'],frames),1)]
        raw['analysisStatus']='Complete-caption analysis, fresh local quote ASR and sampled-frame review complete; editorial approval pending.'
        save(f'items/{video_id}.json',raw)
        item={**source,**raw,'quoteCandidates':quotes,'clipCandidates':clips,
              'reviewUrl':f'http://127.0.0.1:8766/#{video_id}',
              'reviewLinkBehavior':'Selects the video only. Seek manually to the stated timestamp.',
              'sourceFingerprint':{'captionSHA256':source['captionSHA256'],'reviewMediaBytes':source['mediaBytes'],
                                   'reviewMediaMtimeNs':(ROOT/source['reviewFile']).stat().st_mtime_ns,'probedDurationSeconds':actual}}
        items.append(item);measures.append({'videoId':video_id,'expectedSeconds':duration,'probedReviewSeconds':actual})
    for section in ['themes','tensions']:
        for entry in SYNTHESIS[section]:
            for e in entry['evidence']:
                assert e['videoId'] in by_id and 0<=e['start']<e['end']<=by_id[e['videoId']]['durationSeconds']
    counts={'videos':len(items),'talks':sum(x['kind']=='talk' for x in items),'qas':sum(x['kind']=='qa' for x in items),
            'moodFilms':sum(x['kind']=='mood' for x in items),'durationSeconds':sum(x['durationSeconds'] for x in items),
            'quoteCandidates':sum(len(x['quoteCandidates']) for x in items),'quoteWordingFlags':len(differences),
            'clipCandidates':sum(len(x['clipCandidates']) for x in items),'sampledFrames':len(excerpt_index['frames']),
            'themes':len(SYNTHESIS['themes']),'tensions':len(SYNTHESIS['tensions'])}
    methodology={
        'scope':'All 14 final deliveries: ten talks, three Q&As and the mood film.',
        'basis':'The assistant read all current final captions; reviewed delivery metadata and chapters; drafted summaries, takeaways and synthesis; inspected one sampled frame per clip candidate; and compared every quote against fresh local ASR of audio extracted from the corresponding final review video.',
        'timebase':'All times refer to final edited video seconds. Title cards are already included. Quote times cover subtitle cues; clip ranges are editorial candidates, not approved frame-accurate edits.',
        'audioMethod':'whisper.cpp large-v3-q5_0, English, locally on the user’s machine. The source captions were also prepared with Whisper-family tooling, so this is not independent-model-family verification.',
        'limits':['No human listening pass or complete motion-video review was performed for this library.',
                  'Three quote candidates have caption/ASR wording differences; panel attribution needs confirmation.',
                  'Speaker-reported figures, historical analogies, company outcomes, medical/research claims and vendor anecdotes have not been independently fact-checked.',
                  'Takeaways summarize the speakers’ arguments. Cross-session themes are editorial synthesis, not proof of consensus or effectiveness.',
                  'Mood-film derivative uses must preserve the music and photograph attribution from the delivery package; those licences do not establish rights to all footage.'],
        'approval':'Summaries are reusable editorial drafts. Quotes and clips require a listening/viewing and attribution pass before publication.',
        'access':'Private analysis outputs. No public-site changes or new video uploads are part of this analysis.',
        'sources':{'productionRoot':str(ROOT),'deliveryMetadata':'metadata/upload-package-final-v08.json',
                   'captions':'transcripts/final-v02 for spoken sessions; transcripts/mood-v06 for the mood film.'}}
    library={'schemaVersion':1,'title':'SDLCAI 2026 video content library','analysedOn':'2026-10-22',
             'generatedAt':datetime.now(timezone.utc).isoformat(),'status':'Private editorial draft','counts':counts,
             'methodology':methodology,'synthesis':SYNTHESIS,'items':items}
    save('cross-session-synthesis.json',SYNTHESIS);save('visual-review.json',visual);save('content-library.json',library)
    save('validation-report.json',{'status':'passed','counts':counts,'checkedAt':datetime.now(timezone.utc).isoformat(),
                                   'checks':['All final deliveries represented once.','All source caption hashes and review-media byte counts still match.',
                                             'Review-media durations match delivery metadata within 0.2 seconds.','All ranges, chapters and synthesis references fit the relevant final video.',
                                             'Every quote has one normalized caption match and a corresponding final-cut audio extract and fresh ASR result.',
                                             'Every quote audio duration matches the extraction range within 0.15 seconds.',
                                             'All three ASR wording differences are explicitly flagged.','Every clip has a sampled frame and a recorded inspection note.'],
                                   'reviewMediaDurations':measures,'wordingFlags':differences,
                                   'doesNotEstablish':'Publication approval, full audiovisual review, independent fact checking or speaker identity verification.'})
    if (HERE/'review-pass/review-findings.json').exists():
        import sys
        subprocess.run([sys.executable,str(HERE/'update_review_findings.py')],check=True)
        library=read_json(HERE/'content-library.json')
    if (HERE/'review-pass/parakeet-review.json').exists():
        import sys
        subprocess.run([sys.executable,str(HERE/'apply_parakeet_review.py')],check=True)
        library=read_json(HERE/'content-library.json')
    if (HERE/'review-pass/focused-parakeet/review.json').exists():
        import sys
        subprocess.run([sys.executable,str(HERE/'apply_focused_parakeet.py')],check=True)
        library=read_json(HERE/'content-library.json')
    if (HERE/'editorial-choices.json').exists():
        import sys
        subprocess.run([sys.executable,str(HERE/'apply_editorial_choices.py')],check=True)
        library=read_json(HERE/'content-library.json')
    make_page(library)
    print(json.dumps({'status':'passed','counts':library['counts'],'library':str(HERE/'content-library.json')},ensure_ascii=False))


def make_page(library):
    items=library['items']; by_id={x['id']:x for x in items}
    review_status='**Review status.** All final captions were read. Quote windows were checked with fresh local ASR and proposed clips were sampled visually. Three wording differences and panel attribution checks remain flagged. Quotes and clip ranges need a listening/viewing pass before publication; the library is not a record of independent fact checking.'
    if library.get('reviewPass'):
        review_status='**Review status.** Named handoffs support the quote attributions to Viljami, Joongi and Sini; 21 of the 22 candidates have attribution supported by metadata or context. The final Q&A quote still has no confirmed individual speaker. Wider-context local ASR has not resolved the three wording differences, and paraphrases are supplied for those passages. Direct listening and full clip viewing remain pending.'
    if library.get('parakeetPass'):
        review_status='**Review status.** All 22 quote candidates were compared with both Whisper and Parakeet. Sixteen match after case and punctuation normalization; two omit speech fillers or restarts. Four need exact-wording listening checks, including a new mood-film pronoun difference. Twenty-one attributions are supported by metadata or context; the final Q&A respondent remains unnamed. Direct listening, full clip viewing and publication approval remain pending.'
    if library.get('focusedParakeetPass'):
        review_status='**Review status.** All 22 quote candidates were compared with Whisper and Parakeet; 16 match after normalization and two omit fillers or restarts. A focused follow-up checked the four wording flags with 15 fresh master-audio crops and both Parakeet decoders. Joongi’s disputed term consistently renders as “problem survey”; the other three vary with crop or decoder. All four exact-wording flags remain open. Twenty-one attributions are supported by metadata or context; the final Q&A respondent remains unnamed. Direct listening, full clip viewing and publication approval remain pending.'
    if library.get('editorialChoices'):
        review_status='**Editorial wording.** The four ambiguous phrases are selected for reuse as “a customer”, “prompt-survey”, “humans” and “you’re”. The survey term and human/agent comparison are contextual corrections; these candidates are labelled as lightly edited wording. Recognition alternatives remain in the review record. Twenty-one attributions are supported by metadata or context; use the final Q&A session label without an individual speaker name for its quote. Direct listening is not claimed, and clip boundaries remain candidates for review.'
    def evidence(refs):
        return ' · '.join(f"[{link_label(by_id[e['videoId']])} {stamp(e['start'])}–{stamp(e['end'])}]({by_id[e['videoId']]['reviewUrl']})" for e in refs)
    blocks=[
        'A private working library for the final SDLCAI 2026 edits: ten talks, three Q&As and the 2:08 mood film. It contains short and detailed summaries, takeaways, 22 quote candidates, 29 clip candidates and cross-session editorial angles.',
        'The most useful direction for reuse is what happens around generated output: deciding what to build, sharing context, understanding changes, verifying them and learning from what reaches production. The sessions offer different experiences and qualifications, not one proven method.',
        review_status,
        '**Using the timecodes.** Times refer to the final edited videos, including their title cards. Local review links select a video; seek to the stated time manually. They work on this computer while the [review server](http://127.0.0.1:8766/) is running. Public YouTube video URLs can be added after upload.',
        '# Cross session findings', library['synthesis']['overview'],
    ]
    for entry in library['synthesis']['themes']:
        blocks.extend(['## '+entry['title'],entry['finding']+'\n\n'+evidence(entry['evidence']), '**Reuse angle:** '+entry['reuseImplication']])
    blocks.append('# Differences worth preserving')
    for entry in library['synthesis']['tensions']:
        blocks.extend(['## '+entry['title'],entry['finding']+'\n\n'+evidence(entry['evidence'])])
    blocks.append('# Reuse plan')
    for r in library['synthesis']['reusePlan']:
        blocks.append('**'+r['use']+'.** '+r['proposal']+' '+r['nextStep'])
    blocks.append('**Discussion prompts**\n\n'+'\n'.join('- '+p for p in library['synthesis']['discussionPrompts']))
    blocks.append('# Session summaries and candidates')
    for item in items:
        blocks.extend(['## '+link_label(item),
            '**'+item['officialTitle']+'** · '+stamp(item['durationSeconds'])+' · [Local review]('+item['reviewUrl']+')'+(' · [Session page]('+item['talkUrl']+')' if item.get('talkUrl') else ''),
            '**Short summary**\n\n'+item['shortSummary'],
            '**Detailed summary**\n\n'+item['longSummary'],
            '**Takeaways**\n\n'+'\n'.join(f"- {stamp(t['start'])}–{stamp(t['end'])}: {t['point']}" for t in item['takeaways'])])
        quotes=[]
        for q in item['quoteCandidates']:
            s=f"- **{q['startTimecode']}–{q['endTimecode']} · {q['speaker']}:** “{q['text']}”\n  {q['verificationNote']}"
            if q.get('attributionBasis'):s+=' '+q['attributionBasis']
            if q.get('suggestedParaphrase'):s+=' Suggested paraphrase (not verbatim): '+q['suggestedParaphrase']
            if q.get('originalContext'):
                o=q['originalContext'];s+=f" Original context: {link_label(by_id[o['videoId']])}, {stamp(o['start'])}–{stamp(o['end'])}."
            quotes.append(s)
        blocks.append('**Quote candidates**\n\n'+'\n'.join(quotes))
        blocks.append('**Clip candidates**\n\n'+'\n'.join(f"- **{c['startTimecode']}–{c['endTimecode']} · {c['title']}** ({c['durationSeconds']:g}s). {c['why']} Audience: {c['audience']}." for c in item['clipCandidates']))
        blocks.append('**Further uses**\n\n'+'\n'.join('- '+r for r in item['reuseAngles']))
        blocks.append('**Editorial notes**\n\n'+'\n'.join('- '+c for c in item['editorialCaveats']))
        if item.get('materials'):
            blocks.append('**Materials:** '+' · '.join(f"[{m['label']}{' — '+', '.join(m['speakerNames']) if m.get('speakerNames') else ''}]({m['url']})" for m in item['materials']))
    m=library['methodology']
    blocks.extend(['# Source and review notes',m['basis']+'\n\n'+m['audioMethod'],
                   '\n'.join('- '+s for s in m['limits']),m['approval'],
                   'The structured companion, `content-library.json`, retains per-video metadata, final-caption fingerprints, quote contexts and ASR comparisons, candidate ranges and cross-session evidence references. `validation-report.json` records the range and source checks. The source videos remain in the local post-production archive.'])
    assert sum(len(x['quoteCandidates']) for x in items)==22
    assert sum(len(x['clipCandidates']) for x in items)==29
    save('page-blocks.json',blocks)


if __name__=='__main__':
    run()
