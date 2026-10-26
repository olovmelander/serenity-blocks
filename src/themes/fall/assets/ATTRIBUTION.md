# Fall — asset attribution

Every file in this folder is a project-owned original, authored procedurally in
Blender 4.5.9 LTS on 2026-10-05 for this repository by
`scripts/blender/fall_grove_assets.py` (helpers in `scripts/blender/fall_grove/`), except
`squirrel.glb`, authored in Blender 5.2 LTS on 2026-10-26 by `scripts/blender/fall_squirrel.py`
(below). None contains third-party geometry, texture, scan, photograph, motion capture or generative-model
output, and neither generator fetches anything from the network. Licence: the same as the
project (MIT, project-local).

`asset-manifest.json` records each file's size and SHA-256; `tests/unit/fall-assets.test.js`
checks the files against it.

| File | What it is |
| --- | --- |
| `maple-hero.glb`, `oak-hero.glb` | The two foreground trees: buttressed trunks with roots, limbs, branches and twigs as one bark mesh, plus the foliage sites. |
| `maple-grove-a/b/c.glb`, `birch-grove-a/b.glb` | The grove trees of the middle distance. |
| `fall-foliage.glb` | The shared leaf geometry: maple and oak sprays, maple clumps, weeping birch strands (two variants each) and single leaves for the litter and the leaves in the air. |
| `fall-impostors.png` | Front elevations of the five grove trees for the distant forest. |
| `squirrel.glb` | The red squirrel: one skinned body on a 30-bone rig, eighteen clips (idle, sit, bound, hop, climb, descend, shuffle, cling, pivot, nibble, chatter, startle, look, dig, pat, scratch, groom, leap) and the acorn it nibbles, riding on its left hand. |

## How the squirrel is made

Made in Blender 5.2 by `scripts/blender/fall_squirrel.py` (modules in
`scripts/blender/fall_squirrel/`), then packed by `scripts/fall/pack-squirrel.mjs`:

- **Model** (`model.py`). A signed distance field of ellipsoids and round cones joined by
  smooth unions round the rig's own joints (the meshing of the Grainfields horse and Winter's
  bear, `scripts/blender/grainfields/horse_sdf.py`): haunches, belly, chest, a big round head
  with full cheeks, large eyes and a button nose, cupped ears with three-strand tufts, slim
  legs and long hind feet, and the body of a plume (a flattened tube through the tail joints,
  combed by a fine displacement; its hair is drawn over it at runtime as cards on the same
  bones, `src/themes/fall/fall-squirrel-plume.js`). The left half is polygonised with surface nets, decimated in two passes (body,
  legs and plume first with the face held, then the face with the rest held) and mirrored.
  Each vertex is painted: COLOR_0 = the coat's linear colour and the sky it sees (occlusion
  traced through the field), `_fur` = hair length, light through it, eye, and 1 on the ear
  tufts, a half on the plume.
- **Rig** (`rig.py`). Thirty bones, every one resting in the squirrel's own frame, weighted
  by inverse distance along each part's chain and relaxed over the surface.
- **Motion** (`motion.py`, `solver.py`). Each clip is a function of time: where the body is
  and how it bends, where each paw is put (two-bone IK with the knee or elbow in the plane a
  pole gives), how the head, ears, jaw and the seven-bone tail turn (on the bark the tail is
  laid along it at set heights, `solver.lay_tail`). They are sampled on every
  frame (60 fps) and keyed into one Blender action each, which the glTF exporter writes as one
  animation each. `audit.py` reads every clip for paws asked past their leg's reach, planted
  paws that slide and pops at loop seams.
- **Pack.** The slow standing loops (idle, sit, cling, look) halved to 30 fps; rotations as normalised 16-bit, a channel that never moves in a clip as one key,
  unused translation and scale channels dropped, colours, fur and weights as bytes, normals as
  normalised bytes (`KHR_mesh_quantization`); the clips' lengths, loops, speeds and
  marks (the leap's take-off and landing) in the asset's extras (held to `fall-squirrel-clips.js` by a test).

```bash
node scripts/fall/pack-squirrel.mjs        # runs Blender headless, packs, writes the asset and its manifest line
```

The same modules drive the design loop inside an open Blender through the Blender MCP
(`fall_squirrel/live.py`: a scene of their own, posed lineups, Workbench renders). The build
is deterministic: the same Blender and scripts give the same bytes.

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
