"""Apply the accepted editorial readings while preserving all ASR evidence."""
import json
from datetime import datetime,timezone
from library_tools import HERE,read_json

CHOICES={
 'jenni-talk-q02':{
   'selectedPhrase':'a customer',
   'type':'Retain the caption wording.',
   'reason':'The sentence crop supports “a customer” with both decoders, as does the clause crop with greedy decoding. Other windows return “your customer”; the article does not change the point.',
   'note':'Selected wording: “a customer”, supported by the complete-sentence crop and the existing captions. Some other windows render “your customer”; the full comparison is retained in the review notes.'},
 'joongi-talk-q02':{
   'selectedPhrase':'prompt-survey',
   'type':'Contextual correction in lightly edited wording.',
   'reason':'The slide and preceding sentence explicitly name the method “prompt-survey”. Recognizers repeatedly render “problem survey” in this utterance; “prompt-survey” preserves the intended technical reference.',
   'note':'Lightly edited wording: “prompt-survey” preserves the method named on the slide and in the preceding sentence. ASR renders “problem survey” in this utterance; that alternative remains in the review record.'},
 'final-panel-q01':{
   'selectedPhrase':'humans',
   'type':'Contextual correction in lightly edited wording.',
   'reason':'The answer compares maintenance burden for people with maintenance burden for agents. “Humans” fits that argument and the captions; the ASR alternatives “women” and “human” are retained as uncertain acoustic readings.',
   'note':'Lightly edited wording: “humans” preserves the comparison between people and agents. ASR alternatives “women” and “human” remain in the review record. Use the final Q&A session label without an individual speaker name; the respondent is unconfirmed.'},
 'mood-q01':{
   'selectedPhrase':"you're",
   'type':'Retain the caption wording.',
   'reason':'“You’re” is supported by five of six fresh montage-audio results and by the sentence and wider-context crops of the original Q&A excerpt.',
   'note':'Selected wording: “you’re”, supported by most fresh montage runs and the original passage in sentence and wider context. The alternative “we’re” remains in the review notes.'},
}


def save(name,value):
    (HERE/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')


def run():
    library=read_json(HERE/'content-library.json')
    applied=[]
    for item in library['items']:
        for quote in item['quoteCandidates']:
            if quote['id'] not in CHOICES:continue
            choice=CHOICES[quote['id']]
            # These contextually preferred readings already match the original
            # captions. Do not rewrite source media or discard ASR alternatives.
            assert choice['selectedPhrase'] in quote['text']
            quote['editorialChoice']=choice
            quote['verificationNote']=choice['note']
            quote['wordingStatus']='Selected for reuse by editorial judgement.'
            quote['quotationStyle']='Lightly edited wording; no strict-verbatim or direct-listening claim.'
            quote['publicationStatus']=('Selected wording; use the final Q&A session label without an individual speaker name, or use the paraphrase.' if quote['id']=='final-panel-q01' else 'Selected wording for reuse as a lightly edited quotation or paraphrase.')
            applied.append(quote['id'])
    assert set(applied)==set(CHOICES)
    record={'selectedAt':datetime.now(timezone.utc).isoformat(),
            'status':'Four wording decisions accepted for editorial reuse.',
            'basis':'The user requested selection of the most likely options. Choices combine source context, captions and recognition results. Repeated decodes of one model are not independent votes.',
            'directListeningPerformed':False,'sourceMediaOrCaptionsChanged':False,
            'choices':CHOICES,'remainingAttribution':'The individual final-panel respondent is unconfirmed; use the final Q&A session label without an individual speaker name.',
            'evidence':['review-pass/parakeet-review.json','review-pass/focused-parakeet/review.json']}
    library['editorialChoices']=record
    library['counts'].update(quoteWordingFlags=0,unresolvedWordingDifferences=0,editorialWordingSelections=4)
    library['methodology']['limits'][1]='Four ambiguous phrases have editorial selections: “a customer”, “prompt-survey”, “humans” and “you’re”. The survey term and human/agent comparison are contextual corrections, not verified strict-verbatim transcriptions. Two other candidates omit fillers or restarts. The final-panel respondent remains individually unconfirmed.'
    library['methodology']['approval']='The four selected readings can be reused as lightly edited wording or paraphrases. Use the final Q&A session label without an individual speaker name for its quotation. Clip boundaries and audiovisual presentation remain separate editorial checks.'
    extra=' For reuse, four ambiguous phrases now have editorial selections that combine the recognition evidence with the named method and surrounding argument. The selected text is labelled as lightly edited wording; the source captions, audio and all recognition alternatives are preserved.'
    if extra not in library['methodology']['basis']:library['methodology']['basis']+=extra
    save('editorial-choices.json',record)
    save('content-library.json',library)
    validation=read_json(HERE/'validation-report.json')
    validation['counts']=library['counts']
    validation['priorWordingFlags']=validation.get('priorWordingFlags',validation['wordingFlags'])
    validation['wordingFlags']={}
    validation['editorialChoices']={'status':'applied','choices':{qid:c['selectedPhrase'] for qid,c in CHOICES.items()},
                                   'checks':['All four choices are present in the selected quote text.','Raw audio, captions and ASR results remain unchanged.','All four candidates carry an editorial-choice label.'],
                                   'remaining':'Individual attribution for the final-panel quote remains unconfirmed. Direct listening is not claimed.'}
    save('validation-report.json',validation)
    print(json.dumps({'editorialChoices':{qid:c['selectedPhrase'] for qid,c in CHOICES.items()},'openWordingDecisions':0},ensure_ascii=False))


if __name__=='__main__':run()
