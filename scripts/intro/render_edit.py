"""Render the Blender VSE master, in 1080p review or native 4K."""
import bpy
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
s=bpy.data.scenes['SDLCAI / EDIT']
bpy.context.window.scene=s
s.render.resolution_percentage=50 if 'preview' in args else 100
s.render.ffmpeg.constant_rate_factor='MEDIUM' if 'preview' in args else 'HIGH'
s.render.filepath=str(ROOT/'output/intro'/('sdlcai-intro-preview.mp4' if 'preview' in args else 'sdlcai-intro-4k.mp4'))
if 'benchmark' in args:
    s.frame_start,s.frame_end=800,823
    s.render.filepath=str(ROOT/'output/intro/benchmark.mp4')
bpy.ops.render.render(animation=True,scene=s.name)
print('EDIT_COMPLETE',s.render.filepath,flush=True)
