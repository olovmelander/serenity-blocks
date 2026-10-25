# Sunbraid — the crust and the sky rays (2026-10-25)

Olov: "I think the sunbraid theme can look better, for example the cracks on the ground feel like
low resolution or not having anti aliasing", then "we also need to improve the look and visuals of
the white flying things in sunbraid … so they look perfect and visually stunning". Each change
below was iterated in the playground (Electron on a private dev server, RTX 5080 laptop, WebGPU,
1920 × 1080 unless named) against captures and a temporal spike map, then checked in the real game
at High. It follows [SUNBRAID_ATMOSPHERE_2026-10.md](SUNBRAID_ATMOSPHERE_2026-10.md), whose crust
it replaces.

## What held it back

- **The cracks were dotted, stair-stepped lines.** The crust's ridges took their slope from screen
  derivatives of the ridge height (`dFdx`/`dFdy` into the surface gradient). GPUs take derivatives
  once per 2 × 2 pixels, so a ridge a few pixels wide got one slope per block: dark and light
  dashes along every crack, hard black edges, and steps along any slanted ridge. MSAA cannot help:
  it smooths triangle edges, not detail inside a shader. The ridges were also measured by the
  difference of the two nearest centres' distances, which is not a distance: they bulged and
  pinched toward the junctions.
- **The towers' lit faces mottled in 2 × 2 squares** for the same reason: their relief was a bump
  from screen derivatives, the finer half of it (features ~22 cm) smaller than a pixel at the
  towers' range. A few silhouette pixels lit in one sun's colour (the normal extrapolated past a
  sliver of the rim under MSAA).
- **The gliders were paper.** A flat white leaf with a ribbon tail, lit so it clipped to pure
  white: no form, no light through it, and the tail, thinner than a pixel, broke into dashes. Their
  flap moved the sheet along world-up (three applies the instance matrix before `positionNode`),
  and seen as the eye sees them (150–330 m up, 0.7–3.4 km out, the eye 70 m up: 4–10° from edge
  on) they read as thin lines.

## What changed

**The crust (`sunbraid-land.js` `FLOOR_CRUST`, `sunbraid-tsl.js` `sbCellEdge`).**

- Every border's true distance (the bisector of two centres), sought among the same nine centres
  as the nearest one. Within 0.3 cells of a border that agrees with a 5 × 5 search at jitter 0.85
  in all but 7 points in a million (a 3 × 3 search round the nearest centre missed ~1 % of ridge
  pixels); `tests/unit/sunbraid-crust-rays.test.js` checks it at the crust's jitter.
- The ridge follows a smooth minimum of the distances to ALL the cell's borders (log-sum-exp,
  `knot` cells soft), and rises along that minimum's gradient (the weights' blend of the borders'
  directions). The junctions are rounded knots.
- The ridge's white, its slope and the step from one cell's tone to the next are box-filtered over
  the pixel's width across the border, exactly: the mean slope is `(h(|e − w/2|) − h(e + w/2)) / w`,
  the white comes from the profile's integral. A ridge stays a clean line at any range and fades
  by its coverage where it is thinner than a pixel; no screen derivative of anything sharp.
- The borders wander (two noise reads, bends ~12 m long); the ridges stand higher in some
  stretches than others (a noise field ~40 m across, from 35 % of the height); a ridge's face
  turned from the suns keeps 30 % of the flat floor's light (the glare off the gypsum round it),
  so the backs are blue-grey, not black lines.
- The fine grain's slope comes from two more reads a pixel's width away (mip-filtered alike).

**The towers (`sunbraid-spires.js` `TOWER_RELIEF`).** The stone's 2 m blocks take their slope
from two more reads a pixel's width away on each of the three planes; the sub-pixel grain stays in
the colour only. The normal is a centroid varying (`src/themes/shared/centroid-varying.js`).

**The sky rays (`sunbraid-gliders.js`, `sunbraid-glide.js`).**

- *Shape.* A ray built in JS (no Blender: at 30–100 px what reads is the silhouette, the light and
  the motion, and an analytic shape gives the vertex stage exact slopes): a crescent planform
  (`RAY`, `rayEdges`) with two small lobes either side of the mouth, a body with depth, thin
  wings, a whip tail; back and belly meet at the outline.
- *Motion.* Each ray carries its own transform (position, a quaternion, span) in an instanced
  buffer; the instance matrices stay identity and the vertex stage bends it in its own frame:
  a stroke that runs out to the tips and back along the chord, the body heaving against it, the
  tail trailing it (`RAY_STROKE`). Bent normals are exact (the stroke's slopes), handed on as a
  centroid varying. It beats while it climbs a thermal and glides while it sinks (`STROKE.calm`,
  `STROKE.climb`), its nose lifting as it climbs; a glide holds the wings in a gull bend and runs a
  slow ripple along them; a big ray beats slower. Turns bank 2.6 × the pull, toward 37°, so the
  wings show as a ray comes round (the eye sees them nearly edge-on). Reduced motion holds the
  wings still; the loops are unchanged.
- *Light* (`RAY_LOOK`). A pale belly lit by the glare off the floor (`u.groundLit`), a dusky back,
  a pearl sheen on the wings. The wings are thin: a sun on their far side shines through them
  (veins dark across the light), and a sun's disc seen through a wing glows in its own colour
  (a tight lobe: the three suns braid a few degrees apart, and a wider one summed them to white);
  against a sun the light off floor and sky gives way, so a ray crossing the triple star is a
  silhouette with glowing wings, and its thin edges catch a silver lining near any sun.
- *Edges.* The tail is never drawn thinner than ~0.7 px (it fades by its coverage instead), and
  the outline fades over its last pixel (`aEdge`, the pixel's size at the ray's range from the
  CPU): no dashes, soft tips on the tiers without MSAA.

## Tried and dropped

- **Each border its own random height**: where three cells meet, each sees its own pair of borders,
  so the height jumped at every junction and the junctions flickered in the spike map.
- **A smooth minimum of the nearest two borders, or each border's ridge merged by the higher one**:
  both jumped where a third border came within the knot (two junctions close together). The
  spike map counted 240–280 flickering floor pixels over 28 frames; the minimum over all borders
  counts none.
- **The pixel's width across the border from `fwidth(distance)`**: no better, and coarse.
- **A broad lobe (cos⁸) for a sun seen through a wing**: the three suns braid a few degrees apart,
  so a ray in front of them glowed white, not in any sun's colour.

## Verification

- Playground captures (WebGPU): the board frame at 20, 40 and 120 s; native-size crops of the
  floor near, mid and left; the gliders through the inspection lens (`look=`) banked, beating
  (a six-frame stroke), gliding and crossing the cobalt sun; false colour of the rays (the wings
  1–2.5, the body 0.6–1); Low and Minimal; the WebGL2 fallback (`forceWebGL=1`). Consoles clean.
- Temporal spike map (30 phase-locked frames 1/60 s apart, a pixel spikes when it beats both
  neighbours by 18): the floor's lower rows 0 before and after (the remaining counts sit at the
  tower bases, as before); the towers' columns fell from up to 574 to 46.
- The real game (Single Player, High, 1600 × 900): crust, towers and rays as in the playground,
  console clean.
- Unit tests: `tests/unit/sunbraid-crust-rays.test.js` (the border search, the ray's outline and
  normals, the flight's ranges and its beating while it climbs, the frame it writes, reduced
  motion); all Sunbraid files, 304 tests; the shader gate builds every material in WGSL and GLSL
  under its size budget.
- `npm run typecheck`, `lint:ci`, ts and fitness ratchets, `check:boundaries`, `check:ip-strings`.

Not measured: frame time (the laptop's GPUs are shared with parallel sessions). By construction:
the floor keeps its nine hashes and adds eight `exp` and a `log`, five texture reads and no
derivative bump; the towers read the relief nine times instead of six; the rays are ~2,270
triangles each (≤ 8, one draw, transparent) instead of ~260.
