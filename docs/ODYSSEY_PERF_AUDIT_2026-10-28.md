# Odyssey performance audit, 2026-10-28: what changed and how to check it on a GPU

Branch `claude/odyssey-performance-audit-hc6m94`. A static audit with no GPU: nothing below has been
seen on a real device. Where a commit gives CPU timings they come from Node on a cloud runner and
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
