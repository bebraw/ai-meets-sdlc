"""A 36-second architectural SDLC machine, built as editable Blender geometry."""

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


def build_machine(ROOT, programme):
    root = Path(ROOT)
    generated = root / "production/intro/generated"
    prefix = "SDLCAIP2/B"
    if any(s.name.startswith(prefix) for s in bpy.data.scenes):
        raise RuntimeError("Preserving existing machine prototype; use a fresh Blender file to rebuild.")
    rows = programme[:3]
    if [r["speakerId"] for r in rows] != ["mo-khazali", "ohans-emmanuel", "jenni-kylmakoski"]:
        raise ValueError("Programme order changed; review the prototype excerpt.")
    scene = bpy.data.scenes.new(prefix + " / THE SDLC MACHINE")
    bpy.context.window.scene = scene
    scene["variant"] = "B"
    scene["programme_snapshot"] = json.dumps(rows, ensure_ascii=False)
    scene["creative_direction"] = "One change travels through an architectural software delivery system"
    scene.frame_start, scene.frame_end = 1, 864
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 16
    scene.eevee.use_raytracing = False
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
    scene.render.resolution_percentage = 100
    scene.render.fps = 24
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.world = bpy.data.worlds.new(prefix + " / world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.025, .031, .041, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .3

    def rgb(h):
        v = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
        return tuple(c/12.92 if c < .04045 else ((c+.055)/1.055)**2.4 for c in v)

    def material(name, h, emission=False, strength=1, metallic=0, roughness=.6):
        m = bpy.data.materials.new(prefix + " / " + name)
        m.use_nodes = True
        n = m.node_tree.nodes
        n.clear()
        out = n.new("ShaderNodeOutputMaterial")
        if emission:
            s = n.new("ShaderNodeEmission")
            s.inputs[0].default_value = (*rgb(h), 1)
            s.inputs[1].default_value = strength
        else:
            s = n.new("ShaderNodeBsdfPrincipled")
            s.inputs["Base Color"].default_value = (*rgb(h), 1)
            s.inputs["Metallic"].default_value = metallic
            s.inputs["Roughness"].default_value = roughness
        m.node_tree.links.new(s.outputs[0], out.inputs[0])
        return m

    steel = material("brushed structure", "536069", metallic=.55)
    dark = material("graphite", "24292c", metallic=.3)
    floor = material("floor", "0c1115", roughness=.9)
    cream = material("porcelain panels", "d6d3c9", metallic=.12)
    white = material("warm white type", "f6f4ef", True)
    muted = material("secondary type", "b7b0a4", True)
    red = material("signal red", "d72f2f", True, 1.25)
    rail = material("route light", "d72f2f", True, 2.8)
    lamp = material("work light", "f5d8ad", True, 2)

    def link(name, data=None):
        o = bpy.data.objects.new(prefix + " / " + name, data)
        scene.collection.objects.link(o)
        return o

    def mesh(name, verts, faces, mat):
        m = bpy.data.meshes.new(prefix + " / " + name)
        m.from_pydata(verts, [], faces)
        m.materials.append(mat)
        return link(name, m)

    def box(name, pos, dims, mat=steel, bevel=0):
        x, y, z = [d/2 for d in dims]
        o = mesh(name, [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)],
                 [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], mat)
        o.location = pos
        if bevel:
            mod = o.modifiers.new("Machined edges", "BEVEL")
            mod.width, mod.segments = bevel, 2
        return o

    def path(name, points, mat=rail, thickness=.045):
        c = bpy.data.curves.new(prefix + " / " + name, "CURVE")
        c.dimensions = "3D"
        c.bevel_depth, c.bevel_resolution = thickness, 1
        c.materials.append(mat)
        p = c.splines.new("POLY")
        p.points.add(len(points)-1)
        for a, b in zip(p.points, points):
            a.co = (*b, 1)
        return link(name, c)

    fonts = {k: bpy.data.fonts.load(str(generated / "fonts" / v), check_existing=True) for k,v in {
        "headline":"FinlandicaHeadline-Black.ttf", "bold":"FinlandicaText-Bold.ttf", "body":"FinlandicaText-Regular.ttf"}.items()}

    def text(name, body, pos, size, mat=white, font="bold", parent=None):
        c = bpy.data.curves.new(prefix + " / " + name, "FONT")
        c.body, c.size, c.font = body, size, fonts[font]
        c.space_line = 1.13
        c.materials.append(mat)
        o = link(name, c)
        o.parent, o.location = parent, pos
        return o

    # Six recognisable transformations of a single work item. Service paths and
    # overhead utilities give the system an architectural, inhabited scale.
    box("infinite foundation", (0,30,-1.7), (130,120,1), floor)
    lane_objects = []
    before = set(scene.objects)
    stages = ["DISCOVER", "DESIGN", "BUILD", "VERIFY", "RELEASE", "OBSERVE"]
    for i, label in enumerate(stages):
        x = -17.5 + i*7
        box(label + " platform", (x,1,-.8), (6.5,7,.45), dark, .05)
        box(label + " service path", (x,-2.8,-.42), (6.5,.8,.15), steel)
        for side in (-2.1,2.1):
            box(label + " gantry leg", (x+2.65,side,3), (.2,.2,7), steel)
            box(label + " foot", (x+2.65,side,-.25), (.8,.8,.25), dark)
        box(label + " overhead beam", (x+2.65,0,6.45), (.35,5,.35), steel)
        box(label + " overhead worklight", (x+2.65,0,6.2), (.12,3.8,.06), lamp)
        box(label + " equipment cabinet", (x-2.6,2.8,.5), (.8,.6,1.8), dark, .035)
        for n in range(3):
            box(label + " indicator", (x-2.9,2.46,1+n*.16), (.12,.025,.04), rail)
        # Standing placards are part of the world, not speaker cards.
        mark = text(label + " station label", f"0{i+1}  {label}", (x-2.6,-2.2,1.25), .36, lamp)
        mark.rotation_euler.x = math.pi/2
        for side in (-.67,.67):
            path(label + " conveyor rail", [(x-3.5,side,.5),(x+3.5,side,.5)], steel, .055)
        for step in range(14):
            box(label + " belt slat", (x-3.25+step*.5,0,.28), (.33,1.2,.12), dark)
        if i == 0:
            for j in range(5):
                p = box("discovery documents", (x-1+j*.47,.15,1+j*.22), (1.2,.07,1.65), cream, .02)
                p.rotation_euler = (.1, -.32+j*.14, -.18+j*.07)
                box("document heading", (x-1+j*.47,.10,1.5+j*.22), (.75,.018,.07), red)
        elif i == 1:
            for j in range(3):
                box("design layers", (x,0,1+j*.52), (3,2,.065), cream, .02)
                for k in range(3):
                    path("blueprint traces", [(x-1.25,-.7+k*.65,1.045+j*.52),(x-.2,-.7+k*.65,1.045+j*.52),(x+.35,-.3+k*.65,1.045+j*.52),(x+1.25,-.3+k*.65,1.045+j*.52)], red, .018)
        elif i == 2:
            for j in range(3):
                box("assembly module", (x+(j-1)*.9,0,.85), (.8,1.05,.75), cream, .055)
            path("assembly arm", [(x,1.5,0),(x,1.5,2.8),(x,0,3.35),(x,0,2.15)], steel, .16)
            box("assembly head", (x,0,2), (.7,.7,.35), red, .04)
        elif i == 3:
            for xx in (-1.2,1.2):
                for yy in (-1.1,1.1):
                    box("test gate pillar", (x+xx,yy,1.8), (.18,.18,3.5), cream, .025)
                box("test gate lintel", (x+xx,0,3.5), (.2,2.4,.2), cream)
                path("test scan", [(x+xx,-.95,.5),(x+xx,-.95,3.3),(x+xx,.95,3.3),(x+xx,.95,.5)], rail, .025)
        elif i == 4:
            for j in (-1,0,1):
                path("release branches", [(x-2,0,.75),(x,0,.75),(x+2,j*1.4,.75)], red, .05)
                box("release parcel", (x+1.5,j*1.05,1.05), (.65,.65,.65), cream, .04)
        else:
            for j in range(8):
                height = .5 + (math.sin(j*1.8)+1)*1.2
                box("telemetry bar", (x-2+j*.55,.4,.4+height/2), (.27,.35,height), cream, .02)
                box("telemetry peak", (x-2+j*.55,.4,.4+height), (.28,.36,.06), rail)
        # Repeated handrails, stairs and supports make size legible.
        path("service handrail", [(x-3,-3.15,.6),(x+3,-3.15,.6)], steel, .025)
        for xx in (-3,0,3):
            path("handrail post", [(x+xx,-3.15,-.3),(x+xx,-3.15,.6)], steel, .018)
        for j in range(4):
            box("access stair", (x+2.2,-3.6-j*.23,-.4-j*.14), (.8,.24,.12), steel)
    path("live delivery line", [(-22,0,.56),(22,0,.56)], rail, .028)
    path("feedback return", [(20.8,1.4,1),(23,3,3),(23,5,7.4),(-23,5,7.4),(-23,0,1),(-21,0,.6)], rail, .065)
    for xx in (-23,-7,9,23):
        box("return support", (xx,5,2.9), (.28,.28,8), steel)
    lane_objects = [o for o in scene.objects if o not in before]
    for row in range(1,6):
        for original in lane_objects:
            # Distant lines repeat the same editable architectural modules.
            dup = original.copy()
            dup.data = original.data
            dup.name = prefix + f" / distant line {row} / " + original.name.split(" / ")[-1]
            scene.collection.objects.link(dup)
            dup.location.y += row*12
    for x in range(-36,45,12):
        for y in (8,32,56,80):
            box("hall column", (x,y,10), (.55,.55,24), dark)
        box("roof truss", (x,37,21.5), (.65,88,.6), steel)
        path("roof light", [(x,0,21),(x,76,21)], lamp, .035)

    item = link("one change")
    body = box("the change / porcelain", (0,0,1.05), (1.12,.9,.75), cream, .065)
    tag = box("the change / red identity", (0,-.47,1.08), (.65,.025,.29), rail)
    body.parent = tag.parent = item
    for f,x in [(1,-21),(120,-16),(192,-14),(384,-5),(576,7),(792,19),(864,21)]:
        item.location = (x,0,0)
        item.keyframe_insert("location", frame=f)

    def area(name, pos, target, energy, size, color):
        d = bpy.data.lights.new(prefix + " / " + name, "AREA")
        d.energy, d.shape, d.size, d.color = energy, "DISK", size, color
        o = link(name,d)
        o.location = pos
        o.rotation_euler = (Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    area("warm key", (6,-8,23), (0,7,0), 15500, 23, (1,.8,.63))
    area("cool hall", (-13,26,19), (3,18,0), 21000, 30, (.52,.66,1))
    area("distant depth", (19,58,18), (0,45,0), 26000, 28, (.55,.65,.82))

    cd = bpy.data.cameras.new(prefix + " / camera")
    cd.lens, cd.sensor_width, cd.clip_end = 35, 36, 400
    camera = link("camera", cd)
    scene.camera = camera
    camera.rotation_mode = "QUATERNION"
    shots = [
        (1,(-21,-11,4),(-17,0,1)), (112,(-6,-24,11),(-9,4,2)),
        (121,(30,-42,27),(-2,12,2)), (192,(27,-40,25),(-2,12,2)),
        (193,(14,-31,18),(-10,8,2)), (384,(12,-29,17),(-9,8,2)),
        (385,(24,-28,17),(0,9,2)), (576,(22,-27,16),(1,9,2)),
        (577,(34,-24,17),(10,11,2)), (792,(31,-22,16),(11,11,2)),
        (793,(42,-53,36),(-2,20,3)), (864,(39,-49,33),(-2,20,3)),
    ]
    for f, pos, target in shots:
        camera.location = pos
        camera.rotation_quaternion = (Vector(target)-camera.location).to_track_quat('-Z','Y')
        camera.keyframe_insert("location", frame=f)
        camera.keyframe_insert("rotation_quaternion", frame=f)

    # Camera-space type occupies a continuous soft vignette, not a speaker box.
    hud = link("screen typography")
    hud.parent = camera
    hud.location = (0,0,-5)
    scale = 5*36/35/16
    hud.scale = (scale,scale,scale)
    shade = bpy.data.materials.new(prefix + " / continuous vignette")
    shade.use_nodes = True
    shade.surface_render_method = "BLENDED"
    n = shade.node_tree.nodes
    n.clear()
    uv = n.new("ShaderNodeTexCoord")
    sep = n.new("ShaderNodeSeparateXYZ")
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = .43
    ramp.color_ramp.elements[0].color = (.97,.97,.97,1)
    ramp.color_ramp.elements[1].position = .95
    ramp.color_ramp.elements[1].color = (0,0,0,1)
    ramp.color_ramp.interpolation = "EASE"
    transparent = n.new("ShaderNodeBsdfTransparent")
    ink = n.new("ShaderNodeEmission")
    ink.inputs[0].default_value = (.002,.003,.004,1)
    mix = n.new("ShaderNodeMixShader")
    out = n.new("ShaderNodeOutputMaterial")
    for source, target in [(uv.outputs["Generated"],sep.inputs[0]),(sep.outputs[0],ramp.inputs[0]),(ramp.outputs[0],mix.inputs[0]),(transparent.outputs[0],mix.inputs[1]),(ink.outputs[0],mix.inputs[2]),(mix.outputs[0],out.inputs[0])]:
        shade.node_tree.links.new(source,target)
    backdrop = mesh("soft reading vignette", [(-8.1,-4.6,-.1),(8.1,-4.6,-.1),(8.1,4.6,-.1),(-8.1,4.6,-.1)], [(0,1,2,3)], shade)
    backdrop.parent = hud

    def title(body,x,y,size=.5,font="bold",mat=white):
        return text(body[:40],body,(x,y,.04),size,mat,font,hud)

    def visible(objects,start,end):
        for o in objects:
            for f,hidden in [(1,start>1),(max(1,start-1),start>1),(start,False),(end,False),(end+1,True)]:
                o.hide_render = hidden
                o.keyframe_insert("hide_render",frame=f)

    title("SDLCAI  /  13 OCTOBER 2026",-7.2,3.77,.23,"bold",muted)
    title("ESPOO",7.2,3.77,.23,"bold",muted).data.align_x = "RIGHT"
    for label,body,y,size,mat in [("opening","ONE CHANGE.",1.12,1.15,white),("opening2","A WHOLE SYSTEM.",-.25,.91,white),("tag","DISCOVER / DESIGN / BUILD / VERIFY / RELEASE / OBSERVE",-1.15,.205,muted)]:
        visible([title(body,-7.2,y,size,"headline" if label != "tag" else "body",mat)],1,120)
    session = [title("01  /  09:00–10:30",-7.2,1.6,.30,"bold",red),title(rows[0]["sessionTitle"].upper().replace(" ","\n",1),-7.2,.35,1.12,"headline"),title("THREE PERSPECTIVES ON WHAT CHANGES NEXT",-7.2,-2.38,.24,"body",muted)]
    visible(session,121,192)

    layouts = []
    for row,start,end in zip(rows,[193,385,577],[384,576,792]):
        objs = []
        objs.append(title("01  /  " + row["sessionTitle"].upper(),-7.2,2.82,.245,"bold",muted))
        portrait = bpy.data.images.load(str(generated / "prototype-portraits" / (row["speakerId"]+".png")),check_existing=True)
        m = bpy.data.materials.new(prefix+" / portrait / "+row["speakerId"])
        m.use_nodes = True
        nt=m.node_tree;nt.nodes.clear()
        tex=nt.nodes.new("ShaderNodeTexImage");tex.image=portrait
        em=nt.nodes.new("ShaderNodeEmission");out=nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(tex.outputs["Color"],em.inputs[0]);nt.links.new(em.outputs[0],out.inputs[0])
        x,y,w=-7.2,.38,1.7
        p=mesh("portrait "+row["speakerId"],[(x,y,.03),(x+w,y,.03),(x+w,y+w,.03),(x,y+w,.03)],[(0,1,2,3)],m)
        p.parent=hud
        uv_layer=p.data.uv_layers.new(name="UVMap")
        for loop,co in zip(uv_layer.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=co
        objs.append(p)
        objs.append(title(row["speakerName"],-5.18,1.48,.54,"headline"))
        objs.append(title("INDUSTRY PERSPECTIVES",-5.18,.91,.20,"body",muted))
        t=title("",-7.2,-.52,.49,"bold")
        words=row["talkTitle"].split();lines=[];line=""
        for word in words:
            candidate=(line+" "+word).strip();t.data.body=candidate
            scene.view_layers[0].update()
            width=max(v[0] for v in t.bound_box)-min(v[0] for v in t.bound_box)
            if width>8.15 and line:lines.append(line);line=word
            else:line=candidate
        if line:lines.append(line)
        if len(lines)>3:raise ValueError("Talk title needs more room: "+row["talkTitle"])
        t.data.body="\n".join(lines);t["published_text"]=row["talkTitle"];objs.append(t)
        visible(objs,start,end)
        layouts.append({"speakerId":row["speakerId"],"title":row["talkTitle"],"lines":lines,"frames":[start,end]})
    ending=[title("SDLCAI",-7.2,.55,2.2,"headline"),title("THE NEXT CHANGE STARTS HERE.",-7.1,-.55,.35,"bold"),title('“A Foolish Game” · CSoul feat. snowflake · CC BY 3.0',-7.1,-2.55,.19,"body",muted),title("ccmixter.org/files/CSoul/46765 · Edited for this prototype",-7.1,-2.86,.18,"body",muted)]
    visible(ending,793,864)
    title("DISCOVER / DESIGN / BUILD / VERIFY / RELEASE / OBSERVE / REPEAT",-7.2,-3.85,.21,"body",muted)
    scene["speaker_title_layouts"]=json.dumps(layouts,ensure_ascii=False)
    scene.frame_set(1)
    scene.view_layers[0].update()
    return scene
