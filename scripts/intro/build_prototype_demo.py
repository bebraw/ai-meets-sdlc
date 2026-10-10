"""Original SDLCAI demoscene motion prototype; build only, no render or save.

References (visual principles, no third-party demo assets):
https://github.com/mtuomi/SecondReality -- vector/glenz and procedural sections.
https://mfx.scene.org/ -- mfx / Kewlers, especially their joint release "1995".

Call build_demo(repository_root, live_programme["programme"]) inside Blender.
The caller supplies fresh portraits and handles soundtrack, renders and saving.
"""

from pathlib import Path
import json
import math
import textwrap

import bpy
from mathutils import Vector


PREFIX = "SDLCAIP2/C"


def build_demo(ROOT, programme):
    root_path = Path(ROOT)
    generated = root_path / "production/intro/generated"
    if any(scene.name.startswith(PREFIX) for scene in bpy.data.scenes):
        raise RuntimeError("Variant C already exists; preserving the existing scene.")
    if len(programme) < 3:
        raise ValueError("The live programme must contain at least three speakers.")
    first = programme[:3]
    if len({row["sessionId"] for row in first}) != 1:
        raise ValueError("The first three prototype speakers must share a session.")
    for row in first:
        for field in ("speakerId", "speakerName", "talkTitle", "sessionTitle", "sessionStart"):
            if not row.get(field):
                raise ValueError("Missing programme field: " + field)
        if not (generated / "prototype-portraits" / (row["speakerId"] + ".png")).is_file():
            raise FileNotFoundError("Fresh portrait missing: " + row["speakerId"])

    scene = bpy.data.scenes.new(PREFIX + " / VECTOR CULTURE")
    scene["variant"] = "C"
    scene["programme_snapshot"] = json.dumps(programme, ensure_ascii=False)
    scene["description"] = "Finnish demoscene: glenz vectors, analytic knots, sine fields; original geometry"
    scene["references"] = "https://github.com/mtuomi/SecondReality | https://mfx.scene.org/"
    scene.frame_start, scene.frame_end = 1, 864
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
    scene.render.resolution_percentage = 100
    scene.render.fps = 24
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.eevee.taa_render_samples = 24
    scene.eevee.use_raytracing = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    world = bpy.data.worlds.new(PREFIX + " / black")
    world.use_nodes = True
    world.node_tree.nodes.get("Background").inputs[0].default_value = (0, 0, 0, 1)
    world.node_tree.nodes.get("Background").inputs[1].default_value = 0
    scene.world = world

    def link(name, data=None):
        obj = bpy.data.objects.new(PREFIX + " / " + name, data)
        scene.collection.objects.link(obj)
        return obj

    def rgb(hex_value):
        values = [int(hex_value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        return tuple(v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in values)

    def material(name, color, strength=1):
        mat = bpy.data.materials.new(PREFIX + " / " + name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        nodes.clear()
        emission = nodes.new("ShaderNodeEmission")
        emission.inputs[0].default_value = (*rgb(color), 1)
        emission.inputs[1].default_value = strength
        output = nodes.new("ShaderNodeOutputMaterial")
        mat.node_tree.links.new(emission.outputs[0], output.inputs[0])
        return mat

    white = material("warm white", "f6f4ef")
    muted = material("secondary type", "b7b0a4")
    red = material("signal red", "d72f2f")
    deep_red = material("field red", "612525")
    ink = material("ink", "101010")
    face_dark = material("glenz shadow", "191b1d")
    face_light = material("glenz pale face", "72736e")
    face_red = material("glenz red face", "7e2323")
    fonts = {
        "headline": bpy.data.fonts.load(str(generated / "fonts/FinlandicaHeadline-Black.ttf"), check_existing=True),
        "bold": bpy.data.fonts.load(str(generated / "fonts/FinlandicaText-Bold.ttf"), check_existing=True),
        "body": bpy.data.fonts.load(str(generated / "fonts/FinlandicaText-Regular.ttf"), check_existing=True),
    }

    def mesh(name, vertices, faces, materials):
        data = bpy.data.meshes.new(PREFIX + " / " + name)
        data.from_pydata(vertices, [], faces)
        data.update()
        for mat in materials:
            data.materials.append(mat)
        return link(name, data)

    def rect(name, x, y, width, height, mat, z=5):
        return mesh(name, [(x, y, z), (x + width, y, z), (x + width, y + height, z), (x, y + height, z)], [(0, 1, 2, 3)], [mat])

    def curves(name, paths, mat, radius=.013, cyclic=False):
        data = bpy.data.curves.new(PREFIX + " / " + name, "CURVE")
        data.dimensions = "3D"
        data.resolution_u = 1
        data.bevel_depth = radius
        data.bevel_resolution = 0
        data.resolution_u = 1
        data.materials.append(mat)
        for path in paths:
            spline = data.splines.new("POLY")
            spline.points.add(len(path) - 1)
            for point, co in zip(spline.points, path):
                point.co = (*co, 1)
            spline.use_cyclic_u = cyclic
        return link(name, data)

    def text(name, body, x, y, size, font="headline", mat=white, width=None):
        data = bpy.data.curves.new(PREFIX + " / " + name, "FONT")
        data.body = body
        data.size = size
        data.font = fonts[font]
        data.space_line = 1.08
        data.materials.append(mat)
        if width:
            data.text_boxes[0].width = width
        obj = link(name, data)
        obj.location = (x, y, 6)
        return obj

    def visible(objects, start, end):
        for obj in objects:
            for frame, hidden in [(1, start > 1), (max(1, start - 1), start > 1), (start, False), (end, False), (end + 1, True)]:
                obj.hide_render = hidden
                obj.hide_viewport = hidden
                obj.keyframe_insert("hide_render", frame=frame)
                obj.keyframe_insert("hide_viewport", frame=frame)

    def settle(objects, start):
        for obj in objects:
            base = obj.location.copy()
            for frame, dy in [(start, -.22), (start + 10, 0)]:
                obj.location = base + Vector((0, dy, 0))
                obj.keyframe_insert("location", frame=frame)

    def edge_paths(vertices, faces):
        edges = set()
        for face in faces:
            for a, b in zip(face, face[1:] + face[:1]):
                edges.add(tuple(sorted((a, b))))
        return [[vertices[a], vertices[b]] for a, b in sorted(edges)]

    camera_data = bpy.data.cameras.new(PREFIX + " / orthographic camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 20
    camera_data.clip_end = 100
    camera = link("camera", camera_data)
    camera.location = (0, 0, 30)
    scene.camera = camera
    rect("background", -20, -12, 40, 24, ink, -12)

    # A thin procedural surface at the bottom of the composition. Its changing
    # shape is actual animated mesh geometry, not a stock texture or code overlay.
    columns, rows = 72, 16
    field_vertices = []
    for j in range(rows + 1):
        for i in range(columns + 1):
            x, y = -13 + 26 * i / columns, j * .24
            field_vertices.append((x, y, .34 * math.sin(x * .75 + y)))
    field_faces = [(j * (columns + 1) + i, j * (columns + 1) + i + 1, (j + 1) * (columns + 1) + i + 1, (j + 1) * (columns + 1) + i)
                   for j in range(rows) for i in range(columns)]
    field = mesh("sine landscape", field_vertices, field_faces, [deep_red])
    field.location = (0, -5.8, -7)
    field.rotation_euler.x = math.radians(64)
    field.shape_key_add(name="Basis")
    wave = field.shape_key_add(name="Phase shift")
    for vertex, (x, y, _z) in zip(wave.data, field_vertices):
        vertex.co.z = .65 * math.sin(x * .75 + y + math.pi) + .2 * math.sin(y * 2)
    for frame, value in [(1, 0), (36, 1), (72, 0), (120, 1), (192, 0), (384, 1), (576, 0), (792, 1), (864, 0)]:
        wave.value = value
        wave.keyframe_insert("value", frame=frame)
    wire = field.modifiers.new("Vector grid", "WIREFRAME")
    wire.thickness = .016
    wire.use_replace = True

    # Glenz-inspired compound octahedra: sharp facets and visible vector edges.
    glenz_root = link("glenz transform")
    glenz_parts = []
    octa_vertices = [(2.3, 0, 0), (-2.3, 0, 0), (0, 2.3, 0), (0, -2.3, 0), (0, 0, 2.9), (0, 0, -2.9)]
    octa_faces = [(4, 0, 2), (4, 2, 1), (4, 1, 3), (4, 3, 0), (5, 2, 0), (5, 1, 2), (5, 3, 1), (5, 0, 3)]
    for i, scale in enumerate([1, .76]):
        solid = mesh("glenz facets " + str(i), octa_vertices, octa_faces, [face_dark, face_light, face_red])
        for polygon in solid.data.polygons:
            polygon.material_index = (polygon.index + i) % 3
        outline = curves("glenz edges " + str(i), edge_paths(octa_vertices, octa_faces), white if i else red, .014)
        for obj in (solid, outline):
            obj.parent = glenz_root
            obj.scale = (scale,) * 3
            obj.rotation_euler = (.25 * i, .35 * i, math.pi / 4 * i)
        glenz_parts.extend([solid, outline])
    for frame, x, y, angle, scale in [(1, 8.3, 0, -1.4, .24), (24, 5.9, .1, .5, 1.05), (72, 6.0, .1, 1.6, 1.1), (120, 6.1, .1, 2.45, 1), (192, 6.1, .1, 3.4, 1), (204, 6.1, -.1, 3.6, .96), (384, 6.1, -.1, 4.0, .96)]:
        glenz_root.location = (x, y, -1.5)
        glenz_root.rotation_euler = (.25 + angle * .18, angle * .45, angle)
        glenz_root.scale = (scale,) * 3
        glenz_root.keyframe_insert("location", frame=frame)
        glenz_root.keyframe_insert("rotation_euler", frame=frame)
        glenz_root.keyframe_insert("scale", frame=frame)
    visible(glenz_parts, 1, 384)

    # Analytic trefoil. Longitudinal ribbons and cross-ribs expose the construction.
    knot_root = link("trefoil transform")
    segments, sides = 168, 8
    def centre(t):
        return Vector(((2 + .7 * math.cos(3 * t)) * math.cos(2 * t), (2 + .7 * math.cos(3 * t)) * math.sin(2 * t), .85 * math.sin(3 * t)))
    knot_vertices = []
    for i in range(segments):
        t = i * math.tau / segments
        p = centre(t)
        tangent = (centre(t + .001) - p).normalized()
        normal = tangent.cross(Vector((0, 0, 1))).normalized()
        binormal = tangent.cross(normal).normalized()
        for side in range(sides):
            a = side * math.tau / sides
            knot_vertices.append(tuple(p + .22 * (normal * math.cos(a) + binormal * math.sin(a))))
    knot_faces = [(i * sides + j, ((i + 1) % segments) * sides + j, ((i + 1) % segments) * sides + (j + 1) % sides, i * sides + (j + 1) % sides)
                  for i in range(segments) for j in range(sides)]
    knot_surface = mesh("trefoil facets", knot_vertices, knot_faces, [face_dark, face_red])
    for polygon in knot_surface.data.polygons:
        polygon.material_index = 1 if polygon.index % sides < 2 else 0
    long_paths = [[knot_vertices[i * sides + j] for i in range(segments)] for j in range(sides)]
    rib_paths = [[knot_vertices[i * sides + j] for j in range(sides)] for i in range(0, segments, 6)]
    knot_lines = curves("trefoil longitudinal vectors", long_paths, red, .014, True)
    knot_ribs = curves("trefoil cross ribs", rib_paths, muted, .011, True)
    knot_parts = [knot_surface, knot_lines, knot_ribs]
    for obj in knot_parts:
        obj.parent = knot_root
    for frame, angle, scale in [(385, -.45, .6), (397, -.15, 1), (576, .42, 1), (793, .42, 1), (820, 1.6, 1.03), (864, 2.05, .93)]:
        knot_root.location = (6.1, -.05, -1.5)
        knot_root.rotation_euler = (.5, angle * .4, angle)
        knot_root.scale = (scale,) * 3
        knot_root.keyframe_insert("location", frame=frame)
        knot_root.keyframe_insert("rotation_euler", frame=frame)
        knot_root.keyframe_insert("scale", frame=frame)
    # Explicit windows keep this same construction available again for the close.
    for obj in knot_parts:
        for frame, hidden in [(1, True), (384, True), (385, False), (576, False), (577, True), (792, True), (793, False), (864, False)]:
            obj.hide_render = hidden
            obj.hide_viewport = hidden
            obj.keyframe_insert("hide_render", frame=frame)
            obj.keyframe_insert("hide_viewport", frame=frame)

    sphere_root = link("harmonic sphere transform")
    sphere_paths = []
    for j in range(1, 10):
        phi = j * math.pi / 10
        sphere_paths.append([(2.55 * math.sin(phi) * math.cos(t), 2.55 * math.sin(phi) * math.sin(t), 2.55 * math.cos(phi)) for t in [i * math.tau / 96 for i in range(96)]])
    for j in range(12):
        theta = j * math.pi / 12
        sphere_paths.append([(2.55 * math.sin(t) * math.cos(theta), 2.55 * math.sin(t) * math.sin(theta), 2.55 * math.cos(t)) for t in [i * math.tau / 96 for i in range(96)]])
    sphere = curves("spherical vector field", sphere_paths, red, .014, True)
    sphere.parent = sphere_root
    equator = curves("white harmonic orbit", [[(3.05 * math.cos(t), 3.05 * math.sin(t), .35 * math.sin(t * 3)) for t in [i * math.tau / 180 for i in range(180)]]], white, .021, True)
    equator.parent = sphere_root
    for frame, angle, scale in [(577, -.4, .68), (589, 0, .96), (792, .55, .96)]:
        sphere_root.location = (6.1, -.15, -1.5)
        sphere_root.rotation_euler = (.62, -.3, angle)
        sphere_root.scale = (scale,) * 3
        sphere_root.keyframe_insert("location", frame=frame)
        sphere_root.keyframe_insert("rotation_euler", frame=frame)
        sphere_root.keyframe_insert("scale", frame=frame)
    visible([sphere, equator], 577, 792)

    # Small raster accents and fixed typography establish a designed demo frame.
    text("persistent event label", "SDLCAI  /  13 OCTOBER 2026", -8.8, 4.67, .24, "bold", muted)
    rect("red top keyline", -8.8, 4.36, 17.6, .018, red)
    text("persistent location", "MARSIO · AALTO UNIVERSITY", -8.8, -4.78, .24, "bold", muted)
    for i in range(10):
        rect("raster accent " + str(i), 5.25 + i * .355, -4.75, .235, .085 if i % 3 else .18, red if i % 3 else white)

    opening = [
        text("opening eyebrow", "AI MEETS THE", -8.8, 2.16, .47, "bold", red),
        text("opening title", "SDLC", -8.92, -.16, 3.1),
        text("opening statement", "A whole system. A new direction.", -8.8, -1.38, .46, "body", white),
        rect("opening short rule", -8.8, -2.04, 3.2, .07, red),
    ]
    visible(opening, 1, 120)
    settle(opening, 1)
    chapter = [
        text("session number", "01  /  " + first[0]["sessionStart"], -8.8, 2.25, .37, "bold", red),
        text("session title", "\n".join(textwrap.wrap(first[0]["sessionTitle"], width=16)), -8.84, .67, 1.55),
    ]
    visible(chapter, 121, 192)
    settle(chapter, 121)

    def portrait(speaker_id, x, y, diameter):
        image = bpy.data.images.load(str(generated / "prototype-portraits" / (speaker_id + ".png")), check_existing=True)
        mat = bpy.data.materials.new(PREFIX + " / portrait " + speaker_id)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        nodes.clear()
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        gray = nodes.new("ShaderNodeRGBToBW")
        emission = nodes.new("ShaderNodeEmission")
        output = nodes.new("ShaderNodeOutputMaterial")
        mat.node_tree.links.new(texture.outputs["Color"], gray.inputs["Color"])
        mat.node_tree.links.new(gray.outputs[0], emission.inputs[0])
        mat.node_tree.links.new(emission.outputs[0], output.inputs[0])
        count = 96
        coords = [(x, y, 5.5)] + [(x + diameter / 2 * math.cos(i * math.tau / count), y + diameter / 2 * math.sin(i * math.tau / count), 5.5) for i in range(count)]
        obj = mesh("portrait " + speaker_id, coords, [(0, i + 1, (i + 1) % count + 1) for i in range(count)], [mat])
        uv = obj.data.uv_layers.new(name="Portrait crop")
        for loop in obj.data.loops:
            co = obj.data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv = ((co.x - x) / diameter + .5, (co.y - y) / diameter + .5)
        return obj

    # Reading holds: small unboxed portraits, modest names, title as the main act.
    # Only line breaks are added; the live wording is never shortened or rewritten.
    title_objects = []
    for index, (row, start, end) in enumerate(zip(first, [193, 385, 577], [384, 576, 792])):
        title_size = 1.12 if len(row["talkTitle"]) < 34 else .84
        wrap_width = 28 if len(row["talkTitle"]) < 34 else 34
        title_body = "\n".join(textwrap.wrap(row["talkTitle"], width=wrap_width, break_long_words=False, break_on_hyphens=False))
        if len(row["talkTitle"]) < 34 and ": " in row["talkTitle"]:
            title_body = row["talkTitle"].replace(": ", ":\n", 1)
        if row["speakerId"] == "jenni-kylmakoski" and row["talkTitle"] == "Why Leaders Should Use AI Themselves and Eat Their Own Dog Food?":
            title_body = "Why Leaders Should Use AI\nThemselves and Eat Their\nOwn Dog Food?"
        title = text("talk " + row["speakerId"], title_body, -8.8, .15, title_size, "headline", white, 11.7)
        title_objects.append((title, start + 24, row["talkTitle"]))
        objects = [
            text("talk session " + str(index), row["sessionTitle"].upper() + "  /  " + row["sessionStart"], -8.8, 3.57, .29, "bold", red),
            portrait(row["speakerId"], -8.02, 2.07, 1.55),
            text("speaker " + row["speakerId"], row["speakerName"], -6.88, 2.0, .48, "bold", white, 9.6),
            title,
            text("talk number " + str(index), str(index + 1).zfill(2) + " / 10", -8.8, -3.59, .28, "bold", muted),
            rect("talk accent " + str(index), -7.36, -3.56, 2.7, .035, red),
        ]
        visible(objects, start, end)
        settle(objects, start)

    ending = [
        text("closing brand", "SDLCAI", -8.85, .6, 1.8),
        text("closing direction", "RETHINK THE WHOLE SYSTEM.", -8.8, -.55, .4, "bold", red),
        text("music credit title", '"Cipher" · Kevin MacLeod · incompetech.com', -8.8, -2.48, .26, "body", muted),
        text("music credit licence", "CC BY 4.0 · creativecommons.org/licenses/by/4.0/", -8.8, -2.95, .26, "body", muted),
        text("music credit edit", "Music edited for this prototype.", -8.8, -3.42, .24, "body", muted),
    ]
    visible(ending, 793, 864)
    settle(ending, 793)

    for frame, label in [(1, "SDLCAI / vector opening"), (121, first[0]["sessionTitle"]), (193, first[0]["speakerName"]), (385, first[1]["speakerName"]), (577, first[2]["speakerName"]), (793, "SDLCAI / credit")]:
        scene.timeline_markers.new(label, frame=frame)
    # Font geometry must be evaluated in this scene, not whichever Blender scene
    # happened to be active when the module was called. Measure actual glyphs
    # after wrapping and the entry settle; retain room above the talk counter.
    window = bpy.context.window
    previous_scene = window.scene if window else None
    if window:
        window.scene = scene
    title_bounds = []
    try:
        with bpy.context.temp_override(scene=scene, view_layer=scene.view_layers[0]):
            for obj, frame, published_title in title_objects:
                if " ".join(obj.data.body.split()) != " ".join(published_title.split()):
                    raise ValueError("Displayed title differs from the live programme")
                scene.frame_set(frame)
                for attempt in range(3):
                    scene.view_layers[0].update()
                    depsgraph = bpy.context.evaluated_depsgraph_get()
                    depsgraph.update()
                    evaluated = obj.evaluated_get(depsgraph)
                    corners = [evaluated.matrix_world @ Vector(co) for co in evaluated.bound_box]
                    left, right = min(co.x for co in corners), max(co.x for co in corners)
                    bottom, top = min(co.y for co in corners), max(co.y for co in corners)
                    if left >= -8.92 and right <= 2.85 and bottom >= -2.75:
                        break
                    scale = min(1.0, (2.8 - obj.location.x) / (right - obj.location.x), (obj.location.y + 2.7) / max(.001, obj.location.y - bottom)) * .99
                    obj.scale *= scale
                if not (left >= -8.92 and right <= 2.85 and bottom >= -2.75):
                    raise ValueError("Title does not fit the reading area: " + published_title)
                if obj.data.size * obj.scale.x < .70:
                    raise ValueError("Title became too small to read: " + published_title)
                obj["verified_title_size"] = obj.data.size * obj.scale.x
                title_bounds.append({"speakerTitle": published_title, "left": left, "right": right, "bottom": bottom, "top": top})
    finally:
        if window and previous_scene:
            window.scene = previous_scene
    scene["verified_title_bounds"] = json.dumps(title_bounds)
    scene.frame_set(241)
    return scene
