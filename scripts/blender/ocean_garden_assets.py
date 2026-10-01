"""Original small Ocean biome sculptures and current loops for Blender 4/5.

Import this file, then call build_assets(output_dir). Existing scene objects are
preserved. Pure geometry/validation functions also work in ordinary Python.
"""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path


def _sibling(filename, module_name):
    spec = importlib.util.spec_from_file_location(module_name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_living = _sibling("ocean_living_assets.py", "ocean_garden_living_utilities")
_metadata = _sibling("refresh_ocean_asset_manifest.py", "ocean_garden_glb_metadata")
bpy = _living.bpy
MeshBuilder = _living.MeshBuilder
_add, _sub, _scale = _living._add, _living._sub, _living._scale
_cross, _normalize, _mix = _living._cross, _living._normalize, _living._mix
TAU = math.tau
AUTHOR = "Serenity Blocks original Blender garden sculpture"
SHAPE_NAMES = ("currentSway", "crossSway")


def _ellipsoid(mesh, center, radius, low, high, part="body", around=8, latitude=5, distort=None):
    """Closed ellipsoid with true pole fans, painted from shade to crown."""
    def vertex(theta, phi):
        z = math.cos(theta)
        point = (center[0] + radius[0] * math.sin(theta) * math.cos(phi),
                 center[1] + radius[1] * math.sin(theta) * math.sin(phi),
                 center[2] + radius[2] * z)
        if distort:
            point = distort(point, theta, phi)
        return mesh.vertex(point, _mix(low, high, 0.5 + z * 0.5), part, 0.5 + z * 0.5)

    top = vertex(0, 0)
    rings = []
    for row in range(1, latitude):
        rings.append([vertex(row * math.pi / latitude, side * TAU / around) for side in range(around)])
    bottom = vertex(math.pi, 0)
    for side in range(around):
        nxt = (side + 1) % around
        mesh.triangle(top, rings[0][side], rings[0][nxt])
        mesh.triangle(bottom, rings[-1][nxt], rings[-1][side])
        for row in range(1, len(rings)):
            mesh.quad(rings[row - 1][side], rings[row][side], rings[row][nxt], rings[row - 1][nxt])


def _rosette():
    mesh = MeshBuilder()
    for layer, (cx, cy, height, radius) in enumerate(((-0.22, -0.04, 0.06, 0.97),
                                                   (0.22, 0.14, 0.40, 0.79),
                                                   (-0.05, 0.02, 0.72, 0.57))):
        shells = []
        for inner in (False, True):
            center = mesh.vertex((cx, cy, height + (0.035 if inner else 0)),
                                 (0.32, 0.035, 0.075, 1), "cup")
            rings = []
            for row in range(1, 5):
                t = row / 4
                ring = []
                for side in range(16):
                    angle = side * TAU / 16
                    scallop = math.sin(angle * 5 + layer * 0.8) * t ** 3
                    r = radius * t * (1 + scallop * 0.10)
                    z = height + 0.32 * t * t + scallop * 0.085
                    z += math.sin(angle + layer) * t * 0.08 + (0.035 if inner else 0)
                    color = _mix((0.33, 0.035, 0.07, 1), (0.93, 0.43, 0.27, 1), t ** 1.8)
                    if inner:
                        color = _mix(color, (0.74, 0.24, 0.22, 1), 0.17)
                    ring.append(mesh.vertex((cx + math.cos(angle) * r, cy + math.sin(angle) * r, z),
                                            color, "cup", t))
                if row == 1:
                    for side in range(16):
                        nxt = (side + 1) % 16
                        face = (center, ring[side], ring[nxt])
                        mesh.triangle(*(face if inner else tuple(reversed(face))))
                else:
                    for side in range(16):
                        nxt = (side + 1) % 16
                        face = (rings[-1][side], ring[side], ring[nxt], rings[-1][nxt])
                        mesh.quad(*(face if inner else tuple(reversed(face))))
                rings.append(ring)
            shells.append(rings[-1])
        for side in range(16):
            nxt = (side + 1) % 16
            mesh.quad(shells[0][side], shells[0][nxt], shells[1][nxt], shells[1][side])
    return mesh


def _antler():
    mesh = MeshBuilder()
    low, high = (0.025, 0.075, 0.29, 1), (0.58, 0.40, 0.82, 1)
    for branch in range(5):
        angle = branch * 2.399
        height = 1.80 + math.sin(branch * 1.3 + 0.7) * 0.46
        points = [(math.cos(angle) * t * (0.34 + t * 0.46),
                   math.sin(angle) * t * (0.25 + t * 0.39),
                   height * t) for t in [i / 5 for i in range(6)]]
        mesh.tube(points, [0.105 * (1 - i / 5) + 0.009 for i in range(6)],
                  [_mix(low, high, (i / 5) ** 2) for i in range(6)], "branch", sides=5)
        for fork in range(2):
            root = points[2 + fork]
            fork_angle = angle + (-0.85 if fork == 0 else 0.77)
            tips = [(root[0] + math.cos(fork_angle) * t * 0.69,
                     root[1] + math.sin(fork_angle) * t * 0.54,
                     root[2] + t * (0.71 + fork * 0.21) - t * t * 0.05)
                    for t in [i / 5 for i in range(6)]]
            mesh.tube(tips, [0.046 * (1 - i / 5) + 0.007 for i in range(6)],
                      [_mix(low, high, 0.20 + (i / 5) ** 1.6 * 0.8) for i in range(6)],
                      "twig", sides=4)
        if branch < 3:
            root = points[3]
            tips = [(root[0] - math.sin(angle) * t * 0.32,
                     root[1] + math.cos(angle) * t * 0.32, root[2] + t * 0.75)
                    for t in [i / 3 for i in range(4)]]
            mesh.tube(tips, [0.035, 0.027, 0.018, 0.007],
                      [_mix(low, high, i / 3) for i in range(4)], "twig", sides=4)
    return mesh


def _anemone():
    mesh = MeshBuilder()
    _ellipsoid(mesh, (0, 0, 0.16), (0.42, 0.36, 0.16),
               (0.08, 0.025, 0.18, 1), (0.34, 0.13, 0.42, 1), "root", latitude=4)
    for arm in range(12):
        angle = arm * TAU / 12
        height = 0.78 + math.sin(arm * 1.7) * 0.22
        points, radii, colors = [], [], []
        for step in range(7):
            t = step / 6
            spread = 0.14 + math.sin(t * math.pi * 0.68) * 0.41
            curl = math.sin(t * math.pi) * 0.12
            points.append((math.cos(angle) * spread - math.sin(angle) * curl,
                           math.sin(angle) * spread + math.cos(angle) * curl,
                           0.18 + t * height - t ** 3 * 0.10))
            radii.append(0.040 * (1 - t) + 0.016 + (0.019 if step == 5 else 0))
            mid = (0.76, 0.31, 0.085, 1) if arm % 3 else (0.07, 0.49, 0.46, 1)
            color = _mix((0.23, 0.07, 0.31, 1), mid, min(1, t * 2))
            colors.append(_mix(color, (0.69, 0.94, 0.78, 1), max(0, (t - 0.65) / 0.35)))
        mesh.tube(points, radii, colors, "tentacle", sides=4)
    return mesh


def _ribbon(mesh, centers, widths, colors, phase, part="blade", ridge=0.24):
    rows = []
    for index, center in enumerate(centers):
        t = index / (len(centers) - 1)
        tangent = _normalize(_sub(centers[min(index + 1, len(centers) - 1)], centers[max(0, index - 1)]))
        lateral = _normalize(_cross(tangent, (math.cos(phase), math.sin(phase), 0.1)))
        normal = _normalize(_cross(tangent, lateral))
        twist = math.sin(t * 5.0 + phase) * 0.40
        lateral = _add(_scale(lateral, math.cos(twist)), _scale(normal, math.sin(twist)))
        normal = _normalize(_cross(tangent, lateral))
        row = []
        for cross in (-1, 0, 1):
            cup = abs(cross) * widths[index] * (ridge + math.sin(t * 14 + phase) * 0.10)
            point = _add(center, _add(_scale(lateral, cross * widths[index]), _scale(normal, cup)))
            row.append(mesh.vertex(point, colors[index], part, t))
        if rows:
            for cross in range(2):
                mesh.quad(rows[-1][cross], row[cross], row[cross + 1], rows[-1][cross + 1])
        rows.append(row)


def _seaweed():
    mesh = MeshBuilder()
    _ellipsoid(mesh, (0, 0, 0.07), (0.26, 0.22, 0.07),
               (0.045, 0.12, 0.12, 1), (0.09, 0.25, 0.23, 1), "root", latitude=4)
    for blade in range(3):
        phase = blade * 2.20
        height = 2.20 + blade * 0.30
        def center(t):
            angle = phase + t * 4.2
            radius = 0.10 + math.sin(t * math.pi * 0.74) * 0.40
            return (math.cos(angle) * radius + t * t * 0.24,
                    math.sin(angle) * radius, 0.05 + height * t)
        centers = [center(i / 16) for i in range(17)]
        widths = [0.006 + math.sin(i / 16 * math.pi) ** 0.6 * 0.17 for i in range(17)]
        colors = [_mix((0.025, 0.16, 0.18, 1), (0.22, 0.48, 0.39, 1), i / 16)
                  for i in range(17)]
        _ribbon(mesh, centers, widths, colors, phase, ridge=0.35)
        mesh.tube([center(i / 12) for i in range(13)],
                  [0.019 * (1 - i / 12) + 0.004 for i in range(13)],
                  [(0.085, 0.29, 0.24, 1)] * 13, "stipe", sides=4)
    return mesh


def _grass():
    mesh = MeshBuilder()
    for blade in range(18):
        phase = blade * 2.399
        radius = 0.07 + math.sqrt((blade + 1) / 18) * 0.38
        height = 0.63 + (0.5 + math.sin(blade * 1.73) * 0.5) * 0.82
        root = (math.cos(phase) * radius, math.sin(phase) * radius, 0)
        centers = [(root[0] + math.cos(phase) * t * t * 0.34 + t ** 3 * 0.28,
                    root[1] + math.sin(phase) * t * t * 0.27,
                    height * (t - t ** 3 * 0.08)) for t in [i / 6 for i in range(7)]]
        widths = [0.004 + math.sin(i / 6 * math.pi) ** 0.68 * 0.036 for i in range(7)]
        colors = [_mix((0.075, 0.17, 0.095, 1), (0.46, 0.49, 0.15, 1), 0.15 + i / 6 * 0.72)
                  for i in range(7)]
        _ribbon(mesh, centers, widths, colors, phase, ridge=0.48)
    return mesh


def _stone():
    mesh = MeshBuilder()
    def weather(point, theta, phi):
        x, y, z = point
        erosion = 1 + math.sin(phi * 5 + z * 6) * 0.065 + math.cos(phi * 3 - z * 8) * 0.035
        return (x * erosion + z * 0.22,
                y * erosion + math.sin(z * 4.1) * 0.09,
                z + math.sin(phi * 3) * math.sin(theta) ** 2 * 0.065)
    _ellipsoid(mesh, (0, 0, 0.58), (1.42, 0.77, 0.58),
               (0.065, 0.14, 0.17, 1), (0.39, 0.42, 0.33, 1),
               around=20, latitude=12, distort=weather)
    return mesh


def _arch():
    mesh = MeshBuilder()
    rings = []
    around, segments = 12, 28
    for row in range(segments + 1):
        t = row / segments
        theta = t * math.pi
        center = (-2.60 * math.cos(theta), math.sin(theta * 2) * 0.16, math.sin(theta) * 3.30)
        tangent = _normalize((2.60 * math.sin(theta), 0, 3.30 * math.cos(theta)))
        radial = (tangent[2], 0, -tangent[0])
        thickness = 0.55 + abs(math.cos(theta)) ** 5 * 0.26
        ring = []
        for side in range(around):
            angle = side * TAU / around
            erosion = 1 + math.sin(row * 2.3 + side * 1.7) * 0.070 + math.cos(side * 3 - row) * 0.035
            offset = _add(_scale(radial, math.cos(angle) * thickness * erosion),
                          (0, math.sin(angle) * thickness * 0.86 * erosion, 0))
            point = _add(center, offset)
            color = _mix((0.055, 0.13, 0.16, 1), (0.37, 0.41, 0.32, 1),
                         0.28 + max(0, math.cos(angle)) * 0.25 + math.sin(theta) * 0.30)
            ring.append(mesh.vertex(point, color, "stone", t))
        if rings:
            for side in range(around):
                nxt = (side + 1) % around
                mesh.quad(rings[-1][side], rings[-1][nxt], ring[nxt], ring[side])
        rings.append(ring)
    for ring_index in (0, -1):
        ring = rings[ring_index]
        center = tuple(sum(mesh.vertices[index][axis] for index in ring) / around for axis in range(3))
        cap = mesh.vertex(center, (0.055, 0.13, 0.16, 1), "stone")
        for side in range(around):
            nxt = (side + 1) % around
            face = (cap, ring[side], ring[nxt])
            mesh.triangle(*(tuple(reversed(face)) if ring_index == 0 else face))
    return mesh


def _pearls():
    mesh = MeshBuilder()
    for polyp in range(5):
        phase = polyp * 2.399
        height = 0.70 + (0.5 + math.sin(polyp * 1.7) * 0.5) * 0.52
        cx, cy = math.cos(phase) * 0.38, math.sin(phase) * 0.35
        centers = [(cx + math.sin(t * 2 + phase) * t * 0.12,
                    cy + math.cos(t * 2.4 + phase) * t * 0.10, height * t)
                   for t in [i / 6 for i in range(7)]]
        mesh.tube(centers, [0.045 - i / 6 * 0.025 for i in range(7)],
                  [_mix((0.12, 0.07, 0.18, 1), (0.30, 0.44, 0.43, 1), i / 6) for i in range(7)],
                  "stipe", sides=4)
        tip = (0.72, 0.48, 0.58, 1) if polyp % 2 else (0.46, 0.77, 0.71, 1)
        _ellipsoid(mesh, centers[-1], (0.235, 0.21, 0.27),
                   (0.18, 0.25, 0.29, 1), tip, "polyp", around=8, latitude=5)
    return mesh


SPECIFICATIONS = (
    ("coral-rosette", _rosette, 1200, False),
    ("coral-antler", _antler, 1000, False),
    ("anemone-lantern", _anemone, 900, True),
    ("seaweed-spiral", _seaweed, 700, True),
    ("grass-meadow", _grass, 450, True),
    ("stone-ridge", _stone, 650, False),
    ("reef-arch", _arch, 1400, False),
    ("pearl-cluster", _pearls, 650, True),
)


def build_geometry():
    """Return fresh, grounded, deterministic builders, budgets and animation flags."""
    result = []
    for name, factory, budget, animated in SPECIFICATIONS:
        mesh = factory()
        bottom = min(point[2] for point in mesh.vertices)
        mesh.vertices = [(x, y, z - bottom) for x, y, z in mesh.vertices]
        if len(mesh.faces) > budget:
            raise RuntimeError(f"{name} exceeds {budget} triangle budget")
        result.append((name, mesh, budget, animated))
    return result


def _morphs(mesh):
    height = max(point[2] for point in mesh.vertices)
    sway, cross = [], []
    for (x, y, z), (part, progress) in zip(mesh.vertices, mesh.parts):
        flex = (z / max(height, 0.001)) ** 1.7 if part != "root" else 0.0
        flutter = math.sin(progress * math.pi) * flex * 0.028
        sway.append((x + flex * 0.16 + math.sin(z * 2.1 + y) * flutter,
                     y + flex * 0.035, z - flex * 0.012))
        cross.append((x + flex * 0.025, y + flex * 0.13 + math.cos(z * 1.7 + x) * flutter, z))
    return dict(zip(SHAPE_NAMES, (sway, cross)))


def _animate(obj, morphs, clip_name):
    obj.shape_key_add(name="Basis")
    for name, vertices in morphs.items():
        key = obj.shape_key_add(name=name)
        key.slider_min, key.slider_max = -1, 1
        key.data.foreach_set("co", [value for vertex in vertices for value in vertex])
    keys = obj.data.shape_keys
    for frame in range(1, 98, 6):
        phase = TAU * (frame - 1) / 96 if frame < 97 else 0
        values = (math.sin(phase) * 0.9, math.sin(phase + 0.9) * 0.65)
        for name, value in zip(SHAPE_NAMES, values):
            key = keys.key_blocks[name]
            key.value = value
            key.keyframe_insert(data_path="value", frame=frame)
    action = keys.animation_data.action
    action.name = clip_name
    action.use_fake_user = True
    for curve in _living._action_curves(action):
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


def _object(name, builder, animated, collection):
    geometry = bpy.data.meshes.new(name + "_garden_geometry")
    geometry.from_pydata(builder.vertices, [], builder.faces)
    geometry.update()
    colors = geometry.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="POINT")
    colors.data.foreach_set("color", [value for color in builder.colors for value in color])
    geometry.color_attributes.active_color = colors
    for polygon in geometry.polygons:
        polygon.use_smooth = True
    material = _living._make_material("Ocean_Garden_" + name, False)
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = 0.86 if name in ("reef-arch", "stone-ridge") else 0.67
    if name in ("anemone-lantern", "pearl-cluster") and "Emission Color" in shader.inputs:
        color_node = next(node for node in material.node_tree.nodes if node.type == "VERTEX_COLOR")
        material.node_tree.links.new(color_node.outputs["Color"], shader.inputs["Emission Color"])
        shader.inputs["Emission Strength"].default_value = 0.045
    geometry.materials.append(material)
    obj = bpy.data.objects.new(name, geometry)
    collection.objects.link(obj)
    obj["author"], obj["asset_id"], obj["license"] = AUTHOR, name, "MIT-project-local"
    obj["seabed_anchor"] = True
    if animated:
        obj["animation_loop_seconds"] = 4.0
        _animate(obj, _morphs(builder), name.replace("-", "_") + "_Current_4s")
    return obj


def _export(obj, destination, animated, budget):
    for selected in list(bpy.context.selected_objects):
        selected.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    options = {"filepath": str(destination), "export_format": "GLB", "use_selection": True,
               "export_yup": True, "export_materials": "EXPORT", "export_normals": True,
               "export_texcoords": False, "export_vertex_color": "ACTIVE", "export_all_vertex_colors": True,
               "export_animations": animated, "export_animation_mode": "NLA_TRACKS",
               "export_frame_range": True, "export_force_sampling": True,
               "export_optimize_animation_size": False, "export_morph": True, "export_morph_normal": True,
               "export_apply": False, "export_extras": True}
    supported = bpy.ops.export_scene.gltf.get_rna_type().properties
    result = bpy.ops.export_scene.gltf(**{key: value for key, value in options.items() if key in supported})
    if "FINISHED" not in result:
        raise RuntimeError("GLB export did not finish: " + destination.name)
    stats = _metadata.inspect_asset(destination)
    if stats["triangleCount"] > budget or abs(stats["bounds"]["min"][1]) > 1e-5:
        raise RuntimeError("GLB budget or seabed grounding failed: " + destination.name)
    if animated and (stats["shapeKeys"] != list(SHAPE_NAMES) or len(stats["animations"]) != 1):
        raise RuntimeError("GLB lost the two-target loop: " + destination.name)
    if animated and abs(stats["animations"][0]["loopSeconds"] - 4) > 1e-5:
        raise RuntimeError("GLB loop duration changed: " + destination.name)
    stats.update({"source": "scripts/blender/ocean_garden_assets.py", "triangleBudget": budget,
                  "blenderObject": obj.name})
    return stats


def build_assets(output_dir):
    """Preserve the scene; author eight original sculptures and export them individually."""
    if bpy is None:
        raise RuntimeError("build_assets requires Blender; use build_geometry for offline inspection")
    destination = Path(output_dir).expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    old_selection = list(bpy.context.selected_objects)
    old_active = bpy.context.view_layer.objects.active
    old_mode = old_active.mode if old_active else "OBJECT"
    old_timing = (scene.frame_start, scene.frame_end, scene.frame_current, scene.render.fps, scene.render.fps_base)
    if old_mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    collection = bpy.data.collections.new("Serenity_Ocean_Original_Garden")
    scene.collection.children.link(collection)
    manifest = {"author": AUTHOR, "collection": collection.name, "blenderVersion": bpy.app.version_string,
                "glTFUpAxis": "Y", "textureCount": 0, "canonicalManifest": "asset-manifest.json", "assets": []}
    try:
        scene.frame_start, scene.frame_end, scene.render.fps, scene.render.fps_base = 1, 97, 24, 1.0
        for name, builder, budget, animated in build_geometry():
            obj = _object(name, builder, animated, collection)
            scene.frame_set(1)
            manifest["assets"].append(_export(obj, destination / (name + ".glb"), animated, budget))
        (destination / "garden-assets-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        return manifest
    finally:
        scene.frame_start, scene.frame_end, frame, scene.render.fps, scene.render.fps_base = old_timing
        scene.frame_set(frame)
        for selected in list(bpy.context.selected_objects):
            selected.select_set(False)
        for selected in old_selection:
            selected.select_set(True)
        bpy.context.view_layer.objects.active = old_active
        if old_active and old_mode != "OBJECT":
            bpy.ops.object.mode_set(mode=old_mode)
