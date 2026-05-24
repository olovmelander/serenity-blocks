# Hero Rock GLBs

Drop tiny shape-only GLB rocks here. The committed ocean theme defaults to
procedural foreground rocks, but vetted CC0 Poly Pizza rocks may also be used as
small imported seabed detail.

If no GLBs are present, the procedural rocks render. Commit only tiny vetted
CC0/project-local detail rocks; larger or texture-heavy experiments should stay
local.

## Blender workflow — 5 min per rock

1. **Open Blender** (>= 3.0). Delete the default cube (`X`) so you start clean.
2. **Add a cube**: `Add → Mesh → Cube` (or `Shift+A → Mesh → Cube`).
3. **Subdivide it** so there are enough vertices to displace:
   - Right-click → `Subdivide`
   - Repeat 3 times (or set "Number of Cuts" to 3-4 in the F6 panel that pops up after).
4. **Randomize the vertices**:
   - Enter Edit Mode (`Tab`)
   - Select all vertices (`A`)
   - `Mesh → Transform → Randomize Vertices`
   - In the F6 panel, set `Amount ≈ 0.30`, leave Seed and Normal as defaults.
5. **Bevel the edges** so it reads as worn rock, not crystalline:
   - Still in Edit Mode, all selected
   - `Mesh → Bevel Edges`, or shortcut `Ctrl+B`
   - Set `Width ≈ 0.05`, `Segments = 2`.
6. **Smooth shading** (optional, for rounder look):
   - Exit Edit Mode (`Tab`)
   - Right-click → `Shade Smooth`
7. **Export as GLB**:
   - `File → Export → glTF 2.0 (.glb/.gltf)`
   - Format: **glTF Binary (.glb)**
   - Include: only Selected Objects ✓
   - Geometry: leave defaults
   - Materials: **Placeholder (No Export)** — runtime overrides with the scene rock material
   - Save as `rock-1.glb` (then `rock-2.glb` etc.) into this folder.

## Naming convention

Files are loaded in **alphabetical order** and assigned to hero rock slots in placement order. Use:

```
rock-1.glb
rock-2.glb
rock-3.glb
rock-4.glb
rock-5.glb
rock-6.glb
```

Committed rock GLBs must stay under 256 KB and use CC0 or project-local assets.
The runtime overrides their materials so texture-heavy rocks are rejected.

Extra GLBs beyond `foregroundRockCount` are ignored. Missing slots fall back to procedural.

## Material override

We **override the GLB's material** at runtime with the scene's mossy hero-rock material so all rocks share the lighting/grade pipeline. That means:

- Materials/textures applied in Blender are stripped
- ✅ The mesh shape and UVs are what matters
- ✅ You can keep the export size tiny (no embedded textures needed)

## Tips

- **Keep poly count modest** — under ~500 triangles per rock. Bevel `Segments = 1-2` is enough.
- **Origin at base** — before exporting, in Object Mode select your rock, `Object → Set Origin → Origin to 3D Cursor` (with the 3D cursor at the bottom of the rock) so it sits on the seabed correctly. If you skip this, the rock floats by half its height.
- **Apply transforms** — `Object → Apply → All Transforms` before exporting if you scaled in Object Mode.
- **Variety beats quality** — 6 distinct silhouettes beat 1 polished hero. Vary the randomize seed/amount between rocks.

## Verifying

Once you drop GLBs in:
1. Save your dev server should hot-reload
2. Reload the page
3. Hero rocks at the foreground positions should now be your Blender shapes
4. Open the JS console — any failed GLB load prints `🌊 [Ocean] rock GLB upgrade failed`

If you don't see your rock, check:
- File is named `rock-N.glb` (lowercase, hyphen)
- File is valid GLB (not GLTF + .bin sidecar — use the **.glb binary** export option)
- Browser cache — hard refresh (`Ctrl+Shift+R`)
