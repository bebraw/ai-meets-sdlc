"""Predefined clause/sentence/context checks for the four wording flags."""
import hashlib
import json
import shutil
import subprocess
from datetime import datetime,timezone
from library_tools import HERE,ROOT,read_json

OUT=HERE/'review-pass/focused-parakeet'
CASES=[
 ('jenni','jenni-talk',[(1234.5,1240),(1231.5,1250.5),(1210,1260)]),
 ('joongi','joongi-talk',[(1048,1054),(1041,1055),(1025,1075)]),
 ('final','final-panel',[(1538,1544.5),(1530,1551),(1493,1554)]),
 ('mood','mood',[(35.2,43.7),(30,49.6),(0,49.6)]),
 ('mood-original','industry-panel',[(187.1,195.2),(183,196),(174,201)]),
]
OUT.mkdir(exist_ok=True)
sources={x['id']:x for x in read_json(HERE/'source-index.json')['items']}
manifest={'createdAt':datetime.now(timezone.utc).isoformat(),
          'purpose':'Predefined context-sensitivity checks for the four flagged wordings, including the original source of the mood-film excerpt.',
          'method':'Fresh 16 kHz mono PCM extracts from the final 4K masters, with clause, sentence and wider-context windows. No audio filtering, speech-rate change, wording hints or language prompts. Same Parakeet model as the prior pass; two decoder settings are correlated checks.',
          'model':'mlx-community/parakeet-tdt-0.6b-v3','windows':[]}
for case,video,ranges in CASES:
    source=sources[video]
    for label,(start,end) in zip(['clause','sentence','context'],ranges):
        name=f'{case}-{label}';wav=OUT/f'{name}.wav'
        assert 0<=start<end<=source['durationSeconds']
        if not wav.exists():
            subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(start),'-i',str(ROOT/source['videoFile']),'-t',str(end-start),'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',str(wav)],check=True)
        manifest['windows'].append({'id':name,'case':case,'videoId':video,'window':label,'start':start,'end':end,
                                    'sourceMaster':source['videoFile'],'audio':str(wav.relative_to(HERE)),
                                    'audioSHA256':hashlib.sha256(wav.read_bytes()).hexdigest()})
    print(f'Prepared {case} master-audio windows.',flush=True)
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
executable=shutil.which('parakeet-mlx')
if not executable:raise RuntimeError('parakeet-mlx is missing from PATH')
for decoding in ['greedy','beam']:
    output=OUT/decoding;output.mkdir(exist_ok=True)
    pending=[w for w in manifest['windows'] if not (output/f"{w['id']}.json").exists()]
    if pending:
        print(f'Transcribing {len(pending)} fresh windows with {decoding} decoding.',flush=True)
        subprocess.run([executable,*[str(HERE/w['audio']) for w in pending],
                        '--model',manifest['model'],'--output-dir',str(output),'--output-format','json','--decoding',decoding],check=True)
    for window in manifest['windows']:
        file=output/f"{window['id']}.json"
        if not file.exists():raise FileNotFoundError(file)
        window[decoding]={'result':str(file.relative_to(HERE)),'text':read_json(file)['text']}
manifest['completedAt']=datetime.now(timezone.utc).isoformat()
manifest['directListeningPerformed']=False
manifest['recordingsUploaded']=False
(OUT/'results.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('Completed 15 fresh master-audio crops with both decoders.',flush=True)
