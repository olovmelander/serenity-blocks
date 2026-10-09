# Winter theme — asset attribution

## arctic-fox.glb — project original (no third-party attribution required)

The white arctic fox that goes its round over the snowfield, and whose shape the fox of light
in the sky is drawn from. Produced with the project-owned local asset pipeline
(`C:\AI\TRELLIS2-ComfyUI`):

1. **Concept**: a stylized low-poly arctic-fox reference image (`arctic_fox.png`).
2. **Image → 3D**: TRELLIS.2-4B (GGUF Q8_0, `1024_cascade` pipeline) reconstructs a
   vertex-coloured mesh from the photo — `generate_arctic_fox.py`.
3. **Rig + animate**: headless Blender (`blender_rig_arctic_fox.py`) — decimate to
   ~50k tris, smooth-shade, clean the coat to white while keeping the photo's dark
   eyes/nose, build an 18-bone quadruped skeleton (spine/neck/head + 3-bone tail +
   4 legs), inverse-square distance skin weights, and ten baked clips (`Run`, `Pounce`,
   `Listen`, `LookAround`, `Dig`, `Scratch`, `Shake`, `Stretch`, `Greet`, `CurlSleep`).
   Exported `export_yup` / `export_animations`.

Loaded by `src/themes/winter/winter-fox.js` (GLTFLoader, one `AnimationMixer` per body) and
posed from `winter-fox-mind.js`; shaded by the theme's own unlit node material. License:
proprietary project original (TRELLIS.2 is MIT-licensed).

## snow-ghosts.bin, snow-ghosts-manifest.json — generated

The snow-loaded spruces are generated, not modelled or scanned: `scripts/winter/bake-ghosts.mjs`
grows each of five kinds as a smooth union of ellipsoids (a rimed stem, whorls of drooping
boughs under their pillows, a top bowed over by its load), meshes the field with naive surface
nets at four levels of detail, and stores for every vertex its position (16-bit), its normal
(8-bit) and four shading values read off the field: openness to the sky, bough or snow,
thinness, height. No photograph, scan or third-party model is involved, so there is nothing to
attribute. Regenerate with

    node scripts/winter/bake-ghosts.mjs

which rewrites both files (the same script gives the same bytes; `--check` compares a fresh bake
with the manifest, `--dry --preview=<dir>` ray-casts every kind to one PNG on the CPU).
`tests/unit/winter-ghosts.test.js` pins the manifest's hash to the asset.

_The earlier theme's TRELLIS conifers (`spruce.glb`, `pine.glb`, `fir.glb` and their `_lod`
copies) were removed with it. The Odyssey's conifer belt keeps its own copies under
`src/rendering/odyssey/assets/shared/conifers/`._
