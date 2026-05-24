import trimesh
m = trimesh.load("src/themes/ocean/assets/fauna/reef-seahorse-triposr.glb", force="mesh")
print(f"Vertices: {len(m.vertices)}")
print(f"Faces: {len(m.faces)}")
print(f"Extents: {m.extents}")
import os
size = os.path.getsize("src/themes/ocean/assets/fauna/reef-seahorse-triposr.glb")
print(f"File size: {size} bytes ({size/1024:.1f} KB)")
print(f"Under 1MB: {size <= 1024*1024}")
print(f"Under 12k triangles: {len(m.faces) <= 12000}")
