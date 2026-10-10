"""Verify the exports, write a delivery report and extract a visual review sheet."""
import json
import re
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/intro'
plan=json.loads((ROOT/'production/intro/timeline.json').read_text())


def probe(path):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)],text=True))


# Rewrap without recompression so the 4K file can begin playing immediately.
master=OUT/'sdlcai-intro-4k.mp4'
temp=OUT/'sdlcai-intro-faststart.mp4'
credit='A Foolish Game by CSoul featuring snowflake. CC BY 3.0. https://ccmixter.org/files/CSoul/46765. Trimmed, crossfaded and mixed.'
subprocess.run(['ffmpeg','-v','error','-y','-i',str(master),'-c','copy','-movflags','+faststart','-metadata','title=SDLCAI 2026 - AI meets SDLC','-metadata','comment='+credit,str(temp)],check=True)
temp.replace(master)

files={}
for key,filename,width,height in [('master','sdlcai-intro-4k.mp4',3840,2160),('preview','sdlcai-intro-preview.mp4',1920,1080)]:
    p=probe(OUT/filename)
    video=next(s for s in p['streams'] if s['codec_type']=='video')
    audio=next(s for s in p['streams'] if s['codec_type']=='audio')
    assert (video['width'],video['height'])==(width,height)
    assert video['r_frame_rate']=='24/1'
    assert int(video['nb_frames'])==4723
    assert audio['channels']==2 and audio['sample_rate']=='48000'
    assert abs(float(p['format']['duration'])-plan['duration'])<.05
    files[key]={'path':filename,'width':width,'height':height,'fps':24,'frames':int(video['nb_frames']),'duration':float(p['format']['duration']),'bytes':int(p['format']['size']),'video_codec':video['codec_name'],'audio_codec':audio['codec_name']}

black_events=re.findall(r'black_start:[^\r\n]+',(OUT/'video-qc.log').read_text())
assert not black_events,black_events
audio_log=(OUT/'audio-qc.log').read_text()
levels=json.loads(re.search(r'\{\s*"input_i".*?\}',audio_log,re.S).group())
assert float(levels['input_tp'])<0
report={'files':files,'audio_measured':{'integrated_lufs':float(levels['input_i']),'true_peak_dbtp':float(levels['input_tp']),'loudness_range_lu':float(levels['input_lra'])},'full_video_decode':'passed','unexpected_black_gaps':black_events,'speakers':10,'music_credit_in_film':True}
(OUT/'render-report.json').write_text(json.dumps(report,indent=2)+'\n')

times=[round((e['start']+3)*24) for e in plan['cards'] if e['card'].startswith('speaker-')]
select="select='"+'+'.join('eq(n,%d)'%n for n in times)+"',scale=960:540,tile=2x5"
subprocess.run(['ffmpeg','-v','error','-y','-i',str(OUT/'sdlcai-intro-preview.mp4'),'-vf',select,'-frames:v','1',str(OUT/'speaker-review.jpg')],check=True)
subprocess.run(['ffmpeg','-v','error','-y','-ss','14','-i',str(master),'-frames:v','1',str(OUT/'poster.jpg')],check=True)
print(json.dumps(report,indent=2))
