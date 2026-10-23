# Breathing worlds — moods, life and atmosphere (October 2026)

The twelve breathing worlds of the [masterpiece pass](BREATHING_WORLDS_MASTERPIECE_2026-10.md) were
the same picture on every visit: one fixed seed, one palette, and nothing that happened between
breaths. This pass gives every world several **moods** (another hour, weather, season or colour of
light), a little **life** (rare, gentle events), more **atmosphere** (falling leaves, petals, snow,
mist, spray), and per-visit variation in the details. The stage, the guide, the tiers and the
Hale sessions are unchanged except where this record says so.

Captures: [reports/breathing-moods-2026-10](../reports/breathing-moods-2026-10/README.md).

## What the player gets

Every world now comes in four moods. A visit shows one, never the one the last visit to that
world showed; the first mood is the Hub poster's. Between breaths, something occasionally happens.

| World | Moods (the first is the poster's) | Atmosphere added | Rare events |
| --- | --- | --- | --- |
| Aurora Dreams | Emerald Night · Crimson Storm (red tops over green, light snow) · Crescent Snowfall (a young moon with earthshine, a faint veil, falling flakes) · Blue Hour (deep blue, a warm band of coming day, pale snow) | Ice fog breathing on the lake, frost glints on the banks; the curtains hang differently each visit | A meteor, mirrored in the lake; a patch of diffuse aurora that pulses three times and fades |
| Sacred Geometry | Golden Temple · Moonstone (silver on deep blue, falling flakes of light) · Emerald Rose (rose-gold in emerald haze, falling rose petals) · Alabaster Dawn (copper light, a marble floor, a dawn band) | A low mist bank on the floor, lit by the core | A hexagram constellation draws itself star by star; a wave of light runs out along the Flower of Life; meteors in Moonstone |
| Moonlit Waters | Full Moon (now with a boat's lantern far out) · Crescent & Milky Way · Harvest Moon (a large amber moon just risen, a lamp on the shore) · Sea Fog (fog banks over the islands, a lighthouse beam turning once every 24 s) | Fog banks and mist wisps; lights on the water, each reflected; cloud decks differ per visit | A meteor; a fish jumping in the moon-path, its rings traced by the glitter; a cloud drifting across the moon (the path dims by up to 60 % over about 6 s) |
| Solar Flare | Golden Star · Red Giant (rising like a horizon, a few huge slow convection cells, a dust shell) · Blue Star (with a ringed planet crossing the limb) · Total Eclipse (a pearl corona, a pink rim, a diamond-ring bead) | A faint galaxy band far behind every star | A coronal mass ejection blooming off the limb over several seconds; a comet with an ion tail straight away from the star and a curved dust tail |
| Heart Glow | Rose Night · White Dawn (a white lotus on a misty pond at first light) · Blue Moon (a blue lotus, the moon's path on the water) · Lantern Festival (nine floating lanterns, sky lanterns rising) | Falling petals; sun and moon paths on the water; mist that differs per visit | A petal lands and sends out a ring; a koi glides under the pads with a faint wake |
| Crystal Prism | Blue Grotto · Amethyst Cave (violet quartz, thick cool mist) · Citrine Hour (a warm, low golden beam) · Frost Cavern (a cold silver beam, snow sifting down, rime) | A mist bank on the wet floor, lit by the fan; dust glints | A drop falls from the vault and rings spread on the floor; a bead of light climbs the crystal's edges |
| Volcanic Fire | Night Eruption · Violet Dusk (afterglow, the far cone black against it) · Starlit Lake (a quieter vent, a moon, the galaxy) · Ash Storm (a low red ceiling, a wide plume, ash sweeping over the lake) | Ash falling out of the plume as tumbling flakes; the cloud deck moves with the visit | Lightning inside the plume as a slow violet glow, never a strike; a lava bomb arcs out and lands with a ring of light |
| Ocean Tide | Golden Hour · Midday Lagoon (a high sun, glass-clear turquoise) · Rose Dusk (the sand mirroring a coral and violet sky) · Glowing Tide (moonlit, the surf glowing blue with plankton) | Sea-spray haze over the surf; cloud shadows and the shoreline differ per visit | A ray glides along the lagoon with its shadow on the bed; a gull's shadow sweeps across (daylight) |
| Zen Garden | Autumn Moon (now with real falling maple leaves) · Snowy Dawn (snow on sand, stones, wall and lantern; a bare branch; a pink sun) · Spring Dusk (cherry blossom, falling petals) · Morning Rain (dark wet sand, water in the grooves, slanted rain) | Leaves, petals, snow or rain by mood; mist that differs per visit | A meteor on the autumn night; a bird crossing the dawn and dusk skies; a single leaf or petal spiralling down near the lens; a mist bank drifting across the garden |
| Cosmic Nebula | Galaxy Window · Emerald Veil (emerald and gold, the galaxy face-on) · Crimson Deep (the galaxy edge-on like a blade) · Dark Rift (a fibrous lane of cold dust across the galaxy) | Specks of dust between the viewer and the galaxy, some out of focus; the far dark lanes fray into wisps | A nova brightening beside the galaxy and fading to hydrogen red, with a light echo; a meteor |
| Ancient Forest | Dawn Canopy · Autumn Gold (amber canopy, leaves on the floor) · After the Rain (blue mist, wet bark, puddles) · Amber Evening (a low sun between the trunks, level shafts) | Falling leaves; mist banks drifting between the rows | A bird crossing the lit mist; a gust that stirs the canopy and sends down a flurry of leaves; a cloud passing over the sun (in After the Rain, the sun breaking through) |
| Electric Storm | Violet Studio · Rain on the Window (a defocused night city behind wet glass, beads and slow runnels) · Teal Smoke · Amber Neon (two soft neon signs on the far wall) | A fine dust cloud near the globe catching its glow | A filament reaches a spot on the glass and holds there, as if touched, then lets go; a static spark drifts up from the glass |

Things that were wrong and are fixed on the way:

- **Heart Glow never drew again after its first build.** Its halo sprites used three's shared
  Sprite geometry, which the host disposes when a world leaves, so a return or any second build
  submitted a destroyed buffer ("Buffer used in submit while destroyed") and the world stayed
  black. Each sprite now has its own copy, and a test builds every world twice in one host and
  requires the second build to share nothing with the first (it fails on the old Heart Glow).
- **Ancient Forest's far trunks drew bright hairlines** (a barcode on phones): the rim light raised
  an unclamped edge value to the 7th power, which reaches 2–3 on trunks a pixel or two wide. Its far
  rows also stood as tall as a portrait frame; they now fade into the haze a fixed height above their
  ground, and dense foliage no longer shows pin-holes.
- **Volcanic Fire's far melt** read as a flat yellow-olive smear on the horizon; it cools to dull
  orange under the haze.
- **Moonlit Waters** took a `pow()` of a signed value (undefined on some GPUs); now a square.

## How it works

**Moods.** Each world module exports `MOODS`, the versions of its scene a visit can show; the
first is the one its Hub poster shows. A builder receives the chosen entry as `mood` and reads its
palette, positions and toggles as build-time constants: no uniforms, no extra pipelines (a world
is compiled when it is shown anyway, and a mood is part of that build). A mood may also change the
world's grade, bloom, shafts, motes and exposure. `worlds/index.js` exposes `BREATH_WORLD_MOODS`.

**Picking one** (`stage/breath-moods.js`). The host picks a mood the first time it shows a world,
never the one the previous visit to that world showed on this device (`serenity.breathMoods` =
{ world id: mood index } in localStorage; without storage the pick is just random). The host then
keeps that mood, and the visit seed, for the rest of its life, so a Hale session that leaves a
world and comes back (Flow's square, triangle, square) finds the same scene. Captures and the
playground pin both: `setWorld(id, { mood, seed })`, `?mood=<index|id>&seed=0..1`.

**Two new uniforms** (`stage/breath-tsl.js`):

| Uniform | What it is |
| --- | --- |
| `u.seed` | 0..1, the visit's own variation: offsets clouds and mist, and every event timetable, so the same mood differs a little each visit. |
| `u.life` | 0..1, how freely events may happen: 1 normally, 0 under reduced motion, 0.25 in a retention hold, eased (never switched). Every rare event is multiplied by it. |

**Rare events.** `eventWindow(time, period, duration, chance, salt)` is a closed-form timetable:
each period a dice roll decides whether the event happens, at a random moment inside the period,
and it returns the envelope (soft ramps), the progress through the event and a random id for it.
No CPU state, so `seek()` reproduces any frame. `shootingStar(p, u, opts)` is built on it.
Nothing flashes: events are small or slow, and large brightness changes ramp over a second or
more (the guide's photosensitivity rule).

**Shaped motes** (`stage/breath-motes.js`, the masterpiece record's open item). A mote cloud may be
a silhouette (`shape`: `leaf`, `petal`, `maple`, `flake`) instead of a round glow, spinning
(`spin`), tumbling (`tumble`: its width swings through edge-on as it turns over) and see-sawing
as it falls (`flutter`), and may be drawn alpha-blended (`blend: 'alpha'`): solid things the
scene lights, not light themselves. Near the lens a silhouette blurs into a soft blob of its
colour, like the round motes' bokeh discs.

**How the worlds use it.** Mood-only work is left out of a mood's shader entirely (rain, floating
lanterns, the window and city, lightning, marble, the red giant's shell), and event code runs
inside an `If` on a value that is the same for every pixel, so it costs nothing while no event is
on. Layout functions (`setLayout`) are emitted once and cached across materials, so a colour read
from the mood inside one would stick at whichever mood compiled first: worlds pass mood colours in
as parameters (Crystal Prism's `quartzShade`, `quartzInner`, `prismEnvironment`) or build the
function once per mood (Aurora's curtains). Every world kept `u.seed = 0.5` identical to its old
look where it could, and the posters' frame (seed 0.5, t 12) shows no event.

## What it cost

WGSL compiled per world, largest module and all modules, measured on the RTX 5080 by hooking
`GPUDevice.createShaderModule` in the playground (one fresh build per world and mood; shared
post-pipeline modules compiled earlier are not counted, so "all" is smaller than the masterpiece
record's figures). Before is the same commit's infrastructure with the old worlds. A size, not a
compile or frame time.

| World | Before: largest / all | After, over its four moods: largest / all |
| --- | ---: | ---: |
| Aurora Dreams | 45.5 / 51.8 KB | 50.7–51.6 / 57.0–64.4 KB |
| Sacred Geometry | 84.2 / 178.1 KB | 90.4–92.1 / 184.3–192.5 KB |
| Moonlit Waters | 72.9 / 73.5 KB | 81.5–82.6 / 82.1–83.2 KB |
| Solar Flare | 31.1 / 47.1 KB | 33.7–39.7 / 49.7–55.7 KB |
| Heart Glow | 34.0 / 114.1 KB | 38.8–43.5 / 121.5–129.4 KB |
| Crystal Prism | 35.1 / 97.7 KB | 40.3 / 107.1–113.7 KB |
| Volcanic Fire | 52.1 / 70.9 KB | 56.3–59.1 / 77.4–84.5 KB |
| Ocean Tide | 39.0 / 39.6 KB | 44.7–45.9 / 45.3–46.5 KB |
| Zen Garden | 64.4 / 75.8 KB | 64.2–70.4 / 71.2–83.0 KB |
| Cosmic Nebula | 49.6 / 83.0 KB | 53.0 / 94.1–97.1 KB |
| Ancient Forest | 58.6 / 79.7 KB | 66.3–68.5 / 94.0–96.2 KB |
| Electric Storm | 44.9 / 66.0 KB | 51.0–51.9 / 77.3–78.2 KB |

The largest module grew 5–9 KB per world (about 10–15 %); worlds that gained a mote cloud (falling
leaves, ash, dust) have one or two more pipelines. No textures, render targets or uniform arrays
were added. The breathing stage's lazy chunk grew from 206 KB (74 KB gzip) to 294 KB (105 KB gzip);
it still loads only when a practice starts, and the boot closure is unchanged. Frame time was not
measured: the GPUs were shared with other sessions all afternoon,
and earlier passes found sub-millisecond A/B differences unresolvable then.

## Verification

- **Every mood of every world** (48 scenes) on WebGPU at High, 1280 × 720 (`breathing-moods.jpg`),
  at 390 × 844 on Low (`breathing-moods-portrait.jpg`) and on the WebGL2 backend at Medium
  (`breathing-moods-webgl.jpg`), from the merged branch: no console errors, warnings or validation
  messages in any capture.
- **The events**, one or two frames per world (`breathing-events.jpg`), and each world's events at
  `reduce=1`, where they vanish and the scene stays complete.
- **Per world, during the pass:** every mood empty and full in landscape and portrait, the Minimal
  tier (no post) and, for most worlds, the WebGL2 backend.
- **Posters** re-baked from mood 0 (`scripts/capture-breathing.mjs --posters`); they differ from the
  old ones only by the new mist, fog and frost (`posters-before-after.jpg`).
- **Tests:** `breath-moods.test.js` (the no-repeat pick, storage failures, resolving a request);
  `breath-worlds.test.js` builds every world in every mood, keeps a world's mood and seed for the
  host's life, eases `u.life`, and rebuilds every world without reusing what it disposed.
- **Gates:** typecheck, the ts, lint and fitness ratchets at baseline, dependency boundaries, the
  theme lifecycle audit, the IP string gate, the full unit suite and the production build.

```sh
node scripts/run-electron.mjs scripts/capture-breathing.mjs --baseUrl=http://127.0.0.1:5173 --sheet=moods
node scripts/capture-breathing-headless.mjs --sheet=moods --worlds=zen-garden,calm-sleep
# one mood, one visit seed, in the playground:
#   /playground.html?effect=breathing&world=zen-garden&mood=snow-dawn&seed=0.3&breath=0.8&t=12
```

## Open

- **Frame cost** on the integrated GPU and a phone, as the masterpiece record already asks; the
  heaviest moods are Sacred Geometry's (largest module 92 KB) and Moonlit Waters' (83 KB).
- **The guide does not name the mood.** The header shows the world's name; "Zen Garden · Snowy
  Dawn" would say the variation out loud. A UI change with its own in-game check.
- **Event times are hard to predict for captures.** `eventWindow` runs in f32 on the GPU, and a
  double-precision JS copy picked windows that never happened; two agents wrote f32-emulating
  replicas. A shared, exported JS twin (or a `__BREATH_LAB__.events()` listing) would make event
  frames easy to hit, and folding the salt through `fract` before hashing would spread the
  timetables more evenly.
- **The shaft `radius` is read only when a world is set** and is in screen heights, so on a tall
  screen the area that can throw rays is about twice as large in scene units; `breath-post.js`
  could re-read it each frame or take it in hero units.
- **WebGL2 only:** Heart Glow at exactly t = 7.0 drew a large white glow over the flower; t = 6.9
  and 7.1 are clean, WebGPU never does it, and the old code does it too. Probably a NaN or Inf at
  that instant in the post chain; not chased.
- **Motes:** a streak shape would let rain be motes instead of painted into backdrops, and a mirror
  option would put Heart Glow's fireflies in the water.
- Judgement calls worth a second look in the real game: Ash Storm is the mood closest to its
  world's poster; the fish's rings are subtle away from the moon-path; the red giant's cells read a
  little like honeycomb on a phone.
