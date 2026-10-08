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
| Planet & moon maps — Saturn, Saturn ring, Moon, Mars, Jupiter, Neptune, Venus, Mercury, Uranus (`2k_*` under `public/textures/`) | **Solar System Scope** ("Textures by Solar System Scope") | CC BY 4.0 | https://www.solarsystemscope.com/textures/ | Stellar Drift, Chromadelic Highway, Lunara, Sunset, Wolfhour + playground |

> **Modifications (CC-BY requires stating changes):** these maps are used as planet/moon surface textures and are, in several themes, recolored, tinted, scaled, or sampled luminance-only for stylized rendering. This top-level list is authoritative; where a folder-level `ATTRIBUTION.md` differs, reconcile to this entry.

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
| `Fox.glb` (animated fox) | **PixelMannen** (model) · **@tomkranis** (rig) · **@AsoboStudio** / **@scurest** (glTF conversion) | CC-BY 4.0 | https://github.com/KhronosGroup/glTF-Sample-Models — original: https://opengameart.org/content/fox-and-shiba | Sakura Twilight theme |
| `landscape-glb.glb` (cherry-tree / landscape model) | **Leonardo Awen** (per embedded model metadata) | CC-BY *(assumed from the embedded attribution namespace — **confirm**)* | embedded author metadata; exact source URL to confirm | Koi Pond theme (`koi-pond-forest.js` imports it for a hero canopy that ships disabled). Sakura Twilight used its tree meshes until its 2026-10-05 rebuild and no longer loads it. |

> **Action — confirm before release:** `landscape-glb.glb` **still ships** — Sakura Twilight no longer uses it (its cherries are project-owned Blender originals since the 2026-10-05 rebuild, see `src/themes/sakura-twilight/assets/ATTRIBUTION.md`), but `src/themes/koi-pond/rendering/koi-pond-forest.js` still imports it, so the build still emits the file. Its embedded metadata credits **Leonardo Awen** and carries an attribution namespace, but the repo has no source URL or explicit license text. Confirm the exact source and license and finalize the row above. *(This supersedes the earlier "quarantine / do not ship" note, which was inaccurate — the model is not quarantined; it is shipping.)*

---

## 1b. MIT-licensed bundled assets

None at present.

The **SynthCity** city and vehicle textures by **Jeff Beene** (MIT License, source
https://github.com/jeffbeene/synthcity) were bundled under `public/textures/synthcity/` for the
first Neon District theme. That theme was rebuilt in October 2026 and no longer reads them, so the
set was removed from the distribution on 2026-10-05.

The rebuilt Neon District ships two atlases, `public/textures/neon-district/shopfronts.webp` and
`billboards.webp` (and their half-size copies), baked from the shopfront and billboard images the
project owner added in December 2025. The sources and the bake are in
`scripts/neon-district/` (see `source-art/README.md`).

---

## 1c. Apache-2.0 bundled utilities

**Draco** glTF geometry decoders under `public/assets/vendor/draco/` are from
**Google's Draco project**, bundled unchanged from the pinned Three.js 0.186.1
package (`examples/jsm/libs/draco/gltf/`). Koi Pond uses these decoders to load its
compressed authored tree meshes without an external decoder download. Source:
https://github.com/google/draco

The full Apache License 2.0 text, upstream README, and file hashes are included
beside the decoder files in `public/assets/vendor/draco/`.

---

## 2. CC0 / Public-Domain assets (attribution not required, credited as good practice)

- **Poly Haven** (CC0) — texture detail maps used luminance-only in several themes:
  Sky Children V2 (`leafy_grass`, `dirt`, `gray_rocks`, `cliff_side`, `rock_05`), Winter
  (`snow_01`, `snow_02`). Source: https://polyhaven.com
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
- Koi Pond and its tree audition in the playground: `summer_birch_lod.glb`,
  `summer_aspen_lod.glb`, `summer_spruce_lod.glb` under `src/themes/shared/assets/` (the
  low-detail versions of three trees first made for the Summer theme, which no longer
  uses them).
- Winter: `arctic-fox.glb`, `spruce.glb`/`pine.glb`/`fir.glb` (+ `*_lod.glb`).
- Ocean: `rare-shark-v2.glb`/`rare-shark.glb`, `rare-mantaray-self.glb`,
  `rare-whale-self.glb`, `reef-seahorse-triposr*.glb`, and the TripoSR coral library
  under `src/themes/ocean/assets/corals/triposr/`.
- Fall: every file under `src/themes/fall/assets/` (the maple, oak and birch trees,
  the shared leaf geometry and the distant-forest sprite sheet). These are authored
  procedurally in Blender by `scripts/blender/fall_grove_assets.py` with no generative
  model and no third-party source; see `src/themes/fall/assets/ATTRIBUTION.md`.
- Golden Forest: every file under `src/themes/golden-forest/assets/` (the spruce and pine
  trees, the shared needle geometry, the rowboat, jetty, boulders and dead pine, and the
  far-shore sprite sheet). These are authored procedurally in Blender by
  `scripts/blender/golden_forest_assets.py` with no generative model and no third-party
  source; see `src/themes/golden-forest/assets/ATTRIBUTION.md`.
- Summer: every file under `src/themes/summer/assets/` (the birch and spruce trees, the
  shared leaf and needle geometry, the cottage, boathouse, maypole, jetty, rowboat, fence
  and boulders, and the far-shore sprite sheet). These are authored procedurally in
  Blender by `scripts/blender/summer_meadow_assets.py` with no generative model and no
  third-party source; see `src/themes/summer/assets/ATTRIBUTION.md`. The wildflowers,
  grass, reeds and water lilies are generated at run time by the theme itself.
- Crystal Cave: `src/themes/crystal-cave/assets/cavern.glb` (the hall of rock with its
  baked light, the crystal layout, the glow-worm and drip points). Authored procedurally
  in Blender by `scripts/blender/crystal_cave_assets.py` with no generative model and no
  third-party source; see `src/themes/crystal-cave/assets/ATTRIBUTION.md`.

---

## 4. Music

All ~36 soundtrack tracks were **generated with Suno** (AI music generation) by the
project owner — self-generated from the owner's own prompts under a **paid Suno
subscription** whose terms grant commercial-use and ownership rights in the generated
output. The subscription and terms records, the per-track prompts, and the Suno output
references (e.g. `aether-tides.mp3` and `black-hole.mp3` retain `suno.com` output IDs in
their metadata) are retained by the project as the ownership/licensing record.

The tracks are the game's own soundtrack — generated from the owner's original prompts,
**not** taken from any third-party library or existing song. The **project owner has
listened through all tracks and confirms none reproduces** the *Korobeiniki* / "Tetris®
Type-A" melody (2026-07-15). Gameplay sound effects are procedurally synthesised (no
melody), so the melody-match concern is limited to — and cleared for — the music tracks.
*(Rigor note: this is the owner's listen-through, which is the practical check; an
independent musicologist review or automated melody fingerprinting remains optional extra
assurance. A paid Suno subscription grants usage/ownership rights but does not itself
warrant non-infringement.)*

> Note: the commercial-use/ownership rights come from the paid Suno subscription terms;
> keep those records with the project. Two loose ends remain good practice — give the
> MP3-embedded cover-art images a documented source, and (separately from the usage right)
> let counsel confirm the copyright-registrability position for AI-generated audio at
> release.

Tracks shipped in `public/assets/music/`:

Aurora · Bioluminescence · Blood Moon · Candlelit Monastery · Cherry Blossom Garden ·
Cinder Drift · Cosmic Chimes · Cosmic Noir · Crystal Cave · Echoes of the Soul ·
Electric Dreams · Ethereal Echoes · Falling Pieces · Floating Islands · Fluid Dreams ·
Galaxy · Geode Crystalline · Himalayan Peak · Ice Temple · Lunara · Meditation Temple ·
Misty Lake · Moonlit Forest · Moonlit Greenhouse · Neon District · Neon Dusk ·
Ocean Deep · Rainy Window · Shifting Sands · Starlight · Stellar Drift · Stillwater ·
Waves · Wolfhour · Black Hole · Aether Tides.

Sound effects are generated procedurally in code (`src/audio/sound-effects.js`); no
third-party audio samples are bundled. Fonts are self-hosted under the SIL Open Font
License 1.1 (licence text beside each font in `public/fonts/`): Unbounded (The Unbounded
Project Authors) and Manrope (The Manrope Project Authors) for the interface, plus
Orbitron and Space Mono for in-game text.

---

## 5. Legal / trademarks

Serenity Blocks is an independent game. It is **not affiliated with, endorsed by, or
sponsored by The Tetris Company, LLC or Tetris Holding, LLC.** TETRIS® is a registered
trademark of Tetris Holding, LLC. Any nominal references exist only to describe the
falling-block puzzle genre and imply no association.
