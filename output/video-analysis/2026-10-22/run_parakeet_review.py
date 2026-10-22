"""Run independent-family local ASR on the quote and handoff evidence."""
import argparse
import json
import shutil
import subprocess
from datetime import datetime, timezone
from library_tools import HERE, read_json

MODEL='mlx-community/parakeet-tdt-0.6b-v3'

def run(decoding):
    output=HERE/'review-pass'/f'parakeet-{decoding}'
    output.mkdir(parents=True,exist_ok=True)
    quotes=read_json(HERE/'excerpt-index.json')['quoteWindows']
    context=read_json(HERE/'review-pass/context-index.json')['windows']
    sources=[{'id':q['id'],'videoId':q['videoId'],'audio':q['audio'],'start':q['audioStart'],'end':q['audioEnd'],'kind':'quote'} for q in quotes]
    sources +=[{**{k:w[k] for k in ['id','videoId','audio','start','end']},'kind':'context'} for w in context]
    if decoding=='beam':
        # Only repeat disputed wording and the corresponding short extracts.
        disputed={'jenni-talk-q02','joongi-talk-q02','final-panel-q01','jenni-wording','joongi-wording','final-wording-and-turn',
                  'joongi-talk-q01','jussi-talk-q01','mood-q01','mood-sini-original'}
        sources=[s for s in sources if s['id'] in disputed]
    pending=[s for s in sources if not (output/(s['id']+'.json')).exists()]
    executable=shutil.which('parakeet-mlx')
    if not executable:raise RuntimeError('The installed parakeet-mlx command is not on PATH.')
    command=[executable,*[str(HERE/s['audio']) for s in pending],
             '--model',MODEL,'--output-dir',str(output),'--output-format','json','--decoding',decoding]
    if pending:
        print(f'Running {decoding} Parakeet review on {len(pending)} local audio files.',flush=True)
        subprocess.run(command,check=True)
    for source in sources:
        path=output/(source['id']+'.json')
        if not path.exists():raise FileNotFoundError(path)
        source['result']=str(path.relative_to(HERE))
    manifest={'runAt':datetime.now(timezone.utc).isoformat(),'model':MODEL,'decoding':decoding,
              'executable':executable,'command':command,'sources':sources,
              'method':'Local Parakeet ASR of final-cut audio. Different model family from Whisper; not direct assistant listening, speaker diarization, or publication approval.'}
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(f'Completed {len(sources)} {decoding} audio checks.',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--decoding',choices=['greedy','beam'],default='greedy');run(parser.parse_args().decoding)
