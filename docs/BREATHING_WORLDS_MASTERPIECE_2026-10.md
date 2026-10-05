# Breathing worlds — the masterpiece pass (October 2026)

All twelve breathing worlds rebuilt as full-screen scenes with depth, light and motion, on a
shared stage that gained a breathing camera, light shafts, a per-world grade and a phone tier with
glow. The guide, the Breathing tab and the Hale sessions are unchanged and still described by
[BREATHING_OVERHAUL_2026-10.md](BREATHING_OVERHAUL_2026-10.md); this record replaces that
document's world list, its tier table and the parts of "Rendering" that describe the worlds.
Captures: [reports/breathing-masterpiece-2026-10](../reports/breathing-masterpiece-2026-10/README.md).

## What the player gets

Every world fills the screen in landscape and portrait, has several depths that slide past each
other as the camera breathes, one clear light, and a breath you can read at a glance.

| World | Rhythm | The scene | What the breath does |
| --- | --- | --- | --- |
| Aurora Dreams | 5 · 2 · 7 · 2 | Curtains of aurora receding to the horizon over a snow range, a mirror lake, spruce on snowy banks | The curtains brighten and lift, folds run along them; the long out-breath lowers and dims them |
| Sacred Geometry | 4 · 4 · 4 · 4 | Three nested solids of light inside a gate of four beams, on an obsidian floor inscribed with the Flower of Life | A comet walks one side of the gate per phase; the crystal unfolds and brightens, then folds |
| Moonlit Waters | 4 · 7 · 8 | A full moon with its real maria over a ray-traced sea, islands in mist, silver-edged clouds | The halo opens and the glitter path widens; the hold slows the sea; the out-breath narrows it |
| Solar Flare | 3 · 1 · 3 · 1 | A colossal rotating star: granulation, sunspots, prominences, coronal streamers, a planet in transit | The corona reaches out about five times further and prominences rise; then it all draws back |
| Heart Glow | 5 · 5 | A water lily glowing from within on a night pond, lily pads, lanterns in bokeh, reeds | The outer petals open first and the heart swells, a ripple ring departs; the inner ring folds first |
| Crystal Prism | 4 · 4 · 4 | A traced quartz point in a misty grotto; a beam split into a spectrum that paints the floor | The fan opens from a thread to a wide spectrum and gathers back; the crystal rests between |
| Volcanic Fire | 2 · 1 | An erupting caldera at night: a lava lake of drifting crust, a fountain, an ash plume, a far volcano | The fountain leaps from a low boil to a towering jet and drops on the release |
| Ocean Tide | 4 · 4 | A drone view of a tropical shore at golden hour: caustics, foam lace, wet sand mirroring the sky | A bore runs up the sand; the backwash leaves glossy sand while the next set breaks offshore |
| Zen Garden | 6 · 3 · 6 · 3 | A moonlit karesansui seen from the veranda: raked relief, sphere-traced stones, a lantern, a maple | A ring of moonlight travels out across the furrows, making the grains sparkle, and returns |
| Cosmic Nebula | 5 · 3 · 5 · 3 | A spiral galaxy inside a star-forming nebula with golden cliffs and pillars | The galaxy grows and unwinds its arms and the walls draw back; the out-breath gathers it |
| Ancient Forest | 4 · 2 · 6 · 2 | Rows of backlit trunks receding into mist, a leaf canopy the sun glints through, ferns | Light shafts swell through the trunks and the mist glows; the forest dims and settles |
| Electric Storm | 3 · 2 · 4 · 1 | A plasma globe shot like macro photography, on a lacquer table that mirrors it | Filaments lengthen, fork and touch the glass; then withdraw to a calm core |

Nothing flashes: every brightness change ramps over at least about a second (the guide's
photosensitivity rule). The Hub's cards show new stills of every world.

## The stage every world draws through

**A breathing camera.** The view leans in a few percent as the lungs fill (`zoom = 1 + dolly ×
breathSoft`) and drifts on a slow Lissajous path (about a minute per loop). Meshes see the real
camera move — it sits at `(pan.x, pan.y − focus / zoom, 6 / zoom)`, which keeps the z = 0 plane
equal to hero space through `(P − pan) × zoom` — and painted layers keep step through
`layer(p, u, k)`: k = 0 at infinity (still), 1 on the hero plane, above 1 nearer. `unlayer` is its
inverse. Reduced motion holds the lens still, and so does a session's stillness (calm). A world
states its amounts (`camera: { dolly, drift, period }`).

**Richer breath signals.** `breathSoft` follows the breath with a little lag (a critically damped
follower, ~0.3 s), for follow-through and overlap; `breathVel` is its smoothed rate. `seek()` pins
both, so captures stay deterministic.

**The lens (`stage/breath-post.js`).** One pipeline serves every world; a world only states numbers.

| Piece | What it does |
| --- | --- |
| Bloom | The r186 mip-chain bloom over the composite; its strength swells with the breath (`bloom.breath`). |
| Light shafts | Two short radial marches at reduced resolution instead of one long one: the first walks each pixel toward the light and gathers what is bright enough, near the light (`radius`) and above the world's `region` line, its last steps fading out; the second walks the first's result over one of its steps. N + M taps give the smoothness of N × M with no jitter (a jittered single march showed as a lattice at quarter resolution and as grain at half). The decay is per step of a 32-step march, so every tier fades over the same length. The pass exists only in the output graph of worlds that use it. |
| Grade | Split tone (shadow and highlight tints by display luma), contrast and saturation on display values. |
| Lens | Neutral tone mapping, edge chromatic aberration on high tiers (scaled per world by `grade.chroma`), vignette, a dither against banding. |

**Tiers.** Every tier draws the same artwork; only cost knobs differ. Phones (touch, or 768 px wide
or less) are capped at Low, which now runs the light post pipeline. Before, Low drew straight to the
canvas with no bloom, so every glow on a phone was flat.

| Tier | Pixel ratio cap | Pixel budget | Octaves | Detail | Motes | Bloom scale | Shafts (taps @ scale) | Edge CA | Cadence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Extreme | 2 | 3.6 MP | 6 | 1 | 100 % | 0.5 | 48 @ ½ | yes | display |
| Ultra | 1.75 | 3.0 MP | 5 | 1 | 100 % | 0.5 | 40 @ ½ | yes | display |
| High | 1.5 | 2.4 MP | 5 | 0.85 | 100 % | 0.5 | 36 @ ½ | yes | display |
| Medium | 1.25 | 1.5 MP | 5 | 0.7 | 70 % | 0.35 | 32 @ 0.35 | no | display |
| Low | 1 | 0.9 MP | 4 | 0.5 | 45 % | 0.25 | 32 @ ¼ | no | 30 Hz |
| Minimal | 1 | 0.5 MP | 3 | 0.4 | 25 % | none | none | no | 30 Hz |

`detail` scales the loop and march lengths a world chooses (loops are compile-time constants).
Minimal has no post pass at all, so it has no grade either: the worlds paint the glow they need
rather than leaning on bloom, and a few correct their own colour there.

**World changes wait for their pipelines.** A world's pipelines compile asynchronously while the
canvas is hidden; the stage now waits up to 20 s (was 5 s) for them before showing it. Until then
the guide keeps its CSS orb, words and timing.

**Motes.** A `bokeh` share of each cloud sits near the lens, out of focus: large soft discs with a
faintly bright rim, dim, drifting across the frame faster than everything behind them (they are
placed along the view ray so they keep their screen distribution). New motions: `wander` (fireflies
that keep to their patch of air, with an optional slow `blink` that ramps over seconds), `ember`
(fast, wobbly, cooling as they climb) and `swirl` (an orbit that widens with the breath).

**TSL helpers** (`stage/breath-tsl.js`): 3D gradient noise and fbm (fields that evolve in place
instead of sliding), ridged fbm, animated Voronoi (F1, F2, cell id), heat colour, Fresnel with a
clamped cosine, smooth minimum, `band`, `layer` and `unlayer`. Every helper with a layout is pure.
`stage/breath-geometry.js` is gone: the rebuilt worlds build their own glow tubes and petals.

| File | Role |
| --- | --- |
| `stage/breath-world-host.js` | Tiers, the camera rig, breath signals, world lifecycle. |
| `stage/breath-post.js` | Bloom, shafts, grade and lens (new). |
| `stage/breath-stage.js` | Renderer, canvas, frame loop; the 20 s pipeline wait. |
| `worlds/<world>.js`, `worlds/<world>-*.js` | One module per world, with helpers for the larger ones (`sacred-solids`, `sacred-floor`, `lotus-flower`, `lotus-pond`, `crystal-gem`, `crystal-light`, `volcanic-spatter`). |

## How the worlds are built

Most worlds are painted: one backdrop node on a clip-space quad, computed per pixel, with real
geometry only where it earns its place (Heart Glow's 27 petals in one mesh, Sacred Geometry's
solids, Crystal Prism's quartz, the galaxy's 9,000 star sprites, the lava fountain's clots). The
techniques that carry the look:

- **Rays instead of layers where perspective matters.** Moonlit Waters intersects each sea pixel
  with the water plane, takes its normal from 22 analytic waves and reflects the view ray into the
  same sky painted above, so the moon-path is glitter physics. Waves too fine for a pixel become
  roughness, so the horizon never aliases. Ocean Tide, Volcanic Fire, Heart Glow, Zen Garden and
  Sacred Geometry put their ground or water on a true perspective plane with per-pixel parallax.
- **Tracing small solids in the fragment shader.** Zen Garden sphere-traces its stones (ellipsoids
  cut by fracture planes, weathered by noise) inside bounding spheres; Crystal Prism traces its
  quartz through the same 18 half-spaces its mesh is built from: refraction, up to three internal
  segments with total internal reflection, and dispersion per channel on the way out.
- **Closed-form light.** Aurora curtains are solved per pixel, not marched; the crystal's heart
  and beam are line integrals; prominences, filaments and the forest's backlit trunks are distance
  fields with analytic glow.
- **Aerial perspective and backlight.** Far things dissolve into the air colour (the forest's rows,
  the nebula's walls, Aurora's ranges); key lights rim what stands before them.

## What it cost

The shaders are heavier: per world, the largest WGSL module and all modules together, measured
with `scripts/capture-breathing-headless.mjs --shaders` (a size, not a compile time).

| World | Before: largest / all | After: largest / all | Draw calls after |
| --- | ---: | ---: | ---: |
| Aurora Dreams | 18 / 65 KB | 46 / 121 KB | 15 |
| Sacred Geometry | 7 / 39 KB | 84 / 275 KB | 50 |
| Moonlit Waters | 11 / 50 KB | 73 / 170 KB | 14 |
| Solar Flare | 11 / 49 KB | 31 / 91 KB | 16 |
| Heart Glow | 6 / 44 KB | 34 / 161 KB | 31 |
| Crystal Prism | 7 / 47 KB | 35 / 146 KB | 24 |
| Volcanic Fire | 8 / 36 KB | 52 / 147 KB | 17 |
| Ocean Tide | 9 / 32 KB | 39 / 103 KB | 14 |
| Zen Garden | 14 / 43 KB | 64 / 164 KB | 16 |
| Cosmic Nebula | 8 / 44 KB | 50 / 157 KB | 18 |
| Ancient Forest | 13 / 41 KB | 59 / 151 KB | 17 |
| Electric Storm | 20 / 47 KB | 45 / 124 KB | 17 |

Solar Flare, Crystal Prism and Zen Garden first came in at 172, 176 and 139 KB; turning their
JS-unrolled repetition into shader loops brought them to the figures above with frames identical to
rounding (max abs diff 1/255). The breathing stage's lazy chunk is 206 KB (74 KB gzip); it loads
when a practice starts, so boot is unaffected (`check-boot-closure` passes).

### Things this pass paid for

- **A tall screen finds every unbounded term.** The forest's fern rim was `exp((line − y) × −60)`;
  above the line, on a 16:9 frame it overflowed only to the float maximum and was masked away, but
  on a 390 × 844 screen (more than twice the height in hero units) it reached infinity, and the
  masked `mix` returned NaN: the top 60 % of the phone frame went black. Bound before masking —
  the old rule, with a new way to break it.
- **Screen-space shafts streak along anything aligned with the ray.** Under a light near the middle
  of the frame, every bright vertical trunk rim smeared to the bottom of the screen and a thin trunk
  straight below the sun cast a ruler-straight shadow line. Emitters are limited to the light's
  neighbourhood (`radius`) and to a `region` above a line, the march is shorter (`length`) so the
  light does not veil the frame, and its last steps fade so a large emitter has no hard rim.
- **Cusps read as lines.** `exp(−|x − sunX| × k)` drew a hairline down the screen at the sun's x;
  gaussians or `1 / (1 + x²)` instead.
- **JS-unrolled repetition multiplies the shader.** A `forEach` that emits a feature's TSL per
  element (47 painted quartz points, 84 coronal-loop segments, 30 maple leaves) inlines every copy
  and hoists its variables: Crystal Prism's backdrop had a 135 KB `main()` with 974 private
  variables. One `Loop` over a `uniformArray` of the same values emits the body once.
- **A stage binds at most twelve uniform buffers.** Each `uniformArray` is its own uniform buffer;
  one world's fifteen arrays (and another's thirteen, with the object buffer counting too) failed
  WebGPU validation. Pack a world's data into one array of `vec4` rows.
- **A slow compile shows as a black world.** In the real game a switch from Zen Garden to Moonlit
  Waters revealed the canvas at the old 5 s cap while the new backdrop was still compiling; its draw
  was skipped and the world showed black. Hence the 20 s wait.
- **A tall screen sees more of everything.** Horizons that sink with `ext.y`, lights placed from
  the top of the screen, rims that fall off with 2D distance, a cloud bank kept below the frame
  where its lit rim would close pillars into a box — a layout that only worked at 16:9 is not done.

## Verification

`scripts/capture-breathing-headless.mjs` renders the shipping host from the playground in
headless Chromium on SwiftShader — WebGPU on its Vulkan adapter, the WebGL2 backend on ANGLE —
for cloud sessions where Electron has no GPU (a harness-only shim strips the string `swizzle` that
three r186 sends and that Chromium build predates). `scripts/capture-breathing-ingame.mjs` boots the
game, enters Serenity Mode and drives the real guide.

```sh
node scripts/capture-breathing-headless.mjs --sheet=pairs,portrait,webgl
node scripts/capture-breathing-headless.mjs --sheet=motion --worlds=deep-relaxation,coherence
node scripts/capture-breathing-headless.mjs --sheet=single --worlds=calm-sleep --breath=1 --phase=1 --shaders
node scripts/capture-breathing-headless.mjs --posters
node scripts/capture-breathing-ingame.mjs --worlds=zen-garden,calm-sleep --width=1440 --height=900
```

What was checked:

- **Every world, empty and full, landscape, on WebGPU** (High); **at 390 × 844 on Low** (the phone
  tier, with its post pipeline); **on the WebGL2 backend** (Medium); **on Minimal** (no post);
  **across a real breath cycle** (motion sheets). No console errors, warnings or validation
  messages in any capture.
- **The real game**, desktop and phone viewports: Serenity Mode → guide → world changes. The guide
  picked High on the desktop viewport and Low on the phone one, both with the post pipeline, and
  every world arrived drawn after a change.
- **The shader refactors** against the frames they replaced: max abs diff 1/255.
- **Gates:** the full unit suite (575 files, 7,601 tests), typecheck, dependency boundaries, the
  lint ratchet (no new errors; 0 errors in the breathing code), the production build and the boot
  closure. In two full runs under heavy CPU load from concurrent captures, four and then five
  unrelated time-bounded tests failed (different ones each time: timeouts and one wall-clock bake
  budget); alone, and in a full re-run on a quiet machine, all pass.

Not measured: frame cost on an integrated GPU or a physical phone, and shader compile time on D3D12
(DXC) and mobile GLSL drivers — the shaders are 3–6 times their previous size. The tiers are set
by reasoning, not by a perf-lane reading (ADR-0016). Software rendering gives pixels, not timings.

## Open

- **Measure** Low on a physical phone (0.9 MP, 30 Hz) and High on the integrated GPU, and the world
  change's compile wait on Windows; the heaviest are Sacred Geometry (50 draws, 275 KB of
  shaders) and Moonlit Waters. Zen Garden's `marchSteps` and Moonlit's wave count are the first
  knobs if Low is tight.
- **Motes** are additive round glows only: a shape option (a leaf or petal silhouette that spins)
  and an alpha-blended mode would give Zen Garden real falling leaves and Heart Glow drifting
  petals; a mirror option would put Heart Glow's fireflies in the water.
- **Minimal** has no grade; a world that wants its exact colour there corrects it itself.
