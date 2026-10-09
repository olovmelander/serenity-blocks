# Stillwater asset provenance

## Hero troll

The troll is the only authored model the theme loads. It is fetched and shaded by
`src/themes/stillwater/stillwater-figures.js` (`createTroll`), which picks one of the
four LODs below from the `troll` field of the quality tier
(`src/themes/stillwater/stillwater-quality.js`).

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
`C:\AI\troll_walk.blend`; its unsimplified export is `troll.glb` (59,853
triangles, vertex colours, one `Walk` clip).

`troll.glb` is kept in this folder as the source the LODs are cut from. Nothing
imports it, so it is not loaded at run time.

### Shipping LODs

The four runtime LODs are quantize-only glTF files. They use
`KHR_mesh_quantization`, retain the skin and animation, and deliberately do not
use meshopt or texture compression:

| Asset | Triangles | Target tier |
| --- | ---: | --- |
| `troll-lod0.glb` | 32,378 | Ultra / Extreme |
| `troll-lod1.glb` | 17,081 | High |
| `troll-lod2.glb` | 9,765 | Medium |
| `troll-lod3.glb` | 3,690 | Minimal / Low |

Generated with local `gltfpack 1.1` from the retained `troll.glb`:

```text
gltfpack -i troll.glb -o troll-lod0.glb -si 0.55 -sa -kn -ke
gltfpack -i troll.glb -o troll-lod1.glb -si 0.30 -sa -kn -ke
gltfpack -i troll.glb -o troll-lod2.glb -si 0.18 -sa -kn -ke
gltfpack -i troll.glb -o troll-lod3.glb -si 0.08 -sa -kn -ke
```

`tests/unit/stillwater-troll-assets.test.js` holds the four files to their
triangle bands and to that packing.

## Theme icon

`stillwater-theme-icon.png` (beside the theme, with a copy under
`public/assets/themes/`) is a project-owned Serenity Blocks theme raster. It was
re-captured from the rebuilt scene on 2026-10-09 and contains no third-party
asset. The icon it replaced is in the repository history: commits `421f71c`
(theme-icon update, 2026-03-03) and `df5111e` (2026-03-30).

## Everything else

The spirit, the trees, the boulders and all flora are built in code when the
theme loads (`stillwater-figures.js`, `stillwater-trees.js`, `stillwater-land.js`,
`stillwater-flora.js`); none of them has a source file. The two Blender-authored
models of the previous implementation, `spirit.glb` and `hero-trees.glb`, were
retired with it and removed on 2026-10-09.
