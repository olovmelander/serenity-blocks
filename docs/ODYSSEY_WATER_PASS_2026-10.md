# Odyssey Act II — the sea and the tarn made one water, then stunning (2026-10-31)

Olov, after the Act II passes: *"the water in the pond looks totally different than the water in
the ocean!"*, then *"I think we can improve the water in the pond and in the sea to become a
visually stunning masterpiece ... reflective and alive and that really fits into the atmosphere
with the correct colors, reflectiveness and movement and waves and foam and everything."*

Earlier water work this builds on: the painted-water waves (the painted sea, the swell, the shore
foam, the underside) in `world/odyssey-world-renderer.js`, and the tarn of
[ODYSSEY_ACT2_STUNNING_2026-10.md](ODYSSEY_ACT2_STUNNING_2026-10.md) §6.

## The audit

Live stations on the rail at 30 fps: the shore (p 0.15-0.19) and the tarn (p 0.246-0.30).

1. **Two waters.** The sea wore the colour script's pigment ramp (viridian, cerulean, cobalt,
   Prussian), a stepped wash of sky and sun glints. The tarn had a palette of its own, murky green
   over near-black, under a grey mirror: from the rail it read as a dark puddle beside a bright sea.
2. **A milky sea.** From every Act II station the visible sea sat in the ramp's pale upper plates
   (the measured 0.02 a metre absorption needs ~50 m to reach cerulean), so it read as pale aqua.
3. **Paper foam.** The whitecaps were flat white blobs, the size of a boat, laid on the sea.
4. **Nothing in the water.** Neither water reflects a cloud, an island or the massif: the sea shows
   a gradient of sky, the tarn the sky and the hillside under it.
5. **Still.** No wind moves over either water: the swell rolls under a fixed ripple, the tarn
   shivers in place, and the surf never breaks.

## The plan

1. **One water.** The tarn painted from the sea's own terms; the sea bluer, the foam lacier,
   light on the shallows. *Done (§1).*
2. **Clouds in the water.** Both waters mirror the cloud field. *Done (§2).*
3. **The world in the sea.** The shore, the hills and the massif mirrored in the sea. *Done (§3).*
4. **Wind and life.** Gusts that sweep both waters, rings on the tarn. *Done (§4); breaking sets
   left for later (the beach shelves too steeply for a surf zone that reads).*
5. **Foam.** Streaks along the wind. *Done (§5).*

![The whole pass, before and after: the tarn, the sea from the shore orbs, the sea along the shore](images/odyssey-water-2026-10-31/water-pass.jpg)

## §1. One water (2026-10-31)

**Shared terms.** The sea's pigment ramp, its stepped sky wash, its fresnel, its sun (a hairline
core and a broad road), its glitter and its two scrolling ripple fetches are now functions
(`waterRampBody`, `waterSkyWash`, `waterFresnel`, `waterSunCore`, `waterSunRoad`, `waterSparkle`,
`waterRippleTex`), and both waters call them. The sea renders exactly as before through them
(checked by a same-station capture).

**The tarn** takes them with three pond settings (`TARN_MIRROR`): `absorb` drives the ramp by the
pond's own 3 u of depth (viridian over the bank to cobalt in the middle), `calm` takes a third of
the sea's ripple slope, and `fresnel` keeps the sea's gain with a higher floor (0.38), because a
sheltered pond mirrors more than a sea under wind. Its land mirror (the march over the height
plates) is kept; where a ray runs into open sky it takes the sea's sky wash. The pale lip is the
sea's shore band scaled to a pond.

**The sea:**

- **Bluer** (`SEA_ABSORB_GAIN` 1.6 on the script's absorption): the same depths now reach
  cerulean and cobalt.
- **Sunlit shallows.** The underside's caustic net (two crossing iso-lines of the ripple fetches)
  seen from above through the body, out to ~24 m of depth and 320 u of range. The beach shelves
  steeply, so it shows as a lit band along the shore.
- **Lacier caps.** The break-up leans on the finer ripple field, the threshold sits higher and
  the lace cuts deeper holes, so a cap is broken foam rather than a white blob.

![Before and after: the tarn, the sea from the shore orbs, the sea along the shore](images/odyssey-water-2026-10-31/one-water.jpg)

## §2. Clouds in the water (2026-10-31)

`world/odyssey-water-clouds.js`. A planar `reflector()` mirrors one plane (the sea and the tarn
stand 293 u apart) and adds a pass whose pipelines must be warmed before the reveal, so instead
each water traces its own reflected ray against proxies of the cloud field:

- **The proxies.** An ellipsoid per mass, fitted to its lobes from the sculptor's own layout
  (`buildCloudLobes`) and grown until every lobe centre lies inside, with the base in its unit
  frame. Each drifts on the field's own Lissajous (the vertex stage's `cfDrift`, same seed and
  constants; the banner holds to the summit), so a reflection moves with its cloud.
- **The pick.** Each frame the CPU keeps the masses whose mirror image (over the sea's plane or the
  tarn's) is in the camera's frustum, largest on screen first, up to `WATER_CLOUD_SLOTS` (12),
  three `vec4` rows each in a `uniformArray`.
- **The trace** (`waterCloudsAlong`). The ray's closest approach to each centre, in the mass's unit
  frame, says how far inside the outline it passes. The outline is broken into lobes by three sines,
  cut flat at the base, lit from the crown (sunlit white) to the base (a cool under tone), and hazed
  by the run like the field. A ray that misses every mass keeps the water's own sky.
- **High tier only** (`ODYSSEY_WORLD_QUALITY.waterReflections`): the low tier builds the sky wash
  alone.

## §3. The world in the sea (2026-10-31)

The tarn's land mirror became shared helpers (`waterMarchLand`, `waterLandLit`), and the sea
marches too (`SEA_MIRROR`): macro and relief plates (two fetches a step), 18 steps that grow
faster than the tarn's, stopped once a ray has climbed over every summit, only within 1000 u of
the eye. The land's colour gained a beach band just over the sea.

**Mirrored by the swell, not the chop.** Marched along the full rippled normal, neighbouring rays
went to the far shore and to the sky by turns: rows of dark dashes across the sea. The land is now
marched along a smoother normal (the swell and a third of the ripple), so the shore stands in the
water as wavy, coherent reflections that follow the swell, which also gives the near sea its form.

## §4. Wind on the water (2026-10-31)

- **Gusts** (`waterGust`). The water rides the land's own wind (`gustFront`, ONE WIND): where the
  front is up, drifting patches of rougher water sweep downwind over both waters (one fetch of the
  detail bake, ~400 u a tile, scrolling along +x/+z). A gust roughens the chop (sea 0.70-1.45x, tarn
  0.35-2.6x), lifts the glitter and lowers the mirror share, so cat's paws read darker, as they do.
- **Rings on the tarn** (`tarnRings`). Three slots, each on its own clock, born at a hashed point in
  one of the lobes, spreading at ~3.6 u/s and gone in ~6 s, drawn large because the eye is ~200 u
  off. A ring is a travelling ripple in the slope, so it lives in the reflection and the glints.
  At these ranges it is a quiet touch, not a feature.

## §5. Windrows (2026-10-31)

The foam a wind leaves on open water lies in long thin streaks along it: the detail bake's value
noise read in the wind's frame, drawn out 4:1 along it (the TSL notes: further, and it reads as
brushed metal), cut thin and soft, in water deeper than ~8 m only, stronger in a gust, gone by
~520 u. The first cut was a hairline and read as scratches; it is wider and fainter now.

## §6. Each water its own pigment (2026-10-31)

Olov: *"and is the color of the water and the type of water right for this scene and atmosphere?"*,
then *"Do what you think will be most beautiful water for this scene!"*

This is a cool northern island: a snowy horn, conifers, meadows. Its sea should be turquoise only
in the thin band over the sand and turn a deep teal-blue within a few metres, clear and cold, as
on the Lofoten or Fiordland coasts. The colour script's ramp (Act I's, unchanged) leaned tropical:
a wide band of bright aqua, the most saturated thing in every frame, a swimming pool beside a
snowfield. And the tarn under the horn is fed by its snow, so its colour is the vivid
turquoise of glacial flour (Moraine Lake), not the sea's.

- **`SEA_RAMP`**: the script's turquoise kept for the sand, then teal (0.10, 0.41, 0.50), a
  blue-green open sea and deep. `SEA_ABSORB_GAIN` 2.6, so the turquoise is the first few metres.
- **`TARN_RAMP`**: glacial turquoise from a pale jade over the bank to a deep teal-cyan in the
  middle, brighter and greener than the sea; the tarn's mirror floor eases to 0.30 so its colour
  shows. A first, milkier cut read as frosted mint: glacial lakes are vivid, not pale.
- Both keep the script's four plates and every other water term in common: the light, the
  reflections, the glints, the wind.

![Before (left) and after (right) the whole water pass: the tarn, the sea from the shore orbs, the sea along the shore](images/odyssey-water-2026-10-31/water-pass.jpg)

## Cost and checks

- Not yet timed at full speed: the owner keeps the GPU on capped 30 fps captures unless asked. The
  new work per sea pixel on the high tier: the cloud trace (up to 12 ellipsoids), the land march
  (up to 18 steps, two fetches each, near water only) and two fetches (gust, windrows). The tarn's
  pixels add the cloud trace and the rings to its existing march.
- The low tier keeps the sea's sky wash (no traces), with the gust and windrow fetches.
- Tests: `odyssey-water-clouds.test.js` (the fit covers every lobe, the drift is the field's, the
  pick is in view and largest first), the clipmap source test follows the shared ripple fetch.

## Still open

- **Breaking sets.** The beach shelves at ~0.6, so a surf zone is a few pixels from the rail.
  Sets of waves that break would need a wider shelf (a terrain change, with its golden re-pins).
- **The far sea** still dissolves into a pale horizon: the colour script's horizon convergence, an
  owner-approved rule.
- **The cloud looks** (`?odysseyCloudLook=light|banks`) are built and switchable; the first `light`
  paint was too subtle to choose from and wants another round before the owner sees them.

## §7. The tarn redrawn, and clear (2026-11-20)

Olov: *"Can we improve the looks of the pond! And can we also improve the look, feel and graphics
of the water, sea and ponds. The ponds needs to have a better shape also."*

### What was wrong with the tarn

Seen from the orbs that look at it (L18-L23, 100-270 u off, 60-110 u above it):

- **Three circles.** Three ellipses joined into a bean, with a noise inset on the rim: the lobes
  showed in the outline, and the depth's flat plates ran in rings round each of them.
- **A pool, not a tarn.** A bright jade pigment, nearly opaque, in four flat plates: the
  brightest, flattest thing in the frame. The mirror of the massif was there in the code but
  hardly showed through the pigment.
- **A dug crater.** The carve's wall is the same drop all the way round, and the sea's sand rules
  (height over the sea) painted the basin's floor round it tan: a ring of sand in the meadow.
- **Teeth.** The carve rode on the shared sculpt plate as a delta from the analytic ground, and
  the plates the shader rebuilds that ground from stand up to a unit off it (rms 0.3 u over the
  tarn's box): on a shelf sloping 1 in 10 the waterline moved by several units, in teeth along
  the ground's triangles.

### The new form

- **A drawn shore** (`ODYSSEY_TARN.outline`, odyssey-world-height.js): a closed curve through
  44 points, clockwise from the west end, moved a few units in and out by a low noise. A small
  west pool and a wider main water joined by a strait; one long point out from the north shore,
  with an islet off its tip; bays of different sizes on the south shore, none opposite another;
  the east end drawn out into an inlet.
- **A profile across it** (`odysseyTarnProfile`): under the water a shelf (wide on the flats, a
  thin line under a rising bank), a drop, and a floor that rolls 2.5-4 u deep; above it a low
  beach easing over 34 u into the meadow's own ground. The waterline is the drawn line itself.
- **Its own plate** (`ODYSSEY_TARN_PLATE`, `bakeTarnPlateData`): the tarn at ~0.6 u over its box,
  carried on the sculpt plate's bake record (one stage, one stored copy). The shader's height is
  `ground * (1 - w) + waterY * w + R`, so in the water it is the tarn's own to the half float's
  step, whatever the other plates draw; B is the distance to the waterline, A how flat the bank
  is. The sculpt plate is the summit's again (the redrawn bank had reached past its edge, where a
  clamped sampler would have smeared it north across the island).
- **One sheet** of water cut to the shore (odyssey-tarn-surface.js), not a disc a lobe.
- **The ground's lattice is seated** against the water: a vertex the plate puts under the water
  sits at least a share of its spacing under it, a dry one over it, so a triangle that spans the
  waterline crosses it near its dry end and the line the eye sees is the film's.

### The new look

- **Clear water** (`TARN_MIRROR.clarity`, `deep`): the bed shows through by its depth (the ground
  draws it, `TARN_BED`: pale gravel on the shelf off a beach, dark peat off a turf bank, silt and
  weed in the basins, seen through a water that takes red first), and the water's own deep
  colour stands where it does not. The mirror (the massif marched over the plates, the sky's
  plates, the clouds) lies over both by the Fresnel share, so the basins hold the mountain.
- **A soft waterline**: the film is clear at the line and full a few tenths of a unit in.
- **A real shore** (`TARN_SHORE`): a low noise picks stretches of grey gravel beach (out to
  ~3 u) and stretches where the turf comes down to the water; the meadow by the water is damp
  green; the wet margin darkens; the sea's height-driven sand is kept out of the tarn's box.
- **Stones** (`ODYSSEY_TARN_ROCKS`, odyssey-boulders.js): three on the islet, three at the
  point's tip, three in the shallows, half in the water.
- The ripple a little calmer (`calm` 0.35 to 0.27), no glitter field (the owner's rule), the
  swans' wakes whitening less (they read as a dotted line over the darker water).

### Tests

`odyssey-world-tarn.test.js` (rewritten: the waterline where the shore is drawn, one water round
an islet, basins 2.5-5.2 u deep and a shelf under 0.5 u, the plate exact and zero on its border,
the sheet over all the water), `odyssey-boulders.test.js` (the stones), `odyssey-water-shaders.test.js`
(the tarn and the ground build clean on both backends and tiers, no unassigned reads).

### The pond's neighbours, its life and its tests

- **The north shore** of the main water was drawn back toward the old waterline: the massif's foot
  stands 10-30 u over the water there, and a shore further north cut a steep wall into it.
- **The life at the pond** moved onto the new shore: the swans' loop (west pool, out through the
  strait's north lane, round the main water's west basin, back by its south lane; the strait was
  widened for it), the heron's spots in the new shallows and its first flight's curve, the
  drinkers' spot on the west shore. The tests measure in world units now (the tarn's normalized
  measure changed).
- **The authored framing trees** refuse only water now (`framingSiteWet`, odyssey-forest-scatter.js):
  the autumn pair's red maple north of the tarn stands again, and a gold birch the tarn's clearing
  had silently dropped since 2026-10-26 is back on its south-east shore. (Owner's call; drop the
  birch by moving its authored site if it is not wanted.)

## §8. The sea, near and far (2026-11-20)

Audited from the real game (shore orbs 11-16, the rail at p 0.15-0.19, the climb) by four
read-only auditors, each finding re-checked against the code by a sceptic before it was applied.

Near (the shore orbs):
- **Breakers, not blotches.** The caps were driven by the three waves' summed height alone, flat
  white patches 12-20 u across. A crest now breaks only where it crosses a rough patch of the
  coarse ripple (the mask raises the threshold, so every cap keeps its drawn lip), more of them in
  a gust; foam is lit (dimmed in the island's and the clouds' shadow).
- **Windrows on a course** (`SEA_WINDROWS`): long lines across the wind every 17 u, wandering,
  a constant width in pixels, kept off the near water. They were an iso-line of a noise: loops,
  scribbles and milky bands under the eye (gotchas #1302, #1319).
- **A fine chop under the eye** (High): a third, finer ripple where its cells span ~4 px or more;
  it tilts the mirror and lifts or sinks the body's facets by how they face the sun. The near sea
  read as glassy gel.
- **Jade only toward the sun**: the crests' transmitted jade keeps two fifths of itself looking
  away from the sun (the shore orbs), so the deep near sea is cobalt-teal, not milky green.
- **Clear shallows**: the sea's own shore colour (was the colour script's, brighter than the sand),
  the caustic net only within ~10 u of depth and ~150 u of range, the static shore band fainter.
- **Glitter only round the sun's road** (`waterSparkle` gated by the mirrored ray): the owner's
  rule for water.
- **The swell rolls in on the beach**: the long swell turned (it slid sideways along the shore and
  the sea heaved in place). The underwater ceiling keeps its mottled light (captured at p 0.10-0.135).

Far:
- **The sun road** a soft shoulder and a faint skirt round the hairline core, under the sun the
  player sees (the evening's): the old ~26-degree lobe bleached the whole sun side into milky
  smears (gotcha #1314). The topside core reads the settled normal.
- **The horizon dissolve** gathers over 3 km (was 1.7), to 60 %, toward the dome's own air at the
  sea line on that bearing: a band of blue open sea now lies between the near water and the haze.
- **The far ripple settled by the pixel's footprint**: past ~300 u a pixel took a new random tilt
  of the mip-less ripple every frame and the far sea crawled.
- **The water mirrors the dome's own air** (`waterSkyWash` through `skyAirAt`), all three waters.
- **The coast's white rim from the climb** gone (the static band fades with range; the swash
  front and the surf line carry the coast).
- **The cloud floor opens over the climb's coast** (`clear` 1500 to 2000 on the lee, a slower
  bed edge): it lay 0.95 opaque over the coast the climb looks down on. The far west keeps its
  floor (its tests are unchanged). Owner's call.

Left, from the audit: the north lake's redraw (a drawn shore on its own plate, with the tarn's
clear water and shore; the outline is designed and checked in node, see the session's lab), its
pale wet-line ring, its pigment; the sea's depth plates as contour stripes from the climb (the
painted look: owner's call); the low mist on the far sea (no seam in the captures).

### Checks

Real game, headless Chrome, WebGPU and WebGL2, High, 1920 x 1080, 30 fps cap: the pond from
orbs 18-22 and the rail (p 0.246-0.29), the sea from orbs 11-15, the rail (p 0.15-0.185) and the
climb (orbs 29-33, p 0.65), the underwater ceiling (p 0.10-0.135). Console clean (one THREE.Clock
deprecation, not ours). Cost not measured on the GPU this pass: the tarn's march reads one more
texel a step on its own pixels; the ground pays one compare a fragment outside the tarn's box and
one texel a vertex; the sea gains a fetch (the chop, High) and the dome's air in its sky wash.
