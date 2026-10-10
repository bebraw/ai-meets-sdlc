"""Phrase-aware, sample-aligned edit of CSoul's CC BY 3.0 vocal/instrumental mixes."""
import json
import subprocess
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
MUSIC = ROOT/'production/intro/music'
OUT = ROOT/'output/intro'
SR, DURATION = 48000, 196.8


def decode(path):
    raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-ar',str(SR),'-ac','2','-f','f32le','-'])
    return np.frombuffer(raw,dtype='<f4').reshape(-1,2)


vocal, instrumental = decode(MUSIC/'vocal.mp3'), decode(MUSIC/'instrumental.mp3')
n=round(DURATION*SR)
# The original mixes share a sample-aligned backing. Match backing amplitude
# before crossfading; this avoids a gain jump when the vocals disappear.
gain=float(np.sum(vocal[:n]*instrumental[:n])/np.sum(instrumental[:n]**2))
vocal=vocal[:n]/gain
weight=np.zeros(n,dtype=np.float32)
weight[:round(20.0*SR)]=1
weight[round(20.0*SR):round(20.4*SR)]=np.linspace(1,0,round(.4*SR))
weight[round(166.6*SR):round(167.1*SR)]=np.linspace(0,1,round(.5*SR))
weight[round(167.1*SR):round(190.8*SR)]=1
weight[round(190.8*SR):round(192*SR)]=np.linspace(1,0,round(1.2*SR))
mix=instrumental[:n]*(1-weight[:,None])+vocal*weight[:,None]
mix[:round(.6*SR)]*=np.linspace(0,1,round(.6*SR))[:,None]
mix[-round(4.8*SR):]*=np.linspace(1,0,round(4.8*SR))[:,None]
raw=OUT/'music-edit.f32'
raw.write_bytes(mix.astype('<f4').tobytes())
subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(SR),'-ac','2','-i',str(raw),'-af','loudnorm=I=-16:TP=-1.5:LRA=11','-ar',str(SR),'-c:a','pcm_s24le',str(OUT/'music-edit.wav')],check=True)
raw.unlink()
(OUT/'music-credit.txt').write_text('"A Foolish Game" by CSoul featuring snowflake\nhttps://ccmixter.org/files/CSoul/46765\nLicensed under Creative Commons Attribution 3.0\nhttps://creativecommons.org/licenses/by/3.0/\nChanges: trimmed; vocal and instrumental versions crossfaded; fades and loudness adjusted.\n\nMusic only is covered by the above licence.\n')
(OUT/'music-edit.json').write_text(json.dumps({'source_gain_ratio':gain,'duration':DURATION,'vocal_sections':[[0,20.4],[166.6,192]],'sample_rate':SR,'loudness_target':'-16 LUFS, -1.5 dBTP'},indent=2)+'\n')
print('Music edit ready:',OUT/'music-edit.wav')
