# Online Multiplayer Layout Overhaul — Quadra-Inspired Board Proportions

**Status: Option 1 Phases 1–3 SHIPPED (2026-06-24).** Researched against Quadra
(`C:/Users/olovm/repositories/quadra/source`) + the current Serenity online-MP layout via a
4-agent workflow; root-cause formula verified by direct read. Phases 1–3 implemented + live-verified
(see "Implementation status" at the bottom). Phase 4 (polish/responsive) still open.

> **The problem (user report + screenshot, spectator view):** the main/spotlight board renders
> tiny (~140px) while opponent boards are huge (stacked, full panel height) — inverted
> proportions, and board edges/frames aren't always fully visible. Applies to the main board,
> opponent boards, and spectator boards.

---

## 1. Problem diagnosis — why "more important board = smaller"

The container is a correctly-*sized* 3-column grid, but the board *inside* the center column
never grows, while the opponent column always stretches its boards to fill. Four root causes:

**(A) The main board is hard-capped at 280px, independent of column width.** *(verified)*
`src/core/game-modes/OnlineMultiplayerMode.js:1787-1791`:
```js
const boardWidth = Math.min(
    Math.max(180, window.innerWidth * 0.20),
    280,                                // <-- hard ceiling, the core bug
    (window.innerHeight - 180) / 2.2
);
const boardHeight = boardWidth * 2;
```
At 1920×1080 → `min(384, 280, 409) = 280px` wide / 560px tall. At 2560×1600 → still `280px`.
The center column is `minmax(360px, 1fr)` (`multiplayer-ui.css` ~1989) ≈ 1060px wide at FHD — so
the board uses ~280px of ~1060px and leaves ~390px of dead space each side. The 280 ceiling was
inherited from local/single-player (which centers two side-by-side boards) and is simply wrong
for a wide `1fr` center column.

**(B) The center column centers, it doesn't fill.** `.main-board-panel` uses
`width: max-content; margin: auto` and `.online-main-board` is `box-sizing: content-box` with a
fixed `width: var(--board-width); height: var(--board-height)` (`multiplayer-ui.css` ~2522-2534,
~2703-2717). Nothing expands the board toward the available `1fr` width — it pins the board to
the JS pixel box and centers the leftover space.

**(C) Opponent boards always stretch to fill their cells, so they win by default.**
`.watch-grid` is `display:grid; flex:1; max-height:100%`; `.opponent-mini-board` is
`width:100%; height:100%`. `_handleResize()` (`opponent-watch-manager.js` ~191-256) sizes the
canvas to the largest 1:2 rect that fits the *real* cell, with only a **50px floor and no upper
cap**. With the left column clamped to 560px (`--online-opponents-width: clamp(340px,30vw,560px)`)
and the new responsive grid putting 2 opponents in **1 column** (`_applyGridLayout`:
`cols = n<=2 ? 1 : 2`), each opponent board grows to ~540px wide × full height. That is the
"opponents are HUGE" case in the screenshot.

**(D) The spectator spotlight inherits the tiny main-board box.** The spotlight is injected into
`#online-main-board` (`OnlineMultiplayerMode.js` ~939-962), which still carries
`width: var(--board-width); height: var(--board-height); overflow:hidden` — i.e. the ~280px box
from (A) applies even though there is no local Phaser board. The spotlight canvas is
`height:100%; aspect-ratio:1/2`, so it's capped at 100% of a ~560px-tall box → the spectator's
"spotlight" (meant to be the star) ends up the same tiny size as a player board, and *smaller*
than the opponent boards on the left. Exactly the inversion reported.

**Summary:** opponents stretch-to-fill a wide fixed column (always maximal) while the focused
board is pinned to a 280px ceiling that never scales → the hierarchy is structurally inverted.

---

## 2. Quadra model — what feels good, what to borrow

Verified in Quadra's C++/SDL source (`quadra.cc`, `canvas.cc`, `pane.cc`, `zone.cc/.h`):

- **Hierarchy by block-size, never by stretch.** Quadra has exactly two cell sizes:
  **18px for a focused board** (`canvas.cc:348` → `(i-4)*18, (j-12)*18`; `zone.h:137`) and
  **6px for small watched boards** (`canvas.cc:1002` → `(i-4)*6`; `zone.cc:270`). The focused
  board is **3× the linear size** of a small board → unmistakable visual hierarchy.
- **The focused board is the star.** 10×20 @18px = **180×360px**, ~81% of its pane height to the
  playfield, stats below (`pane.cc:43-54, 1860-1894`).
- **Full playfield always visible.** All 10×20 visible cells (offset from the 36×18 internal grid)
  render at every size — no clipping of frame or rows (`canvas.cc:348`).
- **Scale by count, gracefully.** 1 watched → full 18px board (`Pane_startwatch`); 4 watched →
  **2×2 grid of 6px boards** (`Pane_smallwatch`, `pane.cc:1967-1976`); >4 → auto-watch cycling
  (`pane.cc:1019-1020`). The focused board never shrinks to match the small ones.
- **640×480 screen split into three 214px panes** (`pane.cc:47-50`); right pane = chat/info, left
  panes = boards. Deliberate real-estate split (focused ≈81% board; spectator 2×2 ≈63% boards /
  ~28% scoreboard).

**Distillation:** Quadra picks a **block size per role** and never stretch-fills. Serenity's bug
is the opposite — opponents stretch-fill while the hero is pixel-pinned. The fix is to make the
**hero** the board that scales with available space and give **opponents a sensible cap**.

---

## 3. Target layout (the design)

### Shared principle — one scale unit per role
Introduce a **`--cell-size` (px per block)** per board role; a board is then
`width: calc(10 * var(--cell-size))`, `height: calc(20 * var(--cell-size))`, with frame/labels as
chrome outside that box. This is the lever the rendering map recommends — mini-boards already do
`blockSize = canvas.width / 10` (`opponent-watch-manager.js` ~1500); the main board uses a fixed
400×800 Phaser internal res (`OnlineMultiplayerMode.js` ~965-1001) that CSS scales, so only the
CSS box needs to change.

### (a) Player view (you are playing)
Keep the 3-column grid; retune:
- **Left (opponents):** `clamp(300px, 24vw, 460px)` — narrower than today's 560px so it stops
  out-competing the center.
- **Center (your board):** `minmax(360px, 1fr)` — **board fills the column height**, target
  **≈ 78–84% of viewport height** for the playfield, capped by width so it never exceeds the `1fr`
  column: `cell = floor(min((colW - hChrome)/10, (colH - vChrome)/20))`, board = 10·cell × 20·cell,
  centered. **Remove the 280 cap.**
- **Right (info):** `clamp(300px, 20vw, 440px)`.

Opponents shrink with count (see (c)) and are always clearly smaller than your board because their
cell-size is bounded to the ≤460px left column ÷ N, while your cell-size is bounded to the much
larger center.

### (b) Spectator view (watch-only) — fix the inversion
The spotlight must be the star. Two structural changes:
- The spotlight **must NOT inherit `--board-width/--board-height`** — under `.spectating`, make
  `.online-main-board` `width:100%; height:100%` of the center column.
- The spotlight sizes to its own `--cell-size`, target **≈ 80–88% of viewport height**, capped to
  fit the center column width → clearly the largest board on screen.
- The left roster shows the *other* boards at the small grid size (2×N), full frame visible.
  Clicking re-spotlights (existing `setSpotlight` path).

Result: large spotlight center, small roster left — the opposite of today.

### (c) Scaling with player count (left column ≈ 440px usable, full viewport height)

| Opponents shown | Grid (cols×rows) | Opponent board (approx) | Notes |
|---|---|---|---|
| 1 (2-player) | 1×1 | ~360–420px tall | **cap opponent height ≤ ~55% of hero height** so the 1-opponent case stops being huge |
| 3 (4-player) | 2×2 | ~200px tall | full frame visible |
| 7 (8-player) | 2×4 | ~120–140px tall | matches Quadra's 6px small-board scale |

**Hard rules at every count:** full 10×20 playfield + both side borders + frame always visible
(no `overflow:hidden` clipping the frame — only canvas bleed); strict 1:2 (already enforced in
`_handleResize`); a **max cell-size cap** for opponents (the missing constraint — today the only
bound is the 50px floor).

### Two options
- **Option 1 — Centered Hero + Opponent Rail (RECOMMENDED).** Keep the 3-column grid; hero board
  (yours / spotlight) is the large center star, opponents a scaled rail on the left, info right.
  Minimal structural change, reuses existing DOM, lowest regression risk, ships incrementally.
- **Option 2 — Pure Quadra grid.** Drop the dedicated center column; one uniform grid where your
  board (or the spotlight) spans 2×2 and others 1×1. Visually closest to Quadra, but a much bigger
  DOM + `_applyGridLayout` rewrite and loses the right info-panel placement. Higher risk.

**Recommendation: Option 1.**

---

## 4. Implementation approach — cleanest levers

**Lever 1 — Replace the fixed `--board-width` formula with a fill-the-column cell-size.**
`OnlineMultiplayerMode.js:1787-1794`. Remove the `280` cap; compute from the *measured center
column box* (read the center grid track's `clientWidth/clientHeight`), not `window.innerWidth*0.20`:
`cell = floor(min((colW - hChrome)/10, (colH - vChrome)/20))`; set `--board-width = 10*cell`,
`--board-height = 20*cell`. The Phaser canvas (fixed 400×800 internal, `Scale.NONE`) is CSS-scaled
by these vars, so no Phaser scale-mode change is needed.

**Lever 2 — Make the center column actually fill.** `multiplayer-ui.css` ~2522-2534 / ~2703-2717:
let `.main-board-panel` center a board now sized to the column (drop `width:max-content` pinning);
keep `overflow:hidden` only to clip canvas bleed, not the frame.

**Lever 3 — Spectator spotlight must not inherit the small box.** Add
`#online-multiplayer-container.spectating .online-main-board { width:100%; height:100%; }` (override
the `var(--board-*)`). The spotlight stage (`flex:1; min-height:0`) + canvas (`height:100%;
aspect-ratio:1/2`) then grow to fill. Optionally compute a `--spotlight-cell` for crisper internal
canvas resolution.

**Lever 4 — Cap opponent board size + retune column widths.** `opponent-watch-manager.js`
`_handleResize` — add a **max cell-size / max canvas-height cap** (e.g. opponent height ≤ 55% of
hero height, or absolute ~420px) so 1–2 opponent layouts stop filling the column.
`multiplayer-ui.css` — narrow `--online-opponents-width` to `clamp(300px,24vw,460px)`.

**Risks / watch-outs:**
- **Single-player / local-MP share `--board-width`** (`LocalMultiplayerMode` uses the same
  formula). Do **not** change the shared CSS var globally — scope the new sizing to online mode (a
  new `--cell-size` var or `.online-*` selector) so local/single-player are untouched.
- **Aspect ratio:** keep strict 1:2 everywhere — always `height = 2×width`.
- **Phaser internal res stays 400×800;** only the CSS box changes. Check the WEBGL canvas stays
  crisp when scaled *up* (`pixelArt:true` may want review / a higher `FIXED_BLOCK_SIZE` for the
  larger hero board).
- **Resize timing:** the center-column measurement for Lever 1 must run after layout settles
  (ResizeObserver / post-rAF) or it reads 0 and falls back small.
- **`overflow:hidden`** on `.online-main-board` and `.opponent-grid-frame` must clip bleed but
  never the frame/border — verify borders remain visible after resizing.

---

## 5. Phased roadmap (each independently shippable + screenshot-verifiable)

- **Phase 1 — Hero board fills the center column (player view).** Remove the 280 cap; compute
  cell-size from the measured center column; scope to online mode only. *Verify:* 2-player online
  (or mock) — your board large & centered, no dead space; local/single-player unchanged.
- **Phase 2 — Spectator spotlight prominence.** Override the fixed box under `.spectating`; let the
  spotlight fill the column. *Verify:* `?localMp=watch` 3-window — spotlight is the largest board,
  full frame visible; roster on left clearly smaller.
- **Phase 3 — Opponent arrangement + player-count scaling + cap.** Add the opponent max-cell cap;
  narrow the left column; confirm grid shapes for 2/4/8. *Verify:* screenshots at 2/4/8 — opponents
  shrink gracefully, always smaller than the hero, full frame + 20 rows, no clipping.
- **Phase 4 — Polish / responsive / parity.** Right-column retune, stats-bar fit under the bigger
  board, pixelArt/internal-res review for the enlarged Phaser hero, breakpoints (1280px, ultrawide),
  reduced-motion-safe. *Verify:* screenshots at 1280×720, 1920×1080, 2560×1440 in player + spectator
  modes; no regression in local/single-player.

---

## Key files
- `src/core/game-modes/OnlineMultiplayerMode.js` — board-size formula (~1787-1794, the 280 cap),
  spectator spotlight injection (~939-962), main Phaser board (~953-997).
- `public/styles/multiplayer-ui.css` — 3-col grid (~1989), center panel (~2522-2534),
  `.online-main-board` (~2703-2717), spotlight (`.spectator-spotlight*`), watch-grid (~2155-2205).
- `src/ui/opponent-watch-manager.js` — `_handleResize` cell sizing (~191-256), `_applyGridLayout`
  (~258-300), spotlight render, mini-board render (`_renderMiniBoard`, blockSize = width/10).
- `src/core/constants.js` — `COLS=10, ROWS=20, HIDDEN_ROWS=4` (full board = 1:2).
- Reference: `C:/Users/olovm/repositories/quadra/source/canvas.cc:348` (18px focused) & `:1002`
  (6px small), `pane.cc:47-50` (panes), `pane.cc:1967-1976` (2×2 small grid), `zone.h:137`.

> **Note on line numbers:** captured from a research snapshot; some shifted slightly after recent
> spotlight/scoreboard edits — re-grep before editing.

---

## Implementation status (Option 1)

**Phases 1–3 SHIPPED 2026-06-24** (working tree; live-verified in the 3-window mock harness, theme
suspended to keep GPU light; console clean):
- **Lever 1 (hero fills center):** `OnlineMultiplayerMode.js` — removed the 280 cap; size from the
  measured `.main-board-panel` (window-derived fallback via `clampPx` mirroring the CSS clamps);
  `cell = max(16, min(80, floor(min((colW-60)/10, (colH-170)/20))))`; `--board-width/height` on
  `#online-player-card` (online-scoped). *Verified: hero board 280px → 588px @2560×1600, fills column.*
- **Lever 2 (panel fills):** `.main-board-panel` → `width/height:100%` (was `max-content` + centered).
- **Lever 3 (spectator spotlight):** `.spectating` block hides local-only chrome (stats bar, NEXT
  queue, garbage bar) + makes the board chain fill the column (`overflow:hidden` + `min-height:0` so
  content can't inflate it). The spotlight canvas is sized EXPLICITLY (inline px) by a new
  `OpponentWatchManager._resizeSpotlight()` — the largest 1:2 board that fits the stage — set with
  `!important` to beat the global `.phaser-board-container canvas { width:100% !important }` rule.
  *Verified: spotlight 633×1266 (1:2), fits viewport, clearly bigger than the 220×440 roster boards
  — the inversion is fixed.* (We deliberately dropped CSS `aspect-ratio` here: in a wide column the
  flex stretch + `_renderMiniBoard` getBoundingClientRect feedback drove a runaway 3178px height.)
- **Lever 4 (opponent cap):** `_handleResize` caps opponent canvas height at `min(440, 42vh)` so
  1–2-opponent layouts can't balloon. Column retune: opponents `clamp(300,24vw,460)`, info
  `clamp(300,20vw,440)`.

**Single-player / local-MP untouched:** all sizing is scoped to online (the `#online-player-card`
element, `.online-*` / `.spectating` selectors) — local MP uses its own card.

**Known SEPARATE issue (NOT this layout work):** in the mock harness the local player's **Phaser**
main board renders an empty playfield (affects host + join identically; CSS scaling can't empty a
Phaser buffer; the opponent canvas-2D mini-boards + the spectator spotlight render fine). Real
2-machine play renders the local board. Worth a separate look at the harness BoardScene sync.

**Follow-up tweak (2026-06-24, after user feedback):** the hero board was a touch too tall — it
pushed the own-stats bar to the bottom edge (cut off). Increased the vertical chrome reserve
170px → **280px** and capped the cell 80 → **72** in the `OnlineMultiplayerMode.js` board-size
formula. Result (live-verified, single focused window): board ~640×1280 @1600px (slightly smaller),
own-stats bar fully visible below it, falling piece + stack render.

**"Empty main board" — NOT a bug (diagnosed 2026-06-24).** User reported the local player's main
board showed no tetrominos (host + peer), while the spectator looked good. Deep live diagnosis:
the Phaser scene/camera/graphics/`syncFromGameState` are all correct, and in a **single focused
window** (testMultiplayer + a bot) the board renders the falling piece + stack perfectly. The empty
captures were a **browser RAF-throttling artifact for occluded/background windows** in multi-window
local testing — Phaser's `update()` freezes (frameCount stops) when its window isn't the visible/
focused one. The app only pauses on `document.hidden`, not blur, so side-by-side *visible* windows
render; *stacked/maximized* windows freeze all but the front one. Real per-machine play (one focused
window) renders fine. Workaround for local multi-window testing: tile windows side-by-side. (Not my
layout change — CSS scaling can't empty a Phaser buffer; affects host+peer identically.)

**Phase 4 (open):** pixelArt/internal-res review for the enlarged Phaser hero (40px internal blocks
upscaled ~1.7–2×), bigger NEXT-piece sizes to match the larger board, responsive breakpoints
(1280px / ultrawide). None block the core fix.
