"""Render prototype QA frames or resumable full image sequences in Blender."""
import argparse
import json
from pathlib import Path
import sys
import time

import bpy

parser = argparse.ArgumentParser()
parser.add_argument("--qa", action="store_true")
parser.add_argument("--variant", choices=["A", "B", "C"])
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
root = Path(__file__).resolve().parents[2]
output = root / "output/intro/prototypes-02"
output.mkdir(parents=True, exist_ok=True)
reports = []
for scene in bpy.data.scenes:
    variant = scene.get("variant")
    if variant not in ("A", "B", "C") or (args.variant and variant != args.variant):
        continue
    bpy.context.window.scene = scene
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.quality = 96
    folder = output / ("qa" if args.qa else variant.lower() + "-frames")
    folder.mkdir(exist_ok=True)
    frames = [60, 150, 300, 470, 670, 830] if args.qa else range(1, 865)
    for frame in frames:
        path = folder / (f"{variant.lower()}-{frame:04d}.jpg" if args.qa else f"{frame:04d}.jpg")
        if path.exists() and not args.qa:
            continue
        scene.frame_set(frame)
        scene.view_layers[0].update()
        scene.render.filepath = str(path)
        started = time.monotonic()
        bpy.ops.render.render(write_still=True, scene=scene.name)
        reports.append({"variant": variant, "frame": frame, "seconds": round(time.monotonic()-started, 2), "bytes": path.stat().st_size})
        if args.qa or frame % 48 == 0:
            print("PROTOTYPE_PROGRESS " + json.dumps(reports[-1]), flush=True)
(output / ("qa-report.json" if args.qa else "render-"+(args.variant or "all")+".json")).write_text(json.dumps(reports, indent=2))
