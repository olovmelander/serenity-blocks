# Odyssey Act II — chapters 3, 4 and 5 made stunning (2026-10-25)

**An audit, a plan in six steps, and the record of each step as it lands.**

Olov, with a screenshot of the chapter 4 meadow under the massif: *"Next i want to look into chapter
3,4,5 and how we can improve these to make it more impressive, the trees, the mountains, the
landscape, the surroundings, the birds, the rainbow, the air, the, clouds, the lod trees, the
lighting, the sun, the wind on top of the mountain, the atmosphere, the assets, the composition, the
pond, i want you to look into these chapters and see how we can improve them visually so they become
a visually stunning masterpiece environment for odyssey mode."*

Earlier plans this builds on: [ODYSSEY_OVERHAUL_ACT2_2026-10.md](ODYSSEY_OVERHAUL_ACT2_2026-10.md),
[ODYSSEY_MASTERPIECE_PASS_2026-10.md](ODYSSEY_MASTERPIECE_PASS_2026-10.md), and the Act II
forest, ground and cloud plans of 2026-08.

## The audit

24 live stations on the rail, from the shore (p 0.15) to the top of the climb (p 0.66), plus a
survey of how each system is built.

![The audit: the shore, the meadow and the rainbow, the forest under the massif, the summit stare of chapter 5](images/odyssey-act2-2026-10-25/audit-stations.jpg)

What held the act back, most first:

1. **Front light.** The world sun stood ~25° up, 110–175° off the camera's bearing for the whole
   act: the camera looks out at −80 to −120° through chapters 3–5, and the sun sat behind it. The
   massif read as a flat cone, its ridges painted rather than shaded. The back-lit terms (tree rims,
   cloud silver linings, the sea's sun road) never showed. Shadows are baked, so moving the sun was
   the owner's call.
2. **The summit.** From p ~0.38 to 0.58, almost half of chapter 5, the view is a smooth white cone:
   its flutes and couloirs are shaded only, and its texture smears down the steep faces.
3. **The trees.** Three quantised tones per crown, so the blossom and maple crowns read as paper
   confetti. Upslope conifers are bare cones, and slopes beyond ~1450 u carry no forest.
4. **The clouds.** Sculpted SDF masses lit from behind the eye read as stickers. The sky is one
   flat blue, with no haze toward the sun.
5. **Life.** The birds are specks. The summit's spindrift (56 quads) does not read in any capture.
6. **The pond.** Never visible from the rail: forest and hills hide it at every station.
7. **Set dressing.** Grass, rock and flowers are all painted into the ground: no grass, boulders
   or props.

**Constraints.** Act II GPU p50 must stay under 1.2 ms on Lane A (RTX 3070; baseline ~0.65). Lane B
(the Radeon 610M iGPU) is already over its 7 ms budget at ~10 ms. Each material costs ~40–45 ms
of cold pipeline compile.

## The plan

1. **Turn the sun** to the side, low and clear, and re-bake the shadows. *Done (§1).*
2. **The summit sculpted, and its wind.** Arêtes, rock faces and couloirs in the height field.
   Snow by slope and exposure with wind-scoured ridges, rock that does not stretch on steep faces,
   and a spindrift plume that reads. Varied framing for chapter 5's long stare.
3. **Trees and the treeline.** Softer, back-lit crowns, ragged conifer silhouettes, a far ring of
   forest, and a transition from forest through krummholz and alpine meadow to rock and snow. A
   cheap band of real grass by the rail, in the wind.
4. **Clouds and air.** Dark bases, lit edges, a high cirrus layer, warm haze toward the sun, light
   shafts.
5. **Life.** Readable birds near the camera, butterflies, petals in the air.
6. **The pond.** A sightline from the rail, and a mirror for the massif and the sky.

## §1. The sun turned to the side (2026-10-25)

**Choosing it.** Five suns, each captured at six stations on the live rail (bearing from +x toward
+z, elevation):

| | Bearing, elevation | Result |
|---|---|---|
| A | today's sun (127°, 25°) | flat |
| B | the same bearing at golden-hour height (12°) | as flat: the light's colour is the colour script's |
| C | side light (170°, 14°) | the massif has form and its shadow falls across the forest, but the rainbow is gone |
| D | three-quarter back light, in the frame | the most dramatic, but the face of the mountain goes into shadow |
| E | side light from the other side | keeps the rainbow, leaves the mountain dark |

![The five suns (A–E, left to right) at p 0.225 and 0.40](images/odyssey-act2-2026-10-25/sun-candidates.jpg)

A second round between A and C (bearings 145–155°, 15–20° up) found the light that does both: one
flank lit and one in shade, the massif's shadow over the meadow, and the antisolar point far
enough round that the rainbow still stands at the right of the frame. The sun is now bearing 155°,
15° up (`ODYSSEY_WORLD_SUN`).

![Before and after at p 0.255 and 0.40: the massif's right flank and its shadow over the meadow, the summit cone lit from the left, the rainbow still at the right](images/odyssey-act2-2026-10-25/sun-before-after.jpg)

**What it changed:**

- The ground's sun-visibility bake re-bakes at load with the new sun. The golden hash of the
  shadow bake was re-pinned after the live check.
- Chapter 2's underwater shafts now slant in from the upper left.
- Along the shore (p ~0.18) the low sun now hangs in the sky ahead-left, over the sea.

**What it left alone:**

- The colour script's light stays clear white at altitude. A warmer sun there read as a "sand cone"
  on 2026-10-20, so the golden hour that B tried was not taken.
- **The Earth from orbit keeps the sun it was composed under** (`EARTH_SUN` in
  `composition/odyssey-orbit-earth.js`): its sunset timing, the aurora's place on the night side
  and the planetrise beside it. At the seam that sun is behind the eye either way.
- Chapter 6 points its own light at the black hole at runtime.
