"""Original, deterministic Ocean jellyfish and kelp, authored for Blender 4/5.

Call build_assets(output_dir) from Blender. No scene objects are deleted; every
invocation adds its own collection and exports only the two newly made meshes.
Geometry builders are pure Python so topology/budgets can be checked without bpy.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
import struct

try:
    import bpy
except ImportError:  # Offline geometry validation does not need Blender.
    bpy = None


TAU = math.tau
FPS = 24
END_FRAME = 97
AUTHOR = "Serenity Blocks original procedural Blender sculpture"


def _add(a, b):
    return tuple(a[i] + b[i] for i in range(3))


def _sub(a, b):
    return tuple(a[i] - b[i] for i in range(3))


def _scale(a, s):
    return tuple(v * s for v in a)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _normalize(v):
    magnitude = math.sqrt(sum(c * c for c in v))
    return _scale(v, 1.0 / max(magnitude, 1e-12))


def _mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


class MeshBuilder:
    def __init__(self):
        self.vertices = []
        self.colors = []
        self.faces = []
        self.parts = []

    def vertex(self, position, color, part, progress=0.0):
        index = len(self.vertices)
        self.vertices.append(tuple(position))
        self.colors.append(tuple(color))
        self.parts.append((part, progress))
        return index

    def triangle(self, a, b, c):
        self.faces.append((a, b, c))

    def quad(self, a, b, c, d):
        self.triangle(a, b, c)
        self.triangle(a, c, d)

    def tube(self, centers, radii, colors, part, sides=4, ellipse=1.0):
        """Parallel local frames along a curved path; both ends have real caps."""
        rings = []
        for i, center in enumerate(centers):
            tangent = _normalize(_sub(centers[min(i + 1, len(centers) - 1)],
                                      centers[max(0, i - 1)]))
            reference = (0, 0, 1) if abs(tangent[2]) < 0.88 else (0, 1, 0)
            normal = _normalize(_cross(tangent, reference))
            binormal = _cross(tangent, normal)
            ring = []
            t = i / (len(centers) - 1)
            for j in range(sides):
                angle = j * TAU / sides
                offset = _add(_scale(normal, math.cos(angle) * radii[i]),
                              _scale(binormal, math.sin(angle) * radii[i] * ellipse))
                ring.append(self.vertex(_add(center, offset), colors[i], part, t))
            rings.append(ring)
            if i:
                for j in range(sides):
                    k = (j + 1) % sides
                    self.quad(rings[i - 1][j], rings[i - 1][k], ring[k], ring[j])
        root = self.vertex(centers[0], colors[0], part, 0.0)
        tip = self.vertex(centers[-1], colors[-1], part, 1.0)
        for j in range(sides):
            k = (j + 1) % sides
            self.triangle(root, rings[0][k], rings[0][j])
            self.triangle(tip, rings[-1][j], rings[-1][k])


def _jelly_geometry():
    mesh = MeshBuilder()
    around, rings = 24, 6
    shells = []
    for inner in (False, True):
        crown_color = (0.45, 0.76, 0.85, 0.18 if inner else 0.27)
        rim_color = (0.48, 0.52, 0.91, 0.25 if inner else 0.43)
        apex = mesh.vertex((0, 0, 0.83 - (0.035 if inner else 0)), crown_color, "bell")
        shell = []
        for row in range(1, rings + 1):
            t = row / rings
            radius = math.sin(t * math.pi / 2) * 1.06
            height = 0.12 + math.cos(t * math.pi / 2) * 0.71
            ring = []
            for j in range(around):
                angle = j * TAU / around
                scallop = math.cos(angle * 8) * t ** 5
                r = (radius + scallop * 0.047) * (0.965 if inner else 1)
                z = height + scallop * 0.045 - (0.032 if inner else 0)
                ribs = (math.cos(angle * 8) * 0.5 + 0.5) * t
                color = _mix(crown_color, rim_color, t ** 2)
                color = (color[0] + ribs * 0.04, color[1] + ribs * 0.06,
                         color[2] + ribs * 0.04, color[3])
                ring.append(mesh.vertex((math.cos(angle) * r, math.sin(angle) * r, z),
                                        color, "bell", t))
            if row == 1:
                for j in range(around):
                    a, b = ring[j], ring[(j + 1) % around]
                    mesh.triangle(apex, b, a) if inner else mesh.triangle(apex, a, b)
            else:
                previous = shell[-1]
                for j in range(around):
                    k = (j + 1) % around
                    if inner:
                        mesh.quad(previous[j], previous[k], ring[k], ring[j])
                    else:
                        mesh.quad(previous[j], ring[j], ring[k], previous[k])
            shell.append(ring)
        shells.append(shell[-1])
    for j in range(around):
        k = (j + 1) % around
        mesh.quad(shells[0][j], shells[1][j], shells[1][k], shells[0][k])

    # Eight real, gently curling peripheral tentacles; each is a smooth tube.
    for strand in range(8):
        angle = strand * TAU / 8 + 0.13
        reach = 2.1 + (strand % 3) * 0.29
        points, radii, colors = [], [], []
        for step in range(9):
            t = step / 8
            radial = 0.86 + math.sin(t * 4 + strand * 0.7) * 0.15 * t
            points.append((math.cos(angle) * radial + math.sin(t * 5 + strand) * 0.17 * t,
                           math.sin(angle) * radial + math.cos(t * 4 + strand * 0.9) * 0.16 * t,
                           0.075 - reach * t))
            radii.append(0.028 * (1 - t) ** 0.72 + 0.007)
            colors.append(_mix((0.52, 0.71, 0.95, 0.84), (0.25, 0.66, 0.73, 0.64), t))
        mesh.tube(points, radii, colors, "tentacle", sides=4)

    # Four wider ruffled oral arms occupy the clear interior of the umbrella.
    for arm in range(4):
        angle = arm * TAU / 4 + 0.7
        points, radii, colors = [], [], []
        for step in range(8):
            t = step / 7
            radius = 0.14 + t * 0.2
            points.append((math.cos(angle) * radius + math.sin(t * 7 + arm) * 0.08 * t,
                           math.sin(angle) * radius + math.cos(t * 6 + arm) * 0.08 * t,
                           0.25 - t * (1.5 + (arm % 2) * 0.16)))
            radii.append((0.09 + math.sin(t * 15 + arm) * 0.022) * (1 - 0.64 * t))
            colors.append(_mix((0.72, 0.54, 0.92, 0.94), (0.42, 0.66, 0.88, 0.78), t))
        mesh.tube(points, radii, colors, "oral", sides=4, ellipse=1.65)
    return mesh


def _kelp_geometry():
    """Leafy forest kelp: four stipes, 24 ribbons and six small amber nodules."""
    mesh = MeshBuilder()
    stems = [(-0.28, -0.15, 3.85, 0.2), (0.20, 0.18, 4.70, 2.0),
             (-0.06, 0.24, 5.35, 4.1), (0.26, -0.22, 4.20, 5.4)]
    flow = (0.94, 0.34, 0)
    for stem_index, (sx, sy, height, phase) in enumerate(stems):
        def spine(t):
            return (sx + math.sin(t * 3.5 + phase) * t * 0.18 + flow[0] * t * t * 0.28,
                    sy + math.cos(t * 2.7 + phase) * t * 0.16 + flow[1] * t * t * 0.22,
                    height * t)
        centers = [spine(i / 10) for i in range(11)]
        radii = [0.034 * (1 - i / 10) + 0.008 for i in range(11)]
        colors = [_mix((0.025, 0.075, 0.030, 1), (0.16, 0.24, 0.055, 1), i / 10)
                  for i in range(11)]
        mesh.tube(centers, radii, colors, "stipe", sides=4)
        for leaf in range(6):
            # Broad at the shoulder, then progressively finer: long blades
            # unfold along the stipe, with no opposite terrestrial leaf pairs.
            attach = 0.11 + leaf * 0.132 + math.sin(phase + leaf) * 0.015
            root = spine(attach)
            angle = phase + leaf * 2.31
            reach = (1.63 + math.sin(leaf * 1.7 + phase) * 0.21) * (height / 4.70)
            branch = (math.cos(angle), math.sin(angle), 0)
            across = (-math.sin(angle), math.cos(angle), 0)
            centers = []
            for step in range(9):
                t = step / 8
                spread = reach * math.sin(t * math.pi * 0.77) * 0.53
                sweep = reach * t * t * 0.22
                curl = math.sin(t * math.pi * 1.6) * reach * t * 0.065
                centers.append((root[0] + branch[0] * spread + flow[0] * sweep + across[0] * curl,
                                root[1] + branch[1] * spread + flow[1] * sweep + across[1] * curl,
                                root[2] + reach * (0.94 * t - 0.39 * t * t)))
            blade = []
            for step in range(9):
                t = step / 8
                center = centers[step]
                tangent = _normalize(_sub(centers[min(step + 1, 8)], centers[max(step - 1, 0)]))
                projection = sum(across[i] * tangent[i] for i in range(3))
                width_axis = _normalize(_sub(across, _scale(tangent, projection)))
                normal = _cross(tangent, width_axis)
                twist = 0.10 + t * 0.42 + math.sin(t * 4.8 + phase) * 0.21
                width_axis = _add(_scale(width_axis, math.cos(twist)), _scale(normal, math.sin(twist)))
                normal = _cross(tangent, width_axis)
                width = 0.003 + math.sin(math.pi * t) ** 0.63 * (1 - t * 0.44) * reach * 0.14
                row = []
                for cross in (-1, 0, 1):
                    asymmetry = 1.13 if cross < 0 else 0.83
                    lateral = width * cross * asymmetry
                    cup = width * abs(cross) * (0.31 + math.sin(t * 15 + leaf) * 0.14)
                    point = _add(center, _add(_scale(width_axis, lateral), _scale(normal, cup)))
                    variation = 0.5 + math.sin(phase + leaf * 1.3) * 0.5
                    leaf_green = _mix((0.045, 0.19, 0.065, 1), (0.11, 0.28, 0.055, 1), variation)
                    ochre = _mix((0.32, 0.34, 0.09, 1), (0.40, 0.39, 0.10, 1), variation)
                    color = _mix((0.025, 0.12, 0.045, 1), leaf_green, min(1, t * 3 + 0.30))
                    color = _mix(color, ochre, max(0, (t - 0.59) / 0.41) * 0.79)
                    if cross == 0:
                        color = _mix(color, (0.18, 0.27, 0.060, 1), 0.28)
                    else:
                        color = _scale(color[:3], 0.90 + math.sin(t * 17 + leaf) * 0.06) + (1,)
                    row.append(mesh.vertex(point, color, "blade", t))
                if step:
                    for cross in range(2):
                        mesh.quad(blade[-1][cross], row[cross], row[cross + 1], blade[-1][cross + 1])
                blade.append(row)
        if stem_index < 3:
            # Paired almond-shaped growths are sparse color accents, not a
            # chain of lanterns. Their warm vertex paint supports a tiny
            # runtime emission mask while retaining one material/draw.
            root = spine(0.26 + stem_index * 0.14)
            angle = phase + 0.9
            end = (root[0] + math.cos(angle) * 0.14,
                   root[1] + math.sin(angle) * 0.14, root[2] + 0.12)
            mesh.tube([root, _mix(root, end, 0.5), end], [0.023, 0.018, 0.011],
                      [(0.10, 0.13, 0.035, 1)] * 3, "growth", sides=4)
            for nodule in range(2):
                center = (end[0] + math.cos(angle + math.pi / 2) * (nodule - 0.5) * 0.16,
                          end[1] + math.sin(angle + math.pi / 2) * (nodule - 0.5) * 0.16,
                          end[2] + nodule * 0.08)
                rings = []
                for z_offset, radial, color in ((-0.06, 0.055, (0.26, 0.08, 0.012, 1)),
                                                (0.07, 0.068, (0.92, 0.49, 0.055, 1))):
                    rings.append([mesh.vertex((center[0] + math.cos(side * TAU / 6) * radial,
                                               center[1] + math.sin(side * TAU / 6) * radial,
                                               center[2] + z_offset), color, "growth") for side in range(6)])
                bottom = mesh.vertex((center[0], center[1], center[2] - 0.125),
                                     (0.20, 0.055, 0.008, 1), "growth")
                tip = mesh.vertex((center[0], center[1], center[2] + 0.145),
                                  (1.0, 0.66, 0.12, 1), "growth")
                for side in range(6):
                    nxt = (side + 1) % 6
                    mesh.triangle(bottom, rings[0][nxt], rings[0][side])
                    mesh.quad(rings[0][side], rings[0][nxt], rings[1][nxt], rings[1][side])
                    mesh.triangle(tip, rings[1][side], rings[1][nxt])
    for root in range(5):
        angle = root * TAU / 5
        centers = [(math.cos(angle) * t * 0.53, math.sin(angle) * t * 0.45,
                    0.040 + math.sin(t * math.pi) * 0.08) for t in [i / 3 for i in range(4)]]
        mesh.tube(centers, [0.047, 0.033, 0.021, 0.010],
                  [(0.025, 0.055, 0.025, 1)] * 4, "root", sides=4)
    bottom = min(point[2] for point in mesh.vertices)
    mesh.vertices = [(x, y, z - bottom) for x, y, z in mesh.vertices]
    return mesh


def _jelly_morphs(mesh):
    pulse, sway = [], []
    for (x, y, z), (part, t) in zip(mesh.vertices, mesh.parts):
        if part == "bell":
            contraction = 1 - 0.115 * t
            pulse.append((x * contraction, y * contraction, z + 0.06 - t * 0.10))
        else:
            contraction = 1 - 0.10 * (1 - t) ** 2
            pulse.append((x * contraction, y * contraction,
                          z - 0.035 + math.sin(t * math.pi) * 0.075))
        flex = max(0.0, min(1.0, (0.4 - z) / 3.1))
        sway.append((x + flex ** 1.45 * 0.36,
                     y + math.sin(flex * math.pi * 0.8) * flex * 0.16, z))
    return {"bellPulse": pulse, "currentSway": sway}


def _kelp_morphs(mesh):
    primary, crosscurrent = [], []
    for (x, y, z), (part, t) in zip(mesh.vertices, mesh.parts):
        flex = max(0.0, z / 5.35) ** 1.7 if part != "root" else 0.0
        leaf_motion = t * t * 0.065 if part == "blade" else 0.0
        primary.append((x + flex * 0.65 + math.sin(z * 1.3 + y) * leaf_motion,
                        y + flex * 0.14, z - flex * 0.035))
        crosscurrent.append((x + flex * 0.12,
                             y + flex * 0.47 + math.sin(z * 1.7 + x) * leaf_motion,
                             z + math.sin(t * math.pi) * leaf_motion))
    return {"currentSway": primary, "crossSway": crosscurrent}


def _make_material(name, translucent):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (0.62, 0.76, 0.88, 0.45) if translucent else (0.23, 0.42, 0.1, 1)
    material.use_backface_culling = False
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Roughness"].default_value = 0.28 if translucent else 0.72
    if "IOR" in shader.inputs:
        shader.inputs["IOR"].default_value = 1.34 if translucent else 1.45
    color = material.node_tree.nodes.new("ShaderNodeVertexColor")
    color.layer_name = "Color"
    material.node_tree.links.new(color.outputs["Color"], shader.inputs["Base Color"])
    if translucent:
        material.node_tree.links.new(color.outputs["Alpha"], shader.inputs["Alpha"])
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
        elif hasattr(material, "blend_method"):
            material.blend_method = "BLEND"
    return material


def _action_curves(action):
    """Legacy and layered Actions, without assuming Blender 4's fcurves API."""
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        yield from legacy
        return
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []):
                yield from bag.fcurves


def _make_object(builder, name, material, morphs, collection, jelly):
    mesh = bpy.data.meshes.new(name + "_geometry")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    colors = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="POINT")
    colors.data.foreach_set("color", [component for color in builder.colors for component in color])
    mesh.color_attributes.active_color = colors
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj["author"] = AUTHOR
    obj["assetId"] = name
    obj["morphAnimation"] = "relative shape keys; loop; independent instance phase supported"
    obj.shape_key_add(name="Basis")
    for key_name, coordinates in morphs.items():
        key = obj.shape_key_add(name=key_name)
        key.slider_min = 0 if key_name == "bellPulse" else -1
        key.slider_max = 1
        key.data.foreach_set("co", [component for vertex in coordinates for component in vertex])
    keys = mesh.shape_keys
    for frame in range(1, END_FRAME + 1, 6):
        t = (frame - 1) / (END_FRAME - 1)
        phase = TAU * t
        values = {"bellPulse": (1 - math.cos(phase * 2)) * 0.5,
                  "currentSway": math.sin(phase) * 0.9,
                  "crossSway": math.sin(phase + math.pi / 3) * 0.65}
        if frame == END_FRAME:
            values = {"bellPulse": 0.0, "currentSway": 0.0,
                      "crossSway": math.sin(math.pi / 3) * 0.65}
        for key_name in morphs:
            key = keys.key_blocks[key_name]
            key.value = values[key_name]
            key.keyframe_insert(data_path="value", frame=frame, group="Ocean living motion")
    action = keys.animation_data.action
    clip_name = "Jellyfish_Float_Loop" if jelly else "Kelp_Current_Loop"
    action.name = clip_name
    action.use_fake_user = True
    for curve in _action_curves(action):
        for keyframe in curve.keyframe_points:
            keyframe.interpolation = "LINEAR"
    slot = getattr(keys.animation_data, "action_slot", None)
    track = keys.animation_data.nla_tracks.new()
    track.name = clip_name
    strip = track.strips.new(clip_name, 1, action)
    if slot is not None and hasattr(strip, "action_slot"):
        strip.action_slot = slot
    keys.animation_data.action = None
    keys.animation_data.use_nla = True
    for key_name in morphs:
        keys.key_blocks[key_name].value = 0.0
    return obj, clip_name


def _inspect_glb(path, expected_shapes, budget):
    content = path.read_bytes()
    magic, version, total = struct.unpack_from("<III", content, 0)
    if magic != 0x46546C67 or version != 2 or total != len(content):
        raise RuntimeError("Invalid GLB header: " + str(path))
    json_size, chunk_type = struct.unpack_from("<II", content, 12)
    if chunk_type != 0x4E4F534A:
        raise RuntimeError("Missing GLB JSON chunk: " + str(path))
    document = json.loads(content[20:20 + json_size].decode("utf-8"))
    meshes = document.get("meshes", [])
    if len(meshes) != 1 or len(meshes[0].get("primitives", [])) != 1:
        raise RuntimeError("Living assets must export one mesh and one primitive")
    primitive = meshes[0]["primitives"][0]
    attributes = primitive["attributes"]
    accessors = document["accessors"]
    vertices = accessors[attributes["POSITION"]]["count"]
    triangles = accessors[primitive["indices"]]["count"] // 3
    targets = primitive.get("targets", [])
    target_names = meshes[0].get("extras", {}).get("targetNames", [])
    if triangles > budget or len(targets) != 2 or "COLOR_0" not in attributes:
        raise RuntimeError(f"Export budget/morph/color contract failed: {path}")
    if target_names != list(expected_shapes):
        raise RuntimeError(f"Shape key names lost in export: {target_names}")
    animations = document.get("animations", [])
    weight_tracks = [channel for animation in animations for channel in animation.get("channels", [])
                     if channel.get("target", {}).get("path") == "weights"]
    if not weight_tracks or len(document.get("materials", [])) != 1:
        raise RuntimeError("GLB must contain morph-weight animation and one shared material")
    material = document["materials"][0]
    if "bellPulse" in expected_shapes and (
            accessors[attributes["COLOR_0"]]["type"] != "VEC4"
            or material.get("alphaMode") != "BLEND"):
        raise RuntimeError("Jellyfish export lost vertex alpha or translucent blend mode")
    return {"file": path.name, "bytes": len(content),
            "meshCount": 1, "primitiveCount": 1, "materialCount": 1,
            "vertexCount": vertices, "triangleCount": triangles,
            "shapeKeys": target_names, "morphTargetCount": len(targets),
            "colorAttributeType": accessors[attributes["COLOR_0"]]["type"],
            "alphaMode": material.get("alphaMode", "OPAQUE"),
            "animations": [{"name": animation.get("name"),
                            "channels": [channel["target"]["path"] for channel in animation["channels"]]}
                           for animation in animations],
            "loopSeconds": (END_FRAME - 1) / FPS,
            "bounds": {"min": accessors[attributes["POSITION"]].get("min"),
                       "max": accessors[attributes["POSITION"]].get("max")}}


def _export_object(obj, destination, shape_names, budget):
    for selected in bpy.context.selected_objects:
        selected.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    options = {"filepath": str(destination), "export_format": "GLB", "use_selection": True,
               "export_yup": True, "export_materials": "EXPORT", "export_normals": True,
               "export_texcoords": False, "export_vertex_color": "ACTIVE",
               "export_all_vertex_colors": True, "export_animations": True,
               "export_animation_mode": "NLA_TRACKS", "export_frame_range": True,
               "export_force_sampling": True, "export_optimize_animation_size": False,
               "export_morph": True, "export_morph_normal": True,
               "export_apply": False, "export_extras": True}
    supported = bpy.ops.export_scene.gltf.get_rna_type().properties
    bpy.ops.export_scene.gltf(**{key: value for key, value in options.items() if key in supported})
    return _inspect_glb(destination, shape_names, budget)


def build_kelp_asset(output_dir):
    """Export only forest kelp, preserving the jellyfish and every existing scene object."""
    if bpy is None:
        raise RuntimeError("build_kelp_asset must run inside Blender")
    destination = Path(output_dir).expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    old_selection = list(bpy.context.selected_objects)
    old_active = bpy.context.view_layer.objects.active
    old_mode = old_active.mode if old_active is not None else "OBJECT"
    old_timing = (scene.frame_start, scene.frame_end, scene.frame_current,
                  scene.render.fps, scene.render.fps_base)
    if old_mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    collection = bpy.data.collections.new("Serenity_Ocean_Kelp_Forest")
    collection["author"] = AUTHOR
    scene.collection.children.link(collection)
    try:
        scene.frame_start, scene.frame_end, scene.render.fps, scene.render.fps_base = 1, END_FRAME, FPS, 1.0
        geometry = _kelp_geometry()
        if len(geometry.faces) > 1520:
            raise RuntimeError("Forest kelp exceeded its existing triangle budget")
        morphs = _kelp_morphs(geometry)
        material = _make_material("Ocean_forest_kelp_vertex_color", False)
        obj, clip = _make_object(geometry, "kelp", material, morphs, collection, False)
        obj["forestRevision"] = "leafy-olive-24-fronds-amber-growth"
        scene.frame_set(1)
        stats = _export_object(obj, destination / "kelp.glb", morphs, 1520)
        stats.update({"blenderObject": obj.name, "clipTrack": clip,
                      "sourceVertices": len(geometry.vertices), "sourceTriangles": len(geometry.faces),
                      "vertexColorAlpha": "opaque leafy ribbons, dark holdfasts and warm amber growths"})
        manifest_path = destination / "living-assets-manifest.json"
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["assets"] = [stats if asset["file"] == "kelp.glb" else asset for asset in manifest["assets"]]
            manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        return stats
    finally:
        scene.frame_start, scene.frame_end, frame, scene.render.fps, scene.render.fps_base = old_timing
        scene.frame_set(frame)
        for selected in list(bpy.context.selected_objects):
            selected.select_set(False)
        for selected in old_selection:
            selected.select_set(True)
        bpy.context.view_layer.objects.active = old_active
        if old_active is not None and old_mode != "OBJECT":
            bpy.ops.object.mode_set(mode=old_mode)


def build_assets(output_dir):
    """Add a dedicated collection, export both animated GLBs, return a manifest."""
    if bpy is None:
        raise RuntimeError("build_assets must run inside Blender; offline geometry builders remain available")
    destination = Path(output_dir).expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    old_selection = list(bpy.context.selected_objects)
    old_active = bpy.context.view_layer.objects.active
    old_mode = old_active.mode if old_active is not None else "OBJECT"
    old_timing = (scene.frame_start, scene.frame_end, scene.frame_current,
                  scene.render.fps, scene.render.fps_base)
    if old_mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    collection = bpy.data.collections.new("Serenity_Ocean_Living_Assets")
    collection["author"] = AUTHOR
    scene.collection.children.link(collection)
    manifest = {"author": AUTHOR, "collection": collection.name,
                "blenderVersion": bpy.app.version_string, "glTFUpAxis": "Y",
                "textureCount": 0, "canonicalManifest": "asset-manifest.json", "assets": []}
    try:
        scene.frame_start, scene.frame_end, scene.render.fps, scene.render.fps_base = 1, END_FRAME, FPS, 1.0
        for name, geometry_fn, morph_fn, jelly in (
                ("jellyfish", _jelly_geometry, _jelly_morphs, True),
                ("kelp", _kelp_geometry, _kelp_morphs, False)):
            geometry = geometry_fn()
            if len(geometry.faces) > 1600:
                raise RuntimeError(f"{name} exceeded authoring budget: {len(geometry.faces)} triangles")
            morphs = morph_fn(geometry)
            material = _make_material("Ocean_" + name + "_vertex_color", jelly)
            obj, clip = _make_object(geometry, name, material, morphs, collection, jelly)
            scene.frame_set(1)
            stats = _export_object(obj, destination / (name + ".glb"), morphs, 1600)
            stats.update({"blenderObject": obj.name, "clipTrack": clip,
                          "sourceVertices": len(geometry.vertices),
                          "sourceTriangles": len(geometry.faces),
                          "vertexColorAlpha": "bell shell translucency, denser oral arms/tentacles"
                          if jelly else "opaque ribbons and stipes"})
            manifest["assets"].append(stats)
        (destination / "living-assets-manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        return manifest
    finally:
        scene.frame_start, scene.frame_end, frame, scene.render.fps, scene.render.fps_base = old_timing
        scene.frame_set(frame)
        for selected in list(bpy.context.selected_objects):
            selected.select_set(False)
        for selected in old_selection:
            selected.select_set(True)
        bpy.context.view_layer.objects.active = old_active
        if old_active is not None and old_mode != "OBJECT":
            bpy.ops.object.mode_set(mode=old_mode)
