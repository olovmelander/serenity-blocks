# Sakura Twilight — asset attribution

Every file in this folder except `Fox.glb` and `sakura-fox.glb` is a project-owned original, authored
procedurally in Blender 4.5.9 LTS on 2026-10-05 for this repository by
`scripts/blender/sakura_twilight_assets.py` (helpers in `scripts/blender/sakura_grove/`,
growth, wood and GLB writing shared with `scripts/blender/fall_grove/`). Those files
contain no third-party geometry, texture, scan, photograph or generative-model output,
and the generator fetches nothing from the network. Licence: the same as the project
(MIT, project-local).

`Fox.glb` is the Khronos glTF sample fox — model by PixelMannen, rig by @tomkranis, glTF
conversion by @AsoboStudio and @scurest, CC-BY 4.0 — and is credited in the repository's
`CREDITS.md`. It is kept exactly as published and is no longer loaded by the theme: it is
the source of `sakura-fox.glb`.

`sakura-fox.glb` is that fox, **modified** (2026-10-09) by `node scripts/sakura/rig-fox.mjs`,
in this repository: its mesh welded and subdivided twice (576 triangles to 9,216) so that a
coat of fur has a rounded body to stand on, rescaled from centimetres to metres and given
smooth normals; its skeleton replaced by axis-aligned bones standing at the original joints
(the table in `src/themes/sakura-twilight/sakura-fox-rig.js`: the theme animates them
itself, `../shared/fox-rig.js`); its skin weights carried over and renamed; its three baked
clips left out; four numbers a vertex added as its colour (how far along the tail it is, how
long its fur is there, how much of the sky it sees — an occlusion bake). Its texture is the
original's, unchanged. The same licence and credit apply (CC-BY 4.0, as above). The script
is deterministic: `--check` compares a fresh rig with the file and `--preview=<dir>` draws
mesh, skin and coat on the CPU.

Neither fox file is listed in the manifest, because the Blender generator does not write them.

`asset-manifest.json` records each generated file's size and SHA-256;
`tests/unit/sakura-assets.test.js` checks the files against it.

| File | What it is |
| --- | --- |
| `sakura-hero-weeping.glb`, `sakura-hero-spreading.glb` | The two old trees by the camera: a weeping cherry whose shoots hang to the ground, and a spreading cherry with one long bough over the water. Bark mesh plus blossom sites. |
| `sakura-grove-a/b/c.glb`, `sakura-grove-weeping.glb` | The cherries of the two wooded points and the islet. |
| `sakura-blossoms.glb` | The shared blossom geometry: flowering twigs, hanging garlands and pom-pom clumps (two variants each), a single petal for the air, a far petal, and a whole flower. |
| `sakura-props.glb` | Garden furniture: a Kasuga stone lantern, a low snow-viewing lantern, a paper lantern, a torii, a drum bridge, a five-storied pagoda, three boulders, a floating lantern and a sky lantern. |
| `sakura-fuji.glb` | The mountain: a unit-high cone with eroded gullies; vertex colour stores snow, relief shade and height. |
| `sakura-impostors.png` | Front elevations of the four grove trees for the far shore. |

## How they are made

- **Trees.** Grown from a seed by the Fall grove's branching model. The recipes in
  `sakura_grove/species.py` say what a cherry is: a short, leaning, low-forking bole
  under a broad parasol whose scaffold limbs are each steered to their own place, or
  arching ribs from which pendulous shoots give in to their weight and hang.
- **Bark and sites.** As in the Fall grove: one bark mesh per tree whose vertex colour
  carries wind response, limb phase, a Cycles-baked ambient occlusion and moss cover,
  and a point cloud of blossom sites (position, orientation, size, wind response, sky
  visibility, bent normal). The runtime instances the shared sprays onto the sites.
- **Blossom.** Real geometry, no alpha cards: five notched, cupped petals to a flower.
  Vertex colour: R = distance along the petal from the flower's heart, G = a per-flower
  id, B = shade inside the spray, A = petal (1) or wood (0).
- **Furniture.** Modelled directly as arrays (lathes, convex solids, swept sections).
  Vertex colour is the surface colour with a Cycles-baked occlusion in alpha; the UVs
  mark lit paper (x) and the height inside it (y), so the runtime can seat a flame low
  in every lantern. Paper is left unoccluded: it is lit from inside.
- **Sprite sheet.** A Cycles orthographic render of each grove tree with an emission
  material that stores data instead of colour: R = shade, G = blossom mask, B = hue
  seed, A = coverage. Each tile is as wide as its crown; the manifest records the
  tile rectangles and where the trunk stands.

## Format

GLBs are written by `fall_grove/glb.py`, not by Blender's exporter: positions are
normalised 16-bit integers restored by the node's scale and translation, normals and
colours are 8-bit (`KHR_mesh_quantization`). There are no materials, textures or
animations in the generated files; the theme owns every material.

## Regenerating

```bash
blender --background --factory-startup --python scripts/blender/sakura_twilight_assets.py -- \
    --out src/themes/sakura-twilight/assets [--only trees,blossoms,props,fuji,impostors] \
    [--recipes sakura-grove-a,...] [--preview <dir>] [--no-bake]
```

`--factory-startup` keeps the run independent of any Blender session that is open.
Growth is seeded, so the GLBs are reproducible; re-run the tests after regenerating.
