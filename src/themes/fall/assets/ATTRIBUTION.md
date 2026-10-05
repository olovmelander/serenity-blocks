# Fall — asset attribution

Every file in this folder is a project-owned original, authored procedurally in
Blender 4.5.9 LTS on 2026-10-05 for this repository by
`scripts/blender/fall_grove_assets.py` (helpers in `scripts/blender/fall_grove/`).
It contains no third-party geometry, texture, scan, photograph or generative-model
output, and the generator fetches nothing from the network. Licence: the same as the
project (MIT, project-local).

`asset-manifest.json` records each file's size and SHA-256; `tests/unit/fall-assets.test.js`
checks the files against it.

| File | What it is |
| --- | --- |
| `maple-hero.glb`, `oak-hero.glb` | The two foreground trees: buttressed trunks with roots, limbs, branches and twigs as one bark mesh, plus the foliage sites. |
| `maple-grove-a/b/c.glb`, `birch-grove-a/b.glb` | The grove trees of the middle distance. |
| `fall-foliage.glb` | The shared leaf geometry: maple and oak sprays, maple clumps, weeping birch strands (two variants each) and single leaves for the litter and the leaves in the air. |
| `fall-impostors.png` | Front elevations of the five grove trees for the distant forest. |

## How the trees are made

- **Growth.** Each specimen is grown from a seed by a small branching model
  (`fall_grove/skeleton.py`, `species.py`): a trunk, scaffold limbs that sag under
  their weight and turn up toward the light, branches, twigs, and a crown hull that
  trims them. Old trunks get a flared, fluted base whose buttress lobes continue as
  roots (`wood.py`).
- **Bark mesh.** Limbs are tapered tubes with UVs that keep bark texels square as the
  limb thins. Vertex colour carries what the runtime needs: R = how far the wind may
  carry the vertex, G = the limb's phase, B = ambient occlusion, A = moss cover. The
  occlusion is a Cycles bake of the whole tree (crown, roots and ground included).
- **Foliage sites.** A tree GLB stores no leaves. It stores a point cloud of sites —
  position, orientation, size, wind response, a sky-visibility term and a bent normal
  (both computed from the crown's own density) — and the runtime instances the shared
  sprays onto them. Leaves are real lobed geometry, not alpha cards.
- **Sprite sheet.** `fall-impostors.png` is a Cycles orthographic render of each grove
  tree with an emission material that stores data instead of colour: R = shade,
  G = leaf mask, B = hue seed, A = coverage. The runtime turns it into autumn colour
  per tree, so one sheet gives crimson, amber and gold trees.

## Format

GLBs are written by the generator itself (`fall_grove/glb.py`), not by Blender's
exporter: positions are normalised 16-bit integers restored by the node's scale and
translation, normals and colours are 8-bit (`KHR_mesh_quantization`). There are no
materials, textures or animations in the files; the theme owns every material.

## Regenerating

```bash
blender --background --factory-startup --python scripts/blender/fall_grove_assets.py -- \
    --out src/themes/fall/assets [--only trees,foliage,impostors] [--preview <dir>]
```

`--factory-startup` keeps the run independent of any Blender session that is open.
The same script can be executed inside a running Blender (it works in its own scene
and removes it afterwards), but headless is the supported path. Growth is seeded, so
the GLBs are reproducible byte for byte; re-run the tests after regenerating.
