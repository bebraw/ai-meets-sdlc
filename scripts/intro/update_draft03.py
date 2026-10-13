"""Refresh existing Draft 03 titles from the validated live programme.

Run inside the original Blender scene after sync_programme.mjs. Saves a separate
dated blend file and prepares a separate render directory. Unchanged native
frames are reused; changed speaker intervals must be freshly rendered.
"""
from pathlib import Path
import json
import os
import shutil
import sys
import textwrap

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_draft03_titles import BALANCED_TITLES


def main():
    snapshot = json.loads((ROOT / "production/intro/live-programme.json").read_text())
    timeline_path = ROOT / "production/intro/draft-03-timeline.json"
    timeline = json.loads(timeline_path.read_text())
    scene = next(s for s in bpy.data.scenes if s.get("revision") == "draft-03")
    previous = json.loads(scene["editorial_timeline"])
    appearances = [e for e in previous["entries"] if e["kind"] == "speaker"]
    if [e["speakerId"] for e in appearances] != [r["speakerId"] for r in snapshot["programme"]]:
        raise ValueError("Programme order changed; review the editorial timeline before updating.")
    if previous["entries"] != timeline["entries"]:
        raise ValueError("Scene and source timeline differ; open the original Draft 03 scene.")
    stamp = snapshot["updatedAt"][:10].replace("-", "")
    output = ROOT / "output/intro" / ("draft-03-" + stamp)
    blend = ROOT / "output/intro" / ("draft-03-" + stamp + ".blend")
    if blend.exists() or output.exists():
        raise FileExistsError("Preserving existing revised film: " + str(output))
    bpy.context.window.scene = scene
    rows = {row["speakerId"]: row for row in snapshot["programme"]}
    changes = []
    reports = json.loads(scene["title_report"])
    for entry in timeline["entries"]:
        if entry["kind"] != "speaker":
            continue
        row = rows[entry["speakerId"]]
        for field in ("sessionId", "sessionTitle", "sessionStart", "speakerName", "portraitUrl"):
            if entry[field] != row[field]:
                raise ValueError("Non-title programme change needs a full review: " + field)
        if entry["talkTitle"] == row["talkTitle"]:
            continue
        obj = scene.objects["SDLCAI-D03/TITLES/talk " + entry["speakerId"]]
        if obj.data.users != 1:
            raise ValueError("Title uses shared data: " + obj.name)
        old_title = entry["talkTitle"]
        body = BALANCED_TITLES.get(entry["speakerId"], "")
        if " ".join(body.split()) != " ".join(row["talkTitle"].split()):
            body = "\n".join(textwrap.wrap(row["talkTitle"], width=28,
                                         break_long_words=False, break_on_hyphens=False))
        obj.data.body = body
        obj["published_title"] = row["talkTitle"]
        scene.frame_set(entry["start"])
        scene.view_layers[0].update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        depsgraph.update()
        evaluated = obj.evaluated_get(depsgraph)
        points = [evaluated.matrix_world @ Vector(co) for co in evaluated.bound_box]
        bounds = {"left": min(p.x for p in points), "right": max(p.x for p in points),
                  "bottom": min(p.y for p in points), "top": max(p.y for p in points)}
        if not (bounds["left"] >= -8.92 and bounds["right"] <= 2.85 and bounds["bottom"] >= -2.9):
            raise ValueError("Revised title needs a layout review: " + body)
        obj["verified_bounds"] = json.dumps(bounds)
        entry.update(row)
        report = next(r for r in reports if r["entryId"] == entry["id"])
        report.update(body=body, bounds=bounds)
        changes.append({"speakerId": entry["speakerId"], "oldTitle": old_title,
                        "title": row["talkTitle"], "start": entry["start"], "end": entry["end"],
                        "bounds": bounds, "fontSize": obj.data.size})
    if not changes:
        raise ValueError("No changed titles to render.")
    timeline["programmeRevision"] = snapshot["revision"]
    timeline["programmeRetrievedAt"] = snapshot["retrievedAt"]
    scene["editorial_timeline"] = json.dumps(timeline, ensure_ascii=False)
    scene["programme_snapshot"] = json.dumps(snapshot, ensure_ascii=False)
    scene["title_report"] = json.dumps(reports, ensure_ascii=False)
    scene["content_revision"] = snapshot["revision"]
    scene["updated_source_url"] = snapshot["sourceURL"]
    # Recheck straight cuts and fixed transforms at both boundaries and mid-hold.
    for change in changes:
        objects = [o for o in scene.objects if o.get("entryid") == "speaker-" + change["speakerId"]]
        transforms = {o.name: tuple(o.matrix_world) for o in objects}
        for frame in [change["start"] - 1, change["start"],
                      (change["start"] + change["end"]) // 2, change["end"], change["end"] + 1]:
            scene.frame_set(frame)
            hidden = not change["start"] <= frame <= change["end"]
            for obj in objects:
                if obj.hide_render != hidden or obj.hide_viewport != hidden:
                    raise ValueError("Visibility cut changed: " + obj.name)
                if tuple(obj.matrix_world) != transforms[obj.name]:
                    raise ValueError("Programme object moved: " + obj.name)
    frames = output / "frames"
    frames.mkdir(parents=True)
    changed_frames = {f for c in changes for f in range(c["start"], c["end"] + 1)}
    original = ROOT / "output/intro/draft-03"
    for frame in range(timeline["frameStart"], timeline["frameEnd"] + 1):
        source = original / "frames" / f"{frame:04d}.jpg"
        if not source.is_file():
            raise FileNotFoundError(source)
        if frame not in changed_frames:
            os.link(source, frames / source.name)
    for name in ("music.wav", "music-credit.txt", "music-report.json"):
        shutil.copyfile(original / name, output / name)
    timeline_path.write_text(json.dumps(timeline, indent=2, ensure_ascii=False) + "\n")
    (output / "title-update.json").write_text(json.dumps({
        "revision": snapshot["revision"], "sourceURL": snapshot["sourceURL"],
        "changes": changes, "unchangedFrames": timeline["frameEnd"] - len(changed_frames),
        "framesToRender": len(changed_frames), "staticHoldsVerified": True,
    }, indent=2, ensure_ascii=False) + "\n")
    scene.frame_set((changes[-1]["start"] + changes[-1]["end"]) // 2)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    return {"blend": str(blend), "output": str(output), "changes": changes,
            "framesToRender": len(changed_frames)}


if __name__ == "__main__":
    print(json.dumps(main(), ensure_ascii=False))
