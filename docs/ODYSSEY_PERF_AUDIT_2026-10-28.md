# Odyssey performance audit, 2026-10-28: what changed and how to check it on a GPU

Branch `claude/odyssey-performance-audit-hc6m94`. A static audit with no GPU. It has since been
checked on an RTX 5080 laptop: see "Checked on a GPU" at the end. Where a commit gives CPU timings they come from Node on a cloud runner and
are relative only (ADR-0016). Scope was Odyssey only: the map, its chapters, the orbs and the
transitions. No theme file changed.

Every commit was gated by the unit suite, the type-check, the lint and TS ratchets, the dependency
rules and architecture fitness. At `24d8090` the full suite was 1,241 files and 23,374 tests green.
Visual output is meant to be unchanged everywhere, except where the player's own graphics settings
now reach the map (item 8).

## What changed

| # | Commit | Change | Compare with | What to look at on a GPU |
|---|--------|--------|--------------|--------------------------|
| 1 | `d27772f` | The map opens on the next orb to play, built around it (it opened at orb 1 while everything built before the reveal followed the frontier). | — | The opening frame for saves at chapters 1, 3 and 6: no pop-in, the right music, no glide after the reveal. |
| 2 | `46937f3` | An orb's surfaces (well, queue, board, stats; the map's overlay on a return) are painted under the portal gate, not on the frames it opens on. | — | Entry and return: nothing appears late or unstyled as the gate opens; the panel on return is as a fresh one. |
| 3 | `4db8be2` | The One World bake is kept for the session and, in production builds, across launches (IndexedDB), and starts as the mode activates. | `?odysseyNoBakeCache=1` | Second launch of a production build: trace event `world-bake landed (kept)`; the map looks the same. |
| 4 | `5aaab1b` | Leaving Odyssey tears the One World down; a parked board gives back its post targets while an orb plays; chapters 6 and 7 share one sky texture. | — | GPU memory on the map, during an orb and after leaving; the first frames of chapters 6 and 7 after a return. |
| 5 | `9322036` | The map is not drawn under the opaque navigator or charm guide, and honours a hidden window's pause or reduce. | — | Open and close the navigator: GPU use drops while it is open, and no stale frame shows on close. |
| 6 | `c90373c` | Chapter 8's lightning is one steady stroke under Reduce flashing. | the setting | Chapter 8 with the setting on and off. |
| 7 | `5152d11` | Charm icon slots hidden behind the navigator are not drawn. | — | Icons reappear at once when the navigator closes. |
| 8 | `3a20b91` | Render Scale and Anti-aliasing reach the map, live; a new tier rebuilds the map on the next return. | Settings | Change each on the map and during an orb. A packaged build whose desktop policy picked a scale under 1 now renders the map at that scale, as the themes do. |
| 9 | `6e80955` | Chapters compile before they are seen again; a glide waits up to 250 ms for its destination's compile. | `?odysseyGlideCompileMs=0` | Glides into chapters 6–8: no pop-in on WebGPU, no stall on WebGL2. |
| 10 | `d8af373` | Chapter builds made on the live map run a few milliseconds a frame (startup under the cover still builds in one go). Same output, by fingerprint. | `?odysseyOneGoBuilds=1` | No freeze when a chapter builds after the reveal, while scrolling into a preload window, or before a long glide. |
| 11 | `34fd321` | Charm icons compile before their first frame, on the map's shared GPU device. | — | Icons go live after the reveal without a stall, on WebGPU and the WebGL2 fallback. |
| 12 | `a99a2ec` | The map's light rig has the 4 slots its built chapters use, not 9 (9 again with `?odysseyOneWorld=0`, which builds the old chapter 2–5 scenes). | — | Chapter 1's lit rock and creatures look the same. |
| 13 | `2aeca52` | Chapter 7's black-hole shadow skips the warp tunnel and fold until the portal opens. | — | The approach and the fall look the same; no WebGPU validation errors in the console. |
| 14 | `f0fcb2d` | Chapter 1's lake noise is kept across launches and started with the world's bake; the reveal waits up to 1 s for it. | `?odysseyNoBakeCache=1`, `?earthCoreLakeBake=0` | The lake is never flat at the reveal; trace span `lake` (`odyssey:lake` in the Performance panel). |
| 15 | `9aad48f` | Odyssey's code warms at the menu like the other modes (not in Windows safe mode). | — | Time from Play to the map. |
| 16 | `79e153e` | The map takes input as its loading cover fades (the cover swallowed the first wheel or click for 800 ms). | — | Scroll or click during the fade. |
| 17 | `24d8090` | Theme guesses (hovered orb, the picked orb's neighbours) wait for a still map, never overlap another theme load, and never push the picked orb's theme out of the cache. | — | Hover and pick orbs, during and after glides: no hitch. |

On item 17, a theme "load" is the theme's module import plus its constructor (only one theme has a
non-empty `init()`). Once a theme's code is in memory, loading it again after an eviction is cheap.
So the main gain is keeping the first load of each theme's code off glides, scrolls and the
return's reveal. How much that is per theme needs measuring.

## Measuring on the GPU machine

Use a production build for anything about load times: the kept bakes only work there, and dev
servers have no build hash.

1. **Startup.** Watch the console for `[OdysseyStartup] board visible …ms after overlay show`, and
   for the `[OdysseyStartup]` summary line the board prints when it finishes initialising. Run one
   launch to fill the store, then a second, and compare the trace events
   `world-bake landed (kept)` with `(worker)`, and the `lake` span. Run with
   `?odysseyNoBakeCache=1` for the no-store baseline.
2. **Map smoothness.** `?odysseyGpuProfile=1` publishes GPU frame-time percentiles and draw calls
   to `window.__ODYSSEY_GPU_PROFILE__`. Record the Performance panel while you scroll into chapter
   6, pick a far orb in the navigator, and glide from chapter 1 to 8. Compare long tasks with and
   without `?odysseyOneGoBuilds=1`.
3. **Entry and return.** Record an orb entry and return. Read the console's
   `[OdysseyPerf] odyssey-return-board-ready: …ms` line, and check there are no long tasks on the
   frames the gate opens on.
4. **GPU memory.** Read dedicated GPU memory in Task Manager on the map, during an orb (the parked
   board gives its post targets back) and after leaving Odyssey.
5. **Settings.** Change Render Scale and Anti-aliasing on the map. Change the tier during an orb and
   return: the map rebuilds under the gate.
6. **Screenshots** (CLAUDE.md), each against the branch base at the same spot: chapter 1's rock,
   creatures and lake at the reveal, chapter 7's approach, portal and fall, and the charm icons in
   the map header after the reveal. Read the console for WebGPU validation errors each time.

## Left for later, and why

- **Splitting the chapters into their own chunks.** All chapters and the Infinity ascent stage
  share one ~350 KB chunk. Splitting it risks import-order and cycle breakage, and its cost should
  be measured first (Startup, above).
- **Medium and Low tiers.** "As good as possible" needs frame times per tier on real GPUs to tune
  against.
- **Warming the GPU device, or starting the world bake, from the menu.** Both trade menu-time work
  against Play time; measure first.
- **An atlas cache for the orb icons.** Low value for its cost.

## For the theme work (not changed here: theme files were out of scope)

Every theme activation queues the theme manager's preload of the next theme in its rotation
(`ThemeManager._publishActivatedTheme` → `queueAdjacentThemePreload` → `preloadNextTheme`, at
idle, within 1.5 s). That includes each Odyssey orb entry. So about a second into an orb, the
manager imports and constructs a theme the orb does not use, and it takes the cache's one free
slot. Odyssey has no use for the rotation. A theme-side way to opt out while Odyssey's theme scope
is active would remove that load.

**Done (branch `fix/odyssey-orb-no-rotation-preload`).** `queueAdjacentThemePreload` does nothing
while an orb holds the theme (`isOdysseyThemeScopeActive()`), and a preload queued before the orb
began is dropped when it fires. Checked on the GPU (below): entering orb 18 (Summer) loaded Tornado
0.8 s in. Only orbs 18 and 56 were affected, because every other orb's next rotation theme is on
the heavy list, which the preload already skips. Tests: `tests/unit/odyssey-orb-no-rotation-preload.test.js`.

## Checked on a GPU, 2026-10-28

**Setup.** RTX 5080 Laptop in Lenovo Performance mode (175 W GPU limit, not Balanced's 80-95 W
cap). The branch merge `968d16b` against its base `390fc49`, both production builds with
`VITE_DEV_HARNESS=1` served by `vite preview`. Electron 44.9.3 in an off-screen 1707x1067 window
(DPR 1.5, the player's 2560x1600 at 150 %), High tier, WebGPU on the NVIDIA adapter. Each
launch used a fresh profile; a second launch reused it. The display presents at ~178 fps, so a
frame over 33 ms is a visible hitch. Other sessions shared the GPU: single timings move by
~100-200 ms, so read the patterns, not the last digit. About 50 launches in all, and no WebGPU
validation error or page error in any console.

**Startup** (`odyssey:mode:board-init`, ms; the cover then fades for ~870 ms more):

| Save's next orb | Base opens at | Base 1st / 2nd launch | Audit opens at | Audit 1st / 2nd launch |
|---|---|---|---|---|
| 13 (chapter 3) | orb 1 | 1,430-1,600 / 820-850 | orb 13 | 1,950-2,210 / 1,520-1,560 |
| 3 (chapter 1) | orb 1 | 1,690 / 1,390 | orb 3 | 1,540 / 1,140 |
| 39 (chapter 6) | orb 1 | 1,710 / 1,380 | orb 39 | 1,790 / 1,310 |

- Item 1 holds: the audit opens on the save's next orb with its chapter built, and the camera
  stays there (the base opened at orb 1 and drifted). Opening in chapter 3 costs ~0.6 s more than
  the base's chapter 1 opening because the One World's materials are built before the reveal; the
  base built them after its reveal, while it showed chapter 1.
- Item 3 holds: a second launch reads the kept bake (`world-bake landed (kept)`, world 75-90 ms
  against ~330 ms). With `?odysseyNoBakeCache=1` the same launch takes ~250 ms longer.
- Item 14: the lake noise had landed before every chapter 1 reveal (span `lake` 0 ms).
- Not a cache miss: three r186 names an unnamed buffer uniform `NodeBuffer_<global node id>`, so a
  small instanced mesh's WGSL differs from launch to launch (24 modules in the base, 51 when the
  audit opens in chapter 3). A patch with stable names made every module identical between
  launches but left the second launch's compile time unchanged (906-928 ms against 890-916), so it
  was not kept.

**Map smoothness.** After the background prewarm (~5 s after the reveal), glides 1->58 and
58->13 and a wheel scroll from orb 30 into chapter 7 had no frame over 33 ms in either build.
Glides started 0.3 s after the reveal (the save's orb -> 58 -> 1 -> 39, two launches each): the
base had 2 frames over 50 ms on the first leg (~91 ms), the audit 1 (94-103 ms), the audit with
`?odysseyOneGoBuilds=1` 1-2 (90-97 ms). One task of ~85-90 ms inside three.js, about 0.9 s into
that first glide, is what remains; the later legs were smooth in every build.

**Navigator (item 5).** Map renders in 2 s: closed ~1,270-1,310 in both builds; open, base the
same, audit 0. A capture 60 ms after closing shows a live frame, nothing stale.

**Entry and return (item 2).** Orb 13 entry took 3.3-3.5 s in both, the audit with no frame over
100 ms (the base had one, 119 ms, on a first launch). Return: `odyssey-return-board-ready`
640-660 ms in both, no frame over 33 ms.

**GPU memory (item 4)**, dedicated MB of the GPU process, two runs each:

| | Menu | Map | In orb 13 | Map after return | 13 s after leaving |
|---|---|---|---|---|---|
| Base | 590 | 945 | 1,114-1,119 | 1,009-1,019 | 1,111-1,123 |
| Audit | 588-590 | 986-995 | 1,114-1,132 | 1,010-1,023 | 1,089-1,106 |

After leaving, the audit holds 17-22 MB less. Neither returns to the menu's level: the menu
theme is loaded again and the orb's theme (Golden Forest) stays in the theme cache's second
slot.

**Settings (item 8).** Render Scale reaches the map live in the audit (0.6: canvas 2158x1342 ->
1295x805, back at 1); the base ignores it. Antialiasing and the tier take effect at the next
return (`needsQualityRebuild()` reads `antialiasing` / `tier`), as the code intends. A tier
change to Medium during an orb rebuilt the map at Medium on the return (no MSAA; the base kept
High): the return took 3.8 s, its hitches all before the map was revealed. Open: a 2.6 s long
animation frame began right after that tier change, while the orb still played (likely the orb's
theme reacting to the new tier); not looked into.

**Screenshots (items 6, 12, 13).** Matched stations, base and audit side by side: chapter 1 at
10/45/80 % (rock, creature, lava, haze), chapter 7 at 10-99 % (warp, rooms, hypercubes, portal,
neon-grid exit) and chapter 8's start look the same; the openings show the lake and the charm
header in place.
