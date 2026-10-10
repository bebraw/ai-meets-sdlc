"""Build the SDLCAI film's editable 3D shots and typography via Blender MCP.

Run in Blender with exec(compile(open(path).read(), path, 'exec')).
The existing scene is preserved. Generated scenes use the SDLCAI prefix.
"""
import bpy
import math
import json
import random
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/intro'
GEN = ROOT / 'production/intro/generated'
OUT.mkdir(parents=True, exist_ok=True)
(GEN / 'cards').mkdir(parents=True, exist_ok=True)
FPS = 24
if any(s.name.startswith('SDLCAI / ') for s in bpy.data.scenes):
    raise RuntimeError('Build into a fresh Blender file to preserve edits in the existing SDLCAI project.')


def linear(hex_value):
    values = [int(hex_value[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in values)


def material(name, color, metallic=0, roughness=.35, emission=0):
    m = bpy.data.materials.new('SDLCAI / ' + name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    c = linear(color)
    p.inputs['Base Color'].default_value = (*c, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Emission Color'].default_value = (*c, 1)
    p.inputs['Emission Strength'].default_value = emission
    return m


def flat(name, color, alpha=1):
    m = bpy.data.materials.new('SDLCAI / ' + name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = (*linear(color), 1)
    output = nt.nodes.new('ShaderNodeOutputMaterial')
    if alpha < 1:
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mix = nt.nodes.new('ShaderNodeMixShader')
        mix.inputs[0].default_value = alpha
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(e.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], output.inputs[0])
    else:
        nt.links.new(e.outputs[0], output.inputs[0])
    return m


def setup(s, transparent=False):
    s.render.engine = 'BLENDER_EEVEE'
    s.render.resolution_x, s.render.resolution_y = 3840, 2160
    s.render.resolution_percentage = 100
    s.render.fps = FPS
    s.render.film_transparent = transparent
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    s.render.image_settings.compression = 15
    s.eevee.taa_render_samples = 16 if transparent else 32
    s.eevee.use_raytracing = False
    s.render.compositor_device = 'GPU'
    s.view_settings.view_transform = 'Standard' if transparent else 'AgX'
    s.view_settings.look = 'None' if transparent else 'AgX - Medium High Contrast'
    s.world = bpy.data.worlds.new(s.name + ' / world')
    s.world.use_nodes = True
    s.world.node_tree.nodes.get('Background').inputs[0].default_value = (.014, .017, .022, 1)
    s.world.node_tree.nodes.get('Background').inputs[1].default_value = .35


def mesh_boxes(name, boxes, mat, collection, bevel=0):
    vertices, faces = [], []
    corners = [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]
    quads = [(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)]
    for pos, dims, angle in boxes:
        rot = Matrix.Rotation(angle, 4, 'Z')
        base = len(vertices)
        vertices.extend([Vector(pos) + rot @ Vector((x*dims[0]/2,y*dims[1]/2,z*dims[2]/2)) for x,y,z in corners])
        faces.extend([tuple(base + i for i in q) for q in quads])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    ob = bpy.data.objects.new(name, mesh)
    collection.objects.link(ob)
    if bevel:
        mod = ob.modifiers.new('Machined edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    return ob


def ring_boxes(radius, count, depth, width, height, z=0, phase=0):
    return [((radius*math.cos(a),radius*math.sin(a),z), (width, depth, height), a)
            for a in [phase + 2*math.pi*i/count for i in range(count)]]


def track_camera(s, name, start, end, target, lens, f0, f1):
    d = bpy.data.cameras.new(name)
    ob = bpy.data.objects.new(name, d)
    s.collection.objects.link(ob)
    d.lens, d.clip_end = lens, 300
    s.camera = ob
    for f, pos in [(f0,start),(f1,end)]:
        ob.location = pos
        ob.rotation_euler = (Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
        ob.keyframe_insert('location', frame=f)
        ob.keyframe_insert('rotation_euler', frame=f)
    return ob


machine = bpy.data.collections.new('SDLCAI / LIFECYCLE ENGINE')
steel = material('Gunmetal', '343a43', .8, .28)
copper = material('Warm alloy', 'b08b59', .85, .24)
black = material('Black enamel', '171a20', .55, .23)
red = material('Signal red', 'd72f2f', .5, .29)
led = material('Warm light', 'ffe9bd', .1, .3, 10)
signal = material('Signal light', 'ee352b', .2, .3, 8)

# Independent nested rotor assemblies, with visible mechanical teeth and ribs.
for i, radius in enumerate([3.3, 4.8, 6.4, 8.2]):
    root = bpy.data.objects.new('SDLCAI / Rotor %02d' % i, None)
    machine.objects.link(root)
    for label, r, count, dims, mat, z, phase in [
        ('structural ribs',radius,72,(.34,.52,.38),steel,-i*.9,0),
        ('alloy teeth',radius+.26,72,(.22,.26,.20),copper,-i*.9+.32,0),
        ('white light rail',radius-.32,120,(.055,.26,.055),led,-i*.9+.18,0),
        ('signal segments',radius+.38,24,(.065,.64,.08),signal,-i*.9+.5,.02),
    ]:
        ob = mesh_boxes('SDLCAI / '+label+' '+str(i), ring_boxes(r,count,dims[1],dims[0],dims[2],z,phase),mat,machine,.025 if mat != led else .008)
        ob.parent = root
    for f, angle, z in [(1,0,5+i*2.3),(96,0,0),(960,(-1)**i*math.pi*(.6+i*.15),0)]:
        root.rotation_euler.z = angle
        root.location.z = z
        root.keyframe_insert('rotation_euler',frame=f)
        root.keyframe_insert('location',frame=f)

# Six heavy delivery modules converge on an illuminated central nucleus.
for i in range(6):
    a = i*math.tau/6
    root = bpy.data.objects.new('SDLCAI / Delivery module %02d' % i,None)
    machine.objects.link(root)
    boxes = [((4*math.cos(a),4*math.sin(a),.8),(2.3,1.22,1.6),a)]
    ob=mesh_boxes('SDLCAI / module casing %02d'%i,boxes,black,machine,.12)
    ob.parent=root
    ob=mesh_boxes('SDLCAI / module vent %02d'%i,
                  [((r*math.cos(a)+t*math.cos(a+math.pi/2),r*math.sin(a)+t*math.sin(a+math.pi/2),1.68),(.7,.055,.06),a)
                   for t in [-.42,-.28,-.14,0,.14,.28,.42] for r in [3.6,4.5]],led if i%2 else signal,machine,.012)
    ob.parent=root
    for f,k in [(1,6),(96,0),(720,0),(800,.8),(900,0),(960,0)]:
        root.location=(k*math.cos(a),k*math.sin(a),k*.5)
        root.keyframe_insert('location',frame=f)

core=mesh_boxes('SDLCAI / Intelligence core',[((0,0,.25),(2.4,2.4,2.4),math.pi/4)],steel,machine,.16)
for f,a in [(1,0),(960,math.tau)]:
    core.rotation_euler=(a*.3,a*.2,a)
    core.keyframe_insert('rotation_euler',frame=f)
mesh_boxes('SDLCAI / Core illumination',ring_boxes(1.9,60,.18,.08,.08,1.0),led,machine,.02)
mesh_boxes('SDLCAI / Longitudinal supports',ring_boxes(7.3,12,.32,.32,8,-5),steel,machine,.07)
mesh_boxes('SDLCAI / Rear signal halo',ring_boxes(9.3,120,.34,.07,.07,-7),signal,machine,.01)

random.seed(13)
mesh_boxes('SDLCAI / Distant light flecks',
           [((random.uniform(-26,26),random.uniform(-26,26),random.uniform(-35,-15)),(.025,.025,.025),0) for _ in range(160)],led,machine)

for name,loc,power,color,size in [
    ('Key / warm', (2,-8,13),2300,(1,.72,.39),9),
    ('Rim / cold',(-10,5,9),3500,(.45,.64,1),8),
    ('Signal / red',(9,4,3),2800,(1,.07,.025),6),
    ('Face / soft',(0,-2,16),1700,(1,.92,.8),7),
]:
    d=bpy.data.lights.new('SDLCAI / '+name,'AREA')
    d.energy,d.color,d.shape,d.size=power,color,'DISK',size
    ob=bpy.data.objects.new(d.name,d); machine.objects.link(ob); ob.location=loc
    ob.rotation_euler=(-ob.location).to_track_quat('-Z','Y').to_euler()

shots=[]
for index,(name,start,end,target,lens) in enumerate([
    ('01 Awakening',(12,-18,20),(7,-16,15),(0,0,-1),42),
    ('02 Orbit',(15,-11,13),(7,-16,17),(0,0,-1),48),
    ('03 Inside the system',(7,-7,6),(-4,-9,5),(0,0,-1),32),
    ('04 Convergence',(3,-3,27),(0,-.5,25),(0,0,-1),42),
]):
    s=bpy.data.scenes.new('SDLCAI / '+name); setup(s)
    s.collection.children.link(machine)
    s.frame_start,s.frame_end=index*240+1,(index+1)*240
    track_camera(s,name+' / Camera',start,end,target,lens,s.frame_start,s.frame_end)
    g=bpy.data.node_groups.new(name+' / restrained anamorphic glow','CompositorNodeTree')
    g.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
    layer=g.nodes.new('CompositorNodeRLayers'); layer.scene=s
    glow=g.nodes.new('CompositorNodeGlare'); glow.inputs['Type'].default_value='Fog Glow'
    glow.inputs['Strength'].default_value=.35; glow.inputs['Threshold'].default_value=2
    glare=g.nodes.new('CompositorNodeGlare'); glare.inputs['Streaks'].default_value=2
    glare.inputs['Strength'].default_value=.12; glare.inputs['Threshold'].default_value=3
    out=g.nodes.new('NodeGroupOutput')
    g.links.new(layer.outputs['Image'],glow.inputs['Image']); g.links.new(glow.outputs['Image'],glare.inputs['Image']);g.links.new(glare.outputs['Image'],out.inputs['Image'])
    s.compositing_node_group=g
    s.frame_set(s.frame_start+120)
    shots.append(s)

# Orthographic cards: editable native text and existing photographs.
fonts={k:bpy.data.fonts.load(str(GEN/'fonts'/v)) for k,v in {
    'headline':'FinlandicaHeadline-Black.ttf', 'bold':'FinlandicaText-Bold.ttf','body':'FinlandicaText-Regular.ttf'}.items()}
white=flat('Warm white type','f6f4ef'); muted=flat('Muted type','b7b0a4'); redflat=flat('Red type','d72f2f')
panel=flat('Portrait panel','101010'); shade=flat('Translucent type ground','101010',.84)
cards=[]


def rect(s,name,x,y,w,h,mat,z=0):
    return mesh_boxes(name,[((x,y,z),(w,h,.002),0)],mat,s.collection)


def text(s,body,x,y,size,font='headline',mat=None,width=None,align='LEFT'):
    d=bpy.data.curves.new('SDLCAI / '+body.replace('\n',' ')[:50],'FONT')
    d.body,d.size,d.align_x,d.space_line=body,size,align,1.08
    d.font=fonts[font]; d.materials.append(mat or white)
    ob=bpy.data.objects.new(d.name,d); s.collection.objects.link(ob); ob.location=(x,y,.3)
    bpy.context.view_layer.update()
    # Text measurements use local bounds, so they also work for non-active scenes.
    pts=[Vector(p) for p in ob.bound_box]
    w=max(p.x for p in pts)-min(p.x for p in pts)
    if width and w>width: ob.scale*=width/w
    return ob


def image(s,path,x,y,w,h):
    im=bpy.data.images.load(str(path),check_existing=True)
    m=bpy.data.materials.new('SDLCAI / image / '+path.stem); m.use_nodes=True
    nt=m.node_tree; nt.nodes.clear()
    tex=nt.nodes.new('ShaderNodeTexImage'); tex.image=im
    e=nt.nodes.new('ShaderNodeEmission'); nt.links.new(tex.outputs['Color'],e.inputs[0])
    out=nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs[0],out.inputs[0])
    mesh=bpy.data.meshes.new(path.stem+' / UV plane')
    mesh.from_pydata([(x-w/2,y-h/2,.2),(x+w/2,y-h/2,.2),(x+w/2,y+h/2,.2),(x-w/2,y+h/2,.2)],[],[(0,1,2,3)])
    uv=mesh.uv_layers.new()
    for loop,coord in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=coord
    mesh.materials.append(m); ob=bpy.data.objects.new(path.stem,mesh);s.collection.objects.link(ob)


def card(key,header=True):
    s=bpy.data.scenes.new('SDLCAI / CARD / '+key);setup(s,True)
    d=bpy.data.cameras.new(key+' / Graphic camera'); d.type='ORTHO'; d.ortho_scale=38.4
    ob=bpy.data.objects.new(d.name,d);s.collection.objects.link(ob);ob.location=(0,0,50);s.camera=ob
    s.frame_start=s.frame_end=1
    s.render.filepath=str(GEN/'cards'/(key+'.png'))
    if header:
        text(s,'SDLCAI 2026    /    AI MEETS SDLC',-16.8,8.25,.5,'bold')
        rect(s,'Top keyline',0,7.55,33.6,.025,muted)
        image(s,GEN/'logo.png',15.95,8.65,1.6,1.6)
    cards.append(s)
    return s


s=card('opening',False)
text(s,'AI MEETS',0,1.6,2.4,align='CENTER')
text(s,'SDLC',0,-2.8,5,align='CENTER')
text(s,'13 OCTOBER 2026    /    AALTO UNIVERSITY',0,-5.2,.58,'bold',align='CENTER')
rect(s,'Opening underline',0,-6.1,5,.08,redflat)

s=card('whole-system',False)
text(s,'RETHINK',-16.5,2.2,2.8)
text(s,'THE WHOLE SYSTEM.',-16.5,-1.25,2.8,width=33)
rect(s,'Red rule',-13.7,-3,5.6,.09,redflat)

chapters=[
    ('discovery','01 / DISCOVERY','WHAT SHOULD\nWE BUILD?'),
    ('builders','02 / BUILDERS','WHO GETS\nTO BUILD IT?'),
    ('trust','03 / TRUST','HOW DO\nWE TRUST IT?'),
    ('adoption','04 / ADOPTION','HOW DO\nORGANISATIONS CHANGE?'),
    ('next','05 / NEXT','WHAT\nCOMES NEXT?'),
]
for key,label,question in chapters:
    s=card('question-'+key)
    rect(s,'Type ground',-2,0,34,12,shade,-.1)
    text(s,label,-16.5,4.6,.65,'bold',redflat)
    text(s,question,-16.5,.8,2.45,width=33)
    rect(s,'Chapter underline',-13.75,-4.4,5.5,.075,redflat)

speakers=[
    ('tapio-pitkaranta','Tapio\nPitkäranta','Siili Solutions','AGENTIC DISCOVERY','01',33.6),
    ('joongi-shin','Joongi Shin','Aalto University','GENERATIVE UI','02',43.2),
    ('mo-khazali','Mo Khazali','Theodo','RETHINKING DELIVERY','03',57.6),
    ('viljami-kuosmanen','Viljami\nKuosmanen','ePilot GmbH','BUILDING BEYOND ENGINEERING','04',67.2),
    ('ohans-emmanuel','Ohans\nEmmanuel','Coldtea.ai','ZERO-TRUST AGENTS','05',86.4),
    ('sini-tistelgren','Sini\nTistelgrén','Aimbition','THE FUNDAMENTALS','06',96),
    ('jenni-kylmakoski','Jenni\nKylmäkoski','Nokia','LEADING BY DOING','07',115.2),
    ('jussi-hacklin','Jussi Hacklin','Elisa','ADOPTION AT SCALE','08',124.8),
    ('muhammad-waseem','Muhammad\nWaseem','Tampere University','WHAT WORKS. WHAT FAILS.','09',144),
    ('zak-allal','Zak Allal','Physician & AI Engineer','A MYSTERY TALK','10',153.6),
]
for key,name,org,teaser,index,start in speakers:
    s=card('speaker-'+key)
    rect(s,'Speaker type ground',-5.5,-.2,23,12.5,shade,-.1)
    text(s,teaser,-16.5,4.4,.63,'bold',redflat,width=21)
    text(s,name,-16.5,1.1,2.0,width=21)
    text(s,org,-16.5,-4.35,.68,'body',muted)
    text(s,index+' / 10',-16.5,-6.0,.48,'bold',muted)
    rect(s,'Portrait border',11,0,9.6,9.6,white,.05)
    image(s,GEN/'portraits'/(key+'.png'),11,0,9.36,9.36)
    rect(s,'Portrait red footer',11,-5.05,9.6,.12,redflat)

s=card('value',False)
text(s,'MORE CODE.',-16.5,1.2,2.5)
text(s,'MORE VALUE?',-16.5,-2.0,2.5)
rect(s,'Value keyline',-13.5,-3.7,6,.08,redflat)

s=card('voices',False)
text(s,'10 VOICES.',0,1.3,2.4,align='CENTER')
text(s,'ONE CONVERSATION.',0,-1.7,2.1,align='CENTER')

s=card('finale',False)
image(s,GEN/'logo.png',-11.8,0,7.3,7.3)
text(s,'AI MEETS',-5.6,2.2,2.2)
text(s,'SDLC',-5.6,-1.9,4.4)
text(s,'13 OCTOBER 2026',-5.6,-4.3,.7,'bold')
text(s,'MARSIO  /  AALTO UNIVERSITY  /  ESPOO',-5.6,-5.5,.5,'body',muted)
rect(s,'Finale keyline',3.5,-6.5,18.3,.06,redflat)

s=card('credits',False)
rect(s,'Credit ground',0,0,38.4,21.6,panel,-.1)
image(s,GEN/'logo.png',-13.8,0,4.8,4.8)
text(s,'MUSIC',-8.8,3.4,.5,'bold',redflat)
text(s,'A Foolish Game',-8.8,1.9,1.1)
text(s,'CSoul featuring snowflake',-8.8,.55,.72,'bold')
text(s,'Creative Commons Attribution 3.0',-8.8,-.7,.58,'body',muted)
text(s,'ccmixter.org/files/CSoul/46765',-8.8,-1.75,.52,'body',muted)
text(s,'creativecommons.org/licenses/by/3.0/',-8.8,-2.7,.52,'body',muted)
text(s,'Edited: vocal / instrumental crossfades, trim and loudness mix.',-8.8,-4.1,.45,'body',muted)

timeline=[
    {'card':'opening','start':9.6,'end':19.8},
    {'card':'whole-system','start':21.6,'end':28.8},
    {'card':'question-discovery','start':28.8,'end':33.6},
    {'card':'question-builders','start':52.8,'end':57.6},
    {'card':'value','start':76.8,'end':81.6},
    {'card':'question-trust','start':81.6,'end':86.4},
    {'card':'question-adoption','start':110.4,'end':115.2},
    {'card':'question-next','start':139.2,'end':144},
    {'card':'voices','start':163.2,'end':168},
    {'card':'opening','start':168,'end':177.6},
    {'card':'finale','start':177.6,'end':187.2},
    {'card':'credits','start':187.2,'end':196.8},
]+[{'card':'speaker-'+key,'start':start,'end':start+9.6} for key,_,_,_,_,start in speakers]
(ROOT/'production/intro/timeline.json').write_text(json.dumps({'fps':FPS,'width':3840,'height':2160,'duration':196.8,'cards':sorted(timeline,key=lambda v:v['start']),'shots':[s.name for s in shots]},indent=2)+'\n')

# Pack fonts and photographs; .blend retains both 3D and editable type scenes.
bpy.context.window.scene=shots[1]
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'sdlcai-intro.blend'))
result={'blend':str(OUT/'sdlcai-intro.blend'),'shots':[s.name for s in shots],'card_scenes':len(cards),'objects':len(bpy.data.objects),'duration':196.8}
