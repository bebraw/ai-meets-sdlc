"""Summarize all predefined crops, including empty and conflicting results."""
import json
import re
import wave
from collections import Counter
from datetime import datetime,timezone
from library_tools import HERE,read_json


def save(path,value):
    (HERE/path).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')


NOTES={
 'jenni-talk-q02':'Fresh master-audio checks remain window-dependent: “a customer” occurs in the sentence crop with both decoders and in the clause crop with greedy decoding; “your customer” occurs in the wider crop with both decoders. The clause crop returns no text with beam decoding. Retain the caption’s “a customer” as a draft, but do not mark the exact quote listening-approved.',
 'joongi-talk-q02':'All six fresh master-audio runs render “problem survey” in the disputed sentence. The paired and wider crops separately render “prompt survey” in the preceding sentence, matching the method name on the slide. Parakeet therefore consistently suggests “problem survey” here, but ASR cannot distinguish a spoken slip from an acoustic recognition error. Use “prompt-survey” in the paraphrase and keep the verbatim quote flagged.',
 'final-panel-q01':'Five of six fresh master-audio runs render “women”; the wider crop with greedy decoding instead renders “human”. This changes the earlier impression that Parakeet was stable across contexts. The captions have “humans”. The exact noun remains unresolved, and the respondent is still not individually attributed. Use the paraphrase for reuse.',
 'mood-q01':'Five of six fresh montage-audio runs render “why you’re building this”; one sentence-crop beam run renders “we’re”. In the original industry-Q&A audio, four of six runs render “you’re”, while both tightly cropped clause runs render “we’re”. The existing caption “you’re” is better supported by sentence and wider context, but the pronoun is still sensitive to cropping and needs listening before verbatim reuse.',
}


def reading(case,text):
    if not text.strip():return 'no text'
    text=text.lower().replace('’',"'")
    pattern={
        'jenni':r'deliver some feature to (a|your) customer',
        'joongi':r'i would say (?:the |that )?(prompt|problem) survey',
        'final':r'maintenance burden for (?:uh )?(women|humans|human)',
        'mood':r"why (you're|we're) building this",
        'mood-original':r"why (you're|we're) building this",
    }[case]
    matches=re.findall(pattern,text)
    assert len(matches)==1,(case,text,matches)
    return matches[0]


def run():
    result=read_json(HERE/'review-pass/focused-parakeet/results.json')
    assert len(result['windows'])==15
    rows=[]
    for window in result['windows']:
        with wave.open(str(HERE/window['audio'])) as wav:
            assert wav.getframerate()==16000 and wav.getnchannels()==1
            assert abs(wav.getnframes()/wav.getframerate()-(window['end']-window['start']))<0.01
        for mode in ['greedy','beam']:
            text=window[mode]['text']
            assert read_json(HERE/window[mode]['result'])['text']==text
            rows.append({'case':window['case'],'windowId':window['id'],'videoId':window['videoId'],
                         'window':window['window'],'start':window['start'],'end':window['end'],
                         'decoding':mode,'reading':reading(window['case'],text),'text':text,
                         'audio':window['audio'],'audioSHA256':window['audioSHA256'],'result':window[mode]['result']})
    counts={case:dict(Counter(r['reading'] for r in rows if r['case']==case)) for case in ['jenni','joongi','final','mood','mood-original']}
    assert counts=={'jenni':{'a':3,'no text':1,'your':2},'joongi':{'problem':6},'final':{'women':5,'human':1},'mood':{"you're":5,"we're":1},'mood-original':{"we're":2,"you're":4}},counts
    report={'reviewedAt':datetime.now(timezone.utc).isoformat(),'model':result['model'],'audioCrops':15,'transcriptions':30,
            'method':result['method'],'readings':counts,'rows':rows,'quoteNotes':NOTES,
            'interpretation':'These are repeated context/decoder variants of one ASR model, not independent votes or calibrated probabilities. A stable model rendering does not guarantee the exact spoken word. All four quote flags remain open.',
            'directListeningPerformed':False,'recordingsUploaded':False,'individualPanelSpeakerResolved':False}
    library=read_json(HERE/'content-library.json')
    case_ids={'jenni-talk-q02':'jenni','joongi-talk-q02':'joongi','final-panel-q01':'final','mood-q01':'mood'}
    for item in library['items']:
        for quote in item['quoteCandidates']:
            if quote['id'] in NOTES:
                quote['verificationNote']=NOTES[quote['id']]
                quote['focusedParakeetReview']={'case':case_ids[quote['id']],'report':'review-pass/focused-parakeet/review.json','readings':counts[case_ids[quote['id']]],'wordingStatus':'Unresolved exact wording; direct listening remains pending.'}
    library['focusedParakeetPass']=report
    library['counts'].update(focusedParakeetAudioCrops=15,focusedParakeetTranscriptions=30)
    extra=' A focused Parakeet follow-up used 15 predefined clause, sentence and wider-context crops from the final 4K masters, including the original source of the mood excerpt. Both greedy and beam decoders were run on each crop; the noun, article and pronoun variants and one empty result are retained without choosing only a preferred output.'
    if extra not in library['methodology']['basis']:library['methodology']['basis']+=extra
    save('review-pass/focused-parakeet/review.json',report)
    save('content-library.json',library)
    validation=read_json(HERE/'validation-report.json')
    validation['counts']=library['counts']
    validation['wordingFlags']=NOTES
    validation['focusedParakeetPass']={'status':'passed','audioCrops':15,'transcriptions':30,'report':'review-pass/focused-parakeet/review.json',
                                       'checks':['Every crop fits the final edited video and uses its final master audio.','All crop WAVs are mono 16 kHz with durations matching the requested intervals.','All 30 saved transcripts are represented, including the one empty beam result.','All target word renderings are classified; no variant was omitted from the report.'],
                                       'remaining':'Four exact-wording flags and one unnamed panel respondent. No direct listening or full clip review has been performed.'}
    save('validation-report.json',validation)
    print(json.dumps({'readings':counts,'audioCrops':15,'transcriptions':30}))


if __name__=='__main__':run()
