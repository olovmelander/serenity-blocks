"""Blender-side helpers for the Fall grove: an isolated scene, AO bakes and previews.

Everything is created in a dedicated scene and removed afterwards, so the script is safe
to run inside a Blender session that has someone else's work open (no existing datablock
is touched) as well as headless with --factory-startup.
"""

import math

import bpy
import numpy as np

SCENE_NAME = "Serenity Fall - Grove Atelier"
PREFIX = "SFALL_"


def to_blender(points):
    """glTF/three (x, y up, z toward viewer) -> Blender (x, y forward, z up)."""
    points = np.asarray(points, dtype=np.float64)
    return np.stack([points[:, 0], -points[:, 2], points[:, 1]], axis=1)


class Studio:
    def __init__(self):
        self.scene = bpy.data.scenes.new(SCENE_NAME)
        self.layer = self.scene.view_layers[0]
        self.created = []
        self.scene.render.engine = "CYCLES"
        self.scene.cycles.device = "CPU"
        self.scene.cycles.samples = 48
        self.scene.cycles.use_denoising = False
        world = bpy.data.worlds.new(PREFIX + "world")
        self.scene.world = world
        self.created.append(world)

    # -- ownership ----------------------------------------------------------------------
    def track(self, datablock):
        self.created.append(datablock)
        return datablock

    def dispose(self):
        for obj in list(self.scene.collection.all_objects):
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if data is not None and data.users == 0:
                collection = getattr(bpy.data, {"MESH": "meshes", "CAMERA": "cameras", "LIGHT": "lights"}.get(
                    data.id_type, "meshes"), None)
                if collection is not None:
                    collection.remove(data)
        for datablock in reversed(self.created):
            try:
                if isinstance(datablock, bpy.types.Material):
                    bpy.data.materials.remove(datablock)
                elif isinstance(datablock, bpy.types.World):
                    bpy.data.worlds.remove(datablock)
                elif isinstance(datablock, bpy.types.Image):
                    bpy.data.images.remove(datablock)
            except (ReferenceError, RuntimeError):
                pass
        bpy.data.scenes.remove(self.scene)

    # -- meshes -------------------------------------------------------------------------
    def mesh_object(self, name, positions, indices, colors=None, uvs=None, smooth=True):
        mesh = bpy.data.meshes.new(PREFIX + name)
        positions = to_blender(positions)
        triangles = np.asarray(indices, dtype=np.int32).reshape(-1, 3)
        mesh.vertices.add(len(positions))
        mesh.vertices.foreach_set("co", positions.astype(np.float32).reshape(-1))
        mesh.loops.add(triangles.size)
        mesh.loops.foreach_set("vertex_index", triangles.reshape(-1))
        mesh.polygons.add(len(triangles))
        mesh.polygons.foreach_set("loop_start", np.arange(0, triangles.size, 3, dtype=np.int32))
        mesh.polygons.foreach_set("loop_total", np.full(len(triangles), 3, dtype=np.int32))
        mesh.polygons.foreach_set("use_smooth", np.full(len(triangles), smooth, dtype=bool))
        mesh.update()
        mesh.validate(verbose=False)
        if colors is not None:
            layer = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
            data = np.asarray(colors, dtype=np.float32)
            if data.shape[1] == 3:
                data = np.concatenate([data, np.ones((len(data), 1), dtype=np.float32)], axis=1)
            layer.data.foreach_set("color", data.reshape(-1))
            mesh.color_attributes.active_color = layer
            mesh.color_attributes.render_color_index = 0
        if uvs is not None:
            layer = mesh.uv_layers.new(name="UVMap")
            per_loop = np.asarray(uvs, dtype=np.float32)[triangles.reshape(-1)]
            layer.data.foreach_set("uv", per_loop.reshape(-1))
        obj = bpy.data.objects.new(PREFIX + name, mesh)
        self.scene.collection.objects.link(obj)
        return obj

    def material(self, name, vertex_color=True, base=(0.8, 0.8, 0.8), emission=0.0, roughness=0.8,
                 translucency=0.0):
        material = self.track(bpy.data.materials.new(PREFIX + name))
        material.use_nodes = True
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        shader = nodes["Principled BSDF"]
        shader.inputs["Roughness"].default_value = roughness
        shader.inputs["Base Color"].default_value = (*base, 1.0)
        if vertex_color:
            attribute = nodes.new("ShaderNodeVertexColor")
            attribute.layer_name = "Col"
            links.new(attribute.outputs["Color"], shader.inputs["Base Color"])
            if emission > 0.0:
                links.new(attribute.outputs["Color"], shader.inputs["Emission Color"])
        if emission > 0.0:
            shader.inputs["Emission Strength"].default_value = emission
        if translucency > 0.0 and "Subsurface Weight" in shader.inputs:
            shader.inputs["Subsurface Weight"].default_value = translucency
            shader.inputs["Subsurface Radius"].default_value = (0.4, 0.25, 0.1)
        return material

    # -- baking -------------------------------------------------------------------------
    def bake_vertex_ao(self, obj, distance=4.0, samples=48):
        """Bake ambient occlusion into the active colour attribute and return it per vertex."""
        self.scene.cycles.samples = samples
        self.scene.world.light_settings.distance = distance
        mesh = obj.data
        layer = mesh.color_attributes.get("AO") or mesh.color_attributes.new("AO", "FLOAT_COLOR", "POINT")
        mesh.color_attributes.active_color = layer
        if not mesh.materials:
            mesh.materials.append(self.material("bake", vertex_color=False))
        for other in self.scene.collection.all_objects:
            other.select_set(False, view_layer=self.layer)
        obj.select_set(True, view_layer=self.layer)
        self.layer.objects.active = obj
        with bpy.context.temp_override(scene=self.scene, view_layer=self.layer, active_object=obj, object=obj,
                                       selected_objects=[obj], selected_editable_objects=[obj]):
            bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
        values = np.zeros(len(mesh.vertices) * 4, dtype=np.float32)
        layer.data.foreach_get("color", values)
        return values.reshape(-1, 4)[:, 0].copy()

    # -- preview ------------------------------------------------------------------------
    def setup_preview(self, sun_direction=(-0.36, 0.26, -0.9), sun_strength=5.5, sky=(0.42, 0.52, 0.7),
                      sky_strength=0.9):
        world = self.scene.world
        world.use_nodes = True
        background = world.node_tree.nodes["Background"]
        background.inputs["Color"].default_value = (*sky, 1.0)
        background.inputs["Strength"].default_value = sky_strength
        light_data = bpy.data.lights.new(PREFIX + "sun", "SUN")
        light_data.energy = sun_strength
        light_data.color = (1.0, 0.78, 0.52)
        light_data.angle = math.radians(3.0)
        light = bpy.data.objects.new(PREFIX + "sun", light_data)
        self.scene.collection.objects.link(light)
        direction = to_blender(np.array([sun_direction]))[0]
        direction = direction / np.linalg.norm(direction)
        # A sun lamp shines along its local -Z; aim -Z opposite to the direction toward the sun.
        from mathutils import Vector
        light.rotation_euler = Vector(direction).to_track_quat("Z", "Y").to_euler()
        return light

    def render(self, path, eye, target, lens=28.0, size=(900, 1100), samples=24, transparent=False):
        camera_data = bpy.data.cameras.new(PREFIX + "camera")
        camera_data.lens = lens
        camera_data.clip_end = 600
        camera = bpy.data.objects.new(PREFIX + "camera", camera_data)
        self.scene.collection.objects.link(camera)
        from mathutils import Vector
        eye_b = Vector(to_blender(np.array([eye]))[0])
        target_b = Vector(to_blender(np.array([target]))[0])
        camera.location = eye_b
        camera.rotation_euler = (target_b - eye_b).to_track_quat("-Z", "Y").to_euler()
        scene = self.scene
        scene.camera = camera
        scene.render.resolution_x, scene.render.resolution_y = size
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = transparent
        scene.cycles.samples = samples
        scene.cycles.use_denoising = False
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = str(path)
        scene.view_settings.view_transform = "Standard"
        bpy.ops.render.render(write_still=True, scene=scene.name)
        bpy.data.objects.remove(camera, do_unlink=True)
        bpy.data.cameras.remove(camera_data)
        return path

    # -- data renders -------------------------------------------------------------------
    def data_material(self, name="data"):
        """Emission straight from the colour attribute: the render stores numbers, not light."""
        material = self.track(bpy.data.materials.new(PREFIX + name))
        material.use_nodes = True
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        nodes.clear()
        attribute = nodes.new("ShaderNodeVertexColor")
        attribute.layer_name = "Col"
        emission = nodes.new("ShaderNodeEmission")
        output = nodes.new("ShaderNodeOutputMaterial")
        links.new(attribute.outputs["Color"], emission.inputs["Color"])
        links.new(emission.outputs["Emission"], output.inputs["Surface"])
        return material

    def render_orthographic(self, path, centre, width, height, size, samples=16):
        """Front elevation (looking along -Z in glTF space) with a transparent film.

        Returns float RGBA pixels as (rows, columns, 4) with row 0 at the bottom.
        """
        from mathutils import Vector
        camera_data = bpy.data.cameras.new(PREFIX + "ortho")
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = max(width, height)
        camera_data.clip_start = 0.1
        camera_data.clip_end = 500
        camera = bpy.data.objects.new(PREFIX + "ortho", camera_data)
        self.scene.collection.objects.link(camera)
        eye = to_blender(np.array([[centre[0], centre[1], centre[2] + 200.0]]))[0]
        camera.location = Vector(eye)
        camera.rotation_euler = (math.radians(90.0), 0.0, 0.0)
        scene = self.scene
        scene.camera = camera
        scene.render.resolution_x, scene.render.resolution_y = size
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = True
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.image_settings.color_depth = "8"
        scene.view_settings.view_transform = "Raw"
        scene.view_settings.look = "None"
        scene.render.dither_intensity = 0.0
        scene.cycles.samples = samples
        scene.cycles.use_denoising = False
        scene.cycles.max_bounces = 0
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        bpy.data.objects.remove(camera, do_unlink=True)
        bpy.data.cameras.remove(camera_data)
        image = bpy.data.images.load(str(path), check_existing=False)
        image.colorspace_settings.name = "Non-Color"
        pixels = np.zeros(size[0] * size[1] * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        bpy.data.images.remove(image)
        return pixels.reshape(size[1], size[0], 4)

    def save_image(self, path, pixels, colour=False):
        """Write float RGBA pixels (row 0 at the bottom) as an 8-bit PNG."""
        rows, columns, _ = pixels.shape
        image = bpy.data.images.new(PREFIX + "out", columns, rows, alpha=True)
        image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        image.alpha_mode = "STRAIGHT"
        image.pixels.foreach_set(np.ascontiguousarray(pixels, dtype=np.float32).reshape(-1))
        image.file_format = "PNG"
        image.filepath_raw = str(path)
        image.save()
        bpy.data.images.remove(image)


def dilate(pixels, iterations=10, threshold=0.02):
    """Bleed colour into transparent texels so mip-mapped edges do not darken."""
    rgb = pixels[:, :, :3].copy()
    known = pixels[:, :, 3] > threshold
    for _ in range(iterations):
        total = np.zeros_like(rgb)
        weight = np.zeros(known.shape, dtype=np.float32)
        for shift_y, shift_x in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            shifted_known = np.roll(np.roll(known, shift_y, axis=0), shift_x, axis=1)
            shifted_rgb = np.roll(np.roll(rgb, shift_y, axis=0), shift_x, axis=1)
            total += shifted_rgb * shifted_known[:, :, None]
            weight += shifted_known
        fill = (~known) & (weight > 0)
        rgb[fill] = total[fill] / weight[fill][:, None]
        known = known | fill
    result = pixels.copy()
    result[:, :, :3] = rgb
    return result
