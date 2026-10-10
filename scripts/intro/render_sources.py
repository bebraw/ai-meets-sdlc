"""Resumable native 4K render of editable cards and animated machine shots."""
import bpy
import json
import subprocess
import time
import numpy as np
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/intro'
GEN=ROOT/'production/intro/generated'
plan=json.loads((ROOT/'production/intro/timeline.json').read_text())
started=time.time()

for s in bpy.data.scenes:
    if not s.name.startswith('SDLCAI / CARD / '):continue
    key=s.name.split(' / ')[-1]
    path=GEN/'cards'/(key+'.png')
    if path.exists():continue
    bpy.context.window.scene=s
    s.render.resolution_percentage=100
    s.eevee.taa_render_samples=64
    s.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)
    print('CARD_READY',key,flush=True)

for index,name in enumerate(plan['shots']):
    s=bpy.data.scenes[name]
    bpy.context.window.scene=s
    dest=GEN/('shot-%02d'%index)
    dest.mkdir(parents=True,exist_ok=True)
    movie=GEN/('shot-%02d.mp4'%index)
    if movie.exists():continue
    s.render.resolution_percentage=100
    s.render.compositor_device='GPU'
    s.render.image_settings.file_format='JPEG'
    s.render.image_settings.color_mode='RGB'
    s.render.image_settings.quality=95
    for frame in range(s.frame_start,s.frame_end+1):
        if (GEN/'STOP_RENDER').exists():raise SystemExit('Render stopped by project flag')
        path=dest/('%04d.jpg'%(frame-s.frame_start))
        if path.exists():continue
        s.frame_set(frame)
        s.render.filepath=str(path)
        bpy.ops.render.render(write_still=True)
        if (frame-s.frame_start)%24==0:
            print('RENDER_PROGRESS',index,frame-s.frame_start,'/ 240','elapsed',round(time.time()-started),flush=True)
    check=[]
    for number in [0,239]:
        raw=subprocess.check_output(['/opt/homebrew/bin/ffmpeg','-v','error','-i',str(dest/('%04d.jpg'%number)),'-vf','scale=320:180','-f','rawvideo','-pix_fmt','rgb24','-'])
        check.append(np.frombuffer(raw,dtype=np.uint8).astype(float))
    delta=float(np.abs(check[1]-check[0]).mean())
    if delta<1:raise RuntimeError('Animation evaluation failed: frame difference '+str(delta))
    print('MOTION_VERIFIED',index,round(delta,2),flush=True)
    subprocess.run(['/opt/homebrew/bin/ffmpeg','-v','error','-y','-framerate','24','-i',str(dest/'%04d.jpg'),'-c:v','libx264','-preset','veryfast','-crf','15','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-movflags','+faststart',str(movie)],check=True)
    print('SHOT_READY',str(movie),flush=True)
print('SOURCES_COMPLETE',round(time.time()-started),flush=True)
