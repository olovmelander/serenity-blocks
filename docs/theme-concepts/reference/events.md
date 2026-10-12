# Gameplay events and how themes react

> **Snapshot taken at commit 5d3478d (main, 2026-10-11) during the Rainbark design; line numbers drift, verify against the current code.**
>
> Part of `docs/theme-concepts/`: the index is [`../README.md`](../README.md) and the shared build procedure is [`../PLAYBOOK.md`](../PLAYBOOK.md). PLAYBOOK wins where the two disagree; it was written later and folds in what the Rainbark build learned.
>
> This survey was written while choosing a replacement for `cosmic-chimes`. That replacement happened in `585ab55` (Cosmic Chimes → Rainbark), so `cosmic-chimes` no longer exists outside the `RETIRED_THEME_IDS` alias, the frozen V2 save table and dated records. Read every "cosmic-chimes", "Cosmic Chimes" or "the old theme" below as "the theme being replaced" (`OLD_ID` in PLAYBOOK), with the Cosmic Chimes → Rainbark change as the worked example. To choose the theme a new concept replaces, see PLAYBOOK §1 "Choosing a slot".
>
> Item 8 of §11 (the combo break arrives one lock late) has a known fix that every concept relies on: PIECE_LOCK and wave 1's LINE_CLEAR are emitted in the same synchronous tick, so a director can infer at `flush()` that a lock with no clear in that frame breaks the chain and deliver `combo(0)` on the breaking lock itself. Rainbark's director does this (`585ab55`).

Repo /home/user/serenity-blocks @ 5d3478d (main). Read-only survey.

## 0. TL;DR for the new theme

- Subscribe to the 8 canonical keys only: `PIECE_LOCK, HARD_DROP, LINE_CLEAR, COMBO, TSPIN, B2B, PERFECT_CLEAR, LEVEL_UP` (exact map used by every rebuilt sibling, e.g. `SERENITY_WARP_EVENT_HANDLERS`, src/themes/serenity-warp/serenity-warp-director.js:48-57). Gate each with `this.isActive && !this.isPaused`.
- There is NO bus event for hold (no hold mechanic exists), game over, top-out, garbage, soft drop, move or rotate. `EVENTS.PIECE_MOVE` / `PIECE_ROTATE` / `CASCADE` exist (event-bus.js:222,226-227) but have **zero producers**. Referencing a non-existent key (e.g. `EVENTS.GAME_OVER`, `EVENTS.HOLD`, `EVENTS.GARBAGE`) fails tests/unit/event-contract.test.js (KNOWN_VIOLATIONS is empty, shrink-only).
- Game over = window `CustomEvent('gameOver')` (SP + Infinity only, dispatched AFTER the modal). Run end = GameModeManager `modeStopped`.
- The bus `COMBO.comboCount` is **cascade depth**, not a combo (ADR-0011). Derive the true combo with `ComboTracker` (src/core/combo-tracker.js) per player slot.
- Copy a director: best base = **ocean-director.js** (try/finally delivery + `broke` flag that reports combo 0 before a new 1) + **serenity-warp-director.js** extras (`shape`, `cells` of the locked orientation). All four directors are otherwise near-identical (diffed).
- Board→screen: copy `*-composition.js` (`readLayoutRects`, `boardFor`, `boardPoint`, `fallbackLayout`), and ADD `'#online-main-board canvas'` (all four siblings miss it; murmuration has it).
- Settings: `backgroundComboEffects` (master enable), `pieceLockRipple` (lock reactions), `effectQuality` (rebuild), `renderScale` (resize), `reducedMotion` (setting OR `prefers-reduced-motion`). No photosensitivity setting exists — self-impose WCAG 2.3.1 limits.

---

## 1. The bus — src/events/event-bus.js

- One singleton `eventBus` (line 213). `on(name, handler, {throttleMs|debounceMs|rafThrottle})` returns an unsubscribe (117-131). `once`, `off` (by original handler), `emit`.
- **Ordering guarantee (5-8):** option-less listeners run SYNCHRONOUSLY, in registration order, in the same call stack as the emit — i.e. inside the simulation tick. Only throttle/debounce/raf listeners defer (and deferring keeps only the LAST payload — never use them for gameplay events; you would lose waves and read nulled pooled pieces, see §3.2).
- `emit()` try/catches per listener (184-196) → a throwing theme handler logs `[EventBus] listener for "x" threw` and cannot break gameplay or later listeners.
- `EVENTS` map (215-251): `THEME_CHANGED 'themeChanged'`, `THEME_LOADING`, `BACKGROUND_READY`, `LINE_CLEAR 'lineClear'`, `COMBO 'combo'`, `PERFECT_CLEAR 'perfectClear'`, `CASCADE 'cascade'` (dead), `B2B 'b2b'`, `TSPIN 'tspin'`, `PIECE_LOCK 'pieceLock'`, `PIECE_MOVE` (dead), `PIECE_ROTATE` (dead), `HARD_DROP 'hardDrop'`, `LEVEL_UP 'levelUp'`, `SETTINGS_CHANGED 'settingsChanged'`, `ODYSSEY_SAVED`, `HIGH_SCORE_SAVED`, `ODYSSEY_GOAL_COMPLETE 'odysseyGoalComplete'` {levelId, metrics}, `ODYSSEY_VICTORY_LAP_END` {levelId, metrics}, `OPEN_DEMO_BROWSER`, `EXIT_TO_MAIN_MENU`, `PLAY_DEMO`, `CONTEXT_LOST`, `CONTEXT_RESTORED`, `PERFORMANCE_DOWNSCALE`, `VIEWPORT_RESIZED 'viewportResized'` {width, height, dpr}.
- Multiplayer events share the bus with `ffa:` prefixes (src/events/multiplayer-events.js:7-37): `ffa:line-clear`, `ffa:combo`, `ffa:piece-lock`, `ffa:garbage-inserted` {steamId, playerName, linesInserted, isLocal} (ffa-p2p-game-state.js:1680, 3373), `ffa:player-topped-out`, `ffa:game-over`, `ffa:perfect-clear`, `ffa:opponent-clear`… Online-only; **no theme subscribes to any of them today** (grep src/themes: 0 hits).

## 2. Canonical emitters — src/events/gameplay-events.js

All modes call these helpers (pinned by tests/unit/gameplay-event-payloads.test.js). Unknown keys are DROPPED (allowlist `pickAllowed`, 28-35). Shape rules (10-23): never rename `lineCount/comboCount/piece/depth/active`; `clearedRows` + `cascadeCount` always present on LINE_CLEAR; never a `detail` key; never `timestamp` on PIECE_LOCK.

`COMMON_OPTIONALS = ['source','levelId','player','position']` (41).

| Helper (line) | Payload emitted |
|---|---|
| `emitLineClear` (52-61) | `{ lineCount, clearedRows=[], cascadeCount=1, comboCount?, viewportOrigin?, source?, levelId?, player?, position? }` |
| `emitCombo` (67-69) | `{ comboCount, source?, levelId?, player?, position? }` |
| `emitPieceLock` (81-86) | `{ piece, viewportOrigin?, source?, levelId?, player?, position? }` |
| `emitPerfectClear` (92-98) | `{ depth, perfectClearBonus, source?, levelId?, player?, position? }` (perfectClearBonus key always present, may be undefined) |
| `emitTSpin` (104-106) | `{ lineCount, source?, levelId?, player?, position? }` |
| `emitB2B` (112-114) | `{ active=true, source?, … }` |
| `emitHardDrop` (121-137) | `{ piece=null, startY, endY, distance, viewportOrigin?, source?, levelId?, player?, position? }` — `distance` = explicit or `max(0,endY-startY)`, else 0 |
| `emitLevelUp` (143-148) | `{ level, source?, levelId?, player?, position? }` |

`readLockViewportOrigin(payload)` (src/events/lock-origin.js:20-27) → clamped `{x,y}` in [0,1], TOP-LEFT origin, or null.

## 3. Field semantics (precise)

### 3.1 Board coordinates
- `COLS=10, ROWS=20, HIDDEN_ROWS=4` (src/core/constants.js:12-14). Board array rows 0..23; **visible row = boardRow − 4** (0 = top visible row, 19 = floor). Siblings: `BOARD_GRID = { columns: 10, rows: 20, hiddenRows: 4 }` (serenity-warp-composition.js:20).
- `clearedRows`: absolute board-row indices (incl. hidden offset) of the wave's full lines, as `fullLines.slice()` from `detectFullLines` (physics.js:707, 873). Order = detection order (top→bottom scan). In **Infinity** they are absolute rows in a tall grid (hundreds) and detection uses 0 hidden rows (physics.js:707 `gameState.isInfinityMode ? 0 : HIDDEN_ROWS`) → use `viewportOrigin` instead.
- `viewportOrigin`: on-screen normalized `{x,y}` (0..1, top-left) of the lock centroid (PIECE_LOCK/HARD_DROP) or mean cleared row (LINE_CLEAR, x=0.5). Supplied by Infinity (InfinityMode.js:1442,1490,1607) and by Odyssey only when the level is Infinity-based (`presentationViewport` returns null unless `gameState.isInfinityMode`, odyssey-physics-callbacks.js:23-66). Never in SP/MP.

### 3.2 `piece`
- PIECE_LOCK `piece` = snapshot built in `lockPiece` (src/core/game.js:1246-1256): `{ ...lockedPiece, shape: deep copy, pieceId: ++gameState._pieceIdCounter, color: themedColor }`. Fields: `shapeKey` ('I','O','T','S','Z','J','L'), `type` (= shapeKey, set in createActivePiece game.js:363), `shape` (rotated 0/1 matrix as locked — padded: I is 4×4, O 2×2, others 3×3; use OCCUPIED cells' centroid, never the bounding box), `rotation` (0..3), `x`, `y` (board coords of the matrix's top-left, y incl. hidden rows), `color` (hex from `activeTheme.getTetrominoConfig().colors[shapeKey]` or default `COLORS`, game.js:37-58 — so it is the NEW theme's own colour when themeBasedTetrominos is on), `pieceId`.
- HARD_DROP `piece` = the LIVE pooled `gameState.currentPiece` (game.js:1182-1188), already moved to `endY`. In the same call `lockPiece` → `piecePool.release(lockedPiece)` (game.js:1321) whose reset nulls `shapeKey/type/shape/color`, zeroes `x/y/rotation` (src/utils/object-pool.js PiecePool ~236-251). **Read it synchronously in the handler; never keep the reference.**
- `startY`/`endY` board rows (incl. hidden) of the piece's matrix top; `distance` rows fallen.

### 3.3 LINE_CLEAR
- `lineCount` 1..4 = lines in THIS wave. `cascadeCount` = wave index (1 = the manual clear; ≥2 = gravity-cascade waves of the same lock). One LINE_CLEAR per wave.
- `comboCount` present only for synthetic clears (meditation click combo, Odyssey victory lap 10, goal flourish 6).
- `position` {x,y} CSS px — meditation clicks only.

### 3.4 Other events
- COMBO `comboCount`: physics `triggerCombo(cascadeCount)` fires only for waves ≥2 (physics.js:725-727, 1178-1180) → value is **cascade depth ≥2**, emitted BEFORE that wave's LINE_CLEAR. Exceptions: meditation (click combo, carries `position`, emitted AFTER its LINE_CLEAR), Odyssey victory lap (`{comboCount:10}` BEFORE `LINE_CLEAR {lineCount:4, comboCount:10}`, OdysseyMode.js:2362-2363, no source), goal flourish (LINE_CLEAR `{lineCount:4, comboCount:6, source:'odyssey-goal', levelId}` then COMBO `{comboCount:6, source:'odyssey-goal', levelId}`, src/ui/odyssey/odyssey-goal-flourish.js:31-34).
- TSPIN `lineCount`: only on cascade wave 1, only if the lock clears ≥1 line (no zero-line T-spin event, no mini). Detection (game.js:1294-1312): T piece, last action a rotation (`lastMoveWasRotation`), ≥3 of 4 corners of the 3×3 box filled/out-of-bounds. Fires AFTER the wave's LINE_CLEAR.
- B2B `active:true`: fires on a "difficult" wave (`lineCount>=4 || tspin`) when `gameState.b2bActive` was already set (physics.js:880-893); chain reset only by a non-difficult wave-1 clear. Fires after TSPIN. Never `active:false` from any producer.
- PERFECT_CLEAR `depth` = total lines this lock across all waves, `perfectClearBonus` = bonus points. Fires once, AFTER the last wave's gravity settles (physics.js:955-970 legacy; `finalizeResolvedPhysics` 1101-1115) → a **later frame** than the LINE_CLEAR(s), standalone.
- LEVEL_UP `level` = new level (every 15 lines, physics.js:829-844). Fires BEFORE the same wave's LINE_CLEAR.

## 4. Emission order and timing (one lock)

Physics schedule is pinned (tests/unit/physics-callback-schedule.test.js header; physics.js legacy 663-1000, resolved 1155-1260 — same order). For a hard-dropped lock:

```
tick N (synchronous, same JS stack):
  HARD_DROP {piece@endY,startY,endY,distance}          game.js:1182
  PIECE_LOCK {piece snapshot}                           game.js:1254
  -- wave 1 runs synchronously (first await is after its callbacks) --
  [LEVEL_UP {level}]                                    if 15-line boundary crossed
  LINE_CLEAR {lineCount, clearedRows, cascadeCount:1}
  [TSPIN {lineCount}]
  [B2B {active:true}]
  (board-only: onLineClearImpact, triggerFlash)
  await hold 160ms*speed + lead 20ms + animated gravity + tail 20ms (physics.js:88,102,109)
later frame(s), each wave k>=2:
  COMBO {comboCount:k}            <- BEFORE the wave's LINE_CLEAR
  [LEVEL_UP]
  LINE_CLEAR {lineCount, clearedRows, cascadeCount:k}
  [B2B]
later frame, after the last wave settles:
  [PERFECT_CLEAR {depth, perfectClearBonus}]
```
Speed classes: wave 1 ×1.0, waves 2-4 ×0.8, 5-9 ×0.6, 10+ ×0.5 (physics.js:910-915). A soft-drop/gravity lock emits no HARD_DROP. A lock that clears nothing emits only PIECE_LOCK (no "no-clear" event — this is why the combo break is only known at the NEXT lock). Demo seek/fast-forward uses muted callbacks (DemoPlayer.js:734-760) → no theme events; normal demo playback emits like SP.

## 5. Emit sites per mode (exact)

| Mode (`GAME_MODES`, constants.js:202-209) | File:line | What reaches the bus |
|---|---|---|
| `single` | SinglePlayerMode.js:1182-1277 | LINE_CLEAR `{lineCount, clearedRows, cascadeCount}` 1190; TSPIN 1193; B2B 1201; LEVEL_UP 1209; HARD_DROP `(dropData)` 1214; COMBO 1232; PERFECT_CLEAR 1258; PIECE_LOCK 1275. No `player`/`source`. |
| `local-multiplayer` | main.js `getMultiplayerPhysicsCallbacks(playerNum)` 4457; emits 4519, 4565, 4595, 4610 | LINE_CLEAR `{lineCount, player, clearedRows}` (**no cascadeCount → always 1**); HARD_DROP `{...dropData, player}`; COMBO `{comboCount, player}`; PIECE_LOCK `{piece, player}`. `player` = 1..4. **No TSPIN, B2B, LEVEL_UP, PERFECT_CLEAR** on the bus. |
| `online-multiplayer` | OnlineMultiplayerMode.js:1297-1300, 1348, 1400, 1426, 1483-1487 (local player only, filtered by steamId) | LINE_CLEAR `{lineCount: rows.length, clearedRows: rows}` (rows = absolute fullLines from `triggerFlash`, ffa-p2p-game-state.js:3140-3153; no cascade); COMBO `{comboCount}`; PIECE_LOCK `{piece}`; HARD_DROP `(dropData)`; PERFECT_CLEAR `{depth, perfectClearBonus, source:'online'}`. No `player`. No TSPIN/B2B/LEVEL_UP. |
| `infinity` | InfinityMode.js:1438-1444, 1465, 1474, 1486-1492, 1528, 1607, 1644 | LINE_CLEAR + `viewportOrigin`; TSPIN/B2B/HARD_DROP/PERFECT_CLEAR `source:'infinity'`; COMBO & PIECE_LOCK without source (PIECE_LOCK has viewportOrigin). **No LEVEL_UP** (`disableLevelProgression`; onLevelUp is a no-op). |
| `odyssey` | odyssey-physics-callbacks.js:99-190 | every event with `source:'odyssey', levelId`; viewportOrigin only on Infinity-type levels. Plus synthetic victory-lap and goal-flourish clears (§3.4). Odyssey level 47 "Singularity Gate" (`src/core/odyssey/data/levels.js:3132`) and chapter 6 pool (`src/core/odyssey/data/chapters.js:230`) used `cosmic-chimes` as the level theme (since `585ab55` they use `rainbark`, and the orb is "The Painted Giants") → the new theme WILL run behind Odyssey gameplay. |
| `serenity` (meditation) | SerenityMode.js:1038-1053 | click/tap/gamepad: LINE_CLEAR `{lineCount: min(floor((clicks+1)/2),4), comboCount: clicks-1, source:'serenity-interaction', position:{x,y} CSS px}`; then COMBO (same source/position) only if comboCount≥2. No locks, no board on screen. |
| legacy fallback | main.js `getPhysicsCallbacks` 3266 (emits 3301, 3341, 3356) | only if a mode lacks `getPhysicsCallbacks`: LINE_CLEAR (no cascade), COMBO, PIECE_LOCK. |

Garbage/top-out/round-win/knockout are Phaser board effects only (`sharedEffects.playGarbageArrival/playGameOver/playKnockout`, shared-effects.js:1139,1248,2764), not bus events.

## 6. Lifecycle signals a theme can use

- window `gameOver` CustomEvent: SinglePlayerMode.js:1455-1457 `{detail:{gameState}}`; InfinityMode.js:1892-1898 `{detail:{gameState, mode:'infinity', infinityStats}}`. Dispatched only after the game-over modal has been shown (and only if the stopped session still owns the UI). Not from Odyssey/MP/meditation. Siblings: `registerEventListener(window,'gameOver', () => this.resetSession())`; ocean calls `world.onGameOver?.()` first (ocean-theme.js:452-458).
- GameModeManager (`window.serenityBlocks?.gameModeManager`, may appear after the first build): `on(event, fn)` returns unsubscribe (GameModeManager.js:467). Events with `{modeId, mode}`: `modeActivated` 230, `modeStarted` 300, `modePaused` 330, `modeResumed` 344, `modeStopped` 369, `modeDeactivated` 391. Siblings subscribe lazily in `ensureModeManagerListeners()` (serenity-warp-theme.js:514-525): modeStarted/modeActivated → `scheduleLayoutReads()`, modeStopped → `resetSession()`. No sibling reacts to modePaused (the theme keeps rendering under the pause sheet; no events arrive while the sim is paused).
- Theme pause/resume (tab hidden with backgroundTabBehavior 'pause', theme parked): `BaseTheme.pause()` (base-theme.js:1449-1472) cancels RAFs, clears `isAnimating/animationLoopStarted`; `resume()` + `restartRenderLoop()` (1480). Siblings reset `lastFrameMs` on pause/resume, re-read viewport and layout on resume, and run a deferred quality rebuild (`rebuildPending`) only on resume, "never behind the menu" (serenity-warp-theme.js:464-479, 658-683).
- `shouldRenderFrame()` (base-theme.js:1290-1331): skips when `window.isRenderingPaused || window.isThemeCovered` (breathing guide covers the theme), throttles under `window.isRenderingReduced`, caps to the player's target FPS (theme-frame-pacer.js). Use `this.safeAnimate(...)`.

## 7. How siblings translate events (director pattern)

Files: serenity-warp-director.js (485 lines), solar-eclipse-director.js (445), sunset-director.js (452), ocean-director.js (468). Renderer-free, DOM-free, bus-free; each has a `*-director.test.js` (ocean's has ~27 cases: intake, hard-drop fold, colour fallback, viewportOrigin, widest clear, combo break, tspin/perfect/b2b, meditation, per-player combos, slot overflow, malformed payloads, throwing sink, settings resets).

Wiring (serenity-warp-theme.js:359-372):
```js
const playing = () => this.isActive && !this.isPaused;
Object.keys(HANDLERS).forEach((key) => {
  const handler = HANDLERS[key];
  if (!EVENTS[key]) return;
  this.eventUnsubscribers.push(eventBus.on(EVENTS[key], (p) => { if (playing()) this.director?.[handler](p); }));
});
```
(clearEventUnsubscribers + clearTrackedResources first: createScene re-runs on rebuild.)

Director internals:
- 5 preallocated player slots (`PLAYER_SLOTS = 5`: 0 = solo/online, 1..4 local MP), assigned on first use by `payload.player` (trunc, default 0); overflow increments `droppedEvents` and drops (serenity-warp-director.js:276-291).
- Handlers only STAGE numbers (no allocation): `onPieceLock` → `tracker.notePieceLocked()` + `captureLock` (rows of occupied cells as visible rows clamped 0..19, `u` = occupied-cell centroid / 10; viewportOrigin wins: `row = floor(vy*20)`, `u = vx`) (137-187). `onHardDrop` → same capture + `hardDrop=true` (folds with the following PIECE_LOCK into one harder lock). `onLineClear` → widest wave in the frame names the rows (`captureClearRows`: viewportOrigin → `first = floor(vy*20) − (lines−1)/2`; else `clearedRows[i] − 4`), `cascade = max`, `tracker.noteLineClear()`, explicit `comboCount` raises combo, `position` captured (319-341). `onCombo` → if `position` (meditation) treat as click combo; else only raises `cascade` when `slot.lines > 0` (347-363). `onTSpin` → `tspin=true`, lines=max. `onB2B` → ignore `active===false`, `b2b=true`. `onPerfectClear` → `perfect=true`, `lines=max(1,lines)`. `onLevelUp` → NOT gated by `enabled` (level always tracked).
- `flush()` called FIRST in the frame (after camera update, before world update; serenity-warp-theme.js:615): `sink.levelUp(level)` once, then per slot one `sink.lock({player, rows, u, hardDrop, color, shape, cells, screen:null})`, one `sink.clear({player, rows, lines, combo, cascade, tspin, perfect, b2b, screen})`, then `sink.combo(n, player)` when the true combo changed (0 = broke). `screen` = `position / (viewport w,h)` for meditation clicks. Objects are reused — sink must copy.
- Ocean improvements to keep: deliver inside `try { … } finally { clearPending(slot) }` so a throwing sink never re-delivers every frame (ocean-director.js:398-405); `broke` flag so a 1→0→1 in one tick still reports `combo(0)` then `combo(1)` (272-273, 391-397).
- Theme side: `reportCombo(combo, player)` keeps a `Map` per player, world reacts to the MAX chain on screen (serenity-warp-theme.js:410-418). `resetSession()` → `director.reset()` (drops staged + every combo, reports combo 0, frees slots), `combos.clear()`, level reset, `world.resetSession()`, `scheduleLayoutReads()`.
- Settings → director: `configure({ enabled: backgroundComboEffects, lockRipple: pieceLockRipple })`; disabling drops everything staged and all combos; lockRipple off cancels staged locks, keeps clears (serenity-warp-director.js:252-267).

### Typical sink reactions in siblings (for "uniquely connected to the environment")
| Event | serenity-warp (world.js) | ocean | solar-eclipse | sunset |
|---|---|---|---|---|
| lock | glass piece in its own shape/orientation/colour lifts off the board cell, exits at card edge with flare + ripple, joins the vortex; flash 0.025 (hard 0.06, +kick, ×1.08 size) (754-855) | piece light sinks to reef beside card, colour ring over sand, bubbles, fish dart, colonies hold the colour; hard = pressure ring; flash 0.012/0.06 | coloured mote flies from card edge to sun limb, raises a prominence (column→limb position); hard = taller arch + lens jolt | lantern of piece colour set on the sea (`u`, middle row); hard = splash |
| clear | ring per line from the rim, streams from the cleared rows (card exit) into the throat, n pieces fall in; flash 0.08+0.04n (895-949) | current crosses canyon at cleared-row height, kelp leans, school ribbons, colonies release bead snow; flash 0.03+0.02n | Baily's beads (one per line), chromosphere flash 0.45+0.12·lines, oldest prominences erupt 2/line | one lantern lifts per line |
| quad / perfect | hush (HUSH_HOLD) → camera falls through the throat; flash 0.5 then 0.75 on arrival | sea holds breath → one great shaft, reef spawns | diamond ring + CME (flash 1.0–1.4 into a post veil scaled ×0.004) | all lanterns lift, sky fires (flash 0.4) |
| T-spin | vortex twist + glass tumble | — | corona twists | lanterns turn as they rise |
| combo (true) | warp winds up per step, ring in nebula glow (978-995) | animals called in, one per step (turtle→mantas→whale) | longer exposure: corona reaches, stars, earthshine; closes slowly on break | sky burns, gulls |
| level | palette step on a 6-palette line + slow ring (997-1011); also drifts by clock | next of 6 "hours" + long swell; also every 100 s | next of 6 light steps; also by clock | next hour |

All siblings: nothing allocated at event time; events write into preallocated slots/timed queue; `seek(t)` + fixed-step replay reproduces frames (capture flags `?<theme>Time=`, `?<theme>FixedDt=`). Rebuilt mid-run scene restores level silently (`world.levelUp(level, {silent:true})`).

## 8. Board/card DOM rect → screen (serenity-warp-composition.js; ocean/sunset/solar identical)

- `BOARD_SELECTOR = '.player-card[data-player]'` (cards: `#single-player-card` data-player="solo" index.html:463; `#player-1..4-card` 550-661; `#online-player-card` data-player="1" 720). `HUD_SELECTOR = '.single-player-stats-bar'` (484). `SOLO_CANVAS_SELECTORS = ['#phaser-game-container canvas', '#main-game-canvas', '#single-player-game-canvas']`; `playerCanvasSelector(p) = '#p${p}-phaser-container canvas'` (30-37). **Missing: `#online-main-board canvas`** (index.html:749) → online events (slot 0) find no board and fall back to the default aim; murmuration includes it (murmuration/composition/board-layout.js:16-18).
- `readLayoutRects(doc, win)` (82-117): visible rects only (>8px, on screen, not display:none / visibility:hidden / opacity<0.05) → screen fractions `{x0,y0,x1,y1}` (y down): `{cardCount, cards[], hud, boards[5]}`; returns **null when no card is visible** (menus, boot, meditation) → world aims at `fallbackLayout(w,h)` (51-75, from main.css formulas) and post calm rects fade off.
- `boardFor(layout, player)` (138-146): own canvas else first visible. `boardPoint(board, u, row)` (167-172): `x = x0 + (x1−x0)·u`, `y = y0 + (y1−y0)·(row+0.5)/20`. Cell size on screen = `(board.y1−board.y0)/20`.
- Read schedule: never inside handlers (getBoundingClientRect forces layout). `scheduleLayoutReads()` sets reads at frame-time +0, +0.5, +1.5 s (`LAYOUT_REREAD_OFFSETS`) after scene build, resize, resume, modeStarted/modeActivated/modeStopped, game over; `processLayoutReads()` runs in the frame loop on a wall clock (`layoutClock`) so captures still update (serenity-warp-theme.js:489-525).
- Calm zones: post soft-clips effects behind the cards (max PLAYER_SLOTS−1) and HUD: `post.setCalmRects(list, strength)`, strength eased in/out at rate 3 (serenity-warp-theme.js:527-540). Keeps the board readable.

## 9. Accessibility constraints

- **Reduced motion** = `boolSetting(settings.reducedMotion) || matchMedia('(prefers-reduced-motion: reduce)').matches`, re-evaluated on the media query's `change` and on settings changes (serenity-warp-theme.js:398-407, 429-439). `settings.reducedMotion` has no default in DEFAULT_CONFIG and no in-game UI toggle (index.html only has the cursor's `customCursorReducedMotion`) → in practice the OS preference. Modes use the same test for hit-stop (SinglePlayerMode.js:1117-1121, `prefersOdysseyReducedMotion` odyssey-physics-callbacks.js:68-74).
- What siblings do under reduced motion: camera FOV punch/kick/shake → 0 (`calm = reducedMotion ? 0 : 1`, serenity-warp-world.js:511; ocean 420); event flights shortened to 0.15 s; quad "jump" 1.1 s instead of full tunnel; ambient drift ×0.3–0.5 (ocean 234,253,1018; warp 309); ocean ripple strength ×0.4 (625); pointer parallax disabled (pointer handler returns to 0 when reducedMotion, and ignores `pointerType==='touch'`).
- **No photosensitivity/flash setting exists** in settings.js (grep: none). Project guidance (docs/STARLIGHT_COMBO_LOCK_EFFECTS_PLAN.md:424,458-461; docs/SERENITY_WARP_COMBO_LOCK_FIX_PLAN_2026-07.md:58; docs/ODYSSEY_AAA_MASTER_PLAN.md:281): flashes only on quad/perfect (never on lock or per-combo step), small-area, never pure #FFFFFF, never red-adjacent, capped (`flashPunch ≤ 0.36` there), WCAG 2.3.1 ≤3 flashes/s — cap event-flash frequency so rapid cascades/hard drops cannot stack into strobing; clamp HDR (e.g. `clamp(0,2.2)`) before bloom. Siblings use `flash = max(flash, x)` (no additive stacking) with exponential decay (ocean τ 0.25 s, solar 0.9 s, sunset `exp(-4dt)`), and post maps it to a gentle exposure lift (`×(1+flash·0.3..0.35)`).
- The Phaser board already flashes on big clears (SharedEffects `_screenFlash(TONE.GOLD, reduced ? 0.22 : 0.4, …)`, shared-effects.js:933; reduced-motion aware via `_reducedMotion()` 561) → a theme flash stacks on top of it on quads/perfects. `lineClearEffects`, `comboPopupEffect`, `pieceLockRipple` are enforced inside SharedEffects for the board; themes read only `backgroundComboEffects` and `pieceLockRipple`.
- Settings defaults (src/ui/settings.js:30-34, 60): `pieceLockRipple: true`, `comboPopupEffect: true`, `lineClearEffects: true`, `backgroundComboEffects: true`, `effectQuality: 'High'`. (Cosmic Chimes required `=== true`; siblings use `boolSetting(value, true)`.)

## 10. Settings / quality / perf plumbing

- Settings payload shapes (handle all three, `readSettingUpdate`, serenity-warp-theme.js:107-128): window `settingsChanged` `{detail: changes}` (settings.js:410, only changed keys); bus `SETTINGS_CHANGED` `{settings, dirtyKeys, categories, source:'local'}` (settings.js:453-460); bus `{type:'renderScale', value}` (base-theme.js:64). Fallback read `window.settings[key]` (main.js:3384, 4016).
- `effectQuality` tiers: `'Minimal' | 'Low' | 'Medium' | 'High' | 'Ultra' | 'Extreme'` (+ `'Custom'` in the UI → `normalizeQuality` → `'High'`), src/utils/quality.js:153-163. Sibling per-theme tier table `*-quality.js` (`QUALITY`, `QUALITY_NAMES`, `tierFor(q)` default High; "every tier keeps the whole picture and every event"). Pixel-ratio caps (serenity-warp-theme.js:70-77): Minimal 0.7, Low 0.85, Medium 1.0, High 1.15, Ultra 1.35, Extreme 1.6, applied via `getEffectivePixelRatio(cap,'theme')` (global renderScale × DPR, base-theme.js:1227-1248).
- Quality change → `queueRebuild()` (microtask; rebuild in place keeps clock + level; deferred to resume if paused). renderScale change → resize only, deferred a microtask (main.js applies `setGlobalRenderScale` first) (serenity-warp-theme.js:441-462).
- `PERFORMANCE_DOWNSCALE` (performance-monitor.js:469-473, >30 consecutive drops, once) → base-theme.js:58-66 lowers global renderScale by 0.25 (min 0.5) and emits `SETTINGS_CHANGED {type:'renderScale'}`.
- `VIEWPORT_RESIZED {width,height,dpr}` (debounced, src/utils/viewport.js) — use instead of window resize; siblings fall back to `getViewport()`.
- **perf-budgets.json**: no per-theme budget. `frameP95Ms.maxPerTier` = 60hz 16.6 / 120hz 8.3 / 144hz 6.9 ms; `split` cpuMaxMs 6, gpuMaxMs 9 (60 Hz, scale proportionally); `perSurface.odyssey` 15; `perSurface["heavy-theme-worst"]` **null deliberately** (ADR-0016: perf claims need a verified instrument; the theme harness scripts/validate-all-themes.mjs lands on the iGPU Lane B). `gpuMemoryTotalMB` / `gpuMemoryScenarioGrowthMB` null (leak gate). CLAUDE.md: one small effect per WebGPU session — full-journey captures TDR-crashed the iGPU.
- Registry meta `resourceProfile: 'heavy-gpu'` (theme-manager.js:733 copies it from meta; ocean sets it in the constructor ocean-theme.js:148 for validator builds) opts into deeper disposal (base-theme.js:547-555).

## 11. Mode-specific gotchas (checklist)

1. **Hidden-row offset**: subtract 4 from `clearedRows[i]` and `piece.y + r`; clamp 0..19.
2. **Infinity**: prefer `viewportOrigin` on PIECE_LOCK/HARD_DROP/LINE_CLEAR; absolute rows/`piece.y` are in the hundreds. No LEVEL_UP ever — anything level-driven must also progress by clock/combo (siblings drift the palette by time anyway).
3. **Local MP**: `player` 1..4 (slot per board, combo per board); LINE_CLEAR has no cascadeCount (always 1); no TSPIN/B2B/LEVEL_UP/PERFECT_CLEAR. Its cascade depth arrives ONLY as COMBO — which precedes the wave's LINE_CLEAR, so the sibling guard `else if (slot.lines > 0)` (serenity-warp-director.js:359) silently drops it. If cascade depth matters in MP, stash a pending COMBO count and apply it to the next LINE_CLEAR of the same slot/frame.
4. **Online MP**: no `player` (slot 0), board canvas `#online-main-board canvas` (add to selectors), no cascade on LINE_CLEAR, no TSPIN/B2B/LEVEL_UP; PERFECT_CLEAR `source:'online'`.
5. **Meditation (`serenity`)**: no board, no locks; `readLayoutRects` → null; LINE_CLEAR/COMBO carry `position` (CSS px) → normalize by viewport (`director.setViewport(w,h)`); bursts can be rapid (click combos) → rate-limit flashes; breathing guide sets `window.isThemeCovered` (frames skipped).
6. **Odyssey**: `source:'odyssey'`, `levelId`; synthetic victory-lap (no rows, comboCount 10) and goal-flourish (rows [], comboCount 6, `source:'odyssey-goal'`) clears must look good with empty `rows` (siblings fall back to bottom rows `19-i`). No window `gameOver` — rely on `modeStopped`. Theme is chosen per level via the Odyssey theme scope (theme-manager.js:2157-2170); cosmic-chimes is level 47's theme, chapter 6 pool, and frozen in `V2_LEVEL_THEME_IDS` (odyssey-progress-schema.js:26-27 — frozen history; use the `RETIRED_THEME_IDS` alias map, theme-registry.js:513-527, as done for electric-dreams-v3 → murmuration).
7. **Perfect clear is a separate later frame** with no rows; it resolves as its own `sink.clear({lines:1, perfect:true, rows:[]})` — design it as a standalone moment (not a modifier of the quad that preceded it).
8. **Combo break is one lock late** (ComboTracker resets in `notePieceLocked`); `sink.combo(0)` arrives on the next lock.
9. **HARD_DROP piece is pooled** — copy synchronously.
10. **Game pause** does not pause the theme (no bus/theme hook; `modePaused` exists but unused); tab-hide pause does (BaseTheme.pause).
11. **Events while parked/prewarmed** are ignored by the `playing()` gate; a theme switched to mid-run starts with a fresh tracker/level (siblings keep `this.level` across rebuild but `stop()` resets clock).
12. **Tests to mirror**: `tests/unit/<id>-director.test.js`, `-theme.test.js`, `-world.test.js`, `-core.test.js`, `-composition.test.js` (serenity-warp ships all five). Event-name contract test forbids new dead `EVENTS.X` references. Cosmic-Chimes-specific tests to rewrite/remove: tests/unit/mobile-wrapper-policy.test.js (imports CosmicChimesTheme, "selected quality animation policy"), tests/unit/mobile-webgl2-validation.test.js:159-170 (uses 'cosmic-chimes' as the DOM-artwork / no-renderer-heartbeat exemplar — a WebGPU replacement no longer fits that case).
13. Cosmic Chimes' current wiring (to delete): src/themes/cosmic-chimes/cosmic-chimes-theme.js:275-298 subscribes LINE_CLEAR(`lineCount`), COMBO(`comboCount`), PIECE_LOCK gated on `window.settings?.backgroundComboEffects === true`; DOM/CSS only, no director, no tracker.
