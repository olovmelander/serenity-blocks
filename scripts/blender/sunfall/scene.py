"""Blender-side helpers: numpy meshes into bpy, the rest camera, sun, sky and a path-traced preview.

Blender is Z-up; the theme is Y-up with the eye looking down -z. `to_blender` maps a
three.js point (x, y, z) to Blender (x, -z, y) and `from_blender` maps it back.
"""

import math

import bpy
import numpy as np
from mathutils import Vector

from . import layout as L


def to_blender(points):
    p = np.asarray(points, dtype=np.float64)
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)


def from_blender(points):
    p = np.asarray(points, dtype=np.float64)
    return np.stack([p[:, 0], p[:, 2], -p[:, 1]], axis=1)


def dir_to_blender(d):
    return Vector((d[0], -d[2], d[1])).normalized()


def mesh_object(name, verts_three, faces, collection=None):
    """Create a mesh object from three.js-space vertices and triangle indices."""
    v = to_blender(verts_three).astype(np.float32)
    f = np.asarray(faces, dtype=np.int32)
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(len(v))
    mesh.vertices.foreach_set("co", v.ravel())
    mesh.loops.add(len(f) * 3)
    mesh.loops.foreach_set("vertex_index", f.ravel())
    mesh.polygons.add(len(f))
    mesh.polygons.foreach_set("loop_start", np.arange(0, len(f) * 3, 3, dtype=np.int32))
    mesh.update(calc_edges=True)
    mesh.validate(clean_customdata=False)
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def principled(name, color, roughness=0.85, translucent=0.0, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if translucent > 0.0:
        out = nodes.get("Material Output")
        tr = nodes.new("ShaderNodeBsdfTranslucent")
        tr.inputs["Color"].default_value = (*color, 1.0)
        mix = nodes.new("ShaderNodeMixShader")
        mix.inputs["Fac"].default_value = translucent
        links.new(bsdf.outputs["BSDF"], mix.inputs[1])
        links.new(tr.outputs["BSDF"], mix.inputs[2])
        links.new(mix.outputs["Shader"], out.inputs["Surface"])
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission[:3], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission[3]
    return mat


def rest_camera(name="SunfallCamera", fov_deg=None, pitch_deg=None, yaw_deg=None, position=None):
    cam = L.CAMERA
    data = bpy.data.cameras.new(name)
    data.sensor_fit = "VERTICAL"
    data.angle_y = math.radians(fov_deg if fov_deg is not None else cam["fov_deg"])
    data.clip_start = 0.3
    data.clip_end = 4000.0
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    pos = position if position is not None else cam["position"]
    obj.location = tuple(to_blender([pos])[0])
    pitch = pitch_deg if pitch_deg is not None else cam["pitch_deg"]
    yaw = yaw_deg if yaw_deg is not None else cam["yaw_deg"]
    # Blender cameras look down local -Z; X = 90 degrees turns that to +Y (three's -z).
    obj.rotation_euler = (math.radians(90.0 + pitch), 0.0, math.radians(-yaw))
    bpy.context.scene.camera = obj
    return obj


def sun_lamp(sun_dir_three, strength=6.0, angle_deg=0.53):
    data = bpy.data.lights.new("SunfallSun", type="SUN")
    data.energy = strength
    data.angle = math.radians(angle_deg)
    obj = bpy.data.objects.new("SunfallSun", data)
    bpy.context.scene.collection.objects.link(obj)
    d = dir_to_blender(sun_dir_three)
    obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return obj


def sky_world(sun_dir_three, strength=1.0):
    world = bpy.data.worlds.new("SunfallSky")
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    bg = nodes.get("Background")
    sky = nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
        sky.sun_disc = False
        d = dir_to_blender(sun_dir_three)
        sky.sun_elevation = math.asin(max(-1.0, min(1.0, d.z)))
        sky.sun_rotation = math.atan2(d.x, d.y)
    except Exception:  # noqa: BLE001 - older/newer sky enums: fall back to a flat sky
        pass
    links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength
    bpy.context.scene.world = world
    return world


def volume_box(name, lo_three, hi_three, density, anisotropy=0.6, color=(1.0, 1.0, 1.0)):
    lo = np.asarray(lo_three, dtype=np.float64)
    hi = np.asarray(hi_three, dtype=np.float64)
    centre = (lo + hi) * 0.5
    size = hi - lo
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.active_object
    obj.name = name
    obj.location = tuple(to_blender([centre])[0])
    obj.scale = (size[0], size[2], size[1])
    mat = bpy.data.materials.new(name + "Mat")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.remove(nodes.get("Principled BSDF"))
    vol = nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = density
    vol.inputs["Anisotropy"].default_value = anisotropy
    vol.inputs["Color"].default_value = (*color, 1.0)
    links.new(vol.outputs["Volume"], nodes.get("Material Output").inputs["Volume"])
    obj.data.materials.append(mat)
    return obj


def use_gpu(scene):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            ok = False
            for dev in prefs.devices:
                dev.use = dev.type == kind
                ok = ok or dev.use
            if ok:
                scene.cycles.device = "GPU"
                return kind
        except Exception:  # noqa: BLE001
            continue
    scene.cycles.device = "CPU"
    return "CPU"


def render_preview(path, width=960, height=540, samples=96, exposure=0.0):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    device = use_gpu(scene)
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = "OPTIX" if device == "OPTIX" else "OPENIMAGEDENOISE"
    except Exception:  # noqa: BLE001
        pass
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 1
    scene.cycles.transmission_bounces = 2
    scene.cycles.volume_bounces = 1
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = exposure
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return device
