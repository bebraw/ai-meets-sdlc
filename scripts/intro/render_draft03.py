"""Render Draft 03 key frames or a resumable native 4K image sequence."""
import argparse
import json
from pathlib import Path
import sys
import time
import bpy

parser = argparse.ArgumentParser()
parser.add_argument("--qa", action="store_true")
parser.add_argument("--start", type=int)
parser.add_argument("--end", type=int)
args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
root = Path(__file__).resolve().parents[2]
output = root / "output/intro/draft-03"
scene = next(s for s in bpy.data.scenes if s.get("revision") == "draft-03")
bpy.context.window.scene = scene
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.color_mode = "RGB"
scene.render.image_settings.quality = 96
folder = output / ("qa" if args.qa else "frames")
folder.mkdir(parents=True, exist_ok=True)
timeline = json.loads(scene["editorial_timeline"])
poses = json.loads(scene["morph_poses"])
if args.qa:
    frames = set((e["start"]+e["end"])//2 for e in timeline["entries"])
    frames.update(p["frame"] for p in poses)
    for p,q in zip(poses,poses[1:]):
        frames.add((p["frame"]+q["frame"])//2)
    for a,b in [(193,423),(423,654),(654,884)]:
        frames.update([round(a+(b-a)*.25),round(a+(b-a)*.75)])
    frames = sorted(frames)
else:
    frames = range(args.start or scene.frame_start,(args.end or scene.frame_end)+1)
reports=[]
for frame in frames:
    destination=folder/f"{frame:04d}.jpg"
    if destination.exists() and not args.qa:continue
    scene.frame_set(frame);scene.view_layers[0].update()
    scene.render.filepath=str(destination)
    started=time.monotonic()
    bpy.ops.render.render(write_still=True,scene=scene.name)
    reports.append({"frame":frame,"seconds":round(time.monotonic()-started,3),"bytes":destination.stat().st_size})
    if args.qa or frame%96==0:print("DRAFT03_PROGRESS "+json.dumps(reports[-1]),flush=True)
(output/("qa-report.json" if args.qa else f"render-{args.start or 1}-{args.end or scene.frame_end}.json")).write_text(json.dumps(reports,indent=2)+"\n")
