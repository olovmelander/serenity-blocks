"""Render an isolated, reusable Blender inspection stage for eight original ocean assets.

Execute with runpy.run_path(), then call render_atelier(). Source asset objects and
their export transforms remain unchanged; only linked preview objects are posed.
"""

from pathlib import Path
import math

import bpy
from mathutils import Vector


OWNER = "serenity-ocean-atelier-preview-v1"
SCENE_NAME = "Serenity Ocean - Asset Atelier"
COLLECTION_NAME = "Serenity Ocean - Preview Stage"
FRAME_WIDTH = 18.8

ASSETS = (
    ("reef-buttress", "ERODED BUTTRESS", -5.85, 2.65, 3.35, 3.65, -0.10),
    ("reef-outcrop", "LIMESTONE SHOULDER", -1.95, 2.65, 3.25, 2.05, 0.12),
    ("jellyfish", "MOON JELLY", 1.95, 2.65, 3.00, 3.45, 0.0),
    ("kelp", "RIBBON KELP", 5.85, 2.65, 3.10, 3.65, -0.15),
    ("coral-staghorn", "APRICOT STAGHORN", -5.85, -2.45, 3.00, 2.55, 0.14),
    ("coral-foliose", "ROSE FOLIOSE", -1.95, -2.45, 3.12, 2.55, -0.12),
    ("coral-fan", "VIOLET SEA FAN", 1.95, -2.45, 3.10, 2.55, -0.08),
    ("coral-sponge", "TRUMPET SPONGE", 5.85, -2.45, 3.00, 2.55, 0.16),
)


def _find_source(asset_id):
    matches = []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.get("atelier_owner") == OWNER:
            continue
        identity = obj.get("asset_id") or obj.get("assetId")
        if identity == asset_id or obj.name == asset_id:
            matches.append(obj)
    if not matches:
        raise RuntimeError("Missing original Blender ocean asset: " + asset_id)
    # Rebuilds deliberately retain older authoring collections. Prefer the most
    # recent matching original rather than a preview clone or imported copy.
    return matches[-1]


def _owned_object(name, data, collection):
    obj = bpy.data.objects.new(name, data)
    obj["atelier_owner"] = OWNER
    collection.objects.link(obj)
    return obj


def _material(name, color, roughness=0.6, metallic=0.0, emission=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material["atelier_owner"] = OWNER
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = tuple(color) + (1.0,)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if emission > 0:
        shader.inputs["Emission Color"].default_value = tuple(color) + (1.0,)
        shader.inputs["Emission Strength"].default_value = emission
    return material


def _ground(collection, material):
    mesh = bpy.data.meshes.new("Atelier_GroundMesh")
    mesh.from_pydata([(-200, -200, -0.08), (200, -200, -0.08),
                     (200, 200, -0.08), (-200, 200, -0.08)], [], [(0, 1, 2, 3)])
    mesh.materials.append(material)
    return _owned_object("Atelier_Ground", mesh, collection)


def _plinth(collection, material, x, y, radius=1.70):
    segments = 64
    vertices = []
    for z in (-0.06, 0.12):
        for side in range(segments):
            angle = side / segments * math.tau
            vertices.append((math.cos(angle) * radius, math.sin(angle) * radius, z))
    faces = [tuple(reversed(range(segments))), tuple(range(segments, segments * 2))]
    for side in range(segments):
        other = (side + 1) % segments
        faces.append((side, other, other + segments, side + segments))
    mesh = bpy.data.meshes.new("Atelier_PlinthMesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    obj = _owned_object("Atelier_Plinth", mesh, collection)
    obj.location = (x, y, 0)
    bevel = obj.modifiers.new("Soft lip", "BEVEL")
    bevel.width = 0.045
    bevel.segments = 3
    return obj


def _text(collection, material, body, x, y, size, name):
    curve = bpy.data.curves.new(name + "_Text", type="FONT")
    curve.body = body
    curve.align_x = "CENTER"
    curve.size = size
    curve.space_character = 1.12
    curve.extrude = 0
    curve.materials.append(material)
    obj = _owned_object(name, curve, collection)
    obj.location = (x, y, 0.14)
    return obj


def _point_at(obj, position):
    obj.rotation_euler = (Vector(position) - obj.location).to_track_quat("-Z", "Y").to_euler()


def _area(collection, name, position, target, energy, color, size):
    light = bpy.data.lights.new(name, type="AREA")
    light.energy = energy
    light.color = color
    light.shape = "DISK"
    light.size = size
    obj = _owned_object(name, light, collection)
    obj.location = position
    _point_at(obj, target)
    return obj


def _scene():
    existing = bpy.data.scenes.get(SCENE_NAME)
    if existing and existing.get("atelier_owner") == OWNER:
        scene = existing
        # The only deletions are explicitly tagged objects in this owned stage.
        for obj in list(scene.objects):
            if obj.get("atelier_owner") == OWNER:
                bpy.data.objects.remove(obj, do_unlink=True)
        collection = next((child for child in scene.collection.children
                           if child.get("atelier_owner") == OWNER), None)
        if collection is None:
            collection = bpy.data.collections.new(COLLECTION_NAME)
            collection["atelier_owner"] = OWNER
            scene.collection.children.link(collection)
        return scene, collection
    scene = bpy.data.scenes.new(SCENE_NAME)
    scene["atelier_owner"] = OWNER
    collection = bpy.data.collections.new(COLLECTION_NAME)
    collection["atelier_owner"] = OWNER
    scene.collection.children.link(collection)
    return scene, collection


def render_atelier(output_dir=None, render_still=True, save_blend=True):
    """Create the eight-asset stage, render its still and save a COPY of the .blend.

    Defaults to reports/ocean-blender/ beneath this script's repository. The caller
    can supply another destination. No animation playback is started.
    """
    repo_root = Path(__file__).resolve().parents[2]
    destination = Path(output_dir).expanduser().resolve() if output_dir else repo_root / "reports" / "ocean-blender"
    destination.mkdir(parents=True, exist_ok=True)
    image_path = destination / "blender-atelier.png"
    blend_path = destination / "ocean-reef-atelier.blend"
    sources = {spec[0]: _find_source(spec[0]) for spec in ASSETS}
    original_scene = bpy.context.scene
    original_frame = original_scene.frame_current
    window = bpy.context.window
    original_window_scene = window.scene if window else None
    scene, collection = _scene()
    # Separate world and render settings: never mutate the user's original Scene.
    world = bpy.data.worlds.new("Atelier_DeepTealWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.015, 0.045, 0.065, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.32
    scene.world = world
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    if hasattr(scene, "eevee") and hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = 32
    scene.render.resolution_x, scene.render.resolution_y = 1400, 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(image_path)
    scene.render.fps = 30
    scene.frame_start, scene.frame_end = 1, 181
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except (TypeError, ValueError):
        pass
    scene.view_settings.exposure = 0.25

    ground_material = _material("Atelier_DeepTealGround", (0.016, 0.043, 0.052), 0.72)
    plinth_material = _material("Atelier_SlatePlinth", (0.024, 0.066, 0.074), 0.38, 0.12)
    label_material = _material("Atelier_ShellLettering", (0.43, 0.63, 0.61), 0.8, emission=0.15)
    title_material = _material("Atelier_PearlTitle", (0.67, 0.82, 0.78), 0.8, emission=0.2)
    _ground(collection, ground_material)
    posed = []
    for asset_id, title, x, y, max_width, max_height, angle in ASSETS:
        original = sources[asset_id]
        obj = original.copy()
        obj.name = "Atelier_" + asset_id
        obj["atelier_owner"] = OWNER
        collection.objects.link(obj)
        obj.hide_render = False
        obj.hide_viewport = False
        coords = [vertex.co for vertex in obj.data.vertices]
        minimum = [min(point[axis] for point in coords) for axis in range(3)]
        maximum = [max(point[axis] for point in coords) for axis in range(3)]
        width = max(maximum[0] - minimum[0], maximum[1] - minimum[1])
        height = maximum[2] - minimum[2]
        scale = min(max_width / max(width, 0.001), max_height / max(height, 0.001))
        obj.scale = (scale, scale, scale)
        obj.rotation_euler = (0, 0, angle)
        # Jellyfish's source origin is its bell, unlike the seabed-anchored plants.
        # Seat its lowest tentacle over the plinth without changing shared mesh data.
        clearance = 0.18 if asset_id == "jellyfish" else 0
        obj.location = (x, y, 0.12 - minimum[2] * scale + clearance)
        _plinth(collection, plinth_material, x, y)
        _text(collection, label_material, title, x, y - 2.02, 0.22, "Atelier_Label_" + asset_id)
        posed.append(dict(asset=asset_id, source=original.name, preview=obj.name,
                          scale=scale, location=list(obj.location)))

    _text(collection, title_material, "O C E A N   /   R E E F   A T E L I E R", 0, 5.35, 0.40, "Atelier_Title")
    _text(collection, label_material, "ORIGINAL FORMS     |     COLOUR, SILHOUETTE & CURRENT", 0, -5.30, 0.18, "Atelier_Subtitle")
    _area(collection, "Atelier_WarmKey", (-6, -6, 11), (0, 0, 1), 1900, (1.0, 0.82, 0.67), 8)
    _area(collection, "Atelier_CoolFill", (8, -1, 8), (0, 0, 1), 1250, (0.39, 0.79, 1.0), 7)
    _area(collection, "Atelier_WaterRim", (0, 7, 11), (0, 0, 1), 2300, (0.50, 0.77, 1.0), 6)
    camera_data = bpy.data.cameras.new("Atelier_OrthographicCamera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = FRAME_WIDTH
    camera = _owned_object("Atelier_OrthographicCamera", camera_data, collection)
    camera.location = (5.8, -16.5, 15.5)
    _point_at(camera, (0, 0, 0.9))
    scene.camera = camera
    try:
        if window:
            window.scene = scene
        scene.frame_set(40)
        if render_still:
            bpy.ops.render.render(write_still=True, scene=scene.name)
        if save_blend:
            # copy=True writes the inspection artifact without repointing or
            # overwriting the user's currently open .blend file.
            bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), copy=True)
    finally:
        if window and original_window_scene:
            window.scene = original_window_scene
        original_scene.frame_set(original_frame)
    return dict(scene=scene.name, collection=collection.name, assets=posed,
                frame=40, resolution=[1400, 900],
                image=str(image_path) if render_still else None,
                blend=str(blend_path) if save_blend else None)
