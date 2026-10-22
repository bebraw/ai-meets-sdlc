"""Record contextual attribution checks without claiming to have heard audio."""
import json
from library_tools import HERE, read_json

index=read_json(HERE/'review-pass/context-index.json')
windows={w['id']:w for w in index['windows']}
for w in windows.values():
    w['text']=' '.join(t['text'].strip() for t in read_json(HERE/w['asr'])['transcription'])

wording={
 'jenni-talk-q02': {
   'contextWindow':'jenni-wording',
   'finding':'Captions have “deliver some feature to a customer”. Both fresh short-window and wider-context ASR render “deliver some feature to your customer”. The wider pass also drops words near the end. These are correlated Whisper-family results, so the exact quotation remains unresolved.',
   'paraphrase':'Protect learning time when making delivery commitments, or urgent work will displace it.',
 },
 'joongi-talk-q02': {
   'contextWindow':'joongi-wording',
   'finding':'Captions and the slide use “prompt-survey”. Both fresh ASR passes render “problem survey” in the disputed sentence, although the wider pass renders “prompt survey” immediately before it. The intended method is clear; whether the spoken sentence contains that term or a slip remains unresolved.',
   'paraphrase':'The prompt-survey approach can fail when follow-up questions do not serve the user’s task.',
 },
 'final-panel-q01': {
   'contextWindow':'final-wording-and-turn',
   'finding':'Captions have “humans”; both fresh ASR passes render “women”. The comparison with agents suggests people are intended, but context cannot establish the exact word spoken. Keep this as a paraphrase until direct listening. The host does not name the respondent in this handoff, so individual attribution remains unresolved.',
   'paraphrase':'Accumulated decision records create maintenance work for both people and agents.',
 },
}
attributions={
 'industry-panel-q01': {'speaker':'Viljami Kuosmanen','status':'Supported by an explicit named question and the continuous answer in the final captions.',
                       'basis':'At 13:34 the host addresses Viljami about maintaining a mental model. The answer continues through the quote at 14:44 and ends with thanks at 14:53; its references to 300 repositories and shared documentation also fit his talk. Wider-context ASR preserves the question/answer sequence but misrenders the name as “William”.','contextWindow':'industry-handoff'},
 'research-panel-q01': {'speaker':'Joongi Shin','status':'Supported by an explicit named handoff and the continuous answer in the final captions.',
                       'basis':'At 15:35 the host asks Joongi to add his view. The following answer contains the quote at 15:49 and continues to 16:23 without an intervening handoff. Wider-context ASR preserves the sequence but misrenders the name as “Jun”.','contextWindow':'research-handoff'},
 'mood-q01': {'speaker':'Sini Tistelgrén','status':'Supported by the edit mapping and an explicit named question in the original session.',
              'basis':'The mood-film excerpt maps to the industry Q&A. At 02:44 the host addresses Sini about choosing the right work; the continuous answer includes the value question used in the mood film. Wider-context ASR also renders the name Sini.','contextWindow':'mood-sini-original'},
 'mood-q02': {'speaker':'Jenni Kylmäkoski','status':'Supported by the edit mapping to the named single-speaker talk.',
              'basis':'The edit mapping points to Jenni’s talk at 23:28–23:35. The final talk captions and the mood-film captions contain the excerpt.'},
 'final-panel-q01': {'speaker':'Final Q&A contribution','status':'Unresolved individual attribution.',
                     'basis':'The host reads an audience question without naming a respondent. A response begins at 24:54, contains the quote at 25:37, and is followed by “Do you want to comment?” and “I agree with him”. The topic and a reference to a paper are insufficient to establish the speaker’s name.','contextWindow':'final-wording-and-turn'},
}

library=read_json(HERE/'content-library.json')
findings={'reviewDate':'2026-10-22','directListeningPerformed':False,
          'directListeningBlocker':'The current assistant session explicitly does not support audio input. Playback or file permissions cannot change that capability.',
          'method':index['method'],'contextWindows':list(windows.values()),'wording':wording,'attributions':attributions,
          'counts':{'quoteCandidates':22,'attributionsSupportedByMetadataOrContext':21,'unresolvedIndividualAttributions':1,'unresolvedWordingDifferences':3},
          'nextStep':'Use an audio-capable model/tool or a person to review the three disputed excerpts and identify the final-panel respondent. Full listening/viewing of proposed clips is still pending.'}
for item in library['items']:
    item['analysisStatus']='Caption, local ASR and contextual attribution review complete; direct listening and publication approval pending.'
    for quote in item['quoteCandidates']:
        qid=quote['id']
        if qid in attributions:
            a=attributions[qid]
            quote['attributionStatus']=a['status']
            quote['attributionBasis']=a['basis']
            quote['attributionReview']=a
        else:
            quote['attributionStatus']='Supported by metadata for the named single-speaker talk; no biometric voice identification performed.'
        if qid in wording:
            w=wording[qid]; window=windows[w['contextWindow']]
            quote['additionalASR']={'method':index['method'],'windowStart':window['start'],'windowEnd':window['end'],'audio':window['audio'],'asr':window['asr'],'text':window['text']}
            quote['verificationNote']=w['finding']
            quote['suggestedParaphrase']=w['paraphrase']
            quote['wordingStatus']='Unresolved; do not publish this exact quotation as verified.'
    if item['id']=='research-panel':
        item['editorialCaveats']=[('The selected quote is contextually attributed to Joongi from the named handoff at 15:35; direct listening remains pending.' if c=='Panel quotes need attribution confirmation before publication because captions are not diarised.' else c) for c in item['editorialCaveats']]
    if item['id']=='industry-panel':
        item['editorialCaveats']=[('The selected quote is contextually attributed to Viljami from the named question at 13:34 and the continuous answer; direct listening remains pending.' if c=='The panel contains multiple voices without diarised captions. Quote attribution follows the explicitly addressed question and remains a candidate for human confirmation.' else c) for c in item['editorialCaveats']]
library['reviewPass']=findings
library['counts'].update(findings['counts'])
library['methodology']['limits'][1]='Three wording differences remain unresolved after a wider-context unquantized Whisper pass. All quote attributions are supported by source metadata or explicit handoffs except the final Q&A quote, whose individual respondent is unresolved.'
extra_basis=' A subsequent pass checked six wider context windows with unquantized Whisper large-v3 and reviewed the panel handoffs. This was not direct listening or independent-model-family verification.'
if extra_basis not in library['methodology']['basis']:
    library['methodology']['basis']+=extra_basis
(HERE/'review-pass/review-findings.json').write_text(json.dumps(findings,ensure_ascii=False,indent=2)+'\n')
(HERE/'content-library.json').write_text(json.dumps(library,ensure_ascii=False,indent=2)+'\n')
validation=read_json(HERE/'validation-report.json')
validation['reviewPass']={'status':'Additional ASR and contextual checks complete; direct listening incomplete.','counts':findings['counts'],'report':'review-pass/review-findings.json'}
(HERE/'validation-report.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(findings['counts']))
