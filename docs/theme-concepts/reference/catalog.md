# Visual catalog of the existing themes

> **Snapshot taken at commit 5d3478d (main, 2026-10-11) during the Rainbark design; line numbers drift, verify against the current code.**
>
> Part of `docs/theme-concepts/`: the index is [`../README.md`](../README.md) and the shared build procedure is [`../PLAYBOOK.md`](../PLAYBOOK.md). PLAYBOOK wins where the two disagree; it was written later and folds in what the Rainbark build learned.
>
> What this is: the visual identity of every theme in the game, so a new concept can be checked against all of them. It merges four read-only surveys of 15 themes each (60 themes: everything except `cosmic-chimes`, which was the theme being replaced and was never catalogued), plus a **Rainbark** entry (§61) added on 2026-10-12 from its spec. Cosmic Chimes no longer exists (`585ab55`), so the catalog now covers all **61** registered themes.
>
> How to use it: every entry ends with **"Avoid reusing"** (or "Do not reuse"): the motifs a new theme must not repeat. Part 0 and the cross-cutting sections at the end of each part list what is saturated across the fleet. The README in `docs/theme-concepts/` condenses them. For pictures, look at `docs/theme-screenshots/<id>.png` (the last fleet capture of each theme; `rainbark.png` does not exist yet) and at the capture folders named in each entry. A machine-readable copy with the same entries is [`catalog.json`](catalog.json).
>
> The four surveys used slightly different formats (bullets, tables), which are kept. Sources per theme: the icon PNG (viewed), the `docs/*_OVERHAUL_2026-10.md` record where one exists, its capture sheets, the theme module header and `<id>-tetrominos.js`. Hex values and line numbers are as of `5d3478d`.

## Index (registry order; group and class read from the registry on 2026-10-12)

| Registry order | Theme id | Display name | Group | Class | Catalog entry |
|---|---|---|---|---|---|
| 1 | `forest` | Forest | `biomes` | heavy | [§1](#forest) |
| 2 | `halcyon-apex` | Halcyon Apex | `biomes` | heavy | [§2](#halcyon-apex) |
| 3 | `himalayan-peak` | Himalayan Peak | `biomes` | heavy | [§3](#himalayan-peak) |
| 4 | `ice-temple` | Ice Temple | `biomes` | heavy | [§4](#ice-temple) |
| 5 | `spring` | Spring | `biomes` | heavy | [§5](#spring) |
| 6 | `wolfhour` | Wolfhour | `biomes` | heavy | [§6](#wolfhour) |
| 7 | `ocean` | Ocean | `biomes` | heavy | [§7](#ocean) |
| 8 | `sunset` | Sunset | `biomes` | heavy | [§8](#sunset) |
| 9 | `high-coast` | High Coast | `biomes` | heavy | [§9](#high-coast) |
| 10 | `winter` | Winter | `biomes` | heavy | [§10](#winter) |
| 11 | `fall` | Fall | `biomes` | heavy | [§11](#fall) |
| 12 | `summer` | Midsommar | `biomes` | heavy | [§12](#summer) |
| 13 | `tornado` | Tornado | `atmospheric` | light | [§13](#tornado) |
| 14 | `sakura-twilight` | Sakura Twilight | `biomes` | heavy | [§14](#sakura-twilight) |
| 15 | `aurora` | Aurora | `sky` | heavy | [§15](#aurora) |
| 16 | `galaxy` | Galaxy | `cosmic` | heavy | [§16](#galaxy) |
| 17 | `aether-tides` | Aether Tides | `cosmic` | heavy | [§17](#aether-tides) |
| 18 | `rainy-window` | Rainy Window | `urban` | heavy | [§18](#rainy-window) |
| 19 | `koi-pond` | Koi Pond | `biomes` | heavy | [§19](#koi-pond) |
| 20 | `verdant-hills` | Verdant Hills | `biomes` | heavy | [§20](#verdant-hills) |
| 21 | `rainbark` | Rainbark | `biomes` | heavy | [§61](#rainbark) |
| 22 | `serenity-warp` | Serenity Warp | `cosmic` | heavy | [§21](#serenity-warp) |
| 23 | `kaleidosonic` | Kaleidosonic | `meditation` | heavy | [§22](#kaleidosonic) |
| 24 | `starlight` | Starlight | `cosmic` | heavy | [§23](#starlight) |
| 25 | `golden-forest` | Golden Forest | `biomes` | heavy | [§24](#golden-forest) |
| 26 | `geode` | Geode | `cosmic` | heavy | [§25](#geode) |
| 27 | `bioluminescence` | Bioluminescence | `cosmic` | heavy | [§26](#bioluminescence) |
| 28 | `shifting-sands` | Shifting Sands | `biomes` | heavy | [§27](#shifting-sands) |
| 29 | `grainfields` | Grainfields | `biomes` | heavy | [§28](#grainfields) |
| 30 | `waves` | Waves | `biomes` | heavy | [§29](#waves) |
| 31 | `luminous-tides` | Luminous Tides | `biomes` | heavy | [§30](#luminous-tides) |
| 32 | `fluid-dreams` | Fluid Dreams | `abstract` | heavy | [§31](#fluid-dreams) |
| 33 | `crystal-cave` | Crystal Cave | `cosmic` | heavy | [§32](#crystal-cave) |
| 34 | `moonlit-greenhouse` | Moonlit Greenhouse | `biomes` | light | [§33](#moonlit-greenhouse) |
| 35 | `murmuration` | Murmuration | `abstract` | heavy | [§34](#murmuration) |
| 36 | `nebula-flow` | Nebula Flow | `abstract` | light | [§35](#nebula-flow) |
| 37 | `chromatic-impasto` | Chromatic Impasto | `abstract` | heavy | [§36](#chromatic-impasto) |
| 38 | `voltage-storm` | Voltage Storm | `abstract` | light | [§37](#voltage-storm) |
| 39 | `lunara` | Lunara | `cosmic` | heavy | [§38](#lunara) |
| 40 | `solar-eclipse` | Solar Eclipse | `cosmic` | heavy | [§39](#solar-eclipse) |
| 41 | `moonrise-summit` | Moonrise Summit | `biomes` | light | [§40](#moonrise-summit) |
| 42 | `black-hole` | Black Hole | `cosmic` | heavy | [§41](#black-hole) |
| 43 | `supernova` | Supernova | `cosmic` | heavy | [§42](#supernova) |
| 44 | `void-ember` | Void Ember | `cosmic` | heavy | [§43](#void-ember) |
| 45 | `cosmic-noir` | Cosmic Noir | `cosmic` | heavy | [§44](#cosmic-noir) |
| 46 | `chiral-gold` | Chiral Gold | `cosmic` | heavy | [§45](#chiral-gold) |
| 47 | `nimbus-veil` | Nimbus Veil | `atmospheric` | heavy | [§46](#nimbus-veil) |
| 48 | `rainbow-terraces` | Rainbow Terraces | `sky` | heavy | [§47](#rainbow-terraces) |
| 49 | `cinder-drift` | Cinder Drift | `atmospheric` | heavy | [§48](#cinder-drift) |
| 50 | `pyrestorm` | Pyrestorm | `fantasy` | heavy | [§49](#pyrestorm) |
| 51 | `neon-dusk` | Neon Dusk | `urban` | heavy | [§50](#neon-dusk) |
| 52 | `neon-district` | Neon District | `urban` | heavy | [§51](#neon-district) |
| 53 | `synthwave-sunset` | Synthwave Sunset | `urban` | heavy | [§52](#synthwave-sunset) |
| 54 | `chromadelic-highway` | Chromadelic Highway | `abstract` | heavy | [§53](#chromadelic-highway) |
| 55 | `stillwater` | Stillwater | `biomes` | heavy | [§54](#stillwater) |
| 56 | `blood-moon` | Blood Moon | `cosmic` | heavy | [§55](#blood-moon) |
| 57 | `astral-weave` | Astral Weave | `cosmic` | heavy | [§56](#astral-weave) |
| 58 | `stellar-velocity` | Stellar Velocity | `cosmic` | heavy | [§57](#stellar-velocity) |
| 59 | `stellar-drift` | Stellar Drift | `cosmic` | heavy | [§58](#stellar-drift) |
| 60 | `vesper-chrysalis` | Vesper Chrysalis | `fantasy` | heavy | [§59](#vesper-chrysalis) |
| 61 | `parhelion` | Parhelion | `sky` | heavy | [§60](#parhelion) |

"Class" is `getThemeMeta(id).performanceClass`: `heavy` means the id is in `HEAVY_GPU_THEME_IDS`.

## Part 0. Fleet-wide conventions (the `_fleet-conventions` entry)

Not a theme. These are the patterns survey 1 found already used heavily across the fleet; avoid them or deliberately subvert them. Parts 2–4 each end with their own cross-cutting list, and the README summarises all of them.

### Compositional clichés (already used by 5+ themes in this set)
- **Big moon, top right, blue night** — forest, wolfhour, winter, sakura-twilight, ice-temple (moon on the left), sunset (at night). Six themes.
- **Framing trees left and right, open vista in the middle** — forest (spruce/pine), fall (maple/oak), summer (spruce/weeping birch), sakura (weeping/spreading cherry), winter (snow-ghost spruces), aurora (spruce spits).
- **Mirror water across the bottom third** — halcyon-apex (lagoon), ice-temple (black lake ice), sakura (lake), summer (lake), aurora (lake), sunset (open sea), winter (frozen lake). Planar `reflector()` on Medium and up is the default technique.
- **Hero mountain or peak** — himalayan-peak, wolfhour, aurora (two massifs), sakura (Fuji-like cone), winter (round fells), halcyon (far ranges), ice-temple (mountains in the sky).
- **Low sun on the horizon with god-rays** — halcyon-apex, himalayan-peak, sunset, summer, fall, tornado; high-coast has the low sun and its glitter road at its golden hour and sunset, without rays.
- **Aurora curtains** — aurora, winter, ice-temple.

### Palettes already taken
- Navy/ink night with silver-white moon: forest, wolfhour (pure black-and-silver), ice-temple, winter.
- Oxygen-green and magenta aurora on dark teal: aurora, winter, ice-temple.
- Gold, peach and orange low sun with lavender sky: halcyon-apex, himalayan-peak, sunset, tornado, fall, summer, high-coast (golden hour).
- Turquoise or jade water: halcyon-apex, ocean.
- Pink and lilac: sakura-twilight, himalayan (alpenglow), sunset (magenta clouds), halcyon (rose hour).
- Snow white and ice blue: ice-temple, winter, himalayan, aurora.

### Gameplay-FX grammar the rebuilt fleet already shares (forming a house style)
1. **Lock: light leaves the card edge at the piece's height, in the piece colour.** Halcyon wisp, Himalayan paper wind-horses, Winter sparks, Sunset lantern-light arc, Tornado sparks, Ocean sinking light, Forest firefly puff, Fall leaf puff, Summer petals, Sakura glint and petals.
2. **Lock: a ring runs out from under the board's foot.** Ice-temple star fracture and ring, Halcyon lagoon ripple, Himalayan and Winter powder rings, Tornado gust ring in the wheat, Ocean sand ring, Sakura, Summer and Aurora lake rings, Forest moss wave.
3. **The world holds the piece colour for about 30 s and a clear releases it.** Halcyon great crystals, Himalayan flags, Winter sky, Ocean coral colonies (which "spawn"), Tornado ribbons, Sunset lanterns.
4. **Clear: "blades of light" leave the card at the cleared rows' heights.** Halcyon, Himalayan, Ice-temple, Winter. **Twin jets from both card edges:** Forest, Fall, Summer, Sakura. Ocean uses sheets of bubbles.
5. **Clear: one wave front per line travels through the world.** Halcyon (through the sanctuary), Himalayan (down the mountain), Ice-temple (down the nave), Forest (over the moss).
6. **Four lines: the world "holds its breath" (0.2–0.33 s near-dark), then flares.** Halcyon, Himalayan, Ice-temple, Winter, Ocean.
7. **T-spin: a spiral or wheel spins up round the card.** Forest, Fall, Summer, Sakura, Himalayan, Winter. Ice-temple turns the snow vortex.
8. **Level up turns an "hour wheel".** The wheel also drifts on its own clock (about 96–240 s per hour). Forest 5, Halcyon 5, Himalayan 5, Ice-temple 5 aurora palettes, Ocean 6, Sunset 6, Winter 5, Tornado 4, Summer 5, High Coast 6.
9. **Hard drop: a camera dip or jolt** — Halcyon, Himalayan, Winter, Tornado.
10. **Combo is one world-scale dial**, for example sun elevation, levitation, resonance or storm fury. True consecutive combo uses one `ComboTracker` per player; the bus `COMBO` event is cascade depth (ADR-0011).

### Tech house style (shared, not a visual motif)
- `WebGPURenderer` from `three/webgpu`, with the WebGL2 backend as fallback (`?forceWebGL`).
- Every surface is `MeshBasicNodeMaterial`, shaded by itself from shared uniforms and one sky function. No lights, no `ShaderMaterial`, no compute.
- One baked CPU noise texture (no MaterialX noise).
- Closed-form, ring-buffered uniform event slots, with `seek(t)` plus a fixed-step replay for determinism.
- Post: one scene pass, bloom on a max-channel knee, one output pass (calm zones over card and HUD, hue-preserving filmic, grade, grain). `usesMrtScenePass()` returns false.
- Six tiers, Minimal to Extreme. Static shadow map. Planar reflector on Medium and up.
- Module split: `core / plan / tsl / sky / … / world / director / composition / post / quality / theme`.
- Fully procedural except forest, fall, summer and sakura, which use Blender-grown GLB packs.
- Exception: wolfhour (classic `EffectComposer`, GLSL `ShaderMaterial`, compute).

### Names from other people's fiction (gate)
A theme may evoke a setting; it may not name one. No world, creature, substance or device names from a third-party franchise anywhere in the tree: code, identifiers, comments, tests, docs, this catalogue. `npm run check:ip-strings` (`scripts/ip-string-gate.mjs`, class B) scans every tracked text file and fails on them. Precedent: Shifting Sands, 2026-10-20, where the planet, the worm, the substance and the device all carried another franchise's names in comments and docs while the player-facing copy was clean. The public repo made those comments the exposure.

### Piece palette gate
`npm run check:palette` (`scripts/palette-guideline-check.mjs`) screens the first hue of each shape against the Guideline bands: I cyan 160–210°, O yellow 32–75°, T purple 245–315°, S green 90–170°, Z red 320–20°, J blue 200–250°, L orange 20–50°. **It FAILS at 7/7 and WARNS at 6/7.** Summer and Ocean deliberately score 0/7.

## Part 1. Survey 1: forest, the landscape rebuilds, aurora (15 themes)

Sources per theme: the icon PNG (`src/themes/<id>/<id>-theme-icon.png`, path from
`src/themes/theme-registry.js:3-105`), the `docs/*_OVERHAUL_2026-10.md` record plus its capture
sheets, the theme module's header docblock, and `<id>-tetrominos.js`.
Registry groups: every theme here is `group: 'biomes'` except `tornado` (`'atmospheric'`, l.90) and `aurora` (`'sky'`, l.104).

<a id="forest"></a>

### 1. forest — "Forest — the firefly night" (`docs/FOREST_FIREFLY_NIGHT_OVERHAUL_2026-10.md`)

- **Icon:** a huge cratered white moon behind a dark teal spruce, under a blue night sky. Yellow-green firefly streaks with dotted long-exposure trails.
- **Setting:** an old northern spruce, pine and birch wood on a moonlit "ride" (a long opening) that runs toward the moon and falls away into a valley of mist. The elder spruce frames the left; on the right are an elder pine, birches and a mossy knoll. The moon is 19° up, oversized, with an aureole and an ice halo.
- **Palette:** ink and slate blue night, blue-white moon. Firefly chartreuse is the only saturated colour. Moss green, foxfire teal.
- **Pieces** (`forest-tetrominos.js:13-20`, `glow`): I `#c9f25c` firefly chartreuse, O `#52b868` moss, T `#38d9cf` foxfire teal, S `#f59ab9` wild rose, Z `#8084f5` twilight indigo, J `#f5edd3` moon ivory, L `#a3b8d4` birch silver, GARBAGE `#1a2433`.
- **Hours** (`forest-hours.js:35+`, 120 s period): deep night, the small hours, first light (rose), moonrise (amber), the blue hour (teal).
- **Motion:** fireflies drift with closed-form dotted trails; volumetric moonbeams (`GodraysNode`); mist banks; moths in the beams; falling stars; ferns and grass bow.
- **Gameplay FX:**
  - Lock: a wave of light runs out across the moss and climbs the trunks, and fireflies flash.
  - Hard drop: dew shakes down.
  - Clear: twin firefly jets, plus a wind front at 2 lines and a falling star at 3.
  - Four lines: fireflies gather into one of 12 animal constellations (stag, moose, bear, wolf, owl, fox, hare, lynx, boar, capercaillie, squirrel, hedgehog) drawn as signed-distance figures.
  - Combo: the fireflies fall into synchrony; garlands spiral up the trunks, foxfire threads spread through the moss, fungi light.
  - T-spin: a spiral flourish.
- **Tech:** Blender GLB pack of 10 trees (2.9 MB). Static shadow map. Firefly light map splatted on the CPU. `HEAVY_GPU_THEME_IDS`. Starter and fallback theme.

<a id="halcyon-apex"></a>

### 2. halcyon-apex — "the sanctuary of first light" (`docs/HALCYON_APEX_VISUAL_OVERHAUL_2026-10.md`)

- **Icon:** a stepped sandstone pyramid with a glowing cyan doorway, a floating cyan crystal on top, and cyan crystal shards lining a causeway into turquoise water. Peach and lavender dawn clouds.
- **Setting:** a windless golden dawn seen from a lagoon. An 8-terrace pyramid with a stair through the "heart gate". The Apex crystal floats above it. The Halcyon, a 40 m diamond, hangs before the rising sun over a ring of 9 standing stones, with an upward water-funnel under it. Obelisks, islets with flat-topped acacia-like trees. Everything mirrors in the lagoon.
- **Palette:** sun gold, sky blue to peach, turquoise shallows, deep teal, cyan crystals and ley light, sandstone. Five palettes (`halcyon-apex-core.js:300+`): golden-dawn, rose-hour, clear-morning, amber-haze, blue-hour.
- **Pieces** (`:12-19`): I `#8ff5ee`, O `#c9bfa2`, T `#3fd6cf`, S `#8fa84e`, Z `#2a8fa0`, J `#bfd8d6`, L `#d8cba8`, GARBAGE `#5a5e68`. Sandstone, turquoise and moss.
- **Motifs:** ley lines (strips of light with an arc-length coordinate), instanced six-sided bipyramid crystals that refract the sun per channel, procedural masonry with baked occlusion, two-plane perspective clouds, beads of water.
- **Gameplay FX:**
  - Lock: a ring in the lagoon, then a wisp flies to a ley line and a pulse runs the line into a great crystal, which holds the colour about 30 s.
  - Clear: blades of light, plus one wave front per line in which the masonry flashes.
  - Combo: **levitation**. The shards rise off their plinths and drops of the lagoon bead upward.
  - Four lines: a hush, then beacons and a ring of light in the sky.
  - T-spin: everything that floats turns on its axis.
- **Tech:** planar mirror, shared `DirectionalLight` shadow, `haSkyBase`.

<a id="himalayan-peak"></a>

### 3. himalayan-peak — "the chain raises the sun" (`docs/HIMALAYAN_PEAK_VISUAL_OVERHAUL_2026-10.md`)

- **Icon:** a sharp snow-and-rock horn lit gold on one face, against a lavender and pink sky. Prayer-flag lines (blue, white, red, green, yellow) and a golden chorten spire.
- **Setting:** dawn on a high pass above a sea of cloud. A whitewashed chorten on the left, a cairn and pole on the right. A hero peak 3,290 m above the cloud, with a snow banner. Headwall and amphitheatre, with the sun rising behind it on the right. A golden eagle circles.
- **Palette:** alpenglow rose to gold on snow, lavender and violet shade, cobalt sky. Five-colour prayer flags. Hours (`himalayan-peak-core.js:263+`): first-light, gold, cobalt, ember, moonrise.
- **Pieces** (`:12-19`): I `#f0f5ff` snow, O `#9c88ff` flag purple, T `#4cd137` flag green, S `#e84118` flag red, Z `#5a7090`, J `#fbc531` flag yellow, L `#00a8ff` flag blue, GARBAGE `#3c465a`.
- **Motion:** closed-form cloth flags with gusts, spindrift off the crests, avalanches, billows in the cloud sea, diamond dust, an eagle.
- **Gameplay FX:**
  - Lock: paper wind-horses in the piece colour; a gust runs along a flag line and the flags hold the colour; a powder ring.
  - Clear: blades of light and multicolour papers; the sun lifts and a wave of light pours down the mountain; an avalanche at 3 lines.
  - Combo: **raises the sun's elevation**. Light walks down the face, the headwall's shadow retreats.
  - Four lines: a hush, the sun is thrown clear of the wall, then a lens star, a ring of ice-light and an avalanche.
  - T-spin: a wheel of papers.
- **Tech:** baked heightfield `assets/massif.png`, an exact horizon map for soft self-shadowing, 4 shadow slices for shafts in the air.

<a id="ice-temple"></a>

### 4. ice-temple — "the singing nave" (`docs/ICE_TEMPLE_VISUAL_OVERHAUL_2026-10.md`)

- **Icon:** a cathedral nave of glowing cyan ice columns and pointed ribs. A white-cyan crystal cluster burns at the end; a green aurora shows through the open vault; snow falls on cracked ice.
- **Setting:** colossal hexagonal ice columns on a frozen black lake under the polar night, open vault, icicles. The Great Crystal lights the nave from behind the card. Low moon with a 22° halo, aurora beyond. The floor shows cracks as white curtains under the surface, frozen bubbles and a mirror.
- **Palette:** cyan, glacier blue, aurora green, violet. **No warm colour by design**; four lines are white. Aurora palettes (`ice-temple-core.js:198-212`):
  - boreal: a `0x3dff9e`, b `0x2ccfff`, c `0x8f5cff`
  - amethyst: a `0x8f7bff`, b `0xff62d2`
  - glacier: a `0x6ae8ff`, b `0xc8efff`
  - rose: a `0xff5fa8`
  - solar: a `0xff4a78`, b `0x3fffa6`
- **Pieces** (`:11-18`): I `#7fe8ff`, O `#e8fcff`, T `#b5c7ff`, S `#7cf3c9`, Z `#c0a7ff`, J `#5ba8dd`, L `#f2d5b0`, GARBAGE `#0f1b27`.
- **Motion:** snow (stops, then rises during a combo), diamond dust, mist banks, aurora curtains.
- **Gameplay FX:**
  - Lock: a star fracture in the ice in the piece colour, ice chips, and a shell of light that climbs the columns.
  - Hard drop: a crown of 16 ice spikes.
  - Clear: blades of light, then the Great Crystal sends a wave down the nave.
  - Combo: a resonance glow climbs the columns 2.4 m per link, and rime grows over the lens.
  - Four lines: a hush, then the **Great Snowflake** grows round the board and shatters.
  - T-spin: a snow vortex.
- **Tech:** Beer–Lambert absorption through each column, Voronoi crack walls, the moon shadow as a closed-form formula (`itMoonShadow`), an analytic integral for the glow in the mist.

<a id="spring"></a>

### 5. spring — "the river in its spring flood" (`docs/SPRING_VISUAL_OVERHAUL_2026-10.md`; rebuilt 2026-10-18 in moonlit-forest's slot)

- **Icon:** from the eye on the knoll over its flowers (white anemones, yellow globeflowers, pink campion) to the fall pouring white between dark crags, spruce on the rim, a blue sky.
- **Setting:** a Norrland river at the end of May at 65° N, in its spring flood (after Tännforsen). The eye stands among flowers on a low granite knoll at the outside of a bend. Up to the left the river pours over a step of dark layered schist in tongues — the main one leaping free from a recess it has worn under the lip, the left sliding down a stair of slabs, the right landing on a ledge — ribs of wet rock between them; the plunge pool boils where they land; rapids come down to the knoll in uneven ledges and the river swings round under it and away right through spruce and birch in first leaf toward fells with snow in their gullies.
- **Palette:** fresh spring greens, white water and dark wet rock, the meadow's flowers. Six stations (`spring-hours.js`): morning, afternoon, golden evening, sunset (the sun gone behind the western rim, the fells still lit), the light night (a rose band over the fells), dawn mist; the real sun height at 65.5° N on a measured skyline; the day turns with the clock and a level-up steps a station; no rests (worst 0.095 stops/s).
- **Pieces** (`spring-tetrominos.js`, solid): I `#F6E76E` globeflower, O `#EE8512` marsh marigold, T `#F8F4EC` wood anemone, S `#279DF1` hepatica, Z `#E8508C` red campion, J `#D9BDF5` lady's smock, L `#C756D2` violet, GARBAGE `#2E3826`. Each piece is a flower of the meadow; CVD-separated (worst ΔE > 14).
- **Motion:** the fall's water streaking down at its true quickening speed, the pool's boil, foam drifting down the rapids in lines, the mist rolling off the foot, the meadow in the breeze, cloud shadows on the fells, birds.
- **Gameplay FX:**
  - Lock: a patch of the piece's own flower bursts into bloom on the knoll where it landed, opening outward (on the water: a splash, and the patch opens on the knoll's edge at that bearing).
  - Clear: a surge down the river from the pool, the bigger the more lines — a hump with a steep front that breaks white across the river like a bore, foam drawn out behind it; the knoll flushes into bloom.
  - Chain: the spring flood rises with each link — the river swells, runs whiter in streaks and faster, the mist thickens; it falls back when the chain breaks.
  - Four lines: the great surge, and the last of the winter's ice goes out on it (floes down the rapids).
  - T-spin: a whirl turns in the pool where it drains. Back-to-back: the river glitters. Perfect clear: two surges and whooper swans. Level up: cranes pass north. Game over: dusk.
- **Tech:** WebGPU/TSL with the WebGL2 backend. A fall plan (`spring-fall-plan.js`) that the rock face, the water sheet, the pool's boil and the mist all read: each column's path traced over the sculpted face (free flight, slab slides with drag, ledge landings), the sheet read by launch time; a valley height function baked offline into three grids; a flow-mapped river with per-pixel antialiased foam thresholds; the far woods as cards of the modelled Blender trees from an impostor atlas drawn once by the forest's own materials (albedo + normals/occlusion/leaf).
- **Avoid reusing.** A layered-rock fall in tongues seen across a plunge pool; a flowering knoll as the eye's standpoint; surges with breaking fronts as clears; the flood as the chain; ice going out for four lines.

<a id="wolfhour"></a>

### 6. wolfhour — "A Three.js Mystical Mountain Theme" (no overhaul doc; `docs/MOBILE_WOLFHOUR_INTRO_FIX_2026-10.md` only)

- **Icon:** monochrome. A charcoal low-poly faceted mountain mass under a dense star field with the Milky Way band, a dark metallic ring frame. Two bright four-point star glints.
- **Scene** (`docs/theme-screenshots/wolfhour.png`): a giant photographic moon (`2k_moon.jpg`) half set behind black faceted fBm mountains; dense white stars; faint grey nebula. **Strict black-and-silver**: `WolfhourGrade` is the "black-and-silver night grade" (`wolfhour-grade.js:1-4`). The sky base is nearly black, `vec3(0.0024,0.0027,0.0034)` (`wolfhour-sky.js:113`).
- **Pieces** (`:12-19`): all silver-greys. I `#ddeeff`, O `#f5f8fa`, T `#b0c4d8`, S `#a0b8cc`, Z `#98a8bc`, J `#708090`, L `#c8d8e8`, GARBAGE `#1a1a1a`. Glow radius 18.
- **Motion:** star twinkle, spirits, ambient particles, ground fog, ambient meteors with trails.
- **Gameplay FX** (`wolfhour-theme.js:3038-3160`):
  - Lock: a star burst, a mountain pulse and shockwave, and a lunar reaction.
  - Clear: celestial beams, a horizontal "cosmic wave", a nebula colour shift.
  - Combo 3+: cosmic rifts plus a meteor shower. At 5 and 10: a **meteor crash** with debris, a shockwave and a dust cloud, plus camera shake.
  - Level up: 3 beams.
- **Tech:** legacy hybrid, 5,377-line theme class. `EffectComposer` + `UnrealBloomPass` + GLSL `ShaderMaterial`s (`wolfhour-shaders.js`), plus WebGPU TSL materials and compute (`wolfhour-compute.js`).

<a id="ocean"></a>

### 7. ocean — "the reef canyon at the edge of the blue" (`docs/OCEAN_VISUAL_OVERHAUL_2026-10.md`)

- **Icon:** a stylised underwater reef: pink tube anemone, yellow branching coral, purple tube sponges, green seagrass, a teal boulder. Iridescent caustic sand in rainbow-green.
- **Setting:** underwater, at the mouth of a reef canyon looking up. Snell's window overhead with the surface rolling, wandering sun shafts, chromatic caustics on sand and coral.
  - Coral garden: branching, table, brain and tube sponges, sea fans, anemones.
  - Golden kelp, seagrass meadows.
  - A silver school of 380–4,400 fish, reef fish, moon jellies.
  - Giants: turtle, manta, humpback whale with calf.
- **Palette:** turquoise to azure to indigo water, coral pinks, purples, golds. Six hours (`ocean-hours.js:64-179`): noon, gold, fire, blue, moon (the reef fluoresces), dawn.
- **Pieces** (`:19-26`, **`renderMode: 'solid'`**): I `#FFD166`, O `#39D9E8`, T `#4FD68B`, S `#B58CFF`, Z `#4C8DFF`, J `#FF9550`, L `#FF6B81`, GARBAGE `#1C2B36`.
- **Gameplay FX:**
  - Lock: a light sinks to the reef, then a ring, a crown of sparks and bubbles; fish dart; the colonies hold the colour.
  - Hard drop: a pressure ring distorts the image.
  - Clear: a current crosses the canyon (kelp leans), the school ribbons across at the cleared rows' height, the colonies **spawn** upward beads.
  - Four lines: a hush, then one great shaft over the board with the school spiralling round it, and the whale.
  - Combo: giants are called in steps (turtle at 2, mantas at 3, whale at 5, whale over the board singing at 7).
  - T-spin: a bubble ring.
- **Tech:** everything grown in code; one caustic-and-shaft pattern texture shared by every surface and the post shaft march.

<a id="sunset"></a>

### 8. sunset — "the lantern sea" (`docs/SUNSET_VISUAL_OVERHAUL_2026-10.md`)

- **Icon:** an orange and magenta sky, a half-set gold sun on the sea, glowing paper sky lanterns (yellow, orange, pink, lilac) rising, a skein of birds, lanterns floating on rippled orange water.
- **Setting:** an open sea at the end of the day, looking west. The sun sets left of the card with its road of glitter. A cloud deck lit from beneath, cirrus streaming toward the sunset, the moon and Milky Way at night.
- **Palette:** gold, crimson, magenta and violet sky, orange sea. Six hours (`sunset-hours.js:92-277`): golden, sunset, afterglow, night, dawn, day. Includes a green flash.
- **Pieces** (`:12-19`): I `#ffd700`, O `#ff6b1a`, T `#ff4d8f`, S `#b794f6`, Z `#dc2626`, J `#f59e0b`, L `#ff8a65`, GARBAGE `#1a1a2e`. All warm.
- **Motion:** eight Gerstner wave trains with glint variance, lanterns bobbing on the swell, lanterns rising downwind, gulls.
- **Gameplay FX:**
  - Lock: a light arcs to the sea and becomes a **floating paper lantern** with a ring.
  - Clear: the oldest lanterns lift off and fly toward the sunset; a prismatic 22° halo round the sun or moon.
  - Four lines: every lantern lifts, the sky "on fire", the green flash.
  - Combo: the clouds burn brighter; skeins of gulls.
  - T-spin: lanterns turn as they rise.
- **Tech:** `skyColour(dir)` as one function of direction, slice-composed cloud relief, `glintLobe`.

<a id="high-coast"></a>

### 9. high-coast — "the rising coast" (`docs/HIGH_COAST_VISUAL_OVERHAUL_2026-10.md`)

- **Replaced** the legacy DOM/CSS `mountain` on 2026-10-13. `mountain` is an alias in `RETIRED_THEME_IDS`, the track key `Mountain` resolves to `HighCoast`, and Odyssey orb id 25 is "The High Coast".
- **Icon:** An old Scots pine with a heavy tufted crown stands on lichen-crusted granite beside the HÖGA KUSTEN trail sign, over a stepped red-granite cliff and a blue bay of pine islands, with the low golden sun beyond.
- **Setting:** Höga Kusten on Sweden's Bothnian coast, seen from a bare granite summit 152 m above the sea. On the left an old Scots pine and a trail sign (HÖGA KUSTEN / VÄRLDSARV), with a stepped red-granite headland cliff behind them. A bay of skerries and pine islands. A hamlet of Falu-red cottages on the near right, with a jetty and the Swedish flag. A lighthouse in the outer archipelago, a fleet of sailboats, gulls, and cumulus banks on the horizon.
- **Palette:** blue sky, Baltic blue-violet sea, red-grey granite, dark pine green and Falu red. A whole midsummer day at 63° north (`high-coast-hours.js`), named by six stations: golden hour, sunset, light night, dawn mist, morning and afternoon. The day takes 600 s of clock and never rests (Sunset's model: a timetable, the sun at its real height, its light fading with the height); a level-up adds one station.
- **Pieces** (`high-coast-tetrominos.js`): I `#3B78E0`, O `#B5322A`, T `#F59A2E`, S `#C44AA0`, Z `#D7EA6A`, J `#F2B4A2`, L `#1E8C6E`, GARBAGE `#363C45`. Spinnaker cloth; the palette gate scores 0/7.
- **Motion:** domain-warped ripple trains with glint variance, the islands mirrored in a heightfield march, drifting cloud shadows, the fleet reaching round its loops, gulls, the pine's crown in the wind.
- **Gameplay FX:**
  - Lock: a cat's-paw gust runs across the water on the lock's side, and a boat there sets a spinnaker in the piece colour for about 24 s.
  - Hard drop: a wider gust and a splash plume.
  - Clear: **the land rises.** The sea draws back 2.4 m a line, skerries surface, and the risen band is wet and gold-lit, with run-off threads, a foam line and sea mist.
  - Chain: each link lifts more, up to a 30 m ceiling; the breeze freshens and the gulls gather. A broken chain of 3+ sends a swell.
  - Four lines: the great rebound (+6 m), spray off every shore, and the gulls take off.
  - T-spin: the fleet tacks. B2B: the lighthouse beam. Perfect clear: the sea goes glass-calm. Level up: an hour forward and a lighthouse signal. Game over: dusk.
- **Tech:** Painted Ages' architecture: three nested baked heightfields, a fan mesh, GPU sun visibility, exact exponential haze and an hour wheel. The cliff uses `terrace()` steps plus face-space shading. Gusts run in a TSL `Loop`, helpers are laid-out `Fn`s, and portrait uses a vertical lens shift.
- **Avoid reusing:** land rising out of the sea or sea level as a game dial, cat's-paw gusts, coloured spinnakers, Falu-red cottages, an archipelago seen from a summit, a trail sign.

<a id="winter"></a>

### 10. winter — "fox fires" (`docs/WINTER_FOX_FIRES_OVERHAUL_2026-10.md`)

- **Icon:** a translucent green-to-violet glowing arctic fox made of light leaping across vertical aurora curtains (green, blue, violet) and stars.
- **Setting:** a snowfield at a frozen lake in polar-noon twilight. Lapland "snow ghosts" (rime-loaded spruces as lumpy white pillows) left and right. Rose last light behind a round fell on the left; a giant moon with a 22° ring and sun dogs on the right. A dark far shore, falling snow, a white arctic fox doing its round.
- **Palette:** pastel polar twilight (teal, lilac, rose), white snow, aurora green and violet with a rose foot. Hours (`winter-core.js:587+`): kaamos, rose-noon, blue-hour, violet-dusk, deep-night.
- **Pieces** (`:14-21`): I `#5df2a6`, O `#eaf6ff`, T `#6de0ff`, S `#ff9ccf`, Z `#b79bff`, J `#ffe2a0`, L `#4a9fd8`, GARBAGE `#16222e`.
- **Gameplay FX:**
  - Lock: sparks in the piece colour are drawn up into the sky, and the aurora holds that colour; a powder ring; the fox's tail flicks.
  - Clear: blades of light, a gust with snow snakes, the sky "strummed".
  - Combo: the fox runs faster and more aurora sheets wake; twilight turns to night.
  - Four lines: a hush, the fox pounces, then a **kilometres-long fox of light bounds across the sky**.
  - T-spin: a wheel of sparks.
- **Tech:** shared `fox-rig.js` / `fox-mind.js`, baked SDF snow-ghost meshes (`assets/snow-ghosts.bin`), moon shadows baked on the CPU.

<a id="fall"></a>

### 11. fall — "the enchanted grove" (`docs/FALL_ENCHANTED_GROVE_OVERHAUL_2026-10.md`)

- **Icon:** a backlit red and orange maple canopy, the sun bursting through, golden glowing maple leaves swirling over a leaf-strewn floor in warm haze.
- **Setting:** a low sun behind an old autumn wood. An ancient maple on the left, a spreading oak on the right, a leaf path toward the light, golden birches, haze, volumetric shafts through the canopy, trunk shadows raking toward the camera, translucent backlit leaves.
- **Palette:** crimson, copper, amber and gold leaves, cream haze, walnut bark.
- **Pieces** (`:12-19`): I `#f6cf72`, O `#ef9e42`, T `#bc77ac` plum, S `#8fb89c` sage, Z `#df7052` copper, J `#7faaca` mist blue, L `#edb68b`, GARBAGE `#3e2723`.
- **Gameplay FX:**
  - Lock: a leaf puff from the card edge.
  - Clear: twin leaf jets, a gust front at 2+ lines.
  - Four lines: a shower plus a sunburst.
  - Combo: a **leaf vortex** winds round the board and its leaves glow like embers above about 55 %.
  - T-spin: a spiral.
  - Back-to-back: lifts the lanterns.
- **Tech:** Blender GLB pack (3.4 MB, 7 trees), typed-array leaf simulation, `GodraysNode` shafts.

<a id="summer"></a>

### 12. summer — displayName "Midsommar" (`docs/SUMMER_MIDSOMMAR_OVERHAUL_2026-10.md`)

- **Icon:** a leafy maypole with two flower wreaths and blue and yellow ribbons; the low sun sits inside the right wreath; a mirror lake with a skerry and birch; pine hills in haze; a peach sky.
- **Setting:** a Swedish lake on Midsummer's Eve. A flowering meadow, the maypole, a Falu-red cottage with white corners, a jetty and rowboat, a weeping birch, an old spruce, four blue hill ridges. Butterflies, swallows, seed down.
- **Palette:** green meadow, gold sun, Falu red, flower colours, blue lake.
- **Hours** (`summer-hours.js:64+`): evening, rose hour, white night, dawn, morning. One hour every 240 s.
- **Pieces** are seven Midsummer flowers (`:15-22`): I `#e4412c` poppy, O `#7fa6f5` harebell, T `#ffd21f` buttercup, S `#fffdf2` oxeye daisy, Z `#5d5fd6` lupine, J `#ff8a2e` hawkweed, L `#b267e0` cranesbill, GARBAGE `#2a4b38`. Palette gate 0/7.
- **Gameplay FX:**
  - Lock: petals of the piece's own flower, a meadow gust, and that flower kind glows wherever it grows; a lake ring.
  - Bouquet: locking all 7 kinds lights 7 lanterns on the maypole.
  - Clear: twin petal jets, butterflies.
  - Four lines: a sunburst, swallows tower.
  - Combo: a **flower crown** turning round the board, then silk ribbons spiralling round it.
  - T-spin: a garland of buttercup petals.
- **Tech:** Blender GLB assets, procedural flowers.

<a id="tornado"></a>

### 13. tornado — "the prairie supercell" (`docs/TORNADO_VISUAL_OVERHAUL_2026-10.md`)

- **Icon:** a grey rope tornado wound with neon rainbow ribbons (magenta, gold, blue, green), dark storm clouds, an amber horizon, a golden wheat field.
- **Setting:** a wheat field at day's end under a rotating supercell base. The low sun in a clear gap behind rain shafts. A rope funnel left of the card with a dust skirt and debris; a power line on the right; real wheat geometry leaning with the inflow.
- **Palette:** slate cloud, amber and orange sun gap, gold wheat, plus rainbow ribbons. Palettes (`tornado-core.js:87+`): golden hour, ember dusk, green sky, blue hour.
- **Pieces** (`:12-19`): I `#FFC21A`, O `#D95BFF`, T `#38F08C`, S `#FF4D6D`, Z `#3AA0FF`, J `#FF7A1A`, L `#2EE6E6`, GARBAGE `#5a6068`.
- **Gameplay FX:**
  - Lock: sparks fly into the funnel's foot and become a **ribbon of light climbing the funnel**, held about 30 s; a gust ring through the wheat.
  - Clear: the ribbons shoot into the cloud, which lights from inside; lightning, one bolt per line.
  - Four lines: the funnel swells to a wedge and a dust wall rolls over the lens.
  - Combo: storm fury (green heart, satellite vortices).
  - T-spin: the funnel spins up.
- **Tech:** the funnel is a tube grid in the vertex stage (no marching); live slider `params.ts` (TypeScript island).

<a id="sakura-twilight"></a>

### 14. sakura-twilight — "the moonlit garden" (`docs/SAKURA_TWILIGHT_OVERHAUL_2026-10.md`)

- **Icon:** pink cherry blossom boughs, a large pale moon, a purple and violet sky, a Fuji-like cone, a vermilion torii in a still lake, falling petals, glowing lanterns.
- **Setting:** a Japanese garden at twilight. A weeping cherry frames the left, a spreading cherry and a low moon the right. A mountain over a torii in the lake, a drum bridge, an islet, a pagoda, stone and paper lanterns. Two red foxes; lanterns float on the lake; constellations (the Fox, the Blossom, the Crane).
- **Palette:** twilight purple and lavender, sakura pink, moon silver, lantern amber.
- **Pieces** (`:10-17`): I `#A8C8E8`, O `#FFCF8B`, T `#7B5B9A`, S `#FFB7C5`, Z `#DB7093`, J `#9B7BB8`, L `#E8B4C8`, GARBAGE `#4A3B5C`.
- **Gameplay FX:**
  - Lock: a glint and a petal puff; a lake ring that turns into pink light.
  - Clear: twin petal jets; a lantern set afloat for each line; a shooting star at 3 lines, and the foxes run.
  - Four lines: **hanafubuki**, a blizzard of petals.
  - Combo: a petal stream winds round the board; a foxfire gauge beside it; the constellations draw themselves.
  - Level up: sky lanterns rise.
- **Tech:** Blender GLB pack (3.5 MB), shared fox rig, moonbeams, planar water.

<a id="aurora"></a>

### 15. aurora — group `sky` (`docs/AURORA_VISUAL_OVERHAUL_2026-10.md`)

- **Icon:** tall green and magenta aurora curtains with a twisting fold, dark teal snow massifs, a mirror lake with green and pink vertical streaks.
- **Setting:** a clear arctic night over a lake. One auroral ribbon on the diagonal plus two more arcs. Snow massifs either side of a low saddle; spruces on snow spits; the lake mirrors everything as vertical streaks.
- **Palette** (`aurora-palette.js:6-19`): oxygen green (greenWarm `[0.2,1,0.27]`), red crown, nitrogen pink fringe, violet, lavender corona, near-black teal sky. The resting display is green.
- **Pieces** (`:12-19`): I `#6cf5ff`, O `#d6ffb0`, T `#c18bff`, S `#62ffbf`, Z `#ff88ee`, J `#5a7cff`, L `#8dfdff`, GARBAGE `#030713`.
- **Gameplay FX:**
  - Lock: pulses in the piece colour run along the arcs; a lake ring.
  - Clear: every arc is strummed (a billow, a sweeping band, a pink hem).
  - Four lines: a **corona** of lavender rays at the magnetic zenith, plus a meteor volley.
  - Streak: a storm tint, a red crown, meteors from 3, the corona from 5.
  - T-spin: a violet billow. Perfect clear: a gold bloom.
- **Tech:** analytic curtain march with a closed-form integral of the kernel `(1+x²)^-3/2`; a reduced-resolution buffer mapped by direction, shared by the sky and the lake.

### Takeaways for the new theme (from this 15-theme slice; survey 1)

- **Avoid:**
  - night plus moon
  - aurora
  - snow or ice
  - golden low-sun horizon
  - turquoise lagoon
  - pink blossom
  - tree frames left and right
  - mirror lake across the bottom
  - hero peak
  - lanterns
  - flags or ribbons
  - petals or leaves thrown from the card
  - floating crystals
  - meteors
- **Nearly every theme already ships these lock/clear devices:** "ring from the board's foot", "blades of light", "hush then flare", "spiral at T-spin" and "hour wheel on level up". A breakthrough theme should invent its own physical metaphor for lock, clear and combo rather than reskin these.
- **Unclaimed in this slice:**
  - geothermal colour (hot springs, sulfur fields)
  - mineral landscapes (travertine terraces, rainbow-striped mountains, salt flats)
  - slot-canyon beams
  - fungal or bioluminescent bays
  - karst pillars
  - noctilucent or mammatus skies
  - lavender or tulip fields
  - liquid-rainbow rivers (Caño Cristales)
  - surreal abstract art
- These are covered in Parts 2–4 below: shifting-sands, crystal-cave, geode, bioluminescence, koi-pond, grainfields, stillwater, verdant-hills, golden-forest, parhelion, nimbus-veil, chromatic-impasto, fluid-dreams, vesper-chrysalis and others.
- **A piece palette must score at most 5/7 on the palette gate** (6/7 warns, 7/7 fails); 0/7 is the house ideal, as in Summer and Ocean.

## Part 2. Survey 2: galaxy to luminous-tides (15 themes)

Sources for each theme: the icon PNG (viewed), `docs/<NAME>_*OVERHAUL_2026-10.md` where one exists, the capture
folders (`docs/*-captures/`, `docs/*-overhaul/`, `docs/theme-screenshots/<id>.png`), the theme module header and
`<id>-tetrominos.js`. Registry entries: `src/themes/theme-registry.js:108-218` (the replaced cosmic-chimes sat at `:143-148`, `group: 'cosmic'`;
Rainbark holds that position now, in group `biomes`).

Status split:
- **11 rebuilt in Oct 2026 as WebGPU/TSL "masterpieces"** (galaxy, aether-tides, koi-pond, verdant-hills, serenity-warp,
  starlight, golden-forest, geode, bioluminescence, shifting-sands, waves). All use `THREE.WebGPURenderer` with its
  WebGL2 backend as fallback, self-shaded `MeshBasicNodeMaterial`s, closed-form, slot-based events (nothing allocated
  at event time), a director + composition module that read the live card/board/HUD rects, 6 tiers
  (Minimal…Extreme), and one post stack (max-channel knee bloom, hue-preserving filmic, calm zones over card/HUD).
- **4 legacy classic-WebGL themes** (rainy-window, singing-bowl, misty-lake, luminous-tides; Kaleidosonic has
  since replaced singing-bowl, §22, and Grainfields misty-lake, §28): one big
  `THREE.WebGLRenderer` class with GLSL `ShaderMaterial`s and `EffectComposer`/`UnrealBloomPass`; events are
  random-position pulses, not aimed at the board. Their icons do not match their scenes well (noted per theme).

<a id="galaxy"></a>

### 16. Galaxy (`galaxy`) — "the grand spiral"

- Registry `theme-registry.js:108-113`, group `cosmic`. 16 modules in `src/themes/galaxy/`. Doc
  `docs/GALAXY_VISUAL_OVERHAUL_2026-10.md`.
- **Icon** (`galaxy-theme-icon.png`): tilted spiral galaxy, white-gold core with a thin elliptical ring round it, a
  pale-cyan relativistic jet shooting up-left and down-right through the nucleus, arms in hot pink/magenta and
  periwinkle blue, dense star dust, deep violet-black field.
- **Setting / time**: deep space, no time of day. Grand-design barred spiral leaning back, nucleus left of the card,
  companion spiral + cloud band upper right, far galaxies as smudges, foreground stars with diffraction spikes.
- **Palette**: old-gold bulge, violet inner arms → blue rim, pink H-II nurseries, red-brown dust lanes, violet-black
  void. Level palettes (`galaxy-core.js:196-248`): andromeda, whirlpool, sombrero, emerald, ultraviolet.
  Pieces (`galaxy-tetrominos.js:18-25`): I `#ffd54f` supernova gold, O `#d050ff` nebula violet, T `#00ffc8` aurora
  teal, S `#ff4da6` magenta, Z `#6366f1` indigo, J `#ff8a50` comet ember, L `#00e5ff` ion cyan, garbage `#0a0015`.
- **Key motifs**: spiral arms, glowing nucleus, bipolar jets, star nurseries, 80k orbiting suns, dust lanes, shooting
  stars, prismatic ring across the sky.
- **Motion**: pattern rotates, old suns orbit on a flat rotation curve and brighten crossing arms; slow drift.
- **Gameplay FX**: lock = coloured *seed* leaves card edge at piece height, falls into a nursery that ignites
  (4-spike starburst) and **keeps the colour ~30 s** (`held(t)=e^(-(t-epoch)/30)`); clear = row *blades of light* +
  a wave from the nucleus that releases every nursery's held light (1/2/3 lines = blue/violet/jet colour); combo =
  rings stand round the nucleus (≤6), jets push further, pattern spins faster; quad/perfect = "holds its breath"
  0.2 s, arms wind tighter, jets fire, 4 gold fronts, lens-ripple across the frame, meteors; T-spin = arms wind and
  spring back; level = palette change.
- **Tech**: disc is a ray-marched volume slab (layers crowd to midplane), analytic bulge, instanced closed-form suns,
  baked CPU fBm texture, camera-facing ribbon jets, iris/exposure dip on surges, no compute.
- **Avoid reusing**: spiral/vortex forms, pink-violet-blue gas, jets/beams from a central core, "light stored in N
  sites then released by a radial wave", diffraction-spike stars, lens ripple.

<a id="aether-tides"></a>

### 17. Aether Tides (`aether-tides`) — "the living nebula"

- Registry `:115-120`, group `cosmic`. 17 modules incl. a real fluid solver. Doc
  `docs/AETHER_TIDES_VISUAL_OVERHAUL_2026-10.md`.
- **Icon**: billowing nebula — magenta/hot-pink, violet, electric blue, a bright white star with spikes upper-left,
  scattered red/blue stars.
- **Setting / time**: deep space. A river of glowing gas crosses behind the card upper-left → lower-right: violet in,
  cyan middle, magenta out, dark dust lanes; blue-white "Tide Star" (6 spikes) upper-left, amber companion lower-right;
  two open star corners.
- **Palette**: violet / cyan / magenta gas, amber star. Level palettes (`aether-tides-core.js:168-212`): aether,
  carina, rosette, lagoon, ember. Pieces (`aether-tides-tetrominos.js:13-20`): I `#F5C542` amber, J `#FF7A3C` coral,
  L `#2CE0FF` aqua, O `#8A5CFF` violet, S `#FF4D6D` crimson, T `#3CE68C` sea green, Z `#3A7BFF` deep blue.
- **Key motifs**: incompressible-fluid nebula, filaments, dust shadows ("carried light"), maelstrom with gravitational
  lens ring, novae.
- **Motion**: fluid advects constantly at 60 Hz; stars wander slow loops; gas heals to a rest field.
- **Gameplay FX**: lock = the piece's own cell **footprint outline** appears beside the card + dye poured in its colour,
  torn into filaments; a spark flies on a bowed path and becomes a star that burns ~1 min; clear = blades + jets out
  both sides at row height rolling into eddies, blast front, every lit star goes nova; combo = maelstrom opens upper
  right (lensing, bright ring), arms of gas drawn in; quad = holds breath 0.25 s, Tide Star flares, "starfire gold";
  T-spin = whole tide turns; level = palette heals over seconds.
- **Tech**: Stable-Fluids style solver as render passes into RGBA16F (advection, vorticity confinement, Jacobi pressure
  folded 13-tap stencil), prescribed divergence for radial pushes, flow-advected texture coords for fine grain,
  open boundary, emission-nebula shading, no-float-target fallback.
- **Avoid reusing**: fluid-dye clouds/filaments, nebula gas in violet/cyan/magenta, maelstrom/vortex with lens ring,
  piece-footprint echo, sparks that become stars, nova chain.

<a id="rainy-window"></a>

### 18. Rainy Window (`rainy-window`) — legacy storm

- Registry `:122-127`, group `urban`. `rainy-window-theme.js` (1199 lines) + tetrominos. No overhaul doc.
- **Icon**: monochrome slate-grey city silhouettes (tower blocks left and right) in a downpour, diagonal rain streaks,
  fog, flooded street reflections.
- **Actual scene** (`docs/theme-screenshots/rainy-window.png`): no buildings in code. A dark slate sea (three
  `Water.js`, normal map `./textures/water-normal.jpg`, `waterColor 0x000205`) under a grey-lavender overcast sky
  (`0x000005`→`0x0a0a20` gradient), cloud layer, horizon haze, 50,000 rain points (`:383`, colour `0x8899bb`), 200 fog
  sprites (`0x8899aa`), lightning bolts + two blue point lights (`0x8888ff`, `0xaaaaff`), FogExp2 `0x0a0a15`.
- **Time**: night / storm. **Palette**: desaturated slate, grey-violet, steel blue; lightning blue-white.
  Pieces (`rainy-window-tetrominos.js:11-18`): I `#f6c46a` streetlight, O `#c9b4ff` lavender neon, T `#7bf0d0` mint,
  S `#ff8fb5` umbrella pink, Z `#586abf` midnight indigo, J `#ffe9b7` window light, L `#8ccff9` rain haze.
- **Motion**: rain fall, fog banks drifting on a schedule, camera breathing + random "dips", lightning every 3–10 s.
- **Gameplay FX**: `LINE_CLEAR` → lightning flash (intensity from line count) + sky glow; `COMBO` → storm intensity and
  wind. No lock reaction. Not aimed at the board.
- **Tech**: classic `WebGLRenderer`, GLSL ShaderMaterials, stock `Water` (a second scene render each frame).
- **Avoid reusing**: grey storm palette, rain streaks, lightning-as-clear, flooded city silhouettes, overcast sea.

<a id="koi-pond"></a>

### 19. Koi Pond (`koi-pond`) — "the moonwake pond"

- Registry `:129-134`, group `biomes`. 21 modules. Doc `docs/KOI_POND_VISUAL_OVERHAUL_2026-10.md`.
- **Icon**: top-down clear water over teal pebbles; kohaku/showa koi, a golden ogon, a pink water-lily with gold heart
  and light flare, lily pads, maple leaves.
- **Setting / time**: night garden pond seen steeply from above; the moon is a disc *in the water* (left reach),
  crimson maple overhanging, snow-viewing stone lantern right, lily pads, lilies, fireflies, 10–30 koi, a dark basin
  under the card.
- **Palette**: teal/jade water, slate pebbles, kohaku red-white, ogon gold, crimson maple, pink lily, green-gold
  fireflies. Six "nights" wheel (`koi-pond-moods.js`): jade, frost moon, blossom, rose hour, harvest moon, moss rain;
  clock turns one night per 90 s. Pieces (`koi-pond-tetrominos.js:17-24`): I `#ffc852` lantern gold, O `#ffadd2`
  blossom pink, T `#7dffb8` lily green, S `#ff7b52` koi orange, Z `#7b94ff` twilight indigo, J `#ffe48a` candle, L
  `#7eeeff` pond cyan.
- **Key motifs**: koi, lilies, pads, maple, stone lantern, moon reflection, caustics, a jade-and-gold dragon.
- **Motion**: wave-equation height-field sim; koi swim in vertex shader, leap, dart; leaves drift; fireflies.
- **Gameplay FX**: lock = rings under the column + a **pebble of light** arcs out of the card into the reach
  (rings, band of colour across bed and fish); clear = koi leap (1/2/3), lilies open; quad = holds breath 1/3 s, six
  koi leap, all lilies open, dragon rears; chain = koi circle the board leaving gold ink trails; chain 7 = dragon
  wakes and swims the ring; level = next night.
- **Tech**: wave sim on half-float targets, curvature caustics, `viewportSharedTexture` refraction with depth
  rejection, per-frame shadow map, 6,400 instanced maple leaves, CPU-baked pebble bed; no assets loaded.
- **Avoid reusing**: top-down water, rings/ripples spreading from the piece column, caustic networks, fish, lilies and
  pads, lantern, red maple, moon reflection, creatures circling the board on a chain, a summoned dragon.

<a id="verdant-hills"></a>

### 20. Verdant Hills (`verdant-hills`) — "a windy day on the downs"

- Registry `:136-141`, group `biomes`. 27 modules + `assets/` (Blender-generated GLBs, 2.5 MB). Doc
  `docs/VERDANT_HILLS_KITE_DAY_OVERHAUL_2026-10.md`.
- **Icon**: kites (salmon-red, pink, yellow, purple) with diamond-segment tails across a pale sky, oak canopy at top,
  green patchwork valley, river, scattered round trees.
- **Setting / time**: bright midday, English chalk downs. Camera in deep grass with buttercups, daisies, clover; old
  oak with bench and rope swing left; chalk path, drystone wall, gate and a white windmill right; valley with tarn,
  river, hedgerow pastures; fair-weather cumulus with matching cloud shadows.
- **Palette**: saturated grass green, sky blue/white cumulus, buttercup yellow, daisy white. Kites = pieces
  (`verdant-hills-tetrominos.js:31-37`): I `#e8402f` poppy red, O `#3fa9f5` cerulean, T `#ffc928` sunflower, S
  `#f0509f` fuchsia, Z `#19c3b2` teal, J `#ff8b2b` tangerine, L `#9a6cf0` violet (palette gate 0/7).
- **Key motifs**: kites + tails, ribbons of wind, dandelion seed/chaff/petals, oak, windmill, swing, swallows,
  butterflies, cloud shadows, shaft of sun through a cloud gap.
- **Motion**: wind bands through grass, windmill sails, swing, cloud march, drifting shadows.
- **Gameplay FX**: lock = coloured wind ribbon curls from card edge + seed puff + grass gust + that piece's kite goes
  up for 20 s; clear = white ribbons from both sides at cleared rows, wind freshens, kites climb; quad = clouds open, a
  pool of sunlight and its shaft crosses the valley; combo = whirl of ribbons winding round the board; 7 kites =
  "festival"; game over = wind dies.
- **Tech**: Blender-headless assets (oaks with foliage-site point clouds, windmill, wall), baked land/cloud maps, one
  cloud field used for sky raymarch + ground shadows + air shafts, grass only where visible.
- **Avoid reusing**: pastoral green daylight, cumulus, kites/ribbons, wind-blown seeds/petals, oak/meadow flowers,
  whirl of ribbons round the board, "clouds part, sunlight pool" as the quad.

<a id="serenity-warp"></a>

### 21. Serenity Warp (`serenity-warp`) — "the wormhole gate"

- Registry `:150-155`, group `cosmic`. 14 modules. Doc `docs/SERENITY_WARP_VISUAL_OVERHAUL_2026-10.md` (rebuilt
  2026-10-11, last merge on main `5d3478d`).
- **Icon**: violet/purple swirling vortex, a thin white Einstein ring at centre, glossy coloured piece blocks
  (yellow, cyan, red, green, orange, blue) tumbling into it.
- **Setting / time**: deep blue-violet space; a wormhole hangs left of the card, gas wound in two spiral arms flowing
  in, a face-on galaxy of the next palette visible through the throat, lensed star arcs; solid rounded-bevel glossy
  pieces drift on the current.
- **Palette**: blue/violet space, white ring. Six sky palettes walked there-and-back (`serenity-warp-core.js:398-450`):
  verdant, lagoon, serenity, amethyst, rose, ember; clock drifts one per 90 s. Pieces
  (`serenity-warp-tetrominos.js:8-15`): I `#52ef32` green, O `#ffa31a` orange, T `#536dff` blue, S `#35e6ef` cyan, Z
  `#ff3b30` red, J `#ffe23d` yellow, L `#d33bea` magenta (saturated primaries).
- **Key motifs**: wormhole throat, Einstein ring, gravitational lensing, vortex, 3D glass pieces, stars drawn into
  trails.
- **Motion**: current spirals into throat; pieces drift and dive; jump through the gate on quad.
- **Gameplay FX**: lock = the piece itself lifts off the board white-hot as a solid block, four-pointed flare, cools,
  joins current; clear = rings of light leave the rim and cross the sky, streams from cleared rows into the throat,
  one piece per line falls in; combo = warp winds up, star trails; quad = holds breath 0.25 s then the throat opens
  wider than the frame and we fly through into the next sky; T-spin = vortex twists; level = next palette.
- **Tech**: sky as one function of direction (throat fold γ, lens β=θ−α²/θ, log-polar vortex), equirect env target,
  extruded `ExtrudeGeometry` pieces with clear-coat Fresnel + refraction, MSAA High+, gate shafts.
- **Avoid reusing**: vortex/wormhole/tunnel, lensing rings, 3D glossy piece props in the scene, "fly through into a
  new sky", purple-blue space.

<a id="kaleidosonic"></a>

### 22. kaleidosonic — "Indra's net, the shape of a sound" (`docs/KALEIDOSONIC_VISUAL_OVERHAUL_2026-10.md`)

- **Replaced** the legacy classic-WebGL `singing-bowl` (recursive cube trees, rainbow hue cycling) on 2026-10-13. `singing-bowl` is an alias in `RETIRED_THEME_IDS`, the track key `SingingBowl` resolves to `Kaleidosonic`, and Odyssey orb 56 is renamed "Indra's Net", both its descriptions rewritten.
- **Icon:** a kaleidoscope mandala: six glowing jewels (gold and magenta, alternating) in a ring round a neon filigree flower, on near-black pearl stone.
- **Setting:** inside a real-time ray-marched Apollonian sphere-inversion fractal (Indra's net): an endless hall of hourglass pearl pillars between fractal floors and vaults, nested spherical voids stacking into arches, seen diagonally across the pillar lattice. A faceted gem core with a twelve-lobed lotus corona hangs left of the card; its image repeats in every lattice cell as receding jewels.
- **Palette:** black-light poster: near-black pearl, fluorescent rims, three neon vein colours per mood. Six moods (`kaleidosonic-core.js`), hue-ordered by the core: rose mandala, violet hum, azure bell, teal chime, jade drone, amber gong, each with its own dark fog; one per 100 s of clock, resting 15 % at each end, a level-up adds one.
- **Pieces** (`kaleidosonic-tetrominos.js`): I `#2EE6D0`, O `#FFD23F`, T `#E8329E`, S `#15A05A`, Z `#FF8A45`, J `#7B4DFF`, L `#5AB0FF`, GARBAGE `#2E2440`. Jewel tones; the palette gate scores 3/7; worst CVD pair ΔE 15.7.
- **Motion:** veins (nodal rings of each source's standing wave, twelve petals) flow outward with an integrated breath; jewels twinkle on their own phases; the eye drifts slowly; the core pulses.
- **Gameplay FX:**
  - Lock: a struck note at the stone beside the card the column and row map to: a lotus of light blooms and closes, the stone floods with the piece colour, a wavefront crosses the stone, ripples ring on at the piece's own wavelength, passed jewels ring in its colour. Hard drop: stronger, faster, an eye kick.
  - Clear: a harmonic: a shell of light leaves the core, nodal rings bloom (more lines, more shells), the temple resonates, the fractal refolds (its inversion springs to a new shape).
  - Chain: the trance: finer fractal, brighter faster veins, and the lens folds into a kaleidoscope (mirror at 2, six sectors at 5, twelve at 8); the core's images become a crown of jewels.
  - Four lines: a dive one diagonal lattice period down a free lane, landing seamlessly on the same view. T-spin: the eye rolls a full turn (the kaleidoscope turning). B2B: drone rings round the core. Perfect clear: every mirror aligns into a mandala. Level up: the mood wheel steps. Game over: the light sinks and the rings flow back into the core.
- **Tech:** one full-screen MeshBasicNodeMaterial: a laid-out Apollonian field with a fractional fold count, a laid-out kaleidoscope fold, an Amanatides–Woo cell walk for the jewels, an analytic faceted gem, strikes and harmonics in TSL `Loop`s over compacted uniform rows; no textures, no bakes.
- **Avoid reusing:** ray-marched sphere-inversion (Apollonian/Kleinian) fractals, Indra's net jewels in every cell, black-light neon veins as standing-wave rings, a kaleidoscope lens as the combo dial, a dive by one lattice period, Chladni figures on floors, a faceted gem core with a lotus corona.

<a id="starlight"></a>

### 23. Starlight (`starlight`) — "the mirror of the night"

- Registry `:164-169`, group `cosmic`. 13 modules. Doc `docs/STARLIGHT_VISUAL_OVERHAUL_2026-10.md`.
- **Icon**: circular star trails around the pole, Milky Way band, a bright fireball/meteor flare upper right, blue
  night, low hill silhouettes and a mirror-flat lake reflecting the trails, one warm shore lamp.
- **Setting / time**: night (dark-sky site) over a mirror lake; Milky Way stands over the far hills; lamps on the far
  shore lay broken light paths; the whole sky turns round the pole (once per 24 min).
- **Palette**: navy/indigo night, grey-white Milky Way with brown dust lanes, warm amber lamps. Six hours wheel: deep
  night, airglow, first light, afterglow, zodiacal light, blue hour (one per 100 s). Pieces
  (`starlight-tetrominos.js:11-18`): I `#fff4c7`, O `#c9b8ff`, T `#93ffe8`, S `#ffa7d8`, Z `#8fa2ff`, J `#ffd69a`, L
  `#cfefff` (pale pastels).
- **Key motifs**: stars, star trails (long exposure), constellations drawn with lines (14 real figures), shooting
  stars, fireball with train, mirror lake, hill silhouettes.
- **Motion**: sky rotation; shutter opens on chains (trails up to 40°).
- **Gameplay FX**: lock = coloured mote rises on a bowed path and becomes a star in the constellation + ring on the
  lake under the column; clear = constellation lines drawn, a shooting star per row; quad = fireball across the
  whole sky, Milky Way swells; chain = shutter opens → star-trail wheel; T-spin = sky whirls 22°; level = hour swings.
- **Tech**: dome where below-horizon pixels read the mirrored sky (lake = same function), analytic star powder in grid
  cells, instanced capsule strips along circles, no render targets.
- **Avoid reusing**: night sky as hero, mirror lake reflections, star trails, constellations, meteors/fireball,
  rings on still water, "sky rotates".

<a id="golden-forest"></a>

### 24. Golden Forest (`golden-forest`) — "the lake at the golden hour"

- Registry `:171-176`, group `biomes`. 23 modules + `assets/` (Blender GLBs, 2.9 MB). Doc
  `docs/GOLDEN_FOREST_LAKE_OVERHAUL_2026-10.md`.
- **Icon**: everything amber-gold; a huge low sun behind spruce, misty lake, ripple rings in the foreground, hanging
  spruce boughs framing left.
- **Setting / time**: golden hour, Nordic lake; sun on the treetops of a headland laying a path over the water; hero
  spruce left, shore pine + plank jetty + red rowboat right; islet, reedy spit, 4 receding ridges; mist on water,
  volumetric shafts, fireflies, a flock and a skein.
- **Palette**: monochrome amber/honey/gold with olive-green conifers. Pieces (`golden-forest-tetrominos.js:11-18`): I
  `#ffd27a` lantern amber, O `#c7b5ff` lavender, T `#7ff4c9` mossy mint, S `#ff9fc0` aurora rose, Z `#6479d8` pine
  indigo, J `#ffe8a6` dawn, L `#9be8ff` misty cyan. No level palette wheel (level = "lake exhales").
- **Key motifs**: conifers, low sun + sun path, mirror lake, ripple rings, fireflies, reeds, rowboat, birds, god rays.
- **Motion**: breeze ruffles water, fireflies, flock wheeling, fish rising, boat rocking.
- **Gameplay FX**: lock = ring on the lake from where the piece landed + puff of fireflies from card edge; clear = twin
  firefly jets from both sides at cleared rows, sun path flares, wind front bends trees; quad = lake breathes out
  light, sunburst, flock rises; combo = fireflies form a river winding round the board; game over = sparks sink.
- **Tech**: Blender-headless conifers (bark mesh + needle foliage sites), static shadow map, analytic shores,
  volumetric shafts.
- **Avoid reusing**: golden-hour amber monochrome, low sun disc on horizon, conifer silhouettes, lake + ripples,
  fireflies, firefly river round the board.

<a id="geode"></a>

### 25. Geode (`geode`) — "the heart of the geode"

- Registry `:178-183`, group `cosmic`. 14 modules. Doc `docs/GEODE_VISUAL_OVERHAUL_2026-10.md`.
- **Icon / capture**: tunnel view into a crystal hollow; incandescent white-gold heart, concentric agate bands in
  honey/orange/rose/rust, a dense wall of violet/indigo amethyst points, hero prisms in green, red, orange, cyan, pink.
- **Setting / time**: inside an egg-shaped geode looking down its axis, lit from behind by a sugar-white crystal window;
  18 clusters of large crystals (amethyst, citrine, rose, aquamarine, garnet, emerald) reaching in; dust drifts down the
  axis, glitter flashes. No time of day.
- **Palette**: saturated violet + orange/gold, jewel accents. Six minerals cycle (level + 90 s clock): amethyst,
  citrine, rhodochrosite, celestine, malachite, fire opal. Pieces (`geode-tetrominos.js:13-20`): I `#ffd060` citrine,
  O `#e060ff` amethyst, T `#60ff90` emerald, S `#ff6040` fire opal, Z `#ff70ff` rose tourmaline, J `#ffa050` topaz, L
  `#60ffff` aquamarine.
- **Key motifs**: faceted crystals with dispersion, agate fortification bands, glitter, radial tunnel composition,
  central glowing heart.
- **Motion**: slow camera drift (facets flash), dust drifting, glints.
- **Gameplay FX**: lock = a ring in piece colour leaves the heart through the agate + a spark from card edge strikes a
  hero crystal which flashes, chimes and **keeps colour 30 s**; clear = row blades + a wave down the wall releasing held
  colour; combo = rings of new crystals shoot out of the wall in spectrum order; quad = holds breath 0.2 s, the lining
  fractures with white-gold cracks, prismatic lances, a prism ring splits the frame; T-spin = agate turns a notch;
  level = recrystallise to next mineral.
- **Tech**: faceted normals from screen derivatives, transmission/backlight, dispersion flashes, world-space glitter,
  no scene lights.
- **Avoid reusing**: crystals/gems/prisms, agate banding, radial tunnel looking at a glowing centre, violet+orange
  jewel palette, spectral dispersion flashes, cracks of light.

<a id="bioluminescence"></a>

### 26. Bioluminescence (`bioluminescence`) — "the living grotto"

- Registry `:185-190`, group `cosmic`. 17 modules. Doc `docs/BIOLUMINESCENCE_VISUAL_OVERHAUL_2026-10.md`.
- **Icon / capture**: flooded cavern of giant teal mushrooms with glowing radial gills, lime-green and lilac caps,
  violet jellyfish floating in air, pale crystals in the water, glow-worm specks; teal-green fog; full mirror pool.
- **Setting / time**: underground darkness; viewer in the shallows of a pool down a cave; court of great mushrooms each
  side, 27 m elder on a far island, vines with light pods, glow-worm colonies on the vault, medusae of light in the air.
- **Palette**: teal / cyan / mint dominant, lime and orchid accents, near-black stone. Five palettes (level + clock):
  lagoon, abyss, orchid, ember, foxfire. Pieces (`bioluminescence-tetrominos.js:16-23`): I `#ffc75a` amber spore, O
  `#b48cff` orchid, T `#3df5ff` sea-sparkle, S `#ff6fb5` anemone pink, Z `#3dffa8` mint fungus, J `#b8ff5a` foxfire
  lime, L `#4d9bff` abyss blue.
- **Key motifs**: giant glowing mushrooms, gills as lamps, mycelium, spores, floating jellyfish, glow-worms, crystals,
  reflective black pool, mist halos.
- **Motion**: stems sway, spores drift, jellies swim, plankton rings on water.
- **Gameplay FX**: lock = plankton ring under the board, a swimmer crosses to a mushroom whose cap blooms in the piece
  colour and **keeps it 30 s**; clear = blades break into spores, wave of plankton light releases held colours; combo =
  more jellies rise, fairy rings sprout, glow-worms kindle; quad = "Great Bloom" (holds breath 0.25 s, elder erupts in
  spores); T-spin = spores swirl.
- **Tech**: 12-lamp uniform array evaluated in a TSL `Loop`, closed-form in-scatter halo per lamp (two `atan`s),
  instanced lathe mushrooms with part/v/angle attributes, planar mirror pool.
- **Avoid reusing**: teal/cyan bioluminescent glow on darkness, mushrooms, jellyfish, spores, glow-worms, cave/grotto,
  mirror pool, "light stored then released".

<a id="shifting-sands"></a>

### 27. Shifting Sands (`shifting-sands`) — "twin-sun dusk over the dune sea"

- Registry `:192-197`, group `biomes`. 12 modules. Doc `docs/SHIFTING_SANDS_VISUAL_OVERHAUL_2026-10.md`.
- **Icon / capture**: apricot-orange dusk desert, a dark sandworm arch silhouetted against a low sun, second sun
  above, dune slip faces, sandstone mesas/butte right, two pale crescent moons, cirrus streaks, gold motes.
- **Setting / time**: twin-sun dusk on a dune sea (barchanoid ridges, 34° slip faces); suns low left (ember gold Ø3.5°,
  white gold Ø1.4°); "the Sentinel" butte with spires right; Rampart escarpment on the horizon.
- **Palette**: apricot horizon → dusty rose → violet → deep blue zenith; sand ochre/peach with violet shadows;
  coloured double shadows. Pieces (`shifting-sands-tetrominos.js:15-22`): I `#ffd06a`, O `#c9a0ff`, T `#7fffb8`, S
  `#ff9070`, Z `#8090ff`, J `#ffb855`, L `#7ec8ff`.
- **Key motifs**: dunes, sandworm breach, dust geysers (geysers), spindrift, sand glitter, mesas, twin suns,
  moons, heat haze, crepuscular shafts.
- **Motion**: worm breach cycle every 52 s, blowing sand sheets, gold motes, heat shimmer.
- **Gameplay FX**: lock = "drum beat" golden ring of lifted sand across the erg; combo ≥2 = gold glows, wind rises;
  clear = n dust geysers in side zones + gust + sun flare; four lines = worm summoned (sign races in, tremor, great dust
  geyser, worm rears); level = dusk deepens, suns sink.
- **Tech**: polar-grid CPU bake with horizon tangents for twin-sun shadows, per-pixel exact ridge slopes, vertex-animated
  worm tube, occluded crepuscular shafts in post, "desert filmic" tone map.
- **Avoid reusing**: dunes/sand, orange-apricot dusk desert, twin suns, mesas, a giant creature breaching, geysers of
  dust, golden ring across the ground on lock.

<a id="grainfields"></a>

### 28. grainfields — "ripe barley under a breaking storm" ([record](../../GRAINFIELDS_VISUAL_OVERHAUL_2026-10.md))

- **Replaced** the legacy classic-WebGL Misty Lake on 2026-10-18 (its moonlit lake, aurora, fireflies and tree-trunk
  framing are gone with it). The old id is an alias in `RETIRED_THEME_IDS`, its track key resolves to `Grainfields`
  (the same recording, retitled), and Odyssey orb 11 (authored id 12, chapter 3's opener) is "Grainfields".
- Registry: group `biomes`, heavy. `src/themes/grainfields/` (the house module split, plus the Lapporten gate's own
  module and the Blender-built trees' assets).
- **Icon**: the golden hour through the gate (Lapporten's U over the gold field, larch and birch either side).
- **Setting / time**: grain country at harvest, seen from low in a stand of ripe barley. Rolling fields and
  shelterbelts of larch, spruce and birch run out past a ruined keep on a knoll to Lapporten on the horizon, the U-shaped glacial gate near Abisko:
  a flat-topped massif with a cliffed inner wall on the left, a steep wall rising to a shoulder and a long ridge on the
  right, a broad trough between them, birch on their skirts and a little snow in the cirques. A storm deck hangs over
  everything and is breaking; sunbeams come through its gaps (and through the gate) and walk across the fields, and the
  wind runs through the grain. A herd of Hokkaido native horses (Dosanko) grazes in the barley right of the card, and
  skeins of geese cross the sky (Lapporten's Sami name, Čuonjávággi, is the goose valley). The day turns through five stations (`grainfields-hours.js`): storm break, golden hour,
  dusk, dawn mist and morning, 100 s of clock a station, never resting; a level-up steps it forward.
- **Palette**: ripe-barley gold, storm-deck slate and blue, larch and spruce greens, birch white. Pieces
  (`grainfields-tetrominos.js`): I `#E9B53B`, O `#E5482C`, T `#25A26B`, S `#3A6CE2`, Z `#9356D8`, J `#F2EDE1`,
  L `#D7356E`, GARBAGE `#2E3238`: the mineral pigments of a gold-leaf screen of autumn fields. Palette gate 0/7.
- **Gameplay FX**: a lock opens a gap in the deck and a sunbeam stands in the barley beside the card (pigment motes of
  the piece's colour lift through it; a hard drop adds a ring of wind through the stalks); a clear sends a lane of wind
  running out through the barley; a chain breaks the storm open and sets the horses running; a T-spin wheels the wind
  (a column of chaff) and the herd; four lines tear the sky wide over the gate and run a front of light over the
  fields; a perfect clear clears the sky; a level-up sends a skein of geese out through the gate; game over brings
  dusk.
- **Tech**: `WebGPURenderer` + TSL with the WebGL2 fallback; a fan-mesh land, instanced barley, Blender-built
  shelterbelt trees and a Dosanko horse (GLB) with sprites far out; one storm deck that the sky, the land's shadows and the post's march
  through the air all read, so every gap stands in the air as a shaft.
- **Avoid reusing**: ripe grain seen from inside the stand, sunbeams walking the land through a breaking storm deck, a
  U-shaped glacial gate on the horizon, shelterbelts across fields, a herd grazing in the grain, geese flying out
  through a gate.

<a id="waves"></a>

### 29. Waves (`waves`) — "the green room"

- Registry `:206-211`, group `biomes`. 15 modules. Doc `docs/WAVES_VISUAL_OVERHAUL_2026-10.md`.
- **Icon / capture**: inside a barrel wave; teal-jade glass wall streaked with flow curling overhead, orange sunset sun
  and road of light seen through the tube's eye, sparkling spray off the lip.
- **Setting / time**: inside a breaking tube at golden hour (slow-motion ×1/7); face right, lip curtain left, sea and
  sun through the eye. Six hours wheel (100 s each, level adds): golden hour, sunset, afterglow, moonrise, first light,
  trade-wind day.
- **Palette**: deep jade/emerald water, gold-orange sun; per-hour water jade/violet/sapphire/aquamarine/turquoise.
  Pieces (`waves-tetrominos.js:13-20`): I `#a8f6ff`, O `#f4ffb5`, T `#bdb9ff`, S `#87ffd6`, Z `#ffa6e3`, J `#6b8dff`, L
  `#ffe08f` (sea-glass pastels).
- **Key motifs**: curling wave tube, glassy streaked water, spray drops, sun road, dolphins, set waves.
- **Motion**: lip thrown and falling, flow streaks, hanging drops, dolphins leaping.
- **Gameplay FX**: lock = a stroke of the piece colour runs the roof's arc and rains off the lip + crown of drops +
  refracting rings in the trough; clear = sheet of spray, rings of light down the tube; quad = clock runs at 1/10 for
  2 s with a frozen throw of glass beads; chain = dolphins cross the eye (1/2/3/4 at 3/5/7/9); level = set wave + hour.
- **Tech**: one folded sheet in vertex stage, closed-form tube ray optics, sky as function, closed-form drops, post
  shafts, FXAA.
- **Avoid reusing**: ocean/surf, curling tube composition, jade glass water, spray beads, dolphins, slow-mo hold.

<a id="luminous-tides"></a>

### 30. Luminous Tides (`luminous-tides`) — "the glowing shore" (rebuilt 2026-10-13)

- Registry `:213-218`, group `biomes`. 15 modules under `src/themes/luminous-tides/`. Doc
  `docs/LUMINOUS_TIDES_VISUAL_OVERHAUL_2026-10.md`.
- **Icon**: the moment a great set wave breaks: a wall of cyan sparks against the orange town-glow sky, glowing spray thrown off its lip, the far coast's lamps on the horizon.
- **Setting**: a night beach seen standing at the edge of the swash. The shore runs to a vanishing point right of
  the card: open sea with diagonal lines of surf on the left and in the middle, the beach curving away under a
  dark tree line of palms to a forested headland on the right, a far coast low on the left horizon whose town
  glows in the cloud and streaks its lamps on the water.
- **Time**: night; six nights on a wheel (afterglow, harbour glow, starfield, deep, blue hour, sea mist), clock
  plus level. **Palette**: the sea's light from cyan through electric blue to cobalt, teal and sea-green;
  sodium-orange town glow and lamps; near-black water and sand. Pieces (`luminous-tides-tetrominos.js`): I
  `#FFB23E`, O `#45DCF7`, T `#1F9E63`, S `#FF7F95`, Z `#3557E8`, J `#C08AF7`, L `#ECEDC9` (0/7 in band).
- **Key motifs**: bioluminescent surf breaking in sections, lobed glowing swash edges, backwash lace on wet
  sand, fields of sparks, glowing spray off breaking lips, a far town's lamps streaked on calm water, palms.
- **Motion**: a 6 s surf train with sets about every 71 s, the swash running up and draining, spray off every
  lip, the sky turning slowly, cloud drifting in off the sea.
- **Gameplay FX**: lock = a drop of the piece's colour falls into the surf beside the card and bursts in a
  glowing crown; clear = a wave of light per line stands up, breaks along the shore both ways (peel, spray)
  and runs up the beach; quad = a 2 m set wave glowing from within floods the beach; perfect = the whole bay
  lights; chain = rain, every drop a spark; T-spin = a shoal of fish streaks through the shallows; level =
  the night wheel turns a step, the bay shimmers.
- **Tech**: `WebGPURenderer` + TSL; one fan mesh for sea and beach with closed-form surf and swash in vertex and
  fragment; an energy-conserving spark field (three laid-out layers); closed-form spray from each crest's
  break moment; the sky as one function shared by dome and water mirror; one post pass.
- **Avoid reusing**: bioluminescent surf and swash on a night beach, glowing swash lobes and backwash lace,
  a far town's lamp streaks on water under orange-lit cloud, drops falling into glowing water as the lock,
  rain as the combo dial.
### Cross-fleet patterns that are already saturated (within these 15; survey 2)

The new theme should break these, not repeat them:

1. **"Light leaves the card edge at the piece's height, lands in a site that keeps the colour ~30 s, a clear's
   radial wave releases it."** Galaxy (nurseries), Geode (hero crystals), Bioluminescence (mushroom caps), Aether
   Tides (stars, ~1 min), Starlight (constellation stars). Five themes share this exact grammar.
2. **Row "blades of light" / jets leaving the card at cleared-row height.** Galaxy, Aether Tides, Geode,
   Bioluminescence, Golden Forest (firefly jets), Verdant Hills (white ribbons), Serenity Warp (streams).
3. **Quad = "holds its breath" (all lights sink 0.2–0.33 s) then erupts.** Galaxy, Aether Tides, Geode,
   Bioluminescence, Koi Pond, Serenity Warp; Waves does a slow-mo variant.
4. **Combo = something circling/winding round the board or a centre.** Koi (fish ring), Golden Forest (firefly river),
   Verdant (ribbon whirl), Aether (maelstrom), Galaxy (rings round nucleus), Geode (crystal rings), Serenity Warp
   (warp winds up), Kaleidosonic (the kaleidoscope's crown of jewels turns round the card).
5. **Rings/ripples on water under the piece column.** Koi, Golden Forest, Starlight, Waves, Bioluminescence, Luminous
   Tides; Shifting Sands does it with sand, Kaleidosonic on stone beside the card.
6. **Reflective water / mirror surface.** Starlight, Golden Forest, Bioluminescence, Koi, Rainy Window, Waves,
   Luminous Tides (7 of 15).
7. **Level = palette wheel + clock drift 90–100 s per step.** Koi (6 nights), Geode (6 minerals), Bioluminescence
   (5), Serenity Warp (6), Starlight (6 hours), Waves (6 hours), Galaxy/Aether (5 palettes on level), Kaleidosonic
   (6 moods).
8. **Fireflies / floating motes / bokeh.** Golden Forest, Koi, Bioluminescence (spores), Shifting Sands (gold
   motes).
9. **Night or darkness as the base.** Galaxy, Aether, Serenity Warp, Starlight, Koi, Rainy Window, Bioluminescence,
   Luminous Tides, Kaleidosonic, Geode (interior). Only Verdant Hills (midday), Golden Forest and Waves (golden hour),
   Shifting Sands (dusk) and Grainfields (a storm breaking into sunbeams) are lit by a sun.
10. **Palette families already owned**: violet/magenta/blue space gas (Galaxy, Aether, Serenity Warp); teal/cyan
    glow on black (Bioluminescence, Luminous Tides); amber-gold monochrome (Golden Forest); apricot/rose dusk
    (Shifting Sands, Waves golden hour); jade water (Koi, Waves); violet+orange jewels (Geode); saturated grass green +
    sky blue (Verdant Hills); navy moonlight (Starlight); grey storm (Rainy Window); ripe-barley gold under storm
    slate (Grainfields); black-light neon on near-black pearl (Kaleidosonic).
11. **Composition tropes**: radial tunnel to a glowing centre (Geode, Serenity Warp, Waves eye); low sun on a horizon
    behind silhouettes (Golden Forest, Shifting Sands, Waves); tree framing at screen edges (Golden Forest, Verdant,
    Koi maple); shafts through a breaking storm deck walking the land (Grainfields).
12. **Piece-colour tables** mostly reuse the same soft pastel set (`#ffd…` amber I, lavender O, mint T, pink S,
    indigo Z, cream J, pale cyan L): Rainy Window, Golden Forest, Shifting Sands, Starlight, Koi Pond. A new theme should pick a distinct, saturated set tied to its world, and must keep
    `npm run check:palette` (`scripts/palette-guideline-check.mjs`) from flagging it: bands I cyan 160–210°, O yellow
    32–75°, T purple 245–315°, S green 90–170°, Z red 320–20°, J blue 200–250°, L orange 20–50°; FAIL at 7/7, WARN at
    6/7. Verdant Hills, Galaxy, Aether Tides score 0/7.

### Visual territory none of these 15 occupy (survey 2)

- Daylight or high-key scenes other than an English meadow: bright white/pastel or high-altitude light.
- Surreal colour as geology/biology on land: mineral hot-spring terraces, rainbow strata, salt/sulphur flats, coloured
  lakes. (Geode owns *crystal cavern* jewel tones, so keep away from faceted gems.)
- Vertical landscapes: karst towers, sea stacks, cloud-piercing pillars, hanging forests (no theme here is vertical;
  composition is always a horizon or a tunnel).
- Fabric/paper/glass/ink as a medium (none; Singing Bowl's crude origami-tree icon left with it).
- Weather and optics as the main event: halos, glories, iridescent clouds, light pillars, Brocken spectre (Part 4
  shows that parhelion and nimbus-veil already own sun-halo and cloud optics).
- Gameplay grammars not yet used: pieces becoming growth (strata, terraces, coral, stalactites accreting), flows that
  fill basins, pigment/paint diffusion, architecture assembling. (Sound made visible as standing-wave patterns,
  Cymatics, was on this list until Kaleidosonic took it on 2026-10-13: Chladni floors and standing-wave veins.)
- Palettes unused here: turquoise + white mineral + rust; vermilion + jade + cream; sulphur yellow + acid green +
  salt white; coral + seafoam in daylight; iridescent pearl/opal.

(Cosmic Chimes, the theme these surveys were written to replace, was DOM/CSS in group `cosmic`; the user wanted no
more space themes, so its replacement Rainbark moved to `biomes`. Registry `group` values used here: `cosmic`,
`biomes`, `urban`, `meditation`.)

## Part 3. Survey 3: fluid-dreams to chiral-gold (15 themes)

Sources per theme: icon PNG (viewed), registry entry in `src/themes/theme-registry.js`, the
`docs/*_VISUAL_OVERHAUL_2026-10.md` record where one exists, in-game/playground captures under
`docs/<id>-captures|overhaul/` and `docs/theme-screenshots/<id>.png`, theme-module header and
`<id>-tetrominos.js`. Read-only; nothing in the repo was changed.

Registry (`src/themes/theme-registry.js`): fluid-dreams L220 (group `abstract`), crystal-cave L227
(`cosmic`), moonlit-greenhouse L234 (`biomes`), murmuration L241 (`abstract`), nebula-flow L248
(`abstract`), chromatic-impasto L255 (`abstract`), voltage-storm L262 (`abstract`), lunara L269
(`cosmic`), solar-eclipse L276 (`cosmic`), moonrise-summit L283 (`biomes`), black-hole L290
(`cosmic`), supernova L297 (`cosmic`), void-ember L304 (`cosmic`), cosmic-noir L311 (`cosmic`),
chiral-gold L318 (`cosmic`). All but moonlit-greenhouse, nebula-flow, moonrise-summit are in
`HEAVY_GPU_THEME_IDS` (L~440-485). Icon field always `./<id>/<id>-theme-icon.png`.

Tech split in this slice:
- **2026-10 "masterpiece" rebuilds** (WebGPURenderer + WebGL2 backend, TSL node materials, no
  ShaderMaterial, closed-form particles, 6 tiers, max-channel-knee bloom + hue-preserving filmic
  output pass with "calm zones" over card/HUD): fluid-dreams, crystal-cave, chromatic-impasto,
  voltage-storm, lunara, solar-eclipse, black-hole, supernova, void-ember, chiral-gold; murmuration
  (upgrade-in-place + rename, uses WebGPU compute).
- **Legacy, undocumented**: moonlit-greenhouse (DOM/CSS layers + 2D canvas), nebula-flow (raw WebGL
  Pavel-Dobryakov fluid port), moonrise-summit (WebGLRenderer + ShaderMaterial + EffectComposer),
  cosmic-noir (4,895-line dual WebGL/WebGPU class, ShaderMaterial + node materials, compute sparks).

<a id="fluid-dreams"></a>

### 31. fluid-dreams — "the dreaming sea" (`docs/FLUID_DREAMS_VISUAL_OVERHAUL_2026-10.md`)

- **Icon**: an iridescent glass-liquid balloon/drop (violet, cyan ink swirling inside) on a thin
  liquid stem rising from a hot-magenta sea; pink sun sphere; small drops on threads far off;
  stars in violet sky.
- **Setting / time**: endless sea of liquid light at violet dusk, seen from just above the surface.
  The Great Drop (3 m, glass-clear, ink inside, thin-film skin pink->violet->cyan) hangs upper-left
  on a liquid thread from the sea; kin drops float right over a low "dream sun" with a glitter
  path; ink clouds + stars in sky; every drop is a lens showing the horizon inverted.
- **Palette**: violet/amethyst sky, hot magenta-pink horizon + sea, teal/cyan ink, pale pink sun.
  Pieces: I `#00E5FF` O `#FFD93D` T `#FF2D95` S `#6FE7E0` Z `#FF6FB5` J `#B14CFF` L `#FFA84C`
  GARBAGE `#1A0532`. Level palettes (`fluid-dreams-core.js` L168): amethyst-dusk, lagoon,
  rose-gold, ultraviolet, aurora-mint.
- **Motion**: slow swell, thread-suspended drops bob, ink drifts, film flows/sags.
- **Gameplay FX**: lock = droplet in piece colour arcs from card edge into sea, ring train + jet +
  bead, colour **stays** as marbled ink stain (~20 s). Hard drop = 3 droplets. Clear = rows pour
  out as droplet fans; wave packet per line; stains flare; bead climbs thread into Great Drop.
  Combo = Drop buds satellites (up to 8). Quad = hush, Drop falls, Worthington crown, rain,
  rebound column. T-spin = funnel/spiral arms. Perfect = sea turns to glass + pale ring.
- **Tech**: single full-screen SDF raymarch (exp smooth-min nested unions), multi-bounce loop,
  thin-film interference, per-channel refraction, Beer-Lambert, baked CPU noise tile, FXAA+grain.
- **Do not reuse**: iridescent soap-film/thin-film liquid blobs, metaball drops on threads, magenta
  sea under violet dusk, pink sun on horizon with glitter path, "colour stain spreads in water".

<a id="crystal-cave"></a>

### 32. crystal-cave — "the resonant hall" (`docs/CRYSTAL_CAVE_VISUAL_OVERHAUL_2026-10.md`)

- **Icon**: cluster of amber/pink/gold quartz prisms centre, turquoise cluster left, magenta and
  violet right, all reflected in a black pool; rock pillars; blue crystal shards on ceiling.
- **Setting / time**: underground cave hall, timeless/dark; still pool down its length; turquoise
  crystals left bank, amethyst geode right; amber/rose spars on walls; crystal chandeliers between
  stalactites; warm amber "heart" on an island far end; skylight shaft through a chimney;
  glow-worms on ceiling.
- **Palette**: teal-blue cave rock, turquoise, amethyst purple, sapphire, amber/orange, rose pink.
  Pieces: I `#ffc860` O `#c080ff` T `#50ffc0` S `#ff60c0` Z `#6080ff` J `#ffa060` L `#70f0ff`
  GARBAGE `#0a0818`. Mineral families: T/L aqua, O amethyst, Z sapphire, S rose, I/J amber.
- **Motion**: slow light climbing each crystal out of step, facet flashes as camera drifts, dust.
- **Gameplay FX**: lock = glint + motes fly to crystals of matching mineral, stone "rings" (pulse
  root->tip), family glows; ring on water. Clear = prismatic fan from card sides, light wave rings
  every crystal, new crystals sprout permanently (1 cluster/line). Combo = crystal tips link into
  a lattice of beams. Quad = 2 fans/waves, skylight flares, vault rains light. Perfect/level =
  the heart flares.
- **Tech**: Blender-authored `cavern.glb` (146k tris, Cycles-baked 8 light channels per vertex),
  analytic hexagonal-prism gem tracing in fragment (TIR, dispersion, inclusions), instanced; pool
  = `reflector()` + refraction; CPU sparks.
- **Do not reuse**: faceted quartz/gem prisms, neon gemstone palette, cave/stalactites,
  glow-worms, light shafts through a vault, "crystals ring like an instrument", beam lattice.

<a id="moonlit-greenhouse"></a>

### 33. moonlit-greenhouse — legacy, no overhaul doc

- **Icon**: flat-vector illustration: glass greenhouse interior, full moon framed by glazing bars,
  dark pond with lily pads, cattails and reeds, rain/dew dots; desaturated sage-green.
- **In game** (`docs/theme-screenshots/moonlit-greenhouse.png`): mostly a slate-blue gradient
  (`#0d1b2a`->`#1b263b`->`#415a77`) with a faint 100 px grid (greenhouse framework), a flat cream
  moon disc `#f7f3e3` top right with a moonbeam wedge. Plants barely visible.
- **Setting / time**: night, inside a Victorian glasshouse; parallax plant silhouettes, dewdrops,
  moths.
- **Palette**: slate blue/teal-grey night, sage green, cream moon. Pieces: I `#ffda9e` O `#d7b3ff`
  T `#82f5b8` S `#ff9ecf` Z `#5b7ba7` J `#ffd76a` L `#a8ffd8` GARBAGE `#112021`.
- **Motion**: CSS `plant-sway` (10 s), `moon-pulse`, `moonbeam-sway` (20 s), `dewdrop-glisten`.
- **Gameplay FX** (2D canvas): LINE_CLEAR/COMBO only (no lock FX): pollen bursts
  (`#c8ff8c`/`#fff4a3`), fireflies, leaf spirals, moss glows, blooming flowers, mist waves,
  cyan-green bioluminescent ripples `#8cffda`.
- **Tech**: DOM divs in `index.html` L343-354 (`#greenhouse-sky`, `#greenhouse-moon`,
  `#greenhouse-framework` ...), CSS in `public/styles/main.css` ~L4995, 2D canvas overlay.
- **Do not reuse**: glasshouse glazing grid, cattails/lily pads, moths, fireflies/pollen,
  moon-framed-in-window.

<a id="murmuration"></a>

### 34. murmuration — swarm of light (formerly electric-dreams-v3) (`docs/MURMURATION_VISUAL_UPGRADE_2026-10.md`)

- **Icon**: a ring/gyre of tens of thousands of streak particles, cyan core bands with pink/magenta
  outer bands, deep blue-indigo background.
- **Setting / time**: night sky, dim indigo nebula; ring of light orbiting the board's place.
- **Palette**: mint, cyan, violet, rose bands on deep indigo; combo warms toward gold. Cyclic
  8-stop palette by position (`composition/swarm-palette.js`). No piece config (default).
- **Motion**: divergence-free flow field (gyre + soft annulus walls + Kraichnan shear waves);
  ribbons from 6 wandering sources; tilted thick disc; colour drifts over minutes.
- **Gameplay FX**: lock = hairline ring crosses swarm + lens tap; clear = tall elliptical ring
  sideways; quad = 2 rings + swirl + formation 4.5 s; T-spin = counter eddies + knot (trefoil,
  Mobius); perfect = implode then bloom into lotus/sunflower/snowflake; combo = gyre speeds,
  turns gold, formations; game over = heart. 28 particle formations (mirrored pairs flanking
  board).
- **Tech**: WebGPU compute (CPU `stepCPU()` on WebGL2), 9k-130k additive streak quads, thin-lens
  DOF, selective MRT bloom, domain-warped FBM nebula. Rename precedent (commit a74a86a): id, folder,
  class, post stack names, icon, song, Odyssey orb 54, playground effect, tests,
  `RETIRED_THEME_IDS` alias.
- **Do not reuse**: particle swarm/flock gyre around the board, cyan-pink-violet streak bands,
  particles assembling into figures, rings as the lock language.

<a id="nebula-flow"></a>

### 35. nebula-flow — legacy fluid sim, no overhaul doc (`src/themes/nebula-flow/README.md`)

- **Icon**: five glossy candy orbs (orange, blue, cyan, pink, green centre) on black starfield with
  confetti dots — does NOT match the running theme.
- **In game** (`docs/theme-screenshots/nebula-flow.png`): near-pure black with a few soft blurred
  dye blobs (gold, rose, magenta).
- **Setting**: abstract, black void; autonomous Navier-Stokes dye.
- **Palette**: schemes cosmic/ocean/aurora/fire/prismatic (`color-schemes.js`), default
  `prismatic` (full hue wheel). Pieces: I `#ff5ea8` O `#6ad0ff` T `#ffb03a` S `#c04bff`
  Z `#2be0a0` J `#ff7a3c` L `#3a86ff` GARBAGE `#181820`.
- **Motion**: wandering emitters splat dye; vorticity confinement swirls; fade every 10 s.
- **Gameplay FX**: combo 1-3 single spiral splats, 4-7 dual counter-rotating, 8+ triple spiral +
  central burst; four lines = mirrored horizontal wave; lock splat.
- **Tech**: shared `src/utils/webgl/fluid-simulator.js` (raw WebGL, GLSL in `nebula-flow/shaders/`),
  bloom + sunrays, `setTimeout`-scheduled effects.
- **Do not reuse**: 2D ink/dye fluid on black, spiral splat combos, glossy orbs.

<a id="chromatic-impasto"></a>

### 36. chromatic-impasto — "the canvas the board paints" (`docs/CHROMATIC_IMPASTO_VISUAL_OVERHAUL_2026-10.md`)

- **Icon / rest capture**: whorl of thick oil-paint strokes: blood red, cadmium yellow, turquoise,
  ultramarine, deep green, salmon, cream; gold-leaf rim; black contours.
- **Setting / time**: a full-frame oil canvas seen square-on (action-painting floor), raked by a
  studio lamp upper-left; no sky, no horizon.
- **Palette**: Bengt Lindstrom "Kvinnan Alpha" tubes — `#b80f14` red, `#0a2fc8` ultramarine,
  `#00b8ae` turquoise, `#ffbe00` yellow, `#ff7300` orange, `#1a7f4d` green, contour `#08080a`
  (`chromatic-impasto-core.js` L130). Periods: lindstrom, fauve, nocturne, ember, spring.
  Pieces: I `#00D9CC` J `#0033CC` L `#FF7F00` O `#FFD000` S `#1A7F4D` T `#B30000` Z `#FFF8DC`.
- **Motion**: great whorl round the board + counter-whorls; painter adds an occasional stroke.
- **Gameplay FX**: lock = a brush stroke of piece colour leaves card side and bends into current,
  stays (wet gloss 2 s); hard drop = palette-knife slab + splat crater + thrown paint; clear =
  loaded brushes per row + ring of wet light; combo = canvas twists a notch per link into whorl
  arms, fluorescent then gold arcs; quad = near-dark hush, paint flung everywhere, gold-leaf ring
  round card (one ring per quad); level = new art period; new game = canvas scraped.
- **Tech**: stroke log replayed into two half-float targets (pigment, relief), heightfield
  relief lit with parallax + 8-tap shadow march, soft-box reflections, Catmull-Rom bake of twist.
- **Do not reuse**: impasto/oil-paint relief, brush strokes, whorls/swirls, gold leaf, the
  "board paints a permanent picture" metaphor, primary-colour Fauve palette.

<a id="voltage-storm"></a>

### 37. voltage-storm — "the collector field" (`docs/VOLTAGE_STORM_VISUAL_OVERHAUL_2026-10.md`)

- **Icon**: forked white-violet lightning bolt striking a Tesla tower with glowing pink capacitor
  rings; rain streaks; deep navy-blue storm sky.
- **Setting / time**: supercell over a flooded plain at dusk; dark cloud ceiling, cold teal clear
  strip at horizon with rain shafts and far hills; two rows of lattice collector towers with
  capacitor rings, toroid electrodes, guy wires, reflected in shallow water; rain everywhere.
- **Palette**: slate/steel blue, cold teal horizon, white lightning; drifts round 6 palettes every
  ~80 s: tempest (teal), ultraviolet, red sprite, ember dusk, golden squall, hail green.
  Pieces: I `#f5e000` O `#b64bff` T `#2bff6a` S `#ff2a3d` Z `#1e9bff` J `#ff7a1a` L `#1ef0ff`.
- **Motion**: rain, intra-cloud flicker, distant bolts, palette drift, cloud drift.
- **Gameplay FX**: lock = arc in piece colour leaps from card edge to tower, rings fill bottom-up,
  sparks, ring on water; tower **keeps** charge ~30 s; clear = arc per row + one bolt per line
  onto most-charged towers (leader + return strokes); combo = standing arcs between tower tops,
  corona; quad = hush, superbolt with 5 return strokes, sheet lightning ring, screen ripple;
  T-spin = mesocyclone wind-up.
- **Tech**: sky painted once to reduced target and reused for water mirror; cloud = marched slab
  of baked 3D noise; bolts = instanced ribbon built in vertex stage; towers mirrored as geometry.
- **Do not reuse**: lightning, storm clouds, rain, flooded mirror plain, lattice towers/pylons,
  arcs and sparks, blue-steel night palette.

<a id="lunara"></a>

### 38. lunara — "the valley of twin moons" (`docs/LUNARA_VISUAL_OVERHAUL_2026-10.md`)

- **Icon**: huge cratered violet moon with thin glowing ring, small red companion moon, pink
  crystal obelisk with star tip, aurora teal curtains, low-poly mountains, crystal shards.
- **Setting / time**: night on an alien crystal world; mirror flats (hand-deep water over glowing
  veins); great moon upper-left + rose companion; crystal spires along shores; lantern flowers;
  faceted crystalline ranges; ringed planet far right; three aurora curtains.
- **Palette**: violet/amethyst sky, teal-green aurora, pink/lavender/ice-blue crystals.
  Level palettes: amethyst, rose quartz, glacier, ember, ultraviolet. Pieces: I `#ffd4a8`
  O `#d8a8ff` T `#a8ffe8` S `#ffa8d0` Z `#8090e0` J `#ffc050` L `#a8e0ff`.
- **Motion**: companion orbits (transits), aurora waves, motes rise, camera drift.
- **Gameplay FX**: lock = wisp to spire, spire flashes + keeps light ~30 s, rings on flats, veins
  light; clear = moonlight blades + wave voiding spires; combo = halo rings round moon (up to 6),
  veins on moon face; quad = pillars of light on tallest spires, prismatic sky ring, meteors,
  moonfire-gold wave.
- **Tech**: all `MeshBasicNodeMaterial` from one sky function, flat-shaded crystal (derivative
  normals), aurora solved by fixed-point not marched, `reflector()` on Medium+, moon texture.
- **Do not reuse**: giant moons, ringed planet, aurora curtains, low-poly faceted mountains,
  crystal spires, violet-teal night, mirror flats, light veins in a lakebed.

<a id="solar-eclipse"></a>

### 39. solar-eclipse — "the black sun over the salt mirror" (`docs/SOLAR_ECLIPSE_VISUAL_OVERHAUL_2026-10.md`, rebuild merged 36cdf48, salt-mirror pass 2026-10-12)

- **Icon**: the black sun with white corona streamers and prominence loops above its own
  reflection, a burning orange cloud band and a low far shore on the horizon between them,
  dusk-violet sky.
- **Setting / time**: totality over a flooded salt flat through a long lens; the film of water
  gives the sun back below the horizon, broken near the lens by cracked crust polygons; a low
  cloud deck burns beyond the edge of the moon's shadow; low far-shore ranges and an uneven
  volcanic shield with a parasitic cone, all mirrored; Venus/Jupiter out.
- **Palette**: indigo-violet sky, amber/orange horizon and cloud band, white corona, pink
  chromosphere, lilac salt. Wheel palettes: ember, gold, jade, azure, violet, rose (100 s per
  step). Pieces: I `#fff7b1` O `#ff9635` T `#ff5f8a` S `#c3e8ff` Z `#ffbe5d` J `#7085ff`
  L `#ffeedd`.
- **Motion**: corona rays drift, moon wanders (chromosphere sliver creeps), palette wheel, solar
  cycle reshapes corona, cloud deck drifts, wind patches roughen and still the water.
- **Gameplay FX**: lock = mote to limb (and its reflection) raises a prominence in piece colour,
  born in a flare at its feet (column-mapped); clear = Baily's beads necklace + oldest
  prominences erupt + a ring dropped into the sun's own reflection; quad = diamond ring, glitter
  path down the water, shadow bands over the salt, CME bubble; T-spin = corona twists + a whirl
  in the reflection; chain = longer exposure (outer corona, stars, earthshine) + water stills to
  glass.
- **Tech**: dome + image-plane sun; below the horizon each pixel draws the sky in the direction
  the water reflects it (one evaluation, no reflector pass), tilted by analytic swell + a ripple
  table; dipole-field corona; warped-Voronoi salt polygons; baked crest table for 6 far-shore
  ranges; moon matte in post for the moon and its reflection.
- **Do not reuse**: eclipse/black disc/corona rays, salt flat with cracked polygons, a mirror
  under an eclipse, a cloud deck lit beyond a shadow's edge, orange horizon under violet dusk,
  prominence arches. (The mirror itself is the fleet's "mirror water across the bottom third"
  cliché, Part 0.)

<a id="moonrise-summit"></a>

### 40. moonrise-summit — legacy, no overhaul doc (`src/themes/moonrise-summit/moonrise-summit-theme.js` L1-23)

- **Icon**: flat-vector giant amber-gold full moon with craters behind dark navy faceted peaks;
  navy-to-amber sky gradient; few stars.
- **In game** (`docs/theme-screenshots/moonrise-summit.png`): navy night, bright white moon with a
  radial god-ray starburst, thin cloud band, flat grey dunes/ridges, a dark lake.
- **Setting / time**: alpine lake at moonrise, night.
- **Palette** (L55-79): skyZenith `0x06091f`, skyMid `0x142147`, horizon `0x2c3a64`, warm glow
  `0x6a3a4a`, mountains `0x2a3458`/`0x1f2a4a`/`0x18223a`, snow `0xeaf2ff`, moon `0xf6efd8`,
  aurora `0x6fb3ff`/`0x8d7bff`. Pieces: I `#ffe7b3` O `#c9b2ff` T `#d3fff1` S `#ffb0c9` Z `#8aa4d5`
  J `#ffd089` L `#bfe9ff`.
- **Motion**: drifting clouds, mist layers, aurora ribbon, gentle waves, pointer parallax.
- **Gameplay FX** (L880-930): clear = moon pulse + 2-4 shooting stars + lake highlight; combo =
  aurora intensity + warm horizon + mountain rim; lock = 35 % chance lake ripple.
- **Tech**: `WebGLRenderer` + 17 `ShaderMaterial`s + `EffectComposer` (UnrealBloom 0.4 + "Ghibli
  grade"), FogExp2, 3-plane moon (disc + anamorphic streak + halo), fbm ridge planes.
- **Do not reuse**: moon over mountain peaks, moon god-ray starburst, alpine lake reflection strip,
  shooting stars, navy-blue night.

<a id="black-hole"></a>

### 41. black-hole (`docs/BLACK_HOLE_VISUAL_OVERHAUL_2026-10.md`)

- **Icon**: Gargantua-style lensed black hole: black shadow, gold/orange accretion disk with
  lensed arch over/under, violet-white polar jets, ember sparks, blue galaxy.
- **Setting / time**: deep space; hole in free space left of board, disk running behind playfield;
  camera orbits every ~90 s (tilted whirlpool <-> edge-on).
- **Palette**: gold/amber disk (ember red rim, white beamed side), black shadow, razor photon
  ring, navy/blue Milky Way and stars. Pieces: I `#c4d1ff` O `#8895ff` T `#5f6dff` S `#62ffe0`
  Z `#ff78c4` J `#3a3f66` L `#f8b24f`.
- **Motion**: Keplerian gas shear, lensed stars sliding in arcs, camera orbit, dust streaks.
- **Gameplay FX**: lock = piece dissolves into stream spiralling onto disk, hot arc in its colour
  (seen twice via lensing), refraction ring at board; clear = pressure wave, photon ring flares,
  space ripple; quad = jets + ejecta + screen ripple; streak winds hole hotter; T-spin = violet
  knot; perfect = gold arcs.
- **Tech**: Schwarzschild geodesic ray-march in one material, analytic shadow edge, baked galaxy
  panorama, per-pixel lattice stars, dynamic resolution controller.
- **Do not reuse**: accretion disks, gravitational lensing/space ripples, polar jets, gold-orange
  swirl round a black void, starfields.

<a id="supernova"></a>

### 42. supernova — "the star the board feeds" (`docs/SUPERNOVA_VISUAL_OVERHAUL_2026-10.md`)

- **Icon**: white-gold star core with horizontal lens streak, surrounded by crimson/pink/gold/
  cyan turbulent filament shells and sparks.
- **Setting / time**: deep space; massive boiling star left of card in nested nebula shells
  (crimson, teal, gold), thin tilted gas ring, deep starfield.
- **Palette**: crimson, teal/cyan, gold filaments; red-gold star with electric-blue limb; violet
  void. Palettes: hydrogen, helium, carbon, oxygen, silicon (drift 80 s). Pieces: I `#64dcff`
  O `#ffaa00` T `#ff0033` S `#00ff88` Z `#ff00ff` J `#0088ff` L `#ffdd00`.
- **Motion**: granulation boils, shells drift outward, ember wind, palette drift.
- **Gameplay FX**: lock = stream lands on star, flash/ripple/prominence, colour patch ~10 s, ring
  through nebula; clear = shock rings per line; combo = star heats red->white->blue, beads light
  on ring (12); quad = collapse, detonation (6-spike flash, 3 rings, fireball, blast-wave
  refraction), pulsar beams sweep, regrow ~13 s.
- **Tech**: nebula shells as closed-form sphere intersections (no marching), one uniform table
  loop, 64^3 baked 3D noise, star on one billboard.
- **Do not reuse**: stars/suns, nebula filament shells, shockwave rings, detonation flashes with
  lens spikes, pulsar beams, crimson/teal/gold nebula palette.

<a id="void-ember"></a>

### 43. void-ember — "the last ember" (`docs/VOID_EMBER_VISUAL_OVERHAUL_2026-10.md`)

- **Icon**: molten crust sphere (orange cracks on dark plates), orange corona flares, pink/cyan
  plasma wisps, black asteroid rocks.
- **Setting / time**: empty void; dying star as banked coal (dark crust, fire in cracks), belt of
  cinders edge-on with chiselled stones crossing its face, backlit dead world crescent, violet
  dust and few stars.
- **Palette**: lava orange/ember red on black crust, purple-violet void dust; void palettes
  verdigris, abyss, indigo, violet, garnet. Pieces (flame-test colours): I `#fff0c2`
  O `#ff5a2e` T `#ffb23a` S `#ff2e63` Z `#7c5cff` J `#35d6c9` L `#5aa8ff`.
- **Motion**: plasma loops rise/lift off, belt rotates, ember wind, heat ramp.
- **Gameplay FX**: lock = comet into star, flash, scar, plasma loop in piece colour held (1/e 26 s);
  clear = plasma shell toward board, loops torn off, wave shoves stones; combo = star heats coal ->
  gold, crust breaks; quad = hush then flare, screen ripple, white-gold streamers.
- **Tech**: depth-writing solids + MSAA, 256^2 two-slice 3D-noise lattice, ribbon loops in star
  frame.
- **Do not reuse**: molten/cracked crust spheres, lava/ember glow, asteroid/rock belts, planets,
  orange-on-black.

<a id="cosmic-noir"></a>

### 44. cosmic-noir — legacy, perf audit only (`docs/COSMIC_NOIR_PERF_AUDIT_2026-06-30.md`)

- **Icon**: monochrome: black ringed planet with blazing white ring, grey-white smoky nebula above,
  black sky.
- **In game** (`docs/theme-screenshots/cosmic-noir.png`): huge grey-white wispy nebula fills right
  half, dark textured planet lower-left with white ring streak.
- **Setting / time**: deep space, grayscale film-noir.
- **Palette**: pure greyscale. Pieces: I `#f8f8ff` O `#cfd2d6` T `#b0b5c0` S `#9aa0aa` Z `#7f8691`
  J `#5b616c` L `#3c4049` GARBAGE `#16181d`.
- **Motion**: twinkling 30k starfield, drifting nebula quads, gas swirl, accretion ring.
- **Gameplay FX** (theme.js L4394-4470): lock = planet pulse + star flash + cosmic wave torus + lock
  shake; combo = reactive envelope (pulse/bloom/spark/atmosphere); clear = waves, compute void
  sparks, gas-swirl burst, anamorphic lens flare at combo >= 6.
- **Tech**: `cosmic-noir-theme.js` 4,895 lines; ShaderMaterial + node materials, EffectComposer/
  UnrealBloom fallback, WebGPU compute sparks, MRT guarded on Windows.
- **Do not reuse**: ringed planets, grayscale smoke nebula, monochrome noir look.

<a id="chiral-gold"></a>

### 45. chiral-gold — "the two towers and the black water" (`docs/CHIRAL_GOLD_VISUAL_OVERHAUL_2026-10.md`)

- **Icon**: twisted gold ribbons/DNA-like helix with fine wires, warm bokeh gold dust on dark brown.
- **Setting / time**: dark hall, black still water floor; two mirror-image towers of braided gold
  ribbons + counter-wound wires with sliding beads either side of the board; great half-sunk gold
  ring arching over the board; gold bokeh dust.
- **Palette**: gold, amber, bronze on near-black brown; alloys fine/rose/white/green/red gold.
  Pieces: I `#FFF6D6` O `#FFD700` T `#FFAC33` S `#FFC857` Z `#E67E22` J `#D35400` L `#F39C12`.
- **Motion**: towers counter-rotate, beads slide, studio env rotates, music-reactive water/dust.
- **Gameplay FX**: lock = sparks corkscrew into towers, pulse up ribbons, ring on water; clear =
  blades of light strike towers, spiral gold leaf, comets cross ring; combo = cores to white, ring
  opens into armillary sphere, "x3" stamped in gold; quad = hush, ring ignites, water gilded,
  double spiral of leaf, gold rain.
- **Tech**: `MeshStandardNodeMaterial` metalness 1 with CPU-baked HDR studio env (soft boxes, 34
  pin lights), `reflector()` Medium+, mirrored geometry.
- **Do not reuse**: gold metal, helices/ribbons, bokeh dust, black mirror water, armillary rings,
  gold leaf/rain.

### Cross-cutting patterns in this slice (the "house template" to break from; survey 3)

1. **Event metaphor template** (10 of 11 rebuilds): lock sends a mote/wisp/arc/comet/droplet/stroke
   *in the piece's colour from the card edge at the piece's height* to a hero object that **keeps**
   the colour for ~10-30 s (spires, towers, loops, stains, prominences, strokes); clear releases
   held colour via a wave/ring "one front per line"; combo "charges" the hero (rings, satellites,
   beads, lattice, arcs per step); quad/perfect = "holds its breath" hush (~0.2 s darkening) then a
   big release + screen ripple; T-spin = something twists into a pinwheel; level = step to the next
   of 5-6 named palettes; many also drift palettes by clock (80-100 s). The infrastructure is fine
   to reuse, but the new theme should find a different *visual verb* (not rings + held glow + hush
   again).
2. **Composition template**: one hero object in the free space LEFT of the card, secondary
   object right; card calm zones; upright phone moves the hero above the card.
3. **Overused surfaces**: still mirror water / planar `reflector()` (fluid-dreams, crystal-cave,
   voltage-storm, lunara, chiral-gold, moonrise-summit lake, moonlit-greenhouse pond).
4. **Overused motifs**: moons (lunara, moonrise-summit, moonlit-greenhouse, solar-eclipse's moon),
   black discs/spheres with rings (black-hole, solar-eclipse, cosmic-noir, void-ember belt, lunara
   ringed planet), crystals/prisms (crystal-cave, lunara), aurora curtains (lunara, moonrise-
   summit), silhouette ridge layers with mist (solar-eclipse, moonrise-summit, lunara), vortex /
   whorl / gyre (chromatic-impasto, murmuration, nebula-flow, black-hole), stars/nebulae (8 of 15).
5. **Overused palettes**: violet + magenta + cyan/teal neon on dark (fluid-dreams, lunara,
   murmuration, crystal-cave, nebula-flow); gold/amber/orange on black (chiral-gold, black-hole,
   void-ember, supernova, solar-eclipse horizon); navy night + cream moon (moonrise-summit,
   moonlit-greenhouse); greyscale (cosmic-noir).
6. **Time of day**: 13 of 15 are night/dusk/void; none is bright daylight, golden-hour daylight,
   overcast-white, or dawn; none is terrestrial-geological in daylight.
7. **Tech conventions to mirror** (from the rebuilds): `<id>-core.js` (three-free maths, palettes),
   `-tsl.js`, `-world.js` (shared with playground effect), `-director.js` (per-player
   `ComboTracker`, true combo; bus `COMBO` = cascade depth per ADR-0011), `-composition.js` (live
   card/board/HUD rects), `-post.js` (scene pass + knee bloom + one output pass), `-quality.js`
   (Minimal..Extreme), `-theme.js` (lifecycle, WebGPU else WebGL2 backend, GPU-loss recovery);
   no `ShaderMaterial`, no MaterialX noise (CPU-baked tiles), closed-form particles, `seek(t)`
   replay; icon = playground icon-lens frame baked into 512 px circle, copied to
   `public/assets/themes/<id>-theme-icon.png`.

Unclaimed territory within this slice (for the design step, cross-checked against Parts
1–2): daylight or dawn light; earth-mineral palettes (sulfur yellow, travertine white, ochre/rust,
jade-green acid, thermophile orange bands); terrestrial geology without moon/stars; translucent
sheet/curtain materials other than aurora; organic growth that is not plants-in-a-greenhouse.

## Part 4. Survey 4: nimbus-veil to parhelion (15 themes)

Read-only survey, done 2026-10-11. Sources for each theme: the icon PNG (viewed), the `docs/*` overhaul doc (when there is one), the theme module header, the piece colours and any capture images under `docs/*-captures`, `docs/*-overhaul`, `reports/*-overhaul` and `docs/theme-screenshots`.

Registry entries are in `src/themes/theme-registry.js:325-428`. The groups are: nimbus-veil and cinder-drift `atmospheric`; rainbow-terraces and parhelion `sky`; pyrestorm and vesper-chrysalis `fantasy`; neon-dusk, neon-district and synthwave-sunset `urban`; chromadelic-highway `abstract`; stillwater `biomes`; blood-moon, astral-weave, stellar-velocity and stellar-drift `cosmic`.

<a id="nimbus-veil"></a>

### 46. nimbus-veil ("Nimbus Veil")

- **Files.** Icon at `src/themes/nimbus-veil/nimbus-veil-theme-icon.png`. Header at `nimbus-veil-theme.js:1-16`: "above a golden sea of clouds at sunset: billowing cloud tops, towering cumulus, crepuscular rays, drifting mist veils and floating golden motes".
- **Icon.** The icon does not match the scene. It shows grey-blue cumulus at night, with snow-like white dots and a faint warm glow behind the clouds.
- **Shipped look.** Captured in `reports/nimbus-veil-overhaul/after-playground-game.jpg`. A pastel flight low over a sea of cloud: a peach and rose sun at the lower left, lavender and blue sky, and towering pink-lavender cumulus on the right.
- **Palette.**
  - Haze runs `0xb895bd` to `0xffcb92` (`nimbus-veil-tsl.js:148`).
  - Sky ramp: `0xe9b3b8`, `0xffc79a`, `0xa39cd0`, `0x5f7fc6`, `0x2b4f9e` (`:155-158`).
  - Motes: `0xffe6b3`, `0xfff6e0`, `0xffd0a0`, `0xf6e2ff`.
  - Pieces (`nimbus-veil-tetrominos.js:13-20`) are moonlit pastels: I `#dff6ff`, O `#f6f6ff`, T `#bfc6ff`, S `#cfe9ff`, Z `#aebdff`, J `#9ab0d8`, L `#e2ecff`, GARBAGE `#161a27`. Render mode `glow`.
- **Motifs.**
  - A polar-grid cloud sea of about 33k vertices, displaced by eroded fBm.
  - Cloud tops wrap-lit gold, valleys lavender, silver linings toward the sun (`nimbus-veil-cloudsea.js:1-10`).
  - Cumulus towers, two mist veils, a low sun, crepuscular rays.
- **Motion.**
  - The cloud sea scrolls slowly toward the camera.
  - The camera yaws so the sun sits in the free zone beside the board.
  - Motes drift.
- **Gameplay FX** (`nimbus-veil-world.js:313-349`).

  | Event | Response |
  | --- | --- |
  | Lock | sunPulse and seaGlow bumps |
  | Clear | an expanding ring, rising sparkles; a "heavenly burst" of 220 sparkles on four lines |
  | Combo | sun and sea glow, plus a heavenly burst |
  | Level up | ring plus burst |

  The FX are generic glow-and-sparkle; there are no board-anchored stories.
- **Tech.** WebGPURenderer with its WebGL2 backend (ADR-0019). Node materials, no compute, no MRT, analytic vertex animation, instanced Sprites. Post (`nimbus-veil-post.js`): bloom, light rays, grade. Dynamic resolution.
- **Avoid reusing.** A sea of clouds seen from above; pastel peach/lavender sunset sky; cumulus towers; golden motes; crepuscular rays from a low sun; a "fly over the clouds" camera.

<a id="rainbow-terraces"></a>

### 47. rainbow-terraces — "Rainbow Terraces: the high country with the sun behind you" (`docs/RAINBOW_TERRACES_VISUAL_OVERHAUL_2026-10.md`)

- **Files.** Module `src/themes/rainbow-terraces/`; icon at `src/themes/rainbow-terraces/rainbow-terraces-theme-icon.png` (registry `:336`), copied to `public/assets/themes/rainbow-terraces-theme-icon.png`. The theme was called Sky Children (id `sky-children`) until 2026-10-18; the old V2 module (`src/themes/sky-children-v2/`) was deleted that day. The registry maps both old ids here.
- **Icon.** The Spring Isle close up at the gilded hour: a moss crown with cypresses and a stone gateway hung with a bronze bell, a cream travertine cascade of jade pools, the Mother Fall pouring off its shoulder with the bow's leg standing in her spray, a cumulus tower over a slate storm behind.
- **Setting.** The eye stands on a stone overlook (a balustrade, a mossy travertine outcrop) at the edge of a high country with the sun low behind it, so the whole frame is composed round the antisolar point.
  - The Spring Isle: an upturned mountain of bedded rock (leaning, lobed), its crown with trees, the gateway and the cascade, the Mother Fall dropping the frame's height into the Deep.
  - The Twin Isle with a broken two-tier aqueduct and threads of falls; the Far Gate, a colossal ruined arch on its own mesa; a far archipelago in bands.
  - The Deep: a cloud sea a kilometre down, its domes lit full face, holes onto luminous depth; a storm wall with a lit crown behind a cumulus tower; cirrus; an altocumulus drift.
  - Every droplet optic from one CPU-baked spectral table: the bow, the secondary, Alexander's band, supernumeraries, the fogbow, the opposition glow, the glory. Paper gliders (the children) in two flocks.
- **Palette.** Five hours on a wheel, 110 s an hour by the clock (resting 15 % at each end), a level turning one hour (`rainbow-terraces-hours.js`): Jade Morning, Gilded Afternoon, Rose Hour (the Belt of Venus, the Earth's shadow climbing the stone, alpenglow on the crowns), Moonbow Night, Pearl Dawn. Accents `#6fd6b0`, `#ffbe55`, `#ff6f8a`, `#8fb4ff`, `#9fd8e6`.
- **Pieces** (`rainbow-terraces-tetrominos.js`, `renderMode: 'glow'`): I `#ffd04a`, O `#c46bf0`, T `#6fe3a6`, S `#ff6b5e`, Z `#45d0e6`, J `#ff9a45`, L `#6577ff`, GARBAGE `#3a4260`.
- **Gameplay FX.**
  - Lock: a light-copy of the piece at the card's edge melts into light-water and arcs to a terrace pool, which holds the colour as a jewel; a hard drop fires at once as a jet.
  - Clear: each row's light leaps off both sides of the card like a fountain and falls into the Deep; a surge runs down every fall, the oldest held colours ride down them as bands.
  - Four lines: the hush, then the glory round the antisolar point and the great pour (every held colour down the Mother Fall as stripes); a perfect clear runs the Far Gate's spillway.
  - Combo: the children paint the rainbow, one stroke per link (a comet of the link's colour, glitter off each laid stroke, a sweep along each bow as it closes), both bows at 13.
  - Level up: the bell tolls, rings run across the cloud sea, the light turns an hour.
- **Tech.** three r186 `WebGPURenderer` + TSL with the WebGL2 fallback; every material a `MeshBasicNodeMaterial` lit by hand; nothing loaded (all textures CPU-baked); 15 draws on every tier; `RenderPipeline` post (bloom with calm zones over the card and HUD, hue-preserving filmic, split-tone grade).
- **Avoid reusing.** Floating isles pouring waterfalls into a cloud sea; travertine terrace pools; a rainbow as the combo meter; antisolar optics (the glory, the opposition glow); paper gliders; a colossal ruined arch on the horizon; a stone balustrade overlook as the foreground.

<a id="cinder-drift"></a>

### 48. cinder-drift ("Cinder Drift")

- **Files.** Doc `docs/CINDER_DRIFT_VISUAL_OVERHAUL_2026-10.md`. Captures in `docs/cinder-drift-captures/` (desktop-rest, ingame, events, portrait, tiers).
- **Icon.** An orange lava-crack floor (Voronoi seams), a column of light or lava pouring down in the back, and stacked basalt blocks.
- **Look.** A magma chamber underground. Cliffs of columnar basalt, organ-pipe columns hanging from the roof, a lava lake under drifting dark crust plates with glowing seams, a great lavafall from the left cliff, and one cold blue shaft of night through a roof hole on the right.
- **Palette.**
  - Strict heat spectrum: black, deep red, orange, gold, white-hot. One cool blue-violet accent from the night shaft.
  - Pieces (`cinder-drift-tetrominos.js:13-20`): I `#fff5e6`, O `#ffcc00`, T `#800020`, S `#cccc00`, Z `#cc3300`, J `#9a2a18`, L `#ff8800`, GARBAGE `#333333`. Render mode `gradient`, radial.
  - Five level palettes (`cinder-drift-core.js:185`): ember, crimson, gold, forge, rose.
- **Motion.** Crust plates drift from the fall past the viewer, embers rise, smoke banks move, heat haze.
- **Gameplay FX** (doc §Event language).

  | Event | Response |
  | --- | --- |
  | Lock | Heat drops into the lake beside the card: a burst, a lava jet, a crown of drops, a ring through the crust. A melted pool persists and drifts. Sparks fly from the card edge. |
  | Clear | Each row vents a tongue of fire out of the card. A wave runs through lake and cliffs. A fissure opens with 2, 4 or 6 fountains. |
  | Combo | Pressure rises: lava climbs the column seams, fire rains from the organ pipes, up to 6 cliff fissures. |
  | Four lines | Lights sink for 0.25 s, then a curtain of 12 fountains, lava bombs arcing, the lake standing open. |
  | T-spin | A whirl of the crust. |
  | Level up | The next palette. |
- **Tech.** Node materials only, all `MeshBasicNodeMaterial`, self-shaded.
  - The crust is a baked tileable Voronoi with true edge distances (512², 13×13 sites).
  - `HeatField` is a 192² wrapping field with closed-form cooling.
  - Columns are an instanced prism in one `InstancedInterleavedBuffer`.
  - Running lava is one instanced ballistic ribbon.
  - Closed-form events with `seek(t)`.
  - A max-channel bloom knee, no MRT, one output pass (haze, fringe, shafts, filmic).
  - Six tiers.
- **Avoid reusing.** Lava, magma, basalt columns, ember storms, fire fountains, Voronoi crust plates with glowing seams, a heat-spectrum palette, an underground chamber, a cold light shaft through a roof hole.

<a id="pyrestorm"></a>

### 49. pyrestorm ("Pyrestorm")

- **Files.** Record `docs/PYRESTORM_VISUAL_OVERHAUL_2026-10.md`; captures in `docs/pyrestorm-captures/`. Icon at `src/themes/pyrestorm/pyrestorm-theme-icon.png`.
- **Look** (rebuilt 2026-10-13, "the mountain that makes its own weather"). A night eruption seen from a high tephra ridge (the eye at the brow of a slope with boulders and a crag). Left third: a breached stratovolcano 15 km away (summit ~3.2 km) with an older caldera wall (somma) on its left shoulder, a satellite cone, threads of lava down its gullies, the crater fountaining fire. Out of the breach a lava river runs down onto a black plain and braids toward the eye; a fissure burns in a low curtain of fire on the right and sends its own river in; both meet below the ridge. Above the summit the eruption column climbs and bends downwind into a pyrocumulonimbus anvil that roofs the sky, lit orange from below, mammatus on its underside, charged with volcanic lightning. Upwind (left) the sky is clear: stars and a faint Milky Way. Ranges on the horizon.
- **Time.** Night, five watches on a wheel that drifts with the clock (one per 100 s, rest 0.15) and steps forward on level-up, walked there and back in hue order: ember dusk (crimson afterglow behind the volcano), magenta night, violet night, indigo deep night (most stars), steel dawn (rose glow on the right). Game over sinks the eruption to a glow; it wakes with the next run.
- **Palette.** Near-black basalt and tephra lit only by fire: a blackbody ramp (dull red, orange, yellow, yellow-white) for lava, spatter, bombs and the fountain; charcoal ash lit orange at the column's foot; night skies from crimson dusk through violet to indigo and steel dawn; lightning in the watch's colour (lilac, violet, ice blue). Pieces (solid tiles, palette gate 2/7, worst CVD pair dE 16): I lightning lavender #C9B5FF, O sulphur #F4C430, T incandescent orange #FF6A1F, S ember crimson #C21E3A, Z storm blue #2673E6, J olivine #33B07A, L ash white #EDE6DA, garbage cooled basalt #2B2422.
- **Motion.** Lava crust drifts downstream; the fountain and the fissure jet in closed-form arcs; the column's lobes climb its axis, churn and grow as it widens; the storm lives at rest (a slow glow inside the cloud, a crawler every few seconds); embers climb off the rivers at the near corners and ash falls past the eye; heat shimmer over the lava; stars twinkle; the lens breathes and follows the pointer.
- **Gameplay FX.**

  | Event | Response |
  | --- | --- |
  | Lock | A Strombolian burst: bombs arc out from the crater leaning the way the piece locked and splash on the cone, tinted by the piece colour |
  | Hard drop | A bigger burst, sparks, and a tremor tears the crust open along every channel |
  | Clear | One cloud-to-ground bolt per line out of the column (higher rows strike higher up the cone); scorch and sparks; the column lit from inside |
  | Chain | The storm charges (spider lightning along the anvil, the fountain climbs); a long chain's break discharges it in one great bolt to the summit |
  | Four lines | A Vulcanian blast: one crater flash, a torn shock front through the column, a ring of bombs, the fountain at twice its height, a glowing surge down the breach |
  | T-spin | A vortex ring (a hot inner ring inside a sooty outer one) rises and widens beside the column |
  | Back-to-back | St Elmo's corona on the summit |
  | Perfect clear | Sheet lightning sweeps the anvil; a crown of four bolts round the summit |
  | Level up | The night moves a watch (it also drifts by itself); the fountain kicks; fresh lava surges down every channel with a glowing wake |
  | At rest | The storm lives: a slow glow inside the cloud near the column's head, a crawler along the anvil every four to nine seconds |
- **Tech.** Node materials only (MeshBasicNodeMaterial, self-shaded), WebGPU with the WebGL2 backend. Land: a polar fan round the eye (exponential rows) plus the volcano's own ring mesh, from one CPU height function, baked in slices in PyrestormWorld.prepare. Lava: two nested RGBA8 distance fields (centreline distance, half-width, heat, glow; heading, kind, arc length) with a pixel-width antialiased edge, a two-phase flow map and a blackbody ramp. Column: a ray-marched volume inside a tube proxy round its curved axis (12-40 steps by tier, early out when opaque): billow noise in the column's own frame advected up the axis, fire from below with one shadow tap toward the crater, sky with one tap up; the axis solved per sample by two Gauss-Newton steps. Anvil: one sheet seen from below. Event smoke: CPU-sorted puffs from a baked billow atlas, soft-edged, lit by their body's normal. Lightning: 8 slots of uniform rows, channel + branches built in the vertex stage from a seed, double-sided ribbons; the CPU mirrors the envelope to light land and cloud. Fire: closed-form jets, a GPU-flown ring buffer of bombs, motes. Post: one scene pass, a hue-preserving bloom (Medium+), one output pass with heat shimmer masked by the bloom, calm zones, filmic, grade, grain. Six tiers.
- **Avoid reusing.** Volcanoes and eruptions (a breached cone, a somma, fountains), lava rivers and fissure curtains, an eruption column bending into an anvil, mammatus lit from below, volcanic lightning (bolts, spider lightning, discharge), St Elmo's fire, a shock front ring through cloud, a smoke vortex ring, Strombolian bombs.

<a id="neon-dusk"></a>

### 50. neon-dusk ("Neon Dusk")

- **Files.** Header at `neon-dusk-theme.js:1-4`: "the great sun sinking into a pass between neon mountain ranges: laser-scan lines tracing every ridge, a glass floor mirroring it all under a scrolling neon grid, stars, stratus bars and a whisper of VHS tape". Captures in `reports/neon-dusk-overhaul/`.
- **Icon.** A huge peach sun between two mountain ranges with cyan and gold contour lines, a magenta grid floor with the sun reflected in it, a plum starry sky.
- **Palette.**
  - Plum and magenta sky, a peach-gold sun, cyan laser contours, hot-pink grid lines.
  - Post grade: violet shadows, warm highlights.
  - Pieces (`neon-dusk-tetrominos.js:14-21`): I `#ff5cc8`, O `#a24bff`, T `#2bffb0`, S `#ff7b24`, Z `#00b4ff`, J `#ffcf1a`, L `#00f6ff`, GARBAGE `#0c0418`. Render mode `glow`.
- **Motifs.**
  - Ridged-multifractal ranges in three depths; the middle range carries glowing topographic contour lines.
  - A planar-reflector glass floor and a "pristine grid".
  - Hologram rings out of the sun, shooting stars, VHS chroma and glitch.
- **Motion.** The grid scrolls toward the sun; the camera yaws to put the sun beside the board.
- **Gameplay FX** (`neon-dusk-world.js:458-559`).

  | Event | Response |
  | --- | --- |
  | Lock | Piece-shaped tiles light up in the glass, plus a ripple ring from the landing spot. |
  | Clear | A wave of light rolls in from the horizon, the contours flash, hologram rings, rising pixels. |
  | Combo | Tape glitch, a shooting star, a sun burst. |
  | Level up | Everything at once. |
- **Tech.** WebGPURenderer and WebGL2 node materials. A `reflector()` pass at 0.4 resolution. One-pass post: bloom (4-tap max-channel soft-knee), split-tone, vignette, dither. No god rays.
- **Avoid reusing.** A huge setting sun on the horizon; neon grid floors; contour or laser lines on mountains; glass mirror floors; VHS or glitch looks; magenta, cyan and plum dusk.

<a id="neon-district"></a>

### 51. neon-district ("Neon District")

- **Files.** Doc `docs/NEON_DISTRICT_VISUAL_OVERHAUL_2026-10.md` ("the rain canyon"). Captures in `docs/neon-district-captures/` (street, ingame, events, dragon, portrait).
- **Icon.** A rainy cyberpunk street at night: a pink and cyan neon sign canyon, a wet road reflecting everything, a crosswalk, yellow centre lines.
- **Look.** A street canyon in the rain, looking up its centre line.
  - Shopfronts, tube-neon blades, interior-mapped lit windows, lanterns and cables, skybridges, gantries, megatowers in smog.
  - The whole city mirrored in the wet road, an endless scroll.
  - Since 2026-10-18: shops set back into the walls behind wet glass, each with a lit, interior-mapped room of its trade (noodle counter, laundromat drums, mart aisles, arcade cabinets, bar bottles, gym, service counter, calm room) and some shutters down and fly-posted. The district runs its own campaigns on every surface: eight local brands named for the board's verbs (Cascade Cola, Combo Noodles, Stack Savings, Drop Couriers, Level Gym, Next Taxi, Clear Optics, Spin Cycle), Hale's breathing adverts, and Serenity Transit travel posters for the game's other worlds, on LED screens with playlists, floodlit roof boards, paste-up poster walls, animated tube logos and blade words.
- **Palette.**
  - Hot pink, teal, ultraviolet and gold neon on dark wet asphalt.
  - Five level palettes: signal, harbour, arcade, lantern, ultraviolet.
  - Pieces (`neon-district-tetrominos.js:9-16`): I `#ff2ea6`, O `#7a5cff`, T `#20e0d0`, S `#ff6a1a`, Z `#3a86ff`, J `#ffd21a`, L `#c04bff`, GARBAGE `#444466`.
- **Motion.** The city scrolls, not the camera. Rain, steam, flying traffic, kerb-strip chases.
- **Gameplay FX** (doc).

  | Event | Response |
  | --- | --- |
  | Lock | A ring through the puddles in the piece's colour, a light shell climbing the walls and switching windows on, sparks, kerb comets. |
  | Clear | Row beams out of the card, then a wave rushing up the street that flares signs. |
  | Combo | The district charges: windows, level-meter trim, a gold warm-up. A hologram counts the chain ("×3"). |
  | Four lines | A blackout for 0.2 s, then a gold wave, sheet lightning and a drone-show dragon. |
  | T-spin | Signs glitch. |
- **Tech.** About 30 instanced draws, rendered twice for the planar mirror.
  - Facades are drawn in the fragment shader with interior mapping.
  - A distance-field glyph atlas for signs.
  - `ndWrapZ` scrolling, the Director/Composition/ComboTracker pattern, one-pass post.
- **Avoid reusing.** Cities, neon signage, rain, wet-road reflections, holographic text counters, drone-show creatures, a "power circuit" metaphor, interior-mapped windows, interior-mapped shopfronts, in-world ad campaigns for the game's own worlds and for brands named after the board's verbs.

<a id="synthwave-sunset"></a>

### 52. synthwave-sunset ("Synthwave Sunset")

- **Files.** Header at `synthwave-sunset-theme.js:1-3`: "an outrun sunset: the slit sun setting behind neon-wireframe mountains, a city skyline, palm silhouettes and an endless neon grid". Captures in `reports/synthwave-sunset-overhaul/`.
- **Icon.** A crimson grid floor, blocky red city silhouettes on both sides, a hazy sun glow, a maroon starry sky.
- **Shipped look.** A slit yellow-orange-magenta sun, black palm silhouettes, a city with amber windows and neon roof strips, a dense hot-pink grid to the horizon, a violet sky with stars.
- **Palette.**
  - Hot pink, orange-red and violet, with cyan and yellow accents.
  - Pieces (`synthwave-sunset-tetrominos.js:20-27`): I `#ff0066`, O `#ff4500`, T `#b000ff`, S `#ff006e`, Z `#ff5e78`, J `#00d4ff`, L `#ffff00`, GARBAGE `#0a0515`.
- **Gameplay FX** (`synthwave-sunset-world.js:437-501`).

  | Event | Response |
  | --- | --- |
  | Lock | Neon cells in the piece's shape light on the grid. |
  | Clear | A sonar ring races in from the horizon, horizon flash, city pulse, embers. |
  | Combo | Solar burst, shooting stars. |
- **Tech.** Node materials, a sky-dome function, a "pristine grid" floor, one merged palm mesh with cut leaflets, a merged skyline. Post: bloom, anamorphic streak, split-tone, grain.
- **Avoid reusing.** Outrun or 80s retro, slit suns, palm silhouettes, wireframe mountains, neon grids, anamorphic streaks.

<a id="chromadelic-highway"></a>

### 53. chromadelic-highway ("Chromadelic Highway")

- **Files.** Docs `docs/CHROMADELIC_HIGHWAY_VISUAL_OVERHAUL_2026-09.md`, the spectrum pass `docs/CHROMADELIC_HIGHWAY_SPECTRUM_2026-10.md` and `CHROMADELIC_HIGHWAY_ART_DIRECTION.md`. Captures in `reports/chromadelic-highway-overhaul/` and `reports/chromadelic-highway-spectrum/`.
- **Icon.** Concentric neon rings (yellow, green, orange, cyan) form a tunnel over a candy-striped pink, green and cyan road, with cartoon planets in a black starfield.
- **Look.** "The board is the sun." A stained-glass ROYGBIV highway runs into the vanishing point behind the card.
  - Neon ring arches of any colour, in eleven forms: tube, double line, spinning dashes, beads, hexagon and octagon gates, prism arcs (the whole spectrum foot to foot).
  - A rainbow-banded hero gas giant on the left; a ringed teal ice giant on the right.
  - The air takes the rings' colours: a coloured haze around each ring, a luminous horizon mist, ring-lit dust.
  - A nebula sky turned per movement, speed streaks, rail light curtains (pink and violet).
- **Palette.**
  - Sky `#080516` to `#160A2C`; the nebula turns per movement (rose for ember, teal-blue for tide).
  - Rings take any hue, in six 90 s movements: prism (a rainbow every seven rings), orchid, ember, triad, chord (complementary pairs), tide.
  - Pieces (`chromadelic-highway-tetrominos.js:19-26`): I `#ff1493`, O `#ff8c00`, T `#ffea00`, S `#00ff80`, Z `#00f5ff`, J `#4d90fe`, L `#bf40ff`, GARBAGE `#2a2a45`.
- **Motion.** One travel clock; rings take their style just before they clear the card edge, flare as they come out, keep it for their flight, and sweep outward; the spectrum drifts with the road (a movement every ~90 s at level 1) and steps one movement per level-up; streaks; a moon orbit; meteors.
- **Gameplay FX** (spectrum doc §4). Light waves run down the lanes toward the player.

  | Event | Response |
  | --- | --- |
  | Lock | A band in the newest ring's colour. |
  | Combo | A band climbing the wheel from that colour; the rings' light packets race; meteors and a comet. |
  | Clear | Bands, chase lights filling every arch from its feet to its crown (one front per line), star twinkle, storm flashes on the planet. |
  | Four lines | Bands, a prism cascade turning every arch into the spectrum, a streak warp, an FOV surge; the next three rings out are prism arcs. |
  | Level up | The spectrum steps to the next movement; a cascade in its first colour repaints every ring it passes, board to lens. |
- **Tech.** Ring style slots (J mod 16) locked by the CPU; polygon gates in the vertex stage; a ring-air draw; a hue-vector air colour; analytic planet impostors (one quad each), screen-space calm zone, Khronos Neutral "neon-neutral" tone map, max-channel bloom, a layout-aware composition solver, an adaptive scaler.
- **Avoid reusing.** Rainbow roads, neon ring tunnels and gate forms, prism arcs, chase lights climbing arches, speed streaks, cartoon planets, a travel-into-a-vanishing-point layout.

<a id="stillwater"></a>

### 54. stillwater ("Stillwater")

- **Files.** Doc `docs/STILLWATER_VISUAL_OVERHAUL_2026-10.md` ("the tarn at night"). Captures in `docs/stillwater-overhaul/` (rest, ingame, events, chain, hours, figures, portrait, tiers).
- **Icon.** A misty teal forest pond, a glowing pale spirit woman with gold hair standing on the water, coloured will-o'-wisps (violet, cyan, gold), lily pads, spruce silhouettes.
- **Look.** A John Bauer folklore forest tarn at night.
  - The near bank lies between two great spruces, with the moon in mist over the left bank.
  - Ranks of spruce fade into the mist; black mirror water holds everything.
  - A spirit on a stone on the left; a mossy troll with a lantern on a staff on the right.
- **Palette.**
  - Seven "hours" (`docs/stillwater-overhaul/hours.jpg`): blue hour (teal), moonrise (blue), midnight (violet, with stars and northern lights), elf dance (lilac mist), first light (rose), troll gold (ochre), moss night (green). One hour every 110 s, plus the level.
  - Pieces (`stillwater-tetrominos.js:18-25`): I `#F2D68A`, O `#6CC7C6`, T `#5F9B72`, S `#9A7FB7`, Z `#537E9F`, J `#D99A5E`, L `#C36F73`, GARBAGE `#273631`. Render mode `solid`.
- **Gameplay FX** (doc).

  | Event | Response |
  | --- | --- |
  | Lock | The piece's light falls into the tarn: a splash, a coloured ring, a lasting will-o'-wisp (up to 20). |
  | Clear | Swells gather the wisps home to the spirit or the lantern; spark drifts. |
  | Combo | The spirit walks out over the water and the troll comes down with his lantern; glowing caps, lilies open, fireflies, eyes in the wood, a gold heart on the lakebed. |
  | Four lines | A 0.3 s hush, then a gold net under the water and a colour ring across the picture. |
  | Perfect clear | The mist lifts and stars appear. |
- **Tech.** `swBackdrop(direction)` is one function drawn by both the sky and the water's mirror ray (no second render); `swLight` lights every surface. A seeded plan with sight-line windows, an animated troll sculpt.
- **Avoid reusing.** Forest lakes or tarns at night; mirror-still water; will-o'-wisps; folklore characters (spirit, troll); moonlit mist; spruce silhouettes; lily pads; fireflies; a seven-hour palette clock.

<a id="blood-moon"></a>

### 55. blood-moon ("Blood Moon")

- **Files.** Icon at `src/themes/blood-moon/blood-moon-theme-icon.png`. The scene is the playground effect `src/playground/effects/blood-moon.effect.js` (599 lines) plus `blood-moon-{surface,state,motion,bursts}.js`. The wrapper is `src/themes/blood-moon/blood-moon-theme.js` (415 lines).
- **Icon.** A cratered red moon with a concentric red glow on black, with red ember specks.
- **Look** (`blood-moon.effect.js:20-24`). "A blood-red eclipsed moon, wine-dark nebulae, crimson stars and floating lunar embers." The capture (`reports/blood-moon-overhaul/crimson-reference-combo/capture.png`) shows a big cratered crimson moon at the upper left, a halo of bright red particle ejecta, and a red wisp nebula on black.
- **Palette.**
  - Monochrome crimson on black.
  - Pieces (`blood-moon-tetrominos.js:19-26`): I `#cc1a2e`, O `#8b0000`, T `#dc143c`, S `#6b0f1a`, Z `#a01525`, J `#7a0f1a`, L `#b22222`, GARBAGE `#1a0510`.
- **Gameplay FX** (`blood-moon-state.js:218-290`). Lock, clear, combo, four-line and levelUp cues drive pulse, corona, stars, impact, wave and burst. The bursts (`blood-moon-bursts.js:2`) are three showers: a luminous lunar shell, fast ejecta, distant embers. Lunar pulse rings.
- **Tech.** A WebGPU TSL playground effect wrapped as the theme. A textured authored lunar surface, an instanced quad star, dust and ejecta field. Analytic halos instead of a full-screen bloom chain.
- **Avoid reusing.** Red moons, eclipses, crimson monochrome, cratered bodies, ejecta coronas.

<a id="astral-weave"></a>

### 56. astral-weave ("Astral Weave")

- **Files.** Doc `docs/ASTRAL_WEAVE_VISUAL_OVERHAUL_2026-10.md` ("the Loom of Heaven"). Captures in `docs/astral-weave-captures/` (idle, events, iris, portrait-events).
- **Icon.** A string-art circle: a four-cusp epicycloid of fine violet, blue, cyan and pink threads, a glowing centre, a starfield nebula.
- **Look.** A monumental hoop with tick marks hangs in a teal, violet and rose nebula river. String-art chords are strung across it (a nephroid at rest, with petals added per combo), with the card at its heart. Weft threads cross behind the board at stack rows.
- **Palette.**
  - Thread spectrum (`astral-weave-tsl.js:87-103`): cool mint, azure, violet and rose, warming through orchid to gold, amber and coral.
  - Pieces (`astral-weave-tetrominos.js:12-19`): I `#ffd86e`, O `#ee79ff`, T `#6cf9d5`, S `#ff7ccf`, Z `#6ca8ff`, J `#ffab63`, L `#7deeff`, GARBAGE `#3f3f72`.
- **Gameplay FX** (doc).

  | Event | Response |
  | --- | --- |
  | Lock | A shuttle crosses the hoop at the piece's rows, leaving a weft thread that rings like a plucked string. |
  | Clear | Rows burn, runners race to the hoop, fronts chase round it, a gas ring crosses the nebula. |
  | Combo | k+1 petals; colour warms pearl, then rose, then gold. |
  | Four lines | Gather into the crown peg, open a gold iris, bloom back. |
  | T-spin | The hoop spins. |
  | Level up | A resting petal is added. |
- **Tech.** Screen-space pixel-width ribbons (`awRibbonClip`, 0.85 px floor). Compute silk-dust (two storage buffers) on WebGPU. Closed-form events with `seek`. A baked half-float fBm texture.
- **Avoid reusing.** String art, epicycloids or nephroids, hoops or rings framing the board, sacred-geometry line work, nebula rivers, thread or loom metaphors.

<a id="stellar-velocity"></a>

### 57. stellar-velocity ("Stellar Velocity")

- **Files.** Doc `docs/STELLAR_VELOCITY_VISUAL_OVERHAUL_2026-10.md` ("the starbow run"). Captures in `docs/stellar-velocity-captures/` (rest, ingame, events, palettes, clock-drift, tiers, portrait, icon-sheet).
- **Icon.** Concentric neon rings (cyan, gold, pink, green, violet) around a white-hot core in a blue cloud nebula.
- **Look.** A ride down a canyon of luminous volumetric nebula toward one far white sun (left of the board). Hoops of plasma stand on the course; near stars smear into trails.
- **Palette.**
  - Six nebula palettes (`palettes.jpg`): aurora (green-teal), ion (teal-blue), azure (blue-violet), violet (magenta-purple), rose (pink), solar (amber). One every 85 s, plus the level.
  - Starbow: violet and blue at the sun, amber and red at the edge.
  - Pieces (`stellar-velocity-tetrominos.js:18-25`): I `#ff6fb1`, O `#7fe9ff`, T `#ffc94a`, S `#b48cff`, Z `#5dffa8`, J `#ff8a4a`, L `#5a9bff`, GARBAGE `#10141f`.
- **Gameplay FX** (doc).

  | Event | Response |
  | --- | --- |
  | Lock | A bolt flies from the card down the course and opens a crescent hoop of plasma in the piece's colour (12 held, laid on a golden-angle spiral). |
  | Clear | Row jets toward the sun; the drive fires through every hoop in turn; white fronts. |
  | Combo | Gears: the sky bunches toward the sun into a starbow, stars trail. |
  | Four lines | A hush, then a warp tunnel for 2.3 s. |
  | T-spin | The canyon rolls. |
- **Tech.** A volumetric cloud marched into a reduced-resolution target (baked 3D textures). Aberration and Doppler maths, motion-blurred instanced star quads. No compute or MRT.
- **Avoid reusing.** Nebula canyons, warp tunnels, starbows, hyperspace trails, plasma hoops, speed metaphors.

<a id="stellar-drift"></a>

### 58. stellar-drift ("Stellar Drift")

- **Files.** Docs `docs/STELLAR_DRIFT_VISUAL_OVERHAUL_2026-10.md` ("the ringed giant") and `STELLAR_DRIFT_DEPTH_OVERHAUL_2026-10.md`. Captures in `docs/stellar-drift-captures/`.
- **Icon.** A Saturn-like banded cream and rust gas giant with cream rings and a green-violet polar aurora, against a teal and violet nebula.
- **Look.**
  - A ringed giant fills the left: shearing weather bands, ovals, a hexagonal polar jet, ring shadows, night-side lightning, a polar aurora.
  - Two moons on the right (one icy and venting jets, one rust) in front of a teal and violet nebula.
  - The camera drifts in ring ice: lumps, shards, glinting motes.
- **Palette.**
  - Six palettes on a wheel (amber, rose, orchid, azure, jade, gold), one every 90 s.
  - Pieces (`stellar-drift-tetrominos.js:12-19`): I `#5ee7df`, O `#ffd662`, T `#8b5cf6`, S `#f472b6`, Z `#ff6b4a`, J `#2d4a8c`, L `#4a1a6b`, GARBAGE `#3a3a5a`.
- **Gameplay FX** (doc).

  | Event | Response |
  | --- | --- |
  | Lock | A coloured mote arcs from the card into the rings: a splash of ice, a ripple wound into a spiral by the rings' shear, a stain that lasts about 15 s. |
  | Clear | The rings chime; each row is written as a latitude streak round the globe; lightning, aurora flare, a meteor at three lines. |
  | Combo | The aurora rises; meteors fall. |
  | Four lines | A seven-meteor storm, an ice-moon fan. |
  | T-spin | A two-armed spiral in the rings. |
- **Tech.** World measured in giant radii, an analytic globe and rings, a bake step (`stellar-drift-bake.js`), a director and composition.
- **Avoid reusing.** Gas giants, planetary rings, moons, meteors, polar aurora on a planet, space ice debris.

<a id="vesper-chrysalis"></a>

### 59. vesper-chrysalis ("Vesper Chrysalis")

- **Files.** Doc `docs/VESPER_CHRYSALIS_VISUAL_OVERHAUL_2026-10.md` ("the hatching at dusk"). Captures in `docs/vesper-chrysalis-overhaul/` (rest, ingame, events, chain, wings, fall, hours, portrait, tiers).
- **Icon.** A glowing amber crystal chrysalis radiating gold rays, with huge pink and coral moth wings with cyan rims and eye-spots, a magenta sky, reflected in water.
- **Look.**
  - A mirror-still lake at dusk: an ember horizon on the right climbing through rose to a violet starry sky.
  - A ringed-world crescent on the left, the evening star, three misty ranges.
  - A cut-crystal chrysalis hangs over the water from dew-strung silk threads.
  - Pale cyan crystal stands at the edges; lantern lilies float on the water.
- **Palette.**
  - Violet, rose and magenta with amber and gold; cyan crystal and wing rims.
  - Six hours: rose dusk, ember hour, violet hour, blue hour, aurora night, first light. One every 2 minutes, plus the level.
  - Pieces (`vesper-chrysalis-tetrominos.js:12-19`): I `#9fe8ff`, O `#ffb347`, T `#e0629a`, S `#8a5cff`, Z `#ff7a1a`, J `#c8f4ff`, L `#ffd88a`, GARBAGE `#2a2140`.
- **Gameplay FX** (doc).

  | Event | Response |
  | --- | --- |
  | Lock | A moth in the piece's colour flutters from the card to a lily, which opens and holds the colour as a lantern; a ring on the lake; a bead runs down the silk. |
  | Clear | Blades of light out of the card break into scales; a swell sends the lily light home to the chrysalis. |
  | Combo | Wings are written outward vein by vein, eye-spots open at 4 and 6, the aurora rises. |
  | Four lines | A hush, then the wings beat, a prism ring crosses the sky, the aurora blazes. |
  | Chain break | The wings burn away and fall as scales. |
- **Tech.** `vcBackdrop(u, dir)` is one function for everything far (sky, stars, ringed world, aurora, ranges), used by the sky and the mirror. Analytic water mirror.
- **Avoid reusing.** Moths or butterflies, wings, chrysalis or cocoon, crystal shards in water, lotus or lantern lilies, aurora, dusk rose-violet lakes, prism rings across the sky, silk threads with dew.

<a id="parhelion"></a>

### 60. parhelion ("Parhelion")

- **Files.** Icon at `src/themes/parhelion/parhelion-theme-icon.png`. The scene is the playground effect `src/playground/effects/parhelion.effect.js` plus `parhelion-{composition,geometry,materials,optics,particles,post}.js`. The wrapper is `src/themes/parhelion/parhelion-theme.js` (754 lines). There is no overhaul doc.
- **Icon.** A dark faceted standing stone (the "Vigil Stone") hides the sun. A white 22° halo ring with a red inner edge, sundog flares, an upper tangent arc and a parhelic line sit in a cobalt sky over a pale golden snowfield.
- **Look** (`parhelion.effect.js:1-10`). A 22° ice-halo display: a dusky lens, red inner edge, sundogs, parhelic line, upper tangent arc, sun-pillar stub. It frames the Vigil Stone over a golden contre-jour snowfield under cobalt sky, with diamond dust, a glint pool and "hound pillars".
- **Palette.**
  - Clear colour `0x142C66` (cobalt).
  - Material hexes: `0x3A4A78`, `0x2A365C`, `0x171D2F`, creams `0xFFF6E6` and `0xFBF1E2`, golds `0xFFD98A` and `0xFFCF7A`, ember `0xFF6A4A`, ice blues `0x9CC7F0` and `0xDDE8F8`.
  - Pieces (`parhelion-tetrominos.js:26-33`): I `#FFD068` halo gold, O `#D0A6FF` lavender, T `#7EF0C2` glacier mint, S `#E46CB0` alpenglow rose, Z `#5C8AFF` zenith cobalt, J `#FF7E40` ember apricot, L `#A6E2FF` sundog ice, GARBAGE `#2C3352`. Render mode `solid`.
- **Gameplay FX** (`sim/parhelion-optics-state.js:953-1140`). Priority: PERFECT > APEX > TSPIN > QUAD > CLEAR > STONEFALL > LOCK.

  | Cue | Response |
  | --- | --- |
  | LOCK, "Halo Count" | The next of 12 ring stations lights. |
  | Hard drop, "Frostfall" | Frost falls in the lane. |
  | CLEAR, "One Hound Wakes / Both Hounds Rise / The Hounds Run" | The sundogs wake. |
  | QUAD, "The Halo Closes" | Beads meet at the apex. |
  | TSPIN, "Halo Turn" | A bead orbits the ring. |
  | APEX at combo ≥ 10, "Sun Cross" | Four pillars appear. |
  | PERFECT, "Clear Sky" | The sky clears. |
  | B2B ECHO, "The Hounds Answer" | A fainter repeat. |
  | Every 12 locks, "Full Circle" | A brightness wave runs once around the ring. |
  | Level up, "Lower Sun" | The light warms. |
- **Tech.** All `MeshBasicNodeMaterial`. `setLayout`'d TSL helper Fns (a shader-size test gate), value noise only (no `mx_*`). Diamond dust as one instanced Sprite. One clock in `ParhelionOpticsState`.
- **Avoid reusing.** Ice halos, sundogs or parhelia, optical arcs, snowfields, monoliths or standing stones, diamond dust, cobalt-and-gold daylight.

### Cross-cutting: what is already taken (across this set; survey 4)

**Settings already used.**
- Clouds seen from above (nimbus-veil, rainbow-terraces).
- Lava or volcano (cinder-drift, pyrestorm).
- Neon dusk or outrun (neon-dusk, synthwave-sunset).
- Rainy cyber-city (neon-district).
- Rainbow space highway (chromadelic).
- Night forest tarn (stillwater).
- Dusk crystal lake (vesper-chrysalis).
- Red moon (blood-moon).
- String-art nebula (astral-weave).
- Nebula warp (stellar-velocity).
- Ringed gas giant (stellar-drift).
- Snowfield ice-halo (parhelion).

**Overused motifs. Avoid these, or make them unmistakably different.**
- Mirror water or reflective floors: stillwater, vesper-chrysalis, neon-district, neon-dusk, synthwave-sunset.
- A big sun or light at the vanishing point, framed beside the board: nimbus-veil, neon-dusk, synthwave-sunset, stellar-velocity, chromadelic-highway, parhelion.
- Aurora: stillwater's midnight hour, vesper-chrysalis, stellar-drift.
- Ringed planets: chromadelic-highway, stellar-drift, vesper-chrysalis.
- Nebula skies: astral-weave, stellar-velocity, stellar-drift, chromadelic-highway, blood-moon.
- Rings or hoops: astral-weave, stellar-velocity, chromadelic-highway, parhelion.
- Golden motes or sparkles: nimbus-veil, rainbow-terraces.
- Shooting stars or meteors on combo: neon-dusk, synthwave-sunset, chromadelic-highway, stellar-drift.

**Gameplay FX patterns that are already house clichés.**
- **"A ring runs out through X in the piece's colour" on lock:** neon-dusk, neon-district, stillwater, vesper-chrysalis, cinder-drift, stellar-drift.
- **"The piece's light leaves the card edge and flies to a spot that keeps it" (a persistent mark):** stillwater wisps, vesper-chrysalis lilies, stellar-velocity hoops, stellar-drift stains, cinder-drift pools.
- **A clear as rows venting or beaming out of the card at their own heights, then a wave or swell or front:** cinder-drift, neon-district, stellar-velocity, vesper-chrysalis, stillwater, astral-weave.
- **Four lines as "hold its breath, about 0.25 s hush or blackout, then the curtain":** cinder-drift, neon-district, stillwater, vesper-chrysalis, stellar-velocity.
- **A combo that builds a persistent structure, then collapses on chain break:** vesper-chrysalis wings, astral-weave petals, stillwater figures approaching, neon-district charge, cinder-drift fissures.
- **Level up as a palette wheel, often with clock drift:**

  | Theme | Palettes | Clock drift |
  | --- | --- | --- |
  | cinder-drift | 5 | none |
  | neon-district | 5 | none |
  | stillwater | 7 | every 110 s |
  | stellar-velocity | 6 | every 85 s |
  | stellar-drift | 6 | every 90 s |
  | vesper-chrysalis | 6 | every 2 min |

  A new theme can keep this mechanism (it is good for variety), but the content should differ.

**Palettes already claimed.**
- Heat spectrum (cinder-drift; pyrestorm's fire, set against a violet-to-indigo night storm since its 2026-10-13 rebuild).
- Crimson monochrome (blood-moon).
- Magenta, cyan and plum neon (neon-dusk, synthwave-sunset, neon-district, chromadelic-highway).
- Peach and lavender pastel clouds (nimbus-veil).
- Cyan day to gold meadow (rainbow-terraces).
- Teal-blue moonlit folklore (stillwater).
- Rose, violet and amber dusk with cyan crystal (vesper-chrysalis).
- Teal, violet and rose nebula with pearl to gold (astral-weave, stellar-velocity, stellar-drift).
- Cobalt and gold snow (parhelion).

**Palettes not yet claimed within this set.** These are only gaps in this subset; the other parts of this catalog cover the remaining themes (aurora, bioluminescence, koi-pond, crystal-cave, geode, shifting-sands, grainfields, ocean and others), so cross-check before choosing.
- Saturated mineral or chemical colour fields: sulfur yellow with acid turquoise, travertine white and aqua.
- Emerald-dominant scenes.
- High-key white and turquoise daylight.
- Iridescent or structural colour, such as oil-slick or nacre interference.
- Desert-sky ochre with deep ultramarine.

**Technical house style for the masterpiece rebuilds.** cinder-drift, neon-district, stillwater, astral-weave, stellar-velocity, stellar-drift and vesper-chrysalis follow this pattern:
- A file split into `-core` (three-free maths), `-layout` or `-plan`, `-tsl` (uniforms, hashes, baked noise, a backdrop function), the parts, `-fx`, `-world` (shared with the playground effect), `-director` (renderer-free bus staging, a `ComboTracker` true combo; the bus `COMBO` is cascade depth per ADR-0011), `-composition` (DOM rects), `-post`, `-quality` (six tiers: Minimal, Low, Medium, High, Ultra, Extreme) and `-theme`.
- WebGPURenderer on both backends.
- Self-shaded `MeshBasicNodeMaterial`.
- Closed-form events with `seek(t)`.
- A max-channel soft-knee bloom with no MRT.
- One output pass.
- A doc at `docs/<NAME>_VISUAL_OVERHAUL_2026-10.md` plus `docs/<id>-captures/` (desktop-rest, ingame, events, portrait, tiers, palettes or hours).

The thin-wrapper alternative is blood-moon and parhelion: the theme class wraps `src/playground/effects/<id>.effect.js`.

Legacy outlier: none since pyrestorm's 2026-10-13 rebuild (it was the last classic WebGLRenderer + GLSL + EffectComposer theme here).

**Icon style.** Every icon is a 512² circular-cropped painterly or rendered vignette of the scene's single hero motif: a sun, a moon, a planet, a volcano, a chrysalis or a stone. Some icons are stale relative to the shipped scene: nimbus-veil's icon is a grey night cloudscape, while the shipped scene is a pastel sunset cloud sea.

## Part 5. Added after the surveys

<a id="rainbark"></a>

### 61. rainbark — "the painted giants" (concept and spec: `docs/theme-concepts/rainbark.md`)
- **Status (2026-10-12).** Added to this catalog after the surveys. Rainbark won the 2026-10-11 design
  competition and took Cosmic Chimes' slot in `585ab55`: registry position 21, group `biomes`, listed in
  `HEAVY_GPU_THEME_IDS`, Odyssey orb 47 renamed "The Painted Giants" (chapter 6, `transitionIn:
  'crossfade'`), song retitled "Rainbark" (the audio is still the Cosmic Chimes recording),
  `cosmic-chimes` aliased to `rainbark` in `RETIRED_THEME_IDS`. The piece palette and core constants
  are in `0c747dd`, the frame (adapter, director, composition, world with camera rig, sky placeholder,
  post, tiers, playground effect) in `585ab55`; the environment was built on branch `ccr-b2364ce7-64kjge`
  (merged `589ee199`) and every gameplay beat, the ambient life and the light wheel in the 2026-10-13
  overhaul. **This entry still describes the spec; the shipped look is recorded in
  [`docs/RAINBARK_VISUAL_OVERHAUL_2026-10.md`](../../RAINBARK_VISUAL_OVERHAUL_2026-10.md)**, which wins (the
  grove's trunks now stand in clumps, lean and vary in tone; the canopy glows green in two storeys; the
  light turns through four moods with the clock, gold among them; see its event table for the beats).
- **Icon (planned).** One painted bole: a face of rainbow bark, not a tree (spec §7.4). Circular 512²,
  copied to `public/assets/themes/rainbark-theme-icon.png`.
- **Setting / time.** Humid high-sun day in the middle storey of a forest of colossal rainbow eucalyptus
  (*Eucalyptus deglupta*, scaled ×2.3: trunks 160–185 m tall). The camera hangs 56 m above a floor it
  cannot see (L4 reference), looking level into blue air, pitched up 6° on 16:9 (9° portrait, 5° 21:9).
  - **Left:** the Elder, 5.2 m thick, 9 m away, cropped by the frame edge (right silhouette at x = 0.27
    on 16:9): a wall of painted bark, not a framing tree.
  - **Right, set deep:** Sister One (3.2 m thick, 24 m away, x ≈ 0.78–0.86) and Sister Two (2.4 m, 40 m,
    x ≈ 0.88–0.91, leaning toward her), one liana sagging between them. Between card and Sisters only
    luminous air, where the HUD sits.
  - **Behind the card:** ranks at 45, 70, 110 and 165 m receding diagonally from a dense left to a sparse
    right (an aisle of light behind the HUD), each paler and bluer; impostor ranks at 300 / 420 / 600 m
    painted in the backdrop.
  - **Below:** the trunks plunge into a luminous cream **mist floor** 10–30 m below, seen only between
    trunks, never as an open vista. **Above:** dark canopy lace with white-blue sky gaps.
  - No ground, no horizon, no path, no vista, no moon, no low golden sun, no fireflies.
  - **Light:** sun at elevation 50–64° (Bole zone 55°), azimuth −70° (upper right, out of frame); cool
    skylight fill; warm bounce up from the mist. Never golden hour: warmth lives only in highlights.
- **Palette.** Terpene Haze `#8FA6D8` (blue-violet air, the aerial-perspective target), Sunlit Vapour
  `#F6EBCB`, Understory Indigo `#1E2A44`, Fleck Gold `#FFE3A0`, Skylight `#CFE6F6`, Crown Green `#23452F`
  (backlit `#6E9A4A`), Cambium Cream `#EFE7C8`, Curl Underside `#DCE8B8`, Amber Resin `#E7A43A`, Husk
  Maroon `#5E2430`, Old Husk `#3E2A26`; clear colour `0x3a4a72`.
  - **Bark age ramp** (every piece colour is one age of the bark): 0.00 `#C2F23D` First Skin, 0.12
    `#2BCB72` Young Emerald, 0.26 `#1A93AC` Glaucous Teal, 0.38 `#2F4CC0` Cobalt Bark, 0.52 `#B98AF2`
    Bloom Violet, 0.66 `#D23468` Ruby Bark, 0.79 `#F07A2A` Ember Bark. The old end was moved by the CPU bark
    lab (rainbark.md §10) from maroon/brown husk to a **cool slate matrix**: 0.84 `#B04C2E` Rust, 0.885
    `#7A3A3C` Husk Maroon, 0.93 `#5E6573` Weathered Slate, 1.0 `#56616F` Old Slate (`RAMP_STOPS` in
    `src/themes/rainbark/rainbark-core.js`). Lightness is deliberately non-monotonic.
  - **Level variant, "the Climb":** five zones by level (Buttress Deep L1–2, Bole L3–5, Fog Line L6–8,
    Limb Storey L9–11, Crown Light L12), each with its own haze, sky, mist, fleck and grade hexes, plus a
    Mistfall look for game over. **Clock variant:** a 150 s mist tide (±8 m). **Session variant:** the
    grove's age drifts older (+0.05/min) and is reset young by four lines.
- **Pieces** (`rainbark-tetrominos.js`, `renderMode: 'solid'`, satin bark tiles, no glow): I `#C2F23D`,
  O `#F07A2A`, T `#2BCB72`, S `#B98AF2`, Z `#1A93AC`, J `#D23468`, L `#2F4CC0`, GARBAGE `#4A2A30`,
  CLEAN_GARBAGE `#D8D2BE`. Palette gate 0/7 (all seven roles deranged); worst colour-vision pair ΔE 19.4
  (tritanopia, O/J).
- **Key motifs.** Colossal rainbow-barked trunks; tall vertical ribbon patches of bark over a cool slate
  matrix (ribbon splats, not Voronoi cells), with lifted rims, hairline seams and striation; a satin
  sheen strip; elliptical pinhole sunflecks crawling over wet bark; blue aerial perspective that strips
  saturation rank by rank; a mist floor between trunks; shed bark curls tumbling into the abyss; canopy
  lace and gaps; a liana; lorikeets (Medium and up).
- **Motion.** Bark ripening (patch lifetime 240–600 s, one visible ambient wrap to First Skin every
  6–10 s); ambient curls 1–3/s in menus, ×0.35 while a session is live; sunfleck wind (periods 2.9–6.7 s)
  and gusts every 15–25 s; the mist tide; vapour threads off fleck-lit bark; drips that glint only inside
  flecks; liana sway 0.15 Hz; camera breath ±0.15 / ±0.10 m and mouse parallax ±0.25 m. After 60 s with
  no events the grove "dozes" (tide +5 m, shafts −30%).
- **Gameplay FX.** Grammar: peel, shed, moult, open, set, rain, unwind, drain, climb. Every effect is a
  material event on bark already in the picture, or a change in the grove's light and air.

  | Event | Response |
  | --- | --- |
  | Lock, "the Peel" | On the trunk lane nearest the piece (columns 0–4 the Elder, 5–9 Sister One), at the piece's own rows: a hairline split, the strip unzips downward and curls, revealing a wet band of the piece's colour (its bark age); the curl pops outward and falls back into depth. The last ~12 pieces stand as fresh bands in a dark peel lane and ripen away. |
  | Hard drop, "the Knock" | The strip tears off whole, a gloss pulse runs up the trunk, flakes and drops shake down. No camera motion. |
  | Clear ×1/2/3, "the Shed" | At each cleared row's height on both near trunks a girdle sheet peels off; the ring beneath blazes First Skin, then ripens into the cleared row's own ten cell colours, left to right. One ring per line; ×2 adds the R1 trunks, ×3 drops sheets in depth. |
  | Four lines, "the Great Moult" | A 0.3 s creak (old rims lift, no darkening), a moult front sweeps down every trunk in view, the grove stands naked in luminous lime, then colour climbs back in flame-shaped fingers over ~6 s. The grove is left visibly younger. Mean-luminance lift ≤ +0.25 stop. |
  | Combo, "Opening the canopy" + "Quickening" | Each link opens one canopy gap at a fixed station: a big pinhole sun-pool with a short shaft lands on the peel lanes (pools with beams = chain − 1). The near groups' bark clocks speed up as a secondary gauge. |
  | Combo release, "the Set" | Gaps close in reverse, a curtain of curls sized by the peak chain falls in the outer lanes, a vapour roll slides off the bark. Delivered on the breaking lock. |
  | Back-to-back, "the Sunshower" | Persistent while the chain lives: rain visible only in the light, the grove's bark goes wet and saturated (albedo ×(1 − 0.2·wet), chroma ×(1 + 0.3·wet)), heavier per B2B. |
  | T-spin, "the Unwinding" | A helical strip unwinds down the trunk like an apple peel (1/2/3 turns = lines), ripens to Young Emerald, and amber resin beads well up along the scar, which lasts the level. |
  | Perfect clear, "the Floor" | The mist drains and, for the first time, the forest floor shows: buttress roots, a braided stream, and a carpet of every curl shed this session. |
  | Level up, "the Climb" | 1.2 s after the clear, the camera rises one storey (12 m) over 3.5 s into the next zone; L13+ wraps through a mist veil. Reduced motion: a crossfade. |
  | Game over, "Mistfall" | The mist rises past the camera and the grove softens to blue silhouettes; "morning returns" on the next session. |

  No rainbow anywhere, nothing leaves the card as light, no held-then-released colour, no blades of light,
  no wave per line, no hush, no spiral round the card, no hour wheel.
- **Tech.** `WebGPURenderer` on both backends; self-shaded `MeshBasicNodeMaterial`, no lights, no compute.
  Every trunk is one `InstancedBufferGeometry` unit tube deformed along a spine in the vertex stage, in two
  draws: `near` (≤ 8 instances, event-aware) and `far` (no events). Bark is a fragment material in bark
  space: a 512² RGBA8 patch atlas read through a nearest-filtered ID view and a linear edge-distance view
  (analytic edge AA with `fwidth`, far ranks fade to the group mean by footprint), a 256×1 age ramp, rims,
  seams, striation and sheen. Closed-form air `rbAir` (height fog shared by every surface); sunflecks
  `rbFleck` from a projected canopy gobo with penumbra from the sun's 0.53° disc via CPU mips; the backdrop
  paints the impostor ranks, the mist top and the perfect-clear floor. All textures 2D (no
  `Data3DTexture`, no `lut3D`). One event table `u.events` (112 vec4 rows). One scene pass (MSAA 4× High+),
  BloomNode Medium+, one output pass with calm zones; six tiers.
- **Avoid reusing (now taken by Rainbark).** Colossal painted or rainbow-barked trunks; bark (or any skin)
  peeling, shedding or moulting as the event grammar; blue aerial-perspective haze over saturated
  material; a mist floor seen between trunks; pinhole sunfleck gobos crawling over a hero surface; canopy
  gaps or pools of light opening one per combo link; a vertical world with no ground or horizon; the
  camera climbing one storey per level; shed material curling and tumbling into an abyss; amber resin
  beads; a sunshower for back-to-back; the world's age as a record of time since the last four-line clear;
  a perfect clear that reveals a hidden floor carpeted with the session's debris.

### 62. painted-ages — "the rainbow badlands" (rebuild record: `docs/PAINTED_AGES_VISUAL_OVERHAUL_2026-10.md`)
- **Status (2026-10-12).** Added after the surveys as a Chapter 4 completion reward, then rebuilt from
  scratch the same day. This entry describes the rebuild.
- **Icon.** A low rainbow arc over the striped flatiron teeth, the pavilion on its striped knoll in the
  middle, the poplar river at the right; circular 512².
- **Setting / time.** Zhangye/Hornocal rainbow badlands seen from an overlook spur 172 m above a valley.
  Left third: the spur with a timber boardwalk (stairs, rails, lamps) winding out to a pavilion (red
  lacquered columns, double hip roof with upturned eaves, gold finial, four red lanterns) on a striped
  knoll. Right third: striped "dragon spine" ridges and a braided river with rows of golden poplars. At 3
  km a flatiron range (triangular faces cut into zigzag stripes by gullies) across the whole view; hazy
  ranges and snow peaks on the horizon. Cumulus banks stand on the horizon, a lighter deck overhead casts
  drifting shadows. Land baked offline (three nested heightfields, droplet erosion with bed hardness,
  scripts/painted-ages/bake-badlands.mjs). Chapter 4 completion reward.
  - Six hours on a wheel that turns with the clock (one hour per 100 s, rest 0.15) and steps forward on
    level-up: first light (sun low right, rose haze), morning (side light, blue sky), high day (sun
    behind the eye), afternoon (side light from the left), sunset (sun low left, orange haze), blue hour
    (sun below the horizon, stars, lanterns lit). Game over pulls the light toward the blue hour; morning
    returns on the next run.
- **Palette.** Strata column of mineral beds 0.4-5 m thick, weighted to the reds and oranges: oxblood
  #76221A, vermilion #AE3D27, brick #9C5236, orange #C8733A, ochre #C99A45, gold #DDB660, cream #ECDDBE,
  rose #C08277, sage #8E9E83, teal #6C8A87, slate #7E8895, lilac #8F7E98, plum #5C4258, umber #6A4231;
  alluvium sand on the flats; golden poplars; per-hour skies (rose first light, blue morning/day, amber
  afternoon, orange sunset, violet blue hour). Pieces unchanged from the first build: I #D8432C, O
  #4C74E9, T #0E726F, S #F0C02D, Z #B7AADE, J #D3739A, L #81CA8B.
- **Key motifs.** Rainbow-striped eroded badlands (bands cut by the land along a dip, V-ing through
  gullies); a Hornocal flatiron range; a pavilion with lanterns and a boardwalk on a ridge; golden poplar
  windbreaks along a braided river; cumulus banks with silver linings; snow peaks in alpenglow; the
  mineral record (cleared rows as the newest beds crowning the high ground).
- **Motion.** The light wheel (sun walks round the sky), cloud deck drift (constant wind) and its
  shadows, poplar sway, lens breath and pointer parallax, lanterns lighting as the sun goes down, the
  record settling one bed per cleared row.
- **Gameplay FX.** Lock: the bed where the piece lands (a land point beside the card by column/row)
  lights in the piece colour and the light races along it across every hill; pigment dust. Hard drop:
  wider faster ribbon, a ring along the ground from the landing point, sparks. Clear: a line of light per
  row (the row's dominant pigment) climbs the strata through the whole land; pigment rises; rows laid
  into the record. Chain: a shower walks in from the horizon (cover darkens, rain veils, wet saturated
  rock, rain at the eye); a break after 4+ arcs a low rainbow across the valley (double after 7). Four
  lines: a rainbow tide climbs every bed + a flash flood of the rows' pigments in pulses down the river.
  T-spin: a pigment dust devil (helix) on the valley floor. B2B: mica glints. Perfect: painted clouds,
  every bed lights, double bow. Level up: hour step + a pale marker bed of light + an ash bed in the
  record. Game over: dusk and lanterns.
- **Tech.** WebGPURenderer on both backends; self-lit MeshBasicNodeMaterials. Land: a fan mesh (bearings
  x log-distance, 8 m-42 km) from three baked PNG heightfields (near 1024^2/2.2 km, mid 1024^2/8.4 km,
  far 512^2/40 km; RG height, B sky visibility, A drainage), half-float field textures with Sobel slopes;
  strata column 8192x1 sRGB with CPU mips; flutes from an erosion filter (Clay John) near the eye;
  sun-visibility render targets per field marched across all fields, repainted only when the sun moves;
  exponential haze + valley mist integrated along the ray. Sky dome with deck + cirrus + stars; cumulus
  banks as billow-heap cards (log-sum-exp union of sphere impostors). Events in the land shader
  (ribbon/wave tables sized in pixels via fwidth, slope-gated) and one instanced closed-form mote mesh.
  Post: bloom with hue-preserving knee following exposure, sun shafts (High+), hue-preserving filmic,
  warm/cool grade, calm zones. Six tiers.
- **Avoid reusing (now taken by Painted Ages).** Rainbow-striped badlands / strata bands cut by an eroded
  surface; light racing along a rock bed; bands of light climbing strata per cleared line; a flatiron
  range of zigzag-striped triangular faces; a hilltop pavilion with red lanterns and a boardwalk of
  lamps; golden poplar rows along a braided river; a pigment-coloured flash flood in pulses; cleared rows
  laid down as the newest rock beds; a dust devil for T-spin; a rainbow after a chain's shower. Fleet
  clichés it shares (disclosed): low sun with shafts at the golden hours, an hour wheel on level-up (the
  owner's standing rule), a spiral (the dust devil) at T-spin.
