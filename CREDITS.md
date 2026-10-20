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
| Planet & moon maps — Saturn, Saturn ring, Moon, Mars, Jupiter, Neptune, Venus, Mercury, Uranus (`2k_*` under `public/textures/`) | **Solar System Scope** ("Textures by Solar System Scope") | CC BY 4.0 | https://www.solarsystemscope.com/textures/ | Stellar Drift, Chromadelic Highway, Lunara, Wolfhour, Forest + playground |

> **Modifications (CC-BY requires stating changes):** these maps are used as planet/moon surface textures and are, in several themes, recolored, tinted, scaled, or sampled luminance-only for stylized rendering. This top-level list is authoritative; where a folder-level `ATTRIBUTION.md` differs, reconcile to this entry.

### 3D models

| Asset | Author | License | Source | Used in |
|-------|--------|---------|--------|---------|
| `Fox.glb` (animated fox) | **PixelMannen** (model) · **@tomkranis** (rig) · **@AsoboStudio** / **@scurest** (glTF conversion) | CC-BY 4.0 | https://github.com/KhronosGroup/glTF-Sample-Models — original: https://opengameart.org/content/fox-and-shiba | Sakura Twilight theme: kept as published, and as `sakura-fox.glb` **modified** by `scripts/sakura/rig-fox.mjs` (subdivided, in metres, smooth normals, re-boned at the original joints, clips removed, coat data in the vertex colours) |

> **Removed 2026-10-08:** `landscape-glb.glb` (a cherry-tree / landscape model whose embedded metadata credited **Leonardo Awen**; its source URL and license were never confirmed) no longer ships. Sakura Twilight stopped using it with its 2026-10-05 rebuild (its cherries are project-owned Blender originals, see `src/themes/sakura-twilight/assets/ATTRIBUTION.md`), and its last importer, the first Koi Pond theme's `koi-pond-forest.js`, was removed when Koi Pond was rebuilt in October 2026. The file was deleted from `src/themes/shared/assets/` together with the four low-detail tree models only that theme and its playground audition board loaded (`fir_lod.glb`, `summer_birch_lod.glb`, `summer_aspen_lod.glb`, `summer_spruce_lod.glb`). The rebuilt Koi Pond loads no models or textures: its pond, garden and fish are generated in code.

> **Removed 2026-10-11:** the first Ocean theme's models no longer ship. With its rebuild that month the whole
> `src/themes/ocean/assets/` folder was deleted: the CC BY 4.0 models credited above until then (`rare-turtle-kenchoo.glb`
> by kenchoo after C.J. Goldman, `coral-reef-set3-minipoly-ccby.glb` by MiniPoly, the three `seaweed-laney-*-ccby.glb`
> by Laney XR Labs, `kelp-google-ccby.glb` by Poly by Google, `kelp-christopher-ccby.glb` by Christopher F), the CC0
> Quaternius fish bundle and seagrass/rocks, MiniPoly's `coral-reef-set-minipoly-cc0.glb`, Kenney's
> `rock-2-kenney-cc0.glb`, and the project's own Blender and TripoSR reef, whale, manta, shark and seahorse models.
> None of them had another user. The rebuilt Ocean loads no models or textures: its reef, kelp, fish, whales,
> mantas, turtles and jellies are grown in code and its light pattern is painted on the GPU.

---

## 1b. MIT-licensed bundled assets

None at present.

The **SynthCity** city and vehicle textures by **Jeff Beene** (MIT License, source
https://github.com/jeffbeene/synthcity) were bundled under `public/textures/synthcity/` for the
first Neon District theme. That theme was rebuilt in October 2026 and no longer reads them, so the
set was removed from the distribution on 2026-10-05.

The rebuilt Neon District ships two atlases, `public/textures/neon-district/shopfronts.webp` and
`billboards.webp` (and their half-size copies), baked from the shopfront and billboard images the
project owner added in December 2025. Since 2026-10-18 the billboard atlas also holds the
district's own campaigns, drawn by the bake script itself: the brand, Hale and travel adverts are
vector shapes and type set in the game's own OFL fonts (section 4), and the travel adverts frame renders
of this game's own themes (from the captures under `docs/`). The sources and the bake are in
`scripts/neon-district/` (see `source-art/README.md`). Two of the December 2025 images are no
longer baked into either atlas (one shows another company's video-game characters, one a famous
film company's name and logo).

---

## 1c. Apache-2.0 bundled utilities

**Draco** glTF geometry decoders under `public/assets/vendor/draco/` are from
**Google's Draco project**, bundled unchanged from the pinned Three.js 0.186.1
package (`examples/jsm/libs/draco/gltf/`). The first Koi Pond theme used these decoders to
load its compressed tree meshes without an external decoder download; since that theme was
rebuilt in October 2026 no shipped code reads them, though the files are still distributed.
Source: https://github.com/google/draco

The full Apache License 2.0 text, upstream README, and file hashes are included
beside the decoder files in `public/assets/vendor/draco/`.

---

## 2. CC0 / Public-Domain assets (attribution not required, credited as good practice)

- **Quaternius** (CC0, via Poly Pizza / Poly Pizza bundles) — Odyssey Chapter 3 stylized
  nature kit (trees, pines, twisted trees, bushes, ferns, clover, rocks, pebble, bird,
  pigeon). Profile:
  https://poly.pizza/u/Quaternius

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
- Himalayan Peak: `eagle.glb` (golden eagle), authored procedurally in Blender by
  `scripts/blender/himalayan_eagle.py` (mesh, plumage, skin and rig; posed in code) with no
  generative model and no third-party source; see
  `src/themes/himalayan-peak/assets/ATTRIBUTION.md`.
- Stillwater: the troll (`troll.glb`, the author's character; shipped as `troll-lod0..3.glb`, drawn in its character from numbers in Blender): project-owned.
- Winter: `arctic-fox.glb` (rigged and painted in this repository by
  `scripts/winter/rig-fox.mjs`; its snow-loaded spruces are generated by
  `scripts/winter/bake-ghosts.mjs`, with no source model).
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
- Forest: every file under `src/themes/forest/assets/` (the spruce, pine and birch trees,
  the shared needle, leaf and fern-frond geometry, the fallen spruce, its stump, the
  boulders and dead snag, and the far-stand sprite sheet). These are authored procedurally
  in Blender by `scripts/blender/forest_assets.py` with no generative model and no
  third-party source; see `src/themes/forest/assets/ATTRIBUTION.md`.
- Crystal Cave: `src/themes/crystal-cave/assets/cavern.glb` (the hall of rock with its
  baked light, the crystal layout, the glow-worm and drip points). Authored procedurally
  in Blender by `scripts/blender/crystal_cave_assets.py` with no generative model and no
  third-party source; see `src/themes/crystal-cave/assets/ATTRIBUTION.md`.
- Verdant Hills: every file under `src/themes/verdant-hills/assets/` (the old oak and the
  field trees, the shared leaf sprays, the windmill and its sails, the drystone wall, gate,
  bench, outcrops, sheep and kite post, and the far-tree sprite sheet). These are authored
  procedurally in Blender by `scripts/blender/verdant_hills_assets.py` with no generative
  model and no third-party source; the land map and the cloud field beside them are baked
  from the theme's own code by `scripts/verdant-hills/bake-land.mjs`. See
  `src/themes/verdant-hills/assets/ATTRIBUTION.md`. The grass, flowers, kites and ribbons
  are generated at run time by the theme itself.

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
Cinder Drift · Cosmic Noir · Crystal Cave · Echoes of the Soul ·
Ethereal Echoes · Falling Pieces · Floating Islands · Fluid Dreams ·
Galaxy · Geode Crystalline · Grainfields (titled "Misty Lake" until October 2026) ·
Himalayan Peak · Ice Temple · Lunara · Meditation Temple ·
Moonlit Greenhouse · Murmuration (titled "Electric Dreams"
until October 2026) · Neon District · Neon Dusk ·
Ocean Deep · Rainbark (titled "Cosmic Chimes" until October 2026) ·
Shifting Sands · Spring (titled "Moonlit Forest" until October 2026) · Starlight ·
Stellar Drift · Stillwater · Sunbraid (titled "Rainy Window" until October 2026) ·
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
