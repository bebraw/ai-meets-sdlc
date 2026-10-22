"""Additional local ASR context checks; never label these as direct listening."""
import json
import subprocess
from pathlib import Path
from library_tools import HERE, ROOT, read_json

OUT=HERE/'review-pass'
OUT.mkdir(exist_ok=True)
WINDOWS=[
    {'id':'jenni-wording','videoId':'jenni-talk','start':1215,'end':1257},
    {'id':'joongi-wording','videoId':'joongi-talk','start':1036,'end':1066},
    {'id':'final-wording-and-turn','videoId':'final-panel','start':1469,'end':1561},
    {'id':'industry-handoff','videoId':'industry-panel','start':808,'end':895},
    {'id':'research-handoff','videoId':'research-panel','start':928,'end':983},
    {'id':'mood-sini-original','videoId':'industry-panel','start':164,'end':201},
]
for window in WINDOWS:
    source=read_json(HERE/'sources'/f"{window['videoId']}.json")
    wav=OUT/f"{window['id']}.wav"
    if not wav.exists():
        subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(window['start']),'-i',str(ROOT/source['reviewFile']),'-t',str(window['end']-window['start']),'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',str(wav)],check=True)
    window['audio']=str(wav.relative_to(HERE))
    window['asr']=str((OUT/f"{window['id']}-large-v3.json").relative_to(HERE))
    window['captionContext']=' '.join(c['text'] for c in source['cues'] if c['end']>window['start'] and c['start']<window['end'])
(OUT/'context-index.json').write_text(json.dumps({'method':'Unquantized Whisper large-v3 with wider context, no supplied wording hints. Same model family as the existing captions; not direct listening.','windows':WINDOWS},ensure_ascii=False,indent=2)+'\n')
pending=[w for w in WINDOWS if not (HERE/w['asr']).exists()]
if pending:
    command=['whisper-cli','-m','/Users/juhovepsalainen/Models/whisper-cpp/ggml-large-v3.bin','-t','4','-l','en','-mc','0','-ojf','-nt','-np']
    for window in pending:
        command.extend(['-f',str(HERE/window['audio']),'-of',str((HERE/window['asr']).with_suffix(''))])
    with (OUT/'context-asr.log').open('a') as log:
        subprocess.run(command,stdout=log,stderr=log,check=True)
for window in WINDOWS:
    result=read_json(HERE/window['asr'])
    print(window['id']+': '+' '.join(t['text'].strip() for t in result['transcription']),flush=True)
