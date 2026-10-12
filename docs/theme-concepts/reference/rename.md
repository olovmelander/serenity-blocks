# Rename / removal surface: retiring `cosmic-chimes`, introducing NEWID

> **Snapshot taken at commit 5d3478d (main, 2026-10-11) during the Rainbark design; line numbers drift, verify against the current code.**
>
> Part of `docs/theme-concepts/`: the index is [`../README.md`](../README.md) and the shared build procedure is [`../PLAYBOOK.md`](../PLAYBOOK.md). PLAYBOOK wins where the two disagree; it was written later and folds in what the Rainbark build learned.
>
> **This checklist has been executed.** It was carried out for `cosmic-chimes` → `rainbark` in commit `585ab55` ("Replace Cosmic Chimes with Rainbark: the theme's frame and the rename"), so `cosmic-chimes` no longer exists: it survives only in `RETIRED_THEME_IDS` (aliased to `rainbark`), `RETIRED_TRACK_KEYS` (`CosmicChimes` → `Rainbark`), the frozen V2 save table and dated records. Keep this file as the worked example. For the next replacement use the generalised version, PLAYBOOK §4 "Rename and retire checklist" (placeholders `OLD_ID`, `NEW_ID`, …), and re-derive every line number with `git grep -n` against the theme you are replacing. `git show --stat 585ab55` lists every file the Rainbark rename touched.
>
> In the text below, NEWID / NEWNAME / NewKey were `rainbark` / `Rainbark` / `Rainbark`, and orb 47 "Singularity Gate" became "The Painted Giants".

Placeholders: **NEWID** (kebab id, must match `/^[a-z0-9][a-z0-9-]{0,79}$/`), **NEWNAME** (display name),
**NewClass** (`<NewName>Theme`), **NewKey** (track key = `NEWNAME.replace(/\s+/g, '')`), **newCamel**
(URL-flag prefix, e.g. `sunset`, `serenityWarp`). Line numbers are for `main` @ 5d3478d.

## 0. Decisions (recommended answers)

| Question | Recommendation | Why |
|---|---|---|
| Alias old id? | **Yes**: `['cosmic-chimes', 'NEWID']` in `RETIRED_THEME_IDS` | Orb 47 keeps its slot, so a player who earned/selected Cosmic Chimes keeps the orb-47 reward, saved background, owned song; the frozen V2 table (still stamps `cosmic-chimes`) keeps meaning something. Matches a74a86a. Alternative (no alias, bioluminescence-2 precedent) works too: `ThemeCollectionService.getThemeStatus` then shows "Replay Odyssey orb 47 · NAME to collect its new theme." but a saved background silently falls back to Forest and the owned track is lost. Side effect of alias: the old `seenThemeIds` mark carries over, so no "NEW" badge. |
| Song | **Retitle** the authored recording: `cosmic-chimes.mp3` -> `NEWID.mp3`, ID3 TIT2 -> NEWNAME, track key `CosmicChimes` -> NewKey, `RETIRED_TRACK_KEYS` entry | Exactly what a74a86a did; keeps catalog counts (61 total / 31 authored / 30 placeholder) in `theme-music-catalog.test.js:24-31`. Audio stays the Cosmic Chimes recording; no music generation is available (CLAUDE.md), so flag to the user. Lower-risk alternative (Parhelion/Ocean precedent): keep `['Cosmic Chimes', 'cosmic-chimes.mp3']` under NEWID — no migration, but the old name stays in the Music tab. |
| Orb | Keep **orb 47** (authored id 47 -> public 47, `campaign-order.js:4-9`), chapter 6, between `solar-eclipse` and `black-hole` | Moving the orb means reordering `chapters.js` primary list + orb positions + save identities. Rename orb + rewrite both descriptions. Chapter 6 is "Space & Cosmic Expanse"; orb 47 is a `release` beat (`levels.js:4105`), so a non-space theme reads as a "pocket of quiet" before the singularity. |
| Group | Change `group: 'cosmic'` to a non-cosmic group (`biomes`=Nature, `atmospheric`, `sky`, `fantasy`, `abstract`; labels `ThemesTab.js:48-57`) | User asked for less space; no test counts groups. |
| Container | **Static div path** (replace the cosmic div in place + 1 small CSS rule) | See section 4. |
| Heavy GPU | Add NEWID to `HEAVY_GPU_THEME_IDS` | Cosmic Chimes was `light`/`startupEligible`. Light pool shrinks to 6 (mountain, tornado, moonlit-greenhouse, nebula-flow, voltage-storm, moonrise-summit); no test counts it. |

## 1. a74a86a (Electric Dreams V3 -> Murmuration): every non-theme-folder change

| File | Change | Why |
|---|---|---|
| `src/themes/theme-registry.js` | entry in place: id/displayName/module/icon (`./murmuration/murmuration-theme.js`, `./murmuration/murmuration-theme-icon.png`); `HEAVY_GPU_THEME_IDS` id swap; `RETIRED_THEME_IDS` += `['electric-dreams-v3', 'murmuration']` with doc paragraph | `resolveThemeId` is used by settings load, theme-collection grants/seen marks, Odyssey completions, theme manager switch (`theme-manager.js:946,1540`), music catalog |
| `src/core/progression/theme-music-catalog.js` | `AUTHORED_SONGS` key/title/file; bpm block key; NEW `RETIRED_TRACK_KEYS` Map + exported `resolveMusicTrackKey()`; `getThemeForMusic` resolves through it | Track key derives from song title, so a retitle needs a key alias |
| `src/ui/settings.js` | import `resolveMusicTrackKey`; `sanitizedMusicTrack` healed on load; `musicTrackChanged` triggers write-back | Old save heals once and persists |
| `src/core/progression/music-preference.js` | `resolveOwnedMusicPreference` resolves key first | Steam cloud copy with old key stays owned |
| `src/audio/sound-manager.js` | `setTrack(requestedTrack)` -> `resolveMusicTrackKey` | Any caller holding an old key |
| `public/assets/music/electric-dreams.mp3` -> `murmuration.mp3` (R099) | git mv + TIT2 frame rewritten | Same length (8,257,973 B); ID3v2.3 tag size kept at 15283 by growing padding 4096 -> 4104 (UTF-16 title 15 -> 11 chars = 8 B). TIT2 body `\x01\xff\xfe` + UTF-16LE. WOAS (suno URL), TPE1, APIC untouched; SHA-1 of audio after tag unchanged |
| `public/assets/music/songs.json` | regenerated with `node generate-songs.js` (entry moves to its alphabetical slot by name) | `theme-music-catalog.test.js` asserts `shippedManifest == buildSongsManifest(files, [])` |
| `src/core/game-modes/OdysseyMode.js` | both `heavyThemes` sets: `'electric-dreams'` (long-dead id) -> `'murmuration'` | Behaviour fix: +0.9 s / +0.8 s blackout budget |
| `src/core/odyssey/data/chapters.js` | chapter 7 `themes.primary` id swap | must equal orb order (`odyssey-unique-themes.test.js:35-42`) |
| `src/core/odyssey/data/levels.js` | overlays (2 places) id swap; orb 54 `name` -> 'Murmuration'; `primary`; base `metadata.description`; `LEVEL_PHASE2_OVERRIDES` description | Phase-2 override is the live text; both edited |
| `src/core/odyssey/theme-presentation.js` | colour row removed and re-added alphabetically (`murmuration: '#00f5ff'`) | palette must be non-null for every orb theme (`odyssey-unique-themes.test.js:62`) |
| `src/ui/serenity-hub/ThemesTab.js` | fallback glyph map: `'Electric Dreams': 'bolt'` -> `Murmuration: 'spiral'` | keyed by `displayName` (old key never matched "Electric Dreams V3") |
| `index.html` | `#electric-dreams-v3-theme` -> `#murmuration-theme` (+ comment) | static container |
| `scripts/lib/mobile-webgl2-validation.mjs` | `MOBILE_WEBGL2_NODE_IDS` id swap | phone matrix |
| `src/ui/url-parameters/playground-parameters.js` | new `iconY` entry; effect added to scopes+sources of every param it reads; removed `electric-dreams-fluid` from `noPost`/`quality` | `url-parameter-catalog.test.js` (sources must exist; literal `params.get` reads must be catalogued) |
| `src/playground/effects/electric-dreams-fluid.effect.js` D, `murmuration.effect.js` A | effect id follows theme id | vite `manualChunks` puts `<themeId>*.effect.js` into `theme-<id>` chunk |
| `src/events/gameplay-events.js`, `cosmic-expanse.js`, `odyssey-tsl-pipeline.js`, starlight/winter/sky-children-v2/serenity-warp files, `intro-*.js` | comments naming the theme/its files | "forked from" provenance comments follow the rename |
| `tests/unit/event-contract.test.js` | 3 `KNOWN_VIOLATIONS` rows removed | dead file paths |
| `tests/unit/portable-showcase-post.test.js`, `theme-async-resource-retirement.test.js`, `theme-music-catalog.test.js` | imports/labels/expectations follow; catalog test adds "keeps the key and theme id ... before it was retitled" | |
| `tests/unit/murmuration-rename-migration.test.js` (new, 7 tests) | registry publishes one id + old resolves; song retitled + old key resolves; settings heal + write-back; owned-music via old key; collection grant/seen carried; Odyssey completion (saved + frozen-table stamp at orb 54) resolves; orb name/description + `JSON.stringify(LEVEL_CONFIGS)` has no old name | template for NEWID |
| renamed tests `electric-dreams-*.test.js` -> `murmuration-*.test.js` | | |
| `CREDITS.md` | song list: removed "Electric Dreams", added `Murmuration (titled "Electric Dreams" until October 2026)` | |
| `docs/ODYSSEY_60_ORB_CAMPAIGN_2026-10.md`, `docs/THEME_MUSIC_PROGRESSION_2026-10.md` | roster row / soundtrack row updated | living tables (updated despite the date in the name) |
| `docs/URL_PARAMETER_REFERENCE.md` | count line | manual; compute with the node one-liner in section 8 |
| `docs/ARCHITECTURE_INDEX.md` | new Reference row for the record doc | |
| `.agents/` + `.claude/skills/webgpu-threejs-tsl/SKILL.md` | 3 gotcha rows, both copies | `agent-skill-mirror.test.js` enforces identical copies |
| `docs/theme-screenshots/electric-dreams-v3.png` -> `murmuration.png` (R100); `results/electric-dreams-v3.json` kept | same theme, so the picture moved; the fleet-run record kept its old name | |
| `public/assets/themes/electric-dreams-theme-icon.png` D, `murmuration-theme-icon.png` A | public mirror replaced (byte-identical to src icon) | |

**History rule a74a86a followed** (record `docs/MURMURATION_VISUAL_UPGRADE_2026-10.md:222-227`): audits, plans,
sweeps, logs, evidence captures under `docs/`, everything in `docs/archive/` and `reports/`, `docs/validation/**`,
and the recorded fleet run `docs/theme-screenshots/results/<old>.json` keep the name they were written with.
Living docs (CREDITS, the orb roster, the soundtrack table, URL reference, ARCHITECTURE_INDEX) are updated. Frozen
save tables keep the old id. Confirmed: `electric-dreams-v3` still appears in `ODYSSEY_UNIQUE_THEME_CHAPTER_AUDIT_2026-10.md`,
`MOBILE_THEME_WEBGL2_AUDIT_2026-10.md`, `THEME_FLEET_SWEEP_2026-08.md`, `docs/validation/**.json`, `reports/**`.
Built-game check in that record: the old id survives only twice (retired alias + frozen table) and the old key once.

## 2. Every `cosmic[-_ ]?chimes` hit (case-insensitive, excl. node_modules/.git; 37 files, all git-tracked)

### Must-remove (obsolete theme code/DOM/CSS/tests)
| Hit | Action |
|---|---|
| `src/themes/cosmic-chimes/cosmic-chimes-theme.js` (15 hits; class `CosmicChimesTheme`, `super('cosmic-chimes')`, DOM ids `chimes`, `space-dust`, `cosmic-chimes-effects`, `.chime-nebula`) | git rm |
| `src/themes/cosmic-chimes/cosmic-chimes-tetrominos.js` (`COSMIC_CHIMES_TETROMINOS`, used only by the theme's `getTetrominoConfig()` at :663) | git rm (NEWID ships its own `NEWID-tetrominos.js`) |
| `src/themes/cosmic-chimes/cosmic-chimes-theme-icon.png` (512x512 RGBA, identical to public copy) | git rm |
| `public/assets/themes/cosmic-chimes-theme-icon.png` (not referenced by any code) | git rm; add `public/assets/themes/NEWID-theme-icon.png` (copy of src icon) per a74a86a |
| `index.html:285-294` `#cosmic-chimes-theme` with `.chime-nebula`, `#space-dust`, `#chimes`, `#cosmic-chimes-effects` | replace (section 4) |
| `public/styles/main.css:2967-3426` (comment `/* --- Cosmic Chimes Theme --- ... */` through the blank line after `.chime.chime-struck::after {}` at 3422-3425; Singing Bowl starts 3427) | delete all 460 lines. Selectors: `#cosmic-chimes-theme`, `.chime-nebula`, `#space-dust`, `.dust-particle`, `@keyframes dust-float`, `#chimes`, `.chime`, `.chime::after`, `@keyframes shimmer-chime`, `.chime.chime-struck`, `#cosmic-chimes-effects`, `.chime-strike`, `@keyframes chime-strike-glow`, `.sound-wave`, `.sound-wave-ring`, `.sound-wave-simple`, `@keyframes sound-wave-expand-simple`, `@keyframes sound-wave-expand`, `.stardust-burst`, `@keyframes stardust-fly`, `.aurora-wave`, `@keyframes aurora-wave-flow`, `.harmonic-pulse`, `@keyframes harmonic-pulse-anim`, `.celestial-sparkle(::before/::after)`, `@keyframes celestial-sparkle-anim`, `.piece-lock-chime`, `@keyframes piece-lock-chime-anim`, `.piece-lock-sparkle-chimes(::before/::after)`, `@keyframes piece-lock-sparkle-chimes-anim`, `.chime-nebula.nebula-pulse`, `.chime.chime-struck::after`. Verified no other user: grep of src/public/index/tests/scripts finds 0 uses outside the theme. `.aurora-wave` is ALSO defined at `main.css:2799` (dead, no JS creates it) and `@keyframes aurora-wave` at 2640 is a different, live name (used at 2597): leave those. `slow-rotate-3d` (used at 2983) is defined nowhere: it goes with the block. |
| `tests/unit/mobile-wrapper-policy.test.js` (4 hits; the whole file is 2 Cosmic Chimes DOM-quality tests importing the theme) | git rm (NEWID's own tier tests replace it) |

### Must-change (code/data/tests)
| Hit | Edit |
|---|---|
| `src/themes/theme-registry.js:143-147` | entry -> `id: 'NEWID'`, `displayName: 'NEWNAME'`, `module: './NEWID/NEWID-theme.js'`, `icon: './NEWID/NEWID-theme-icon.png'`, `group: '<non-cosmic>'` (keep position 142-148) |
| `src/core/progression/theme-music-catalog.js:19` | `'cosmic-chimes': ['Cosmic Chimes', 'cosmic-chimes.mp3']` -> `NEWID: ['NEWNAME', 'NEWID.mp3']` (retitle) |
| `public/assets/music/songs.json:86-93` | regenerate (`node generate-songs.js`); entry becomes `{name: NEWNAME, file: NEWID.mp3, path: ./assets/music/NEWID.mp3, themeId: NEWID, trackKey: NewKey, placeholder: false}` at its alphabetical slot |
| `public/assets/music/cosmic-chimes.mp3` | git mv -> `NEWID.mp3`, rewrite TIT2 (section 7, step 6) |
| `src/core/odyssey/theme-presentation.js:12` | remove `'cosmic-chimes': '#7ce8ff'`; add NEWID with its key colour in alphabetical position (mandatory: test requires a palette per orb theme) |
| `src/core/odyssey/data/chapters.js:230` | `'cosmic-chimes'` -> `'NEWID'` (same index, chapter 6 list at 227-231) |
| `src/core/odyssey/data/levels.js:3132` | `primary: 'NEWID'` (+ 3124 name, 3134 transitionIn, 3185-3186, 4729-4730; see checklist) |
| `src/ui/serenity-hub/ThemesTab.js:302` | `'Cosmic Chimes': 'chime'` -> `'NEWNAME': '<glyph>'` (section 5) |
| `tests/unit/mobile-webgl2-validation.test.js:160` | `cleanResult('cosmic-chimes')` -> `cleanResult('mountain')` (the remaining DOM-artwork theme: `runtime-audit.json` lists only forest/mountain/cosmic-chimes as `rendererKind: "DOM"`, and `mountain-theme.js` has no three import). Passes either way, but keeps the test honest. |
| `tests/unit/theme-music-preferences.test.js:15` | `'CosmicChimes'` -> `'NewKey'` (an unowned track; still passes with the old key via the alias) |
| `tests/unit/theme-music-preferences.test.js:99-100` | `'CosmicChimes'` -> `'NewKey'` (arbitrary non-default key in the intro test) |
| `CREDITS.md:167` | drop "Cosmic Chimes ·" from its slot; insert `NEWNAME (titled "Cosmic Chimes" until October 2026)` at its alphabetical slot (only if the song is retitled) |
| `docs/ODYSSEY_60_ORB_CAMPAIGN_2026-10.md:154` | `\| 47 \| NEWNAME (\`NEWID\`) \| <one-line role> \|` |
| `docs/THEME_MUSIC_PROGRESSION_2026-10.md:152` | `\| 47 \| NEWNAME \| \`NEWID.mp3\` \| Existing \|` |

### Keep-as-history (dated records; a74a86a rule)
`docs/theme-screenshots/cosmic-chimes.png` (precedent: `bioluminescence-2.png`, `sky-children-v2.png` kept for retired ids; do NOT rename it to NEWID.png because it shows a different theme), `docs/theme-screenshots/results/cosmic-chimes.json` (23 hits), `docs/validation/mobile-theme-webgl2/runtime-audit.json:3306-3307`, `docs/validation/mobile-theme-webgl2/phone-quality-low.json:4243`, `reports/theme-perf/switch-log-mine-2026-08-21.json:1098,1112,1113`, `docs/MOBILE_THEME_WEBGL2_AUDIT_2026-10.md:21,66`, `docs/ODYSSEY_UNIQUE_THEME_CHAPTER_AUDIT_2026-10.md:142,192`, `docs/THEME_FLEET_SWEEP_2026-08.md:243,589`, and all of `docs/archive/2026-06-repository-cleanup/*` (THEME_EXTRACTION_SUMMARY:22,54; suno-music-prompts:17; suno-music-prompts-v2:17; GAME_THEMES_SUMMARY:97; THEMES_VISUAL_GUIDE:100; SERENITY_HUB_PHASE_3_COMPLETE:110; SERENITY_HUB_PHASE_4_COMPLETE:120; REORGANIZATION_STATUS:204; PHASE_4_COMPLETION_SUMMARY:58; INTRO_ANIMATION_WEBGPU_UPGRADE_PLAN:385).

### Frozen tables / alias (old-save compatibility): keep the old id
- `src/core/odyssey/odyssey-progress-schema.js:26,27`: `V2_LEVEL_THEME_IDS` indices 43 and 47 = `'cosmic-chimes'`. **Keep.**
- `tests/unit/odyssey-save-migration.test.js:79` `43: 'cosmic-chimes'` ("freezes the original composed themes"). **Keep.**
- NEW alias rows (section 7, steps 4-5): `RETIRED_THEME_IDS` `['cosmic-chimes', 'NEWID']`, `RETIRED_TRACK_KEYS` `['CosmicChimes', 'NewKey']`.
- Target end state (built game): `cosmic-chimes` only in the retired-id alias and the frozen table, `CosmicChimes` only in the retired-key alias (+ tests and dated records).

## 3. (c) Frozen tables

`V2_LEVEL_THEME_IDS` (`odyssey-progress-schema.js:17-31`, comment "Frozen from the composed v2 campaign. Never
derive a legacy award from live metadata.") is used by `snapshotLegacyOdysseyThemes()` (:63-73) to stamp v1/v2
completions with the theme of their time. **Yes, frozen: keep `cosmic-chimes`** (a74a86a kept
`electric-dreams-v3` at index 54 on purpose). The stamped id becomes a grant through
`ThemeCollectionService._collectFromProgress()` (`theme-collection-service.js:221-266`, `add()` ->
`this.resolveThemeId(rawId)` + `knownIds` guard). So **without the alias** those stamps (v2 orbs 43->v4 44 and 47->47) grant
nothing. With the alias they grant NEWID silently on boot (reconcile, `silent: true` = marked seen). The test
`odyssey-save-migration.test.js:69-91` asserts raw stamped ids (`themeIds: ['cosmic-chimes']`) and stays as is.
`V3_TO_V4_LEVEL_IDS` is id-only (no theme). The new migration test should assert
`getOdysseyCompletionThemeIds(snapshotLegacyOdysseyThemes({completedLevels:{47:{stars:2}}}).completedLevels[47]).map(resolveThemeId)`
equals `['NEWID']`. Note: the v2 doc must go through `migrateOdysseyProgressData` for v4 ids; the Murmuration test
called `snapshotLegacyOdysseyThemes` directly on index 54, so the same direct call works on index 47.

## 4. (d) Container path: static div vs lazy

- Static: `index.html:229` `.background-container` (CSS `main.css:298-306`: fixed, `z-index:-1`) holds `#background-canvas` (z 10)
  and every static `.theme-container` (z 1, opacity 0 -> `.active` 1, 2.5 s fade, `main.css:325-356`).
  Static-div themes among the recent rebuilds: sunset (`index.html:239`), ocean (236), starlight (301), solar-eclipse (423),
  stellar-velocity (375), stellar-drift (378), murmuration (360). Each keeps a 2-4 line `#<id>-theme { background:<clear colour>; overflow:hidden; }`
  rule (Sunset: `main.css` "Sunset Theme (the lantern sea ...)" `background:#0b0a14`). Sunset precedent (38c31ab) replaced 13 DOM
  children with `<!-- 3D canvas dynamically added by SunsetTheme -->` and deleted 978 CSS lines.
- Lazy: serenity-warp, parhelion, chiral-gold never had a div or CSS. `ensureThemeContainer()` (`theme-registry.js:551-593`,
  called at `theme-manager.js:1220` and `:1607`) creates `div#<id>-theme.theme-container` with inline fixed/z -1/pointer-events none,
  inserted as `document.body.firstChild`, OUTSIDE `.background-container`. Its own comment: static divs stay because
  "stacking order against `background-canvas` is the risk". There is also no clear colour behind the canvas during the fade.
- **Recommendation: static path.** Replace `index.html:285-294` in place with
  `<div id="NEWID-theme" class="theme-container">` / `<!-- WebGPU canvas dynamically added by NewClass -->` / `</div>`, and replace
  `main.css:2967-3426` with `/* --- NEWNAME Theme (<one line>: a WebGPU canvas, src/themes/NEWID/) --- */ #NEWID-theme { background: #<scene clear colour>; overflow: hidden; }`.
  Same stacking as most siblings, zero new risk, clear colour matches the renderer clear while the first frame compiles. `theme-container-registry.test.js` ("works for every registered theme id") passes either way. The theme should do what parhelion/serenity-warp do at start: `document.getElementById(\`${this.name}-theme\`)`, `replaceChildren()`, `appendChild(renderer.domElement)`.

## 5. (e) Icon pipeline

1. Source: `src/themes/NEWID/NEWID-theme-icon.png`, **512x512, 8-bit RGBA PNG, non-interlaced** (all 61 current icons are exactly this;
   murmuration 401 KB, sunset 267 KB). Convention: subject in a circle on a transparent ground (`scripts/process_icons.py` = centre-crop +
   ellipse alpha mask). Murmuration recipe: playground `?effect=<id>&quality=Ultra&hud=0&t=<s>&icon=1` in a 720x720 window on WebGPU,
   colour lift (sat 1.22, contrast 1.14, brightness 1.08), baked as a 512 px circle; checked at the picker's 80 px beside neighbours
   (`docs/<theme>-captures/icon*.webp|jpg`). The effect needs an `icon=1` authored camera pose (+ optional `iconFov/iconX/iconY`, catalogued in playground-parameters).
2. Registry `icon: './NEWID/NEWID-theme-icon.png'`: must end in `.png` (desktop thumbnail plugin skips others) and match the hub glob
   `import.meta.glob('../../themes/**/*-theme-icon.{png,svg}')` (`theme-thumbnail-manifest.js:4`; resolver `src/rendering/odyssey/theme-icon-resolver.js` matches by relative path then filename).
   Used by ThemesTab, ThemeCollectionView:326, MusicTab:234, JourneyFlowOverlay:65, ThemeUnlockReward:51 and Odyssey orb icons.
3. Build: `createThemeThumbnailAssetPlugin` (`scripts/theme-thumbnail-assets.js`, wired at `vite.config.js:95`) emits
   `assets/theme-thumbnails/NEWID-theme-icon.png` from the registry path (warns if missing); desktop hub reads it via
   `resolveDesktopHubThemeThumbnailUrl` (`theme-thumbnail-manifest.js:32-39`). Nothing to commit there.
4. `public/assets/themes/NEWID-theme-icon.png`: a byte-identical mirror, **referenced by no code** (grep: zero refs). The precedent keeps it (a74a86a
   added murmuration's, sunset/ocean/solar-eclipse/starlight/stellar-* updated theirs; serenity-warp/parhelion/halcyon-apex/vesper have none). Add it, and git rm `cosmic-chimes-theme-icon.png`.
5. Fallback glyph (`ThemesTab.getThemeFallbackIconName`, :283-331, used only when no icon URL): key = **displayName**, value = a
   `src/ui/components/cosmic-icons.js` key. Available: wave moon leaf tree flower cloud mist bolt flame star burst gem butterfly sprout breath
   aurora-dreams sacred-geometry moonlit-waters solar-flare crystal-prism volcanic-fire ocean-tide zen-garden ancient-forest electric-storm
   mountain snowflake sun sunrise rain droplet aurora galaxy spiral island temple city bamboo wolf fish jellyfish bowl chime lantern candle palette
   (plus UI glyphs). Fallback is `'palette'`. The `chime` glyph (`cosmic-icons.js:110`) becomes unused: leave it (generic icon set).
6. Theme tests in the precedent assert `existsSync(path.join(themesDir, entry.icon))` (`serenity-warp-theme.test.js:433-438`).

## 6. Things NEWID adds that Cosmic Chimes never had (from the 7 recent rebuilds: 7d63e51, 36cdf48, 38c31ab, 94f4e23, 95bf306, a42621f, a68611d)

- `HEAVY_GPU_THEME_IDS` (`theme-registry.js:431-486`) += `'NEWID'`.
- `scripts/lib/mobile-webgl2-validation.mjs:14-21` `MOBILE_WEBGL2_NODE_IDS` += `'NEWID'` (WebGPURenderer + WebGL2 backend + node materials required); optionally `MOBILE_WEBGL2_SMOKE_IDS` (:6-11).
- `src/ui/url-parameters/theme-parameters.js:64-186` `captureThemes` row `['NEWID', 'newCamel', 'NEWNAME', '<part1, part2, ...>']` at its alphabetical slot. It generates `newCamelForceWebGL/Time/FixedDt/Parts/FalseColor` with sources `src/themes/NEWID/NEWID-theme.js` and **`src/themes/NEWID/NEWID-world.js`**: both files must exist (`url-parameter-catalog.test.js:16-34`).
- `src/ui/url-parameters/playground-parameters.js`: add `src/playground/effects/NEWID.effect.js` to scope string + `sources` of every param the effect reads; new entries for new names. `url-parameter-catalog.test.js:42-77` fails on any uncatalogued literal `params.get('x')`.
- `docs/URL_PARAMETER_REFERENCE.md:8` count + a "The NEWNAME rebuild added ..." paragraph (Sunset at :75-79 is the template; "the theme it replaces read nothing from the URL, so no reader was retired" also holds for Cosmic Chimes).
- Optional: `OdysseyMode.js:1036-1043` and `:1086-1093` `heavyThemes` += `'NEWID'` (only if start-up is slow; a74a86a did it for murmuration).
- Record `docs/NEWID_..._2026-10.md` + `docs/NEWID-captures/` + `docs/ARCHITECTURE_INDEX.md` row; optional SKILL.md gotcha rows in BOTH `.agents/skills/webgpu-threejs-tsl/SKILL.md` and `.claude/skills/webgpu-threejs-tsl/SKILL.md` (mirror test).
- Fleet capture: `npm run capture:themes -- --theme NEWID` writes `docs/theme-screenshots/NEWID.png` + `results/NEWID.json` (Sunset and Solar Eclipse refreshed theirs).

## 7. Ordered checklist

1. Branch from `main` (5d3478d).
2. **Theme folder**: `git rm -r src/themes/cosmic-chimes/` (theme.js, tetrominos.js, icon); create `src/themes/NEWID/` with `NEWID-theme.js` (default export `NewClass extends BaseTheme`, `super('NEWID')`, `getTetrominoConfig()`), `NEWID-world.js`, `NEWID-tetrominos.js`, `NEWID-theme-icon.png`, plus the effect `src/playground/effects/NEWID.effect.js`.
3. `src/themes/theme-registry.js:143-147`: entry (id, displayName, module, icon, group non-cosmic). `:431-486`: add `'NEWID'` to `HEAVY_GPU_THEME_IDS`.
4. `src/themes/theme-registry.js:509-517`: append doc paragraph ("`cosmic-chimes` was replaced by NEWNAME (2026-10-xx) at the same Odyssey orb: a saved selection, an earned collection entry and an Odyssey completion that name the old id now mean NEWNAME.") and the Map row `['cosmic-chimes', 'NEWID'],`.
5. `src/core/progression/theme-music-catalog.js:19`: `NEWID: ['NEWNAME', 'NEWID.mp3'],` (keep the line position or move it, order is irrelevant). `:66-73`: update doc comment + `['CosmicChimes', 'NewKey'],`. Optional comment touch `src/ui/settings.js:529-530`. No code change needed in `settings.js`, `music-preference.js` or `sound-manager.js` (already resolve through `resolveMusicTrackKey`).
6. Song file: `git mv public/assets/music/cosmic-chimes.mp3 public/assets/music/NEWID.mp3`, then rewrite TIT2 keeping file length (the current tag: ID3v2.3, size 9177, TIT2 29 B = `\x01\xff\xfe` + "Cosmic Chimes" UTF-16LE, WOAS `https://suno.com/song/79a63b28-...`, TPE1, APIC 4927 B, padding 4096; no ID3v1). Script (stdlib only):
   ```python
   import hashlib,sys; src,dst,title=sys.argv[1:4]; d=open(src,'rb').read()
   assert d[:3]==b'ID3' and d[3]==3; size=((d[6]&127)<<21)|((d[7]&127)<<14)|((d[8]&127)<<7)|(d[9]&127); end=10+size
   fr=[];i=10
   while i<end and d[i]:
       fid=d[i:i+4]; fs=int.from_bytes(d[i+4:i+8],'big'); fl=d[i+8:i+10]; body=d[i+10:i+10+fs]
       if fid==b'TIT2': body=b'\x01\xff\xfe'+title.encode('utf-16-le')
       fr.append(fid+len(body).to_bytes(4,'big')+fl+body); i+=10+fs
   blob=b''.join(fr); assert len(blob)<=size
   out=d[:10]+blob+b'\0'*(size-len(blob))+d[end:]
   assert len(out)==len(d) and hashlib.sha1(out[end:]).digest()==hashlib.sha1(d[end:]).digest()
   open(dst,'wb').write(out)
   ```
   Then `node generate-songs.js` (it throws if `NEWID.mp3` is missing) to regenerate `public/assets/music/songs.json`.
7. `src/core/odyssey/theme-presentation.js:12`: delete the cosmic row; add `NEWID: '#xxxxxx'` (or `'NEWID': ...` if hyphenated) alphabetically.
8. `src/core/odyssey/data/chapters.js:230`: `'cosmic-chimes'` -> `'NEWID'`.
9. `src/core/odyssey/data/levels.js`: `:3124` `name: 'Singularity Gate'` -> NEWNAME (a74a86a named the orb after the theme) or another evocative name; `:3132` `primary: 'NEWID'`; `:3134` `transitionIn: 'warp'` (consider `'crossfade'` for a non-space theme); `:3185-3186` base description/tip ("Enter the gate to singularity..." / "The black hole pulls at everything - stay centered."); `:4729-4730` phase-2 override description/tip (the live text: "The gate to singularity opens into a rare pocket of quiet. Re-center before the final pull."). Keep mechanics/victory/stars unchanged. `JSON.stringify(LEVEL_CONFIGS)` must not match `/cosmic-chimes|Cosmic Chimes/`.
10. `src/ui/serenity-hub/ThemesTab.js:302`: `'NEWNAME': '<glyph>'` (quote the key if it has a space).
11. `index.html:285-294`: static container (section 4).
12. `public/styles/main.css:2967-3426`: delete; insert the 1-rule NEWID block in its place.
13. Public icon mirror: `git rm public/assets/themes/cosmic-chimes-theme-icon.png`; add `public/assets/themes/NEWID-theme-icon.png` (cmp-identical to src).
14. `scripts/lib/mobile-webgl2-validation.mjs:14-21`: add `'NEWID'` to `MOBILE_WEBGL2_NODE_IDS`.
15. `src/ui/url-parameters/theme-parameters.js:64-186`: captureThemes row; `src/ui/url-parameters/playground-parameters.js`: effect sources/scopes + new entries.
16. Tests: `git rm tests/unit/mobile-wrapper-policy.test.js`; `tests/unit/mobile-webgl2-validation.test.js:160` -> `'mountain'`; `tests/unit/theme-music-preferences.test.js:15,99,100` -> `'NewKey'`; leave `tests/unit/odyssey-save-migration.test.js:79`; add `tests/unit/NEWID-rename-migration.test.js` (clone of `murmuration-rename-migration.test.js`: OLD_THEME `cosmic-chimes`, OLD_TRACK `CosmicChimes`, frozen-table orb **47**, grant `levelId: 47`; registry/meta, music retitle + `resolveMusicTrackKey`, settings heal + write-back, owned-music via old key, collection grant + seen mark, Odyssey completion saved + stamped, orb name + no old name in `LEVEL_CONFIGS`); add to `theme-music-catalog.test.js` the `it.each` authored row `['NEWID', 'NewKey']` + "keeps the key and theme id ... before it was retitled" case (`getThemeForMusic('CosmicChimes') === 'NEWID'`, `getThemeMusic('cosmic-chimes') === getThemeMusic('NEWID')`, catalog keys exclude `CosmicChimes`); NEWID theme/world/effect tests incl. `existsSync` icon check.
17. Living docs: `CREDITS.md:167` (song list), `docs/ODYSSEY_60_ORB_CAMPAIGN_2026-10.md:154`, `docs/THEME_MUSIC_PROGRESSION_2026-10.md:152`, `docs/URL_PARAMETER_REFERENCE.md:8` (+ paragraph), `docs/ARCHITECTURE_INDEX.md` (new row), new record doc + captures, optional SKILL.md rows (both copies).
18. Leave untouched: everything listed under "Keep-as-history" and the frozen V2 table.
19. Optional: `OdysseyMode.js:1036-1043`, `:1086-1093` heavyThemes; `npm run capture:themes -- --theme NEWID` for `docs/theme-screenshots/NEWID.png` + `results/NEWID.json`.

## 8. Verification

- `grep -rnI --exclude-dir=node_modules --exclude-dir=.git -iE "cosmic[-_ ]?chimes" . | grep -v -e '^./docs/' -e '^./reports/'` should list only `theme-registry.js` (alias + comment), `theme-music-catalog.js` (retired key + comment), `odyssey-progress-schema.js:26-27`, `odyssey-save-migration.test.js:79`, the new migration/catalog tests, `CREDITS.md` ("titled ... until") and the Cosmic Chimes alias note in `settings.js` if one is added.
- URL ref counts: `node --input-type=module -e "import {URL_PARAMETER_CATALOG as c} from './src/ui/url-parameters/catalog.js'; console.log(new Set(c.map(e=>e.name)).size, c.length)"` (today 654 / 691, matches doc line 8).
- Suites most likely to break: `theme-music-catalog`, `theme-music-preferences`, `odyssey-unique-themes` (60 unique orb themes, chapter list == orb order, palette non-null, icon truthy, `registry.validateAll()` clean), `odyssey-presentation-sync`, `theme-container-registry`, `url-parameter-catalog`, `mobile-webgl2-validation`, `agent-skill-mirror`, `event-contract`, `theme-thumbnail-assets`, new `NEWID-rename-migration`.
- Gates (as run by a74a86a): `npm test`, `npm run typecheck`, `npm run lint:ci`, `npm run audit:theme-lifecycle`, `npm run check:boundaries`, `npm run build` (boot-closure), `npm run check:ip-strings`, `npm run check:pages-artifact`, `npm run check:release-gates`; in `dist/` expect `theme-NEWID-*.js`, `NEWID-theme-icon-*.png`, `assets/theme-thumbnails/NEWID-theme-icon.png`, `NEWID.mp3`, and `cosmic-chimes` only twice / `CosmicChimes` once.
- Old-save smoke: localStorage `serenityBlocksSettings` = `{backgroundMode:'Specific', backgroundTheme:'cosmic-chimes', musicTrack:'CosmicChimes'}` + a collection granting `cosmic-chimes` -> boots into `NewClass` in `#NEWID-theme`, plays `/assets/music/NEWID.mp3`, settings written back as NEWID/NewKey.
