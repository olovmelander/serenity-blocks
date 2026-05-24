import trimesh
m = trimesh.load("src/themes/ocean/assets/fauna/reef-seahorse-triposr.glb", force="mesh")
print("Bounds:", m.bounds)
print("Extents:", m.extents)
print("Center:", m.centroid)
print("Visual kind:", m.visual.kind)
if hasattr(m.visual, 'vertex_colors') and m.visual.vertex_colors is not None:
    vc = m.visual.vertex_colors
    print(f"Vertex colors shape: {vc.shape}")
    print(f"Avg color RGBA: {vc.mean(axis=0)}")
    print(f"Min color RGBA: {vc.min(axis=0)}")
    print(f"Max color RGBA: {vc.max(axis=0)}")
else:
    print("No vertex colors found")
