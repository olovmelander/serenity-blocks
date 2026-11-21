"""Build Aurora's snow-loaded Norway spruce and Scots pine in Blender.

Run via Blender MCP or blender -b -P scripts/blender/aurora_conifers.py.
One connected strip per shoot, individual drooping needle fans, and separate
sculpted snow pillows preserve daylight between the limbs. All draw together.
"""
import math
import random
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fall_grove.glb import GlbWriter, quantize_unit

OUT = HERE.parents[1] / "src/themes/aurora/assets/winter-conifers.glb"
UP = Vector((0, 0, 1))
WOOD, NEEDLE, SNOW = 0, 0.4, 1


class Specimen:
    def __init__(self, seed):
        self.rng = random.Random(seed)
        self.vertices, self.faces, self.paint, self.snow_tips = [], [], [], []

    def ring_strip(self, rings, material, exposure):
        """Closed, smooth-sided surface; mark inner crown recesses for sky occlusion."""
        first = len(self.vertices)
        width = len(rings[0])
        for i, ring in enumerate(rings):
            for j, p in enumerate(ring):
                self.vertices.append(p)
                # Sky and bounced light penetrate the thinner outer thirds of a spray.
                radius = math.hypot(p.x, p.y)
                openness = min(1.0, exposure * (0.62 + min(0.38, radius * 1.9)) + 0.08 * p.z)
                self.paint.append((material, openness, 0.0, 1.0))
                if i:
                    last = first + (i - 1) * width
                    nxt = (j + 1) % width
                    self.faces.append((last + j, last + nxt, last + width + nxt, last + width + j))
        self.faces.append(tuple(first + j for j in reversed(range(width))))
        end = len(self.vertices) - width
        self.faces.append(tuple(end + j for j in range(width)))

    def limb(self, points, radii, sides=6):
        rings = []
        for i, (p, radius) in enumerate(zip(points, radii)):
            direction = (points[min(len(points) - 1, i + 1)] - points[max(0, i - 1)]).normalized()
            across = direction.cross(Vector((0.13, 1, 0))).normalized()
            vertical = direction.cross(across)
            rings.append([p + radius * (across * math.cos(j * math.tau / sides)
                                        + vertical * math.sin(j * math.tau / sides)) for j in range(sides)])
        self.ring_strip(rings, WOOD, 0.78)

    def spray(self, start, direction, length, width, sag, snowy, rise=0.0, fringe=True):
        """A tapered, sagging feather of needles with a broad, broken bank of snow on top."""
        rng = self.rng
        side = Vector((-direction.y, direction.x, 0))
        bend = rng.uniform(-0.18, 0.18) * length
        def spine(t):
            return (start + direction * (t * length) + side * (bend * t * t)
                    + UP * (rise * t - sag * (0.4 * t + 0.6 * t * t)))
        def leaf(t):
            return max(0.015, math.sin(math.pi * t) ** 0.68) * (1.24 - 0.48 * t)
        body = []
        for t in (0.0, 0.22, 0.48, 0.72, 0.91, 1.0):
            p, w = spine(t), width * leaf(t)
            body.append([p + side * (math.cos(a * math.tau / 6) * w)
                         + UP * (math.sin(a * math.tau / 6) * w * 0.38) for a in range(6)])
        self.ring_strip(body, NEEDLE, rng.uniform(0.62, 0.95))
        if fringe:
            # Serrated drooping fans emerge in pairs beyond the snow's lip.
            for sign in (-1, 1):
                for k in range(3):
                    t = (k + rng.uniform(0.05, 0.4)) / 4 + 0.1
                    w = leaf(t) * width
                    p = spine(t) + side * (sign * w * 0.45) - UP * (w * 0.15)
                    tip = p + direction * (length * rng.uniform(0.13, 0.24)) + side * (sign * w * rng.uniform(0.75, 1.4)) - UP * (w * rng.uniform(0.45, 1.35))
                    edge = p.lerp(tip, 0.47)
                    # Two ridged triangles to catch a rim without a transparent needle card.
                    first = len(self.vertices)
                    self.vertices.extend([p, edge - direction * (w * 0.33), tip, edge + direction * (w * 0.36), edge + UP * (w * 0.20)])
                    self.paint.extend([(NEEDLE, 0.78, 0, 1)] * 5)
                    self.faces.extend(tuple(first + a for a in face) for face in ((0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)))
        if snowy:
            a, b = rng.uniform(0.01, 0.19), rng.uniform(0.77, 0.96)
            # Windward lip of an overhanging pillow: bulged up, softly curled over, then flat below.
            profile = ((1, 0), (0.78, 0.65), (0.16, 1), (-0.51, 0.88),
                       (-0.96, 0.38), (-1.02, -0.08), (-0.32, -0.31), (0.72, -0.26))
            snow = []
            depth = width * rng.uniform(0.32, 0.64)
            for u in (0.0, 0.16, 0.4, 0.66, 0.85, 1.0):
                t = a + (b - a) * u
                bulb = max(0.035, math.sin(math.pi * u) ** 0.52)
                w = width * leaf(t) * bulb * rng.uniform(0.88, 1.12)
                p = spine(t) + UP * (width * leaf(t) * 0.32) + side * (width * 0.12 * math.sin(u * 6))
                snow.append([p + side * (x * w * (1 + 0.10 * math.sin(u * 15 + x * 2.5)))
                             + UP * (z * depth * bulb) for x, z in profile])
            self.ring_strip(snow, SNOW, rng.uniform(0.76, 1.0))
            if 0.24 < start.z < 0.84:
                self.snow_tips.append(spine(b))


def pine_crown(model, trunk):
    """Forked scaffold with crooked ascending arms, each ending in a cluster of snow trays."""
    rng = model.rng
    levels = (0.40, 0.46, 0.53, 0.54, 0.59, 0.64, 0.67, 0.71, 0.75, 0.79, 0.83, 0.88, 0.92, 0.95)
    for i, level in enumerate(levels):
        f = i / (len(levels) - 1)
        angle = i * 2.4 + rng.uniform(-0.48, 0.48)
        out = Vector((math.cos(angle), math.sin(angle), 0))
        side = Vector((-out.y, out.x, 0))
        span = (0.19 + 0.08 * math.sin(f * math.pi) - 0.14 * f) * rng.uniform(0.77, 1.16)
        lift = min(0.993 - level, 0.12 - 0.045 * f + rng.uniform(-0.035, 0.065))
        turn = rng.uniform(-0.40, 0.40)
        def arm(t):
            return (trunk(level) + out * (t * span)
                    + side * (span * math.sin(t * 3.5) * turn)
                    + UP * (lift * t ** 1.5 - span * 0.09 * math.sin(math.pi * t)))
        model.limb([arm(t) for t in (0, 0.18, 0.45, 0.73, 1)],
                   [span * r for r in (0.065, 0.057, 0.042, 0.024, 0.006)], 7)
        for j in range(5):
            t = 0.38 + j * 0.14
            direction = (out * rng.uniform(0.25, 0.96) + side * ((-1) ** j) * rng.uniform(0.6, 1.24)).normalized()
            across = Vector((-direction.y, direction.x, 0))
            twig = span * rng.uniform(0.35, 0.63)
            foot = arm(t)
            elbow = foot + direction * (twig * 0.4) + UP * (twig * 0.10)
            tip = elbow + direction * (twig * 0.6) + UP * (twig * rng.uniform(0.22, 0.50))
            model.limb([foot, elbow, tip], [span * 0.028, span * 0.018, span * 0.004], 5)
            for s in range(5):
                fan = (direction + across * ((-1) ** s) * rng.uniform(0.45, 1.3)).normalized()
                start = elbow.lerp(tip, s / 5)
                blade = (0.040 + 0.026 * (1 - f)) * rng.uniform(0.78, 1.26)
                model.spray(start, fan, blade, blade * 0.29, blade * rng.uniform(0.10, 0.43),
                            rng.random() < 0.77, rise=blade * 0.08)


def tree(species):
    pine = species == "pine"
    model = Specimen(8247 if pine else 4241)
    rng = model.rng
    def trunk(z):
        return Vector(((0.083 if pine else 0.008) * z * math.sin(4.8 * z + 0.2),
                       (0.052 if pine else 0.01) * z * math.cos(5.6 * z), z))
    heights = [-0.024, 0.015, 0.1, 0.27, 0.45, 0.64, 0.78, 0.90, 0.97, 1]
    model.limb([trunk(z) for z in heights],
               [(0.018 if pine else 0.016) * (1.015 - z) ** 0.72 * (1.7 if z < 0.015 else 1.0) for z in heights], 10)
    # Snow drifts higher against the upwind side of the bole. Its outer skirt is buried
    # below the ground so a sloping bank has a soft, irregular junction with the bark.
    collar = []
    for radius, level in ((0.072, -0.035), (0.065, 0.005), (0.054, 0.019),
                          (0.033, 0.038), (0.018, 0.054), (0.010, 0.061)):
        ring = []
        for j in range(15):
            a = math.tau * j / 15
            lip = radius * (1 + 0.14 * math.cos(3*a) + 0.08 * math.sin(5*a))
            x = math.cos(a) * lip
            y = math.sin(a) * lip
            ring.append(Vector((x, y, level + 0.010 * math.cos(a + 0.4) + 0.004 * math.sin(2*a))))
        collar.append(ring)
    model.ring_strip(collar, SNOW, 0.77)
    if pine:
        # The bare lower bole keeps a few dead, snapped limbs.
        for k in range(9):
            z = 0.17 + 0.033 * k
            a = k * 2.399
            d = Vector((math.cos(a), math.sin(a), 0))
            p = trunk(z)
            model.limb([p, p + d * 0.036 - UP * 0.013, p + d * rng.uniform(0.05, 0.09) + UP * rng.uniform(-0.018, 0.014)],
                       [0.006, 0.0037, 0.0013], 5)
        pine_crown(model, trunk)
        return model
    rows = 18
    for row in range(rows):
        u = row / (rows - 1)
        f = 1 - (1 - u) ** 1.45
        level = 0.092 + 0.892 * f
        yaw = row * 2.39996 + rng.random() * 0.5
        arms = rng.randint(4, 6)
        for arm in range(arms):
            angle = yaw + math.tau * arm / arms + rng.uniform(-0.3, 0.3)
            d = Vector((math.cos(angle), math.sin(angle), 0))
            side = Vector((-d.y, d.x, 0))
            z = level + rng.uniform(-0.014, 0.014) * (1 - f)
            length = 0.22 * (1.085 - f) ** 0.76 * rng.uniform(0.77, 1.27)
            rise = length * rng.uniform(-0.23, 0.13)
            sag = length * rng.uniform(0.13, 0.32)
            curl = length * rng.uniform(-0.2, 0.2)
            def path(t):
                return trunk(z) + d * (t * length) + side * (t * t * curl) + UP * (t * rise - math.sin(math.pi * t) * sag)
            model.limb([path(t) for t in (0, 0.28, 0.63, 1)], [length * s for s in (0.045, 0.034, 0.018, 0.003)])
            # Dense older shoots hang below the branch close to the trunk.
            model.spray(path(0.08), d, length * 0.67, length * 0.14,
                        0.012 + length * 0.29, rng.random() < 0.55, fringe=False)
            pairs = 3 if f < 0.62 else 2
            for j in range(pairs):
                for sign in (-1, 1):
                    t = 0.31 + j * 0.53 / (pairs - 1) + rng.uniform(-0.07, 0.07)
                    fan = (d * rng.uniform(0.4, 0.95) + side * (sign * rng.uniform(0.65, 1))).normalized()
                    spread = length * (1.02 - 0.52 * t) * rng.uniform(0.38, 0.60)
                    origin = path(t)
                    model.spray(origin, fan, spread, spread * 0.26, spread * rng.uniform(0.18, 0.68),
                                rng.random() < 0.69, rise=spread * -0.03)
            model.spray(path(0.65), d, length * 0.46, length * 0.092,
                        length * 0.08, rng.random() < 0.83, rise=length * 0.08)
    return model


def game_axes(values):
    values = np.asarray(values).reshape(-1, 3).copy()
    return np.column_stack((values[:, 0], values[:, 2], -values[:, 1]))


def renderable_surface(points, normals, colors, faces):
    """Tiny spray tips can collapse to two coincident faces at grove detail."""
    faces = faces.reshape(-1, 3)
    tri = points[faces]
    cross = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    area = np.linalg.norm(cross, axis=1)
    valid = area > 2e-9
    faces, cross, area = faces[valid], cross[valid], area[valid]
    _, unique = np.unique(np.sort(faces, axis=1), axis=0, return_index=True)
    unique.sort()
    faces, cross, area = faces[unique], cross[unique], area[unique]
    # Where coincident faces cancelled the Blender normal, use the largest surviving
    # adjoining face rather than interpolate a zero vector into the lighting.
    bad = np.linalg.norm(normals, axis=1) < 0.7
    for f in np.argsort(area)[::-1]:
        affected = faces[f][bad[faces[f]]]
        normals[affected] = cross[f] / area[f]
        bad[affected] = False
    used, indices = np.unique(faces.ravel(), return_inverse=True)
    return points[used], normals[used], colors[used], indices


def export(path=OUT):
    scene = bpy.data.scenes.new("Aurora winter specimens")
    writer = GlbWriter("Serenity Blocks / Aurora winter conifers (Blender)")
    report = {}
    for species in ("spruce", "pine"):
        model = tree(species)
        mesh = bpy.data.meshes.new(species)
        mesh.from_pydata(model.vertices, [], model.faces)
        mesh.update()
        mesh.polygons.foreach_set("use_smooth", np.ones(len(mesh.polygons), dtype=bool))
        paint = mesh.color_attributes.new(name="Winter", type="FLOAT_COLOR", domain="POINT")
        paint.data.foreach_set("color", np.asarray(model.paint, dtype=np.float32).ravel())
        obj = bpy.data.objects.new(species, mesh)
        scene.collection.objects.link(obj)
        # Keep specimens side by side in the Blender scene. Export mesh-local coordinates.
        obj.location.x = -0.35 if species == "spruce" else 0.35
        for lod, ratio in (("near", 0.21), ("grove", 0.042)):
            mod = obj.modifiers.new("Screen size", "DECIMATE")
            mod.ratio = ratio
            with bpy.context.temp_override(scene=scene, view_layer=scene.view_layers[0]):
                depsgraph = bpy.context.evaluated_depsgraph_get()
                evaluated = obj.evaluated_get(depsgraph)
                surface = evaluated.to_mesh()
                surface.calc_loop_triangles()
                points = np.empty(len(surface.vertices) * 3, np.float32)
                normals = np.empty_like(points)
                colors = np.empty(len(surface.vertices) * 4, np.float32)
                faces = np.empty(len(surface.loop_triangles) * 3, np.int32)
                surface.vertices.foreach_get("co", points)
                surface.vertices.foreach_get("normal", normals)
                surface.color_attributes["Winter"].data.foreach_get("color", colors)
                surface.loop_triangles.foreach_get("vertices", faces)
                points, normals, colors, faces = renderable_surface(
                    game_axes(points), game_axes(normals), colors.reshape(-1, 4), faces)
                name = species + "_" + lod
                # Snow-release points sampled on genuinely loaded branch tips, game axes, unit height.
                tips = game_axes(sorted(model.snow_tips, key=lambda p: -math.hypot(p.x, p.y))[:80:5]).round(5)
                writer.add_mesh(name, {
                    "POSITION": (points, False),
                    "NORMAL": (quantize_unit(normals, np.int8), True),
                    "COLOR_0": (quantize_unit(colors, np.uint8), True),
                }, faces, extras={"snowTips": tips.tolist()})
                report[name] = len(faces) // 3
                evaluated.to_mesh_clear()
            obj.modifiers.remove(mod)
    path.parent.mkdir(parents=True, exist_ok=True)
    report["bytes"] = writer.write(path)
    return report


if __name__ == "__main__":
    print(export())
