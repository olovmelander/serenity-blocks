# Forest — asset attribution

Every file in this folder is a project-owned original, authored procedurally in
Blender 4.5.9 LTS on 2026-10-08 for this repository by
`scripts/blender/forest_assets.py` (helpers in `scripts/blender/forest_night/`, built on
the Fall grove's branching library in `scripts/blender/fall_grove/` and the Golden
Forest's conifers in `scripts/blender/golden_forest/`).
It contains no third-party geometry, texture, scan, photograph or generative-model
output, and the generator fetches nothing from the network. Licence: the same as the
project (MIT, project-local).

`asset-manifest.json` records each file's size and SHA-256;
`tests/unit/forest-assets.test.js` checks the files against it.

| File | What it is |
| --- | --- |
| `spruce-elder.glb`, `pine-elder.glb` | The two framing trees (role `hero`), grown to be met from eye height: a 36 m Norway spruce with a root plate and a few long boughs hanging at 3 to 7 m, and a 27 m Scots pine, bare to a high crown. |
| `spruce-old-a/b/c.glb` | Old spruces for the far side of the glade (role `grove`): tall and narrow with a high crown, mid-crowned, and skirted. |
| `spruce-young-a/b.glb` | Understory spruces, 9 m and 5 m, clothed to the ground. |
| `pine-old-a.glb` | A 25 m Scots pine. |
| `birch-a/b.glb` | Silver birches, 17.5 m and 16 m: a slender white stem that leans and recovers, weeping twigs. |
| `forest-foliage.glb` | The shared foliage geometry: spruce bough sections and pine clumps (a near and a far level of detail each), a birch leaf strand, and a fern frond (near and far). Two variants of every kind. |
| `forest-props.glb` | A fallen spruce trunk, its stump, three boulders and a standing dead spruce. |
| `forest-impostors.png` | Front elevations of the eight grove trees for the far stand. |

## Trees

A tree file holds two meshes and no foliage: `bark`, and `sites`, a point cloud saying
where each spray attaches. Y is up, the units are metres and the trunk stands on the
origin. The scene's root `extras` carry `schemaVersion` (1), `name`, `species`
(`spruce`, `pine`, `birch`), `role`, `foliage` (the spray kind its sites wear), `height`,
`trunkRadius`, `crownBase`, `scaleRange`, `sites`, `barkTriangles`, `barkCoreIndices`,
`crownCentre`, `crownRadii`, `boundsMin` and `boundsMax`.

- **Growth** (`forest_night/trees.py`). Each specimen is grown from its own seed. The
  spruce is the Golden Forest spruce generalised: trunk girth and taper, whorl spacing,
  a thinned zone of long low boughs that carry side branchlets, dead stubs on the bare
  trunk, a weather side. The pines are the Golden Forest recipe with new seeds; the
  elder's roots are replaced. The birch is the Fall grove's birch with a set lean and
  hanging twigs. An elder's surface roots leave the trunk as ridges, snake over the
  ground half buried, fork, and go under near their ends.
- **Bark mesh** (`forest_night/bark.py`). Tapered tubes with a flared, lobed base. In the
  index buffer the trunk and roots come first and the limbs last; `barkCoreIndices` is
  where the limbs start, so a low tier can stop drawing there. An elder's trunk has
  24 sides and a ring about every 12 cm through the root flare. UVs tile a bark sheet
  twice as tall as it is wide, about 1.15 m across, with square texels along every limb.
- **Bark vertex colour.** R = how far the wind may carry the vertex (0 at the foot,
  rising along the trunk and out along each limb). G = the limb's phase (one random
  value per limb). B = ambient occlusion: a Cycles bake of the whole tree on a ground
  plane with its crown in place, stored as 0.12 + 0.88 x AO. A = a species mask:
  - spruce: moss and lichen cover. The Golden Forest's lichen mask (the shaded +Z side,
    thinning with height) scaled by 1.5 on the elder and 1.15 on the old spruces, plus a
    patchy moss sock on the lowest two metres of the trunk and on the tops of the roots.
  - pine: 0 on the grey plated bark of the lower trunk, rising to 1 on the thin orange
    bark of the upper trunk and limbs (the Golden Forest mask, unchanged).
  - birch: 1 on dark bark, 0 on white bark. Dark is the rough black foot (the lowest
    metre or so), a chevron scar under every limb and under ten shed ones lower on the
    stem, faint lenticel streaks, and bark that browns as a stem thins below about 5 cm
    in radius, so the twigs and the top of the leader are dark.
- **Foliage sites.** `POSITION`; `_ROT`, a unit quaternion (x, y, z, w) that carries spray
  space into the tree; `_PARAMS` = (scale / `scaleRange`, sky visibility, wind sway,
  phase); `_BENT` = (bent normal x, y, z, hue x 2 - 1); `_KIND` = (spray variant, branch
  level, 0, 0). A spruce site near the ground is always variant 1, the short curtain.

## Foliage

All of it is real geometry, not alpha cards, and all of it is authored in the same
**spray space**: the attachment point is the origin, **+Y runs forward** along the twig,
**+Z is the lit upper side** and +X is across. A spray is about one unit long; a site's
scale sizes it. Mesh names are `<kind>_<variant>`.

- `spruce_frond`, `spruce_bough`, `pine_tuft`, `pine_clump`: the Golden Forest needle
  builders with new seeds. For the spruce kinds variant 0 hangs a long curtain and
  variant 1 a short one. `birch_strand`: the Fall grove's weeping strand with sixteen
  leaves; it falls away toward -Z.
  Vertex colour: R = distance from the shoot or from the leaf base (0 on the twig, 1 at
  the tips: the flutter weight). G = a random id per shoot or per leaf. B = shade inside
  the spray. A = 1 on needles and leaves, 0 on wood. UVs lie in the unit square.
- `fern_frond_0` (371 triangles) and `fern_frond_1` (161): one lady-fern frond each,
  the first for near ground, the second for the far ground. The stalk leaves the origin
  along +Y with the blade's upper face toward +Z, arches over toward -Z (about 40 degrees
  by four fifths of its length) and curls under over the rest, so the tip points down and
  back. It is one unit of arc long: the mesh spans about 0.82 along Y, 0.36 across X and
  0.4 down -Z; the leaflets start 0.13 up the stalk and are longest a third of the way
  along. To plant a clump,
  pitch each frond's +Y up from the ground by 50 to 75 degrees with +Z turned in toward
  the plant's centre, and turn the fronds about the vertical.
  Vertex colour: R = how far along the frond the vertex is attached, 0 at the base to 1
  at the tip (a leaflet takes the value of the point where it joins the stalk): the
  sway weight. G = a random id per leaflet, 0 on the stalk. B = shade: darker toward the
  stalk and toward the base, 0.3 to 0.5 on the stalk itself. A = 1 on the blade, 0 on the
  stalk. UV is the frond pressed flat at one scale: u across it (0.5 on the stalk), v
  along it (0 at the base, 1 at the tip). The blade is a single layer whose normals face
  the upper side: draw it double-sided.

## Props

`forest-props.glb` (`forest_night/props.py`), each mesh in metres with y = 0 the ground
it is set on:

| Mesh | Origin and size |
| --- | --- |
| `log` | Lies along X with its middle on the origin: 7.4 m long, 0.42 m in radius near the torn butt at -X (a little more at the break itself) tapering to 0.27 m at +X, bedded about a third of its radius into the ground, six limb stubs on its upper sides. |
| `stump` | Stands on the origin: 0.52 m of trunk under a splintered top that reaches 0.88 m, 0.42 m in radius above the flare, roots running out as far as 1.7 m. |
| `boulder_a`, `boulder_b`, `boulder_c` | Centred on the origin and bedded: about 2.5 m, 1.7 m and 1.0 m across, standing 1.0 m, 0.6 m and 0.34 m above the ground. |
| `snag` | A dead spruce standing on the origin, 11.3 m to its snapped top, leaning a little toward +X. |

Vertex colour, the same four jobs as the Golden Forest props: R = tone. On wood, dark
bark is low (0.28 to 0.5), weathered wood in the middle and torn heartwood high (0.78
to 0.9); on stone a broad light and dark mottle. G = a per-part id (the log's trunk is
0.12, the stump's 0.1, every stub, root and torn end has its own); on stone a fine grain
noise; on the snag the limb's id. B = ambient occlusion, a Cycles bake with the prop on
a ground plane, stored as 0.1 + 0.9 x AO. A = moss: strong in patches on whatever faces
the sky, nothing underneath, next to nothing on torn wood; on the snag it is the Golden
Forest's lichen mask instead. UVs tile the bark sheet on the tubes and are a flat
projection in bark-sheet units on torn wood; the boulders carry none (all zero).

## Sprite sheet

`forest-impostors.png` is baked by the Fall grove's impostor bake, as the Golden Forest's
is: a Cycles orthographic front elevation of each grove tree with an emission material
that stores data instead of colour. R = shade (on foliage, sky visibility times the
spray's own shade; on bark, 0.25 + 0.5 x occlusion). G = foliage mask (1 on needles and
leaves, 0 on wood). B = hue seed on foliage; on the bark mesh 0.5 + 0.5 x the bark's
alpha mask, so a birch's white stem reads 0.5 and its scars toward 1. A = coverage.
Colour is bled into the transparent texels. The tiles stand side by side, all 384 px
tall (the Fall and Golden Forest sheets are 448 px; this one carries eight trees); the
manifest's impostor record gives `atlasWidth`, `atlasHeight` and for each tile its `x`
and width in `pixels`, its `width` and `height` in metres and `trunk`, where the trunk
stands as a fraction of the tile width from the tile's centre.

## Format

GLBs are written by the generator itself (`fall_grove/glb.py`), not by Blender's exporter:
positions are normalised 16-bit integers restored by the node's scale and translation,
normals and colours are 8-bit (`KHR_mesh_quantization`). There are no materials, textures
or animations in the files.

## Regenerating

```bash
blender --background --factory-startup --python scripts/blender/forest_assets.py -- \
    --out src/themes/forest/assets [--only trees,foliage,impostors,props] \
    [--recipes spruce-elder,birch-a] [--preview <dir>] [--no-bake] [--scratch <dir>]
```

`--factory-startup` keeps the run independent of any Blender session that is open.
Growth is seeded and the bakes run on the CPU with fixed sample counts: two runs on the
authoring machine wrote byte-identical files. Re-run the tests after regenerating. The
whole pack takes about half a minute; `--preview` adds daylight renders of every tree,
spray and prop (never written into this folder) and about a minute and a half.
