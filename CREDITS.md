# Credits & Attributions

This is the top-level, ship-with-the-game credits file for **Serenity Blocks**. It is the
single source of truth for third-party attribution that must reach end users. Detailed,
per-asset notes also live in the `ATTRIBUTION.md` file inside each asset folder; where a
folder file and this file disagree, treat this file as authoritative and reconcile.

Assets are grouped by license obligation:
- **CC-BY** assets **require** visible attribution — they are listed individually below.
- **CC0 / Public Domain** assets require no attribution and are credited as good practice.
- **Project-original** assets are owned by the project (no third-party attribution needed).

---

## 1. CC-BY assets — attribution required

### Textures

| Asset | Author | License | Source | Used in |
|-------|--------|---------|--------|---------|
| `2k_saturn.jpg`, `2k_moon.jpg`, `2k_mars.jpg` | **Solar System Scope** ("Textures by Solar System Scope") | CC BY 4.0 | https://www.solarsystemscope.com/textures/ | Stellar Drift theme (secondary planets) |

### 3D models

| Asset | Author | License | Source | Used in |
|-------|--------|---------|--------|---------|
| `rare-turtle-kenchoo.glb` (Sea Turtle) | **kenchoo**, based on original work by C.J. Goldman | CC BY 4.0 | https://sketchfab.com/3d-models/sea-turtle-lowpoly-animated-ea29d144296245c4bab3484575f2ffca | Ocean theme |
| `coral-reef-set3-minipoly-ccby.glb` (Coral Reef Set 3) | **MiniPoly** (via Poly Pizza) | CC BY 4.0 | https://poly.pizza/m/UyswwdHFiL | Ocean theme |
| `seaweed-laney-01-ccby.glb` (Seaweed) | **Laney XR Labs** (via Poly Pizza) | CC BY 4.0 | https://poly.pizza/m/461xlaa6SZW | Ocean theme |
| `seaweed-laney-02-ccby.glb` (Seaweed 2) | **Laney XR Labs** (via Poly Pizza) | CC BY 4.0 | https://poly.pizza/m/b_eanaL8C6j | Ocean theme |
| `seaweed-laney-03-ccby.glb` (Seaweed 3) | **Laney XR Labs** (via Poly Pizza) | CC BY 4.0 | https://poly.pizza/m/f_gXhnf06Oc | Ocean theme |
| `kelp-google-ccby.glb` (Kelp) | **Poly by Google** (via Poly Pizza) | CC BY 4.0 | https://poly.pizza/m/4cFllH6Iazk | Ocean theme |
| `kelp-christopher-ccby.glb` (Kelp) | **Christopher F** (via Poly Pizza) | CC BY 4.0 | https://poly.pizza/m/3VhttTFyADO | Ocean theme |

---

## 2. CC0 / Public-Domain assets (attribution not required, credited as good practice)

- **Poly Haven** (CC0) — texture/HDRI detail maps used luminance-only in several themes:
  Sky Children V2 (`leafy_grass`, `dirt`, `gray_rocks`, `cliff_side`, `rock_05`), Winter
  (`snow_01`, `snow_02`), Lunara (`qwantani_moonrise_puresky` HDRI, `moon_dusted_01`,
  `aerial_rocks_02`, `cliff_side`, `dry_riverbed_rock`). Source: https://polyhaven.com
- **Quaternius** (CC0, via Poly Pizza / Poly Pizza bundles) — Odyssey Chapter 3 stylized
  nature kit (trees, pines, twisted trees, bushes, ferns, clover, rocks, pebble, bird,
  pigeon), Ocean seagrass/rocks, and the Animated Fish Bundle
  (`rare-shark`/`whale`/`mantaray`/`dolphin`, `hero-fish-a/b/c`). Profile:
  https://poly.pizza/u/Quaternius
- **MiniPoly** (CC0) — `coral-reef-set-minipoly-cc0.glb`. Via Poly Pizza.
- **Kenney** (CC0) — `rock-2-kenney-cc0.glb`. Via Poly Pizza.

Full per-asset lists (with individual source URLs and download dates) are kept in the
folder-level `ATTRIBUTION.md` files under `public/textures/**`,
`src/rendering/odyssey/assets/**`, and `src/themes/**/assets/**`.

---

## 3. Project-original assets (owned; no third-party attribution required)

The following were produced in the project owner's local content pipeline (image →
3D → rig via TRELLIS.2-4B / TripoSR / UniRig + Blender). These are project-owned
originals (the generation tools TRELLIS.2 and TripoSR are MIT-licensed), not
third-party or CC assets:

- Odyssey Chapter 2 (Deep Ocean): `manta-glide.glb`.
- Odyssey Chapter 3 (Surface World): `goldfinch-flying.glb`, `swallow-flying.glb`.
- Himalayan Peak: `eagle.glb` (golden eagle).
- Stillwater: `troll.glb` (Nordic troll).
- Summer: `summer_spruce.glb`, `summer_birch.glb`, `summer_aspen.glb`.
- Winter: `arctic-fox.glb`, `spruce.glb`/`pine.glb`/`fir.glb` (+ `*_lod.glb`).
- Ocean: `rare-shark-v2.glb`/`rare-shark.glb`, `rare-mantaray-self.glb`,
  `rare-whale-self.glb`, `reef-seahorse-triposr*.glb`, and the TripoSR coral library
  under `src/themes/ocean/assets/corals/triposr/`.

---

## 4. Music

The soundtrack ships ~36 tracks in `public/assets/music/`. **Provenance and license for
each track must be recorded here before commercial release** (composer / source /
license, and whether original, commissioned, licensed-library, or AI-generated). This
scaffold is intentionally left for the project owner to complete — do not assume a track
is clear to ship until its row is filled in.

| Track | File | Composer / Source | License | Provenance |
|-------|------|-------------------|---------|------------|
| Aurora | `aurora.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Bioluminescence | `bioluminescence.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Blood Moon | `blood-moon.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Candlelit Monastery | `candlelit-monastery.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Cherry Blossom Garden | `cherry-blossom-garden.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Cinder Drift | `cinder-drift.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Cosmic Chimes | `cosmic-chimes.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Cosmic Noir | `cosmic-noir.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Crystal Cave | `crystal-cave.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Echoes of the Soul | `echoes-of-the-soul.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Electric Dreams | `electric-dreams.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Ethereal Echoes | `ethereal-echoes.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Falling Pieces | `falling-pieces.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Floating Islands | `floating-islands.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Fluid Dreams | `fluid-dreams.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Galaxy | `galaxy.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Geode Crystalline | `geode-crystalline.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Himalayan Peak | `himalayan-peak.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Ice Temple | `ice-temple.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Lunara | `lunara.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Meditation Temple | `meditation-temple.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Misty Lake | `misty-lake.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Moonlit Forest | `moonlit-forest.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Moonlit Greenhouse | `moonlit-greenhouse.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Neon District | `neon-district.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Neon Dusk | `neon-dusk.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Ocean Deep | `ocean-deep.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Rainy Window | `rainy-window.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Shifting Sands | `shifting-sands.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Starlight | `starlight.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Stellar Drift | `stellar-drift.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Stillwater | `stillwater.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Waves | `waves.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Wolfhour | `wolfhour.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Black Hole | `black-hole.mp3` | _TBD_ | _TBD_ | _TBD_ |
| Aether Tides | `aether-tides.mp3` | _TBD_ | _TBD_ | _TBD_ |

Sound effects are generated procedurally in code (`src/audio/sound-effects.js`); no
third-party audio samples are bundled. Fonts are Google Fonts (Orbitron, Space Mono)
under the SIL Open Font License, loaded at runtime.

---

## 5. Legal / trademarks

Serenity Blocks is an independent game. It is **not affiliated with, endorsed by, or
sponsored by The Tetris Company, LLC or Tetris Holding, LLC.** TETRIS® is a registered
trademark of Tetris Holding, LLC. Any nominal references exist only to describe the
falling-block puzzle genre and imply no association.
