# Odyssey — Masterpiece Pass (2026-10)

**Status: LANDED on `feature/odyssey-masterpiece`** (integration branch; chapter branches
`feature/odyssey-mp-{world,space,urban}` merged into it). A whole-journey visual pass on all
eight chapters, run as four parallel sessions with file-disjoint ownership and one shared GPU
lock, every change screenshot-verified (ADR-0007) at fixed clock (`--time`) with the corrected
capture settle. Three.js is `0.186.1` (r186) throughout.

The owner's brief: make Earth Core, the deep ocean, the surface world, the mountains, the sky,
space, the black hole and the urban encore "a magical experience and visual masterpiece" —
atmosphere, environment, water, lava, pillars, particles, fish, planets, composition, feeling.

---

## 0. What the pass found first (read this before tuning anything)

Four defects were hiding under every look decision in the journey. Each was found with an
instrument, not by eye, and each invalidated earlier tuning:

1. **The capture harness photographed stale frames.** At the default 350 ms per-station settle,
   stations that bring new materials into view (Act II forest LODs, flowers) present an old
   compositor frame while their pipelines compile — five "identical" ch3 frames while the JSON
   sidecars showed the camera flying 230 u. `--settle=2500` is now mandatory (seam stations
   too). Any A/B older than this pass may have compared stale images.
2. **The post grade ran its "display-space" curves on linear values** (`566c258d`). The master
   black crush (−0.018 per channel) and every S-curve pivoting on 0.5 ran on the LINEAR ACES
   output, so master contrast 1.07 zeroed every channel below linear 0.033 (sRGB ≈ 50) and
   Deep Ocean's 1.12 everything below 0.054 (sRGB ≈ 65). Dark frames lost their
   non-dominant channels: Earth Core rendered ~(110,0,0) pure red over warm greys, dark water
   collapsed toward flat pure blue. The grade now runs on a gamma-2.2 encoding and returns to
   linear before the vignette; the shoulder knee is carried across. **Every chapter's palette
   had been tuned by eye on top of this — re-tune against the corrected grade, never re-crush.**
3. **Chapter-length-dependent windows were never rescaled when the layout grew** (1767 → ~2533 u).
   The steam quench's 0.06 approach (authored for a 0.093-long chapter 1, now 0.0649) veiled
   92 % of Earth Core; the board mapped progress linearly across the asymmetric window, so the
   warm→cool flip happened before the crossing it hides.
4. **The Urban camera was rolled up to −90° relative to the city** (found by the urban session):
   the "stairs" frames were towers lying on their side, the sun billboard faced the world origin.

Instruments added: `odyssey-chapter-capture.mjs --settle=N`, `--hide=name,prefix*,@sprite,@all,
@unnamed` (layer bisect — it is how the Earth Core wash was traced: every chapter layer hidden
still left the frame red; `@all` made it black; `@unnamed` found the god-ray cones), and the
shared GPU lock `C:\Users\olov_\repos\odyssey-gpu\gpu-run.sh` for parallel sessions.

---

## 1. Chapter 1 — Earth Core

**Before:** a saturated red room; leopard-print pillars; a beige noise ceiling over half the
chapter. **After:** a dark basalt cathedral lit only by fire, an updraft of embers rising with
the camera, a cool crack of light at the crown that widens as you climb, then a steam climb of
rays into the white flash where fire meets water.

The red wash had five independent sources (bisected, then fixed):
| Source | Fix |
|---|---|
| Corridor-field filler: a 600 u ADDITIVE orange sheet + a 780 u oxblood one, placed "behind the chapter centre facing back down the tangent" — horizontal and overhead in a vertical shaft | ch1 recipe has no sheets (`odyssey-corridor-field.js`) |
| Three god-ray cones on the shaft axis — the camera rose INSIDE their DoubleSide additive walls (mean colour 79,25,9 → 33,13,8 without them) | moved to the colonnade edge, flipped tip-down as documented, faded when the eye nears a cone's axis |
| Zero-blue "brown" atmosphere (pure red-orange in linear) | re-paletted from the Act I colour script's charred-indigo cathedral; fog 0.014 → 0.0035 so the vault is finally visible |
| Additive red haze (112 billboards on the rail), in-your-face magma horizon (additive, depthTest off, ~6 u from the opening camera), invisible crater-rim cloud | haze is normal-blended warm-grey smoke; horizon + rim removed (2 material slots freed) |
| The grade (§0.2) | fixed globally |

Then the look: the playground value study's vault is ported (charred indigo body, darkness-gated
ember filaments at crack scale, ember points, the crown crack driven by ascent); the rock
material became basalt — charcoal albedo in plates and colonnade joints, heat ONLY as emissive
(cracks along the columns, the lake's light on downward faces, the waterline splash kept) —
~21 noise bodies per fragment became ~6 baked fetches; risers rise the whole shaft; the lake's
far rim is a broken glow instead of a laser line. The quench has its own 0.034 approach
(clear first half, ~0.93 dense where Act II starts drawing — ADR-0017 holds), a boundary-true
`steamQuenchSeamT`, rising columns of vapour lit from below, rays from the crack, and a
luminous-tunnel falloff instead of a flat white-out. Verified on WebGPU High/Low and WebGL2.

## 2. Chapter 2 — Deep Ocean (One World)

**Before:** a flat, uniform blue void with tiny near-black sliver fish; light shafts drawn but
invisible; ~3/7 of the fish and motes seeded inside the Earth Core shaft, under the seabed.
**After:** a luminous water column — light shafts fan overhead (12, now legible), a caustic
light net on the surface seen from below, luminous teal near the surface leaning to indigo in
the deep, twinkling motes with rare larger glows; four countershaded fish schools (silver,
teal, one small gold) wheeling on fixed paths in open water and flashing as they turn (still
one draw); and a humpback mother and calf circling overhead as back-lit silhouettes.

- World session: open-water-only seeding, schools, underwater light, seabed palette, floor
  caustics fading with depth (`world/odyssey-world-renderer.js`).
- Integrator: the whale pass (`composition/odyssey-whale-pass.js`, the project-owned
  `whale-glide.glb`). Zero-hitch: created hidden and GPU-free, fetched after the reveal,
  compiled through the live-loop path (`_compileGroupThroughPost(.., { live: true })`), only
  then drawn; idle-gated with a 4 s starvation escape; `?odysseyNoWhales=1`. The orbit is tight
  (32 u) because the near-vertical camera only sees a ~25–45 u circle overhead at the pair's
  height. Look bench: `?effect=ocean-whale-pass`.

## 3. Chapter 3 — Surface World (One World)

**Before:** flat cyan sea with paper-cutout white foam blobs; a static shore; muddy khaki
meadows. **After:** the sea reflects the sky in the direction it faces in four painted bands,
jade wave backs, deeper troughs, sparse glitter; the shore laps on one swash cycle shared with
the wet sand, foam lines travel in toward the beach, whitecaps are lace (the foam zone widened
to ~10 m because the beach is steep enough that 0.1–3.5 m was 2–6 px tall); trees take the
terrain's baked shadow and one gust drives grass, sway and canopy light together; meadows
decide between clean green and gold. (The sun road cannot show: the Act II sun is behind the
camera.)

## 4. Chapter 4 — Mountains (One World)

**Before:** the massif read as a beige dune. Four causes, each fixed: the snow slope limit
stripped the summit cone bare; a quarter of every summit pixel blended gold dry grass; warm
alpenglow covered every face (the act is lit from behind the camera); rock ribs were off at
every distance the mountain is seen from. **After:** snow and grey stone with ribs and
couloirs, snow shadow luminous and blue (a new ground-bakes test pins it), and valley mist
pooling at the massif's feet when seen from the climb (gated above y=350 so ch3 is untouched).

## 5. Chapter 5 — Sky Drift and the departure to space (One World)

Clouds use their baked creases and crown heights (cauliflower, not potatoes) and take light
from a sun behind the camera: warm crowns, lit rims, a silver lining toward the sun (subtle
inside the 0.10 gain cap). The departure is zenith-first: black overhead, a thin blue limb and
green airglow line that appear only once the sky above is dark; the colour script now reaches
its edge-of-space keyframe; the cloud bank below is a soft continuous cloud sea instead of a
white-and-navy camouflage plane, and the last cumulus sink into it. 5→6 seam metrics: max
step −20.4 (≤ 45), end luma 34.1 (≤ 60); the one +5.0 rise after the boundary predates this
pass (chapter 6's aurora arriving).

## 6. Chapter 6 — Space & Cosmic Expanse (space session)

**Before:** opaque "plasticine" nebula lumps with lit crests and dark holes, a huge red/pink
smear, a starfield drawn IN FRONT of every hero, a small flat-striped gas giant.
**After:** each nebula mass is a seeded cluster of soft ellipsoids rendered as additive
emissive gas — dissolving edges, wispy rims, accent filaments, dark lanes (still 2 draws);
the smear (a crimson aurora bridge alive until 85 % of the chapter, plus a rust galactic lane
in the baked dome) is gone; stars moved to r ≈ 1700–2280 behind everything, 45 % of the far
tier on the galactic band, per-star alpha twinkle, spikes only on the brightest class; the
gas giant is 1.35× with limb-peaked, sun-following atmosphere and ring↔planet shadows; the
galaxy is a 60°-inclined spiral (bulge, arms, pink knots, dust lanes); asteroids are rim-lit
rocks; sprites face the camera (`billboardLocal`). Integrator: the baked band is a faint glow
under the stars instead of a grey smoke shape (bisected to `void-sky-baked`).

## 7. Chapter 7 — Black Hole & Abstract Transcendence (space session)

**Before:** a washed-out pink fog ring around a dark ellipse, purple noise walls, a tiny swirl.
**After:** Gargantua — a black shadow (~25 % of frame height), a thin white-hot disk 6° off
edge-on with the lensed far side arcing over the top, Doppler-bright approaching limb from
the real orbit direction, bounded rotation (no aliasing over a session), deep starfield.
Removed: a lensing shell hidden inside the horizon, an off-frame halo, a second entry hole,
five mini-holes, glow rings, a depth-test-off purple wash, an unreachable dome, 18 infall tubes.

The post lens had **y upside down on WebGPU** (top-left screen origin), centring a black-cored
warp on the hero's mirror image: that was the "tiny swirl" — a phantom second black hole that
also bent the rail. It is now aspect-correct, sized to the shadow's projected radius, never
pulls the shadow outward, and bloom is masked inside the shadow. Per-chapter bloom
strength/threshold/radius multipliers exist (uniforms only; ch1–5/8 rows pinned to today's
values). The ch6 omen is built from ch7's parts and glides onto its pose, so the 6→7 seam
shows one black hole throughout; integrator quieted the 6→7 threshold to a gold accent.

## 8. Chapter 8 — Urban Dreams Encore, and the journey camera (urban session)

**Before:** a canyon of towers tiled in a uniform mosaic of random coloured windows, seen
rolled on its side. **After:** an upright rain-washed boulevard: dark towers with whole lit
floors (mostly dark, warm/cool per building), eight neon-trimmed hero towers, the spire as a
dark silhouette with energy seams against the Retrosun, a glossy wet street with long neon
reflections, rain that falls along the city's down and catches the neon, twelve holo signs
along the corridor, white-hot traffic streaks converging on the spire.

- Camera rides a new shared stage frame (`composition/odyssey-stage-frame.js`); new framing keys
  `fovOffset`, `pitchDeg`, `yawDeg`, `stage`, `stageAim` (default 0 — chapters 1–7 verified
  bit-identical over a 6000-sample sweep). The ch8 crane is a real tilt-up (+12°, FOV +6).
- One finale clock (dark arrival → ignition 0.35–0.9 → settle), published by the director as
  `urbanReveal`; a ring of light spreads across the city from the spire.
- A held arrival shot at p ≥ 0.997 (24° orbit, slight push-in, spire on the right third);
  breathing applied after the follow lerp so it is felt; a single-hump FOV pulse.
- Rain and the bridge billboard now ride the 7→8 crossfade instead of popping.

---

## 9. Verification

Per-item captures live in each worktree's `artifacts/odyssey/iter/`; baselines (correct settle)
in `serenity-blocks-odyssey/artifacts/odyssey/baseline/chNN/`. Odyssey test suites pass; note
that the wall-clock bake-budget tests (`odyssey-cosmic-backdrop`, `odyssey-cloud-field`,
`odyssey-forest-lever`, `odyssey-world-bake-loader`) time out under CPU contention from parallel
sessions — re-run them on a quiet machine before trusting a failure.

## 10. Open items

- Earth Core: the First Heart was staged for the old descending camera and is rarely in frame.
- Clouds seen from below are still flat masses; the summit snow/rock pattern is patchy; the
  ch4 slopes are cleaner but still a little drab; the ch6 comet (item 6) was not touched.
- Urban: the Gate Bridge event and the journey-end afterimage (nothing reads `journeyEnd` yet);
  the first ch8 frames are dominated by ch7's co-present motifs and the threshold veil.
- The Act II sun sits behind the camera (front-lit act); moving it is an owner call (baked
  shadows, one-sun test).
- Author seam widths and occluder windows in ARC units so the next re-layout cannot silently
  rescale them (chapter-profile.js already records this; the quench was its third casualty).
