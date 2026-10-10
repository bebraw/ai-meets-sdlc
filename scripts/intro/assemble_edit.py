"""Assemble the editable Blender Video Sequencer master from rendered sources."""
import bpy
import json
import shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/intro'
GEN=ROOT/'production/intro/generated'
MEDIA=OUT/'media'
(MEDIA/'cards').mkdir(parents=True,exist_ok=True)
plan=json.loads((ROOT/'production/intro/timeline.json').read_text())
FPS=plan['fps']
PLACEHOLDERS=globals().get('PLACEHOLDERS',False)
s=bpy.data.scenes.get('SDLCAI / EDIT') or bpy.data.scenes.new('SDLCAI / EDIT')
if s.sequence_editor:
    s.sequence_editor_clear()
for old in list(bpy.data.sounds):
    if old.users==0 and Path(old.filepath).name=='music-edit.wav':
        bpy.data.sounds.remove(old)
ed=s.sequence_editor_create()
s.timeline_markers.clear()
s.render.engine='BLENDER_EEVEE'
s.render.resolution_x,s.render.resolution_y=3840,2160
s.render.resolution_percentage=100
s.render.fps=FPS
s.frame_start,s.frame_end=1,round(plan['duration']*FPS)
s.render.use_sequencer=True
s.render.use_compositing=False
s.render.film_transparent=False
s.view_settings.view_transform='Standard'
s.view_settings.look='None'
s.sequencer_colorspace_settings.name='sRGB'
s.render.image_settings.media_type='VIDEO'
s.render.image_settings.file_format='FFMPEG'
s.render.ffmpeg.format='MPEG4'
s.render.ffmpeg.codec='H264'
s.render.ffmpeg.constant_rate_factor='HIGH'
s.render.ffmpeg.ffmpeg_preset='GOOD'
s.render.ffmpeg.audio_codec='AAC'
s.render.ffmpeg.audio_bitrate=320
s.render.ffmpeg.audio_mixrate=48000
s.render.ffmpeg.audio_channels='STEREO'
s.render.filepath='//sdlcai-intro-4k.mp4'


def frame(t):return round(t*FPS)+1


def key(strip,prop,value,f):
    setattr(strip,prop,value)
    strip.keyframe_insert(prop,frame=f)


ground=ed.strips.new_effect('BLACK / film ground',type='COLOR',channel=1,frame_start=1,length=s.frame_end)
ground.color=(0,0,0)

# Camera cuts follow musical bars. The opening assembly is used only once.
order=[0,1,2,3,1,2,3,2,1,3,2,1,3,2,1,3,2,1,3,3,3]
for i,start in enumerate([j*9.6 for j in range(21)]):
    if start>=plan['duration']:break
    end=min(start+9.6,plan['duration'])
    if start>=187.2:break # the credit card supplies its own full-frame ground
    f0,f1=frame(start),frame(end)
    ch=2+i%2
    path=GEN/('shot-%02d.mp4'%order[i])
    if path.exists():
        portable=MEDIA/path.name
        if not portable.exists() or path.stat().st_mtime_ns>portable.stat().st_mtime_ns:shutil.copy2(path,portable)
        path=portable
        strip=ed.strips.new_movie('%02d / %s'%(i,plan['shots'][order[i]]),str(path),channel=ch,frame_start=f0,fit_method='FIT')
        strip.filepath='//media/'+path.name
    elif PLACEHOLDERS:
        strip=ed.strips.new_image('PREVIEW / pending camera %02d'%order[i],str(OUT/'machine-4k.jpg'),channel=ch,frame_start=f0)
    else:raise FileNotFoundError(path)
    strip.frame_final_end=f1+6
    strip.blend_type='ALPHA_OVER'
    # Keep the machinery more subdued behind typography than in visual interludes.
    base=.56 if 28.8<=start<168 else .82
    if 9.6<=start<19.2 or start>=168:base=.42
    key(strip,'blend_alpha',0 if i==0 else base,f0)
    key(strip,'blend_alpha',base,f0+(24 if i==0 else 6))
    key(strip,'blend_alpha',base,f1)
    key(strip,'blend_alpha',0,f1+6)

for i,entry in enumerate(plan['cards']):
    f0,f1=frame(entry['start']),frame(entry['end'])
    path=GEN/'cards'/(entry['card']+'.png')
    card_scene=bpy.data.scenes.get('SDLCAI / CARD / '+entry['card'])
    if card_scene:card_scene.render.filepath='//media/cards/'+entry['card']+'.png'
    portable=MEDIA/'cards'/path.name
    if not portable.exists() or path.stat().st_mtime_ns>portable.stat().st_mtime_ns:shutil.copy2(path,portable)
    path=portable
    strip=ed.strips.new_image(entry['card'],str(path),channel=5+i%2,frame_start=f0,fit_method='ORIGINAL')
    strip.directory='//media/cards/'
    strip.frame_final_end=f1
    strip.blend_type='ALPHA_OVER'
    key(strip,'blend_alpha',0,f0)
    key(strip,'blend_alpha',1,f0+10)
    key(strip,'blend_alpha',1,f1-9)
    key(strip,'blend_alpha',0,f1-1)
    if entry['card']=='credits':
        key(strip,'blend_alpha',1,f1-24)
    else:
        strip.transform.scale_x=strip.transform.scale_y=1.014
        strip.transform.offset_y=-16
        for prop in ['scale_x','scale_y','offset_y']:strip.transform.keyframe_insert(prop,frame=f0)
        strip.transform.scale_x=strip.transform.scale_y=1
        strip.transform.offset_y=0
        for prop in ['scale_x','scale_y','offset_y']:strip.transform.keyframe_insert(prop,frame=f0+18)
    marker=s.timeline_markers.new(entry['card'],frame=f0)

sound=ed.strips.new_sound('A Foolish Game / CC BY 3.0 / vocal-led hybrid',str(OUT/'music-edit.wav'),channel=9,frame_start=1)
sound.sound.filepath='//music-edit.wav'
sound.frame_final_end=s.frame_end+1
bpy.context.window.scene=s
if hasattr(bpy.context.workspace,'sequencer_scene'):
    bpy.context.workspace.sequencer_scene=s
s.frame_set(frame(36))
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'sdlcai-intro.blend'))
result={'blend':bpy.data.filepath,'duration_frames':s.frame_end,'strips':len(ed.strips),'placeholders':PLACEHOLDERS}
