"""The two skeletons, in Blender's frame (Z up, the figure faces -Y, +X is the figure's LEFT).

Every bone rests unrotated in the runtime (src/themes/stillwater/stillwater-rig.js builds each
bone from its head alone), so a bone's tail only says which way it points: the runtime reads the
tails of the bones it hangs (the spirit's hair) and nothing else.

Each entry: name -> (parent, head, tail). Order matters: it is the joint order in the files.
"""

#: The troll: a stocky body under a cloak of hair to his knees; one unit tall (soles at -0.5).
TROLL = {
    'hips': (None, (0.0, 0.03, -0.215), (0.0, 0.02, -0.09)),
    'spine': ('hips', (0.0, 0.02, -0.09), (0.0, -0.01, 0.04)),
    'chest': ('spine', (0.0, -0.01, 0.04), (0.0, -0.06, 0.15)),
    'neck': ('chest', (0.0, -0.06, 0.15), (0.0, -0.13, 0.205)),
    'head': ('neck', (0.0, -0.13, 0.205), (0.0, -0.2, 0.43)),
    'clavL': ('chest', (0.04, -0.07, 0.12), (0.19, -0.1, 0.1)),
    'upperL': ('clavL', (0.19, -0.1, 0.1), (0.265, -0.1, -0.075)),
    'foreL': ('upperL', (0.265, -0.1, -0.075), (0.288, -0.075, -0.205)),
    'handL': ('foreL', (0.288, -0.075, -0.205), (0.295, -0.07, -0.37)),
    'clavR': ('chest', (-0.04, -0.07, 0.12), (-0.19, -0.1, 0.1)),
    'upperR': ('clavR', (-0.19, -0.1, 0.1), (-0.27, -0.14, -0.075)),
    'foreR': ('upperR', (-0.27, -0.14, -0.075), (-0.29, -0.27, -0.1)),
    'handR': ('foreR', (-0.29, -0.27, -0.1), (-0.29, -0.4, -0.08)),
    'thighL': ('hips', (0.1, 0.02, -0.215), (0.135, -0.03, -0.345)),
    'shinL': ('thighL', (0.135, -0.03, -0.345), (0.155, 0.0, -0.45)),
    'footL': ('shinL', (0.155, 0.0, -0.45), (0.162, -0.19, -0.49)),
    'toeL': ('footL', (0.162, -0.19, -0.49), (0.165, -0.31, -0.497)),
    'thighR': ('hips', (-0.1, 0.02, -0.215), (-0.135, -0.03, -0.345)),
    'shinR': ('thighR', (-0.135, -0.03, -0.345), (-0.157, 0.0, -0.45)),
    'footR': ('shinR', (-0.157, 0.0, -0.45), (-0.165, -0.19, -0.49)),
    'toeR': ('footR', (-0.165, -0.19, -0.49), (-0.168, -0.31, -0.497)),
}

#: The spirit: one unit tall (crown at 1, hem at 0); two hair links, four gown panels.
SPIRIT = {
    'hips': (None, (0, 0.0, 0.50), (0, 0.0, 0.60)),
    'spine': ('hips', (0, 0.0, 0.60), (0, 0.006, 0.70)),
    'chest': ('spine', (0, 0.006, 0.70), (0, 0.0, 0.815)),
    'neck': ('chest', (0, 0.0, 0.815), (0, -0.006, 0.872)),
    'head': ('neck', (0, -0.006, 0.872), (0, -0.012, 1.0)),
    'clavL': ('chest', (0.014, -0.004, 0.808), (0.094, 0.004, 0.81)),
    'upperL': ('clavL', (0.094, 0.004, 0.81), (0.118, 0.012, 0.657)),
    'foreL': ('upperL', (0.118, 0.012, 0.657), (0.126, -0.012, 0.508)),
    'handL': ('foreL', (0.126, -0.012, 0.508), (0.124, -0.028, 0.42)),
    'clavR': ('chest', (-0.014, -0.004, 0.808), (-0.094, 0.004, 0.81)),
    'upperR': ('clavR', (-0.094, 0.004, 0.81), (-0.118, 0.012, 0.657)),
    'foreR': ('upperR', (-0.118, 0.012, 0.657), (-0.126, -0.012, 0.508)),
    'handR': ('foreR', (-0.126, -0.012, 0.508), (-0.124, -0.028, 0.42)),
    'skirtF': ('hips', (0, -0.03, 0.54), (0, -0.13, 0.04)),
    'skirtB': ('hips', (0, 0.035, 0.54), (0, 0.22, 0.03)),
    'skirtL': ('hips', (0.06, 0.0, 0.54), (0.19, 0.02, 0.04)),
    'skirtR': ('hips', (-0.06, 0.0, 0.54), (-0.19, 0.02, 0.04)),
    'hair1': ('head', (0, 0.052, 0.9), (0, 0.075, 0.6)),
    'hair2': ('hair1', (0, 0.075, 0.6), (0, 0.09, 0.26)),
}

#: The spirit's bones the body's own skin is weighted to (the gown and hair have rules of their own).
SPIRIT_BODY = ['hips', 'spine', 'chest', 'neck', 'head', 'clavL', 'upperL', 'foreL', 'handL',
               'clavR', 'upperR', 'foreR', 'handR']


def build_armature(bpy, bones, name):
    """An armature object of `bones` (for weighting; the files carry only heads, tails and parents)."""
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for bname, (parent, head, tail) in bones.items():
        b = data.edit_bones.new(bname)
        b.head = head
        b.tail = tail
        b.roll = 0.0
        if parent:
            b.parent = data.edit_bones[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def to_gltf(v):
    """Blender (x, y, z), Z up and -Y the front -> glTF (x, y, z), Y up and +Z the front."""
    return (v[0], v[2], -v[1])


def bone_list(bones):
    """The skeleton as the files carry it: [{name, parent (index or -1), head, tail}] in glTF axes."""
    order = list(bones.keys())
    out = []
    for name in order:
        parent, head, tail = bones[name]
        out.append({
            'name': name,
            'parent': order.index(parent) if parent else -1,
            'head': [round(c, 5) for c in to_gltf(head)],
            'tail': [round(c, 5) for c in to_gltf(tail)],
        })
    return out
