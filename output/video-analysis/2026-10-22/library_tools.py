"""Local, read-only source preparation for the SDLCAI content library."""
from pathlib import Path
import argparse, hashlib, json, re

HERE = Path(__file__).resolve().parent
ROOT = Path('/Volumes/LaCie/SDLCAI/2026/post-production-2026-10-18')

def read_json(path):
    return json.loads(path.read_text())

def stamp(seconds):
    seconds = int(seconds)
    return f'{seconds//3600}:{seconds%3600//60:02}:{seconds%60:02}' if seconds >= 3600 else f'{seconds//60:02}:{seconds%60:02}'

def seconds(stamp):
    return sum(float(n)*60**i for i,n in enumerate(stamp.replace(',', '.').split(':')[::-1]))

def parse_srt(text):
    cues = []
    for block in re.split(r'\n\s*\n', text.strip()):
        lines = block.splitlines()
        if len(lines) < 3 or ' --> ' not in lines[1]:
            continue
        start, end = lines[1].split(' --> ')
        cues.append({'id':int(lines[0]), 'start':seconds(start), 'end':seconds(end), 'text':' '.join(lines[2:])})
    return cues

def initialise():
    package = read_json(ROOT/'metadata/upload-package-final-v08.json')
    priorities = read_json(ROOT/'transcripts/final-v02/caption-listening-priorities-v01.json')
    (HERE/'sources').mkdir(parents=True, exist_ok=True)
    (HERE/'items').mkdir(exist_ok=True)
    records = []
    for raw in package['items']:
        captions = ROOT/raw['captions']['srt']
        cues = parse_srt(captions.read_text())
        media = ROOT/raw['reviewFile']
        record = {k:raw[k] for k in ['id','kind','officialTitle','speakerNames','durationSeconds','videoFile','reviewFile','chapters','materials','talkUrl'] if k in raw}
        record.update({'existingSummary':raw.get('summary'), 'captions':raw['captions'],
                       'captionSHA256':hashlib.sha256(captions.read_bytes()).hexdigest(),
                       'mediaBytes':media.stat().st_size,'cueCount':len(cues),
                       'listeningWindows':[x for x in priorities['windows'] if x['videoId']==raw['id'] and x['priority'] in ['high','normal']],
                       'cues':cues})
        (HERE/'sources'/f"{raw['id']}.json").write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
        records.append({k:v for k,v in record.items() if k not in ['cues','listeningWindows']})
    (HERE/'source-index.json').write_text(json.dumps({'productionRoot':str(ROOT),'publicationPackage':'metadata/upload-package-final-v08.json','timebase':'Edited video seconds; title cards are already included.','items':records},ensure_ascii=False,indent=2)+'\n')
    print(f'Prepared {len(records)} final-cut source records.')

def transcript(video, start=0, end=1e9):
    data=read_json(HERE/'sources'/f'{video}.json')
    print(data['officialTitle'], '|', ', '.join(data['speakerNames']))
    chapters=iter(data['chapters']); chapter=next(chapters,None)
    chunk=[]; beginning=None; finish=None
    def output():
        if chunk:print(f'[{stamp(beginning)}–{stamp(finish)}] '+ ' '.join(chunk))
    for cue in data['cues']:
        if cue['end']<start or cue['start']>end:continue
        if chapter and cue['start'] >= chapter['outputSeconds']:
            output();chunk=[];beginning=None
            while chapter and cue['start']>=chapter['outputSeconds']:
                print(f"\nCHAPTER {chapter['timestamp']} {chapter['title']}")
                chapter=next(chapters,None)
        if beginning is None:beginning=cue['start']
        finish=cue['end'];chunk.append(cue['text'])
        if finish-beginning>=45:
            output();chunk=[];beginning=None
    output()
    print('\nFLAGGED LISTENING WINDOWS:')
    for flag in data['listeningWindows']:
        print(f"{stamp(flag['startSeconds'])}–{stamp(flag['endSeconds'])} {flag['priority']}: {flag['note']}")

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['init','read']);parser.add_argument('video',nargs='?');parser.add_argument('--start',type=float,default=0);parser.add_argument('--end',type=float,default=1e9)
    args=parser.parse_args()
    if args.action=='init':initialise()
    else:transcript(args.video,args.start,args.end)
