import bpy
from pathlib import Path
from mathutils import Vector

output = Path(bpy.path.abspath('//'))
output = Path(r'C:\Users\olov_\repos\serenity-blocks\reports\ocean-kelp-forest')
output.mkdir(parents=True, exist_ok=True)
original_scene = bpy.context.window.scene
source = next(obj for obj in reversed(list(bpy.data.objects))
              if obj.get('forestRevision') == 'leafy-olive-24-fronds-amber-growth')
scene = bpy.data.scenes.new('Ocean Kelp Forest - Editable Atelier')
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 900
scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(output / 'kelp-studio.png')
scene.frame_start, scene.frame_end, scene.render.fps = 1, 97, 24
world = bpy.data.worlds.new('Forest Atelier Teal World')
world.use_nodes = True
world.node_tree.nodes.get('Background').inputs['Color'].default_value = (0.018, 0.055, 0.065, 1)
world.node_tree.nodes.get('Background').inputs['Strength'].default_value = 0.40
scene.world = world
model = source.copy()
model.name = 'Forest Kelp - Editable Studio Instance'
scene.collection.objects.link(model)
model['atelier_owner'] = 'serenity-kelp-forest-studio'
floor_mesh = bpy.data.meshes.new('Forest Atelier Ground Geometry')
floor_mesh.from_pydata([(-20, -20, -0.025), (20, -20, -0.025), (20, 20, -0.025), (-20, 20, -0.025)], [], [(0, 1, 2, 3)])
floor = bpy.data.objects.new('Forest Atelier Ground', floor_mesh)
scene.collection.objects.link(floor)
floor_mat = bpy.data.materials.new('Forest Atelier Ground Slate')
floor_mat.diffuse_color = (0.025, 0.060, 0.064, 1)
floor_mat.use_nodes = True
floor_shader = floor_mat.node_tree.nodes.get('Principled BSDF')
floor_shader.inputs['Base Color'].default_value = floor_mat.diffuse_color
floor_shader.inputs['Roughness'].default_value = 0.88
floor_mesh.materials.append(floor_mat)
for name, position, energy, size, color in (
        ('Forest Atelier Key', (4, -5, 8), 650, 5, (1, 0.94, 0.78)),
        ('Forest Atelier Rim', (-4, 3, 6), 480, 4, (0.50, 0.84, 1)),
        ('Forest Atelier Fill', (-3, -4, 3), 170, 4, (0.78, 1, 0.70))):
    light_data = bpy.data.lights.new(name, 'AREA')
    light_data.energy, light_data.shape, light_data.size, light_data.color = energy, 'DISK', size, color
    light = bpy.data.objects.new(name, light_data)
    scene.collection.objects.link(light)
    light.location = position
    light.rotation_euler = (Vector((0, 0, 2.7)) - light.location).to_track_quat('-Z', 'Y').to_euler()
camera_data = bpy.data.cameras.new('Forest Atelier Camera')
camera_data.type, camera_data.ortho_scale = 'ORTHO', 6.40
camera = bpy.data.objects.new('Forest Atelier Camera', camera_data)
scene.collection.objects.link(camera)
camera.location = (7.0, -12.0, 6.4)
camera.rotation_euler = (Vector((0.12, 0.1, 2.65)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera
try:
    bpy.context.window.scene = scene
    scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'ocean-kelp-forest.blend'), copy=True)
    bpy.ops.render.render(write_still=True, scene=scene.name)
    print('Saved editable kelp atelier copy and CPU studio image.')
finally:
    bpy.context.window.scene = original_scene
