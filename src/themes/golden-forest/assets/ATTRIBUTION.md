# Golden Forest — asset attribution

Every file in this folder is a project-owned original, authored procedurally in
Blender 4.5.9 LTS on 2026-10-05 for this repository by
`scripts/blender/golden_forest_assets.py` (helpers in `scripts/blender/golden_forest/`,
built on the Fall grove's branching library in `scripts/blender/fall_grove/`).
It contains no third-party geometry, texture, scan, photograph or generative-model
output, and the generator fetches nothing from the network. Licence: the same as the
project (MIT, project-local).

`asset-manifest.json` records each file's size and SHA-256;
`tests/unit/golden-forest-assets.test.js` checks the files against it.

| File | What it is |
| --- | --- |
| `spruce-hero.glb`, `pine-hero.glb` | The two framing trees: an old Norway spruce with surface roots, and a Scots pine that leans out over the water. One bark mesh each, plus the foliage sites. |
| `spruce-grove-a/b/c/d.glb`, `pine-grove-a/b.glb` | The conifers of the shores, headland, promontory, island and islet. |
| `golden-forest-foliage.glb` | The shared needle geometry: spruce bough sections (long- and short-curtained) and pine clumps, each at a near and a far level of detail. |
| `golden-forest-props.glb` | A clinker rowboat, a plank jetty, three boulders and a dead pine. |
| `golden-forest-impostors.png` | Front elevations of the six grove trees for the far shores. |

## How the trees are made

- **Growth.** Each specimen is grown from a seed (`golden_forest/conifers.py`). A spruce
  keeps one straight leader and carries whorls of limbs that droop under their own
  weight and turn up at the tip, longest low in the crown. A pine holds a bare trunk that
  leans and recovers, a broken umbrella of crooked limbs, and the stubs of the limbs it
  outgrew.
- **Bark mesh.** Tapered tubes with a flared base. Vertex colour carries what the runtime
  needs: R = how far the wind may carry the vertex, G = the limb's phase, B = ambient
  occlusion (a Cycles bake of the whole tree), A = a species mask — on a pine, where the
  grey plated bark gives way to thin orange bark; on a spruce, lichen.
- **Foliage sites.** A tree GLB stores no needles. It stores a point cloud of sites —
  position, orientation, size, wind response, a sky-visibility term and a bent normal —
  and the runtime instances the shared sprays onto them.
- **Needles are geometry, not alpha cards** (`golden_forest/needles.py`). A spruce bough
  section is a length of limb roofed in forward-swept shoots with a curtain of pendulous
  branchlets hanging beneath it; its edges are serrated, which is what reads as needles
  against a low sun. A pine clump is a burst of slim needle bundles from the end of a twig.
- **Props** (`golden_forest/props.py`). The boat is a lofted double-ended hull whose
  strakes each stand proud of the one above; the jetty is built plank by plank; the
  boulders are noise-displaced spheres. Their vertex colour stores a per-part tone, baked
  occlusion and a wear or lichen mask; the theme owns every material.
- **Sprite sheet.** `golden-forest-impostors.png` is a Cycles orthographic render of each
  grove tree with an emission material that stores data instead of colour: R = shade,
  G = needle mask, B = hue seed, A = coverage.

## Format

GLBs are written by the generator itself (`fall_grove/glb.py`), not by Blender's exporter:
positions are normalised 16-bit integers restored by the node's scale and translation,
normals and colours are 8-bit (`KHR_mesh_quantization`). There are no materials, textures
or animations in the files.

## Regenerating

```bash
blender --background --factory-startup --python scripts/blender/golden_forest_assets.py -- \
    --out src/themes/golden-forest/assets [--only trees,foliage,impostors,props] [--preview <dir>]
```

`--factory-startup` keeps the run independent of any Blender session that is open.
Growth is seeded, so the GLBs are reproducible; re-run the tests after regenerating. The
whole pack takes about two minutes on a laptop CPU.
