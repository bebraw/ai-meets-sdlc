"""Match candidate quotes to captions and gather local audio/visual evidence."""
from pathlib import Path
import argparse,json,re,subprocess
from library_tools import HERE,ROOT,read_json,stamp

def normal(text):
    return re.sub(r'\s+',' ',text).strip().replace('’',"'").lower()

def prepare():
    for folder in ['audio','frames','contacts','asr','logs']:(HERE/folder).mkdir(exist_ok=True)
    index=[];frames=[]
    for file in sorted((HERE/'items').glob('*.json')):
        item=read_json(file);source=read_json(HERE/'sources'/file.name)
        all_text='';spans=[]
        for cue in source['cues']:
            text=normal(cue['text']);start=len(all_text)
            all_text+=text+' ';spans.append((start,len(all_text),cue))
        for number,quote in enumerate(item.get('quoteCandidates',[]),1):
            wanted=normal(quote['text']);matches=list(re.finditer(re.escape(wanted),all_text))
            if len(matches)!=1:raise ValueError(f"{item['id']}: quote has {len(matches)} matches: {wanted}")
            match=matches[0]
            cues=[cue for start,end,cue in spans if end>match.start() and start<match.end()]
            qid=f"{item['id']}-q{number:02}"
            start=max(3,cues[0]['start']-6);end=min(source['durationSeconds']-6,cues[-1]['end']+6)
            wav=HERE/'audio'/f'{qid}.wav'
            if not wav.exists():
                subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(start),'-i',str(ROOT/source['reviewFile']),'-t',str(end-start),'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',str(wav)],check=True)
            index.append({'id':qid,'videoId':item['id'],'text':quote['text'],'speaker':quote['speaker'],'quoteStart':cues[0]['start'],'quoteEnd':cues[-1]['end'],'cueIds':[c['id'] for c in cues],'audioStart':start,'audioEnd':end,'audio':str(wav.relative_to(HERE)),'asr':f'asr/{qid}.json','captionContext':' '.join(c['text'] for c in source['cues'] if c['end']>=start and c['start']<=end),'overlappingListeningFlags':[f['id'] for f in source['listeningWindows'] if f['startSeconds']<end and f['endSeconds']>start]})
        images=[]
        for number,clip in enumerate(item.get('clipCandidates',[]),1):
            position=(clip['start']+clip['end'])/2
            image=HERE/'frames'/f"{item['id']}-{number:02}.jpg"
            if not image.exists():
                subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(position),'-i',str(ROOT/source['reviewFile']),'-frames:v','1','-vf','scale=1280:-2','-q:v','2',str(image)],check=True)
            images.append(image)
            frames.append({'videoId':item['id'],'time':position,'path':str(image.relative_to(HERE)),'clip':clip['title']})
        contact=HERE/'contacts'/f"{item['id']}.jpg"
        if images and not contact.exists():
            subprocess.run(['magick',*[str(p) for p in images],'-append',str(contact)],check=True)
        print(f"{item['id']}: {len(item.get('quoteCandidates',[]))} quote windows, {len(images)} frames",flush=True)
    (HERE/'excerpt-index.json').write_text(json.dumps({'timebase':'Final edited videos','quoteWindows':index,'frames':frames},ensure_ascii=False,indent=2)+'\n')

def transcribe():
    index=read_json(HERE/'excerpt-index.json')['quoteWindows']
    pending=[q for q in index if not (HERE/q['asr']).exists()]
    if not pending:print('All excerpt ASR files already exist.');return
    model=Path('/Users/juhovepsalainen/Models/whisper-cpp/ggml-large-v3-q5_0.bin')
    command=['whisper-cli','-m',str(model),'-t','4','-l','en','-mc','0','-oj','-nt','-np']
    for q in pending:command.extend(['-f',str(HERE/q['audio']),'-of',str((HERE/q['asr']).with_suffix(''))])
    # whisper-cli associates one output prefix with each input file.
    with (HERE/'logs/excerpt-asr.log').open('a') as log:
        subprocess.run(command,stdout=log,stderr=log,check=True)
    for q in pending:
        if not (HERE/q['asr']).exists():raise FileNotFoundError(q['asr'])
    print(f"Transcribed {len(pending)} final-cut quote windows locally.",flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('action',choices=['prepare','transcribe']);args=ap.parse_args()
    prepare() if args.action=='prepare' else transcribe()
