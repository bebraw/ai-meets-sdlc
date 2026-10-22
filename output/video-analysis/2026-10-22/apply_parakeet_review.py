"""Record Parakeet comparisons without treating ASR as direct listening."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from library_tools import HERE, read_json


def save(name,value):
    (HERE/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')


def normalize(text):
    return ' '.join(re.findall(r'\w+',text.lower()))


FINDINGS={
 'jenni-talk-q02':{
   'classification':'wording-review-needed',
   'note':'The longer Parakeet passage matches the caption wording “deliver some feature to a customer”, including the rest of the candidate. The short extract reads “your customer” with both Parakeet decoders, as the fresh Whisper passes do. Retain “a customer” as the caption-based candidate, but the article remains sensitive to the recognition window and needs listening.',
   'contextId':'jenni-wording',
   'paraphrase':'Protect learning time when making delivery commitments, or urgent work will displace it.'},
 'joongi-talk-q02':{
   'classification':'wording-review-needed',
   'note':'Whisper and Parakeet both render “problem survey” in this sentence; Parakeet’s greedy and beam results agree on that term in the short extract and wider context. The preceding sentence and the slide use “prompt-survey”. That establishes the intended method, not whether this utterance contains a speech slip or an ASR error. Use the paraphrase until the exact spoken wording is checked.',
   'contextId':'joongi-wording',
   'paraphrase':'The prompt-survey approach can fail when follow-up questions do not serve the user’s task.'},
 'final-panel-q01':{
   'classification':'wording-review-needed',
   'note':'Whisper and Parakeet both render “women”, while the captions say “humans”; Parakeet is consistent across both decoders and both context lengths. The surrounding argument suggests a comparison between people and agents, but this cannot establish the exact word spoken. Keep a paraphrase rather than a verified direct quotation. Individual speaker attribution is still unresolved.',
   'contextId':'final-wording-and-turn',
   'paraphrase':'Accumulated decision records create maintenance work for both people and agents.'},
 'mood-q01':{
   'classification':'wording-review-needed',
   'note':'The mood-film captions and Whisper have “why you’re building this”. Parakeet reads “why we’re building this” in the final montage with both decoders, but reads “why you’re building this” in the original industry-Q&A context with both decoders. The original passage supports the existing caption; the final mix’s pronoun still needs listening before verbatim reuse.',
   'contextId':'mood-sini-original',
   'paraphrase':'Ask whether what is being built is relevant and brings value.'},
 'joongi-talk-q01':{
   'classification':'speech-edit-difference',
   'note':'Whisper supports the caption wording. Parakeet supports the same content but includes “uh” before “task-oriented users” in both decoders. Treat the candidate as speech with a filler omitted, not a strict verbatim transcript.'},
 'jussi-talk-q01':{
   'classification':'speech-edit-difference',
   'note':'Whisper supports the caption wording. Parakeet includes the restart “not a not a pro uh roadblock” in both decoders. The candidate removes the repetition and stumble; label it as lightly edited speech rather than strict verbatim.'},
}


def run():
    greedy_manifest=read_json(HERE/'review-pass/parakeet-greedy/manifest.json')
    beam_manifest=read_json(HERE/'review-pass/parakeet-beam/manifest.json')
    assert len(greedy_manifest['sources'])==28 and len(beam_manifest['sources'])==10
    assert greedy_manifest['model']==beam_manifest['model']=='mlx-community/parakeet-tdt-0.6b-v3'
    source_map={s['id']:s for s in greedy_manifest['sources']}
    beam_map={s['id']:s for s in beam_manifest['sources']}
    index=read_json(HERE/'excerpt-index.json')['quoteWindows']
    library=read_json(HERE/'content-library.json')
    assert len(index)==22
    comparisons=[]
    for quote in index:
        qid=quote['id']; source=source_map[qid]; result=read_json(HERE/source['result'])
        match=normalize(quote['text']) in normalize(result['text'])
        finding=FINDINGS.get(qid)
        assert match == (finding is None),(qid,match)
        record={'quoteId':qid,'videoId':quote['videoId'],'captionText':quote['text'],
                'normalizedCaptionMatch':match,'greedyResult':source['result'],'greedyText':result['text'],
                'audio':source['audio'],'audioStart':source['start'],'audioEnd':source['end'],
                'audioSHA256':hashlib.sha256((HERE/source['audio']).read_bytes()).hexdigest(),
                'classification':finding['classification'] if finding else 'normalized-wording-match',
                'note':finding['note'] if finding else 'The caption candidate is present in both fresh Whisper and independent-family Parakeet ASR after case and punctuation normalization. Editorial listening and approval remain pending.'}
        if qid in beam_map:
            path=beam_map[qid]['result'];record.update(beamResult=path,beamText=read_json(HERE/path)['text'])
        if finding and finding.get('contextId'):
            cid=finding['contextId'];s=source_map[cid]
            record['widerContext']={'id':cid,'audio':s['audio'],'start':s['start'],'end':s['end'],'greedyResult':s['result'],'greedyText':read_json(HERE/s['result'])['text']}
            if cid in beam_map:
                path=beam_map[cid]['result'];record['widerContext'].update(beamResult=path,beamText=read_json(HERE/path)['text'])
        comparisons.append(record)
    counts={'quoteCandidates':22,'greedyAudioChecks':28,'beamAudioChecks':10,
            'normalizedQuoteMatches':sum(c['normalizedCaptionMatch'] for c in comparisons),
            'speechEditDifferences':sum(c['classification']=='speech-edit-difference' for c in comparisons),
            'wordingReviewNeeded':sum(c['classification']=='wording-review-needed' for c in comparisons),
            'unresolvedIndividualAttributions':1}
    assert counts['normalizedQuoteMatches']==16 and counts['speechEditDifferences']==2 and counts['wordingReviewNeeded']==4
    cache=Path('/Users/juhovepsalainen/.cache/huggingface/hub/models--mlx-community--parakeet-tdt-0.6b-v3/refs/main')
    metadata_files=list((Path(greedy_manifest['executable']).resolve().parent.parent/'lib').glob('python*/site-packages/parakeet_mlx-*.dist-info/METADATA'))
    assert len(metadata_files)==1
    version=next(line.split(':',1)[1].strip() for line in metadata_files[0].read_text().splitlines() if line.startswith('Version:'))
    report={'reviewedAt':datetime.now(timezone.utc).isoformat(),'tool':'parakeet-mlx','toolVersion':version,
            'model':greedy_manifest['model'],'modelRevision':cache.read_text().strip() if cache.exists() else None,
            'counts':counts,'method':'Local final-cut audio; Parakeet greedy on all 22 quote windows and six wider context windows, then beam decoding on ten flagged quote/context windows. No candidate wording hints were supplied.',
            'independence':'Parakeet is a different ASR model family from Whisper. Greedy and beam are alternative decoders of the same Parakeet model, not independent recognizers.',
            'directListeningPerformed':False,'speakerDiarizationPerformed':False,'recordingsUploaded':False,
            'limits':'ASR agreement is supporting evidence, not a guarantee of exact wording. Parakeet does not resolve the unnamed final-panel respondent. All proposed clips still require a complete audiovisual editorial pass.',
            'comparisons':comparisons,
            'contextChecks':[{**s,'text':read_json(HERE/s['result'])['text']} for s in greedy_manifest['sources'] if s['kind']=='context']}
    by_id={c['quoteId']:c for c in comparisons}
    for item in library['items']:
        item['analysisStatus']='Caption, Whisper and Parakeet ASR, contextual attribution and sampled-frame review complete; direct listening and publication approval pending.'
        for q in item['quoteCandidates']:
            c=by_id[q['id']]
            q['parakeetReview']=c
            q['verificationNote']=c['note']
            q['wordingStatus']={'normalized-wording-match':'Supported by two ASR model families after normalization; not listening-approved.',
                                'speech-edit-difference':'Lightly edited speech; filler or restart difference flagged.',
                                'wording-review-needed':'Exact wording remains unresolved; listening required.'}[c['classification']]
            q['quotationStyle']='Caption-based candidate; not guaranteed strict verbatim.'
            if q['id'] in FINDINGS and FINDINGS[q['id']].get('paraphrase'):
                q['suggestedParaphrase']=FINDINGS[q['id']]['paraphrase']
    library['parakeetPass']=report
    library['counts'].update(quoteWordingFlags=4,unresolvedWordingDifferences=4,parakeetNormalizedQuoteMatches=16,parakeetSpeechEditDifferences=2,parakeetAudioChecks=28,parakeetBeamChecks=10)
    library['methodology']['limits'][1]='Four candidates need exact-wording listening checks: Jenni’s customer article, Joongi’s survey term, the final-panel humans/women word, and Sini’s mood-film pronoun. Two other candidates omit speech fillers or restarts. The final-panel quote still has no confirmed individual respondent.'
    basis=' An independent-family Parakeet-MLX pass then checked all 22 quote windows and six wider context windows, with beam-decoder checks on ten flagged windows. It supports 16 normalized candidate wordings, identifies two speech-edit differences and leaves four exact-wording flags.'
    if basis not in library['methodology']['basis']:library['methodology']['basis']+=basis
    library['methodology']['audioMethod']=f'Whisper.cpp large-v3-q5_0 and unquantized large-v3, plus Parakeet-MLX {version} with mlx-community/parakeet-tdt-0.6b-v3. All audio processing was local. The Parakeet pass provides a comparison across model families; greedy/beam variants within it are correlated checks.'
    if library.get('reviewPass'):
        library['reviewPass']['status']='Historical Whisper context and attribution pass; see parakeetPass for the latest wording review.'
    save('review-pass/parakeet-review.json',report)
    save('content-library.json',library)
    validation=read_json(HERE/'validation-report.json')
    validation['counts']=library['counts']
    validation['wordingFlags']={qid:f['note'] for qid,f in FINDINGS.items() if f['classification']=='wording-review-needed'}
    validation['checks']=[('All original Whisper/caption wording differences and the additional Parakeet pronoun difference are explicitly flagged.' if c=='All three ASR wording differences are explicitly flagged.' else c) for c in validation['checks']]
    validation['parakeetPass']={'status':'passed','report':'review-pass/parakeet-review.json','counts':counts,
                               'checks':['All 22 quote windows and six context windows have Parakeet greedy JSON results.','All ten selected windows have beam JSON results.','All quote results have matching IDs, source audio fingerprints and retained final-video offsets.','Every normalized wording mismatch is classified and has an editorial note.'],
                               'remaining':'Four exact-wording flags and one unnamed panel respondent; direct listening and full clip review still pending.'}
    save('validation-report.json',validation)
    print(json.dumps(counts))


if __name__=='__main__':run()
