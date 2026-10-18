# Stillwater asset provenance

Every figure file here is written by `scripts/blender/stillwater_assets.py` (Blender 4.5 LTS,
headless, nothing downloaded):

```text
blender --background --factory-startup --python scripts/blender/stillwater_assets.py -- \
    --out src/themes/stillwater/assets [--only troll,spirit]
```

Both figures use the same compact layout (`scripts/blender/stillwater/figure_glb.py`): one
quantised mesh (`KHR_mesh_quantization`: POSITION int16, NORMAL int8, COLOR_0 uint8, JOINTS_0
uint8, WEIGHTS_0 uint8 summing to 255), no glTF skin and no animation. The skeleton rides in
`scenes[0].extras.bones` (`{ name, parent, head, tail }` in the model's unit frame) and
`src/themes/stillwater/stillwater-rig.js` builds the bones from it. Every pose is made at run time
(`stillwater-troll-body.js`, `stillwater-spirit-body.js`).

## The troll

`troll.glb` is the theme's own troll, the author's character: the troll files are drawn in its
character (since 2026-10-18 they no longer derive from its mesh). It is not loaded at run time.

The source image, `C:\AI\troll-source.png`, is a private, project-owned input supplied by the
Serenity Blocks author. It is not redistributed. The resulting mesh is a project-owned
derivative. It was reconstructed with **TRELLIS.2-4B** through the local `ComfyUI-Trellis2` GGUF
workflow (GGUF Q8_0, `sdpa`, CUDA low-VRAM; background removal on, no padding; seed 42, pipeline
type 512; Euler, 12 sparse-structure, 12 shape and 12 texture steps; sparse structure resolution
32, at most 49,152 tokens and 4 views; 512 dual contouring, floater and inner-face removal, hole
fill, Xatlas unwrap, 2,048 texture bake, vertex-colour bake, opaque material), then reduced to about
60k triangles and given a 13-joint rig and a `Walk` clip in Blender (`C:\AI\TRELLIS2-ComfyUI\
blender_troll_walk.py`, `C:\AI\troll_walk.blend`; that machine is gone). TRELLIS.2 is MIT-licensed.
No Tencent/Hunyuan asset or model was used.

`troll-lod0..3.glb` (drawn 2026-10-18, `scripts/blender/stillwater/troll_shape.py` and
`troll.py`, from numbers alone): the reconstruction's pelt was a soup of thin sheets that read as
torn, messy paper however it was rebuilt, so the troll is now drawn clean in the source's character
(a stocky old troll, his head carried low and forward, a long drooping nose, long ears, big hands
and feet, a cloak of matted hair to his knees). He is one signed distance field: smooth masses
blended into each other along the 21-bone skeleton's rest pose, eye sockets and nostrils taken out,
heavy lids, a loincloth wrapped round his hips with a rope belt, then a mane of matted moss locks
draped under gravity over his body (a mantle from a yoke round his neck, the crown over it, a moss
beard, bushy brows) and a few small mushrooms in his moss. The field is meshed once (OpenVDB, voxel
0.003 of his height), only its outer shell kept, decimated to four LODs, weighted (bone heat for the
body; the beard and brows on his head, the crown's locks from his head down his torso, the mantle by
height down his torso and partly on his collarbones) and given baked ambient occlusion (Cycles,
CPU). COLOR_0 = skin (1 his ruddy face, 0.65 his hide, 0.2 an eye), ambient occlusion, moss, kind
(the moss lock's own shade 0..0.6, 0.7 an eye, 1 a mushroom); all but the occlusion zero = leather.
Project-owned.

| Asset | Triangles | Target tier |
| --- | ---: | --- |
| `troll-lod0.glb` | 32,000 | Ultra / Extreme |
| `troll-lod1.glb` | 17,000 | High |
| `troll-lod2.glb` | 9,700 | Medium |
| `troll-lod3.glb` | 3,700 | Minimal / Low |

## The spirit

`spirit-lod0.glb` (11,166 triangles, Medium and up) and `spirit-lod1.glb` (5,582, Low and
Minimal), authored 2026-10-18 by `scripts/blender/stillwater/spirit.py` from numbers alone: a body
made with Blender's skin modifier (arms, hands with thumbs, neck), a head, a cap and a fall of hair
with two locks, a gown with a train, bell sleeves and a circlet; 19 bones (two hair links and four
gown panels that the runtime lets hang and trail); baked ambient occlusion. COLOR_0 = skin, hair
(both: the circlet's gold), how freely it moves, ambient occlusion. Project-owned.

## Theme icon

`stillwater-theme-icon.png` (beside the theme, with a copy under `public/assets/themes/`) is a
project-owned Serenity Blocks theme raster captured from the scene. It contains no third-party
asset.

## Everything else

The trees, the boulders and all flora are built in code when the theme loads
(`stillwater-trees.js`, `stillwater-land.js`, `stillwater-flora.js`); none of them has a source
file.
