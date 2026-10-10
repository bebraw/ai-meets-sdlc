"""Full native Blender demoscene film: static titles and one continuous morph."""
from pathlib import Path
import json
import math

import bpy
from mathutils import Vector

PREFIX = "SDLCAI / DRAFT 03"


def build_draft03(ROOT, snapshot, timeline):
    root = Path(ROOT)
    if any(s.name.startswith(PREFIX) for s in bpy.data.scenes):
        raise RuntimeError("Preserving existing Draft 03; rebuild in a fresh scene file.")
    if snapshot["revision"] != timeline["programmeRevision"]:
        raise ValueError("Programme and editorial timeline revisions differ.")
    scene = bpy.data.scenes.new(PREFIX + " / CONTINUOUS CHANGE")
    bpy.context.window.scene = scene
    scene["revision"] = "draft-03"
    scene["programme_snapshot"] = json.dumps(snapshot, ensure_ascii=False)
    scene["editorial_timeline"] = json.dumps(timeline, ensure_ascii=False)
    scene["text_treatment"] = "Fixed text and portraits, straight visibility cuts only"
    scene["motion_treatment"] = "One persistent parameterized surface; connected wire curves follow the same shape keys"
    scene.frame_start, scene.frame_end = 1, timeline["frameEnd"]
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 16
    scene.eevee.use_raytracing = False
    scene.render.resolution_x, scene.render.resolution_y = 3840, 2160
    scene.render.resolution_percentage = 100
    scene.render.fps = 24
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 96
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.world = bpy.data.worlds.new(PREFIX + " / black")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0

    def link(name, data=None):
        obj = bpy.data.objects.new(PREFIX + " / " + name, data)
        scene.collection.objects.link(obj)
        return obj

    def srgb(h):
        return tuple(c/12.92 if c < .04045 else ((c+.055)/1.055)**2.4 for c in [int(h[i:i+2],16)/255 for i in (0,2,4)])

    def material(name, color, opacity=1):
        m = bpy.data.materials.new(PREFIX + " / " + name)
        m.use_nodes = True
        n = m.node_tree.nodes; n.clear()
        em = n.new("ShaderNodeEmission")
        em.inputs[0].default_value = (*srgb(color), 1)
        em.inputs[1].default_value = 1
        out = n.new("ShaderNodeOutputMaterial")
        if opacity < 1:
            m.surface_render_method = "BLENDED"
            transparent = n.new("ShaderNodeBsdfTransparent")
            mix = n.new("ShaderNodeMixShader")
            mix.inputs[0].default_value = opacity
            m.node_tree.links.new(transparent.outputs[0], mix.inputs[1])
            m.node_tree.links.new(em.outputs[0], mix.inputs[2])
            m.node_tree.links.new(mix.outputs[0], out.inputs[0])
        else:
            m.node_tree.links.new(em.outputs[0], out.inputs[0])
        return m

    ink = material("charcoal", "101010")
    red = material("signal red", "d72f2f")
    white = material("warm white", "f6f4ef")
    field_red = material("quiet sine field", "612525")
    facets = [material("translucent graphite", "15181b", .55),
              material("translucent red", "952c28", .26),
              material("translucent silver", "7a7c75", .20)]

    def mesh(name, verts, faces, materials):
        data = bpy.data.meshes.new(PREFIX + " / " + name)
        data.from_pydata(verts, [], faces)
        data.update()
        for m in materials: data.materials.append(m)
        return link(name, data)

    background = mesh("background", [(-20,-12,-12),(20,-12,-12),(20,12,-12),(-20,12,-12)], [(0,1,2,3)], [ink])
    cd = bpy.data.cameras.new(PREFIX + " / camera")
    cd.type, cd.ortho_scale, cd.clip_end = "ORTHO", 20, 100
    camera = link("camera", cd)
    camera.location = (0,0,30)
    scene.camera = camera

    # Every target shares the same U-periodic, V-bounded vertex indexing. The
    # poles unfold into a tube seam; no object disappears or changes topology.
    U, V = 96, 24
    def point(name, u, v):
        phi = .003 + (math.pi-.006)*v
        d = Vector((math.sin(phi)*math.cos(u), math.sin(phi)*math.sin(u), math.cos(phi)))
        if name == "octahedron": return d / sum(abs(a) for a in d)
        if name == "sphere": return d
        if name == "rounded cube":
            return d / (sum(abs(a)**5 for a in d)**.2)
        if name == "lobed sphere":
            return d * (1 + .19*math.cos(5*u)*math.sin(phi)**2 + .12*math.sin(3*phi+u))
        angle = math.tau*v
        if name == "torus":
            return Vector(((1.9+.72*math.cos(angle))*math.cos(u), (1.9+.72*math.cos(angle))*math.sin(u), .72*math.sin(angle)))
        if name == "twisted loop":
            r = 1.9+.3*math.cos(3*u)
            return Vector(((r+.58*math.cos(angle))*math.cos(u), (r+.58*math.cos(angle))*math.sin(u), .45*math.sin(3*u)+.58*math.sin(angle)))
        if name == "trefoil":
            def centre(t):
                return Vector(((2+.75*math.cos(3*t))*math.cos(2*t), (2+.75*math.cos(3*t))*math.sin(2*t), .9*math.sin(3*t)))
            p = centre(u)
            tangent = (centre(u+.001)-p).normalized()
            normal = tangent.cross(Vector((0,0,1))).normalized()
            binormal = tangent.cross(normal).normalized()
            return p + .29*(normal*math.cos(angle)+binormal*math.sin(angle))
        raise ValueError(name)

    names = ["octahedron", "sphere", "torus", "trefoil", "lobed sphere", "rounded cube", "twisted loop"]
    shapes = {}
    for name in names:
        points = [point(name, i*math.tau/U, j/V) for i in range(U) for j in range(V+1)]
        scale = 2.8 / max(p.length for p in points)
        shapes[name] = [tuple(p*scale) for p in points]
    faces = [(i*(V+1)+j, ((i+1)%U)*(V+1)+j, ((i+1)%U)*(V+1)+j+1, i*(V+1)+j+1) for i in range(U) for j in range(V)]
    surface = mesh("one evolving surface", shapes[names[0]], faces, facets)
    for face in surface.data.polygons:
        i,j = divmod(face.index,V)
        face.material_index = 1 if (i//12+j//6)%5 == 0 else (2 if (i//24+j//8)%4 == 1 else 0)
    morph_root = link("persistent morph transform")
    morph_root.location = (6.05,-.10,-1.5)
    surface.parent = morph_root
    surface["role"] = "continuous_morph"

    latitude_paths = [[i*(V+1)+j for i in range(U)] for j in range(2,V,2)]
    longitude_paths = [[i*(V+1)+j for j in range(V+1)] for i in range(0,U,8)]
    accent_paths = [[i*(V+1)+V//4 for i in range(U)]]
    def wire(name, paths, cyclic_count, mat, radius):
        c = bpy.data.curves.new(PREFIX + " / " + name, "CURVE")
        c.dimensions = "3D"; c.resolution_u = 1
        c.bevel_depth = radius; c.bevel_resolution = 1
        c.materials.append(mat)
        indices = []
        for index,path in enumerate(paths):
            spline = c.splines.new("POLY"); spline.points.add(len(path)-1)
            spline.use_cyclic_u = index < cyclic_count
            for p,vertex in zip(spline.points,path):p.co = (*shapes[names[0]][vertex],1)
            indices.extend(path)
        o = link(name,c); o.parent=morph_root; o["role"]="continuous_morph"
        return o,indices
    grid,grid_indices = wire("morphing red vector grid",latitude_paths+longitude_paths,len(latitude_paths),red,.010)
    accent,accent_indices = wire("morphing white latitude",accent_paths,1,white,.019)

    poses = [(0,"octahedron"),(8,"sphere"),(17.6,"torus"),(27.2,"trefoil"),
             (36.8,"lobed sphere"),(46.4,"rounded cube"),(56,"sphere"),
             (65.6,"torus"),(75.2,"twisted loop"),(86.4,"trefoil"),
             (96,"sphere"),(105.6,"octahedron"),(115.2,"lobed sphere"),(120,"octahedron")]
    pose_frames = [min(2880,round(t*24)+1) for t,_ in poses]
    def animate_shape_keys(obj, indices):
        obj.shape_key_add(name="Basis")
        keys = {}
        for name in names[1:]:
            key = obj.shape_key_add(name=name)
            for p,index in zip(key.data,indices):p.co=shapes[name][index]
            keys[name]=key
        for frame,(_,target) in zip(pose_frames,poses):
            for name,key in keys.items():
                key.value=1 if name==target else 0
                key.keyframe_insert("value",frame=frame)
        animation = obj.data.shape_keys.animation_data
        action = animation.action
        for layer in action.layers:
            for strip in layer.strips:
                bag=strip.channelbag(animation.action_slot)
                if not bag:continue
                for curve in bag.fcurves:
                    points=curve.keyframe_points
                    for index,k in enumerate(points):
                        k.interpolation="BEZIER"
                        k.handle_left_type=k.handle_right_type="FREE"
                        left=(k.co.x-points[index-1].co.x)/3 if index else 1
                        right=(points[index+1].co.x-k.co.x)/3 if index+1<len(points) else 1
                        k.handle_left=(k.co.x-left,k.co.y)
                        k.handle_right=(k.co.x+right,k.co.y)
    animate_shape_keys(surface,list(range(U*(V+1))))
    animate_shape_keys(grid,grid_indices)
    animate_shape_keys(accent,accent_indices)

    # One rotation path survives every chapter and speaker cut. Shape radius is
    # bounded at 2.8 units, leaving a gap to the text area even mid-morph.
    for step in range(76):
        t=min(120,step*1.6)
        morph_root.rotation_euler=(.35+.16*math.sin(t*.13),-.2+t*.043,.25+t*.071)
        morph_root.keyframe_insert("rotation_euler",frame=min(2880,round(t*24)+1))

    # The quiet field is a second continuous deformation, shared across cuts.
    cols,rows=72,16
    vertices=[(-13+26*i/cols,j*.24,.34*math.sin((-13+26*i/cols)*.75+j*.24)) for j in range(rows+1) for i in range(cols+1)]
    cells=[(j*(cols+1)+i,j*(cols+1)+i+1,(j+1)*(cols+1)+i+1,(j+1)*(cols+1)+i) for j in range(rows) for i in range(cols)]
    field=mesh("continuous sine landscape",vertices,cells,[field_red])
    field.location=(0,-5.8,-7);field.rotation_euler.x=math.radians(64)
    field.shape_key_add(name="Basis"); wave=field.shape_key_add(name="Phase shift")
    for p,(x,y,z) in zip(wave.data,vertices):p.co.z=.65*math.sin(x*.75+y+math.pi)+.2*math.sin(y*2)
    for n in range(31):
        wave.value=n%2;wave.keyframe_insert("value",frame=min(2880,round(n*4*24)+1))
    modifier=field.modifiers.new("Vector grid","WIREFRAME");modifier.thickness=.016

    namespace={}; helper=root/"scripts/intro/build_draft03_titles.py"
    exec(compile(helper.read_text(),str(helper),"exec"),namespace)
    title_report=namespace["add_titles"](scene,root,snapshot["programme"],timeline)
    scene["morph_poses"]=json.dumps([{"frame":f,"seconds":t,"shape":name} for f,(t,name) in zip(pose_frames,poses)])
    scene["morph_vertex_count"]=len(shapes[names[0]])
    scene.frame_set(1);scene.view_layers[0].update()
    return scene
