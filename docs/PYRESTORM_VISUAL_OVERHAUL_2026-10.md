# Pyrestorm — "the mountain that makes its own weather" (visual overhaul, 2026-10)

Total rebuild of the `pyrestorm` theme on three r186 (`WebGPURenderer` + TSL, with the WebGL2
backend as the fallback), replacing the classic `WebGLRenderer` + GLSL `ShaderMaterial` +
`EffectComposer` scene (`pyrestorm-shaders.js`, 1,577 lines, deleted). Same theme id, same
registry slot, same container (`#pyrestorm-theme`), same Odyssey orb; nothing to migrate.

## The picture

Night, from a high tephra ridge. Fifteen kilometres away a broken stratovolcano erupts: its
breached crater fountains fire hundreds of metres up, threads of lava run down its gullies, and
an older caldera wall (a somma) shoulders its left flank. Out of the breach a lava river runs
down onto a black plain and braids its way toward the eye, passing below the ridge; on the
right, a fissure burns in a low curtain of fire and sends its own river in. Above the summit the
eruption column climbs and bends downwind into a pyrocumulonimbus anvil that roofs the sky, lit
orange from below and charged with volcanic lightning (a "dirty thunderstorm"). Upwind, on the
left, the sky stays clear: stars and a faint Milky Way.

What the old theme was loved for is kept and taken further: the erupting volcano with glowing
lava channels down its flanks, the red storm with lightning, the embers. What is new: a real
landscape at a real scale (a 90 km country baked from height functions), lava as a surface
(distance-field channels with a flowing crust over an incandescent core), the column and its
anvil as lit volume, lightning with a leader and one return stroke, and an event language that
is the volcano's own physics.

### Composition (16:9, rest)

| Where | What |
|---|---|
| left third | the volcano (summit ≈ x 0.24, y 0.3), its flank streams, the somma on its left shoulder |
| above it | the column, leaning right as it climbs into the anvil |
| top band, left → right | the anvil's underside, orange near the column, darkening downwind |
| upper left | clear sky: stars, the Milky Way, the dusk's afterglow on the left horizon |
| left of the card, mid | the main river coming down out of the breach toward the eye, braided |
| right of the HUD | the fissure's curtain of fire (three vents along it) and its river coming in |
| bottom band | the two rivers swinging in to the bottom corners below the ridge's crags, cooled lobes beside them, embers rising off them; the eye's own slope with boulders |

Portrait turns the lens toward the volcano and looks up, so the summit and the column stand above
the card; 21:9 narrows the lens and shows the fissure whole.

## The palette

**The night (the watches).** Five palettes of sky, air, ash and lightning in hue order, walked
there and back along the line so a mix never crosses the wheel through grey:
ember dusk (crimson afterglow behind the volcano) → magenta night → violet night → indigo deep
night (most stars) → steel dawn (a rose glow rising on the right). **The night drifts with the
clock by itself: wheel = clock / 100 s + (level − 1), resting 15 % of each step at either end.**
A level-up steps it forward from where the last turn was headed (never back to a level's "own"
watch after a long run); a new run keeps the light where it is; a rebuild in place keeps both.

**The fire.** A blackbody ramp (dull red → orange → yellow → yellow-white), the same everywhere
lava, spatter, bombs and the fountain burn. The lightning takes the watch's colour (lilac,
violet, ice blue).

**The pieces** (solid fused tiles; `npm run check:palette` 2/7 in band; worst pair under
colour-vision deficiency ΔE 16): I lightning lavender `#C9B5FF`, O sulphur `#F4C430`, T
incandescent orange `#FF6A1F`, S ember crimson `#C21E3A`, Z storm blue `#2673E6`, J olivine
`#33B07A`, L ash white `#EDE6DA`; garbage cooled basalt `#2B2422`.

## The event language

| Event | What the volcano does |
|---|---|
| Lock | A Strombolian burst: the crater glows up and throws incandescent bombs (three for each of the piece's cells), leaning the way the piece locked (left columns left, right columns right); each draws its whole arc as a glowing trail, splashes where it lands on the cone and lies there as a cooling ember, tinted a little by the piece's colour; sparks spray from the mouth and a puff of hot ash climbs into the column (second pass, below) |
| Hard drop | A bigger, higher burst (more bombs the further the piece fell), a stronger glow, sparks, and a tremor: the crust tears open along every channel for a moment |
| Clear | One cloud-to-ground bolt out of the column per line, staggered; a higher row strikes higher up the cone, the floor rows strike the plain; each strike scorches the ground and lights the column from inside; the fountain kicks |
| Chain | The storm charges: spider lightning crawls along the anvil's underside, more often as the chain grows; the fountain climbs and the column's foot burns hotter |
| Chain break (peak ≥ 4) | The charge goes in one great branched discharge from the anvil to the summit |
| Four lines | A Vulcanian blast: the crater flashes once, a shock front races out through the column and the anvil, flashing the ash pale where it passes (gone within a second and a half), a ring of bombs, the fountain jets to twice its height, a glowing surge rolls down the breach, then the bolts and a discharge |
| T-spin | The crater blows a vortex ring (a hot inner ring inside a sooty outer one) that rises and widens beside the column |
| Back-to-back | St Elmo's fire: a violet corona on the summit while the run lasts |
| Perfect clear | Sheet lightning sweeps the whole anvil from the head downwind; a crown of four bolts round both flanks of the summit; the fountain at its highest |
| Level up | The night moves on a watch (it also drifts by itself, above), the fountain kicks and a bright surge of fresh lava runs down every channel from the vents with a glowing wake behind it |
| At rest | The storm lives: a dim glow wanders inside the cloud near the column's head (under 1 Hz, swelling and fading), and every four to nine seconds a spider bolt crawls along the anvil's underside |
| Game over | The eruption sinks to a glow; it wakes with the next run |

Fleet clichés avoided (catalogue Part 0): no ring from the board's foot, no blades of light from
the card, no hush-then-flare, no spiral round the card, no camera jolt. Kept on purpose: the hour
wheel (Olov's standing requirement that a theme's light drifts with the clock) and Pyrestorm's
own motifs (a volcano, eruptions, lightning in a red storm, ash), which the catalogue already
reserves for this theme.

Photosensitivity (WCAG 2.3.1, self-imposed): lightning is one stroke with an exponential decay,
never a strobe; the only frame-wide flashes are on four lines and the perfect clear, small and
eased; a lock or a chain step never flashes.

## Tech

Module split (`src/themes/pyrestorm/`): `core` (three-free constants, height functions, rivers,
column, pieces, timings), `hours` (the watches), `bake` (lava network, noise, lattice, billow
atlas), `tsl` (uniform bag, readers), `land` (fan + cone meshes, the lava surface), `sky`,
`anvil`, `plume` (the column as a ray-marched volume), `smoke` (CPU-sorted event puffs), `fume` (the fissure's fume
and the anvil's ash fall, as noise sheets; second pass), `bolts`, `fire` (jets, bombs, motes), `world`, `post`,
`quality`, `composition`, `director`, `theme`, `tetrominos`; the playground effect
`src/playground/effects/pyrestorm.effect.js` mounts the same world and post.

- **The land** is two meshes from one CPU height function: a polar fan round the eye (rows
  spaced exponentially, so the screen-space density is even from the eye's feet to 82 km) and
  the volcano's own ring mesh (dense round the summit), its outer rings dipped under the plain.
  Normals and a hollow/crest shade come from the grid's neighbours; one height evaluation per
  vertex, baked in slices inside `PyrestormWorld.prepare` (about 1 s at High in Node).
- **The lava** is baked once per page into two nested RGBA8 fields (near 18 km at 17.6 m,
  far 36 km at 35 m): distance to the nearest channel's centreline, its half-width, its heat, the
  glow it throws on the land; plus a second texture of the flow heading, kind and arc length. In
  the shader a pixel-width antialiased distance test draws a crisp channel at any range (a
  sub-pixel thread still burns as a line), two scales of crust drift downstream through a
  two-phase flow map, seams glow, and a blackbody ramp gives the colour.
- **The column** is a volume. A closed tube round its curved axis (reaching 700 m below the vent,
  so the foot rounds off inside the crater) is the proxy; each front face starts a ray that
  marches through the ash (12 steps at Minimal … 40 at Extreme, stopping once it is opaque). The
  density is the column's round body with billow noise heaving its surface into cauliflower lobes;
  the noise lives in the column's own frame (across in widths, along in widths travelled, a cubic
  fitted once to the axis), advected up the axis, so the lobes climb, grow as the column widens
  and never shear. Light at a sample: the crater's fire from below, reddening and fading with
  height, shadowed by one density tap toward the crater (lobes turned to the fire burn, the folds
  between them go dark); the night sky from above (one tap up); the lava's wide glow and the
  lightning once per ray; the blast's front; the incandescent foot. The axis is solved per sample
  from the height and two Gauss-Newton steps against the CPU's `columnPoint`. The density is
  pinned (`.toVar()`) where it is made, so each of its three uses is emitted once (the fragment is
  ≈ 28 KB of WGSL).
- **The anvil** is one sheet seen from below with lumps, mammatus pouches (Medium and up), the
  same lights, and sheet lightning on a perfect clear; the column's volume runs up into its head.
- **Event smoke** (the T-spin's vortex ring, the four-line surge) is an instanced pool of puffs
  placed on the CPU each frame and sorted far to near (premultiplied "over"), each sampling a heap
  from a baked 4×4 billow atlas, its edge soft over the heap's outer third and its normal bent
  toward the body it belongs to (the ring's outward side), so the puffs light as one mass.
- **Lightning**: eight slots of three uniform rows; each bolt is a channel plus branches built in
  the vertex stage from a seed (three octaves of piecewise-linear noise), a few pixels wide at any
  range; the CPU mirrors the envelope to light the land and the cloud.
- **Fire**: the crater's fountain and the fissure's curtain loop in closed form (the fountain's
  height scales each arc's rise, never its period); bombs, sparks and splashes are thrown into a
  ring buffer and flown on the GPU; ash drifts past the eye, and a few embers climb off the two
  rivers where they reach the bottom corners.
- **Post**: one scene pass, a hue-preserving bloom (Medium and up), and one output pass with
  heat shimmer over whatever burns (masked by the bloom), calm zones over the card and HUD, a
  hue-preserving filmic, a night grade, vignette, grain.
- Six tiers (Minimal … Extreme) cut counts and detail, never a feature or a beat.

## Traps met (each cost at least one capture round)

- **The plain was invisible.** The grid builder wound its triangles clockwise seen from above, so
  every face of the fan and the cone pointed down and the default `FrontSide` culled them; only
  faces steep enough to turn toward the eye survived, and the sky showed through the plain as a
  flat pink sheet. A probe that printed each triangle's normal against the direction to the eye
  found it (`(c − a) × (b − a)` had `y < 0`). The SKILL table's winding row (#118) is the same
  family.
- **Nothing additive drew.** Bolts, fountain, bombs and motes wrote `vec4(rgb, 0)` with
  `AdditiveBlending` but without `premultipliedAlpha = true`; three's non-premultiplied additive
  blend multiplies by the source alpha (0). SKILL #90.
- **Lightning as confetti.** Each bolt is a ribbon whose side vector came from each vertex's screen
  tangent; where the jagged path turned back on screen the ribbon twisted, half its quads faced
  away and were culled, leaving scattered dashes. `DoubleSide` plus a side vector oriented with
  the stroke's overall direction (new SKILL row). Motion-aligned streaks need `DoubleSide` too.
- **`EYE.x + node`.** A JS number plus a TSL node is string concatenation: the motes' vertex
  shader read `0[object Object]` and failed only on the WebGL2 backend (found by a SwiftShader
  capture, new SKILL row).
- **Square smoke.** The first billow atlas let fBm "lumps" lift the height outside the heap, so
  every puff quad showed as a soft square; lumps now apply only inside the heap and the tile has
  a clear border (and no mips, which bled one heap's tile into the next).
- **Bubble wrap.** A column of puffs read as a pile of balls through five capture rounds: each
  heap's alpha edge was a sphere's height profile (a step), and every per-heap term (its
  thickness, its normal) drew a rim round it, dark or bright. Cauliflower atlases, erosion, size
  hierarchies, soft edges and bent normals each helped and none was enough. The column became a
  ray-marched volume (above); puffs stay only for brief event smoke, softened and lit by their
  body's normal. Two traps on the way: a per-ray value first built inside the march's `If` is
  emitted there (read unassigned after the loop; the lightning loop ran per sample), so every
  per-ray value is pinned with `.toVar()` before the loop; and a proxy that ends at the vent
  draws the plume's foot as a glowing box.
- **A density written nine times.** A TSL node read inside several `If` scopes is re-emitted in
  each; the plume's density (three noise taps, a Newton solve) appeared three times per use.
  Returning it `.toVar()` cut the fragment from ≈ 30 KB to ≈ 17 KB with one tap loop, ≈ 28 KB
  with the three uses inline.
- **A broken column on WebGL2 only.** Running the sample and its two light taps through a small
  loop nested in the march (to write the density once) rendered correctly on WebGPU and on
  SwiftShader, but through ANGLE's D3D11 translation on the RTX 3070 the column's lower half
  vanished and the bend smeared. Back to one loop with the three uses inline (pinned).
- **Twenty slow frames in the bake.** On the lifecycle validator (software rendering, 1080p) the
  theme's start ran past the manager's 20 s limit. Nothing was rendering: the bake breathed with a
  `requestAnimationFrame` after every slice (about twenty times) and each breath waited out a
  software frame of the previous theme. The bake now works at least a frame's worth between
  breaths and twice as long as the last breath took (`bakeSliceMs`), so a slow page costs it a
  few breaths; the start fell from 21 s to 5 s there.
- **The moon beside the crater.** The blast's shock front was first a shell round the crater,
  brightest at its silhouette: against the clear sky it drew a pale disc, then (torn and banded)
  a pale crescent. The shell is gone; the front shows only where it passes through ash (the
  column's volume, the event puffs, the anvil), as condensation would.
- **Headlights.** A level-up's surge added up to 0.7 to the lava's blackbody temperature; the near
  river ends went white and bloomed. The surge adds 0.2 and the temperature tops out at 0.82.
- **The anvil under the frame's top edge.** With the wind blowing away from the eye the anvil sat
  above the frame and behind the card; the wind now blows to the eye's right and the anvil runs
  away downwind for sixty kilometres, so in perspective it roofs the right-hand sky down to the
  far horizon.
- **The summit behind a phone's card.** Looking UP on a portrait screen put the summit below the
  centre, inside the card. Portrait looks down so the summit stands above the card, and between
  portrait and square the summit goes round the card's top-left corner (first left, then down),
  checked at every aspect against the fallback layout (`tests/unit/pyrestorm-world.test.js`).
- **A quality change turned the night back.** A rebuild in place made a fresh wheel; the
  levels gained were lost. The world now exports its wheel, level and eruption state and the new
  world imports them (pinned by a test).

## Verification

- **Unit tests:** eight files, 275 tests (`tests/unit/pyrestorm-*.test.js`: core, bake, hours,
  world, director, theme, shaders, playground). They pin the night's drift with the clock at any
  level, the session hand-over across a rebuild in place, the composition at every aspect against
  the fallback layout, the storm's life at rest, the flash rate limit, the bake's slices, and
  build every material for both backends without a GPU (no WGSL var read where it may not have
  been assigned).
- **Full suite:** 884 of 893 files and 17,523 tests pass. Of the nine failing files, seven pass
  when run alone (bake-time guards and timeouts under the full run's load: Rainbark bakes, Serenity
  Warp, Odyssey forest / cloud field / bake loader, the URL catalogue); the other two are this
  machine's known environmental reds (the Swedish-locale number in `odyssey-level-briefing`, the
  symlink `EPERM` in `tts-recorder-e2e`).
- **Gates:** typecheck, the TS ratchet, the lint ratchet (no new errors), architecture fitness,
  the theme lifecycle audit, import boundaries, the palette check, performance budgets, the
  production build with its boot closure, the IP-string, Pages-artifact and release gates: all
  pass.
- **Shaders:** every material builds for WGSL and GLSL in Node with no warnings (land fragment
  ≈ 14 KB, plume ≈ 28 KB, anvil ≈ 10 KB).
- **Lifecycle:** `scripts/validate-all-themes.mjs --theme pyrestorm` passes (0 lifecycle failures,
  0 console errors, 0 process failures; software rendering, start ≈ 5 s).
- **Phone:** `scripts/validate-mobile-webgl2.mjs` passes at Low and Minimal (software WebGL2,
  portrait and landscape; [sheet](pyrestorm-captures/phone.jpg)).
- **Pictures:** every event, the five watches, the six tiers, 21:9, square, portrait and the
  WebGL2 backend were captured on the RTX 3070 with clean consoles
  ([events](pyrestorm-captures/events-1.jpg), [more events](pyrestorm-captures/events-2.jpg),
  [the column](pyrestorm-captures/column.jpg), [watches](pyrestorm-captures/hours.jpg),
  [tiers](pyrestorm-captures/tiers.jpg), [aspects](pyrestorm-captures/aspects.jpg)). The column
  close-up was re-shot on both backends after the last plume change and they match.
- **Real game** (Electron on the dev server, the theme pinned, 1584 × 813): WebGPU at High
  130.7 fps at rest and 128.6 fps through four lines; the WebGL2 backend 130.6 / 131 fps (the
  display's cap). Locks, hard drops, clears, a chain and its break, four lines, a level-up, a live
  High → Medium rebuild (the night carried on, 1.43 → 1.51) and leaving the theme (0 canvases
  left) all ran with no errors ([sheet](pyrestorm-captures/ingame.jpg)). Measured before the last
  two plume changes, which only remove duplicated shader code.
- **The night turns with the clock alone** (real game, `pyrestormFixedDt=150`, no line cleared,
  level 1 in every frame): the wheel went 0.13 → 2.91 in 290 s of theme clock, ember dusk →
  magenta night → violet night ([strip](pyrestorm-captures/clock-ingame.jpg)).
- **Not measured:** a physical phone, the perf lane (ADR-0016), multiplayer and Infinity layouts.

## Second pass (2026-10-21): bursts you can see, lava with a crust, air that burns

From the ridge the eruption is fifteen kilometres away, and at that range the first build's
events and surfaces did not read: a lock's Strombolian bombs flew under real gravity and crossed a
pixel or two a second inside the crater's white glow (a single lock showed nothing at all), the
fountain was a fuzzy sprinkle, the far lava streams were dashed lines, the near rivers were
blotches, and the air over the country held nothing but haze.
([before and after](pyrestorm-captures/pass2-before-after.jpg))

| Part | Now |
|---|---|
| Lock | Each bomb draws its whole arc over the last 0.7–1.3 s as a ribbon (its position in closed form at every row of the strip, so the trail is a true parabola, a hot clot at its head). Bombs fly under a time-lapsed gravity (`BOMB_G` = 300 m/s²) and climb 150–1100 m before falling 0.6–2.4 km out on the cone, and each one leaves an ember that lies glowing where it lands and cools for seconds, so steady play peppers the upper cone. A spray of fast, dragged sparks leaves the mouth, a puff of hot ash climbs into the column, and the crater glows up (`u.burst`, eased: it swells fast and fades slowly, so locks as fast as frames hold a steady glow under its cap instead of strobing) through the crater's own light on the cone, the column's foot, the smoke and the anvil |
| Hard drop | More bombs (by how far the piece fell), higher, and a stronger glow; the crust still tears open |
| Fountain | Time-lapsed too (`JET_G` = 52 m/s²) and drawn with a long exposure (0.2 s streaks whose light is spread along them), so it visibly climbs and falls: a near-upright jet that falls back into the crater and a third of its spatter thrown wide in arcs that fall out down the cone. Its glow is a narrow column, less white; a burst swells its halo, not its heart. An apron of fresh spatter glows in clots round the crater, wider as the fountain climbs |
| Lava | A baked crust (`bakeCrust`: a tileable Voronoi network, R the exact distance to a crack) dragged downstream by the flow map, faster mid-channel than at the banks. Two scales: rafts about 120 m across floating in lanes of open lava, and plates about 30 m across on them with hairline cracks, each plate its own age, its rim glowing dull. The light of plates and cracks is mixed, not their temperatures, so a far river averages to a dimmer orange, never to dull red. Bright seams along the banks once a channel is wide on screen. Threads too thin for a crust burn steady (the old beads read as dashes). Levees crack in cooling joints from the same network |
| Fume | The fissure's three vents breathe gas and steam: per vent a tall narrow sheet and a short wide one, turned about their upright axis to the eye, a column profile widening with height, billows from two octaves of the lattice noise read in the plume's own frame and carried up it, leaning downwind, lit orange from below by the vents' fire and river (`pyrestorm-fume.js`) |
| Ash fall | Five curtains of ash hang from the anvil's near underside in the right-hand sky, streaked and falling, ragged where they thin out, lit at their tops by the anvil's glow and from inside by its lightning |
| Anvil | The underside's relief is lit by its slope toward the column's burning foot (the slopes exaggerated: at this range the true ones barely turn the normal), so the lumps and pouches stand out from the folds between them |
| Air | The haze reads the lava's wide glow at three places along each line of sight (one read lit only what lay two thirds of the way out) |
| Column | No ash below the crater's rim (≈ 330 m over the vent): see the traps |
| Post | 4× MSAA on the scene pass from High up (`sceneSamples`, as the other themes); the heat shimmer only in the low part of the frame, with two incommensurate waves |

### Traps met

- **Every arc was a wavy line.** Bomb trails came out as sine waves; widening and softening them
  (a sub-pixel core stair-stepping was the first guess) changed nothing. It was the post's heat
  shimmer: wherever the bloom said something bright lay just below, the scene was read through a
  regular wobble with a 15-pixel period, and a thin bright line in the sky (an arc, a bolt) wobbled
  into a wave. The shimmer now lives only in the low part of the frame (over the near lava) and
  sums two incommensurate waves. New SKILL row.
- **A curtain of ash down the breach.** The column's proxy tube (radius 0.8 × its width) is wider
  than the crater, and each ray starts at its front face with no depth test per sample, so ash down
  inside the crater was drawn over the near rim and, through the breach, hung down the notch like a
  grey curtain. Fading the density below the vent was not enough (a ray climbs as it crosses the
  tube); it fades below the rim (`RIM_LIFT`). New SKILL row.
- **Far lava went dull red.** Plates and cracks mixed by temperature and then lit through the
  blackbody ramp average to a cool red; mixing their light (two blackbody reads) keeps a far river
  orange. New SKILL row.
- **The bombs broke the WebGL2 build.** Two blackbody calls inside nested `select`s failed in the
  GLSL builder (`addToStack` of undefined) while WGSL built: the SKILL row of 2026-10-09. One
  temperature and one gain chosen per kind by masks, one blackbody read.
- **Fume as puffs was bubble wrap again.** Looping puffs over the vents read as a few brown balls,
  as the first build's column did; sheets with noise in the plume's own frame read as fume at once.
- **Embers as squares.** A landed ember is a streak with no motion, a square quad, and the streak's
  end fade drew it as a square on a phone's close lens; a still ember takes a round profile.

### Verification

- **Unit tests:** `tests/unit/pyrestorm-*.test.js`, 282 tests (four new: the crust tiles, each
  plate has one value and changes only across a crack, a lock's embers lie where and when its
  arcs come down, the crater's glow rises, fades and holds steady under its cap through locks
  as fast as frames). Every material, the fume and the ash fall included, builds for WGSL and GLSL
  at High and Minimal with no warning, no NaN and no var read before it is assigned.
- **Gates:** typecheck clean; the lint ratchet at its baseline; these files lint with no errors and
  fewer warnings than before (59 → 55).
- **Lifecycle:** `scripts/validate-all-themes.mjs --theme pyrestorm` against a private dev server:
  PASS (0 lifecycle failures, 0 console errors).
- **Pictures:** every event, both backends, Minimal, Ultra and a portrait phone frame, clean
  consoles ([a lock at 1080p, 0.15 → 5 s](pyrestorm-captures/pass2-lock.jpg),
  [events](pyrestorm-captures/pass2-events.jpg),
  [WebGL2, Minimal, portrait, Ultra](pyrestorm-captures/pass2-backends-tiers.jpg)). Captured in a
  hidden Electron window against a private Vite server; Electron 38 needs the harness-only swizzle
  shim (PLAYBOOK § 5.6).
- **GPU time** (RTX 5080 Laptop, the playground's demo loop at 1920 × 1080, GPU timestamps, p50 of
  two alternating rounds each, a shown window parked off-screen): High 0.85 → 1.2 ms (most of it the
  4× MSAA), Medium 0.75 → 0.77 ms, Minimal 0.49 → 0.56 ms. The frame stayed at the display's cap
  (5.5 ms) in every run.
- **Not measured:** a physical phone, a weaker GPU, the perf lane (ADR-0016), real gameplay beyond
  the lifecycle validator.
