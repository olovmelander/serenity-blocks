# Theme build playbook: from a concept file to a shipped theme

This file is the shared procedure for building any of the concepts in `docs/theme-concepts/` as
a real theme of Serenity Blocks. It is written for an engineer or an agent in a **new Claude Code
session**, on a fresh clone, who knows nothing of the session that wrote the concepts. Everything
that is the same for every concept lives here. Everything specific to one concept (picture,
palette, rendering spec, event language, acceptance shots, judges' notes) lives in that concept's
file:

| Concept file | Concept | Status |
|---|---|---|
| `docs/theme-concepts/rainbark.md` | Rainbark (the competition winner) | Merged with its environment built; gameplay effects still to build — see `docs/RAINBARK_HANDOVER_2026-10.md` |
| `docs/theme-concepts/iris-springs.md` | Iris Springs | Concept, not built |
| `docs/theme-concepts/painted-ages.md` | Painted Ages | Added as a Chapter 4 completion reward; [build record](../PAINTED_AGES_VISUAL_OVERHAUL_2026-10.md) |
| `docs/theme-concepts/riverbloom.md` | Riverbloom | Concept, not built |
| `docs/theme-concepts/haft-rang.md` | Haft Rang | Concept, not built |
| `docs/theme-concepts/sunfall.md` | Sunfall | Concept, not built |

**Where the facts come from.** The procedure is the one used to retire Cosmic Chimes and build
Rainbark in its place (commits `0c747dd` and `585ab55`), the Murmuration rename (`a74a86a`), and
the "masterpiece" rebuilds of Serenity Warp (`7d63e51`), Solar Eclipse (`36cdf48`), Sunset
(`38c31ab`) and Ocean (`94f4e23`). Line numbers are for `main` at `5d3478d` unless a line says
otherwise. Files move: confirm every line number with `grep -n` before you edit.

**Words.** The repository has an IP policy, enforced in shipped files by
`scripts/ip-string-gate.mjs`: never write the trademarked name of the original falling-block game,
or its official spelling of the piece name, anywhere (code, strings, comments, docs, commit
messages). Say "falling-block", "pieces", "four lines" or "quad". The code identifier
`getTetrominoConfig` and the file suffix `-tetrominos.js` are existing API and are fine.

**Placeholders used below.**

| Placeholder | Meaning | Rainbark example |
|---|---|---|
| `NEW_ID` | the new theme id, kebab case, must match `/^[a-z0-9][a-z0-9-]{0,79}$/`; also the folder name | `rainbark` |
| `NEW_NAME` | display name | `Rainbark` |
| `NewClass` | the adapter class, `<NewName>Theme` | `RainbarkTheme` |
| `NewWorld`, `NewPost`, `NewDirector` | the world, post and director classes | `RainbarkWorld`, `RainbarkPost`, `RainbarkDirector` |
| `newCamel` | the URL capture-flag prefix | `rainbark` (Serenity Warp's is `serenityWarp`, Solar Eclipse's `eclipse`) |
| `NEW_UPPER` | constant prefix | `RAINBARK` (`RAINBARK_TETROMINOS`, `RAINBARK_EVENT_HANDLERS`) |
| `NEW_KEY` | the song's track key, `NEW_NAME.replace(/\s+/g, '')` | `Rainbark` |
| `OLD_ID`, `OLD_NAME`, `OLD_KEY`, `OldClass`, `oldCamel` | the theme being replaced, its display name, its track key, its class and its capture-flag prefix (if it has one) | `cosmic-chimes`, `Cosmic Chimes`, `CosmicChimes`, `CosmicChimesTheme`, none (a DOM theme with no capture flags) |

**Contents**

0. [Orientation (read first)](#0-orientation-read-first)
1. [Choosing a slot](#1-choosing-a-slot)
2. [The module split and the contract](#2-the-module-split-and-the-contract)
3. [The staged build order](#3-the-staged-build-order)
4. [Rename and retire checklist](#4-rename-and-retire-checklist)
5. [Visual verification in a cloud container](#5-visual-verification-in-a-cloud-container)
6. [Gates and commands](#6-gates-and-commands)
7. [House rules, gotchas and the pitfalls we hit](#7-house-rules-gotchas-and-the-pitfalls-we-hit)
8. [A ready-to-paste prompt for the new session](#8-a-ready-to-paste-prompt-for-the-new-session)

---

## 0. Orientation (read first)

Read these before you change anything. They are short and they override habit:

1. `CLAUDE.md`. Two rules matter most here: **validate WebGPU/TSL work visually before calling
   it done** (playground first, a screenshot and a clean console), and **one small effect per
   session** (full-journey WebGPU captures have crashed the owner's dev machine's iGPU with a
   TDR). It also says AI SFX generation is unavailable: if the concept needs new audio, stop and
   ask the user.
2. `docs/ARCHITECTURE_INDEX.md` and `docs/adr/`. The ADRs that bind a theme:
   - ADR-0007 (`0007-webgpu-tsl-definition-of-done.md`): no WebGPU/TSL change is done without a
     screenshot and a clean console.
   - ADR-0011: the bus `COMBO` event carries **cascade depth**, not a combo.
   - ADR-0016: performance claims need a verified instrument (software rendering is not one).
   - ADR-0018: three.js is pinned (0.186.1, r186); check APIs against the installed package.
   - ADR-0019: gate on renderer kind (`renderer.isWebGPURenderer`, true on both backends), not on
     backend. The WebGL2 backend is a supported player surface.
   - ADR-0020: the theme manager's async pipeline session covers ordinary themes; a theme must
     **not** define `buildsPipelinesAsync`.
3. `docs/WEBGPU_THREEJS_WORKFLOW.md` and `src/playground/README.md` (the playground contract).
4. `.claude/skills/webgpu-threejs-tsl/SKILL.md`, especially its gotcha table. In these docs a
   gotcha written **`#NN` is the line number of that row in SKILL.md** (unchanged between
   `5d3478d` and `585ab55`). If the file has changed, find the row by its words.
5. The concept file. Each one opens with a "How to use this file" box and a precedence rule
   (usually: the amended section overrides the original proposal; the build plan already folds
   the amendments in). Follow it.
6. Two finished themes to read as code, not as prose: `src/themes/serenity-warp/` (the cleanest
   template) and `src/themes/rainbark/` (the newest, with the richest director). Their tests in
   `tests/unit/serenity-warp-*.test.js` and `tests/unit/rainbark-*.test.js` are the contract.
7. The folder index `docs/theme-concepts/README.md` (scores, the judges' findings across all six
   concepts, the fleet clichés and house FX grammar to avoid, all 33 researched candidates) and,
   when this file is too short on a point, the snapshots in `docs/theme-concepts/reference/`. They
   were taken at `5d3478d` (line numbers drift); where a snapshot and this file disagree, this file
   wins.

   | Snapshot | What it holds | Read it when |
   |---|---|---|
   | `reference/adapter.md` | The full lifecycle call graph (discovery, activation, hidden prewarm, `createScene`, frame, resize, settings, pause, GPU loss, dispose), every id-specific identifier, the cloning recipe and its pitfalls | Stage 0b; any lifecycle bug |
   | `reference/events.md` | The bus, canonical emitters, field semantics, the emission order within one lock, exact emit sites per mode, lifecycle signals, board-to-screen mapping, mode-specific gotchas | Writing the director and the event language |
   | `reference/rendering.md` | A rebuild's file layout, the world object, the post pipeline line by line, TSL idioms, quoted gotchas, performance practice, the playground effect contract | Writing any TSL |
   | `reference/ci.md` | The CI workflows, what each gate asks of a theme, the tests a theme swap touches, how sibling tests are structured, which validators run in a cloud container | Before the first commit |
   | `reference/rename.md` | The Cosmic Chimes rename surface (already executed in `585ab55`): every hit sorted into remove / change / keep, container and icon pipelines | Behind §4 |
   | `reference/catalog.md`, `reference/catalog.json` | Every theme's setting, palette, motifs, motion, gameplay FX, tech and "avoid reusing" list | Choosing a slot (§1); the similarity montage (§3.3) |
   | `reference/research.md` | The 33 researched candidates, the rejects and the top five | Looking for a different subject |

Then check where you are running:

```bash
cd <repo>            # /home/user/serenity-blocks in a cloud container
git status && git log --oneline -5
node --version       # 22.x was used; CI uses node 24
ls node_modules/.bin/vitest || npm ci --ignore-scripts   # --ignore-scripts: no Electron download
ls /opt/node22/lib/node_modules/playwright/index.mjs /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/playground.html   # 200 if a dev server is up
ls src/themes/rainbark/rainbark-theme.js src/themes/cosmic-chimes 2>&1   # which side of the Rainbark change you are on
```

If the Playwright paths exist and there is no GPU, you are in a cloud container: use §5 for every
screenshot. On a local machine with a GPU and the `chrome-devtools` MCP connected, use the
CLAUDE.md loop instead (§5.11).

**Is Rainbark on your branch?** Rainbark, the Cosmic Chimes retirement and this folder were built on
branch `ccr-b2364ce7-64kjge` (`0c747dd`, `585ab55` and later) and merged into `main` with the
handover `docs/RAINBARK_HANDOVER_2026-10.md`. A current checkout of `main` has `src/themes/rainbark/`
and no `src/themes/cosmic-chimes/`; the counts and line numbers this file gives "after `585ab55`" have
moved since (the handover §6.1 has the post-merge baselines). If `ls` above still shows
`src/themes/cosmic-chimes`, your checkout predates the merge: update it from `origin/main`.

---

## 1. Choosing a slot

Every concept was written as if it would take Cosmic Chimes' place. That slot is now Rainbark's
(`585ab55`), and Cosmic Chimes no longer exists. So before Stage 0 you must decide **where the new
theme goes**. There are two ways, and the first is strongly recommended.

### 1a. Replace an existing theme (recommended)

The game has **61 themes**: Forest (the starter) plus one theme for each of the **60 Odyssey
orbs**. Every theme has exactly one song. Replacing a theme keeps all of that intact: the new
theme takes the old one's registry position, its Odyssey orb, its chapter and its song, so no
count anywhere changes.

The repository has two precedents, and you must pick the right one:

| Precedent | When to use it | What happens to the id |
|---|---|---|
| **Rebuild in place** (Serenity Warp `7d63e51`, Solar Eclipse `36cdf48`, Sunset `38c31ab`, Ocean `94f4e23`) | The new work is a re-imagining of the **same subject** under the same name. | The id, name, song and orb stay. Only the folder's contents, tests, icon and shared tables change. |
| **New identity, old id retired** (Murmuration `a74a86a`; Rainbark `585ab55`) | The new theme is a different subject or carries a different name. **All six concepts are this case.** | The old id joins `RETIRED_THEME_IDS` (saves, collection entries and Odyssey completions that name it now mean the new theme); the song is retitled and the old track key joins `RETIRED_TRACK_KEYS`; the frozen V2 save table keeps the old id. |

Murmuration was the same theme renamed (`electric-dreams-v3` → `murmuration`, orb 54). Rainbark is
a different theme moving into another theme's orb (`cosmic-chimes` → `rainbark`, orb 47, renamed
"The Painted Giants"). §4 is the full checklist, generalised from the Rainbark commit.

**How to pick the theme to replace: ask the user.** It is a product decision. Do not guess. Prepare
the facts first, so the question is easy to answer:

```bash
node --input-type=module -e "
import { existsSync } from 'node:fs';
import { THEME_REGISTRY, getThemeMeta } from './src/themes/theme-registry.js';
import { THEME_MUSIC_CATALOG } from './src/core/progression/theme-music-catalog.js';
import { LEVEL_CONFIGS } from './src/core/odyssey/data/levels.js';
import { MOBILE_WEBGL2_NODE_IDS } from './scripts/lib/mobile-webgl2-validation.mjs';
const orb = new Map(LEVEL_CONFIGS.map((l) => [l.theme?.primary, l]));
const song = new Map(THEME_MUSIC_CATALOG.map((s) => [s.themeId, s]));
console.log('id | group | class | orb | song | world.js | effect | node-scene');
for (const t of THEME_REGISTRY) {
  const l = orb.get(t.id); const s = song.get(t.id);
  console.log([t.id, t.group, getThemeMeta(t.id).performanceClass,
    l ? 'orb ' + l.id + ' ch' + l.chapter + ' \"' + l.name + '\"' : 'starter',
    s.placeholder ? 'placeholder' : 'authored ' + s.file,
    existsSync('src/themes/' + t.id + '/' + t.id + '-world.js') ? 'world' : '-',
    existsSync('src/playground/effects/' + t.id + '.effect.js') ? 'effect' : '-',
    MOBILE_WEBGL2_NODE_IDS.includes(t.id) ? 'node' : '-'].join(' | '));
}"
```

This prints, for every theme: its registry group, its performance class, its orb (number,
chapter, orb name), whether its song is an authored recording or a placeholder copy, and whether it
already follows the modern pattern (`<id>-world.js`, a playground effect, a node scene in the phone
validator). Also look at `docs/theme-screenshots/<id>.png` (the last fleet capture of each theme)
and at whether a dated record `docs/*_VISUAL_OVERHAUL_2026-10.md` exists for it.

Criteria to put in front of the user:

1. **Never Forest.** It is the starter, owns the default song (`EchoesOfTheSoul`) and is the
   fallback theme everywhere.
2. **Prefer a theme that has not had a masterpiece rebuild**: a legacy DOM/CSS theme (Cosmic
   Chimes was one; Mountain is another, with no three import) or a classic `WebGLRenderer` theme
   (at `585ab55`: luminous-tides, misty-lake, moonrise-summit, pyrestorm, rainy-window and
   singing-bowl; re-list them with `grep -rlE "new (THREE\.)?WebGLRenderer\(" src/themes`).
   Rows without `world.js` and `effect` above are the candidates. Replacing a recent rebuild throws
   away finished work.
3. **Subject overlap.** If the new concept and an existing theme share a subject (two forests, two
   deserts), replacing that theme avoids a near-duplicate. Each concept file lists the existing
   themes it most resembles (its "compare against" list).
4. **Orb and chapter fit.** The orb keeps its chapter. Chapter 6 is "Space & Cosmic Expanse"; orb 47
   is a `release` beat, so Rainbark plays there as "a rare pocket of quiet" before the singularity.
   Read the orb's entry in `src/core/odyssey/data/levels.js` (role, difficulty, description) and
   the chapter's list in `src/core/odyssey/data/chapters.js`.
5. **The song.** An authored recording is retitled and keeps its audio (no music generation is
   available; tell the user the audio stays the old theme's recording). A placeholder is a byte
   copy of `blood-moon.mp3` and is only renamed.

A question that has worked:

> "The concept was written to replace Cosmic Chimes, which Rainbark has since replaced. Which
> theme should NEW_NAME replace? Candidates that have not been rebuilt and fit the subject:
> A (orb n, chapter c, song authored/placeholder), B (…), C (…). Replacing keeps every count and
> the Odyssey campaign unchanged; the old id will resolve to NEW_NAME for existing saves. The
> song keeps the old theme's audio under the new title. Or do you want it added as a 62nd theme,
> which needs a campaign change (see below)?"

### 1b. Add a brand-new theme (only if the user insists)

A 62nd theme breaks several pinned counts **and a design invariant**: every non-starter theme has
exactly one Odyssey orb and there are no bonus routes. A theme with no orb cannot be collected
(only `?unlockAll=1` would show it). So adding a theme needs one of these user decisions first:

- **A 61st orb**: a campaign redesign. `src/core/odyssey/data/levels.js` (a new level config and
  its `LEVEL_PHASE2_OVERRIDES`), `src/core/odyssey/data/chapters.js` (chapter ranges, today
  `[1,5], [6,10], [11,18], [19,26], [27,34], [35,48], [49,56], [57,60]`), the campaign order and
  V4 id tables (`src/core/odyssey/data/campaign-order.js`, `src/core/odyssey/odyssey-progress-schema.js`),
  save migration, and every test pinning 60 levels.
- **A bonus route**: `ODYSSEY_COLLECTION_REWARDS` in `src/themes/theme-collection.js` (empty today
  and pinned empty by tests), plus the collection service and its UI copy.

What pins the counts (update every one, or the suite fails):

| Test | Pins |
|---|---|
| `tests/unit/odyssey-unique-themes.test.js:15-34` | 60 levels; 60 distinct orb themes; `THEME_REGISTRY` length **61**; `['forest', ...orbThemes, ...bonusThemes]` equals the registry exactly; `ODYSSEY_COLLECTION_REWARDS` is `[]`; every orb theme has an icon and a presentation palette |
| `tests/unit/theme-music-catalog.test.js:23-33` | `THEME_MUSIC_CATALOG` length **61**, in registry order, 61 distinct theme ids, keys, files and paths; **31** authored and **30** placeholders |
| `tests/unit/theme-collection.test.js:90-110` | "grants all 61 themes over the real 60-orb campaign": 60 grants, one per orb |
| `tests/unit/development-collection-access.test.js:64,84,118` | `getOwnedThemeIds()` length 61; summary `owned: 61, total: 61` |
| `tests/unit/music-collection-ui.test.js:55-80` | 61 `data-track` rows, 60 locked, label `'1 / 61 collected'`, 61 artwork rows |
| `tests/unit/odyssey-campaign-config.test.js:23`, `odyssey-authored-speed-progression.test.js:134`, `odyssey-difficulty-balance.test.js` | 60 levels and per-orb roles (only if you add an orb) |
| `public/assets/music/songs.json` | regenerated by `node generate-songs.js`; `theme-music-catalog.test.js` asserts it equals `buildSongsManifest(files, [])` |

What must be added, beyond everything §2 lists for any theme:

- A registry entry in `RAW_THEME_REGISTRY` (`src/themes/theme-registry.js`) and, for a heavy
  WebGPU theme, the id in `HEAVY_GPU_THEME_IDS`.
- A song: either a recording (needs a user-supplied, licence-clear file; credit it in `CREDITS.md`)
  or a placeholder. A placeholder needs no catalogue entry (`AUTHORED_SONGS` lists only recordings),
  but the file `public/assets/music/NEW_ID-placeholder-song.mp3` must be a byte-identical copy of
  `blood-moon.mp3`, and the authored/placeholder counts change (31/31 for a new placeholder).
- An Odyssey route (the orb or the bonus rule above), a presentation colour in
  `src/core/odyssey/theme-presentation.js`, and Odyssey copy.
- The container (`index.html` static div plus a `public/styles/main.css` rule; §4 step 11-12).
- The phone validator lists, the URL catalogue rows, `ThemesTab` glyph, docs (as in §4).

Recommend 1a. If the user still wants 1b, write the decision and the campaign change into the
branch's record doc before Stage 0.

---

## 2. The module split and the contract

A modern theme is a folder of small modules with one shared world. The theme (game) and the
playground effect (captures) mount **the same world and post**, so what you iterate in the
playground is what ships. The adapter, director and composition are boilerplate you clone; the
world, its parts, the post's look, the tiers and the palette are the theme.

### 2.1 Files

`src/themes/NEW_ID/`:

| File | Role | Clone or write |
|---|---|---|
| `NEW_ID-theme.js` | `export default class NewClass extends BaseTheme`: renderer (WebGPU, WebGL2 fallback), GPU-loss recovery, post, bus wiring, layout reads, settings, capture flags, pause/resume, dispose | **Clone** `rainbark-theme.js` (or `serenity-warp-theme.js`) and rename identifiers only (§2.2) |
| `NEW_ID-director.js` | Renderer-, DOM- and bus-free event stager; `flush()` feeds the world's sink | **Clone** `rainbark-director.js` (the richest; see §2.3) |
| `NEW_ID-composition.js` | Layout reader (`readLayoutRects`, `fallbackLayout`, `boardFor`, `boardPoint`), `BOARD_GRID`, `PLAYER_SLOTS = 5` | **Clone** verbatim; rewrite the header (what is left, behind, right and above the card). Add `'#online-main-board canvas'` to the solo selectors if the clone lacks it |
| `NEW_ID-core.js` | **three-free** constants and CPU maths (palette, piece codes, `approach`, `smooth`, `mulberry32`, `cellsFromMatrix`, anchors). The director, layout, effect and tests import only this | Write |
| `NEW_ID-tsl.js` | Shared TSL: laid-out pure helpers, the one uniform bag `u`, texture wrappers, material helpers. `export * from './NEW_ID-core.js'` | Write (copy helpers from siblings) |
| `NEW_ID-bake.js` (optional) | three-free typed-array bakes (noise, atlases, masks), deterministic by seed | Write |
| `NEW_ID-<part>.js` | Scene parts (`sky`, terrain, hero, `fx`, `life`, …); each returns `{ mesh, material, geometry, …extra }` plus optional `dispose/reset/fire/render/resize` | Write |
| `NEW_ID-world.js` | `NewWorld`: owns `u`, the parts, the camera rig, choreography and event slots; exports `REST_RIG`, `fovForAspect`, `NEW_UPPER_PARTS` | Write (§2.4) |
| `NEW_ID-post.js` | `NewPost` (`RenderPipeline`), `POST_LOOK` per tier, `createPassThroughPipeline` | Clone the skeleton, write the look (§2.6) |
| `NEW_ID-quality.js` | `QUALITY` (six tiers), `QUALITY_NAMES`, `tierFor(q)` | Clone the shape, write the values (§2.7) |
| `NEW_ID-tetrominos.js` | Piece palette (§2.8) | Write |
| `NEW_ID-theme-icon.png` | 512×512 8-bit RGBA PNG (§2.9) | Capture |

Outside the folder: `src/playground/effects/NEW_ID.effect.js` (§2.10), the URL catalogue rows
(§2.11), tests (§2.13) and the registry and rename surface (§4).

Boundary rule (`.dependency-cruiser.cjs:41-66`, "themes-are-islands"): a theme must not import
**another theme**. Inside `src/themes/`, files under `src/themes/NEW_ID/` may import only their own
folder, `src/themes/shared/`, `base-theme.js`, `theme-registry.js` and `theme-manager.js` (general
modules such as `src/events/`, `src/utils/` and `src/core/combo-tracker.js` are fine, as the
siblings show). So copy a sibling's helper into your folder instead of importing it (for example
the Void Ember lattice noise). The known-violations baseline is empty; never add one. Nothing in `src/` may import `node:*`, `fs` or `path`. The main chunk must never reach the
theme statically: it loads only through the registry's `module` path (`check-boot-closure`).

### 2.2 The lifecycle you must not break

The three latest adapters (serenity-warp, solar-eclipse, sunset) are ~740 lines each and differ
only in the header comment, `LOG_PREFIX`, `CLEAR_COLOR`, whether the world gets `renderer`, and
the clock-carry policy. **Clone, rename, do not restructure.** The facts that matter:

- **Discovery.** `ThemeManager.initializeRegistry()` runs `import.meta.glob('./**/*-theme.js')`.
  The file must be `NEW_ID/NEW_ID-theme.js` and `export default` the class. The constructor takes
  no arguments and calls `super(THEME_ID)`; `THEME_ID` **must equal the registry id and the
  folder name** or the manager throws "Theme identity mismatch". Load timeouts: 10 s, or 20 s for
  `performanceClass: 'heavy'`. The instance LRU cache holds 2 (1 in safe mode).
- **Module top level must not touch the DOM or GPU.**
  `tests/unit/theme-registry-lifecycle-acceptance.test.js` imports every registry module in Node
  with stubbed `window`, `document` (all lookups null) and `navigator.gpu = null`.
- **`createScene(ownerGeneration)`** (serenity-warp-theme.js:195-286): find
  `#NEW_ID-theme`, dispose the previous runtime, read flags and quality, create the renderer
  (`new THREE.WebGPURenderer({ antialias: false, depth: false, alpha: false, forceWebGL,
  powerPreference: 'high-performance' })`, initialised through `this.initializeRendererCandidate`
  with a 5500 ms timeout; WebGPU only when `navigator.gpu` exists and no force flag is set; else the
  WebGL2 backend), `setClearColor(CLEAR_COLOR, 1)`, `toneMapping = NoToneMapping`,
  `outputColorSpace = SRGBColorSpace`, append the canvas, `setupGpuResilience()`, build scene,
  camera and `new NewWorld({ scene, quality, capture, renderer }).build()`, the post, the director
  and its sink, `resize`, `world.seek(time)`, a silent `levelUp` if the level is above 1, one
  `updateCamera` + `update` at dt 0, then `animate()`. **The whole world must be in `scene` when
  `createScene` resolves**: the hidden prewarm waits for `scene.children.length` to hold still
  (30 frames plus an async-pipeline quiet window of 12, or 45 + 30 frames on the legacy path).
- **The frame** (`stepFrame(now)`): wall delta from the theme's **own** `lastFrameMs` (the frame
  pacer skips vsyncs: 240 Hz at a 60 fps target renders every 4th frame), clamped to
  `MAX_DELTA_S = 0.05`; delta is 0 when `?newCamelTime` is set and the fixed step when
  `?newCamelFixedDt` is set; then pointer easing, a drawing-buffer size check (other code may
  resize the renderer), `processLayoutReads()`, then **`world.updateCamera(camera, sim)` →
  `director.flush()` → `world.update(sim, camera)`** (the camera first, because events aim
  through it), `easeCalmZones(wall)`, `post.update(world.getPostState())`,
  `post.update({ time })`, `post.render()`.
- **Resize** is deduplicated on `{w, h, pixelRatio}`; pixel ratio =
  `getEffectivePixelRatio(PIXEL_RATIO_CAP[quality])`. Subscribe to `EVENTS.VIEWPORT_RESIZED`,
  never to a window `resize` listener (the architecture ratchet counts them).
- **Settings.** `effectQuality` changes trigger `queueRebuild()` (one microtask; deferred to
  `resume()` while paused). `renderScale` triggers a resize in a microtask. Read settings in all
  three payload shapes (`readSettingUpdate`). `reducedMotion` = the setting **or**
  `matchMedia('(prefers-reduced-motion: reduce)')`. `backgroundComboEffects` enables reactions;
  `pieceLockRipple` enables lock reactions.
- **Pause/resume** reset `lastFrameMs = null`. `resume()` returns false (full restart) if world,
  renderer, scene or camera is missing; otherwise it re-reads the viewport and layout and runs a
  pending rebuild. Keep the frame-loop method named **`animate`** (`restartRenderLoop` looks for it).
- **A rebuild in place keeps the instance.** `createScene` can run many times per start (quality
  change, GPU-loss recovery), so `setupEvents` must unsubscribe before it subscribes again, as
  Serenity Warp's does; otherwise every rebuild doubles each bus handler.
- **GPU loss.** WebGPU device lost → one recovery: `forceWebGL = true` and `createScene()` again
  on the WebGL2 backend; a second loss exits to the menu. The surface label must equal `this.name`.
  In `disposeRuntime()`, call **`removeRendererResilience()` before `disposeRenderer()`**, or the
  destroyed device reports as a loss.
- **Switching away is terminal**: `cleanup()` = `stop()` + `super.cleanup()`; the instance is
  never restarted. `stop()` = `super.stop()`, `disposeRuntime()`, `this.time = 0`.
- **Clock policy.** Serenity Warp and Rainbark keep `this.time` and the level across a rebuild in
  place (cleared only by `stop()`); Solar Eclipse and Sunset use `this.carry = { time, level }`.
  Either is tested; the first is simpler.
- **Hooks other code calls**: `getTetrominoConfig()`, `whenCriticalReady()` (`!!(world &&
  renderer && scene && camera)`), `getWarmupRoots()` → `[]`, `usesMrtScenePass()` → `false`,
  `getDiagnostics()` (lifecycle, backend, quality, pixelRatio, `world.getState()`, reducedMotion,
  droppedEvents). **`buildsPipelinesAsync` must be absent.**
- **Capture flags** (string literals in the source; two tests grep for them):
  `newCamelForceWebGL`, `newCamelTime`, `newCamelFixedDt`, `newCamelParts`, `newCamelFalseColor`,
  plus the generic `forceWebGL`.
- **The phone validator reads** `theme.renderer`, `theme.scene`, `theme.isActive`, a quality field
  (`quality` works) and `resize(w, h)`.

Rename table for the clone (from serenity-warp-theme.js; the same names exist in rainbark-theme.js):
header comment; `THEME_ID`; `LOG_PREFIX` (`'[NEW_NAME]'`); `CLEAR_COLOR` (the darkest sky colour,
also the container's CSS background; Rainbark `0x3a4a72`); every `serenityWarp*` flag literal; the
imports of `*_TETROMINOS`, `*World`, `*Post`, `*_EVENT_HANDLERS`, `*Director`; the class name; the
renderer-init label and the two error strings ("… could not initialize WebGPU or WebGL2.", "…
WebGPU recovery already attempted."). The theme writes no window globals, no `localStorage` and no
console helpers.

### 2.3 The director and the sink

The bus delivers gameplay synchronously inside the simulation tick, several events per lock.
The director **stages numbers** into five preallocated player slots (0 = solo or online, 1-4 =
local multiplayer) and `flush()`, called once per frame between `updateCamera` and `update`,
resolves each slot into at most one lock and one clear for the world.

Subscribe to exactly these eight keys, each gated by `this.isActive && !this.isPaused`:

```js
{ PIECE_LOCK: 'onPieceLock', HARD_DROP: 'onHardDrop', LINE_CLEAR: 'onLineClear', COMBO: 'onCombo',
  TSPIN: 'onTSpin', B2B: 'onB2B', PERFECT_CLEAR: 'onPerfectClear', LEVEL_UP: 'onLevelUp' }
```

There is **no bus event** for hold, game over, top-out, garbage, soft drop, move or rotate.
Referencing a key that does not exist (`EVENTS.GAME_OVER`, `EVENTS.HOLD`) fails
`tests/unit/event-contract.test.js`. Game over is the window `CustomEvent('gameOver')` (single
player and Infinity only); a run's end is the mode manager's `modeStopped`.

Payload facts (canonical emitters in `src/events/gameplay-events.js`):

| Event | What to read | Traps |
|---|---|---|
| `HARD_DROP {piece, startY, endY, distance}` | same capture as a lock, plus `hardDrop` and `distance` | Fires **before** the PIECE_LOCK of the same piece. `piece` is the **live pooled** object, nulled right after: read it synchronously, never keep it |
| `PIECE_LOCK {piece, viewportOrigin?}` | `piece.color` (the theme's own colour), `type`/`shapeKey`, `shape` (rotated 0/1 matrix, padded: I 4×4, O 2×2, others 3×3; use the occupied cells' centroid), `x`, `y` (absolute rows including **4 hidden rows**) | Visible row = board row − 4, clamp 0..19. Infinity: use `viewportOrigin` (0..1, top-left) |
| `LINE_CLEAR {lineCount, clearedRows[], cascadeCount, comboCount?, viewportOrigin?, position?}` | lines 1..4, rows (`clearedRows[i] − 4`), cascade wave index | One event per cascade wave. Local MP sends no `cascadeCount`. Odyssey's synthetic clears (victory lap, goal flourish) have empty rows: fall back to the bottom rows |
| `COMBO {comboCount}` | **cascade depth ≥ 2**, emitted before that wave's LINE_CLEAR (ADR-0011) | Not a combo. Derive the true combo with `ComboTracker` (`src/core/combo-tracker.js`) per slot. Meditation clicks carry `position` |
| `TSPIN {lineCount}` | only on wave 1 and only with ≥ 1 line | Fires after the wave's LINE_CLEAR |
| `B2B {active}` | a difficult clear while a back-to-back run is live | Never `active: false`; the game never says when the run ends |
| `PERFECT_CLEAR {depth, perfectClearBonus}` | standalone, a **later frame** than the clears, no rows | Design it as its own moment |
| `LEVEL_UP {level}` | every 15 lines; fires before the wave's LINE_CLEAR | **Infinity never levels up**: anything level-driven must also progress by clock |

The order within one hard-dropped lock (pinned by `tests/unit/physics-callback-schedule.test.js`):

```
tick N, one synchronous stack:  HARD_DROP → PIECE_LOCK → [LEVEL_UP] → LINE_CLEAR (cascadeCount 1) → [TSPIN] → [B2B]
each later wave k ≥ 2:          COMBO {comboCount: k} → [LEVEL_UP] → LINE_CLEAR (cascadeCount k) → [B2B]
after the last wave settles:    [PERFECT_CLEAR]
```

A soft-drop or gravity lock emits no HARD_DROP. A lock that clears nothing emits only PIECE_LOCK
(there is no "no clear" event, which is why a combo break is only known at the next lock). Per
mode (exact emit sites in `docs/theme-concepts/reference/events.md` §5):

| Mode | What reaches the bus |
|---|---|
| single player | everything above; no `player` field |
| local multiplayer | LINE_CLEAR (no `cascadeCount`), HARD_DROP, COMBO, PIECE_LOCK, each with `player` 1-4; **no** TSPIN, B2B, LEVEL_UP or PERFECT_CLEAR |
| online | the local player only: LINE_CLEAR, COMBO, PIECE_LOCK, HARD_DROP, PERFECT_CLEAR (`source: 'online'`); no `player`, no TSPIN, B2B or LEVEL_UP |
| Infinity | `viewportOrigin` on LINE_CLEAR and PIECE_LOCK; `source: 'infinity'` on TSPIN, B2B, HARD_DROP and PERFECT_CLEAR; **no LEVEL_UP** |
| Odyssey | every event with `source: 'odyssey', levelId`, plus synthetic victory-lap and goal-flourish clears with empty rows; the theme runs behind Odyssey play at its orb |
| meditation (`serenity`) | clicks and taps only: LINE_CLEAR `{lineCount: min(floor((clicks + 1)/2), 4), comboCount: clicks − 1, source: 'serenity-interaction', position: {x, y}}` (CSS px), then COMBO with the same source and position when `comboCount ≥ 2`; no locks, no board on screen |

Sink contract (Serenity Warp's, which every sibling shares):

```
sink.lock({ player, rows, u, hardDrop, color, shape, cells, screen })
sink.clear({ player, rows, lines, combo, cascade, tspin, perfect, b2b, screen })
sink.combo(n, player)     // true combo; 0 = the chain broke
sink.levelUp(level)
```

`rows` are visible rows (0 top, 19 floor); `u` is the column fraction 0..1; `cells` are eight
numbers (x, y offsets of the four cells from their centre, y up) in the orientation the piece
locked in; `screen` is set (window fractions) only for meditation clicks. **The lock and clear
objects are reused: the sink copies what it keeps.** A clear reaches the sink **before** the combo
it raised, so read the chain from `clear.combo`. `configure({ enabled: false })` drops everything
and reports `combo(0)`; `lockRipple: false` drops staged locks only.

**Rainbark's director adds** (clone it if the concept uses any of these; the concept files that
mention `rowCodes`, "the shadow well" or "break inference" mean this file):

- `sink.lock({ …, distance })`: rows a hard drop fell.
- `sink.clear({ …, rowCodes })`: each cleared row's ten cells as piece codes (`PIECE_CODE`: I 0,
  T 1, Z 2, L 3, S 4, J 5, O 6, 7 = garbage or unknown), from a per-slot **shadow well** of the
  latest 64 absolute rows built from PIECE_LOCK snapshots; rows it never saw are dealt from the
  last eight lock codes.
- **Combo break on the breaking lock**: a lock that reaches `flush()` with no clear broke the
  chain, so `combo(0)` goes out on that lock instead of one lock late; `1 → 0 → 1` in one frame
  still reports `combo(0)` then `combo(1)`.
- `sink.b2b(level, player)`: a live back-to-back level 0..3 (each B2B steps it; a wave-1 clear of
  fewer than four lines without a T-spin ends it).
- **Multiplayer cascade stash**: local MP's depth arrives only as COMBO before the LINE_CLEAR, so
  it is held for that slot's next LINE_CLEAR in the frame.
- Ocean's delivery: deliver inside `try { … } finally { clearPending(slot) }` so a throwing sink
  never re-delivers every frame.
- The world also receives `onB2B`, `onGameOver` and `onSessionStart` (Rainbark's
  `WORLD_METHODS` includes them).

Theme side: `reportCombo(n, player)` keeps a `Map` per player and hands the world the **maximum**
chain on screen. `resetSession()` (window `gameOver`, mode-manager `modeStopped`) calls
`director.reset()`, clears the map, resets the level, `world.resetSession()` and
`scheduleLayoutReads()`.

### 2.4 The world contract

`NewWorld` must implement every method in `WORLD_METHODS` (pinned by the theme test):

```
build, bindCamera, showOnlyParts, setViewport(bufferW, bufferH, aspect), setLayout(rects|null, aspect),
setReducedMotion, seek(t), resetSession, restCamera, updateCamera(camera, sim), onLock(c), onClear(c),
onCombo(n), levelUp(level, { silent }), update(sim, camera), getPostState(), getState(), dispose
(+ onB2B, onGameOver, onSessionStart if you clone Rainbark's director)
```

and export `REST_RIG` (`near > 0`, `far > near`, `minFov`, `maxFov`), `fovForAspect(aspect)`
(a value in (1, 179) for aspects 0.46 to 21/9) and `NEW_UPPER_PARTS` (equal to the parts list in
the URL catalogue row). Rules every sibling follows:

- `build()` returns `this` and puts everything in the scene. **The scene never grows after
  build**: every pool is always drawn, dormant slots collapse to zero size, so the first frame
  compiles every pipeline and the prewarm sees a stable child count.
- **Nothing is created at event time.** Events write numbers into preallocated slots and a small
  timed queue (`schedule(time, kind, data)` + `drain(t)`), so `seek(t)` plus a fixed-step replay
  reproduces any frame (the capture flags and the playground depend on it).
- `updateCamera` sets `this.time = sim.time` first: the director flushes between it and `update`.
- Integrate phases whose speed changes (`phase += dt * rate`) instead of multiplying the clock by
  a moving rate, and wrap them before upload (`% 4096`, `% (2π·64)`).
- `getPostState()` returns **one reused object**. `getState()` (diagnostics, may allocate) must
  include `quality`. `dispose()` is idempotent.
- No per-frame allocation: scratch vectors, reused objects, `uniform.value.set(…)`.
- No downloads. Every texture is baked on the CPU at build (typed arrays → `DataTexture`), so the
  theme is never "busy" during prewarm and nothing breaks under `file://` in the packaged app.
  Time each bake (`performance.now()` in a Node script, or `node --cpu-prof`) and keep the sum
  small: it runs inside `createScene` and the prewarm.

### 2.5 Composition, aiming and calm zones

`readLayoutRects()` returns `{ cardCount, cards: [{x0,y0,x1,y1}], hud, boards: [5] }` in screen
fractions (y down) from `.player-card[data-player]`, the solo canvases, `#p<n>-phaser-container
canvas` and `.single-player-stats-bar`; **null when no card is visible** (menus, boot,
meditation), and the world then aims at `fallbackLayout(w, h)` (the `public/styles/main.css`
formulas: board `max(120, min(max(220, min(.22W, 300)), (H − 250)/2))`, card ≈ 1.19·board ×
(2·board + 158)). `boardPoint(board, u, row)` gives `x = x0 + (x1 − x0)·u`,
`y = y0 + (y1 − y0)·(row + 0.5)/20`.

- **Never read layout inside a bus handler** (`getBoundingClientRect` forces layout).
  `scheduleLayoutReads()` sets reads at frame time +0, +0.5 and +1.5 s after the scene build,
  resize, resume, `resetSession` and the mode manager's `modeStarted`/`modeActivated`/
  `modeStopped`. `layoutClock` advances by wall time so reads land while a capture freezes the sim.
- **Calm zones**: the post soft-dims inside rounded boxes round the cards (up to 4) and the HUD
  (`CALM_RECTS_MAX = 5`), with strength eased toward `live ? 1 : 0` at rate 3.
- **A lock's effect under the card is never seen** (gotcha #144): aim effects to leave the card's
  edge toward the world, and keep falling things in lanes outside the card and HUD.
- Phones are handled by aspect, not sniffing: below aspect ~0.62 the hero goes **above** the card
  (Serenity Warp's anchor: x 0.5, y 0.085; landscape puts it left of the card at x ≈ 0.21-0.24,
  y ≈ 0.42). Pointer parallax ignores touch and is off under reduced motion.

### 2.6 Post

One scene pass (no MRT; MSAA 4× on the tiers that can afford it), one `BloomNode` chain (Medium
and up), and **one** full-screen output pass. Tone mapping happens exactly once:
`renderer.toneMapping = NoToneMapping`, `pipeline.outputColorTransform = false`, and the output
node encodes sRGB itself.

- `this.pipeline = new THREE.RenderPipeline(renderer)` (never `PostProcessing`, gotcha #63);
  `this.scenePass = pass(scene, camera, { samples: look.msaa ? 4 : 0 })`.
- Bloom with a **hue-preserving** custom high-pass (`bloomNode.highPassFn`, inline, no
  `setLayout`, because `input` must stay the raw scene texture node): clamp on the max channel
  (`c · min(1, 7 / max3(c))`), soft knee. Serenity Warp: `BLOOM_THRESHOLD = 1.0`,
  `BLOOM_KNEE = 0.5`, `BLOOM_RADIUS = 0.62`. Couple the knee to exposure
  (`threshold = BLOOM_THRESHOLD / max(0.2, exposure)`) and multiply event lights by the inverse
  iris (gotcha #134). Dispose with `disposeBloomNodeDeep` (`src/themes/shared/bloom-dispose.js`).
- Calm zones: `roundBoxSdf` per rect (radius `16 · viewportH/1080` px), `inside = 1 −
  smoothstep(−20, 6, sdf)`, `calm = max(...)`, then a hue-preserving soft clip of what shows
  through the card (Serenity Warp `S·min(m, min(0.16 + 0.08m, 0.5))/m` at `calm·0.9`; Sunset the
  softer `min(m, 0.22 + 0.2m)`), and the event flash, grain and glare scaled down inside calm.
- A filmic tone curve that preserves hue (Serenity Warp's `starlightFilmic` k = 0.42, whitening
  `smoothstep(1.8, 9, peak)·0.78`; Sunset's k = 0.56), then grade, vignette, `renderOutput(…,
  NoToneMapping)`, grain (`(hash − 0.5)·0.014`, frame `floor(time·24)`) and dither
  (`(hash + hash − 1)/255`).
- `falseColor=1` debug: band the pre-tone-map max channel (< 0.1 blue, < 0.6 green, < 1 yellow,
  < 2.5 orange, else red). Look at it before tuning bloom.
- `POST_LOOK` per tier: features off are **not built** (gate in JS, not with shader zeros, gotcha
  #72). Serenity Warp: High `{ msaa: true, bloom: true, bloomStrength: 0.58, bloomResolution: 0.45,
  rays: 10, rush: 7, fringe: true }`; Medium no MSAA, bloom 0.54 at 0.33; Low and Minimal no bloom.
- `createPassThroughPipeline` plus `renderer.toneMapping = AgXToneMapping` is the fallback when
  the post throws.
- API: `update({...})`, `setCalmRects(rects, strength)`, `setSize(w, h, bw, bh)`, `render()`,
  `dispose()`.

### 2.7 Quality tiers and phones

```js
export const QUALITY = Object.freeze({ Minimal: {…}, Low: {…}, Medium: {…}, High: {…}, Ultra: {…}, Extreme: {…} });
export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));
export function tierFor(q) { return QUALITY[q] || QUALITY.High; }
```

- **"Every tier keeps the whole picture and every event."** Tiers cut counts and detail terms,
  never a feature or a beat. Drop a noise term in JavaScript, never by substituting a constant
  (gotcha #135), and capture the lowest tier.
- Only `settings.effectQuality` matters (default `'High'`; `normalizeQuality` maps anything else,
  including `'Custom'`, to High). The tier is fixed per build; a change rebuilds.
- `PIXEL_RATIO_CAP = { Minimal: 0.7, Low: 0.85, Medium: 1.0, High: 1.15, Ultra: 1.35, Extreme: 1.6 }`
  (pinned by the theme test), multiplied through the policy (`computeScenePixelRatio`): min(DPR,
  theme cap, policy cap by tier Minimal 0.9 / Low 1 / Medium 1.15 / High 1.25 / Ultra 1.35 /
  Extreme 1.5) × the global render scale (`PERFORMANCE_DOWNSCALE` steps it down by 0.25 to a floor
  of 0.5).
- The phone validator runs at **Low** (render scale 0.5, so a DPR ceiling of 0.5) on a 390×844
  DPR 3 viewport. Author sizes for a reference frame and floor them at about one buffer pixel
  (gotcha #147), or stars become blobs on a phone.

### 2.8 The piece palette (`NEW_ID-tetrominos.js`) and the palette gate

```js
export const NEW_UPPER_TETROMINOS = {
    version: 2,                        // Rainbark; older themes use 1
    colors: { I: '#…', O: '#…', T: '#…', S: '#…', Z: '#…', J: '#…', L: '#…', GARBAGE: '#…', CLEAN_GARBAGE: '#…' },
    renderMode: 'solid',
    effects: { premium: true, phaser: { gradient: true, highlight: 0.16, shadow: 0.2, rim: true,
        rimAlpha: 0.4, rimWidthFactor: 0.05, gloss: true, glossAlpha: 0.14 } },
    rendererOverrides: {},
};
```

- `npm run check:palette` (`scripts/palette-guideline-check.mjs`, not in CI but every rebuild
  records it green) reads the first hex per shape. It **fails** if all seven shapes sit in their
  conventional hue bands (I 160-210°, O 32-75°, T 245-315°, S 90-170°, Z 320-360° or 0-20°,
  J 200-250°, L 20-50°) and **warns** at 6/7. Derange at least two roles; Rainbark is 0/7. It
  also warns if no other file in the theme folder references the exported constant.
- Pieces must read as **solid fused tiles** (the user asked for solid colour back; gotcha #159 is
  the same rule for pieces drawn as 3D meshes):
  no glow, pulse, shimmer or trails, so active, ghost, hold, next and multiplayer previews stay
  crisp.
- Check the palette under colour-vision deficiency. This is the script used for Rainbark (save it
  in your scratchpad; it prints each hue against its band, the gate count, and the four closest
  pairs by ΔE and ΔL* under none, protanopia, deuteranopia and tritanopia simulation):

```js
const pal = JSON.parse(process.argv[2]);
const bands={I:[[160,210]],O:[[32,75]],T:[[245,315]],S:[[90,170]],Z:[[320,360],[0,20]],J:[[200,250]],L:[[20,50]]};
const hx=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
const lin=c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
const gam=c=>{c=Math.min(1,Math.max(0,c));return c<=0.0031308?12.92*c:1.055*c**(1/2.4)-0.055};
function hue(rgb){const [r,g,b]=rgb;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);if(mx===mn)return null;const d=mx-mn;let h;if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;return (h*60+360)%360}
function lab(rgbS){const [r,g,b]=rgbS.map(lin);const X=(0.4124*r+0.3576*g+0.1805*b)/0.95047,Y=0.2126*r+0.7152*g+0.0722*b,Z=(0.0193*r+0.1192*g+0.9505*b)/1.08883;const f=t=>t>0.008856?Math.cbrt(t):7.787*t+16/116;return [116*f(Y)-16,500*(f(X)-f(Y)),200*(f(Y)-f(Z))]}
const M={none:[[1,0,0],[0,1,0],[0,0,1]],
prot:[[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]],
deut:[[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]],
trit:[[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]]};
function sim(rgbS,m){const l=rgbS.map(lin);return m.map(row=>gam(row[0]*l[0]+row[1]*l[1]+row[2]*l[2]))}
const de=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const keys=Object.keys(pal);
let n=0;for(const k of keys){const h=hue(hx(pal[k]));const inb=bands[k]&&h!==null&&bands[k].some(([a,b])=>h>=a&&h<=b);if(inb)n++;const L=lab(hx(pal[k]))[0];console.log(k,pal[k],'hue',h?.toFixed(1),'L*',L.toFixed(1),inb?'IN BAND':'')}
console.log('gate',n+'/7');
for(const mode of ['none','prot','deut','trit']){const labs=Object.fromEntries(keys.map(k=>[k,lab(sim(hx(pal[k]),M[mode]))]));const pairs=[];for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++){pairs.push([keys[i]+keys[j],de(labs[keys[i]],labs[keys[j]]),Math.abs(labs[keys[i]][0]-labs[keys[j]][0])])}pairs.sort((a,b)=>a[1]-b[1]);console.log(mode,'worst:',pairs.slice(0,4).map(p=>p[0]+' dE'+p[1].toFixed(1)+' dL'+p[2].toFixed(1)).join(' | '))}
```

Run: `node cvd.mjs '{"I":"#C2F23D","O":"#F07A2A","T":"#2BCB72","S":"#B98AF2","Z":"#1A93AC","J":"#D23468","L":"#2F4CC0"}'`.
Several concept files report their worst pair from this check; keep the worst pair's ΔE well
clear of 10 under every simulation and separate close hues by value (ΔL*).

### 2.9 The icon

- `src/themes/NEW_ID/NEW_ID-theme-icon.png`: **512×512, 8-bit RGBA, non-interlaced PNG**; the
  subject in a circle on a transparent ground (`scripts/process_icons.py` does a centre crop and an
  ellipse alpha mask). Every current icon is exactly this format.
- Recipe (Murmuration, Rainbark): give the playground effect an `icon=1` framing (with
  `iconFov`, `iconYaw`, `iconPitch` catalogued), capture a square frame (720×720) at
  `quality=Ultra`, lift colour slightly (Murmuration: saturation 1.22, contrast 1.14, brightness
  1.08), bake the 512 px circle, and check it at the picker's 80 px beside its neighbours. One hero
  motif; read the concept file's icon brief.
- The registry `icon` path must end in `.png`; the theme test checks the file exists. Add the
  byte-identical public mirror `public/assets/themes/NEW_ID-theme-icon.png` (no code reads it; the
  precedent keeps it).

### 2.10 The playground effect (`src/playground/effects/NEW_ID.effect.js`)

The file name must be `NEW_ID.effect.js` (Vite's `manualChunks` puts `<themeId>*.effect.js` into
the theme's chunk). It mounts the **same** world and post as the theme:

```js
export const meta = { id: 'NEW_ID', title: 'NEW_NAME (full world)', description: '…' };
export function create({ scene, camera, renderer, params }) {
    // new NewWorld({ scene, quality, capture: true, renderer }).build(); world.bindCamera(camera); …
    return { cameraRadius, camera(time, cam), update(time, dt), seek(time), render(), resize(), getDiagnostics(), dispose() };
}
```

- Document every parameter in the header and read each with a literal `params.get('x')`.
  The shared set (Serenity Warp's, which Rainbark extends): `bloom board color combo demo event
  eventAge eventLevel falseColor icon iconFov iconPitch iconYaw level lines locks noPost parts
  piece px py quality reduce row statsHud turns u`. Rainbark adds `b2b cascade dist peak session
  sheds` and events `release b2b gameOver`.
- `board=1` mounts a DOM mock with the **real** selectors (`.player-card[data-player="solo"]`,
  `#single-player-game-canvas`, `.single-player-stats-bar`) sized by the stylesheet formula, then
  feeds `readLayoutRects()` to `world.setLayout` and the post's calm rects: events aim at the mock
  board and calm zones are exercised.
- `event=lock|drop|clear|quad|tspin|perfect|levelUp` with `eventAge` (default 0.4 s), `lines`,
  `row`, `u`, `piece`, `turns`, `color`; `combo=<n>` holds a chain, `level=<n>` rests on a
  level, `locks=<n>` pre-plays locks. `seek(t)` replays from `t − lead` with fixed steps
  (`draw = false` except the last frame), so any event at any age is reproducible.
- Rainbark feeds events through a **real director** fed the game's own payloads, so the effect
  exercises exactly what the theme's sink hands the world. Do the same.
- The playground's first frame renders the **raw scene**; the post runs from the next tick. After
  `__PLAYGROUND_READY__`, wait (the capture script's `--settle`) or call
  `window.__PLAYGROUND__.seek(t)`, which renders through the post.

### 2.11 URL catalogue rows

- `src/ui/url-parameters/theme-parameters.js`, the `captureThemes` array (lines 64-185 at
  `5d3478d`), one row at its alphabetical slot:
  `['NEW_ID', 'newCamel', 'NEW_NAME', 'part1, part2, …']` (Rainbark:
  `['rainbark', 'rainbark', 'Rainbark', 'sky, trunks, mist, curls, fx, life']`). It generates the
  five capture flags with sources `src/themes/NEW_ID/NEW_ID-theme.js` and
  `src/themes/NEW_ID/NEW_ID-world.js`; **both files must exist** before you add the row.
- `src/ui/url-parameters/playground-parameters.js`: add `NEW_ID` to the `scope` string and
  `src/playground/effects/NEW_ID.effect.js` to the `sources` of every entry the effect reads; add
  entries for new names (scope `'playground.html — NEW_ID'`). Remove the old theme's effect from
  every entry when you retire it.
- `tests/unit/url-parameter-catalog.test.js` fails on: an empty field, an example that does not
  parse or does not contain the name, a duplicate `name:scope`, a `source` that does not exist, or
  a literal `params.get/has('x')` in a listed source that is not catalogued. The theme test
  checks the parts list equals `NEW_UPPER_PARTS` and that exactly the five prefixed flags exist.
- `docs/URL_PARAMETER_REFERENCE.md`: update the count line (compute with
  `node --input-type=module -e "import {URL_PARAMETER_CATALOG as c} from './src/ui/url-parameters/catalog.js'; console.log(new Set(c.map(e=>e.name)).size, c.length)"`;
  663 names / 702 entries after Rainbark's frame) and add a paragraph like Rainbark's ("The
  NEW_NAME rebuild added the capture flags … plus the `NEW_ID` playground effect, which reads N
  parameters its sibling effects already had and adds …; OLD_NAME, the theme it replaces, read
  … from the URL, so … was retired").

### 2.12 Static bans (theme tests and gates enforce them)

In the theme folder and the effect: no `new …ShaderMaterial(`, no `new …WebGLRenderer(`, no
`mx_*(` MaterialX noise, no `from 'three'` (only `'three/webgpu'` and `'three/tsl'`), no absolute
`'/assets/…'`, `'/textures/…'` or `'/hdri/…'` paths, no `.wgsl`/`.glsl` files, no
`buildsPipelinesAsync`, no `create(Render|Compute)Pipeline(Async)?(`, no `getContext(`, no
`localStorage`, no `EffectComposer|UnrealBloomPass|ShaderPass|RenderPass|compileComputeAsync`, no
theme properties named `webgpuState`, `webglState`, `composer`, `visual`, `gameplayFx`,
`reactionDirector` or `overlay`. Every scene material `isNodeMaterial`. No `TextureLoader.load`
and no `fetch` in a build-and-frame run. The dual-state tripwire fails a theme folder that
contains both `new …WebGPURenderer(` and `new …ShaderMaterial(` (it scans **tracked** files only:
`git add` before trusting it).

### 2.13 Tests to write

Clone the five sibling files and rename (Serenity Warp's 135 tests in five files; Rainbark's
frame added six files):

| File | What it tests | Template |
|---|---|---|
| `tests/unit/NEW_ID-core.test.js` | three-free maths: relations, not tuning numbers (import the constants) | `rainbark-core.test.js` |
| `tests/unit/NEW_ID-director.test.js` | `vi.fn` sink; drives `EVENTS`; hard-drop fold, colour fallback, viewportOrigin, widest clear, combo break, T-spin/perfect/B2B, meditation, per-player combos, slot overflow, malformed payloads, throwing sink, settings resets | `rainbark-director.test.js` (940 lines) |
| `tests/unit/NEW_ID-composition.test.js` | `fallbackLayout`, `readLayoutRects` over rect doubles, selectors | `rainbark-composition.test.js` |
| `tests/unit/NEW_ID-world.test.js` | a real world in a `THREE.Scene` (no renderer): `makeWorld('Minimal', …)`, `settle()`, counts, order and bounds of what each event does | `rainbark-world.test.js` |
| `tests/unit/NEW_ID-theme.test.js` | the shell with mocked renderer, world and post: registry entry, icon exists, `name === id`, static bans, the five flags, WebGL2 when no GPU, the six pixel-ratio caps, lifecycle; a final block imports the **real** world and post and builds every tier ("the node graphs are built, never compiled") | `rainbark-theme.test.js` (1680 lines) |
| `tests/unit/NEW_ID-shaders.test.js` (recommended) | build each part's node material with `WGSLNodeBuilder` and `GLSLNodeBuilder` against a stub renderer, High and Minimal: no warnings, no throw, each stage < 48 KB, no equal-edge `smoothstep`, no `mx_`, laid-out helpers emitted once | the inline helper in `tests/unit/himalayan-peak-shaders.test.js:27-72` |
| `tests/unit/NEW_ID-rename-migration.test.js` | old saves resolve (§4.4) | `rainbark-rename-migration.test.js` |

---

## 3. The staged build order

This is the order Rainbark is being built in. Each concept file has its own step table and
acceptance shots; this section is the method around them:

| Concept file | Step table | Acceptance shots | Stage 0 (slot, name, scaffold) |
|---|---|---|---|
| `rainbark.md` | §7.3 Staged build order | §8 Acceptance shots | done (`0c747dd`, `585ab55`) |
| `iris-springs.md`, `riverbloom.md`, `haft-rang.md`, `sunfall.md` | §5.6 Staged build order with acceptance shots | in the same table | §5.1 |
| `painted-ages.md` | §5.8 Staged build order (CPU lab first: §5.6, Stage A0) | §5.9 Acceptance shots | §4.3 The slot, §5.1 Identity and registry |

**Principles**

- **One small effect per step**, and one step per session or per agent run (CLAUDE.md). A step is
  done when: its playground shots on **both backends** look right to an independent critic, the
  console is clean, `window.__PLAYGROUND__.diagnostics()` was read back, one low-tier shot exists,
  the minimal gates (§6.1) are green, and it is committed.
- **Parallel agents get disjoint file ownership.** Never let two agents edit one file. Say in each
  agent's prompt exactly which files it owns and that it must not touch others or commit; the
  orchestrating session integrates and commits.
- **Pictures are judged by someone who did not make them.** A builder grades its own work
  generously. An independent critic with a fresh context, given only the spec section, the shots
  and the reference notes, finds what is wrong.
- **Commit after every step** on a feature branch, with a message that says what the step drew
  and what was checked (see `585ab55` for the style). Use the attribution lines your session
  gives you. Never commit reference photos or scratch captures.

If your session has a workflow or subagent tool, the shapes below map onto it directly. If it does
not, run the same prompts one after another yourself.

### 3.1 Stage 0a: the core and the palette (one small commit)

Write `NEW_ID-core.js` (three-free constants and maths the director, world, effect and tests will
share: piece codes, palette stops, `cellsFromMatrix`, `approach`, `smooth`, `mulberry32`) and
`NEW_ID-tetrominos.js`; run `npm run check:palette` and the CVD script; commit. This gives every
parallel agent of Stage 0b the same source of truth. Rainbark: `0c747dd` ("the piece palette and
the core constants"; nothing references them yet).

### 3.2 Stage 0b: scaffold and rename in parallel, then integrate

Rainbark: `585ab55`, 43 files, +8055/−1379. Split the work so no file has two owners:

| Agent | Owns | Delivers |
|---|---|---|
| **Adapter** | `NEW_ID-theme.js`, `NEW_ID-director.js`, `NEW_ID-composition.js`, and their three test files | The cloned lifecycle, director and layout reader, renamed; tests green against a world/post double |
| **World frame** | `NEW_ID-world.js`, `NEW_ID-sky.js` (a placeholder sky), `NEW_ID-tsl.js`, `NEW_ID-post.js`, `NEW_ID-quality.js`, additions to `NEW_ID-core.js`, `src/playground/effects/NEW_ID.effect.js`, `tests/unit/NEW_ID-world.test.js`, the effect's entries in `playground-parameters.js` | A world satisfying `WORLD_METHODS` from day one (camera rig, every event recorded into slots even though nothing draws it yet), the post with calm zones, six tiers, the effect |
| **Rename** | Everything in §4 outside `src/themes/NEW_ID/`: registry, aliases, music file and catalogue, songs.json, Odyssey data and presentation colour, `index.html`, `main.css`, ThemesTab, phone validator lists, `theme-parameters.js` row, the old folder's deletion, old tests, the migration test, CREDITS and living docs | The old theme gone and aliased; counts unchanged |
| **Integrator** (the orchestrating session) | Seams only | Fix imports and test doubles across the three; run §6.1; first shots |

Prompt skeleton for each parallel agent:

> Repo `<repo>`, branch `<branch>`. We are building the theme NEW_NAME (`NEW_ID`) from
> `docs/theme-concepts/<concept>.md`, replacing OLD_NAME (`OLD_ID`) by the procedure in
> `docs/theme-concepts/PLAYBOOK.md`. **You own exactly these files: …** Do not edit any other file
> (other agents are editing them now) and do not commit. Read PLAYBOOK §2 (contract) and §7 (house
> rules) first, then `<the sibling files to clone>`. When done, run
> `npx vitest run tests/unit/NEW_ID-<yours>` and `npx eslint <your files>`, and return: the files
> you changed, the test result, and anything another owner must change (as exact edits you could
> not make).

Integrator checklist (Rainbark's Stage 0 acceptance):

1. Run the minimal gates (§6.1). `git add` the new files first (the tripwire reads tracked files).
2. Capture a **known-good control** first to prove the harness works (we used
   `game.mjs --theme=serenity-warp --backend=webgl2`).
3. Playground shots on both backends: rest, `board=1`, phone 390×844, Minimal, Low, Medium,
   `falseColor=1`, and every event (`lock`, `drop`, `clear`, `quad`, `tspin`, `perfect`,
   `levelUp`, plus the concept's own), even though the placeholder world draws little: the point
   is a clean console on every code path.
4. The real game on both backends (`game.mjs`), switching away on both (`switch-away.mjs`
   must print `clean switch-away`), and the phone validator at Low and Minimal.
5. Full suite once (§6.2), then commit.

### 3.3 Stage A: the environment, one step at a time, each with a critic loop

Each concept lists its environment steps (Rainbark: A1 the hero bark on one trunk, A2 the grove
plan, composition solver and backdrop, A3 air and mist, A4 sunflecks and the clocks, A5 ambient
life). For each step run this loop:

```
build ──► acceptance shots (both backends, the step's viewports and tiers) + similarity montage
  ▲                                   │
  │                                   ▼
fix (split the critic's list by       independent critic (fresh context): ranked defects with crops,
disjoint area, one agent per area,    each tied to the spec line it violates; verdict pass / revise
then one verify agent)  ◄─────────────┘
repeat until the critic passes it (Rainbark A2 went build → critic r1 → fix1 → critic r2 → fix2 …)
```

- **Before A1, prototype the hero material on the CPU** (numpy/PIL in the scratchpad) and compare
  it side by side with reference photos (§7.3, the Voronoi lesson). Only then write the shader.
- **The build agent** implements the step in the playground effect and the world, writes or
  extends tests, captures the step's acceptance shots (the concept file's acceptance table names
  the queries and viewports: D = 1920×1080, W = 2560×1080, P = 390×844), and makes a **montage
  against the existing themes it most resembles** (the concept file names them in its "How to use
  this file" box; Rainbark's are in its §9, risk 2). The pictures are `docs/theme-screenshots/<id>.png`,
  which can be stale, so capture the current theme with §5 when it matters.
  `docs/theme-concepts/reference/catalog.md` describes each theme and its "avoid reusing" list but
  holds no images: where a concept file says "snapshots in `docs/theme-concepts/reference/`", read
  the catalog entry there and use the screenshot or your own capture as the picture. Rainbark's
  A2 compared its rest frame with misty-lake, nimbus-veil and stillwater, and with the forest themes.
- **The critic agent** gets: the spec sections for the step, the reference notes (descriptions,
  never copyrighted images in the repo), the shots and montages, and the instruction to judge
  only what it sees. It returns a ranked list (blocking / major / minor), each item with the shot,
  the region (crop it at 2× native), what is wrong, what the spec asked for, and a concrete fix
  direction; and a verdict. It also probes: phone portrait, 21:9, the lowest tier, level and zone
  variants, a later clock time, reduced motion, and a temporal diff of two nearby times (to catch
  flicker or popping).
- **The fix agents** split the list by area with disjoint files (Rainbark A2 fix1 ran five: the
  composition's right side and the solver; the mist floor; the canopy; the limbs; the minors), then
  one verify agent re-ran the tests, lint and the full shot set on both backends.

Critic prompt skeleton:

> You are an independent art director. Do not edit code. Judge Stage `<step>` of NEW_NAME against
> `docs/theme-concepts/<concept>.md` §`<sections>`. Shots: `<dir>` (file names say backend,
> viewport, tier, time). Reference: `<notes>`. Look at every image with the Read tool, crop
> regions at 2× when you need detail (Python PIL is available), and compare with the existing
> themes in `<montage>`. Return: verdict (pass / revise), then a ranked defect list (blocking,
> major, minor), each with shot, region, what is wrong, what the spec says, and a fix direction.
> Also capture and judge: `<extra probes>` using the tools in PLAYBOOK §5.

### 3.4 Stage B: the gameplay effects, one beat per step

One event beat per step (Rainbark: B1 the lock and hard drop, B2 line clears, B3 four lines, B4
the combo chain and its release, B5 T-spin and back-to-back, B6 perfect clear, level up, game
over, meditation and multiplayer lanes). For each beat:

- Capture an **age sequence** with `event=…&eventAge=…` (for example 0.25, 0.75, 1.8, 4 s) so the
  attack, peak and decay are all seen, with `board=1`, on both backends, plus one Low-tier and one
  phone shot. Check that the beat reads at a glance and stays out of the card and HUD.
- Extend the director test for any new sink field and the world test for slot counts, ordering and
  bounds. Check every mode's quirks (§2.3): Infinity (no level-ups, `viewportOrigin`), local MP
  (players 1-4, no T-spin/B2B/level/perfect on the bus), online (slot 0), meditation (`position`,
  no board, rapid bursts), Odyssey synthetic clears (empty rows).
- Respect the photosensitivity limits (§7.1) and reduced motion.

### 3.5 Stage C: post, tiers, phone, icon, docs

- **C1 post**: calm zones tuned with `board=1`; bloom knee and iris; grade; MSAA/FXAA;
  `falseColor=1` (only the intended highlights exceed the knee).
- **C2 tiers**: Minimal and Low captures of rest and the starred events; the WebGL2 leg on every
  event shot; the shader-size test.
- **C3 layouts**: phone portrait (390×844), 21:9 (2560×1080) and a short laptop.
- **C4 ship**: the icon (§2.9); the real game end to end on both backends; switching away leaves
  no canvas; the phone validator at Low and Minimal; tests; the record
  `docs/NEW_UPPER_VISUAL_OVERHAUL_<yyyy-mm>.md` (the precedent is
  `docs/SERENITY_WARP_VISUAL_OVERHAUL_2026-10.md`), curated captures under
  `docs/NEW_ID-captures/` (webp, small), a row in `docs/ARCHITECTURE_INDEX.md`, gotcha rows you
  discovered in **both** `.claude/skills/webgpu-threejs-tsl/SKILL.md` and
  `.agents/skills/webgpu-threejs-tsl/SKILL.md` (byte-identical; `agent-skill-mirror.test.js`).

### 3.6 Final adversarial review

Before asking to merge, give a fresh agent the whole diff and ask it to break the theme, not to
praise it. Then run the full gates (§6.2). The `code-review` and `security-review` skills, if your
session has them, are a useful second pass. Checklist for the reviewer:

- Lifecycle: pause/resume, a quality change mid-run (rebuild keeps clock and level), a quality
  change while paused (deferred to resume), render-scale change, GPU-loss recovery path
  (`forceWebGL` rebuild), switch away and back (a new instance), `cleanup()` idempotent, no
  listener or rAF left behind, `removeRendererResilience()` before `disposeRenderer()`.
- Events: every mode's payload shapes (§2.3), hidden-row offset and clamps, pooled HARD_DROP piece,
  combo semantics, empty-row clears, a burst of hard drops (no stacking flashes, no slot overflow
  crash), `backgroundComboEffects` and `pieceLockRipple` off.
- Rendering: NaN sources (`pow` of a near-zero negative, `exp` overflow on portrait, division by
  zero), equal-edge `smoothstep`, per-frame allocation, uniform-buffer count ≤ 12 per stage, vertex
  buffers ≤ 8, scene child count stable after build, both backends.
- Readability and safety: calm zones, nothing crosses the card, flashes within WCAG 2.3.1,
  reduced motion.
- Repo: old id only where §4.7 allows; IP words absent; dated records untouched; living docs
  updated.

---

## 4. Rename and retire checklist

Generalised from the Cosmic Chimes → Rainbark commit (`585ab55`) and the Murmuration rename
(`a74a86a`). Do it in Stage 0b. Before editing, list every hit:

```bash
git grep -nI -iE "OLD_ID|OLD_NAME|OLD_KEY|OldClass|oldCamel" -- . ':!docs/archive' ':!reports'
```

(Replace each placeholder with its real spelling, e.g. `cosmic[-_ ]?chimes|CosmicChimes`.) Sort
every hit into one of: **remove** (obsolete theme code, DOM, CSS, tests), **change** (code, data,
tests, living docs), **keep as history** (dated records), **keep frozen** (the V2 save table).

### 4.1 Decisions (recommended answers)

| Question | Recommendation | Why |
|---|---|---|
| Alias the old id? | **Yes**: `['OLD_ID', 'NEW_ID']` in `RETIRED_THEME_IDS` | The orb keeps its slot, so a player who earned or selected the old theme keeps the reward, saved background and owned song, and the frozen V2 stamps still mean something. Matches `a74a86a` and `585ab55`. (Without it, the bioluminescence-2 precedent: the collection says "Replay Odyssey orb N · NAME to collect its new theme", but a saved background silently falls back to Forest and the owned track is lost.) Side effect: the old "seen" mark carries over, so no "NEW" badge. |
| Song | **Retitle** an authored recording (`OLD_ID.mp3` → `NEW_ID.mp3`, ID3 title → NEW_NAME, `OLD_KEY` → `NEW_KEY` with a `RETIRED_TRACK_KEYS` row). A placeholder is only renamed. | Keeps the catalogue counts (61 / 31 authored / 30 placeholders). The audio stays the old recording; tell the user. Lower-risk alternative (Parhelion and Ocean keep songs titled differently from the theme): keep the old title under `NEW_ID`, no key migration, but the old name stays in the Music tab. |
| Orb | Keep the orb number and chapter; rename the orb and rewrite its two descriptions | Moving an orb reorders chapters, orb positions and save identities |
| Group | Pick the registry group that fits (`abstract`, `atmospheric`, `biomes` = Nature, `cosmic`, `fantasy`, `meditation`, `sky`, `urban`; labels at `ThemesTab.js:48-57`) | No test counts groups. Rainbark moved `cosmic` → `biomes` |
| Container | **Static div** in `index.html` plus one CSS rule | Same stacking as most siblings; the clear colour shows during the 2.5 s fade |
| Heavy GPU | Add `NEW_ID` to `HEAVY_GPU_THEME_IDS` | Gives `resourceProfile: 'heavy-gpu'`, `performanceClass: 'heavy'` (20 s timeouts), `startupEligible: false`; sibling tests assert the triple |

### 4.2 The ordered checklist

Each step names the Rainbark change as the worked example.

1. **Branch** from current `main`, or from Rainbark's branch if `main` does not have it yet (§0).
2. **Theme folder.** `git rm -r src/themes/OLD_ID/`; create `src/themes/NEW_ID/` (§2.1). Remove
   the old theme's playground effect(s) `src/playground/effects/OLD_ID*.effect.js` and its tests
   `tests/unit/OLD_ID-*.test.js`. Grep for imports of `src/themes/OLD_ID/` from outside the folder
   (tests, scripts, Odyssey chapter code) and resolve each.
   *Rainbark:* removed `cosmic-chimes-theme.js` (686 lines, a DOM/CSS theme),
   `cosmic-chimes-tetrominos.js`, its icon; it had no effect or capture flags.
3. **Registry** (`src/themes/theme-registry.js`): replace the entry in place (same array position)
   with `{ id: 'NEW_ID', displayName: 'NEW_NAME', module: './NEW_ID/NEW_ID-theme.js', icon:
   './NEW_ID/NEW_ID-theme-icon.png', group: '<group>' }`; add `'NEW_ID'` to
   `HEAVY_GPU_THEME_IDS` (remove `OLD_ID` if it was there).
4. **Retired id**: add a doc paragraph and `['OLD_ID', 'NEW_ID']` to `RETIRED_THEME_IDS`.
   *Rainbark:* "`cosmic-chimes` was replaced by Rainbark (2026-10-11) at the same Odyssey orb: a
   saved selection, an earned collection entry and an Odyssey completion that name the old id now
   mean Rainbark." `resolveThemeId` is used by settings load, collection grants and seen marks,
   Odyssey completions, theme switches and the music catalogue.
5. **Music catalogue** (`src/core/progression/theme-music-catalog.js`):
   - Authored song: change the `AUTHORED_SONGS` key/title/file to `NEW_ID: ['NEW_NAME',
     'NEW_ID.mp3']` (Rainbark: `rainbark: ['Rainbark', 'rainbark.mp3']`), add `['OLD_KEY',
     'NEW_KEY']` to `RETIRED_TRACK_KEYS` and extend its doc comment. No code change is needed in
     `src/ui/settings.js`, `src/core/progression/music-preference.js` or
     `src/audio/sound-manager.js`: since `a74a86a` they resolve keys through
     `resolveMusicTrackKey`.
   - Placeholder song: nothing to edit in `AUTHORED_SONGS`; the key changes from the old display
     name to the new one, so still add the `RETIRED_TRACK_KEYS` row.
6. **Song file.**
   - Authored: `git mv public/assets/music/OLD_ID.mp3 public/assets/music/NEW_ID.mp3`, then rewrite
     the ID3 title with the script in §4.3 (same length, audio bytes unchanged). *Rainbark:*
     `cosmic-chimes.mp3` → `rainbark.mp3`, 10,988,419 bytes before and after.
   - Placeholder: `git mv public/assets/music/OLD_ID-placeholder-song.mp3
     public/assets/music/NEW_ID-placeholder-song.mp3`. **Do not retitle**: the test requires every
     placeholder to be a byte-identical copy of `blood-moon.mp3`.
   - Then `node generate-songs.js` to regenerate `public/assets/music/songs.json` (entries sorted by
     name; it throws if a recording is missing).
7. **Odyssey presentation colour** (`src/core/odyssey/theme-presentation.js`): delete the old row,
   add `NEW_ID: '#xxxxxx'` (quoted if hyphenated) at its alphabetical place. Mandatory: every orb
   theme needs one. *Rainbark:* `rainbark: '#c2f23d'` (its First Skin chartreuse).
8. **Chapter list** (`src/core/odyssey/data/chapters.js`): swap the id at the same index of the
   chapter's `themes.primary` (it must equal the orb order).
9. **Orb** (`src/core/odyssey/data/levels.js`): the orb's `name`, `theme.primary`,
   `transitionIn` (Rainbark: `'warp'` → `'crossfade'`), the base `metadata.description` and
   `tip`, and the live text in `LEVEL_PHASE2_OVERRIDES` (description and tip). Keep mechanics,
   victory and stars. `JSON.stringify(LEVEL_CONFIGS)` must not contain the old id or name.
   *Rainbark:* orb 47 "Singularity Gate" → "The Painted Giants"; phase-2 description "Colossal
   painted trees stand in blue air above a floor of mist, a rare pocket of quiet. Re-center before
   the final pull."
10. **ThemesTab fallback glyph** (`src/ui/serenity-hub/ThemesTab.js`, `getThemeFallbackIconName`,
    keyed by **display name**, used only when no icon URL resolves): replace the old row with
    `'NEW_NAME': '<glyph>'`. Glyphs available in `src/ui/components/cosmic-icons.js`: wave moon
    leaf tree flower cloud mist bolt flame star burst gem butterfly sprout breath aurora-dreams
    sacred-geometry moonlit-waters solar-flare crystal-prism volcanic-fire ocean-tide zen-garden
    ancient-forest electric-storm mountain snowflake sun sunrise rain droplet aurora galaxy spiral
    island temple city bamboo wolf fish jellyfish bowl chime lantern candle palette.
    *Rainbark:* `'Cosmic Chimes': 'chime'` → `Rainbark: 'bamboo'`.
11. **Container** (`index.html`): replace the old static div in place with
    ```html
    <div id="NEW_ID-theme" class="theme-container">
        <!-- WebGPU canvas dynamically added by NewClass -->
    </div>
    ```
    Keep the `<div class="background-container">` and `<div class="game-container
    single-player-layout"` markers intact: the phone validator slices the page on them. If the old
    theme used the lazy container (no static div, like serenity-warp and parhelion), add the static
    div anyway.
12. **CSS** (`public/styles/main.css`): delete the old theme's block after checking each selector
    has no other user (`git grep` it in `src`, `public`, `index.html`, `tests`, `scripts`), and add
    in its place:
    ```css
    /* --- NEW_NAME Theme (<one line>: a WebGPU canvas, src/themes/NEW_ID/) --- */
    #NEW_ID-theme {
        background: #<CLEAR_COLOR>;
        overflow: hidden;
    }
    ```
    *Rainbark:* 460 lines of Cosmic Chimes CSS deleted (keyframes, `.chime*`, `#space-dust`, …);
    `#rainbark-theme { background: #3a4a72; overflow: hidden; }`. Watch for same-named rules
    elsewhere in the file that belong to other themes (Cosmic Chimes' `.aurora-wave` had a dead
    twin at another line; `@keyframes aurora-wave` was a different, live name).
13. **Public icon mirror**: `git rm public/assets/themes/OLD_ID-theme-icon.png` (if present); add
    `public/assets/themes/NEW_ID-theme-icon.png`, byte-identical to the source icon (`cmp`).
14. **Phone validator lists** (`scripts/lib/mobile-webgl2-validation.mjs`): add `'NEW_ID'` to
    `MOBILE_WEBGL2_NODE_IDS` (requires `WebGPURenderer` on the WebGL2 backend with node materials)
    and to `MOBILE_WEBGL2_SMOKE_IDS`; remove `OLD_ID` from both.
15. **URL catalogue**: the `captureThemes` row and the playground entries (§2.11); remove the old
    theme's row and effect references; update `docs/URL_PARAMETER_REFERENCE.md`.
16. **Tests** (§4.4).
17. **Living docs**: `CREDITS.md` song list (drop the old title; add `NEW_NAME (titled "OLD_NAME"
    until <Month YYYY>)` at its alphabetical place, only if retitled; *Rainbark:* `Rainbark (titled
    "Cosmic Chimes" until October 2026)`); the orb roster `docs/ODYSSEY_60_ORB_CAMPAIGN_2026-10.md`
    (``| N | NEW_NAME (`NEW_ID`) | <one-line description> |``); the soundtrack table
    `docs/THEME_MUSIC_PROGRESSION_2026-10.md` (``| N | NEW_NAME | `NEW_ID.mp3` | Existing |``); the
    URL reference; `docs/ARCHITECTURE_INDEX.md` (a row for the record doc, in Stage C).
18. **Comments** that name the old theme or its files in other modules ("forked from …"
    provenance) follow the rename; `tests/unit/event-contract.test.js` `KNOWN_VIOLATIONS` rows that
    name dead files are removed (Murmuration removed three).
19. **Leave untouched**: dated records (§4.5) and the frozen V2 table.
20. **Optional, with care**: the Odyssey `heavyThemes` sets in
    `src/core/game-modes/OdysseyMode.js:1036-1043` and `:1086-1093` (+900 ms / +800 ms blackout
    budget). The file is **at its architecture-fitness line ceiling** (4391 counted lines, 4390 by
    `wc -l`): swapping an id on an existing line is fine (Murmuration did), adding a line fails
    CI. Rainbark tried adding itself, broke the ceiling, and left the sets unchanged.
21. **Fleet capture** (local machine with Electron only): `npm run capture:themes -- --theme NEW_ID`
    writes `docs/theme-screenshots/NEW_ID.png` and `results/NEW_ID.json`. Not runnable in a cloud
    container.

### 4.3 The ID3 title rewrite (authored songs only)

The shipped MP3s carry an ID3v2.3 tag whose `TIT2` frame holds the title (UTF-16 with BOM). This
stdlib-only script rewrites only that frame, keeps the tag size by absorbing the difference in the
tag's padding, and asserts the file length and the SHA-1 of everything after the tag (the audio)
are unchanged. It is the script used for Rainbark (Murmuration's commit kept the tag size the same way: padding
4096 → 4104 for a title four characters shorter). Save it in your scratchpad:

```python
import hashlib,sys; src,dst,title=sys.argv[1:4]; d=open(src,'rb').read()
assert d[:3]==b'ID3' and d[3]==3; size=((d[6]&127)<<21)|((d[7]&127)<<14)|((d[8]&127)<<7)|(d[9]&127); end=10+size
fr=[];i=10
while i<end and d[i]:
    fid=d[i:i+4]; fs=int.from_bytes(d[i+4:i+8],'big'); fl=d[i+8:i+10]; body=d[i+10:i+10+fs]
    if fid==b'TIT2': print('old TIT2', body[3:].decode('utf-16-le')); body=b'\x01\xff\xfe'+title.encode('utf-16-le')
    fr.append(fid+len(body).to_bytes(4,'big')+fl+body); i+=10+fs
blob=b''.join(fr); assert len(blob)<=size
out=d[:10]+blob+b'\0'*(size-len(blob))+d[end:]
assert len(out)==len(d) and hashlib.sha1(out[end:]).digest()==hashlib.sha1(d[end:]).digest()
open(dst,'wb').write(out)
print('ok', len(d), len(out), 'tag size', size, 'padding', size-len(blob))
```

Usage (the source may equal the destination; the whole file is read before writing):

```bash
git mv public/assets/music/OLD_ID.mp3 public/assets/music/NEW_ID.mp3
python3 -I <scratchpad>/retitle_tit2.py public/assets/music/NEW_ID.mp3 public/assets/music/NEW_ID.mp3 "NEW_NAME"
# prints: old TIT2 <old title> / ok <len> <len> tag size <n> padding <m>
node generate-songs.js
```

If an assert fails (an ID3v2.4 tag, no room in the padding), stop and inspect the tag rather than
forcing it. Leave every other frame (artist, artwork, source URL) as it is.

### 4.4 Tests to update, delete and add

- **Delete** tests that only test the old theme (Cosmic Chimes: `tests/unit/mobile-wrapper-policy.test.js`,
  74 lines, its DOM-quality policy; deleted in `585ab55`, so it no longer exists). Old `tests/unit/OLD_ID-*.test.js` go with the folder.
- **Retarget** tests that use the old id as an example: `git grep -n "OLD_ID\|OLD_KEY" tests/`.
  *Rainbark:* `tests/unit/mobile-webgl2-validation.test.js:160` used `'cosmic-chimes'` as the
  DOM-artwork exemplar → `'mountain'` (the remaining DOM theme; it must not be the new id, which is
  now a node scene); `tests/unit/theme-music-preferences.test.js:15,99-100` `'CosmicChimes'` →
  `'Rainbark'`.
- **Keep** `tests/unit/odyssey-save-migration.test.js` expectations of raw stamped ids (for
  example `43: 'cosmic-chimes'`): they test the frozen table.
- **Add to** `tests/unit/theme-music-catalog.test.js`: the authored row `['NEW_ID', 'NEW_KEY']`
  in the "preserves the authored … recording" `it.each`, and a case "keeps the key and the theme id
  the NEW_NAME recording had before it was retitled": `getThemeForMusic('OLD_KEY') === 'NEW_ID'`,
  `getThemeMusic('OLD_ID') === getThemeMusic('NEW_ID')`, catalogue keys exclude `OLD_KEY`.
- **Add** `tests/unit/NEW_ID-rename-migration.test.js`, cloned from
  `tests/unit/rainbark-rename-migration.test.js` (or `murmuration-rename-migration.test.js`), with
  `OLD_THEME = 'OLD_ID'`, `OLD_TRACK = 'OLD_KEY'`. Its seven cases:
  1. the registry publishes one id; `resolveThemeId(OLD_ID) === NEW_ID`;
     `getThemeMeta(OLD_ID) === getThemeMeta(NEW_ID)`; display name, module and icon;
  2. the song is retitled and `resolveMusicTrackKey(OLD_KEY) === NEW_KEY`; unknown keys pass through;
  3. `new SettingsManager().load()` heals a saved `backgroundTheme` and `musicTrack` and **writes
     them back**; unrelated settings are untouched;
  4. `resolveOwnedMusicPreference(OLD_KEY, owns(NEW_ID)) === NEW_KEY` (a cloud copy with the old
     key stays owned);
  5. `normalizeThemeCollection` moves a grant `{ source: 'odyssey', levelId: <orb>, earnedAt }` and
     a seen mark from the old id to the new one;
  6. an Odyssey completion saved under the old id resolves, and so does one stamped from the frozen
     table: `snapshotLegacyOdysseyThemes({ completedLevels: { <i>: { stars: 2 } } })` where `<i>` is
     an index at which `V2_LEVEL_THEME_IDS` (`src/core/odyssey/odyssey-progress-schema.js:17-31`)
     holds `OLD_ID` (Cosmic Chimes sits at 43 and 47; Rainbark's test uses 47). If the old id is
     not in the frozen table, drop that half;
  7. the orb carries the new theme, its id, its new name and description, and
     `JSON.stringify(LEVEL_CONFIGS)` has no old id or name.
- **Generic registry-driven tests** exercise the new id with no edit if the invariants hold:
  `odyssey-unique-themes`, `theme-registry-lifecycle-acceptance`, `theme-collection`,
  `development-collection-access`, `theme-capture-orchestrator`, `theme-container-registry`,
  `mobile-webgl2-validation`, `theme-manager-startup-policy`, `odyssey-presentation-sync`,
  `theme-thumbnail-assets`, `agent-skill-mirror`, `event-contract`.

### 4.5 The history rule

Living documents are updated; dated records keep the name they were written with (the rule
`a74a86a` wrote down in `docs/MURMURATION_VISUAL_UPGRADE_2026-10.md:222-227`).

- **Update:** `CREDITS.md`, the orb roster, the soundtrack table, the URL reference,
  `docs/ARCHITECTURE_INDEX.md`, the skill files (both copies), and these concept docs.
- **Keep:** audits, plans, sweeps, logs and evidence under `docs/` (anything named for a date),
  everything in `docs/archive/` and `reports/`, `docs/validation/**`, the fleet record
  `docs/theme-screenshots/results/OLD_ID.json`, and `docs/theme-screenshots/OLD_ID.png` (a
  different theme's picture: do not rename it to the new id; Murmuration renamed its PNG only
  because it was the same theme).
- **Frozen:** `V2_LEVEL_THEME_IDS` keeps the old id ("Frozen from the composed v2 campaign. Never
  derive a legacy award from live metadata."). The alias makes its stamps grant the new theme.

### 4.6 Verification of the rename

```bash
git grep -nI -iE "OLD_ID|OLD_NAME|OLD_KEY" -- . ':!docs' ':!reports'
```

should list only: the `RETIRED_THEME_IDS` row and its comment, the `RETIRED_TRACK_KEYS` row and its
comment, the frozen table in `odyssey-progress-schema.js`, `odyssey-save-migration.test.js`, the
new migration and catalogue tests, and the `CREDITS.md` "titled … until" note. After
`npm run build`, `dist/` should contain `theme-NEW_ID-*.js`, `NEW_ID-theme-icon-*.png`,
`assets/theme-thumbnails/NEW_ID-theme-icon.png` and `NEW_ID.mp3`, and the old id only in the alias
and the frozen table.

Old-save smoke (headless, §5): seed `localStorage['serenityBlocksSettings'] =
{"backgroundMode":"Specific","backgroundTheme":"OLD_ID","musicTrack":"OLD_KEY"}` plus a collection
granting `OLD_ID`; the game should boot into `NewClass` in `#NEW_ID-theme`, play
`./assets/music/NEW_ID.mp3`, and write the settings back as `NEW_ID` / `NEW_KEY`.

---

## 5. Visual verification in a cloud container

A Claude Code cloud container has **no GPU** and the repo's `chrome-devtools` MCP (configured with
the Windows `cmd /c npx` pattern in `.mcp.json`) **does not connect** there. What works is headless
Chromium with SwiftShader (software WebGPU and software WebGL2) driven by Playwright, which is
installed at `/opt/node22/lib/node_modules/playwright` with browsers in
`/opt/pw-browsers/chromium-*/chrome-linux/chrome`. Software rendering is slow (1-5 fps): iterate at
960×540, take acceptance shots at 1920×1080.

Not runnable in a cloud container (they need Electron with a GPU): `npm run capture:themes`
(`scripts/validate-all-themes.mjs`), `scripts/playground-capture.mjs`,
`scripts/playground-phase-capture.mjs`, `scripts/odyssey-webgpu-validation.mjs`. The Electron
binary is not even downloaded (`npm ci --ignore-scripts`).

### 5.1 The dev server

- A Vite dev server may already be running at `http://127.0.0.1:5173`. Check:
  `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/playground.html` → `200`.
- If it is not, start one in the background, logging to your scratchpad:
  `cd <repo> && (npx vite --port 5173 --strictPort --host 127.0.0.1 > <scratchpad>/vite.log 2>&1 &)`.
  (`npm run dev:playground` tries to open a browser; there is none.)
- **Never start a second Vite on the shared `node_modules/.vite` cache.** Two Vite instances
  sharing it corrupt the dependency optimiser and the playground hangs forever on 504s
  (`vite.config.js:78-83` says this has cost three debugging sessions). Any extra server (the phone
  validator starts its own) must get `VITE_CACHE_DIR=<scratchpad dir>`.

### 5.2 Setting up the capture scripts

Save the three scripts below **in your scratchpad, not in the repo** (for example
`<scratchpad>/tools/`). They hard-code the Playwright module path and the Chromium build
(`chromium-1194`). Check both before the first run:

```bash
ls /opt/node22/lib/node_modules/playwright/index.mjs
ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome
# if the build number differs:
sed -i 's#/opt/pw-browsers/chromium-1194/#/opt/pw-browsers/chromium-NNNN/#' <scratchpad>/tools/*.mjs
```

Each script:

- launches Chromium with the flags for the chosen backend (§5.6);
- blocks Vite's HMR websocket (`page.routeWebSocket(/.*/, () => {})`) so a file saved by another
  agent cannot reload the page mid-capture;
- installs the **harness-only swizzle shim** (§5.6) with `page.addInitScript`;
- filters known console noise (`[vite]`, `GL Driver Message`, `WebGPU Context Provider`,
  `ReadPixels`, `Automatic fallback`, `WebGPU is experimental`, `[playground:boot]`) and prints
  everything else.

Then **look at every PNG** with the Read tool (it renders images). A clean console is not proof it
looks right, and a theme can render a uniform colour without a single error.

### 5.3 `shot.mjs`: playground captures

Usage:

```bash
T=<scratchpad>/tools
node $T/shot.mjs --w=960 --h=540 --out=<dir> rest='effect=NEW_ID&t=55&level=4' clear='effect=NEW_ID&t=55&event=clear&lines=3&eventAge=0.75'
node $T/shot.mjs --backend=webgl2 --w=960 --h=540 --out=<dir> rest='effect=NEW_ID&t=55&level=4'   # the WebGL2 backend leg
node $T/shot.mjs --w=390 --h=844 --out=<dir> phone='effect=NEW_ID&t=55&board=1'                   # upright phone
```

Each `NAME='query'` renders `/playground.html?<query>` into `<dir>/NAME.png` in a fresh page and
prints one JSON line: `ok`, `ms`, `backend` (`WebGPU` or `WebGL2`), `error` (the playground's init
error, if any), `diagnostics` (the effect's `getDiagnostics()`, truncated to 600 characters;
`--diagLen=` changes it) and `problems` (filtered console errors and warnings). A shot is clean
only with `ok: true` and `problems: []`. `--settle=` (default 1500 ms) is the wait after
`__PLAYGROUND_READY__`; raise it for heavy effects. The playground's HUD panel is hidden unless
`--hud=1`. Expect 6-20 s per shot at 960×540.

```js
/* global GPUTexture */
// Headless playground capture for this cloud container (no GPU: Chromium + SwiftShader).
//
// Usage:
//   node shot.mjs [--backend=webgpu|webgl2] [--w=1920] [--h=1080] [--dpr=1] [--out=DIR]
//                 [--settle=1500] [--hud=1] [--timeout=300000] NAME='query' [NAME2='query' ...]
// Each NAME='query' renders /playground.html?<query> (add effect=<id> yourself) into DIR/NAME.png.
// Prints one JSON line per shot: {name, ok, ms, backend, error, diagnostics, problems[]}.
// --backend=webgl2 appends forceWebGL=1 to every query.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const opts = {};
const shots = [];
for (const a of process.argv.slice(2)) {
    if (a.startsWith('--')) {
        const [k, ...v] = a.slice(2).split('=');
        opts[k] = v.length ? v.join('=') : true;
    } else {
        const i = a.indexOf('=');
        if (i > 0) shots.push({ name: a.slice(0, i), query: a.slice(i + 1).replace(/^['"]|['"]$/g, '') });
    }
}
const BASE = opts.baseUrl || 'http://127.0.0.1:5173';
const WEBGL = opts.backend === 'webgl2';
const W = Number(opts.w || 1920);
const H = Number(opts.h || 1080);
const DPR = Number(opts.dpr || 1);
const OUT = path.resolve(opts.out || '.');
const SETTLE = Number(opts.settle || 1500);
const TIMEOUT = Number(opts.timeout || 300000);
mkdirSync(OUT, { recursive: true });

const LAUNCH = WEBGL
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
        '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
const NOISE = /\[vite\]|GL Driver Message|WebGPU Context Provider|ReadPixels|Automatic fallback|WebGPU is experimental|\[playground:boot\]/;

const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: LAUNCH });
try {
    for (const shot of shots) {
        const t0 = Date.now();
        const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
        const problems = [];
        page.on('console', (m) => { const t = m.text(); if (!NOISE.test(t) && (m.type() === 'error' || m.type() === 'warning')) problems.push(`${m.type()}: ${t.slice(0, 400)}`); });
        page.on('pageerror', (e) => problems.push(`pageerror: ${String(e.message).slice(0, 400)}`));
        await page.routeWebSocket(/.*/, () => {}); // no HMR reloads mid-capture
        // Harness-only shim: Chromium 141 knows GPUTextureViewDescriptor.swizzle as a dictionary,
        // three r186 sends the identity string 'rgba'. Drop the string so createView() does not throw.
        await page.addInitScript(() => {
            if (typeof GPUTexture === 'undefined') return;
            const original = GPUTexture.prototype.createView;
            GPUTexture.prototype.createView = function createView(d) {
                if (d && typeof d.swizzle === 'string') { const { swizzle, ...rest } = d; return original.call(this, rest); }
                return original.call(this, d);
            };
        });
        let query = shot.query.replace(/^\?/, '');
        if (WEBGL && !/forceWebGL=/.test(query)) query += '&forceWebGL=1';
        const result = { name: shot.name, ok: false, ms: 0, backend: null, error: null, diagnostics: null, problems };
        try {
            await page.goto(`${BASE}/playground.html?${query}`, { waitUntil: 'load', timeout: TIMEOUT });
            await page.waitForFunction(() => window.__PLAYGROUND_READY__ === true || !!window.__PLAYGROUND_ERROR__, null, { timeout: TIMEOUT, polling: 250 });
            const state = await page.evaluate(() => ({ error: window.__PLAYGROUND_ERROR__ || null, backend: window.__PLAYGROUND__?.backend?.() || null }));
            result.backend = state.backend;
            result.error = state.error ? String(state.error).slice(0, 1200) : null;
            await page.waitForTimeout(SETTLE);
            if (opts.hud !== '1' && opts.hud !== true) await page.addStyleTag({ content: '#hud{display:none!important}' });
            await page.waitForTimeout(150);
            await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
            try {
                result.diagnostics = await page.evaluate(() => {
                    const d = window.__PLAYGROUND__?.diagnostics?.();
                    return d ? JSON.parse(JSON.stringify(d, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v))) : null;
                });
            } catch { /* diagnostics optional */ }
            result.ok = !result.error;
        } catch (e) {
            result.error = String(e?.message || e).slice(0, 1200);
            try { await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) }); } catch { /* ignore */ }
        }
        result.ms = Date.now() - t0;
        const diag = result.diagnostics ? JSON.stringify(result.diagnostics).slice(0, opts.diagLen ? Number(opts.diagLen) : 600) : null;
        console.log(JSON.stringify({ ...result, diagnostics: diag, problems: [...new Set(problems)].slice(0, 12) }));
        await page.close();
    }
} finally {
    await browser.close();
}
```

### 5.4 `game.mjs`: the real game

Usage: `node $T/game.mjs --theme=NEW_ID [--backend=webgl2] [--quality=High] --settle=15000 --out=<dir>`.

There is no `?theme=` URL pin. The script seeds saved settings before load
(`localStorage['serenityBlocksSettings'] = { backgroundMode: 'Specific', backgroundTheme: <id>,
effectQuality: <quality> }`), opens `/index.html?skipIntro=1&unlockAll=1&noThemeWarm=1`
(`unlockAll=1`, exactly "1", makes every theme selectable without saving anything; without it an
unowned theme is reset to Forest), waits for `window.serenityBlocks.themeManager` and
`gameModeManager`, writes `menu-<id>.png`, starts single-player mode with
`window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: 'single' } }))`,
calls `themeManager.switchTheme(<id>, true)`, logs the active theme and backend, waits `--settle`
and writes `game-<id>-<backend>.png`, then prints the filtered problems. It takes 40-90 s
(managers ready after 8-15 s, single mode after 10-22 s).

To inject gameplay reactions from a page script, import the same bus module the dev server serves:
`const { eventBus, EVENTS } = await import('/src/events/event-bus.js')`; or press real keys
(`page.keyboard.press('Space')` is a hard drop), as `switch-away.mjs` does.

```js
/* global GPUTexture */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const BASE = args.baseUrl || 'http://127.0.0.1:5173';
const THEME = args.theme || 'serenity-warp';
const WEBGL = args.backend === 'webgl2';
const OUT = args.out || process.cwd();
const LAUNCH = WEBGL
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: LAUNCH });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 240)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e.message).slice(0, 240)}`));
await page.routeWebSocket(/.*/, () => {});
await page.addInitScript(([theme, quality]) => {
  try { localStorage.setItem('serenityBlocksSettings', JSON.stringify({ backgroundMode: 'Specific', backgroundTheme: theme, effectQuality: quality })); } catch {}
  if (typeof GPUTexture !== 'undefined') {
    const original = GPUTexture.prototype.createView;
    GPUTexture.prototype.createView = function createView(d) { if (d && typeof d.swizzle === 'string') { const { swizzle, ...rest } = d; return original.call(this, rest); } return original.call(this, d); };
  }
}, [THEME, args.quality || 'High']);
try {
  await page.goto(`${BASE}/index.html?skipIntro=1&unlockAll=1&noThemeWarm=1${WEBGL ? '&forceWebGL=1' : ''}`, { timeout: 180000 });
  log('loaded');
  await page.waitForFunction(() => window.serenityBlocks?.themeManager && window.serenityBlocks?.gameModeManager, null, { timeout: 300000 });
  log('managers ready', await page.evaluate(() => window.serenityBlocks.themeManager.activeThemeName));
  await page.screenshot({ path: `${OUT}/menu-${THEME}.png` });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: 'single' } })));
  await page.waitForFunction(() => window.serenityBlocks.gameModeManager.getCurrentMode?.()?.isRunning === true, null, { timeout: 300000 });
  log('single mode running');
  const applied = await page.evaluate(async (id) => window.serenityBlocks.themeManager.switchTheme(id, true), THEME);
  log('switchTheme ->', applied, await page.evaluate(() => ({ active: window.serenityBlocks.themeManager.activeThemeName, renderer: window.serenityBlocks.themeManager.activeTheme?.renderer?.backend?.isWebGPUBackend ? 'WebGPU' : (window.serenityBlocks.themeManager.activeTheme?.renderer?.backend?.isWebGLBackend ? 'WebGL2' : null) })));
  await page.waitForTimeout(Number(args.settle || 15000));
  await page.screenshot({ path: `${OUT}/game-${THEME}-${WEBGL ? 'webgl2' : 'webgpu'}.png` });
  log('screenshot written');
} catch (e) { problems.push(`error: ${String(e?.message || e).slice(0, 400)}`); }
finally { await browser.close(); }
console.log('problems', JSON.stringify(problems.filter((p) => !/vite\]|GL Driver Message|WebGPU Context Provider|ReadPixels|Automatic fallback/.test(p)).slice(0, 40), null, 1));
```

### 5.5 `switch-away.mjs`: does switching away leave anything behind?

Usage: `node $T/switch-away.mjs --theme=NEW_ID --to=forest [--backend=webgl2] [--settle=12000] --out=<dir>`.

It boots into the theme, plays four hard drops through the real input path, probes the instance
(active, renderer, world, post, scene, director, lifecycle, diagnostics, canvases in
`#<id>-theme`), switches to another theme, probes again after 6 s, and prints
`VERDICT clean switch-away` or `VERDICT LEAK: …`. Run it on both backends.

```js
/* global GPUTexture */
// Real-game check: boot into a theme, play a little, switch to another theme, and verify the first
// theme left nothing behind (no canvas in its container, renderer/world released, not active).
//   node switch-away.mjs --theme=rainbark --to=forest [--backend=webgl2] [--settle=12000] --out=DIR
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const BASE = args.baseUrl || 'http://127.0.0.1:5173';
const THEME = args.theme || 'rainbark';
const TO = args.to || 'forest';
const WEBGL = args.backend === 'webgl2';
const OUT = args.out || process.cwd();
const SETTLE = Number(args.settle || 12000);
const LAUNCH = WEBGL
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
const NOISE = /vite\]|GL Driver Message|WebGPU Context Provider|ReadPixels|Automatic fallback/;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: LAUNCH });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !NOISE.test(m.text())) problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e.message).slice(0, 300)}`));
await page.routeWebSocket(/.*/, () => {});
await page.addInitScript(([theme]) => {
    try { localStorage.setItem('serenityBlocksSettings', JSON.stringify({ backgroundMode: 'Specific', backgroundTheme: theme, effectQuality: 'High' })); } catch { /* ignore */ }
    if (typeof GPUTexture !== 'undefined') {
        const original = GPUTexture.prototype.createView;
        GPUTexture.prototype.createView = function createView(d) { if (d && typeof d.swizzle === 'string') { const { swizzle, ...rest } = d; return original.call(this, rest); } return original.call(this, d); };
    }
}, [THEME]);

const probe = (id) => page.evaluate((themeId) => {
    const tm = window.serenityBlocks.themeManager;
    const container = document.getElementById(`${themeId}-theme`);
    const inst = tm.themeInstances?.get?.(themeId) || (tm.activeThemeName === themeId ? tm.activeTheme : null);
    const style = container ? getComputedStyle(container) : null;
    return {
        active: tm.activeThemeName,
        containerChildren: container ? container.children.length : null,
        containerCanvases: container ? container.querySelectorAll('canvas').length : null,
        containerVisible: style ? `${style.display}/${style.visibility}/${style.opacity}` : null,
        allCanvases: document.querySelectorAll('canvas').length,
        instanceFound: !!inst,
        instance: inst ? {
            isActive: inst.isActive, renderer: !!inst.renderer, world: !!inst.world, post: !!inst.post,
            scene: !!inst.scene, director: !!inst.director, lifecycle: inst.lifecycleState,
            diagnostics: typeof inst.getDiagnostics === 'function' ? inst.getDiagnostics() : null,
        } : null,
    };
}, id);

try {
    await page.goto(`${BASE}/index.html?skipIntro=1&unlockAll=1&noThemeWarm=1${WEBGL ? '&forceWebGL=1' : ''}`, { timeout: 180000 });
    await page.waitForFunction(() => window.serenityBlocks?.themeManager && window.serenityBlocks?.gameModeManager, null, { timeout: 300000 });
    log('managers ready; active =', await page.evaluate(() => window.serenityBlocks.themeManager.activeThemeName));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: 'single' } })));
    await page.waitForFunction(() => window.serenityBlocks.gameModeManager.getCurrentMode?.()?.isRunning === true, null, { timeout: 300000 });
    log('single mode running');
    log('switchTheme', THEME, '->', await page.evaluate(async (id) => window.serenityBlocks.themeManager.switchTheme(id, true), THEME));
    await page.waitForTimeout(SETTLE / 2);
    // A few hard drops through the real input path, so the director and the world see real events.
    for (let i = 0; i < 4; i += 1) { await page.keyboard.press('Space'); await page.waitForTimeout(400); }
    await page.waitForTimeout(SETTLE / 2);
    const before = await probe(THEME);
    log('before switch-away', JSON.stringify(before));
    await page.screenshot({ path: `${OUT}/switch-${THEME}-${WEBGL ? 'webgl2' : 'webgpu'}-before.png` });
    log('switchTheme', TO, '->', await page.evaluate(async (id) => window.serenityBlocks.themeManager.switchTheme(id, true), TO));
    await page.waitForTimeout(6000);
    const after = await probe(THEME);
    log('after switch-away', JSON.stringify(after));
    await page.screenshot({ path: `${OUT}/switch-${THEME}-${WEBGL ? 'webgl2' : 'webgpu'}-after.png` });
    const leaks = [];
    if (after.active === THEME) leaks.push('still the active theme');
    if (after.containerCanvases) leaks.push(`${after.containerCanvases} canvas(es) left in #${THEME}-theme`);
    if (after.instance && (after.instance.isActive || after.instance.renderer || after.instance.world || after.instance.post || after.instance.scene)) {
        leaks.push(`instance still holds runtime: ${JSON.stringify(after.instance)}`);
    }
    console.log('VERDICT', leaks.length ? `LEAK: ${leaks.join('; ')}` : 'clean switch-away');
} catch (e) { problems.push(`error: ${String(e?.message || e).slice(0, 400)}`); } finally { await browser.close(); }
console.log('problems', JSON.stringify(problems.slice(0, 40), null, 1));
```

### 5.6 Launch flags and the swizzle shim

| Leg | Chromium flags | URL |
|---|---|---|
| WebGPU on SwiftShader | `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader --use-angle=swiftshader --ignore-gpu-blocklist` (`shot.mjs` also passes `--enable-unsafe-swiftshader`) | as is; WebGPU needs a secure context, so use `http://127.0.0.1` or `localhost`, never `data:` |
| WebGL2 backend | `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` | append `forceWebGL=1` (`--backend=webgl2` does it) |

The adapter reports vendor `google`, architecture `swiftshader`. The flags come from
`scripts/capture-breathing-headless.mjs:69-77` and `scripts/capture-breathing-ingame.mjs:47-50`,
which are the repo's own headless templates.

**The swizzle shim (harness only, never in game code).** three r186 passes `swizzle: 'rgba'` (a
string) in its `GPUTextureViewDescriptor`s. The Chromium 141 build in the container
(141.0.7390.37) knows `swizzle` as a dictionary member of another type and throws in
`createView()`. The shim wraps `GPUTexture.prototype.createView` to drop a string `swizzle` before
calling the original. It is identity either way (`'rgba'` is the identity swizzle), so it changes
nothing that is drawn. It belongs in capture harnesses only: the game ships to Electron 38
(Chromium 140) and browsers without it, and the repo's own headless script keeps it in the harness
(`scripts/capture-breathing-ingame.mjs:60-71`, from which it was copied).

### 5.7 Environment quirks that are not bugs in your code (but some are rules)

- **3D textures fail WebGPU validation on this SwiftShader build.** Serenity Warp's
  `Data3DTexture` gas volume produced a per-frame `GPUValidationError` ("TextureViewDimension::e2D …
  not compatible with TextureDimension::e3D of [Texture "serenity-warp-gas"]") and its sky did not
  draw, while its WebGL2 leg was clean. Whether real hardware is fine is unverified; the rule for a
  new theme is: **no `Data3DTexture`, no `texture3D`, no `lut3D`**. Use the Void Ember 2D-lattice
  trick for 3D noise (`u.noise3`, `src/themes/void-ember/void-ember-tsl.js:122-165, 374-381`), a
  2D baked fBm with CPU mips, or arithmetic noise in laid-out pure functions.
- **The theme clock runs slow under software rendering.** Each frame's delta is clamped to
  `MAX_DELTA_S = 0.05`, and SwiftShader manages 1-5 fps, so theme time advances only 5-25% as fast
  as wall time in real-game captures. A `--settle=15000` capture shows less than a second or two
  of theme time. For timed moments use the playground's `t=` and `eventAge=`, or the theme's
  `?newCamelTime=` / `?newCamelFixedDt=` flags.
- **The playground's first frame is the raw scene** (no post). `shot.mjs` waits `--settle` after
  READY; on a heavy effect, raise it or call `window.__PLAYGROUND__.seek(t)`.
- `solar-eclipse` logs `THREE.Clock … deprecated, use THREE.Timer`. Do not use `THREE.Clock` in a
  new theme: compute delta yourself from the rAF timestamp and `lastFrameMs` (§2.2).
- WebGPU-only failures (gotchas #99, #102) and WebGL2-only failures (#89) both exist: **always
  capture both legs.**

### 5.8 The phone validator (`npm run validate:mobile:webgl2`)

`scripts/validate-mobile-webgl2.mjs` (Playwright, not Electron, so it runs in the container)
loads the production theme module in an isolated page with `navigator.gpu` removed
(`?forceWebGL=1&noThemeFpsCap=1`), on an emulated 390×844 phone at DPR 3, quality Low by default:
portrait, then synthetic effects (`PIECE_LOCK`, a four-line `LINE_CLEAR` with combo 5, `COMBO 5`),
then landscape 844×390. It fails on console errors, failed requests, GL or shader warnings, a theme
that is not ready or active, a uniform screenshot, non-finite transforms or attributes, a wrong
quality label, a renderer heartbeat that does not advance, a missing canvas, a DPR over the
ceiling, a drawing buffer that does not follow the viewport, and, for ids in
`MOBILE_WEBGL2_NODE_IDS`, anything but a `WebGPURenderer` on the WebGL2 backend with at least one
node material. It also prints "pass" while its screenshots show blobby sprites (gotcha #147): look
at the PNGs.

**The port blocker.** The validator calls Vite's `createServer` with `server.port: 0` and
`strictPort: true`. Vite 5.4 treats port 0 as "use the default 5173", so whenever a dev server
holds 5173 (it usually does) the validator dies with "Port 5173 is already in use". The fix needs
no repo change: a Node loader hook substitutes a `vite` module whose `createServer` forces another
port, and `VITE_CACHE_DIR` isolates its cache. Save these three files together in one scratchpad
folder (`<scratchpad>/probe/`):

`vite-port-register.mjs`
```js
import { register } from 'node:module';
register('./vite-port-hooks.mjs', import.meta.url);
```

`vite-port-hooks.mjs`
```js
const SHIM = new URL('./vite-port-shim.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === 'vite' && context.parentURL && context.parentURL.includes('validate-mobile-webgl2')) return { url: SHIM, shortCircuit: true };
  return next(specifier, context);
}
```

`vite-port-shim.mjs` (the absolute path is the clone's location in a cloud container; change
`/home/user/serenity-blocks` if your clone lives elsewhere)
```js
// Forces an explicit port: Vite 5.4 treats server.port 0 as "use 5173" (startServer: !configPort -> DEFAULT_DEV_PORT).
import * as real from '/home/user/serenity-blocks/node_modules/vite/dist/node/index.js';
export * from '/home/user/serenity-blocks/node_modules/vite/dist/node/index.js';
export async function createServer(config = {}) {
  return real.createServer({ ...config, server: { ...(config.server || {}), port: Number(process.env.MOBILE_VITE_PORT || 5188) } });
}
```

Invocation (run from the repo root):

```bash
P=<scratchpad>/probe
mkdir -p $P/vite-cache-mobile
VITE_CACHE_DIR=$P/vite-cache-mobile MOBILE_VITE_PORT=5188 \
PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs \
PLAYWRIGHT_EXECUTABLE_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
node --import $P/vite-port-register.mjs scripts/validate-mobile-webgl2.mjs --theme NEW_ID --out <dir>
# then the second pass the precedent records:
#   … scripts/validate-mobile-webgl2.mjs --theme NEW_ID --quality Minimal --out <dir2>
```

Expect `{"id":"NEW_ID","status":"pass","backend":"WebGL2","quality":"Low","failures":[]}` in about
15 s, plus `<dir>/report.json` and portrait, effects and landscape PNGs. Serenity Warp passed this
way in 14 s; Rainbark's frame passed at Low and Minimal.

### 5.9 Montages, crops and reference images

Python 3 with PIL (12.x) and numpy (2.x) is available. A side-by-side montage for a critic:

```bash
python3 - <out.png> a.png b.png c.png <<'EOF'
import sys
from PIL import Image
out, *paths = sys.argv[1:]
ims = [Image.open(p).convert('RGB') for p in paths]
h = min(i.height for i in ims)
ims = [i.resize((round(i.width * h / i.height), h)) for i in ims]
m = Image.new('RGB', (sum(i.width for i in ims), h))
x = 0
for i in ims:
    m.paste(i, (x, 0))
    x += i.width
m.save(out)
EOF
```

Crop at 2× native for detail: `Image.open(p).crop((x0, y0, x1, y1)).resize((2*w, 2*h), Image.NEAREST)`.

**Reference photos.** The playground can overlay a reference (`ref=/playground-refs/x.png&refMode=split`),
but `public/playground-refs/` is **served**, so never commit a photo there unless it is your own or
licence-clear. Keep copyrighted references in the scratchpad, compare with PIL montages, and cite
their source URL in docs instead of copying them (Rainbark's bark references are the photos on
<https://toptropicals.com/catalog/uid/eucalyptus_deglupta.htm>: described in
`docs/theme-concepts/rainbark.md` §10, never copied).

### 5.10 A capture plan per step

For every step, at least:

1. the step's acceptance queries at 1920×1080 on **WebGPU and WebGL2**;
2. one phone portrait 390×844 (`board=1`);
3. one Low or Minimal tier shot;
4. `falseColor=1` once the post exists;
5. for events, an `eventAge` sequence;
6. the `diagnostics` line read back (counts, tier, backend);
7. a montage against the most similar existing themes.

Keep the outputs under the scratchpad; copy only curated finals (as small webp) to
`docs/NEW_ID-captures/` in Stage C.

### 5.11 On a local machine with a GPU

Use the CLAUDE.md loop: `npm run dev:playground`, then the `chrome-devtools` MCP opens
`http://localhost:5173/playground.html?effect=NEW_ID&t=<s>`, waits for
`window.__PLAYGROUND_READY__ === true`, captures the canvas and reads the console. Keep to one
small effect per session (TDR risk on the iGPU). The Electron capture scripts and
`npm run capture:themes` work there too.

---

## 6. Gates and commands

CI (`.github/workflows/pages.yml`, on every pull request and push to main) runs, in order:
typecheck, the TS coverage ratchet, the lint error ratchet, architecture fitness, the theme
lifecycle audit, import boundaries, the unit suite, the perf-budget gate, release gates and the
production dependency audit; then on push the build (with the boot-closure check), the IP-string
gate and the pages-artifact check. The palette check is not in CI but every rebuild records it.

### 6.1 Minimal (every commit; about 2-3 minutes plus lint)

```bash
npm run typecheck
npx vitest run tests/unit/NEW_ID- tests/unit/theme-registry-lifecycle-acceptance.test.js \
  tests/unit/theme-music-catalog.test.js tests/unit/odyssey-unique-themes.test.js \
  tests/unit/url-parameter-catalog.test.js tests/unit/dual-state-theme-tripwire.test.js \
  tests/unit/mobile-webgl2-validation.test.js tests/unit/odyssey-save-migration.test.js \
  tests/unit/theme-music-preferences.test.js tests/unit/theme-collection.test.js \
  tests/unit/development-collection-access.test.js tests/unit/theme-container-registry.test.js \
  tests/unit/theme-capture-orchestrator.test.js tests/unit/murmuration-rename-migration.test.js \
  tests/unit/rainbark-rename-migration.test.js \
  tests/unit/odyssey-difficulty-balance.test.js tests/unit/theme-lifecycle-audit.test.js
npm run audit:theme-lifecycle && npm run check:palette && npm run check:boundaries
node scripts/architecture-fitness-check.mjs
npx eslint src/themes/NEW_ID src/playground/effects/NEW_ID.effect.js --ext .js   # aim for 0 errors in new files
```

`tests/unit/NEW_ID-` matches every file with that prefix, including the migration test. `git add`
new files before trusting `dual-state-theme-tripwire` (it reads tracked files).

### 6.2 Full (before asking to merge; about 12 minutes)

```bash
npm run typecheck                         # ~5.5 s
node scripts/ts-ratchet-check.mjs         # ~0.2 s; 73 @ts-check files = baseline 73
npm run lint:ci                           # ~91 s; fails only if total errors > 807 (610 on 5d3478d, 609 after 585ab55)
node scripts/architecture-fitness-check.mjs   # main.js and OdysseyMode.js are AT their line ceilings
npm run audit:theme-lifecycle             # ~3.8 s
npm run check:boundaries                  # ~7 s; 0 violations
npm test                                  # ~8 min; see baselines below
npm run perf:budgets:gate                 # ~0.3 s
npm run check:release-gates               # ~1.5 s
npm run check:palette                     # not CI; "61 palettes screened, 0 full matches, 1 warnings" (the warning is luminous-tides' legacy format)
npm run build                             # ~40 s; includes check-boot-closure
npm run check:ip-strings                  # after build
npm run check:pages-artifact              # after build
rm -rf dist                               # optional tidy (gitignored)
```

Plus the visual proof (ADR-0007): playground shots on both backends, the real game on both
backends (`game.mjs`), a clean switch-away on both (`switch-away.mjs`), and the phone validator at
Low and Minimal (§5.8). `npm audit --omit=dev --audit-level=high` needs the network and is
unaffected by theme work.

**Baselines we saw.**

| Commit | Unit files | Tests | Time |
|---|---|---|---|
| `main` at `5d3478d` | 817 | 15,506 | 401.8 s alone; 492.8 s with headless Chromium contending |
| `585ab55` (Rainbark's frame and the rename) | 822 | 15,679 | 409.1 s |

A replacement adds files and tests and should never remove passing ones except the old theme's.

### 6.3 What each gate asks of a theme

- **Typecheck / TS ratchet**: opt-in `// @ts-check` (`checkJs: false`); theme files are not in
  `ts-ratchet.json`. Do not add `@ts-check` to a file unless it passes.
- **Lint ratchet**: total errors across `src` ≤ 807. New files should add none.
- **Architecture fitness** (`architecture-fitness.json`, shrink-only): `lines:main` 5642 and
  `lines:OdysseyMode` 4391 are at their ceilings (the check counts `split('\n')`, one more than
  `wc -l`); `new ShaderMaterial(` hits 100/200 and files 13/30, window resize listeners 27/40: a
  theme should add none. Never raise a baseline silently.
- **Theme lifecycle audit** (`scripts/theme-lifecycle-audit.mjs`): `cleanup()`/`stop()` overrides
  call super; no inline `.bind(this)` in add/removeEventListener; rAFs registered; a
  `WebGPURenderer.init()` needs a lifecycle-owned late-retirement path (`initializeRendererCandidate`
  provides it); no async teardown overrides. The cloned adapter passes.
- **Boundaries**: themes are islands (§2.1); no circular imports.
- **Boot closure**: the main chunk's static closure never reaches a `theme-*`, `mode-*`, `phaser`
  or `three` chunk.
- **IP strings**: `public/`, `index.html` and `dist/` must not contain the trademarked words.
- **Palette**: §2.8.

---

## 7. House rules, gotchas and the pitfalls we hit

### 7.1 House rules

1. `MeshBasicNodeMaterial` (or `NodeMaterial` for full-screen passes) everywhere, self-shaded,
   **scene-linear HDR**. No scene lights, no `ShaderMaterial`, no `mx_noise`, no compute (unless the
   concept truly needs it and has a CPU twin for the WebGL2 backend, as Murmuration does).
2. Imports: `import * as THREE from 'three/webgpu'`; every TSL symbol from `'three/tsl'`, including
   `Fn`, `If`, `Loop` (gotcha #64); addons from `three/addons/tsl/display/BloomNode.js`,
   `FXAANode.js`.
3. **One uniform bag `u`** built once; the world writes `.value`, materials only read. Pack tables
   into as few `uniformArray(rows, 'vec4')` as possible (Rainbark has exactly two: `events` with 112
   rows and `palette`); a stage may bind only 12 uniform buffers (#102).
4. **Laid-out pure helpers**: every helper called more than once gets `setLayout` (#81: without it
   the body is re-emitted at every call site), and laid-out helpers capture no textures or uniforms
   (#93, #95); pass values in. Builders that read `u` or textures are plain JS functions inlined in a
   material's `Fn`.
5. **Live event rows compacted** at the front of the table each frame, the count in an int uniform,
   and one TSL `Loop({ start: int(0), end: u.count, type: 'int', condition: '<', name: 'w' }, ({ w }) => …)`
   over them (#110); give nested loops distinct names and read the index under its name (#155).
   Never emit TSL per element in a JS `forEach` (#101).
6. **Instanced quads** through `InstancedBufferGeometry` with one `InstancedInterleavedBuffer` per
   pool (WebGPU allows 8 vertex buffers, #99); clip-space placement in `vertexNode`; integer-coded
   per-instance data decoded with `floor(x + 0.5)` (#87, #88).
7. **Every pool always drawn**, dormant slots at zero size; nothing created at event time; the
   scene's child count fixed after build.
8. **Render order**: solids first, the sky/backdrop last among opaque with `depthTest: true,
   depthWrite: false` (#100); additive FX after. Set `renderOrder` on meshes, not on groups (#139).
   Premultiplied "over" FX: `CustomBlending` One / OneMinusSrcAlpha, `vec4(rgb, 0)` adds,
   `vec4(rgb·a, a)` occludes (#90).
9. **Textures are 2D and baked on the CPU** at build; half-float mips built on the CPU (GPU half-float
   mips are not portable to every WebGL2 device); half-float render targets on WebGL2 need
   `EXT_color_buffer_float` or `_half_float` (check like Serenity Warp's `supportsFloatTargets`).
   No downloads.
10. **One scene pass, bloom, one output pass**; tone map once; calm zones over cards and HUD;
    features gated in JS per tier.
11. **Both backends** for every capture; gate on renderer kind (ADR-0019).
12. **Photosensitivity** (no setting exists; self-impose WCAG 2.3.1): flashes only on four lines
    and perfect clears, never on a lock or a combo step; small area; never pure `#FFFFFF`, never
    red-adjacent full field; at most 3 flashes per second, so combine event lights with `max()`
    and exponential decay, never by summing; clamp HDR hue-preservingly before bloom. The board
    itself already flashes on big clears (`shared-effects.js` `_screenFlash`), so a theme flash
    stacks on it.
13. **Reduced motion**: camera punch, kick and shake to 0, parallax off, flights shortened, ambient
    drift ×0.3-0.5 (siblings' values; the concept file sets its own).
14. **Readability first**: nothing crosses the card or HUD; lanes outside them; calm zones on.
15. **Determinism**: `seek(t)` plus fixed steps reproduces any frame; integrated phases wrapped;
    springs sub-stepped (Serenity Warp at 1/120 s).

### 7.2 Gotcha digest (`#NN` = line in `.claude/skills/webgpu-threejs-tsl/SKILL.md`)

| # | Symptom | Rule |
|---|---|---|
| 63 | deprecation warning | `new THREE.RenderPipeline(renderer)`, never `PostProcessing` |
| 64 | `X is not defined` | import every TSL identifier from `'three/tsl'` |
| 65-66 | geometry collapses or is misplaced | compute from `positionGeometry`, output `positionLocal.add(displacement)`; never `positionNode = buffer.element(instanceIndex)` |
| 67-68 | a branch reads zeros / reassignment ignored | `.toVar()` + `.assign()` or `select()`; root-pin shared nodes with a bare `.toVar()` before any `If` |
| 69 | whole module fails to compile | `smoothstep(a, a, x)` with **equal** edges is a hard WGSL error (reversed edges are fine in shaders) |
| 71 | a region goes black, often only on a tall portrait screen | `exp(k · signedDistance)` overflows (1e8); bound every term: `exp(max(d, 0).mul(-k))`; capture portrait early |
| 72 | a "disabled" feature still costs | multiplying by a 0 uniform is not eliminated; gate in JS |
| 73 | uploads every frame | in-place mutation of a uniform `Color`/`Vector` |
| 80 | one pipeline takes seconds to compile | `mx_noise_float` / `mx_fractal_noise_*`: 20 evaluations took 7.3 s; use the simplex port in `odyssey-tsl-noise.js`, value noise or a baked texture |
| 81 | 100+ KB shaders | an `Fn` without `setLayout` is inlined at every call site (a 20-call simplex fragment was 113 KB) |
| 87-88 | per-instance seeds flicker | interpolated varyings have last-bit noise: store integers, `floor(x.add(0.5))`; bias exact divisions `floor(q.add(0.02))` |
| 89 | `'addToStack' "VarNode.build()"` on **WebGL2 only** | a `select()` nested in another with `Fn` calls inside; fold into one `select(a.and(b), v, f)` with `v` built as `.toVar()` |
| 90-91 | additive part writes alpha / opaque alpha forced to 1 | premultiplied blending with `vec4(rgb, 0)`; write `fragmentNode` for real alpha |
| 93, 95 | `unresolved value 'nodeUniformN'` | a laid-out `Fn` captured a texture or uniform; keep helpers pure |
| 94 | whole frame black (NaN spread by bloom) | `pow` of a base a hair below zero; clamp cosines; write small powers as products (Schlick as products) |
| 96 | 14 s freeze after ready | pipeline count: one per mesh per pass (Sakura Twilight had 200); cut passes, not materials |
| 99 | mesh never draws on WebGPU (WebGL2 does) | more than 8 vertex buffers; use interleaved instance buffers |
| 100 | sky shades every pixel | draw the dome/backdrop last among opaque, depth test on, depth write off |
| 101 | 135 KB `main()` with 974 private vars | JS `forEach` emitting TSL per element; one `Loop` over a `uniformArray` |
| 102 | validation fails after splitting data into many arrays | 12 uniform buffers per stage; pack into one vec4 array |
| 103 | streaky, veiled shafts | limit emitters to the light's neighbourhood, length ≈ 0.7, taper the last steps, two short marches |
| 104 | serrated edges from baked fBm | read at `.level(2.0)` |
| 105 | MSAA sparkles on thin strips | clamp every interpolated coordinate |
| 110 | stale or garbage rows | `uniformArray` copies whatever objects you give it: compact live rows, pass the count, loop to it |
| 112 | colours judged wrong | judge colour only through the tone-mapped pipeline |
| 113 | mirrored lookups | a render target's v = 0 is its **top** row on both backends; `QuadMesh` uv runs down |
| 114 | feedback artefacts | nothing may sample a target in the pass that writes it |
| 116 | confetti | narrow `smoothstep` on fBm; wide ramps and `exp(-tau)` |
| 117 | a part captured alone is black | additive parts write `vec4(rgb, 0)`; keep one opaque part in the frame (`parts=sky,…`) or the post on |
| 120 | particles blow out | budget total additive light per tier (count × area × exposure) |
| 122 | bright points get red or yellow cores after the output pass | a `T·T·(3 − 2T)` S-curve folds channels above 1 back down; `clamp()` to 0..1 before any polynomial curve |
| 129 | haze in-scatter on solids | opaque things: `depthWrite: true` + a small `alphaTest` |
| 134 | event lights vanish at speed | the bloom knee follows the iris; multiply event lights by the inverse iris |
| 135 | flat, bright surface only on low tiers | dropping an octave by substituting 0.5 makes `1 − abs(2n − 1)` exactly 1; drop the term in JS |
| 136 | need 3D noise without a 3D texture | the 2D-lattice trick (Void Ember) |
| 139 | render order ignored | three sorts by a group's order first; leave groups at 0 |
| 144 | lock effects never seen | they were behind the card; aim from the card's edge outward |
| 147 | stars are blobs on a phone, specks on 4K | author sizes for a reference frame, floor at about a buffer pixel |
| 149 | the hero light reads pale | keep the band round it under 1 after exposure, low green in saturated lights, whiten only the hottest, threshold above the brightest sky; look at false colour first |
| 153 | discs become ellipses near the edge | draw round things in the lens's image plane, not in direction space |
| 159 | 3D pieces built as four rounded cubes read as "four bits" (the user asked for solid colour back) | build each shape once as a fused solid, shade it as polished solid colour (`createShapeGeometry`/`matchShape` in `serenity-warp-glass.js`) |

r186 lifecycle notes from the skill: `compileComputeAsync` lives in
`src/rendering/webgpu-compute-pipeline-async.js`; `await renderer.dispose()` before releasing a
device; no `PCFSoftShadowMap` (use `PCFShadowMap`).

### 7.3 Pitfalls we hit in this session

1. **The hero material looked like stained glass.** Rainbark's spec described the bark as an
   anisotropic Voronoi atlas. Prototyped on the CPU first, it read as stained glass and tie-dye
   (every texel in a coloured polygon, straight edges, uniform cells). Thresholded fBm contours made
   topographic outlines; pointed lozenge splats made candy feathers. The sixth version, **ribbon
   splats** (16-22 tall ribbons per 4.8×14 m tile laid over a cool slate matrix covering 30-45%,
   with two-scale ragged edges), matched the photos. Lesson for every concept: **prototype the hero
   material on the CPU (numpy/PIL in the scratchpad) and compare it side by side with real photos
   before writing a shader.** Write down what makes the real thing read as itself (Rainbark's notes
   are in `docs/theme-concepts/rainbark.md` §10) and judge against that list.
2. **3D textures.** See §5.7. A concept that says "3D noise" means the 2D-lattice trick.
3. **The OdysseyMode line ceiling.** Adding `NEW_ID` on a new line to the `heavyThemes` sets broke
   architecture fitness (`lines:OdysseyMode` 4391). Swap an id in place or leave the sets alone;
   Rainbark left them alone.
4. **A capture that silently ran at the wrong tier.** The first real-game probe hard-coded
   `effectQuality: 'Low'` in the seeded settings, so "High" captures were Low. `game.mjs` takes
   `--quality` (default High). Always read the tier back from the diagnostics or the theme's log
   line (`[NEW_NAME] Scene ready (<backend>, <quality>)`) before judging a capture.
5. **`THREE.Clock` is deprecated** in r186 and warns on the console (Solar Eclipse does). Compute
   delta from the rAF timestamp and the theme's own `lastFrameMs`.
6. **The phone validator and the port.** §5.8.
7. **A second Vite on the shared cache.** §5.1. It looks like a hung playground, not an error.
8. **The tripwire reads tracked files.** A new theme folder that is not `git add`ed is invisible to
   `dual-state-theme-tripwire`.
9. **CPU bakes cost start-up time.** Rainbark's leaf-lace bake was too slow in A2 and was sped up
   in the fix round; time every bake in Node and profile with `node --cpu-prof` when one grows.
10. **Concept numbers are proposals.** The concept files' amended sections already fix the
    weaknesses the judges named; still, the picture is decided by screenshots and the critic, not
    by the numbers in a spec.

---

## 8. A ready-to-paste prompt for the new session

If `docs/theme-concepts/README.md` (the index of this folder) carries its own starter prompt,
either works; this is the long form. Fill in the two angle-bracket fields and paste it as the
first message of a new Claude Code session on this repository:

```text
Build the theme concept <docs/theme-concepts/CONCEPT.md> as a real theme of Serenity Blocks.

Read, in this order, before writing any code:
1. CLAUDE.md, docs/ARCHITECTURE_INDEX.md and docs/adr/ (ADR-0007, 0011, 0016, 0018, 0019 and
   0020 bind theme work).
2. docs/theme-concepts/PLAYBOOK.md, the shared procedure. Follow it; it wins over habit.
3. The concept file named above. Follow its "How to use this file" box and its precedence rule
   (the amended sections override the original proposal; its build plan already folds them in).
4. .claude/skills/webgpu-threejs-tsl/SKILL.md, especially the gotcha table ("#NN" in these docs is
   a line number there).
5. src/themes/serenity-warp/ and src/themes/rainbark/ with their tests, as the code templates.

Then, before Stage 0, stop and ask me:
- Which existing theme this replaces (PLAYBOOK §1a, recommended; show me the candidates table and
  your top three with reasons), or whether to add it as a new theme (§1b, needs a campaign change).
- Any decision the concept file marks as mine (the name, open questions), and confirm that the
  song keeps the replaced theme's audio under the new title.
Slot preference, if I already know it: <ask me | replace OLD_ID | add as new>.

Working rules:
- Work on a new branch from main (PLAYBOOK §0). Commit after each step of PLAYBOOK §3 (Stage 0a core
  and palette, Stage 0b scaffold and rename then integrate, Stage A environment steps, Stage B
  effects one beat per step, Stage C post/tiers/phone/icon/docs, then the final adversarial
  review). Do not push to main.
- Playground first. No WebGPU/TSL step is done without screenshots on both backends (WebGPU and
  forceWebGL=1), a clean console, the effect's diagnostics read back, and a low-tier shot. Look at
  every image yourself. In a cloud container use the headless Chromium + SwiftShader tools in
  PLAYBOOK §5 (save the scripts in your scratchpad, never in the repo).
- Each environment step goes through an independent critic and a fix round before it is committed.
- Prototype the hero material on the CPU and compare it with reference photos before the shader
  (PLAYBOOK §7.3). Never commit copyrighted reference images; cite their URL instead.
- Run PLAYBOOK §6.1 before every commit and §6.2 before asking to merge.
- No 3D textures, no ShaderMaterial, no mx_noise, no downloads, no window resize listeners, no
  net new lines in src/main.js or src/core/game-modes/OdysseyMode.js.
- Never write the trademarked name of the original falling-block game or its piece name anywhere.
- If a step needs new audio or any asset you cannot make in code, stop and ask me.
- After each step, report: what was drawn, the screenshot paths, the gate results, and the next step.
```

To **continue Rainbark** rather than start a concept from scratch, use the ready-to-paste prompt in
`docs/RAINBARK_HANDOVER_2026-10.md` §8 instead (Rainbark is merged; its slot is decided).
