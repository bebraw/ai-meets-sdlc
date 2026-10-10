"""Build the 36-second editorial / changing-loop motion prototype.

Import inside Blender, then call ``build_graphic(ROOT, programme)``. The caller
owns saving, rendering, and the music edit. Existing scenes are never modified.
Programme entries are the current published speakerName/talkTitle/speakerId/
sessionTitle records, already sorted in schedule order.
"""

import json
from pathlib import Path

import bpy


def build_graphic(ROOT, programme):
    """Return a self-contained, editable 1080p24 Blender scene for variant A."""
    root = Path(ROOT)
    generated = root / "production/intro/generated"
    entries = list(programme)[:3]
    expected = ["mo-khazali", "ohans-emmanuel", "jenni-kylmakoski"]
    if [item["speakerId"] for item in entries] != expected:
        raise ValueError("Prototype A requires current schedule records for Mo, Ohans, Jenni, in that order.")
    for item in entries:
        for field in ("speakerName", "talkTitle", "sessionTitle"):
            if not str(item.get(field, "")).strip():
                raise ValueError(f"Missing current programme field: {item['speakerId']} / {field}")

    prefix = "SDLCAI P2 / A"
    scene = bpy.data.scenes.new(prefix + " / Editorial changing loop")
    # Blender's font bounds depend on the active scene / dependency graph.
    # The caller renders this returned scene; make its layout context explicit.
    if bpy.context.window is not None:
        bpy.context.window.scene = scene
    scene["variant"] = "A"
    scene["creative_direction"] = "Editorial typography / changing loop"
    scene["programme_snapshot"] = json.dumps(entries, ensure_ascii=False)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.fps = 24
    scene.frame_start = 1
    scene.frame_end = 864
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.compression = 15
    scene.eevee.taa_render_samples = 16
    scene.eevee.use_raytracing = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.world = bpy.data.worlds.new(prefix + " / World")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0

    camera_data = bpy.data.cameras.new(prefix + " / Orthographic camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 16
    camera_data.clip_start = .1
    camera_data.clip_end = 100
    camera = bpy.data.objects.new(camera_data.name, camera_data)
    scene.collection.objects.link(camera)
    camera.location = (0, 0, 20)
    scene.camera = camera

    fonts = {
        key: bpy.data.fonts.load(str(generated / "fonts" / filename), check_existing=True)
        for key, filename in {
            "headline": "FinlandicaHeadline-Black.ttf",
            "bold": "FinlandicaText-Bold.ttf",
            "body": "FinlandicaText-Regular.ttf",
        }.items()
    }

    def srgb(hex_string):
        channels = [int(hex_string[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        return tuple(c / 12.92 if c < .04045 else ((c + .055) / 1.055) ** 2.4 for c in channels)

    def emission(label, color):
        material = bpy.data.materials.new(prefix + " / " + label)
        material.use_nodes = True
        tree = material.node_tree
        tree.nodes.clear()
        shader = tree.nodes.new("ShaderNodeEmission")
        shader.inputs[0].default_value = (*srgb(color), 1)
        shader.inputs[1].default_value = 1
        output = tree.nodes.new("ShaderNodeOutputMaterial")
        tree.links.new(shader.outputs[0], output.inputs[0])
        return material

    ink = emission("Charcoal", "101010")
    cream = emission("Warm white", "f6f4ef")
    red = emission("Signal red", "d72f2f")
    muted = emission("Muted", "b7b0a4")
    rule = emission("Quiet grid", "383530")

    def group(label):
        obj = bpy.data.objects.new(prefix + " / " + label, None)
        scene.collection.objects.link(obj)
        return obj

    def rectangle(label, x, y, width, height, material, z=0, parent=None):
        mesh = bpy.data.meshes.new(prefix + " / " + label)
        mesh.from_pydata([
            (-width / 2, -height / 2, 0), (width / 2, -height / 2, 0),
            (width / 2, height / 2, 0), (-width / 2, height / 2, 0),
        ], [], [(0, 1, 2, 3)])
        mesh.materials.append(material)
        obj = bpy.data.objects.new(mesh.name, mesh)
        scene.collection.objects.link(obj)
        obj.location = (x, y, z)
        obj.parent = parent
        return obj

    def label(body, x, y, size, font="body", material=None, parent=None, align="LEFT", z=.2):
        curve = bpy.data.curves.new(prefix + " / Type / " + body.replace("\n", " ")[:54], "FONT")
        curve.body = body
        curve.font = fonts[font]
        curve.size = size
        curve.align_x = align
        curve.align_y = "TOP_BASELINE"
        curve.space_line = 1.14
        curve.resolution_u = 8
        curve.materials.append(material or cream)
        obj = bpy.data.objects.new(curve.name, curve)
        scene.collection.objects.link(obj)
        obj.location = (x, y, z)
        obj.parent = parent
        return obj

    def measure(obj, body):
        obj.data.body = body
        scene.view_layers[0].update()
        return max(v[0] for v in obj.bound_box) - min(v[0] for v in obj.bound_box)

    def wrapped_label(body, x, y, size, max_width, max_lines, font, parent):
        # Measure the actual Finlandica outline in the scene, never estimate by
        # character count or truncate a published talk title.
        obj = label("", x, y, size, font=font, parent=parent)
        words = body.split()
        lines, current = [], ""
        for word in words:
            candidate = (current + " " + word).strip()
            if current and measure(obj, candidate) > max_width:
                lines.append(current)
                current = word
            else:
                current = candidate
        if current:
            lines.append(current)
        if len(lines) > max_lines:
            raise ValueError(f"Published title needs more than {max_lines} lines: {body}")
        obj.data.body = "\n".join(lines)
        scene.view_layers[0].update()
        if obj.dimensions.x > max_width + .01:
            raise ValueError(f"An unbroken title word exceeds the text area: {body}")
        obj["published_text"] = body
        obj["lines"] = len(lines)
        return obj

    def show_during(objects, start, end):
        for obj in objects:
            if start > 1:
                obj.hide_render = True
                obj.keyframe_insert("hide_render", frame=1)
                obj.keyframe_insert("hide_render", frame=start - 1)
            obj.hide_render = False
            obj.keyframe_insert("hide_render", frame=start)
            obj.keyframe_insert("hide_render", frame=end)
            if end < scene.frame_end:
                obj.hide_render = True
                obj.keyframe_insert("hide_render", frame=end + 1)

    def animate_entry(parent, start, end, offset=.5):
        # A sharp arrival with a soft landing; the remainder is a still reading hold.
        for frame, x, y in [(start, offset, -.10), (start + 9, 0, 0),
                            (end - 6, 0, 0), (end, -.12, .04)]:
            parent.location = (x, y, 0)
            parent.keyframe_insert("location", frame=frame)

    def visibility_group(parent, start, end, offset=.5):
        show_during(list(parent.children_recursive), start, end)
        animate_entry(parent, start, end, offset)

    def route(label_text, points, material, thickness=.016, parent=None):
        curve = bpy.data.curves.new(prefix + " / " + label_text, "CURVE")
        curve.dimensions = "3D"
        curve.resolution_u = 1
        curve.bevel_depth = thickness
        curve.bevel_resolution = 1
        spline = curve.splines.new("POLY")
        spline.points.add(len(points) - 1)
        for point, (x, y) in zip(spline.points, points):
            point.co = (x, y, .08, 1)
        curve.materials.append(material)
        obj = bpy.data.objects.new(curve.name, curve)
        scene.collection.objects.link(obj)
        obj.parent = parent
        return obj

    # Permanent editorial frame: intentional negative space, not a panel overlay.
    rectangle("Full-frame ground", 0, 0, 16.1, 9.1, ink, z=-.5)
    label("SDLCAI", -6.95, 3.60, .32, "headline")
    label("AI MEETS SDLC", -5.56, 3.63, .19, "bold", muted)
    label("13 OCTOBER 2026", 6.95, 3.63, .19, "body", muted, align="RIGHT")
    rectangle("Masthead rule", 0, 3.24, 13.9, .012, rule)

    stages = ["DISCOVER", "DESIGN", "BUILD", "TEST", "DEPLOY", "LEARN"]
    stage_x = [-6.32 + 2.528 * index for index in range(6)]
    rail_y = -2.74
    rail = route("Six-stage route", [(stage_x[0], rail_y), (stage_x[-1], rail_y)], red, .018)
    for frame, value in [(1, 0), (15, 0), (112, 1), (864, 1)]:
        rail.data.bevel_factor_end = value
        rail.data.keyframe_insert("bevel_factor_end", frame=frame)

    for index, (stage, x) in enumerate(zip(stages, stage_x)):
        node = rectangle("Stage node " + stage, x, rail_y, .10, .10, cream, z=.15)
        caption = label(stage, x, -3.28, .19, "bold", muted, align="CENTER")
        number = label(f"0{index + 1}", x, -3.61, .14, "body", muted, align="CENTER")
        show_during([node, caption, number], 14 + index * 15, 864)

    # The change is specific to software delivery: learning routes back to
    # discovery, turning a one-way sequence into an explicit feedback loop.
    feedback = route("Learn feeds discovery", [
        (stage_x[-1], rail_y), (6.78, rail_y), (6.94, -2.91),
        (6.94, -3.86), (6.78, -4.04), (-6.78, -4.04),
        (-6.94, -3.86), (-6.94, -2.91), (-6.77, rail_y), (stage_x[0], rail_y),
    ], red, .012)
    for frame, value in [(1, 0), (121, 0), (185, 1), (864, 1)]:
        feedback.data.bevel_factor_end = value
        feedback.data.keyframe_insert("bevel_factor_end", frame=frame)
    show_during([feedback], 121, 864)

    # One small warm-white pulse carries attention across the route. It leaves
    # the reading area entirely clear and moves slowly once portraits arrive.
    pulse = rectangle("Travelling feedback signal", stage_x[0], rail_y, .13, .13, cream, z=.22)
    for frame, hidden in [(1, False), (120, False), (121, True), (192, True), (193, False), (864, False)]:
        pulse.hide_render = hidden
        pulse.keyframe_insert("hide_render", frame=frame)
    path_keys = [(1, stage_x[0], rail_y), (112, stage_x[-1], rail_y),
                 (122, 6.94, rail_y), (132, 6.94, -4.04), (176, -6.94, -4.04),
                 (185, -6.94, rail_y), (193, stage_x[0], rail_y),
                 (360, stage_x[1], rail_y), (552, stage_x[2], rail_y),
                 (768, stage_x[3], rail_y), (864, stage_x[-1], rail_y)]
    for frame, x, y in path_keys:
        pulse.location = (x, y, .22)
        pulse.keyframe_insert("location", frame=frame)

    opener = group("00 / Opening composition")
    label("AI meets", -6.95, 1.51, 1.27, "headline", parent=opener)
    second_line = label("SDLC.", -6.95, -.06, 1.77, "headline", parent=opener)
    label("THE LOOP IS CHANGING.", -6.87, -1.15, .24, "bold", muted, parent=opener)
    rectangle("Opening red registration", 6.15, 1.10, 1.5, .055, red, parent=opener)
    label("2026", 6.9, .20, .90, "headline", muted, parent=opener, align="RIGHT")
    label("SOFTWARE. PEOPLE. POSSIBILITY.", 6.9, -.34, .17, "bold", muted, parent=opener, align="RIGHT")
    visibility_group(opener, 1, 120, .82)
    second_line.location.x = -5.95
    second_line.keyframe_insert("location", frame=1)
    second_line.location.x = -6.95
    second_line.keyframe_insert("location", frame=17)

    session = group("01 / Session chapter")
    label("01 / THE PROGRAMME", -6.91, 2.32, .22, "bold", red, parent=session)
    wrapped_label(entries[0]["sessionTitle"], -6.95, .80, 1.03, 12.4, 2, "headline", session)
    visibility_group(session, 121, 192, .8)

    def portrait(item, parent):
        path = generated / "prototype-portraits" / (item["speakerId"] + ".png")
        image = bpy.data.images.load(str(path), check_existing=True)
        material = bpy.data.materials.new(prefix + " / Portrait / " + item["speakerId"])
        material.use_nodes = True
        tree = material.node_tree
        tree.nodes.clear()
        texture = tree.nodes.new("ShaderNodeTexImage")
        texture.image = image
        texture.interpolation = "Linear"
        shader = tree.nodes.new("ShaderNodeEmission")
        tree.links.new(texture.outputs["Color"], shader.inputs[0])
        output = tree.nodes.new("ShaderNodeOutputMaterial")
        tree.links.new(shader.outputs[0], output.inputs[0])
        obj = rectangle("Portrait / " + item["speakerId"], -5.84, .89, 2.1, 2.1, material, z=.15, parent=parent)
        uv = obj.data.uv_layers.new(name="Portrait UV")
        for loop, coordinate in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
            loop.uv = coordinate
        return obj

    title_layouts = []
    for index, (item, start, end) in enumerate(zip(entries, [193, 385, 577], [384, 576, 792])):
        parent = group(f"02 / Speaker {index + 1:02d} / {item['speakerName']}")
        label(item["sessionTitle"].upper(), -6.91, 2.52, .21, "bold", red, parent=parent)
        portrait(item, parent)
        rectangle("Portrait red datum " + str(index), -6.91, -.39, .35, .025, red, parent=parent)
        label(f"0{index + 1} / 10", -6.39, -.48, .17, "body", muted, parent=parent)
        name = wrapped_label(item["speakerName"], -3.97, 1.44, .63, 10.75, 1, "headline", parent)
        title = wrapped_label(item["talkTitle"], -3.97, .46, .62, 10.35, 3, "bold", parent)
        title.data.space_line = 1.20
        visibility_group(parent, start, end, .42)
        title_layouts.append({"speaker": item["speakerName"], "title": item["talkTitle"],
                              "lines": title["lines"], "frame_start": start,
                              "readable_from": start + 9, "frame_end": end - 6})

    ending = group("03 / Closing composition")
    label("SDLCAI", -6.95, .92, 1.65, "headline", parent=ending)
    label("AI MEETS SDLC", -6.86, -.01, .31, "bold", parent=ending)
    label("THE CONVERSATION STARTS HERE.", -6.86, -.68, .22, "bold", muted, parent=ending)
    label('Music: “A Foolish Game” — CSoul feat. snowflake', 6.90, -.70, .22, "body", muted, parent=ending, align="RIGHT")
    label("CC BY 3.0 / edited", 6.90, -1.03, .20, "body", muted, parent=ending, align="RIGHT")
    label("ccmixter.org/files/CSoul/46765", 6.90, -1.35, .19, "body", muted, parent=ending, align="RIGHT")
    label("creativecommons.org/licenses/by/3.0", 6.90, -1.66, .19, "body", muted, parent=ending, align="RIGHT")
    visibility_group(ending, 793, 864, .62)

    scene["speaker_title_layouts"] = json.dumps(title_layouts, ensure_ascii=False)
    scene["builder"] = "scripts/intro/build_prototype_graphic.py"
    scene["duration_seconds"] = 36
    scene.frame_set(337)
    return scene
