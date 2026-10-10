"""Static native typography for the full demoscene draft; no render or save.

Only boolean visibility properties are animated. add_titles returns measured
glyph bounds and hold verification, also saved on scene["title_report"].
"""
from pathlib import Path
import json
import math
import textwrap
import bpy
from mathutils import Vector

PREFIX = "SDLCAI-D03/TITLES"
BALANCED_TITLES = {
    "mo-khazali": "1978:\nThe Last Good Year",
    "ohans-emmanuel": "Zero-trust harnesses for\nagentic software delivery",
    "jenni-kylmakoski": "Why Leaders Should Use AI\nThemselves and Eat Their\nOwn Dog Food?",
    "tapio-pitkaranta": "The Agentic Probe:\nThe Instrument of Agentic\nDiscovery & Engineering",
    "joongi-shin": "Generative UI for users,\nnot just for designers",
    "jussi-hacklin": "Driving AI adoption\nabove targets in highly\nregulated environment",
    "viljami-kuosmanen": "I Let Non-Engineers Vibe-Code\nOur Production Codebase",
    "sini-tistelgren": "AI Factory doesn't eliminate\nthe fundamentals – it just\nhides what's missing,\nuntil it's too late.",
    "zak-allal": "Medical Breakthroughs\nand Scientific Discoveries",
    "muhammad-waseem": "GenAI in Software Engineering:\nWhat Works, What Fails,\nWhat’s Next",
}


def add_titles(scene, ROOT, programme, timeline):
    if scene.get("draft03_titles_added"):
        raise RuntimeError("Preserving existing draft 03 titles; use a fresh scene.")
    generated = Path(ROOT) / "production/intro/generated"
    entries = timeline["entries"]
    speaker_entries = [e for e in entries if e["kind"] == "speaker"]
    if [e["speakerId"] for e in speaker_entries] != [r["speakerId"] for r in programme]:
        raise ValueError("Timeline differs from published speaker order.")
    records = {r["speakerId"]: r for r in programme}
    for entry in speaker_entries:
        row = records[entry["speakerId"]]
        for key in ("speakerName", "talkTitle", "sessionId", "sessionTitle", "sessionStart"):
            if entry.get(key) != row[key]:
                raise ValueError("Stale timeline field: " + key + " / " + row["speakerId"])
        if not (generated / "draft-03-portraits" / (row["speakerId"] + ".png")).is_file():
            raise FileNotFoundError("Current portrait missing: " + row["speakerId"])
    fonts = {key: bpy.data.fonts.load(str(generated / "fonts" / filename), check_existing=True)
             for key, filename in [("headline", "FinlandicaHeadline-Black.ttf"), ("bold", "FinlandicaText-Bold.ttf"), ("body", "FinlandicaText-Regular.ttf")]}

    def material(name, color):
        values = [int(color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        linear = [v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in values]
        mat = bpy.data.materials.new(PREFIX + "/" + name)
        mat.use_nodes = True
        mat.node_tree.nodes.clear()
        emission = mat.node_tree.nodes.new("ShaderNodeEmission")
        emission.inputs[0].default_value = (*linear, 1)
        out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
        mat.node_tree.links.new(emission.outputs[0], out.inputs[0])
        return mat

    white, muted, red = [material(n, c) for n, c in [("white", "f6f4ef"), ("muted", "b7b0a4"), ("red", "d72f2f")]]
    groups, targets = [], []

    def link(name, data, entryid, role):
        obj = bpy.data.objects.new(PREFIX + "/" + name, data)
        scene.collection.objects.link(obj)
        obj["role"], obj["entryid"] = role, entryid
        return obj

    def text(name, body, x, y, size, entryid, font="headline", mat=white, text_role="label"):
        data = bpy.data.curves.new(PREFIX + "/" + name, "FONT")
        data.body, data.size, data.font, data.space_line = body, size, fonts[font], 1.08
        data.materials.append(mat)
        obj = link(name, data, entryid, "programme_text")
        obj["text_role"] = text_role
        obj.location = (x, y, 6)
        return obj

    def rect(name, x, y, width, height, entryid):
        data = bpy.data.meshes.new(PREFIX + "/" + name)
        data.from_pydata([(x, y, 5), (x + width, y, 5), (x + width, y + height, 5), (x, y + height, 5)], [], [(0, 1, 2, 3)])
        data.materials.append(red)
        return link(name, data, entryid, "programme_decoration")

    def portrait(row, entryid):
        image = bpy.data.images.load(str(generated / "draft-03-portraits" / (row["speakerId"] + ".png")), check_existing=True)
        image.pack()
        mat = bpy.data.materials.new(PREFIX + "/portrait " + row["speakerId"])
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        nodes.clear()
        texture, gray, emission, output = [nodes.new(k) for k in ["ShaderNodeTexImage", "ShaderNodeRGBToBW", "ShaderNodeEmission", "ShaderNodeOutputMaterial"]]
        texture.image = image
        texture.extension = "EXTEND"
        mat.node_tree.links.new(texture.outputs["Color"], gray.inputs["Color"])
        mat.node_tree.links.new(gray.outputs[0], emission.inputs[0])
        mat.node_tree.links.new(emission.outputs[0], output.inputs[0])
        x, y, diameter, count = -8.02, 2.07, 1.55, 96
        vertices = [(x, y, 5.5)] + [(x + diameter / 2 * math.cos(i * math.tau / count), y + diameter / 2 * math.sin(i * math.tau / count), 5.5) for i in range(count)]
        data = bpy.data.meshes.new(PREFIX + "/portrait " + row["speakerId"])
        data.from_pydata(vertices, [], [(0, i + 1, (i + 1) % count + 1) for i in range(count)])
        data.materials.append(mat)
        uv = data.uv_layers.new(name="Portrait crop")
        # The current Zak source places his face towards the upper right.
        # Reframe the existing image inside the circle without changing the asset.
        span, center_u, center_v = (.72, .68, .64) if row["speakerId"] == "zak-allal" else (1, .5, .5)
        for loop in data.loops:
            co = data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv = ((co.x - x) / diameter * span + center_u, (co.y - y) / diameter * span + center_v)
        obj = link("portrait " + row["speakerId"], data, entryid, "portrait")
        obj["sourceURL"] = row["portraitUrl"]
        return obj

    def show_interval(objects, entry):
        start, end = entry["start"], entry["end"]
        if not (1 <= start <= end <= timeline["frameEnd"]):
            raise ValueError("Invalid interval " + entry["id"])
        for obj in objects:
            obj["visible_start"], obj["visible_end"] = start, end
            states = {1: start > 1, start: False, end: False, end + 1: True}
            if start > 1:
                states[start - 1] = True
            for frame, hidden in sorted(states.items()):
                obj.hide_render = obj.hide_viewport = hidden
                obj.keyframe_insert("hide_render", frame=frame)
                obj.keyframe_insert("hide_viewport", frame=frame)
        groups.append((entry, objects))

    persistent = [
        text("brand/date", "SDLCAI  /  13 OCTOBER 2026", -8.8, 4.67, .24, "persistent", "bold", muted),
        rect("top keyline", -8.8, 4.36, 17.6, .018, "persistent"),
        text("venue", "MARSIO · AALTO UNIVERSITY · ESPOO", -8.8, -4.78, .24, "persistent", "bold", muted),
    ]
    show_interval(persistent, {"id": "persistent", "kind": "persistent", "start": 1, "end": timeline["frameEnd"]})
    for entry in entries:
        kind, entryid = entry["kind"], entry["id"]
        if kind == "opening":
            objects = [
                text("opening eyebrow", "AI MEETS THE", -8.8, 2.16, .47, entryid, "bold", red),
                text("opening title", "SDLC", -8.92, -.16, 3.1, entryid),
                text("opening line", "A whole system. A new direction.", -8.8, -1.38, .46, entryid, "body"),
                rect("opening accent", -8.8, -2.04, 3.2, .07, entryid),
            ]
        elif kind in ("chapter", "session"):
            body = "\n".join(textwrap.wrap(entry["sessionTitle"], width=16, break_long_words=False, break_on_hyphens=False))
            headline = text(entryid + " title", body, -8.8, .67, 1.55, entryid, text_role="session_title")
            objects = [text(entryid + " number", f'{entry["sessionNumber"]:02d}  /  {entry["sessionStart"]}', -8.8, 2.25, .37, entryid, "bold", red), headline]
            targets.append((headline, entry))
        elif kind == "speaker":
            row = records[entry["speakerId"]]
            body = BALANCED_TITLES.get(row["speakerId"], "")
            if " ".join(body.split()) != " ".join(row["talkTitle"].split()):
                # Never replace a changed live title with older curated wording.
                body = "\n".join(textwrap.wrap(row["talkTitle"], width=28, break_long_words=False, break_on_hyphens=False))
            headline = text("talk " + row["speakerId"], body, -8.8, .4, .84, entryid, text_role="talk_title")
            headline["published_title"] = row["talkTitle"]
            objects = [
                text(entryid + " session", row["sessionTitle"].upper() + "  /  " + row["sessionStart"], -8.8, 3.57, .29, entryid, "bold", red),
                portrait(row, entryid),
                text("name " + row["speakerId"], row["speakerName"], -6.88, 2.0, .48, entryid, "bold", text_role="speaker_name"),
                headline,
                text(entryid + " count", f'{entry["speakerNumber"]:02d} / {len(programme):02d}', -8.8, -3.59, .28, entryid, "bold", muted),
                rect(entryid + " accent", -7.36, -3.56, 2.7, .035, entryid),
            ]
            targets.append((headline, entry))
        elif kind == "closing":
            objects = [
                text("closing brand", "SDLCAI", -8.8, .6, 1.8, entryid),
                text("closing thought", "RETHINK THE WHOLE SYSTEM.", -8.8, -.55, .4, entryid, "bold", red),
                text("music title", '"Cipher" · Kevin MacLeod · incompetech.com', -8.8, -2.0, .27, entryid, "body", muted, "music_credit"),
                text("music licence", "Creative Commons Attribution 4.0", -8.8, -2.48, .27, entryid, "body", muted, "music_credit"),
                text("music licence URL", "creativecommons.org/licenses/by/4.0/", -8.8, -2.96, .27, entryid, "body", muted, "music_credit"),
                text("music changes", "Music edited: excerpt, fades and loudness adjusted.", -8.8, -3.44, .24, entryid, "body", muted, "music_credit"),
            ]
        else:
            raise ValueError("Unknown entry kind " + kind)
        show_interval(objects, entry)

    previous_frame = scene.frame_current
    window = bpy.context.window
    previous_scene = window.scene if window else None
    if window:
        window.scene = scene
    report = []
    try:
        with bpy.context.temp_override(scene=scene, view_layer=scene.view_layers[0]):
            def bounds(obj):
                scene.view_layers[0].update()
                depsgraph = bpy.context.evaluated_depsgraph_get()
                depsgraph.update()
                evaluated = obj.evaluated_get(depsgraph)
                points = [evaluated.matrix_world @ Vector(co) for co in evaluated.bound_box]
                return {"left": min(p.x for p in points), "right": max(p.x for p in points), "bottom": min(p.y for p in points), "top": max(p.y for p in points)}

            for obj, entry in targets:
                scene.frame_set(entry["start"])
                minimum = .70 if entry["kind"] == "speaker" else 1.15
                for _attempt in range(8):
                    box = bounds(obj)
                    if box["left"] >= -8.92 and box["right"] <= 2.85 and box["bottom"] >= -2.9:
                        break
                    factor = min(1, (2.80 - obj.location.x) / (box["right"] - obj.location.x), (obj.location.y + 2.85) / max(.001, obj.location.y - box["bottom"])) * .99
                    obj.data.size *= factor
                    if obj.data.size < minimum:
                        raise ValueError("Title needs a new layout, not smaller type: " + obj.data.body)
                else:
                    raise ValueError("Title failed native glyph bounds: " + obj.data.body)
                obj["verified_bounds"], obj["verified_font_size"] = json.dumps(box), obj.data.size
                report.append({"entryId": entry["id"], "kind": entry["kind"], "body": obj.data.body, "fontSize": obj.data.size, "bounds": box,
                               "start": entry["start"], "end": entry["end"], "holdSeconds": (entry["end"] - entry["start"] + 1) / timeline["fps"]})
            # Verify straight cuts at both boundaries and unchanged transforms
            # at start, middle and end. No opacity or material property is keyed.
            for entry, objects in groups:
                static = {obj.name: tuple(obj.location) + tuple(obj.rotation_euler) + tuple(obj.scale) for obj in objects}
                frames = {entry["start"], (entry["start"] + entry["end"]) // 2, entry["end"]}
                if entry["start"] > 1:
                    frames.add(entry["start"] - 1)
                if entry["end"] < timeline["frameEnd"]:
                    frames.add(entry["end"] + 1)
                for frame in sorted(frames):
                    scene.frame_set(frame)
                    hidden = not entry["start"] <= frame <= entry["end"]
                    for obj in objects:
                        if obj.hide_render != hidden or obj.hide_viewport != hidden:
                            raise ValueError("Visibility cut mismatch: " + obj.name)
                        if tuple(obj.location) + tuple(obj.rotation_euler) + tuple(obj.scale) != static[obj.name]:
                            raise ValueError("Text or portrait moved: " + obj.name)
                for obj in objects:
                    obj["static_hold_verified"] = True
            for item in report:
                item["staticHoldVerified"], item["animation"] = True, "visibility cuts only"
    finally:
        scene.frame_set(previous_frame)
        if window and previous_scene:
            window.scene = previous_scene
    scene["title_report"] = json.dumps(report, ensure_ascii=False)
    scene["programme_snapshot"] = json.dumps(programme, ensure_ascii=False)
    scene["draft03_titles_added"] = True
    return report
