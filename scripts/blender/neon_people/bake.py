"""Meshing, rendering and packing Neon District's shop people.

Every frame of every clip is a posed body (rig + body) polygonised by surface nets; its vertices
carry the field's normal, a weight per class and the occlusion the field gives. Renders are data,
not light: an orthographic camera looks at a grid of the frames (columns) turned to each view
(rows), and emission materials write the view-space normal and occlusion in one pass and the class
weights in two more. The cells are packed into the sprite sheet the shop shader relights.

Runs headless or inside an open Blender: everything lives in its own scene and is removed after.
"""

import math
from pathlib import Path

import bpy
import numpy as np

from grainfields.horse_sdf import gradient, project, surface_nets
from neon_people import body

SCENE_NAME = "Serenity Neon District - People"
PREFIX = "SNDP_"
VOXEL = 0.0085

# Sprite cells: metres per cell and pixels per cell. A person stands on the cell's bottom edge,
# centred; the cell is 1 m wide and 2 m tall at 64 px a metre.
CELL_METRES = (1.0, 2.0)
CELL_PIXELS = (64, 128)

# The colours a preview paints each class (never shipped: the shader colours each person).
PREVIEW = {
    "A": dict(skin=(0.62, 0.42, 0.31), hair=(0.03, 0.022, 0.018), top=(0.05, 0.06, 0.09), bottom=(0.1, 0.1, 0.12),
              gear=(0.03, 0.03, 0.035), chrome=(0.8, 0.82, 0.86), glow=(0.1, 0.9, 1.0)),
    "B": dict(skin=(0.8, 0.58, 0.46), hair=(0.9, 0.2, 0.5), top=(0.35, 0.05, 0.12), bottom=(0.04, 0.04, 0.05),
              gear=(0.05, 0.05, 0.06), chrome=(0.8, 0.82, 0.86), glow=(1.0, 0.2, 0.75)),
}


# -- meshing --------------------------------------------------------------------------------
def _grid(shape, voxel):
    low, high = shape.bounds()

    def samples(start, stop):
        return (np.arange(int(math.floor(start / voxel)) - 2, int(math.ceil(stop / voxel)) + 3) + 0.5) * voxel

    return samples(low[0], high[0]), samples(low[1], high[1]), samples(max(low[2], -0.02), high[2])


def occlusion(shape, points, normals, steps=(0.012, 0.025, 0.05, 0.09, 0.15), weights=(0.3, 0.26, 0.2, 0.14, 0.1)):
    """Ambient occlusion from the field: how far short of each step along the normal the nearest
    surface is. 1 in the open, toward 0 in a crease (armpits, between the legs, under the chin)."""
    occ = np.zeros(len(points))
    for h, w in zip(steps, weights):
        d = shape.eval(points + normals * h)
        occ += w * np.clip((h - d) / h, 0.0, 1.0)
    # The floor: feet and a seated body darken toward it.
    floor = np.clip(1.0 - points[:, 2] / 0.12, 0.0, 1.0) * np.clip(-normals[:, 2] * 0.5 + 0.5, 0.0, 1.0)
    return np.clip(1.0 - occ * 1.15 - floor * 0.35, 0.0, 1.0)


def mesh_person(posed, outfit, voxel=VOXEL):
    """Polygonise a posed person. Returns positions, triangles, normals, class weights (N x 5),
    occlusion (N)."""
    shape = body.field(posed, outfit)
    xs, ys, zs = _grid(shape, voxel)
    values = shape.eval_block(xs, ys, zs)
    positions, triangles = surface_nets(values, xs, ys, zs)
    positions = project(shape, positions, iterations=2, limit=voxel)
    normals = gradient(shape, positions, eps=voxel * 0.35)
    normals /= np.maximum(np.linalg.norm(normals, axis=1), 1e-9)[:, None]
    d = shape.classes(positions)
    w = np.exp(-(d - d.min(axis=1, keepdims=True)) / 0.0018)
    w /= w.sum(axis=1, keepdims=True)
    ao = occlusion(shape, positions, normals)
    return dict(positions=positions, triangles=triangles, normals=normals, weights=w, ao=ao)


# -- the scene ----------------------------------------------------------------------------
class Stage:
    """A scene of our own; `dispose` removes everything it made."""

    def __init__(self):
        old = bpy.data.scenes.get(SCENE_NAME)
        if old is not None:
            _purge_scene(old)
        self.scene = bpy.data.scenes.new(SCENE_NAME)
        self.layer = self.scene.view_layers[0]
        self.made = []
        scene = self.scene
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.use_denoising = False
        scene.render.film_transparent = True
        world = self._track(bpy.data.worlds.new(PREFIX + "world"))
        world.use_nodes = True
        world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
        scene.world = world

    def _track(self, block):
        self.made.append(block)
        return block

    def dispose(self):
        _purge_scene(self.scene)
        for block in reversed(self.made):
            try:
                collection = {bpy.types.Material: bpy.data.materials, bpy.types.World: bpy.data.worlds,
                              bpy.types.Image: bpy.data.images}.get(type(block))
                if collection is not None:
                    collection.remove(block)
            except (ReferenceError, RuntimeError):
                pass

    def person_object(self, name, mesh, colours=None, location=(0.0, 0.0, 0.0), yaw=0.0):
        data = bpy.data.meshes.new(PREFIX + name)
        positions = mesh["positions"].astype(np.float32)
        triangles = mesh["triangles"].astype(np.int32)
        data.vertices.add(len(positions))
        data.vertices.foreach_set("co", positions.reshape(-1))
        data.loops.add(triangles.size)
        data.loops.foreach_set("vertex_index", triangles.reshape(-1))
        data.polygons.add(len(triangles))
        data.polygons.foreach_set("loop_start", np.arange(0, triangles.size, 3, dtype=np.int32))
        data.polygons.foreach_set("loop_total", np.full(len(triangles), 3, dtype=np.int32))
        data.polygons.foreach_set("use_smooth", np.ones(len(triangles), dtype=bool))
        data.update()
        data.validate(verbose=False)
        data.normals_split_custom_set_from_vertices(mesh["normals"].astype(np.float32))
        w = mesh["weights"].astype(np.float32)
        cls = data.color_attributes.new("cls", "FLOAT_COLOR", "POINT")
        cls.data.foreach_set("color", w[:, :4].reshape(-1))
        cls2 = data.color_attributes.new("cls2", "FLOAT_COLOR", "POINT")
        cls2.data.foreach_set("color", np.concatenate([w[:, 4:7], np.zeros((len(w), 1), np.float32)], axis=1).reshape(-1))
        ao = data.attributes.new("ao", "FLOAT", "POINT")
        ao.data.foreach_set("value", mesh["ao"].astype(np.float32))
        if colours is not None:
            palette = np.array([colours[c] for c in body.CLASSES], dtype=np.float32)
            rgb = w @ palette
            col = data.color_attributes.new("paint", "FLOAT_COLOR", "POINT")
            col.data.foreach_set("color", np.concatenate([rgb, w[:, 5:6]], axis=1).reshape(-1))
            glow = np.array(colours["glow"], dtype=np.float32)[None, :] * w[:, 6:7]
            gl = data.color_attributes.new("glowpaint", "FLOAT_COLOR", "POINT")
            gl.data.foreach_set("color", np.concatenate([glow, np.ones((len(w), 1), np.float32)], axis=1).reshape(-1))
        obj = bpy.data.objects.new(PREFIX + name, data)
        obj.location = location
        obj.rotation_euler = (0.0, 0.0, math.radians(yaw))
        self.scene.collection.objects.link(obj)
        return obj

    # -- materials ----------------------------------------------------------------------
    def paint_material(self):
        mat = self._track(bpy.data.materials.new(PREFIX + "paint"))
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = 0.75
        attr = nodes.new("ShaderNodeAttribute")
        attr.attribute_name = "paint"
        links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
        links.new(attr.outputs["Alpha"], bsdf.inputs["Metallic"])
        glow = nodes.new("ShaderNodeAttribute")
        glow.attribute_name = "glowpaint"
        links.new(glow.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 8.0
        return mat

    def light(self, name, kind, location, energy, colour=(1.0, 1.0, 1.0), size=1.0, aim=(0.0, 0.0, 1.0)):
        from mathutils import Vector
        data = bpy.data.lights.new(PREFIX + name, kind)
        data.energy = energy
        data.color = colour
        if kind == "AREA":
            data.size = size
        obj = bpy.data.objects.new(PREFIX + name, data)
        obj.location = location
        direction = Vector(aim) - Vector(location)
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        self.scene.collection.objects.link(obj)
        return obj

    def camera(self, location, target, lens=50.0, ortho=None):
        from mathutils import Vector
        data = bpy.data.cameras.new(PREFIX + "camera")
        if ortho is not None:
            data.type = "ORTHO"
            data.ortho_scale = ortho
        else:
            data.lens = lens
        data.clip_start = 0.05
        data.clip_end = 200.0
        obj = bpy.data.objects.new(PREFIX + "camera", data)
        obj.location = location
        obj.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()
        self.scene.collection.objects.link(obj)
        self.scene.camera = obj
        return obj

    def render(self, path, size, samples=32, raw=False):
        scene = self.scene
        scene.render.resolution_x, scene.render.resolution_y = size
        scene.render.resolution_percentage = 100
        scene.cycles.samples = samples
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.image_settings.color_depth = "16" if raw else "8"
        scene.view_settings.view_transform = "Raw" if raw else "AgX"
        scene.view_settings.look = "None"
        scene.render.dither_intensity = 0.0 if raw else 1.0
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        return path


    # -- data renders -------------------------------------------------------------------
    def data_material(self, kind):
        """Emission that writes numbers: "nao" the view-space normal (x, y) and occlusion,
        "cls1" the skin, hair and top weights, "cls2" the bottom, chrome and glow weights."""
        mat = self._track(bpy.data.materials.new(PREFIX + "data_" + kind))
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        nodes.clear()
        out = nodes.new("ShaderNodeOutputMaterial")
        emit = nodes.new("ShaderNodeEmission")
        emit.inputs["Strength"].default_value = 1.0
        links.new(emit.outputs["Emission"], out.inputs["Surface"])
        combine = nodes.new("ShaderNodeCombineXYZ")
        links.new(combine.outputs["Vector"], emit.inputs["Color"])
        if kind == "nao":
            geo = nodes.new("ShaderNodeNewGeometry")
            xf = nodes.new("ShaderNodeVectorTransform")
            xf.vector_type = "NORMAL"
            xf.convert_from = "WORLD"
            xf.convert_to = "CAMERA"
            links.new(geo.outputs["Normal"], xf.inputs["Vector"])
            sep = nodes.new("ShaderNodeSeparateXYZ")
            links.new(xf.outputs["Vector"], sep.inputs["Vector"])
            for axis in ("X", "Y"):
                m = nodes.new("ShaderNodeMath")
                m.operation = "MULTIPLY_ADD"
                m.inputs[1].default_value = 0.5
                m.inputs[2].default_value = 0.5
                links.new(sep.outputs[axis], m.inputs[0])
                links.new(m.outputs["Value"], combine.inputs[axis])
            ao = nodes.new("ShaderNodeAttribute")
            ao.attribute_name = "ao"
            links.new(ao.outputs["Fac"], combine.inputs["Z"])
        else:
            attr = nodes.new("ShaderNodeAttribute")
            attr.attribute_name = "cls"
            sep = nodes.new("ShaderNodeSeparateColor")
            links.new(attr.outputs["Color"], sep.inputs["Color"])
            if kind == "cls1":
                for a, b in (("Red", "X"), ("Green", "Y"), ("Blue", "Z")):
                    links.new(sep.outputs[a], combine.inputs[b])
            else:
                links.new(attr.outputs["Alpha"], combine.inputs["X"])
                attr2 = nodes.new("ShaderNodeAttribute")
                attr2.attribute_name = "cls2"
                sep2 = nodes.new("ShaderNodeSeparateColor")
                links.new(attr2.outputs["Color"], sep2.inputs["Color"])
                links.new(sep2.outputs["Green"], combine.inputs["Y"])
                links.new(sep2.outputs["Blue"], combine.inputs["Z"])
        return mat

    def render_data(self, path, size, samples=12):
        scene = self.scene
        scene.render.resolution_x, scene.render.resolution_y = size
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = True
        scene.render.filter_size = 1.2
        scene.cycles.samples = samples
        scene.cycles.max_bounces = 0
        scene.cycles.use_adaptive_sampling = False
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.image_settings.color_depth = "16"
        scene.view_settings.view_transform = "Raw"
        scene.view_settings.look = "None"
        scene.render.dither_intensity = 0.0
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        image = bpy.data.images.load(str(path), check_existing=False)
        image.colorspace_settings.name = "Non-Color"
        pixels = np.zeros(size[0] * size[1] * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        bpy.data.images.remove(image)
        # Row 0 at the top, as the atlas is laid out.
        return pixels.reshape(size[1], size[0], 4)[::-1].copy()


def _purge_scene(scene):
    for obj in list(scene.collection.all_objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Camera):
                bpy.data.cameras.remove(data)
            elif isinstance(data, bpy.types.Light):
                bpy.data.lights.remove(data)
    bpy.data.scenes.remove(scene)


SUPERSAMPLE = 2


def render_clip(stage, meshes, views, scratch, name, samples=12):
    """Render a clip's frames (columns) at each view (rows). Returns (rows*128, cols*64, 10): the
    normal x/y and occlusion, coverage, and the skin, hair, top, bottom, chrome and glow weights,
    at the sprite resolution (gear is what the weights leave)."""
    cw, ch = CELL_METRES
    pw, ph = CELL_PIXELS
    cols, rows = len(meshes), len(views)
    width, height = cols * cw, rows * ch
    objects = []
    datas = []
    for c, mesh in enumerate(meshes):
        data = None
        for r, view in enumerate(views):
            x = (c + 0.5) * cw - width / 2.0
            z = height - (r + 1) * ch
            obj = stage.person_object("%s_%d_%d" % (name, r, c), mesh, None, (x, 0.0, z), -view)
            if data is None:
                data = obj.data
            else:
                old = obj.data
                obj.data = data
                bpy.data.meshes.remove(old)
            objects.append(obj)
        datas.append(data)
        positions = mesh["positions"]
        reach = float(np.hypot(positions[:, 0], positions[:, 1]).max())
        top = float(positions[:, 2].max())
        if reach > cw * 0.5 or top > ch:
            print("[neon-people] warning: %s frame %d reaches %.3f m (cell half-width %.2f), top %.3f m"
                  % (name, c, reach, cw * 0.5, top))
    camera = stage.camera((0.0, -30.0, height / 2.0), (0.0, 0.0, height / 2.0), ortho=max(width, height))
    size = (cols * pw * SUPERSAMPLE, rows * ph * SUPERSAMPLE)
    passes = {}
    for kind in ("nao", "cls1", "cls2"):
        mat = stage.data_material(kind)
        for data in datas:
            data.materials.clear()
            data.materials.append(mat)
        passes[kind] = stage.render_data(Path(scratch) / ("%s-%s.png" % (name, kind)), size, samples)
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    for data in datas:
        bpy.data.meshes.remove(data)
    cam_data = camera.data
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(cam_data)
    alpha = passes["nao"][:, :, 3]
    stack = np.concatenate([passes["nao"][:, :, :3], alpha[:, :, None], passes["cls1"][:, :, :3],
                            passes["cls2"][:, :, :3]], axis=2)
    return downsample(stack, SUPERSAMPLE)


def downsample(stack, factor):
    """Box-filter by `factor`; data channels averaged by coverage (channel 3)."""
    h, w, n = stack.shape
    s = stack.reshape(h // factor, factor, w // factor, factor, n)
    cov = s[:, :, :, :, 3]
    total = cov.sum(axis=(1, 3))
    out = np.zeros((h // factor, w // factor, n), dtype=np.float32)
    for k in range(n):
        if k == 3:
            out[:, :, k] = cov.mean(axis=(1, 3))
        else:
            out[:, :, k] = (s[:, :, :, :, k] * cov).sum(axis=(1, 3)) / np.maximum(total, 1e-6)
    return out


def dilate(data, coverage, iterations=6):
    """Spread data channels outward into uncovered texels, so filtered reads at an edge stay
    near the edge's own values."""
    data = data.copy()
    known = coverage > 0.004
    for _ in range(iterations):
        total = np.zeros_like(data)
        weight = np.zeros(known.shape, dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            shifted = np.roll(np.roll(data, dy, axis=0), dx, axis=1)
            k = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
            total += shifted * k[:, :, None]
            weight += k
        grow = (~known) & (weight > 0)
        data[grow] = total[grow] / weight[grow][:, None]
        known = known | grow
    return data


def quantise(values, bits):
    levels = (1 << bits) - 1
    return np.round(np.clip(values, 0.0, 1.0) * levels) / levels


def encode(cells_stack, mask_factor=2):
    """The two sheets from the packed stack (H, W, 10):
    sheet  RGBA = normal x, normal y, coverage, 0.5 + 0.5 * occlusion
    masks  at 1/mask_factor resolution, twice as wide: the left half RGBA = skin, hair, top,
           1 - 0.5 * bottom; the right half RGBA = chrome, glow, 0, 1
    Alpha never drops below 0.5, so no texel is ever transparent: encoders and browsers keep
    every texel's colour exactly. Glow keeps its peak when halved, so a thin trim stays lit."""
    cov = cells_stack[:, :, 3]
    nrm = dilate(cells_stack[:, :, [0, 1, 2]], cov)
    sheet = np.zeros(cells_stack.shape[:2] + (4,), dtype=np.float32)
    # Normals to 6 bits and occlusion to 5: relit at sprite size nothing shows, and the lossless
    # sheet is a third smaller.
    sheet[:, :, 0] = quantise(nrm[:, :, 0], 6)
    sheet[:, :, 1] = quantise(nrm[:, :, 1], 6)
    sheet[:, :, 2] = cov
    sheet[:, :, 3] = 0.5 + 0.5 * quantise(np.clip(nrm[:, :, 2], 0.0, 1.0), 5)
    weights = cells_stack[:, :, 4:10]
    half = downsample(np.concatenate([weights[:, :, :3], cov[:, :, None], weights[:, :, 3:]], axis=2), mask_factor)
    h, w = half.shape[:2]
    glow = (weights[:, :, 5] * cov).reshape(h, mask_factor, w, mask_factor).max(axis=(1, 3))
    hcov = half[:, :, 3]
    classes = dilate(np.concatenate([half[:, :, [0, 1, 2, 4, 5]], glow[:, :, None]], axis=2), hcov, iterations=4)
    left = np.zeros((h, w, 4), dtype=np.float32)
    left[:, :, 0:3] = classes[:, :, 0:3]
    left[:, :, 3] = 1.0 - 0.5 * np.clip(classes[:, :, 3], 0.0, 1.0)
    right = np.zeros((h, w, 4), dtype=np.float32)
    right[:, :, 0] = classes[:, :, 4]
    right[:, :, 1] = classes[:, :, 5]
    right[:, :, 3] = 1.0
    masks = np.concatenate([left, right], axis=1)
    return np.clip(sheet, 0.0, 1.0), np.clip(masks, 0.0, 1.0)


def save_image(path, pixels, file_format="WEBP"):
    """Write float RGBA (row 0 at the top) losslessly: WebP at quality 100, or PNG."""
    rows, cols, _ = pixels.shape
    image = bpy.data.images.new(PREFIX + "out", cols, rows, alpha=True, float_buffer=False)
    image.colorspace_settings.name = "Non-Color"
    image.alpha_mode = "STRAIGHT"
    image.pixels.foreach_set(np.ascontiguousarray(pixels[::-1], dtype=np.float32).reshape(-1))
    scene = bpy.data.scenes.new(PREFIX + "save")
    try:
        settings = scene.render.image_settings
        settings.file_format = file_format
        settings.color_mode = "RGBA"
        settings.color_depth = "8"
        if file_format == "WEBP":
            settings.quality = 100
        else:
            settings.compression = 100
        scene.view_settings.view_transform = "Raw"
        scene.view_settings.look = "None"
        scene.render.dither_intensity = 0.0
        image.save_render(str(path), scene=scene)
    finally:
        bpy.data.scenes.remove(scene)
        bpy.data.images.remove(image)
    return path


def load_image(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    image.colorspace_settings.name = "Non-Color"
    w, h = image.size
    pixels = np.zeros(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(h, w, 4)[::-1].copy()


def contact(stage, rows, path, cell=(1.1, 2.2), pixels_per_metre=110, samples=24):
    """Rows of posed people (each a list of (mesh, build, yaw)) on a grid, lit like `preview`,
    under an orthographic camera. For looking at, never shipped."""
    paint = stage.paint_material()
    width = max(len(r) for r in rows) * cell[0]
    height = len(rows) * cell[1]
    for r, row in enumerate(rows):
        for c, (mesh, build, yaw) in enumerate(row):
            x = (c + 0.5) * cell[0] - width / 2
            z = height - (r + 1) * cell[1]
            obj = stage.person_object("contact_%d_%d" % (r, c), mesh, PREVIEW[build], (x, 0.0, z), yaw)
            obj.data.materials.append(paint)
    stage.light("key", "AREA", (0.0, -3.0, height + 1.0), 900.0, (1.0, 0.8, 0.6), max(width, height), (0.0, 0.0, height / 2))
    stage.light("rim", "AREA", (0.0, 4.0, height * 0.6), 1400.0, (0.6, 0.75, 1.0), max(width, height), (0.0, 0.0, height / 2))
    stage.camera((0.0, -20.0, height / 2), (0.0, 0.0, height / 2), ortho=max(width, height))
    size = (int(width * pixels_per_metre), int(height * pixels_per_metre))
    return stage.render(path, size, samples)


def preview(stage, people, path, size=(1400, 900), samples=48, camera=None):
    """People (list of (mesh, build, location, yaw)) lit like a shop at night: lamps overhead, a
    bright back wall behind, a little of the street in front. For looking at, never shipped."""
    paint = stage.paint_material()
    for index, (mesh, build, location, yaw) in enumerate(people):
        obj = stage.person_object("preview_%d" % index, mesh, PREVIEW[build], location, yaw)
        obj.data.materials.append(paint)
    stage.light("key", "AREA", (0.0, -1.5, 3.2), 260.0, (1.0, 0.78, 0.55), 2.5, (0.0, 0.0, 1.0))
    stage.light("rim", "AREA", (0.0, 2.2, 2.0), 420.0, (0.6, 0.75, 1.0), 3.0, (0.0, 0.0, 1.0))
    stage.light("street", "AREA", (-2.0, -4.0, 1.5), 120.0, (1.0, 0.3, 0.7), 3.0, (0.0, 0.0, 1.0))
    eye, target, lens = camera or ((0.0, -6.0, 1.3), (0.0, 0.0, 0.95), 42.0)
    stage.camera(eye, target, lens)
    return stage.render(path, size, samples)
