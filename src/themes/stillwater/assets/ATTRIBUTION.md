# Stillwater asset provenance

## Hero troll

The source image, `C:\AI\troll-source.png`, is a private, project-owned input
supplied by the Serenity Blocks author. It is not redistributed. The resulting
mesh and animation are project-owned derivatives.

### Reconstruction record

- Tool: **TRELLIS.2-4B** through the local `ComfyUI-Trellis2` GGUF workflow.
- Model format: **GGUF Q8_0**; backend `sdpa`; CUDA low-VRAM mode.
- Input processing: background removal enabled, no padding.
- Seed: `42`; pipeline type `512`.
- Sampling: Euler; 12 sparse-structure, 12 shape, and 12 texture steps.
- Sparse structure resolution: 32; maximum tokens: 49,152; maximum views: 4.
- Surface pass: 512 dual contouring, floater/inner-face removal, hole fill,
  Xatlas unwrap, 2,048 texture bake, vertex-colour bake, opaque material.
- Generation workflow retained at
  `C:\AI\TRELLIS2-ComfyUI\troll_tex_prompt.json`; intermediate mesh retained at
  `C:\AI\troll_textured.glb`.
- TRELLIS.2 is MIT-licensed. No Tencent/Hunyuan asset or model was used.

### Rig and animation

`C:\AI\TRELLIS2-ComfyUI\blender_troll_walk.py` records the full Blender
authoring step: the generated mesh was reduced to approximately 60k triangles,
rigged to a custom 13-joint biped with distance-based four-bone weights, and
given a hand-authored 36-frame / 30 fps walk cycle with counter-swinging arms,
body weight shift, and head compensation. The retained editable source is
`C:\AI\troll_walk.blend`; the unsimplified shipping-source export is
`troll.glb` (59,853 triangles, vertex colours, one `Walk` clip).

### Shipping LODs

The four runtime LODs are quantize-only glTF files. They use
`KHR_mesh_quantization`, retain the skin and animation, and deliberately do not
use meshopt or texture compression:

| Asset | Triangles | Target tier |
| --- | ---: | --- |
| `troll-lod0.glb` | 32,378 | Ultra / Extreme |
| `troll-lod1.glb` | 17,081 | High |
| `troll-lod2.glb` | 9,765 | Medium |
| `troll-lod3.glb` | 3,690 | Minimal / Low and first warm load |

Generated with local `gltfpack 1.1` from the retained `troll.glb`:

```text
gltfpack -i troll.glb -o troll-lod0.glb -si 0.55 -sa -kn -ke
gltfpack -i troll.glb -o troll-lod1.glb -si 0.30 -sa -kn -ke
gltfpack -i troll.glb -o troll-lod2.glb -si 0.18 -sa -kn -ke
gltfpack -i troll.glb -o troll-lod3.glb -si 0.08 -sa -kn -ke
```

## Theme icon

`stillwater-theme-icon.png` is a project-owned Serenity Blocks theme raster. Its
repository provenance is retained in commits `421f71c` (theme-icon update,
2026-03-03) and `df5111e` (2026-03-30); it contains no third-party asset.

## Spirit figure

`spirit.glb` is a project-owned asset, authored procedurally in Blender 5.1 on
2026-07-27 for this repository. It contains no third-party geometry, texture,
scan, or generative-model output, and no external source material was used.

| Mesh | Triangles | Role |
| --- | ---: | --- |
| `SpiritRobe` | 698 | Robe and hair — translucent body material |
| `SpiritCore` | 384 | Head — emissive core material |

Construction is deterministic: a lathed robe profile with angular fold
displacement weighted toward the hem, subtle shoulder bulges, and nine tapered
hair ribbons swept back from the crown. The two meshes are exported as a single
GLB with `export_materials='NONE'`, because the theme owns both materials and
only swaps in the geometry — this keeps the reflection layer assignment, render
order, and the spirit group's child count identical to the procedural fallback.

The authored figure replaces a procedural `LatheGeometry` silhouette, which is
retained in `stillwater-characters.js` as the fallback when the GLB is
unavailable; `authoredSpiritReady` in the character diagnostics reports which of
the two is live.
