"""Create an isolated Blender authoring scene; preserve the user's original scene."""
import bpy
import json

scene_name = "Ocean Reef Atelier"
scene = bpy.data.scenes.get(scene_name) or bpy.data.scenes.new(scene_name)
if bpy.context.window:
    bpy.context.window.scene = scene
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.fps = 30
scene.frame_start = 1
scene.frame_end = 181
scene.world = bpy.data.worlds.get("Ocean Atelier World") or bpy.data.worlds.new("Ocean Atelier World")
scene.world.use_nodes = True
scene.world.node_tree.nodes.get("Background").inputs["Color"].default_value = (0.025, 0.065, 0.085, 1)
scene.world.node_tree.nodes.get("Background").inputs["Strength"].default_value = 0.45
print(json.dumps({"blender": bpy.app.version_string, "scene": scene.name,
                  "preserved_scenes": [s.name for s in bpy.data.scenes if s != scene]}))
