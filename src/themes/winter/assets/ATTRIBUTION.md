# Winter theme — asset attribution

## arctic-fox.glb — project original (no third-party attribution required)

The white arctic fox that goes its round over the snowfield, and whose shape the fox of light
in the sky is drawn from. Produced with the project-owned local asset pipeline
(`C:\AI\TRELLIS2-ComfyUI`):

1. **Concept**: a stylized low-poly arctic-fox reference image (`arctic_fox.png`).
2. **Image → 3D**: TRELLIS.2-4B (GGUF Q8_0, `1024_cascade` pipeline) reconstructs a
   vertex-coloured mesh from the photo — `generate_arctic_fox.py`.
3. **Mesh**: headless Blender (`blender_rig_arctic_fox.py`) — decimate to ~50k tris and
   smooth-shade. (That script also gave it an 18-bone skeleton, distance-only skin weights
   and ten baked clips; none of those are in the file any more.)
4. **Rig** (2026-10-09): `node scripts/winter/rig-fox.mjs`, in this repository. It centres the
   mesh, turns its head to look straight ahead (the reconstruction had it turned about 32°
   to one side), rounds its facets a little, and gives it the skeleton the theme animates —
   the 21 axis-aligned bones of `src/themes/winter/winter-fox-rig.js`: a back of three, neck,
   head, a tail of four, legs of three — with skin weights laid by region. It also paints
   the coat into the vertex colours: how far along the tail a vertex is, how long its fur is,
   how dark it is (nose, eyes, the hollows of the ears: the reconstruction had two dots for
   eyes and no nose) and how much of the sky it sees (an occlusion bake).

The file holds no animation: the theme solves every pose itself (`winter-fox-rig.js`, from
the pose `winter-fox-mind.js` resolves) and `src/themes/winter/winter-fox.js` copies the
rotations onto the bones; it is shaded by the theme's own unlit node materials (skin and
shells of fur). License: proprietary project original (TRELLIS.2 is MIT-licensed).

The same script and source give the same bytes, and the file records that its mesh has been
straightened, so `node scripts/winter/rig-fox.mjs` on the asset itself only redoes skin and
coat; `--check` compares a fresh rig with the file (a test runs it) and `--preview=<dir>`
draws mesh, skin and coat on the CPU. To redo the mesh steps, rig the source instead: it is
the file as it was before the re-rig, `git show 21e3537d:src/themes/winter/assets/arctic-fox.glb
> source.glb`, then `node scripts/winter/rig-fox.mjs --from=source.glb`.

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
