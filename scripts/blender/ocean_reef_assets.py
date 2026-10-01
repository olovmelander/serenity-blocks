"""Original Serenity Blocks reef assets. Execute inside Blender, then call build_assets(path).

The destination is supplied by the caller. No scene objects are deleted, no external
assets are fetched, and each export contains one mesh and one vertex-color material.
Authored coordinates are Blender Z-up; the glTF exporter converts them to Y-up.
"""

from pathlib import Path
import math
import random

import bpy


SEED = 0x0CEA2026
COLLECTION_NAME = "Serenity Ocean - Original Reef"


def _add(a, b):
    return tuple(a[i] + b[i] for i in range(3))


def _sub(a, b):
    return tuple(a[i] - b[i] for i in range(3))


def _mul(a, factor):
    return tuple(v * factor for v in a)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _normal(a):
    length = math.sqrt(sum(v * v for v in a)) or 1.0
    return _mul(a, 1.0 / length)


def _mix(a, b, t):
    return tuple(a[i] * (1.0 - t) + b[i] * t for i in range(3))


def _bezier(a, b, c, d, count):
    points = []
    for index in range(count):
        t = index / (count - 1)
        s = 1.0 - t
        points.append(tuple(s ** 3 * a[k] + 3 * s * s * t * b[k]
                            + 3 * s * t * t * c[k] + t ** 3 * d[k]
                            for k in range(3)))
    return points


class MeshBuilder:
    """Small deterministic mesh authoring helpers; no modifier or remesh dependency."""

    def __init__(self):
        self.vertices = []
        self.faces = []
        self.shades = []

    def vertex(self, position, shade=1.0):
        self.vertices.append(tuple(position))
        self.shades.append(shade)
        return len(self.vertices) - 1

    def bridge(self, lower, upper):
        for index in range(len(lower)):
            other = (index + 1) % len(lower)
            self.faces.append((lower[index], lower[other], upper[other], upper[index]))

    def tube(self, path, radii, sides=6):
        rings = []
        for index, center in enumerate(path):
            tangent = _normal(_sub(path[min(index + 1, len(path) - 1)],
                                   path[max(index - 1, 0)]))
            # A fixed lateral reference avoids a 90-degree frame snap as a
            # curved branch changes from upright to leaning near its tip.
            reference = (1, 0, 0) if abs(tangent[1]) > 0.94 else (0, 1, 0)
            normal = _normal(_cross(tangent, reference))
            binormal = _normal(_cross(tangent, normal))
            ring = []
            for side in range(sides):
                angle = side / sides * math.tau
                offset = _add(_mul(normal, math.cos(angle) * radii[index]),
                              _mul(binormal, math.sin(angle) * radii[index]))
                ring.append(self.vertex(_add(center, offset)))
            if rings:
                self.bridge(rings[-1], ring)
            rings.append(ring)
        self.faces.append(tuple(reversed(rings[0])))
        self.faces.append(tuple(rings[-1]))

    def finish(self, name, collection):
        # Seabed origin: preserve X/Y composition, seat the lowest point at Z=0.
        low = min(vertex[2] for vertex in self.vertices)
        vertices = [(x, y, z - low) for x, y, z in self.vertices]
        mesh = bpy.data.meshes.new(name + "_Mesh")
        mesh.from_pydata(vertices, [], self.faces)
        mesh.update()
        mesh.validate(verbose=False)
        shades = mesh.attributes.new(name="OceanShade", type="FLOAT", domain="POINT")
        for index, value in enumerate(self.shades):
            shades.data[index].value = value
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        obj = bpy.data.objects.new(name, mesh)
        collection.objects.link(obj)
        obj["author"] = "Serenity Blocks / original Blender reef study"
        obj["license"] = "MIT-project-local"
        obj["seabed_anchor"] = True
        obj["authoring_seed"] = SEED
        obj["asset_id"] = name
        return obj


def _profile(t, knots):
    for (at, av), (bt, bv) in zip(knots, knots[1:]):
        if t <= bt:
            f = max(0, min(1, (t - at) / (bt - at)))
            f = f * f * (3 - 2 * f)
            return av + (bv - av) * f
    return knots[-1][1]


def _buttress():
    """One continuous eroded surface: broad embedded foot, leaning rib, broken ledges."""
    mesh = MeshBuilder()
    rings = []
    knots = [(0, 3.1), (0.12, 2.65), (0.3, 1.8), (0.43, 1.66),
             (0.5, 2.0), (0.57, 1.35), (0.75, 0.97), (0.82, 1.2),
             (0.92, 0.7), (1, 0.10)]
    for row in range(26):
        t = row / 25
        center_x = 0.68 * t + 0.20 * math.sin(t * 4.3)
        center_y = 0.15 * math.sin(t * 3.1)
        radius = _profile(t, knots)
        ring = []
        for column in range(36):
            angle = column / 36 * math.tau
            erosion = (1 + 0.12 * math.sin(angle * 3 + t * 4.5)
                       + 0.065 * math.cos(angle * 7 - t * 6.2))
            # Asymmetric ribs stay part of the same manifold surface.
            buttress_rib = 1 + 0.26 * max(0, math.cos(angle + 0.5)) ** 4 * (1 - t)
            radial = radius * erosion * buttress_rib
            z = t * 7.4 + math.sin(angle * 5 + t * 5) * 0.10 * math.sin(t * math.pi)
            ring.append(mesh.vertex((center_x + math.cos(angle) * radial,
                                     center_y + math.sin(angle) * radial * 0.73, z)))
        if rings:
            mesh.bridge(rings[-1], ring)
        rings.append(ring)
    mesh.faces.append(tuple(reversed(rings[0])))
    mesh.faces.append(tuple(rings[-1]))
    return mesh


def _outcrop():
    """Low limestone shoulder with a broad foot and three worn diagonal ridges."""
    mesh = MeshBuilder()
    rings = []
    for row in range(23):
        t = row / 22
        radius = max(0.025, math.cos(t * math.pi * 0.5))
        ring = []
        for column in range(30):
            angle = column / 30 * math.tau
            worn = 1 + 0.12 * math.sin(angle * 3 + t * 6) + 0.06 * math.sin(angle * 6 - t * 5)
            x = math.cos(angle) * radius * 3.1 * worn + t * 0.55
            y = math.sin(angle) * radius * 2.0 * worn - t * 0.22
            z = t * 2.65 + 0.11 * math.sin(angle * 3 + t * 9) * math.sin(math.pi * t)
            ring.append(mesh.vertex((x, y, z)))
        if rings:
            mesh.bridge(rings[-1], ring)
        rings.append(ring)
    mesh.faces.append(tuple(reversed(rings[0])))
    mesh.faces.append(tuple(rings[-1]))
    return mesh


def _staghorn(rng):
    """Curved unequal antlers with a finer second/third-order branching rhythm."""
    mesh = MeshBuilder()
    for branch in range(7):
        # Six samples per main branch preserve the following sponge asset's
        # deterministic RNG sequence when this colony is refined.
        variation = [rng.random() for _ in range(6)]
        angle = branch * 2.399963 + 0.2
        spread = 0.80 + variation[0] * 0.54
        end = (math.cos(angle) * spread, math.sin(angle) * spread * 0.85,
               2.05 + variation[1] * 1.05)
        curl = (-math.sin(angle) * 0.25, math.cos(angle) * 0.25, 0)
        start = (math.cos(angle) * 0.055, math.sin(angle) * 0.055, 0.05)
        path = _bezier(start, (end[0] * 0.10 - curl[0], end[1] * 0.10 - curl[1], 0.63),
                       (end[0] * 0.54 + curl[0], end[1] * 0.76 + curl[1], end[2] * 0.79), end, 8)
        mesh.tube(path, [0.142, 0.126, 0.105, 0.085, 0.068, 0.050, 0.030, 0.009], 6)
        for fork in range(3):
            start = path[2 + fork * 2]
            side = -1 if (fork + branch) % 2 == 0 else 1
            turn = angle + side * (0.72 + variation[2 + fork % 2] * 0.42)
            reach = (0.67 - fork * 0.16) * (0.90 + variation[4] * 0.22)
            rise = (0.73 - fork * 0.16) * (0.90 + variation[5] * 0.20)
            tip = (start[0] + math.cos(turn) * reach,
                   start[1] + math.sin(turn) * reach * 0.75,
                   start[2] + rise)
            curl_axis = (-math.sin(turn) * 0.095 * side, math.cos(turn) * 0.095 * side, 0)
            fork_path = _bezier(start,
                                _add(start, (math.cos(turn) * reach * 0.36,
                                             math.sin(turn) * reach * 0.28, 0.035)),
                                _add(_mix(start, tip, 0.66), _add(curl_axis, (0, 0, 0.15))), tip, 5)
            taper = 1.0 - fork * 0.12
            mesh.tube(fork_path, [radius * taper for radius in (0.061, 0.054, 0.042, 0.026, 0.007)], 5)
            if fork < 2:
                twig_start = fork_path[2]
                twig_angle = turn - side * 0.80
                twig_tip = _add(twig_start, (math.cos(twig_angle) * 0.24,
                                             math.sin(twig_angle) * 0.18, 0.31 - fork * 0.035))
                twig = _bezier(twig_start, _add(twig_start, (0, 0, 0.07)),
                                _add(_mix(twig_start, twig_tip, 0.75), (0, 0, 0.06)), twig_tip, 4)
                mesh.tube(twig, [0.028, 0.025, 0.016, 0.004], 4)
    return mesh


def _foliose():
    mesh = MeshBuilder()
    stem = [(0.05 * math.sin(i), 0, i * 0.29) for i in range(6)]
    mesh.tube(stem, [0.25, 0.21, 0.18, 0.14, 0.09, 0.045], 8)
    for plate in range(6):
        angle = plate * 2.399963
        size = 1.08 - plate * 0.055
        center = (math.cos(angle) * 0.38, math.sin(angle) * 0.38, 0.28 + plate * 0.235)
        surfaces = []
        for underside in (False, True):
            center_id = mesh.vertex(_add(center, (0, 0, -0.045 if underside else 0)))
            rings = []
            for radial in (0.33, 0.68, 1.0):
                ring = []
                for side in range(16):
                    theta = side / 16 * math.tau
                    scallop = 1 + 0.075 * math.sin(theta * 5 + plate * 0.8)
                    r = radial * size * scallop
                    lx, ly = math.cos(theta) * r * 1.18, math.sin(theta) * r * 0.82
                    x = center[0] + lx * math.cos(angle) - ly * math.sin(angle)
                    y = center[1] + lx * math.sin(angle) + ly * math.cos(angle)
                    curl = radial ** 2 * (0.16 + 0.13 * math.sin(theta * 2 + plate))
                    z = center[2] + curl + lx * 0.14 - (0.045 if underside else 0)
                    ring.append(mesh.vertex((x, y, z)))
                if not rings:
                    for side in range(16):
                        face = (center_id, ring[side], ring[(side + 1) % 16])
                        mesh.faces.append(tuple(reversed(face)) if underside else face)
                else:
                    before = len(mesh.faces)
                    mesh.bridge(rings[-1], ring)
                    if not underside:
                        mesh.faces[before:] = [tuple(reversed(face)) for face in mesh.faces[before:]]
                rings.append(ring)
            surfaces.append(rings[-1])
        # A rolled solid rim, not alpha cards: stable from both sides underwater.
        mesh.bridge(surfaces[1], surfaces[0])
    return mesh


def _fan():
    """An open gorgonian lace: unequal curved veins with feathered outer branchlets."""
    mesh = MeshBuilder()
    mesh.tube([(0, 0, 0), (0.02, 0, 0.18), (0.06, 0.02, 0.40), (0.02, 0, 0.62)],
              [0.15, 0.125, 0.09, 0.055], 8)
    paths = []
    for ray in range(9):
        angle = -1.13 + ray / 8 * 2.26
        end = (math.sin(angle) * 2.16,
               math.sin(angle * 2.7) * 0.13,
               0.58 + math.cos(angle) * 2.45 + math.sin(ray * 1.73) * 0.08)
        curl = math.sin(ray * 1.9) * 0.12
        path = _bezier((0.02, 0, 0.38), (end[0] * 0.19 - curl, 0, 0.96),
                       (end[0] * 0.75 + curl, end[1] * 1.5, end[2] * 0.81), end, 7)
        mesh.tube(path, [0.060, 0.054, 0.045, 0.036, 0.029, 0.020, 0.010], 5)
        paths.append(path)
        for fork in (3, 4, 5):
            start = path[fork]
            side = (-1 if ray < 4 else 1) * (-1 if fork == 4 else 1)
            reach = 0.17 + 0.035 * math.sin(ray * 2.2 + fork)
            tip = _add(start, (side * reach, 0.035 * math.sin(ray + fork), 0.26 + fork * 0.018))
            branch = _bezier(start, _add(start, (side * reach * 0.65, 0, 0.02)),
                             _add(tip, (-side * 0.075, 0.025, -0.09)), tip, 4)
            mesh.tube(branch, [0.024, 0.022, 0.014, 0.005], 4)
        # Fine upward forks soften the outer contour without making a solid sail.
        for side in (-1, 1):
            start = _mix(path[5], path[6], 0.42)
            tip = _add(start, (side * (0.115 + 0.02 * math.sin(ray)), 0.012, 0.17))
            mesh.tube(_bezier(start, _add(start, (side * 0.07, 0, 0.025)),
                              _add(tip, (-side * 0.025, 0, -0.045)), tip, 3),
                      [0.012, 0.010, 0.0035], 3)
    # Uneven node heights break the regular ladder pattern of the initial fan.
    for ray in range(8):
        for level in (2, 4, 5):
            blend = 0.18 + (math.sin(ray * 1.31 + level) + 1) * 0.20
            start = _mix(paths[ray][level], paths[ray][level + 1], blend)
            end = _mix(paths[ray + 1][level], paths[ray + 1][level + 1], 0.58 - blend * 0.45)
            middle = _mix(start, end, 0.5)
            arch = _add(middle, (0, 0.030, 0.055 + math.sin(ray + level) * 0.035))
            mesh.tube(_bezier(start, arch, arch, end, 4), [0.012, 0.016, 0.015, 0.012], 3)
    return mesh


def _sponge(rng):
    """Seven curved, flared tubes with actual recessed interiors and rolled mouths."""
    mesh = MeshBuilder()
    for tube in range(7):
        angle = tube * 2.399963
        spread = 0.0 if tube == 0 else 0.34 + (tube % 3) * 0.20
        center = (math.cos(angle) * spread, math.sin(angle) * spread, 0.01)
        height = 1.30 + rng.random() * 1.23
        lean = (math.cos(angle) * 0.24, math.sin(angle) * 0.24, 0)
        path = _bezier(center, _add(center, (0, 0, height * 0.33)),
                       _add(center, _add(_mul(lean, 0.7), (0, 0, height * 0.75))),
                       _add(center, _add(lean, (0, 0, height))), 8)
        radius = 0.145 + rng.random() * 0.065
        outer = []
        frames = []
        for row, point in enumerate(path):
            t = row / 7
            tangent = _normal(_sub(path[min(row + 1, 7)], path[max(row - 1, 0)]))
            normal = _normal(_cross(tangent, (0, 1, 0)))
            binormal = _normal(_cross(tangent, normal))
            r = radius * (0.8 + t * 0.38 + t ** 5 * 0.46)
            ring = []
            for side in range(10):
                theta = side / 10 * math.tau
                lobe = 1 + 0.055 * math.sin(theta * 3 + tube)
                offset = _add(_mul(normal, math.cos(theta) * r * lobe),
                              _mul(binormal, math.sin(theta) * r * lobe))
                ring.append(mesh.vertex(_add(point, offset)))
            if outer:
                mesh.bridge(outer[-1], ring)
            outer.append(ring)
            frames.append((point, normal, binormal, r))
        mesh.faces.append(tuple(reversed(outer[0])))
        inner = []
        for row in (5, 6, 7):
            point, normal, binormal, r = frames[row]
            inner_radius = r * (0.50 if row == 5 else 0.70 if row == 6 else 0.79)
            ring = []
            for side in range(10):
                theta = side / 10 * math.tau
                offset = _add(_mul(normal, math.cos(theta) * inner_radius),
                              _mul(binormal, math.sin(theta) * inner_radius))
                ring.append(mesh.vertex(_add(point, offset), 0.38 + (row - 5) * 0.25))
            if inner:
                start = len(mesh.faces)
                mesh.bridge(inner[-1], ring)
                mesh.faces[start:] = [tuple(reversed(face)) for face in mesh.faces[start:]]
            inner.append(ring)
        mesh.faces.append(tuple(inner[0]))
        # Rolled lip joins the exterior to the inner wall without sealing it.
        for side in range(10):
            other = (side + 1) % 10
            mesh.faces.append((outer[-1][side], outer[-1][other], inner[-1][other], inner[-1][side]))
    return mesh


def _paint(obj, palette, rock=False):
    mesh = obj.data
    height = max(vertex.co.z for vertex in mesh.vertices) or 1
    colors = mesh.color_attributes.new(name="OceanColor", type="FLOAT_COLOR", domain="CORNER")
    for loop in mesh.loops:
        vertex = mesh.vertices[loop.vertex_index]
        x, y, z = vertex.co
        t = max(0, min(1, z / height))
        hue = _mix(palette[0], palette[1], t ** 0.7)
        grain = (0.96 + math.sin(x * 4.7 + y * 3.2 + z * 2.4) * 0.04)
        grain *= mesh.attributes["OceanShade"].data[loop.vertex_index].value
        if rock:
            upward = max(0, vertex.normal.z)
            ledge = min(0.72, upward ** 2 * (0.35 + t * 0.45))
            hue = _mix(hue, (0.48, 0.43, 0.29), ledge)
        colors.data[loop.index].color = tuple(c * grain for c in hue) + (1.0,)
    mesh.color_attributes.active_color_index = len(mesh.color_attributes) - 1
    mesh.color_attributes.render_color_index = len(mesh.color_attributes) - 1
    material = bpy.data.materials.new(obj.name + "_VertexPBR")
    material.use_nodes = True
    material.use_backface_culling = True
    nodes = material.node_tree.nodes
    principled = nodes.get("Principled BSDF")
    vertex_color = nodes.new("ShaderNodeVertexColor")
    vertex_color.layer_name = "OceanColor"
    material.node_tree.links.new(vertex_color.outputs["Color"], principled.inputs["Base Color"])
    principled.inputs["Roughness"].default_value = 0.90 if rock else 0.76
    principled.inputs["Metallic"].default_value = 0
    obj.data.materials.append(material)


def _animate_fan(obj):
    obj.shape_key_add(name="Basis")
    height = max(vertex.co.z for vertex in obj.data.vertices)
    keys = []
    for name, direction in (("CurrentForward", 1), ("CurrentReturn", -1)):
        key = obj.shape_key_add(name=name)
        for index, vertex in enumerate(obj.data.vertices):
            x, y, z = vertex.co
            weight = (z / height) ** 2
            key.data[index].co.x += direction * math.sin(z * 1.4 + x * 0.6) * weight * 0.035
            key.data[index].co.y += direction * weight * (0.105 + math.sin(x * 1.1) * 0.025)
        keys.append(key)
    for frame, values in ((1, (0, 0)), (46, (1, 0)), (91, (0, 0)),
                          (136, (0, 1)), (181, (0, 0))):
        for key, value in zip(keys, values):
            key.value = value
            key.keyframe_insert(data_path="value", frame=frame)
    action = obj.data.shape_keys.animation_data.action
    if action:
        action.name = "OceanFan_Current_6s"
    obj["animation_loop_seconds"] = 6.0
    obj["animation_contract"] = "LoopRepeat; first/last morph weights equal; fixed seabed anchor"


def _export(obj, output_dir, animated):
    for selected in list(bpy.context.selected_objects):
        selected.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    asset_id = obj["asset_id"]
    destination = output_dir / (asset_id + ".glb")
    options = dict(filepath=str(destination), export_format="GLB", use_selection=True,
                   export_yup=True, export_apply=False, export_normals=True,
                   export_materials="EXPORT", export_extras=True,
                   export_animations=animated, export_frame_range=True,
                   export_force_sampling=True, export_morph=True, export_morph_normal=True)
    supported = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    options = {key: value for key, value in options.items() if key in supported}
    result = bpy.ops.export_scene.gltf(**options)
    if "FINISHED" not in result:
        raise RuntimeError("glTF export did not finish: " + str(destination))
    obj.data.calc_loop_triangles()
    minimum = [min(vertex.co[axis] for vertex in obj.data.vertices) for axis in range(3)]
    maximum = [max(vertex.co[axis] for vertex in obj.data.vertices) for axis in range(3)]
    return dict(id=asset_id, file=str(destination), byte_size=destination.stat().st_size,
                triangles=len(obj.data.loop_triangles), vertices=len(obj.data.vertices),
                mesh_count=1, material_count=len(obj.data.materials), texture_count=0,
                shape_keys=len(obj.data.shape_keys.key_blocks) - 1 if obj.data.shape_keys else 0,
                animation_seconds=6.0 if animated else 0,
                bounds_blender=dict(min=minimum, max=maximum),
                bounds_gltf=dict(min=[minimum[0], minimum[2], -maximum[1]],
                                 max=[maximum[0], maximum[2], -minimum[1]]),
                license="MIT-project-local", source="original-procedural-Blender-authoring")


def build_assets(output_dir):
    """Build and export six original assets; return JSON-serializable manifest statistics.

    Existing scene objects remain intact. A new dedicated collection is retained for
    inspection and optional .blend saving by the caller. Selection, active object,
    mode, frame range, frame and playback rate are restored even if export fails.
    """
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    selected = list(bpy.context.selected_objects)
    active = bpy.context.view_layer.objects.active
    old_mode = active.mode if active else "OBJECT"
    timing = (scene.frame_start, scene.frame_end, scene.frame_current,
              scene.render.fps, scene.render.fps_base)
    if active and old_mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    collection = bpy.data.collections.new(COLLECTION_NAME)
    scene.collection.children.link(collection)
    rng = random.Random(SEED)
    specifications = [
        ("reef-buttress", _buttress(), ((0.025, 0.10, 0.12), (0.15, 0.31, 0.29)), True, False),
        ("reef-outcrop", _outcrop(), ((0.055, 0.14, 0.16), (0.28, 0.37, 0.31)), True, False),
        ("coral-staghorn", _staghorn(rng), ((0.24, 0.065, 0.07), (0.95, 0.46, 0.22)), False, False),
        ("coral-foliose", _foliose(), ((0.24, 0.055, 0.13), (0.88, 0.35, 0.30)), False, False),
        ("coral-fan", _fan(), ((0.105, 0.035, 0.21), (0.56, 0.30, 0.75)), False, True),
        ("coral-sponge", _sponge(rng), ((0.13, 0.055, 0.28), (0.86, 0.42, 0.51)), False, False),
    ]
    manifest = []
    try:
        scene.frame_start, scene.frame_end = 1, 181
        scene.render.fps, scene.render.fps_base = 30, 1.0
        scene.frame_set(1)
        for name, builder, palette, rock, animated in specifications:
            obj = builder.finish(name, collection)
            _paint(obj, palette, rock)
            if animated:
                _animate_fan(obj)
            scene.frame_set(1)
            record = _export(obj, output_dir, animated)
            record["triangle_budget"] = [1200, 2500] if rock else (
                [600, 2200] if name in ("coral-staghorn", "coral-fan") else [600, 1800])
            if not record["triangle_budget"][0] <= record["triangles"] <= record["triangle_budget"][1]:
                raise RuntimeError("Asset exceeds its triangle contract: " + str(record))
            manifest.append(record)
    finally:
        scene.frame_start, scene.frame_end = timing[0], timing[1]
        scene.render.fps, scene.render.fps_base = timing[3], timing[4]
        scene.frame_set(timing[2])
        for obj in list(bpy.context.selected_objects):
            obj.select_set(False)
        for obj in selected:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = active
        if active and old_mode != "OBJECT":
            bpy.ops.object.mode_set(mode=old_mode)
    return dict(collection=collection.name, seed=SEED, assets=manifest,
                export_contract="single mesh/material, vertex colors, glTF Y-up, seabed origin")
