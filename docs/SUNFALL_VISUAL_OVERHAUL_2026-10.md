# Sunfall — a new theme in Moonrise Summit's place (2026-10-20)

`sunfall` replaces the legacy `moonrise-summit` theme (the old id is retired to it: saves, the
collection, Odyssey completions and the music key all resolve; `RETIRED_THEME_IDS`,
`RETIRED_TRACK_KEYS`, `tests/unit/sunfall-rename-migration.test.js`). Built from the concept in
[theme-concepts/sunfall.md](theme-concepts/sunfall.md) (§3 amendments govern where they differ from
§1).

Module map: `src/themes/sunfall/` (`sunfall-tetrominos.js` the seven-piece palette; `sunfall-quality.js`
six quality presets and URL/settings helpers; `sunfall-core.js` constants, solar stations, weathers,
`sunlitAt`, `dlBowCpu`, `solveBowSun`, `greeningTau`, `leafTintAtAge`, `packCodes`, `unpackCodes`,
`cellsFromMatrix`, `boardCellToDolineWorld`, `planDoline`; `sunfall-director.js` the state machine and
gameplay reaction envelopes; `sunfall-composition.js` the board calm lane and focal separation solver;
`sunfall-bake.js` CPU procedural textures for karst bedding, oculus fringe, cave clouds and tropical
foliage; `sunfall-tsl.js` the shared uniform bag, `sunlitAtNode`, `dlBowNode`, `boardCalmFactorNode`
and all ten Three.js r186 TSL material builders; `sunfall-world.js` the nine-part world; `sunfall-post.js`
the single-output HDR post stack with ACES grading and board calm vignette; `sunfall-theme.js` the
`BaseTheme` shell). Playground: `?effect=sunfall` (`src/playground/effects/sunfall.effect.js`).

## The subject

A giant karst collapse doline modelled after Hang Sơn Đoòng ("Watch Out for Dinosaurs", Doline 1).
A 200-metre-tall vertical column of white-gold daylight (*the sunfall*) pours through a ragged
limestone skylight (*the oculus*) at `(24, 56, -108)`, punches a crisp gold-rimmed hole through a
subterranean cave-cloud deck at `y = 22 m`, and lands on a conical jungle breakdown cone (*Watch Out
for Dinosaurs*) at `(15.5, -21, -93)` on the floor of the passage below.

The scene reads through four distinct light regimes in one frame:
1. **Direct overhead sun** (`#FFF2CC`, `4.2` HDR) inside the ragged oculus cylinder (`sunlitAt`).
2. **Forward-scattered gold** (`#FFD27A`) along the volumetric sunbeam pillar and the rim of the
   cave-cloud ring.
3. **Warm green-gold upward bounce** (`#2A4A28` → `#5E8A44`) off the sunlit jungle canopy onto the
   fluted dark limestone vault (`#0F171A` → `#2B3B38`).
4. **Teal sky light** (`#1E4450`) from a second distant doline (*Garden of Edam*) 220 m down the
   left-hand passage at `(-34, 8, -210)`.

In the dry foreground shelter (`z = -6..-26`), empty dry rimstone dams (*gours*) step down toward
the drop-off, colonised by mats of Peacock Spikemoss (*Selaginella willdenowii*) whose structural
thin-film interference shifts from deep emerald to electric peacock-blue (`#0E6A88` → `#18A8C8`) at
grazing angles. Hanging from the right-hand oculus lip (`x = +10..+36`), curtains of fig and liana
aerial roots carry young tropical leaves that flush in the seven piece colours and undergo real
**delayed greening**: as each leaf cluster ages, chlorophyll synthesis transitions its pigment from
its piece-coloured young flush to mature canopy emerald (`#2E6A34`).

## The picture

- **The eye** stands at `(0, 1.8, 0)` under the dry foreground overhang, looking toward `(2.2, 2.0, -78)`
  with a `52°` vertical field of view on landscape screens.
- **One shared sunlight mask (`sunlitAt` / `sunlitAtNode`)**: every surface and volumetric layer tests
  its world position against the same sun ray `sunDir` projected back to the oculus plane `y = 56 m`
  at `(24, 56, -108)` (radius `18.5 m`), modulated by the baked ragged fringe texture (`fringeTex`)
  and canopy cloud cover.
- **The nine world parts (`SUNFALL_PARTS`)**:
  - `sky`: overexposed white-gold sky disc seen up through the oculus and the distant second doline
    glow down the left passage.
  - `cave`: dark fluted karst vault with wet flowstone ribs, upward green-gold canopy bounce, and
    the ragged backlit oculus lip.
  - `jungle`: conical breakdown talus mound (*Watch Out for Dinosaurs*) crowned by layered tree ferns,
    banana-leaf fans and emergent canopy crowns lit directly by the oculus footprint.
  - `beam`: concentric open cylinders anchored at the oculus `(24, 56, -108)` and tilted along
    `sunDir`, shaded with Henyey-Greenstein forward scattering (`g = 0.76`), edge-fade fresnel,
    drifting karst dust and the analytic 42°/51° double rainbow (`dlBowNode`).
  - `mist`: subterranean cave-cloud ring at `y = 22 m` with a sunlit hole punched where the sunfall
    pillar pierces it, plus rising condensation wisps and waterfalls pouring from the right oculus lip.
  - `water`: subterranean emerald river (`y = -24 m`) Winding along the base of the breakdown cone
    with caustics and expanding line-clear ripple rings.
  - `roots`: hanging aerial root curtains and 28 instanced young-leaf clusters (`aClusterIndex`,
    `aLeafSeed`) driven by `uClusterSwatch` and `uClusterGreening` uniform arrays.
  - `birds`: GPU vertex-animated swiftlets orbiting the sunlit pillar in banked elliptical paths.
  - `gours`: dry stepped travertine rimstone terraces in the foreground with view-angle iridescent
    blue *Selaginella* spikemoss (`createSelaginellaMaterial`).
- **Board calm corridor (`sunfall-composition.js`)**: the left-center playfield lane
  (`x: 0.24..0.52, y: 0.12..0.88`, centered at `ndcX = -0.08`) is backed by the dark limestone vault
  and protected by `boardCalmFactorNode` (`0.15` inside the board, `1.0` in the right-hand doline
  stage), keeping the Sunfall Pillar (`ndcX ≈ +0.24`) at full volumetric strength without washing out
  the falling blocks.
- **The pieces (`sunfall-tetrominos.js`)**: named after tropical delayed-greening young-leaf pigments —
  I Peacock Spikemoss (`#19C4DC`), O Sunfall Gold (`#F2BE38`), T Orchid Bract (`#B95CE4`), S Emerging
  Frond (`#52CE6A`), Z Ironwood Flush (`#EA4E42`), J Doline Sky (`#3E7AF0`), L Travertine Amber
  (`#EA8830`). Passes `npm.cmd run check:palette` with `0/7` warnings.

## Gameplay: light, water, stone and delayed greening

| Event | What the world does |
|---|---|
| Piece lock | **Young-Leaf Flush** — assigns the piece's swatch to one of the 28 root-curtain leaf clusters (`uClusterSwatch[idx]`, `uClusterGreening[idx] = 0`) and sends a downward shimmer along its aerial root strand. Over ~45 seconds (`greeningTau`), the cluster matures from its piece pigment into deep canopy emerald. |
| Line clear (1–3) | **Canopy Gust & Lip Veil** — a warm updraft rustles the ferns and root curtains, brightens the waterfall veil (`uWaterfallBurst`) and sends an expanding ripple ring (`uClearRingT`, `uClearRingColor`) across the cave river and dry gours. |
| Four-line clear | **Oculus Cataract & Double Rainbow** — the lip waterfalls surge into a sunlit curtain of spray and `uRainbowGain` opens a real analytic 42° primary / 51° secondary double rainbow with Alexander's dark band across the sunfall mist (`dlBowNode`, anchored via `solveBowSun`). |
| Combo chain (2+) | **Sunbeam Split (Sevenfold)** — the main sunfall shaft splits into up to 7 distinct fingers via `uShaftSplit` and `uComboCount`; cave-cloud swirl accelerates and swiftlets tighten their orbit. |
| T-spin | **Cloud-Ring Eddy** — a pressure eddy twists the cave-cloud ring (`uCloudEddy`) around the beam hole. |
| Back-to-back | **Golden Rim Charge** — charges the scattering halo along the cave-cloud aperture (`uRimCharge`). |
| Perfect clear | **Zenith Sunfall** — clouds part completely and the beam widens to flood the entire breakdown cone (`uZenithPulse`). |
| Level up / clock | Steps smoothly through five solar stations (*Morning Shaft*, *High Sunfall*, *Golden Oblique*, *Cloud-Ring Dusk*, *Second Doline Dawn*) and four subterranean microclimates (*Clear Shaft*, *Cloud Ring*, *Lip Shower*, *Canopy Steam*). |
| Game over | Clouds close gently over the oculus, leaving the cave in calm emerald-and-teal twilight. |

## Verification

- **Playground** (`?effect=sunfall`): visually verified in Chrome with zero console or WebGPU validation
  errors across idle (`?effect=sunfall&t=40&level=1&hud=0`), four-line cataract + double rainbow
  (`?effect=sunfall&t=40&event=quad&eventAge=1.2&hud=0`), sevenfold combo split
  (`?effect=sunfall&t=40&combo=7&hud=0`), WebGL2 fallback (`?effect=sunfall&t=40&level=1&forceWebGL=1&hud=0`),
  and 512×512 icon capture (`?effect=sunfall&t=40&icon=1&hud=0` → `src/themes/sunfall/sunfall-theme-icon.png`
  and `public/assets/themes/sunfall-theme-icon.png`).
- **Automated suites**: 36 unit tests across 7 files (`tests/unit/sunfall-{core,director,composition,world,theme,shaders,rename-migration}.test.js`),
  `tests/unit/url-parameter-catalog.test.js`, `tests/unit/theme-collection.test.js`,
  `tests/unit/theme-reduced-motion-setting.test.js`, `npm.cmd run check:palette` (`0/7` warnings),
  `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run check:boundaries`,
  `node scripts/architecture-fitness-check.mjs`, `npm.cmd run check:ip-strings`, and `npm.cmd run build`.
