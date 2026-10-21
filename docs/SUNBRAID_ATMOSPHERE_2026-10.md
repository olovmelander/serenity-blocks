# Sunbraid — the atmosphere pass (2026-10-21)

Olov asked to "start improving the visuals, effects, atmosphere and graphics in the Sunbraid theme"
a day after it was made ([SUNBRAID_VISUAL_OVERHAUL_2026-10.md](SUNBRAID_VISUAL_OVERHAUL_2026-10.md)).
Captures of rest, every gameplay event, the tiers, the backends and the lenses found what held it
back; each change below was iterated in the playground against those captures (Electron on a private
dev server, RTX 5080 laptop, WebGPU, consoles clean throughout).

## What held it back

- **A white wall across the valley.** The valley mist's light was linear in its depth, and the
  eye sees the floor at a degree or two, so beyond two kilometres every line of sight ran through
  enough mist to add a flat white band over three quarters of the valley (false colour: the band
  ran hot, past 1.0, while everything else sat in one mid band).
- **The floor was a white plane.** Gypsum with faint noise: nothing caught the low suns.
- **Pastel stone.** Every bed (3 m thick) took a random tint, which aliased into rainbow scan lines
  on a tower a kilometre out; the sky's fill lit the faces turned from every sun, so nothing was
  dark; the sheen round a silhouette was faint and one colour.
- **A flat lavender sky** under grey clouds (a strong grey fill), and soft suns in a wide wash.
- **Gameplay did nothing to the picture.** The post state was constant: four lines' one white sun,
  a perfect clear's noon and a chain all left the exposure, bloom and grade alone.

## What changed

**The mist and the air (`sunbraid-tsl.js` `mistLight`, `MIST_LIGHT`, the uniforms).** The mist's
light saturates as 1 − e^(−τ) (what lies behind is dimmed by e^(−τ): the two add to a veil, never
past it), each sun's share the lit share of the depth. The mist is thinner and lies lower (1/900 →
1/1700 per metre, 32 → 26 m), the haze a little thinner (1/9000 → 1/12000): the far escarpments and
the floor's colour reach the horizon.

**The tone (`sunbraid-post.js` `FILMIC_KNEE`, `sbFilmic`).** A rational shoulder above the 0.6 knee
(the same slope at the knee as the exponential, but 1–4 spread over the top instead of white by
1.6), as in Grainfields.

**The salt crust (`sunbraid-land.js` `FLOOR_CRUST`, `sunbraid-tsl.js` `sbCells`).** The floor is a
salt pan of polygons 24 m across (Voronoi cells with their edges), each its own shade of white, with
ridges heaped white along the edges. Up close the ridges are a bump from screen derivatives, so the
low suns light their near faces and shade their backs; farther out they are faint white lines;
beyond, the mean. A ridge never draws narrower than about a pixel and a half, and the bump stops
before its derivatives turn to stair steps (both were dotted lines first). The selenite glitter is
sparser and brighter (`SELENITE`: a crystal in 1 in 55 cells, not 1 in 14), so it sparkles instead
of reading as static.

**The stone (`sunbraid-spires.js` `TOWER_BEDS`, `sunbraid-spire-shape.js` `BED_LEDGE`).** Colour
comes in formations 34 m thick (each its own pale sandstone, shading into the next, toward the mean
at 70 %), with the 3 m beds as fine lines only; both fade where they would be finer than a few
pixels. Less sky fill (0.45 → 0.32), so a face turned from every sun is dark against its lit
neighbours. The rim light round a backlit silhouette is stronger and lies on each sun's own side, so
a tower is edged in three colours. The bed ledges in the mesh are less than half as deep (towers
read as a stack of pancakes).

**The sky (`sunbraid-tsl.js` `SUN_LOOK`, `CLOUD_FILL`, `sunbraid-world.js`).** The zenith is deeper
cobalt-violet; the high cloud takes little grey fill (its shade is the dome's own colour, its lit
side the suns'). Each sun's disc is limb-darkened in true angle (the old mask ran on 1 − cos, so the
rim was a thin band) with a tight halo in its colour; the broad soft wash round each disc is smaller.

**Gameplay in the picture (`sunbraid-world.js` `writePost`, `POST_EVENTS`).** The one white sun of
four lines glares (bloom boost 1.1) and floods the frame a little white (flash 0.45, scaled by the
photosensitivity setting in the post); noon (a perfect clear) glares and closes the iris by a
quarter, so the floor blazes but keeps its crust; a chain's ribbons lift the grade's saturation
(up to +0.12).

## Tried and dropped

- **Coloured shafts in the air**: a second, higher haze layer (to 400 m, confined to the few
  kilometres the towers stand in) so each tower's three shadows would stand as coloured rays to the
  suns. With the suns 9° up and the towers a kilometre out, a shadow is too short a share of any
  line of sight to show: the layer only added a veil. Removed.
- **Diffraction spikes on the suns**: they drew as thin vertical hairlines. Removed.
- A random tint per 3 m bed (the old look) at a larger scale (22 m): the buttes read as layer cakes;
  34 m at 70 % contrast kept the formations without the stripes.

## Verification

- Playground captures (WebGPU, 1600 × 900 unless named; `.cache/sb/shots/` in the worktree): rest at
  20, 120 and 240 s; the braid held at −90° and 90°; with the board; a chain of four; a two-line
  clear; four lines closing, held and parting; a perfect clear; game over at dusk; a T-spin; Extreme,
  Medium, Low, Minimal; the WebGL2 fallback at High and Low; 21:9 (2100 × 900) and portrait
  (430 × 932); close-ups of the hero tower, the right butte, the floor and the suns; false colour
  before and after. Consoles clean (the playground's own boot lines only).
- Unit tests: `tests/unit/sunbraid-atmosphere.test.js` (the post at rest, through four lines, a
  perfect clear and a chain; the constants' ranges); all 9 Sunbraid files, 282 tests. The shader gate
  builds every material in WGSL and GLSL.
- `npm run lint:ci` at its baseline; `npm run build` (boot closure OK).

Not measured: frame time. What was added, by construction: a 3 × 3 Voronoi lookup and a screen-space
bump on the floor (one draw), a handful of ALU on the towers; nothing in the post but the uniforms.
