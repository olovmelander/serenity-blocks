# Thermal Bloom — handover (2026-10-12, remade 2026-10-13)

Where the Thermal Bloom theme (built from the Iris Springs concept) stands, what is left, and how to
pick it up in a new session.

## The remake (2026-10-13): state and what is left

The owner asked for a remake into "a visual masterpiece with amazing lock piece and combo
effects" on current three r186.1 techniques. It was built in the worktree
`serenity-blocks-thermal`, from `main` at 589ee199, and verified on a real GPU (RTX 3070, WebGPU,
plus WebGL2 shots).

**What changed.** The design record has the details:
[THERMAL_BLOOM_VISUAL_OVERHAUL_2026-10.md](THERMAL_BLOOM_VISUAL_OVERHAUL_2026-10.md), "The remake"
and the event table.
- **New modules:**
  - `thermal-bloom-vapour.js`: the post-pass ray-marched steam bodies and the morning mist;
  - `thermal-bloom-bursts.js`: drops as motion streaks;
  - `thermal-bloom-snags.js`: the near snags, whose shadows are drawn in `thermal-bloom-basin.js`.
- **Rewritten:**
  - the lock springs (`tbBlooms` in `thermal-bloom-tsl.js`);
  - the ladder, its release, the steam sources and the season wheel (`thermal-bloom-world.js`);
  - the Stair's pools and record stains;
  - the gust;
  - the level-up and perfect-clear fronts;
  - the four-lines column's steam.

**Judged by independent critics from screenshots.** Each round compared against the favourites
(Golden Forest, Sakura Twilight); the briefs are `critic*.md` in the build's scratch:

| Round | Environment | Effects |
|---|---|---|
| 1 | 4/10 overall | |
| 2 | 5 | 3.5 |
| 3 | 5.5 | 4.5 |
| 4 | 5.5 | 5 |
| 5 | 5.5 | 5.5 |
| 6 | 5.5 | 5.5 |

After round 6, two last changes were made and checked in screenshots but not re-judged: the
springs' water now keeps the piece's full hue at a medium value (darkened, yellow had turned olive
and red brown), and the four-line column's water is brighter than its steam.

**What the critics credited along the way:**
- the clear cobalt Iris ("the best thing in the frame");
- the gust;
- the release as an exhale;
- the soft bow;
- the colour climb up the ladder;
- the perfect clear's renewal wave ("the strongest effect in the set");
- the level-up's gold front;
- the springs' lit water;
- no rendering artefacts and a clean console in any round.

**Real game:** both backends ran the events, the quality rebuild and the switch-away cleanly
(WebGPU at about 130 fps at rest and 119 fps at four lines, High, 1584×813, RTX 3070).

**Phone validator:** pass at Low and Minimal, and its pictures were looked at.

**Open, by priority:**
1. **Light: addressed by the light pass (2026-10-21)** without moving the sun: cloud shadows as the
   lighting design, more direct sun, floor relief and a far ground fog (see the design record, "The
   light pass"); the critic scored it above the original on light. The note below is kept for the
   history. Every critic named the light as the main gap:
   - flat, even morning light;
   - no single strong light source;
   - no haze layers.

   The favourites are back-lit or golden-hour. The design needs the sun behind the viewer for the
   theme's one rainbow, so a back-lit look means choosing between the bow and the light. Tried and
   rejected:
   - a lower sun (10–13°), which only muddied the mats;
   - a back light on the steam alone, which either flattened the plumes or could not be seen.
2. **The Stair's shape (a bake change).** It reads as a symmetric "wedding cake" of concentric
   lips with toothed edges. An asymmetric terrace field flowing diagonally, with thin scalloped
   rimstone, needs the generator (`thermal-bloom-bake.js`, `STAIR`).
3. **Effects still named:**
   - the four-line eruption in the top-right corner (the Chalice's anchor is boxed in by the HUD);
   - the ladder's rungs still stack close to one column on the Iris's side;
   - the T-spin devils read as a twist only up close;
   - the Sleeper's eruption reads as a cloud.
4. **Minor:**
   - the far snag thickets on Ultra;
   - on the phone, the Stair a sliver against the card, and the far flats as pale blotches;
   - at 4:3, the HUD over the Stair's left half;
   - Thaw's lime mats.
5. **The marched steam dithers in very large bodies.** In the perfect clear's swollen far plumes,
   the steps are spread over hundreds of metres.
6. **A perf reading on the dedicated GPU** (the perf lane), above all Ultra and Extreme with the
   march. The theme itself — the picture, the event language, the modules, the
tiers — is described in the design record,
[THERMAL_BLOOM_VISUAL_OVERHAUL_2026-10.md](THERMAL_BLOOM_VISUAL_OVERHAUL_2026-10.md); read it first,
then the concept [theme-concepts/iris-springs.md](theme-concepts/iris-springs.md) and the build
method [theme-concepts/PLAYBOOK.md](theme-concepts/PLAYBOOK.md). Appendix:
[capture sets and critic prompts](thermal-bloom-handover/CAPTURE_SETS.md).

## State at handover

- **Merged to `main`** with everything `main` had gained meanwhile (Painted Ages, Solar Eclipse,
  the Sky Children rebuild, Sunset's 24-hour day). The work was done on the branch
  `ccr-ad4f0320-10cxrb`; its last theme commit before the merge is `5c51839`.
- **What it is:** a new theme added beside the others (it replaces none): registry id
  `thermal-bloom`, display name Thermal Bloom, group `biomes`, heavy-GPU class, the **63rd** theme.
  It has no Odyssey orb: it is the collection reward for completing every orb of **Chapter 1**
  (orbs 1–5), with its song (a Blood Moon placeholder, like the other new themes'). Painted Ages is
  the other chapter reward (Chapter 4). 19 modules under `src/themes/thermal-bloom/` (about 10.5 k
  lines), three 0.186.1 `three/webgpu` + TSL, every material a `MeshBasicNodeMaterial`, the WebGL2
  backend as fallback, nothing loaded from disk (every texture is baked on the CPU).
- **Tests:** 9 files, `tests/unit/thermal-bloom-*.test.js` (core, world, ground, shaders, bake,
  collection, composition, director, theme adapter). `thermal-bloom-shaders.test.js` builds every
  material to WGSL on the CPU at Minimal and Ultra: no MaterialX noise, ≤ 12 uniform buffers a
  stage, ≤ 8 vertex buffers, every stage under 128 KiB (the largest, the basin's fragment, is
  ~64 KiB).
- **Gates on the merged tree:** see the merge commit's message for the run (lint ratchet, the
  full unit suite, typecheck, boundaries, lifecycle audit, IP strings, palette, build, pages
  artifact).
- **Phone validator** (`scripts/validate-mobile-webgl2.mjs`, software WebGL2, 390×844 at DPR 3):
  pass at Low and at Minimal on the pre-merge tree; its screenshots were looked at.

### Stage by stage

The PLAYBOOK's stages, each judged by an independent critic agent from screenshots on both
backends (the critic prompts are in the appendix).

| Stage | Status | Notes |
|---|---|---|
| 0a, 0b, A0 | Done | Core, palette, scaffold, registry and collection wiring, the CPU lab. |
| A1 sky + basin | **Passed** (critic round 5) | |
| A2 the Stair | **Passed** (critic round 3) | |
| A3 steam | Last verdict REVISE; reworked, **not re-judged** | Since the verdict: the Iris's dome is a 72 m heap narrowing as it rises (its crown above the horizon), tinted turquoise/apricot, thinned to a veil (with its shadow) on the upright phone's steep view; far columns' slices hug their stems and the stems are denser, so the columns rise from vents on the apron; the Minimal tier's Chalice thread restored. |
| A4 geyser + flora | Last verdict REVISE (the idle column); reworked, **not re-judged** | The idle eruption now has jittered edges, a crown flare, a lit/shade split and a spray veil. |
| A5 seasons + composition | Last verdict REVISE; reworked, **not re-judged** | Thaw without the yellow ring, crisp lobed snow drifts with a blue lip, First Frost aspens in frayed groves, a season-coloured meadow strip at the forest's foot, the upright phone's eye anchor at 0.9. |
| B1–B5 gameplay | First verdict REVISE (21 findings); **all reworked by two fix rounds, not re-judged** | See "Open items". The re-check capture was being taken when work stopped. |
| C1 post | Partly | False colour at rest: only small glints above the bloom knee (the Chalice cone's lit face was capped). |
| C2 tiers | Partly | The shader-size test; Minimal and Low rest frames looked at; the starred events not yet captured at Low/Minimal. |
| C3 layouts | Partly | 16:9, 21:9 (2560×1080), a short laptop (1366×640) and the upright phone looked at; 4:3 has an open issue (below). |
| C4 ship | Partly | Icon done; phone validator passes; the real game ran on both backends and switching away left no canvas — but **before** Stage B's rework, so it must be repeated. No `docs/thermal-bloom-captures/`, the record's Verification section is still a placeholder, and the final adversarial review (PLAYBOOK §3.6) has not been done. |

## Open items, by priority

1. **Re-judge Stage B** (blocking for "done"): capture the B set and run the B critic
   (appendix). Watch in particular:
   - lock blooms: with a history of locks they stack into a diagonal ladder of feather-like marks
     on the grey apron beside the card — they may still read as decals rather than runoff along
     the fingers (§3.7);
   - the Stair's Seal stripes show partly grey in the playground: the mock director only knows the
     colours of cells it saw lock (unknown cells are Bleached Sinter, as the spec says);
     `record=40` shows full colours;
   - the faint straight streak with sparkle dots across the frame through the lock point (B1
     shots, roughly (0,925)→(1919,360) at 1920×1080): traced to the basin (`parts=sky,basin`
     shows it, `parts=sky,geyser,steam` does not); its status after the ground fixes is unknown;
   - weak spots the fix rounds named: the four-line surge's steam skirt and overflow read faintly;
     the devils' helix looks stylised (chevron bands); the Consort's column is fairly translucent.
2. **Re-judge A3–A5** (environment critic, appendix). The dome is the riskiest: it now reads as a
   tall soft steam mass over the Iris, not yet as a crisp dome.
3. **4:3 composition**: at 4:3 the Iris's eye reaches under the card at rest
   (`thermal-bloom-core.js` `ANCHORS`, the 4:3 preset; the test "never puts the eye under the
   card" checks the anchor point, not the pool's edge). Fix the preset and extend the test to the
   eye's outline (the upright test already does this).
4. **Smaller ground issues** (from the ground fix round): on the upright phone all six Iris record
   zones collapse to one point (every upright row aims at the same spot); on Minimal (8 Stair
   tiers) a cascade can light the same tier twice. From the high phone camera the apron's dry
   sinter flats read as large pale blotches.
5. **Stage C to finish**: the real game on both backends and switch-away (PLAYBOOK §5.4–5.5) on
   the current tree; Low/Minimal captures of the starred events; small webp captures in
   `docs/thermal-bloom-captures/`; fill the record's Verification section; the final adversarial
   review (§3.6 checklist); the full gates (§6.2).

## Decisions already made (do not re-litigate)

- Name **Thermal Bloom** (the concept's Iris Springs renamed at Stage 0) and the unlock **Chapter 1
  completion bonus** — the owner's choices.
- The owner asked for current three r186.1 techniques and named Golden Forest and Sakura Twilight
  as favourites: the finish follows them (a filmic toe, base saturation 1.06, a light vignette,
  pulsed glints, drifting droplets and diamond dust, cirrus, aerial perspective on every far
  layer).
- Contrast: the concept's "p10 ≤ 25 L*" is not reachable with this palette; the working target is
  that steam lifts p10 by at most ~3 L* (last measured +2.8). Recorded in the record's deviations.
- Upright phone: the Chalice, the Stair and the Sleeper stand in the right margin, the Consort in
  the left, the eye just under the card.
- No AI-generated SFX (the wrapper is unavailable); the theme adds no sounds.

## How to continue

1. **Set up** (cloud container): `npm ci`; the capture scripts from PLAYBOOK §5.2–5.5 in your
   scratchpad (not the repo), and the phone validator's port shim from §5.8. Two additions this
   build used in `shot.mjs`: the server base from `SHOT_BASE` (default `http://127.0.0.1:5173`) and
   a `--shaders` flag that reports the WGSL modules' sizes.
2. **One long-lived dev server** on 5173 (`npx vite --port 5173 --strictPort`, started with
   `setsid` so it can be stopped as a group). Never run several Vite servers on one
   `node_modules/.vite`: their dependency hashes go stale and the real game fails to boot
   ("Outdated Optimize Dep" for `phaser.js`). The phone validator uses its own port and
   `VITE_CACHE_DIR` (§5.8).
3. **Iterate in the playground**: `playground.html?effect=thermal-bloom&t=40&board=1&…` (the
   parameters are documented at the top of `src/playground/effects/thermal-bloom.effect.js` and
   in the URL reference). `parts=` isolates parts, and `parts=steam/mist` or `steam/sheets` one
   sub-mesh of a grouped part. `falseColor=1` bands the pre-tone-map brightness (red is above the
   bloom knee).
4. **Judge by critic**: capture the appendix's sets, give a fresh agent the matching prompt, fix
   what it ranks blocking and major, recapture, repeat until it passes. Work several areas in
   parallel with fix agents only on disjoint file/function ownership (the ownership split used
   here is in the appendix); one agent commits.
5. **Finish Stage C** as listed above, then the full gates and the record's Verification.

## Where to tune

| Look | Where |
|---|---|
| The Iris's dome (shape, density, tint, steep-view veil, clear over the eye) | marched: the dome envelope and its thinning in `createVapourMarch` (`thermal-bloom-vapour.js`), its size and density in `vapourSources`; the sheet version (no march) in `thermal-bloom-steam.js` |
| Far columns (placement, widths, density) | `FAR_PLUMES` in `thermal-bloom-core.js`; stem density and foot billow in `thermal-bloom-steam.js` |
| Plume shadows | `tbPlumeShade` in `thermal-bloom-tsl.js` |
| Seasons (ramps, sky, haze, meadow, snow) | `SEASONS` in `thermal-bloom-core.js`; snow drifts in `thermal-bloom-basin.js`; rim forest, aspens and meadow in `thermal-bloom-sky.js` |
| Composition per aspect, anchors, HUD mirror | `ANCHORS` / presets in `thermal-bloom-core.js`, `composeWorld` |
| Eruptions, steam phases, Consort, Sleeper, jets | `ERUPTIONS`, `columnState` in `thermal-bloom-core.js`; `writeColumns`, `writeSteamOverrides` in `thermal-bloom-world.js`; `thermal-bloom-geyser.js` |
| Lock blooms, Seal, record, flood, season front | `aimRow`, `placeBloom`, `seal`, `writeRecordZones` in `thermal-bloom-world.js`; `tbBlooms`, `tbFills` in `thermal-bloom-tsl.js`; `thermal-bloom-basin.js`, `thermal-bloom-terraces.js` |
| Marched steam (bodies, density, self-shadow, underglow, bow, mist) | `vapourSources` / `writeVapour` in `thermal-bloom-world.js`; `createVapourMarch` in `thermal-bloom-vapour.js`; steps and scale per tier in `POST_LOOK.vapour` (`thermal-bloom-post.js`) |
| Lock springs (colour, rim, fingers, ripples, halo) | `tbBlooms` in `thermal-bloom-tsl.js`; placement in `placeBloom` and `spill`; at most `LOCK_SPRINGS` |
| The ladder and its release | `openVent`, `onCombo`, the ladder block of `vapourSources`, `writeBursts` (fountains), `heatColour` in `thermal-bloom-world.js` |
| Drops | `thermal-bloom-bursts.js` (`STREAK`, size, tint) |
| Near snags and their shadows | `NEAR_SNAGS` in `thermal-bloom-world.js`; `thermal-bloom-snags.js`; the snag loop in `thermal-bloom-basin.js` |
| Tiers | `QUALITY` in `thermal-bloom-quality.js` |
| Post (toe, saturation, bloom knee, vignette) | `thermal-bloom-post.js` |

## Lessons worth keeping

- **Slice sheets must follow the stem.** A plume drawn as camera-facing slices spread to its crown
  misses a narrow stem entirely (the Minimal thread vanished; far columns seemed to rise from the
  rim). Spread each sheet to the local radius, and scale the density by the narrowing.
- **Noise read in the ground plane smears into vertical streaks** on anything tall; use 3D noise
  for a volume's shape.
- **What the steep view sees through, it should not see the shadow of**: when the dome thins to a
  veil from above, its ground shadow must thin with it, or the shadow reads as a smudge.
- `pkill -f` patterns match the shell running them: use `[n]ode_modules/.bin/vite`-style patterns.
- A clean console is not proof: every change here was judged from screenshots, and the critics
  caught what the builders missed every round.

From the remake:
- **The marched steam is composited over the scene, so a dense body hides every mesh behind it.**
  The four-lines skirt swallowed the water column; the Sleeper's plume swallowed its jet. While
  water stands, keep the steam round it thin. For a body tens of metres across, even a density
  of 0.5 is several optical depths.
- **Event steam must be white, with its colour only at the foot.** Lit in the piece's colour all
  the way up, it read as candy floss. A warm sun clamped to a peak turns steam tan, so desaturate
  the sun on steam and water.
- **The ground's grazing sheen and sky mirror turn coloured water mauve.** Keep both off the
  springs' water, and pale the shallows toward a warm cream, never a cool white.
- **A plume standing on a pool covers it from this low view.** Use a narrow stem, lifted off the
  water.
- **A thresholded noise lookup at a small world scale shows the noise atlas's tile as a lattice.**
  Mix two lookups at unrelated scales.
- **A glow that follows the fingers reads as veins.** The cream front glow read as frost; warm
  gold reads as the year turning.
