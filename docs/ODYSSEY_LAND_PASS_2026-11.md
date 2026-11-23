# Odyssey — the land, judged from the pixels and grown in Blender (2026-11-22)

Olov, after the sea pass: *"We just improved the water in odyssey mode, whats next to improve in
odyssey mode - maybe the grass and ground??"*, then *"Ground, grass and trees!"* and *"And we need
to use blender!"*

Chapters 3 and 4 (orbs 11-26) are where the land fills the frame: the shore, the meadows and the
forest at the massif's foot, the tarn, the slopes. This pass judged that land from real-game
pictures first, then rebuilt the broadleaves and the meadow in Blender and fixed what the pictures
showed on the ground.

![Before and after, crops of the real game at 1920 x 1080 (WebGPU, High, the same board clock):
the shore forest (orb 15), the horses' meadow (orb 17), the tarn (orb 19)](images/odyssey-land-2026-11-22/before-after.jpg)

## How it was judged

- **The pictures.** The real game in a headless browser on a software GPU (a cloud container: the
  browser runs headed under a virtual display, gotcha #1208, with the dev server's reload socket
  stubbed, #1209), 1920 x 1080, WebGPU at High, adaptive quality off, the board clock pinned
  (`t = 40`), each orb reached by its own selection flow (orbs 11-26: the close-up the player sees
  on selecting it). The six rail and climb views of the first batch were void (the camera stayed in
  orb 26's close-up); the harness now hands the camera back to the rail as a wheel does.
- **Three critics** judged the 16 orb frames only, with no docs and no code: the ground and grass,
  the trees and forest, and a landscape painter's eye on the land as a whole. **A sceptic** then
  tried to refute each merged finding from the same frames. Only after that were causes traced in
  code.

## The audit

Merged from the three critics (severity 1-5, the highest any critic gave), with the sceptic's
verdict and its own severity:

| # | Finding | Sev | Verdict |
|---|---|---|---|
| F1 | The lowland meadows are dark billiard-table felt: one saturated dark green (sunlit lawn ~RGB 28-42, 56-71, 14-26), darker than the leaves of the trees on it; no tufts, flowers or patches | 5 | CONFIRMED (3): open lawn luminance 41-73 against 120-144 for the lit crowns on it, 100-px patches varying by 6-7; "no tonal patches" overstated |
| F2 | Nothing grows on the ground: no flowers, no long grass at trunks, no litter under autumn trees, trunks end on bare turf | 4 | CONFIRMED (3): no flowers, long grass, shrubs or litter in L15-L22; no contact darkening at a trunk base (40-51 against 34-53 a crown away) |
| F3 | Every stand is an even scatter, about a crown apart: an orchard or a plantation, not a forest | 4 | WEAKENED (2): uniform density and no clearings (parkland), but no rows or grid; a spacing test came out between random and clumped |
| F4 | Clone trees: one design a kind (a short trunk forking into straight sticks under flat pads), one age, one height | 3 | WEAKENED (2): one silhouette a kind is true; heights vary ~1.5-3x and the canopy line is not level |
| F5 | The tarn is ringed by a grey kerb of one width: a concrete garden pond | 4 | CONFIRMED (3): a neutral grey rim (96, 93, 96) 10-17 px wide at every far-shore probe, round the islet too |
| F6 | The lower slopes wear a lilac-grey camouflage print smeared down the fall line | 4 | CONFIRMED (3): lilac on 31-40 % of the flank in L24-L26, blotches ~100-125 px stretched 2.3:1 along the fall line |
| F7 | The mountain is combed into near-even contour ledges: a layer cake | 4 | CONFIRMED, milder (2): 13 dark ledges 9-16 px apart down the L16 face; could pass as terracing |
| F8 | In the slope frames the nearest ground is the blurriest, streaked down the slope | 3 | WEAKENED (2): the nearest ground has ~20 % less fine detail in L25-L26, not in L23 |
| F9 | Conifers stand on long bare trunks under their tiers: trees on stilts | 2 | WEAKENED (1): the bare trunk is 16-26 % of the height, normal for a pine; the saturated red makes it stand out |
| F10 | The beach is a two-tone ribbon of one width with a torn-paper grass edge | 3 | WEAKENED (2): the width varies ~18 % and the fringe reads as painted; the monotony (no coves, no rocks) holds |
| F11 | Blossom trees climb the bare rock of the massif in rows along the contours | 3 | WEAKENED (2): the contour rows are real in L11-L13; the "bare rock" is haze over grey-green grass |
| F12 | On the conifer slopes, parallel dark bands cross the ground that no tree casts | 3 | WEAKENED (2): long low-sun tree shadows (1.4-2.2x stronger where the conifers stand), but crowns inside the bands are as bright as crowns in sun |
| F13 | Depth runs backwards: the summit has more contrast than the hazy middle ground | 3 | WEAKENED (2): the inversion is real (2.0-2.2x in L14 and L17) and reads as low mist under a clear peak |

What all three said must not be lost: the painterly leaf-cluster crowns (lit tops, shaded
undersides, the range of greens), the aerial perspective on the far conifer slopes, and the warm
low-sun light raking across the slopes in the evening frames.

## What changed

### §1. The broadleaves, grown in Blender (F4, F9 in part)

`scripts/blender/odyssey/odyssey_trees.py` grows the four broadleaf species (the shore broadleaf,
the gold birch, the red maple, the blossom tree) three specimens each, with the repo's own Blender
branching library (`scripts/blender/fall_grove`): a trunk that leans and recovers, scaffold limbs
leaving it at their own heights and angles (or up a leader, for the birch), branches off each limb.
The foliage gathers where the branches end: their ends are clustered into 9-12 masses a tree, each
a little outside the wood that carries it, so every tree has its own number, size and placing of
masses, with sky and limbs between them, and the crown comes further down the trunk (an open-grown
broadleaf keeps its lower limbs: the crown starts at ~0.2 of the height, where the code-built crown
started at ~0.48).

The output is the forest's own vertex contract, unchanged (FOREST_LEAF_CARD): each mass is dressed
the way the code-built crown dresses a puff (four cards round its outer side and one on its top at
the hero tier, one card a mass at mid, five merged masses at far), the card normals are the crown
ellipsoid's, and the bark is tubes along the grown limbs, CCW-outward. So the forest's material,
light and wind read a grown crown exactly as they read a puffed one, and every forest test holds.
Blender's part beyond the modelling: each specimen is built as a Blender mesh and ray-cast
(mathutils BVH) for the sky each card and each bark vertex sees, which shades the inner masses and
the wood under the crown; `--preview` renders the roster with Cycles.

The specimens ship as a JS module of base64 typed arrays (`world/odyssey-forest-models.js`, 96 KB,
indexed bark; decoded by `world/odyssey-forest-models-decode.js`), the birds' pattern: no loader,
deterministic (the script writes the same bytes again). They stand as tall and as wide as the
species table says (the shade plate, the culling radii and the scatter all hold), inside the tier
budgets (hero 318-494 triangles of 560, mid 58-68 of 90, far 10 of 24). The world picks one of the
three specimens a bucket, as it picked one of three seeds before. The code-built crowns stay one
flag away (ADR-0015): `?odysseyWorldProceduralTrees=1` in the game, `?trees=procedural` on the
audition board.

![The grown broadleaves in Blender (Cycles preview, spheres standing in for the leaf cards): the
shore broadleaf, the gold birch, the red maple and the blossom tree, three specimens each](images/odyssey-land-2026-11-22/blender-trees.jpg)

The conifers stay code-built; their crowns now come down the trunk (F9): the pine's bare trunk 1.00
-> 0.55 and the fir's 0.92 -> 0.50 tree units, the crown longer by as much, the same total height.

### §2. The meadow, modelled and photographed in Blender (F1, F2)

`scripts/blender/odyssey/odyssey_meadow.py` models a square of turf 16 m a side: Poisson-spaced
tussocks of curved, tapering blades leaning out from their crowns, seed stalks, and clumps of four
flowers held above the blades (buttercup, ox-eye daisy, red clover, harebell), every object near an
edge repeated a tile over so it tiles. Cycles photographs it from straight above twice: the turf
white over dark soil under an even sky (so the value is the sky each point sees: bright tips, dark
hollows, no sun direction baked in), and each flower in its own key colour on black, the blades
opaque. The result is one 256 x 256 RGB PNG (69 KB, `assets/ground/meadow.png`): R the turf, G
flower coverage, B which flower.

![The bake: the turf's value (left) and, painted as the game paints it, the turf with its four
flowers (right); 256 x 256, tiling](images/odyssey-land-2026-11-22/blender-meadow.jpg)

In the ground shader (`MEADOW` in `world/odyssey-world-renderer.js`), on grass and off steep ground:

- **The turf**: the photograph's value over the painted colour by the mean-transparent ratio the
  ground atlas already uses (`R / mean`), so it adds texture and never shifts the paint. Mipmapped,
  so it melts to its mean with distance by itself.
- **The light**: the chapter 3-4 meadows are lifted and warmed, a touch less saturated (`lift`), so
  sunlit grass is no longer darker than the leaves on it; three soft tones in patches ~120 u across
  (a lusher blue-green, a fresh yellow-green, a sun-dried olive), as the north plain already had.
- **Flowers in drifts**: the photograph's clumps show only in patches (two noises, ~95 u), never in
  deep forest shade, each patch its own flower (a species field ~140 u across), authored paler than
  the screen result for the world's output contract.
- **Wind you can see**: bands of bent, paler grass run across the meadow with the one wind's
  heading, ~26 u apart at 9 u/s, their phase bent by a bounded noise (gotcha #251), only while a
  gust is up (the front's envelope); where a band lies the turf flattens and lightens.

The texture loads a moment after the world is built (`fetch` + `createImageBitmap`, no colour
conversion); until then three binds its placeholder and `uMeadowOn` holds the ground as it was. No
browser (the unit tests build this world in node): no fetch.

### §3. Under the trees (F2)

From the forest's cover plate (`forestShade.g`, already sampled): the litter of the crowns' own
leaves in their mean colour, dimmed (`litter`, `litterTone`), and deeper, rougher turf round the
trunks (`rough`), so a stand has a floor and an autumn tree its ring of fallen leaves. No fetch.

### §4. The tarn's bank (F5)

The tarn's shore already alternated gravel beach with turf down to the water; the beach stretches
won too often and ran too wide, so the bank read as one kerb. They are now rarer (`beachSplit`
0.45-0.55 -> 0.62-0.70), narrower (`beach` reach 3.0 -> 1.7 u) and shorter (`beachCell` 21 -> 13 u):
most of the shore is turf to the water, and the shelf under it is the bank's dark peat.

## Checks and cost

- **The real game**, WebGPU at High, the same board clock as the audit: orbs 13, 15, 17, 19, 21, 23
  and 25 and two climb views after; orb 17 on the WebGL2 backend (`forceWebGL=1`); orb 15 on Low.
  The world builds on all three; no WebGPU validation error and no TSL warning in any console.
- **Tests**: the forest suite (30, two new: every broadleaf drawn from a grown specimen in the card
  contract, three a species; the code-built crowns still sound), the world, water, ocean and day-turn
  suites (439), the URL-parameter catalog (the new flag is listed), and the full unit suite
  (28,156 of 28,161 pass: the two that failed while the captures held every core were timing
  guards in untouched code, the Rainbark bake and the cloud field's bake budget, and pass on an idle
  machine).
- **Gates**: no new lint error in the changed files, the IP-string gate and the architecture fitness
  check pass, the TSL skill's audit is clean (two new capture gotchas, #1208 and #1209, in both copies).
- **Determinism**: the tree generator writes `odyssey-forest-models.js` byte for byte again; the
  meadow bake is seeded (scene and renders).

**Cost, not measured on a GPU** (this session had none; ADR-0016), so these are what changed, not
timings, and the first thing to measure on the integrated-GPU lane:

- The ground's fragment stack: one more texture read (the meadow, a mipmapped 256 x 256 RGBA8 on
  the root path) and five value-noise reads plus ALU for the tones, the drifts and the wind's bands.
- The forest: a hero broadleaf is 318-494 triangles (the code-built one 270) with 45-55 leaf cards
  (30), a mid one 58-68 (52) with 7-11 cards (10), a far one unchanged (10). The leafy pass measured
  30 cards a hero crown at +0.2 ms at the forest station on the dev GPU (overdraw), so the hero tier
  is where to look; `?odysseyWorldProceduralTrees=1` is the A/B.
- Memory and download: +96 KB of JS in the world's chunk (the specimens), +69 KB PNG (the meadow,
  ~350 KB on the GPU with its mips).
- The pale ovals now seen in the tarn's shallows at orb 21 are the few gravel stretches the bank
  keeps, seen through the water: shorter stretches, so the shelf shows as patches, not a ring.

## Left from the audit

- **F3, the even scatter** (the biggest one left): groves of 3-12 trees with closed canopies and real
  clearings between them, density thickening in hollows, a skirt of young trees and shrubs at the
  edges. The scatter's jittered grid was chosen on purpose against random clumps; this needs the
  scatter, the shade plate, the visibility stamp and their goldens moved together.
- **F6-F8, the slopes and the massif**: the rock-grass breakup at the lower slopes (larger, fewer
  rock masses with lit and shaded faces instead of the lilac blotches), the contour-ledge motif on
  the cone (buttresses, gullies and scree), and the streaks on the nearest slope ground.
- **F10** the beach's torn-paper edge, **F11** blossom on the bare rock, **F12** the conifer slopes'
  shadow bands, **F13** the summit's contrast, the conifers' frosted tops (no snow on the ground
  there), boulders without contact (grass and a dark line at their base).
- The conifers grown in Blender too (the generator's species table takes them once the needle-card
  dressing is written for a grown skeleton).

## Tools

Scratch tools of the session (recipes, not files in the repo):

- **The land capture**: Playwright, `headless: false` under `xvfb-run`, the SwiftShader flags of
  gotcha #1208; a save seeded with `odysseyState.completeLevel` for orbs 1-40; per orb
  `boardController.travelToLevel(id, { travelDuration: 0, focusDuration: 0 })`; the board clock set
  with `board.time = t`; frames counted on `requestAnimationFrame`, not time (a frame takes ~0.5 s
  at 1080p); every element but the board canvas hidden; Vite's reload socket stubbed (#1209).
- **The critics**: one brief (what the game is, the frames, judge only the pictures, crop at 100 %,
  findings with frame, region, severity, confidence and what fixed looks like), three lenses, then a
  sceptic over the merged list.
