"""Original low-poly Ocean fauna, authored and animated in Blender 4/5.

Call build_assets(output_dir). The six single-mesh exports use one opaque
vertex-color material, two relative shape keys, and four-second authored loops.
Pure Python geometry functions also run without bpy for topology/budget checks.
Blender coordinates are +X forward, +Z up; glTF export converts to +Y up.
"""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "_ocean_fauna_living_helpers", Path(__file__).with_name("ocean_living_assets.py"))
_living = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_living)
bpy = _living.bpy
MeshBuilder = _living.MeshBuilder
_mix = _living._mix
TAU = math.tau
FPS = 24
END_FRAME = 97
AUTHOR = "Serenity Blocks original Blender fauna sculpture"
SHAPES = ("swimBend", "finSweep")


def _clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def _body(mesh, sections, paint, sides=8, part="body"):
    """Elliptical longitudinal sections with controlled snout/shoulder taper."""
    rings = []
    for row, (x, width, height, center_z) in enumerate(sections):
        ring = []
        for j in range(sides):
            angle = j * TAU / sides
            y, z = width * math.cos(angle), height * math.sin(angle)
            ring.append(mesh.vertex((x, y, z + center_z), paint(row, angle), part,
                                    row / (len(sections) - 1)))
        if rings:
            for j in range(sides):
                k = (j + 1) % sides
                mesh.quad(rings[-1][j], rings[-1][k], ring[k], ring[j])
        rings.append(ring)
    for index, reverse in ((0, True), (-1, False)):
        x, _, _, z = sections[index]
        cap = mesh.vertex((x, 0, z), paint(index, 0), part)
        for j in range(sides):
            a, b = rings[index][j], rings[index][(j + 1) % sides]
            mesh.triangle(cap, b, a) if reverse else mesh.triangle(cap, a, b)


def _fin_strip(mesh, roots, edges, root_color, edge_color, part):
    rows = []
    for index, (root, edge) in enumerate(zip(roots, edges)):
        row = [mesh.vertex(root, root_color, part, 0),
               mesh.vertex(edge, edge_color, part, 1)]
        if rows:
            mesh.quad(rows[-1][0], row[0], row[1], rows[-1][1])
        rows.append(row)


def _side_eye(mesh, center, radius, side, iris=(0.92, 0.65, 0.18, 1), segments=6):
    """Painted concentric iris, black pupil and one pale glint; no textures."""
    x, y, z = center
    outer, inner = [], []
    for j in range(segments):
        angle = j * TAU / segments
        dx, dz = math.cos(angle) * radius, math.sin(angle) * radius
        outer.append(mesh.vertex((x + dx, y, z + dz), iris, "eye"))
        inner.append(mesh.vertex((x + dx * 0.60, y + side * 0.002, z + dz * 0.60),
                                 (0.007, 0.018, 0.04, 1), "eye"))
    center_vertex = mesh.vertex((x - radius * 0.12, y + side * 0.003, z + radius * 0.13),
                                (0.012, 0.024, 0.045, 1), "eye")
    for j in range(segments):
        k = (j + 1) % segments
        # +Y side points outward with clockwise winding in the X/Z plane.
        if side > 0:
            mesh.quad(outer[k], outer[j], inner[j], inner[k])
            mesh.triangle(center_vertex, inner[k], inner[j])
        else:
            mesh.quad(outer[j], outer[k], inner[k], inner[j])
            mesh.triangle(center_vertex, inner[j], inner[k])
    glint = [(x - radius * 0.23, y + side * 0.004, z + radius * 0.29),
             (x + radius * 0.02, y + side * 0.004, z + radius * 0.35),
             (x - radius * 0.08, y + side * 0.004, z + radius * 0.08)]
    points = [mesh.vertex(point, (0.88, 0.98, 1, 1), "eye") for point in glint]
    mesh.triangle(*points) if side > 0 else mesh.triangle(*reversed(points))


FISH = {
    "fish-prism-tang": {
        "width": 0.15, "height": 0.33, "tail": 0.24,
        "base": (0.055, 0.65, 0.67, 1), "back": (0.025, 0.15, 0.49, 1),
        "belly": (0.26, 0.88, 0.74, 1), "fin": (0.97, 0.62, 0.095, 1),
        "edge": (0.10, 0.29, 0.75, 1), "cycles": 3,
    },
    "fish-sun-banner": {
        "width": 0.135, "height": 0.33, "tail": 0.20,
        "base": (1.0, 0.60, 0.12, 1), "back": (0.98, 0.78, 0.26, 1),
        "belly": (0.96, 0.91, 0.63, 1), "fin": (1.0, 0.67, 0.10, 1),
        "edge": (0.99, 0.91, 0.58, 1), "cycles": 2,
    },
    "fish-ember-anthias": {
        "width": 0.115, "height": 0.235, "tail": 0.275,
        "base": (0.94, 0.23, 0.23, 1), "back": (0.68, 0.065, 0.29, 1),
        "belly": (1.0, 0.60, 0.40, 1), "fin": (1.0, 0.41, 0.24, 1),
        "edge": (0.97, 0.16, 0.49, 1), "cycles": 4,
    },
    "fish-moon-sardine": {
        "width": 0.085, "height": 0.115, "tail": 0.15,
        "base": (0.50, 0.79, 0.86, 1), "back": (0.065, 0.27, 0.40, 1),
        "belly": (0.88, 0.94, 0.89, 1), "fin": (0.25, 0.64, 0.73, 1),
        "edge": (0.72, 0.91, 0.92, 1), "cycles": 4,
    },
}


def _fish_geometry(name):
    recipe = FISH[name]
    mesh = MeshBuilder()
    height, width = recipe["height"], recipe["width"]
    # Fine peduncle, deep shoulder, tapered forehead and short shaped muzzle.
    xs = (-0.52, -0.36, -0.10, 0.19, 0.44, 0.59, 0.67)
    widths = (0.21, 0.70, 0.99, 1.0, 0.79, 0.43, 0.085)
    heights = (0.13, 0.70, 1.0, 0.94, 0.69, 0.39, 0.08)
    sections = [(x, width * w, height * h, 0.014 if i > 3 else 0)
                for i, (x, w, h) in enumerate(zip(xs, widths, heights))]

    def paint(row, angle):
        up = math.sin(angle)
        color = _mix(recipe["base"], recipe["back"], _clamp(up) * 0.88)
        color = _mix(color, recipe["belly"], _clamp(-up) * 0.92)
        if name == "fish-sun-banner" and row in (2, 4):
            color = _mix(color, (0.025, 0.055, 0.13, 1), 0.92)
        elif name == "fish-prism-tang" and row == 4:
            color = _mix(color, (0.045, 0.19, 0.58, 1), 0.68)
        elif name == "fish-moon-sardine" and abs(up) < 0.2:
            color = _mix((0.30, 0.78, 0.92, 1), recipe["belly"], 0.35)
        return color

    _body(mesh, sections, paint)
    # A forked caudal fan, with separate trailing tips and a real concave notch.
    tail = recipe["tail"]
    root = mesh.vertex((-0.50, 0, 0), recipe["base"], "tail", 0)
    outline = [(-0.63, 0, tail * 0.49), (-0.83, 0, tail),
               (-0.75, 0, tail * 0.15), (-0.72, 0, 0),
               (-0.75, 0, -tail * 0.15), (-0.83, 0, -tail),
               (-0.63, 0, -tail * 0.49)]
    fan = [mesh.vertex(point, recipe["fin"] if i in (0, 3, 6) else recipe["edge"], "tail", 1)
           for i, point in enumerate(outline)]
    for i in range(len(fan) - 1):
        mesh.triangle(root, fan[i], fan[i + 1])

    roots = [(xs[i], 0, height * heights[i] + sections[i][3]) for i in range(1, 6)]
    if name == "fish-sun-banner":
        edges = [(-0.48, 0, 1.01), (-0.25, 0, 0.82), (-0.01, 0, 0.53),
                 (0.23, 0, 0.40), (0.51, 0, 0.21)]
    else:
        scale = 0.055 if name == "fish-moon-sardine" else 0.12
        edges = [(x - 0.065, 0, z + math.sin((i + 1) * math.pi / 6) * scale)
                 for i, (x, _, z) in enumerate(roots)]
    _fin_strip(mesh, roots, edges, recipe["base"], recipe["fin"], "dorsal")
    lower_roots = [(x, 0, -z * 0.83) for x, _, z in roots[:4]]
    lower_edges = [(x - 0.10, 0, z - (0.13 if name == "fish-sun-banner" else 0.075))
                   for x, _, z in lower_roots]
    _fin_strip(mesh, lower_roots, lower_edges, recipe["base"], recipe["edge"], "anal")

    for side in (-1, 1):
        pectoral = [(0.16, side * width * 0.94, 0.025),
                    (-0.025, side * (width + 0.16), -0.045),
                    (-0.13, side * (width + 0.09), -0.13),
                    (0.11, side * width * 0.92, -0.075)]
        ids = [mesh.vertex(point, recipe["fin"] if index in (1, 2) else recipe["base"],
                           "pectoral", 1 if index in (1, 2) else 0)
               for index, point in enumerate(pectoral)]
        mesh.quad(*ids) if side > 0 else mesh.quad(*reversed(ids))
        eye_x = 0.455
        eye_z = height * 0.24 + 0.018
        eye_y = side * (width * 0.78 + 0.007)
        _side_eye(mesh, (eye_x, eye_y, eye_z), 0.036 if height < 0.15 else 0.048, side)
    return mesh


def _manta_geometry():
    mesh = MeshBuilder()
    indigo, turquoise, ivory = (0.035, 0.095, 0.24, 1), (0.11, 0.59, 0.66, 1), (0.76, 0.87, 0.83, 1)
    sections = [(-1.07, 0.085, 0.055, 0), (-0.77, 0.25, 0.13, 0),
                (-0.34, 0.43, 0.21, 0.015), (0.15, 0.48, 0.22, 0.028),
                (0.57, 0.38, 0.17, 0.02), (0.88, 0.28, 0.09, 0),
                (1.0, 0.19, 0.045, -0.015)]
    _body(mesh, sections, lambda row, angle: ivory if math.sin(angle) < -0.18
          else _mix(indigo, turquoise, 0.14 + row * 0.035), sides=10)

    for side in (-1, 1):
        surfaces = []
        for bottom in (False, True):
            rows = []
            for span in range(6):
                t = span / 5
                center_x = -0.06 - 0.61 * t ** 1.6
                half_chord = 0.90 * (1 - t ** 1.5) + 0.045
                row = []
                for chord in range(9):
                    v = chord / 8
                    x = center_x + (v * 2 - 1) * half_chord
                    root_width = .12 + .11 * math.sin(v * math.pi)
                    y = side * (root_width * (1 - t) + 2.8 * t)
                    camber = math.sin(v * math.pi) ** 0.65 * (0.12 * (1 - t) + 0.009)
                    z = 0.065 * t - 0.055 * math.sin(math.pi * t)
                    z += -camber * 0.75 - 0.011 if bottom else camber
                    edge = _clamp((abs(v - 0.5) - 0.30) * 4 + t ** 5 * 0.85)
                    color = _mix(ivory if bottom else indigo, turquoise, edge * (0.40 if bottom else 0.88))
                    if not bottom:
                        color = _mix(color, (0.075, 0.19, 0.34, 1), math.sin(v * math.pi) * (1 - t) * 0.4)
                    row.append(mesh.vertex((x, y, z), color, "wing", t))
                if rows:
                    for chord in range(8):
                        face = (rows[-1][chord], rows[-1][chord + 1], row[chord + 1], row[chord])
                        mesh.quad(*face) if (side > 0) != bottom else mesh.quad(*reversed(face))
                rows.append(row)
            surfaces.append(rows)
        top, lower = surfaces
        for span in range(5):
            for edge in (0, 8):
                face = (top[span][edge], lower[span][edge], lower[span + 1][edge], top[span + 1][edge])
                mesh.quad(*reversed(face)) if (side > 0) == (edge == 0) else mesh.quad(*face)
        for chord in range(8):
            face = (top[-1][chord], lower[-1][chord], lower[-1][chord + 1], top[-1][chord + 1])
            mesh.quad(*reversed(face)) if side > 0 else mesh.quad(*face)

    centers = [(-0.88 - 2.03 * i / 9, math.sin(i / 9 * 3.0) * 0.075,
                -0.03 + math.sin(i / 9 * 2.8) * 0.085) for i in range(10)]
    mesh.tube(centers, [0.056 * (1 - i / 9) ** 1.3 + 0.006 for i in range(10)],
              [_mix(indigo, turquoise, i / 20) for i in range(10)], "tail", sides=4)
    for side in (-1, 1):
        # Rolled cephalic lobes distinguish the ray from a generic kite.
        centers = [(0.70 + t * 0.50, side * (0.24 + math.sin(t * math.pi) * 0.11),
                    -0.025 - math.sin(t * math.pi * 1.25) * 0.11) for t in (0, .25, .5, .75, 1)]
        mesh.tube(centers, [.075, .073, .059, .039, .009],
                  [_mix(indigo, ivory, i / 6) for i in range(5)], "cephalic", sides=5)
        _side_eye(mesh, (0.62, side * 0.343, 0.078), 0.058, side,
                  iris=(0.23, 0.61, 0.64, 1))
    return mesh


def _cuttle_geometry():
    mesh = MeshBuilder()
    violet, pearl = (0.38, 0.30, 0.63, 1), (0.85, 0.79, 0.88, 1)
    amber, ochre = (0.94, 0.57, 0.20, 1), (0.43, 0.22, 0.27, 1)
    sections = [(-1.66, .018, .016, 0), (-1.34, .25, .16, 0), (-.90, .46, .29, .015),
                (-.39, .59, .35, .018), (.12, .59, .33, .008), (.53, .47, .27, -.008),
                (.90, .28, .18, -.035)]

    def paint(row, angle):
        up = math.sin(angle)
        color = _mix(violet, pearl, 0.36 + (1 - abs(up)) * .27)
        if up < 0:
            color = _mix(color, pearl, -up * .62)
        if row in (2, 4) and up > .35:
            color = _mix(color, (0.43, 0.35, 0.67, 1), .44)
        return color

    _body(mesh, sections, paint, sides=12)
    _body(mesh, [(.73, .27, .18, -.05), (.91, .37, .26, -.065),
                 (1.12, .35, .24, -.07), (1.27, .22, .15, -.075)],
          lambda row, angle: _mix(violet, pearl, .58 + math.sin(angle) * .13), sides=10, part="head")

    for side in (-1, 1):
        rows = []
        for length in range(13):
            t = length / 12
            x = -1.54 + t * 2.38
            # Root follows the sculpted mantle surface, so the frill never
            # becomes a detached ribbon at the full-width shoulder.
            interval = next(i for i in range(len(sections) - 1)
                            if sections[i][0] <= x <= sections[i + 1][0])
            left, right = sections[interval], sections[interval + 1]
            fraction = (x - left[0]) / (right[0] - left[0])
            base_width = (left[1] + (right[1] - left[1]) * fraction) * .975
            row = []
            for across in range(3):
                v = across / 2
                extension = math.sin(t * math.pi) ** .6 * v * .24
                y = side * (base_width + extension)
                z = -.025 + math.sin(t * TAU * 2.5) * .051 * v + math.sin(v * math.pi) * .026
                color = _mix(pearl, amber, v ** .7)
                if across == 2:
                    color = _mix(amber, ochre, (math.sin(t * TAU * 2.5) + 1) * .16)
                row.append(mesh.vertex((x, y, z), color, "frill", t))
            if rows:
                for across in range(2):
                    face = (rows[-1][across], row[across], row[across + 1], rows[-1][across + 1])
                    mesh.quad(*face) if side > 0 else mesh.quad(*reversed(face))
            rows.append(row)
        _side_eye(mesh, (1.05, side * .357, -.005), .098, side, iris=(.86, .69, .40, 1), segments=8)

    # Eight short curved arms, with warm inner surfaces and tapered tips.
    for arm in range(8):
        angle = arm * TAU / 8 + math.pi / 8
        centers, radii, colors = [], [], []
        for step in range(6):
            t = step / 5
            reach = .86 + (arm % 3) * .065
            radial = .20 + math.sin(t * math.pi) * .10 - t * t * .11
            curl = math.sin(t * math.pi * 1.6) * .10
            centers.append((1.19 + t * reach - t ** 4 * .07,
                            math.cos(angle) * radial + curl * math.sin(angle),
                            -.075 + math.sin(angle) * radial - t ** 2 * .055))
            radii.append(.065 * (1 - t) ** .8 + .01)
            colors.append(_mix(pearl, amber, .12 + t * .33))
        mesh.tube(centers, radii, colors, "arm", sides=4)
    mesh.tube([(.81, 0, -.19), (.99, 0, -.30), (1.12, 0, -.31), (1.18, 0, -.28)],
              [.09, .078, .06, .052], [violet, pearl, pearl, ochre], "siphon", sides=5)
    return mesh


def _fauna_morphs(mesh, name):
    bend, sweep = [], []
    for (x, y, z), (part, progress) in zip(mesh.vertices, mesh.parts):
        if name.startswith("fish-"):
            tailness = _clamp((.48 - x) / 1.31)
            amplitude = .16 * tailness ** 1.8
            wave = tailness * 2.35
            dy_a = amplitude * math.sin(wave)
            dy_b = amplitude * math.cos(wave)
            dz_a = dz_b = 0.0
            if part in ("dorsal", "anal"):
                dy_a += .025 * progress * (1 + tailness)
                dz_b += .013 * progress
            elif part == "pectoral":
                dz_a += .042 * progress
                dy_b += math.copysign(.025, y) * progress
            bend.append((x, y + dy_a, z + dz_a))
            sweep.append((x, y + dy_b, z + dz_b))
        elif name == "creature-manta":
            span = _clamp(abs(y) / 2.8)
            lift = .67 * span ** 1.55
            twist = .23 * span ** 1.4 * _clamp((.70 - x) / 1.9)
            tailness = _clamp((-x - .55) / 2.36) if part == "tail" else 0
            bend.append((x, y + tailness ** 2 * .16, z + lift + tailness * .06))
            sweep.append((x + .035 * span ** 2, y * (1 - .025 * span),
                          z + twist - tailness ** 2 * .09))
        else:
            if part == "frill":
                lateral = _clamp((abs(y) - .32) / .46)
                envelope = math.sin(progress * math.pi) ** .6
                phase = progress * TAU * 1.4
                bend.append((x, y, z + math.sin(phase) * .085 * envelope * lateral))
                sweep.append((x, y, z + math.cos(phase) * .085 * envelope * lateral))
            elif part == "arm":
                bend.append((x - progress ** 2 * .045,
                             y + math.sin(x * 3.2 + z * 4) * progress * .07,
                             z + math.cos(x * 2.6 + y * 4) * progress * .065))
                sweep.append((x, y + math.cos(x * 3.2 + z * 4) * progress * .055,
                              z + math.sin(x * 2.6 + y * 4) * progress * .055))
            else:
                breathing = .018 * (1 - _clamp(abs(x) / 1.8)) if part == "body" else 0
                bend.append((x, y * (1 + breathing), z * (1 + breathing)))
                sweep.append((x, y, z))
    return {"swimBend": bend, "finSweep": sweep}


def _make_object(builder, name, collection):
    mesh = bpy.data.meshes.new(name + "_geometry")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    colors = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="POINT")
    colors.data.foreach_set("color", [channel for color in builder.colors for channel in color])
    mesh.color_attributes.active_color = colors
    material = _living._make_material("Ocean_" + name + "_paint", False)
    # Thin, deliberately modeled fin membranes must remain visible from either side.
    material.use_backface_culling = False
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = .42 if name.startswith("fish-") else .51
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj["author"] = AUTHOR
    obj["assetId"] = name
    obj["forwardAxis"] = "+X"
    obj["morphAnimation"] = "two authored relative shape keys, four-second seamless swim loop"
    obj.shape_key_add(name="Basis")
    morphs = _fauna_morphs(builder, name)
    for key_name, coordinates in morphs.items():
        key = obj.shape_key_add(name=key_name)
        key.slider_min, key.slider_max = -1, 1
        key.data.foreach_set("co", [component for vertex in coordinates for component in vertex])
    cycles = FISH[name]["cycles"] if name in FISH else (1 if name == "creature-manta" else 2)
    keys = mesh.shape_keys
    # Bake exact authoring samples every two frames. Linear keys prevent cubic
    # overshoot, and equal first/last values make phase-offset looping seamless.
    for frame in range(1, END_FRAME + 1, 2):
        phase = TAU * cycles * (frame - 1) / (END_FRAME - 1)
        values = (math.sin(phase), math.cos(phase)) if frame < END_FRAME else (0.0, 1.0)
        for key_name, value in zip(SHAPES, values):
            key = keys.key_blocks[key_name]
            key.value = value
            key.keyframe_insert(data_path="value", frame=frame, group="Ocean authored swim")
    action = keys.animation_data.action
    clip_name = name.replace("-", "_") + "_Swim_Loop"
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
    for key_name in SHAPES:
        keys.key_blocks[key_name].value = 0
    return obj, clip_name


def geometry_catalog():
    """Deterministic geometry and hard triangle budgets; safe outside Blender."""
    result = [(name, _fish_geometry(name), 260) for name in FISH]
    result.extend([("creature-manta", _manta_geometry(), 1000),
                   ("creature-cuttlefish", _cuttle_geometry(), 1000)])
    return result


def _validate_geometry(mesh, name, budget):
    if len(mesh.faces) > budget:
        raise RuntimeError(f"{name}: {len(mesh.faces)} triangles exceeds {budget}")
    for face in mesh.faces:
        if len(face) != 3 or len(set(face)) != 3:
            raise RuntimeError(f"{name}: malformed triangle {face}")
        a, b, c = (mesh.vertices[index] for index in face)
        cross = _living._cross(_living._sub(b, a), _living._sub(c, a))
        if sum(value * value for value in cross) < 1e-18:
            raise RuntimeError(f"{name}: degenerate triangle {face}")
    if any(not math.isfinite(component) for vertex in mesh.vertices for component in vertex):
        raise RuntimeError(f"{name}: non-finite vertex")
    if any(not 0 <= channel <= 1 for color in mesh.colors for channel in color):
        raise RuntimeError(f"{name}: invalid vertex paint")
    morphs = _fauna_morphs(mesh, name)
    for key_name, target in morphs.items():
        displacement = max(math.dist(base, moved) for base, moved in zip(mesh.vertices, target))
        if len(target) != len(mesh.vertices) or displacement < .01:
            raise RuntimeError(f"{name}: {key_name} has invalid or invisible motion")


def build_assets(output_dir):
    """Preserve the user's scene, add a collection, export six GLBs and manifest."""
    if bpy is None:
        raise RuntimeError("build_assets runs inside Blender; geometry_catalog works offline")
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
    collection = bpy.data.collections.new("Serenity_Ocean_Original_Fauna")
    collection["author"] = AUTHOR
    scene.collection.children.link(collection)
    manifest = {"author": AUTHOR, "collection": collection.name,
                "blenderVersion": bpy.app.version_string,
                "glTFUpAxis": "Y", "forwardAxis": "+X", "textureCount": 0,
                "loopSeconds": 4, "assets": []}
    try:
        scene.frame_start, scene.frame_end, scene.render.fps, scene.render.fps_base = 1, END_FRAME, FPS, 1.0
        for name, geometry, budget in geometry_catalog():
            _validate_geometry(geometry, name, budget)
            obj, clip = _make_object(geometry, name, collection)
            scene.frame_set(1)
            stats = _living._export_object(obj, destination / (name + ".glb"), SHAPES, budget)
            stats.update({"blenderObject": obj.name, "clipTrack": clip,
                          "sourceVertices": len(geometry.vertices), "sourceTriangles": len(geometry.faces),
                          "triangleBudget": budget, "forwardAxis": "+X",
                          "paint": "original opaque vertex paint; no image textures"})
            manifest["assets"].append(stats)
        (destination / "fauna-assets-manifest.json").write_text(
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
