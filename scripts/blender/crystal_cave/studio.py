"""Blender-side helpers for the Crystal Cave: an isolated scene, remeshing, light bakes.

Everything lives in a dedicated scene that is removed afterwards, so the generator is
safe inside a session that has other work open as well as headless (--factory-startup).
Arrays cross this boundary in game coordinates (x right, y up, z toward the player).
"""

import bpy
import numpy as np
from mathutils import Vector

SCENE_NAME = "Serenity Crystal Cave - Atelier"
PREFIX = "SCAVE_"


def to_blender(points):
    points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    return np.stack([points[:, 0], -points[:, 2], points[:, 1]], axis=1)


def from_blender(points):
    points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    return np.stack([points[:, 0], points[:, 2], -points[:, 1]], axis=1)


class Studio:
    def __init__(self, threads=0):
        self.scene = bpy.data.scenes.new(SCENE_NAME)
        self.layer = self.scene.view_layers[0]
        self.created = []
        self.scene.render.engine = "CYCLES"
        self.scene.cycles.device = "CPU"
        self.scene.cycles.use_denoising = False
        if threads:
            self.scene.render.threads_mode = "FIXED"
            self.scene.render.threads = threads
        world = bpy.data.worlds.new(PREFIX + "world")
        world.use_nodes = True
        world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
        world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
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
                store = {"MESH": bpy.data.meshes, "CAMERA": bpy.data.cameras, "LIGHT": bpy.data.lights}.get(
                    data.id_type)
                if store is not None:
                    store.remove(data)
        for datablock in reversed(self.created):
            try:
                if isinstance(datablock, bpy.types.Material):
                    bpy.data.materials.remove(datablock)
                elif isinstance(datablock, bpy.types.World):
                    bpy.data.worlds.remove(datablock)
            except (ReferenceError, RuntimeError):
                pass
        bpy.data.scenes.remove(self.scene)

    # -- meshes -------------------------------------------------------------------------
    def mesh_object(self, name, positions, faces, smooth=True):
        """`faces` is a list/array of polygons (triangles or quads), game-space winding."""
        mesh = bpy.data.meshes.new(PREFIX + name)
        coords = to_blender(positions).astype(np.float32)
        faces = np.asarray(faces, dtype=np.int32)
        corners = faces.shape[1]
        mesh.vertices.add(len(coords))
        mesh.vertices.foreach_set("co", coords.reshape(-1))
        mesh.loops.add(faces.size)
        mesh.loops.foreach_set("vertex_index", faces.reshape(-1))
        mesh.polygons.add(len(faces))
        mesh.polygons.foreach_set("loop_start", np.arange(0, faces.size, corners, dtype=np.int32))
        mesh.polygons.foreach_set("loop_total", np.full(len(faces), corners, dtype=np.int32))
        mesh.polygons.foreach_set("use_smooth", np.full(len(faces), smooth, dtype=bool))
        mesh.update()
        mesh.validate()
        obj = bpy.data.objects.new(PREFIX + name, mesh)
        self.scene.collection.objects.link(obj)
        return obj

    def _evaluate(self, obj):
        self.layer.update()
        depsgraph = self.layer.depsgraph
        depsgraph.update()
        return bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), depsgraph=depsgraph)

    def apply_modifier(self, obj, kind, **settings):
        """Add one modifier, bake its result into the object's mesh, drop the modifier."""
        modifier = obj.modifiers.new(kind.lower(), kind)
        for key, value in settings.items():
            setattr(modifier, key, value)
        result = self._evaluate(obj)
        old = obj.data
        obj.modifiers.clear()
        obj.data = result
        bpy.data.meshes.remove(old)
        return obj

    def read(self, obj):
        """Vertices (game space), triangles and vertex normals of an object's mesh."""
        mesh = obj.data
        mesh.calc_loop_triangles()
        coords = np.zeros(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", coords)
        normals = np.zeros(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("normal", normals)
        triangles = np.zeros(len(mesh.loop_triangles) * 3, dtype=np.int32)
        mesh.loop_triangles.foreach_get("vertices", triangles)
        return from_blender(coords.reshape(-1, 3)), triangles.reshape(-1, 3), from_blender(normals.reshape(-1, 3))

    def move(self, obj, positions):
        obj.data.vertices.foreach_set("co", to_blender(positions).astype(np.float32).reshape(-1))
        obj.data.update()

    def set_weights(self, obj, name, weights):
        group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
        for index, weight in enumerate(np.asarray(weights, dtype=np.float64)):
            group.add([index], float(weight), "REPLACE")
        return group

    # -- materials ----------------------------------------------------------------------
    def diffuse(self, name, albedo=0.5):
        material = self.track(bpy.data.materials.new(PREFIX + name))
        material.use_nodes = True
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        nodes.clear()
        shader = nodes.new("ShaderNodeBsdfDiffuse")
        shader.inputs["Color"].default_value = (albedo, albedo, albedo, 1.0)
        output = nodes.new("ShaderNodeOutputMaterial")
        links.new(shader.outputs["BSDF"], output.inputs["Surface"])
        return material

    def emitter(self, name, colour=(1.0, 1.0, 1.0), strength=0.0):
        """A lamp surface. Its strength is switched per bake with `set_emission`."""
        material = self.track(bpy.data.materials.new(PREFIX + name))
        material.use_nodes = True
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        nodes.clear()
        shader = nodes.new("ShaderNodeEmission")
        shader.name = "lamp"
        shader.inputs["Color"].default_value = (*colour, 1.0)
        shader.inputs["Strength"].default_value = strength
        output = nodes.new("ShaderNodeOutputMaterial")
        links.new(shader.outputs["Emission"], output.inputs["Surface"])
        return material

    @staticmethod
    def set_emission(material, strength, colour=None):
        lamp = material.node_tree.nodes["lamp"]
        lamp.inputs["Strength"].default_value = strength
        if colour is not None:
            lamp.inputs["Color"].default_value = (*colour, 1.0)

    # -- baking -------------------------------------------------------------------------
    def _select(self, obj):
        for other in self.scene.collection.all_objects:
            other.select_set(False, view_layer=self.layer)
        obj.select_set(True, view_layer=self.layer)
        self.layer.objects.active = obj

    def _bake(self, obj, layer_name, **arguments):
        mesh = obj.data
        layer = mesh.color_attributes.get(layer_name) or mesh.color_attributes.new(layer_name, "FLOAT_COLOR", "POINT")
        mesh.color_attributes.active_color = layer
        self._select(obj)
        with bpy.context.temp_override(scene=self.scene, view_layer=self.layer, active_object=obj, object=obj,
                                       selected_objects=[obj], selected_editable_objects=[obj]):
            bpy.ops.object.bake(target="VERTEX_COLORS", **arguments)
        values = np.zeros(len(mesh.vertices) * 4, dtype=np.float32)
        layer.data.foreach_get("color", values)
        return values.reshape(-1, 4)[:, :3].copy()

    def bake_irradiance(self, obj, samples=256, bounces=3):
        """Light arriving at each vertex from whatever currently emits (direct + bounced)."""
        self.scene.cycles.samples = samples
        self.scene.cycles.max_bounces = bounces
        self.scene.cycles.diffuse_bounces = bounces
        self.scene.render.bake.use_pass_direct = True
        self.scene.render.bake.use_pass_indirect = True
        self.scene.render.bake.use_pass_color = False
        return self._bake(obj, "Light", type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}).mean(axis=1)

    def bake_occlusion(self, obj, samples=96, distance=9.0):
        self.scene.cycles.samples = samples
        self.scene.world.light_settings.distance = distance
        return self._bake(obj, "AO", type="AO")[:, 0]

    # -- lamps and previews -------------------------------------------------------------
    def spot(self, name, position, target, power, angle, blend=0.5, radius=0.5):
        data = bpy.data.lights.new(PREFIX + name, "SPOT")
        data.energy = power
        data.spot_size = angle
        data.spot_blend = blend
        data.shadow_soft_size = radius
        lamp = bpy.data.objects.new(PREFIX + name, data)
        self.scene.collection.objects.link(lamp)
        eye = Vector(to_blender([position])[0])
        aim = Vector(to_blender([target])[0])
        lamp.location = eye
        lamp.rotation_euler = (aim - eye).to_track_quat("-Z", "Y").to_euler()
        return lamp

    def render(self, path, eye, target, fov_degrees=55.0, size=(960, 540), samples=48, exposure=0.0):
        camera_data = bpy.data.cameras.new(PREFIX + "camera")
        camera_data.sensor_fit = "VERTICAL"
        camera_data.angle_y = np.radians(fov_degrees)
        camera_data.clip_start = 0.1
        camera_data.clip_end = 600
        camera = bpy.data.objects.new(PREFIX + "camera", camera_data)
        self.scene.collection.objects.link(camera)
        eye_b = Vector(to_blender([eye])[0])
        target_b = Vector(to_blender([target])[0])
        camera.location = eye_b
        camera.rotation_euler = (target_b - eye_b).to_track_quat("-Z", "Y").to_euler()
        scene = self.scene
        scene.camera = camera
        scene.render.resolution_x, scene.render.resolution_y = size
        scene.render.resolution_percentage = 100
        scene.cycles.samples = samples
        scene.cycles.max_bounces = 4
        scene.cycles.use_denoising = True
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = str(path)
        scene.view_settings.view_transform = "Filmic"
        scene.view_settings.exposure = exposure
        bpy.ops.render.render(write_still=True, scene=scene.name)
        scene.cycles.use_denoising = False
        bpy.data.objects.remove(camera, do_unlink=True)
        bpy.data.cameras.remove(camera_data)
        return path
