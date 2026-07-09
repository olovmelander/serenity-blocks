# Serenity Blocks — Smoothness & Feel Engineering Report

> Generated 2026-06-04 by a 66-agent audit (7 code-finder dimensions + 4 web-research tracks,
> every finding adversarially re-verified against live source). 40 findings confirmed,
> 14 rejected/downgraded as false positives.

## 1. Executive Summary

The 5-8 highest-leverage changes, one line each:

1. **Add a `.catch()` to the physics promise chain** (`game.js:722-731`) — a single transient throw during line-clear currently freezes the entire game forever; this is the worst player-facing failure and an almost-trivial fix.
2. **Add lock delay (~500ms) with move/step reset** (`game.js:531-596`) — pieces lock the instant they touch the stack; this is the single biggest game-feel deficiency, killing tucks, slides, spins, and finesse.
3. **Drive gamepad DAS from the single-player loop** (`game.js:778-783` / `gamepad-controller.js`) — holding a direction on a controller moves the piece exactly once; the flagship Steam mode is nearly unplayable on a gamepad.
4. **Fix Summer theme leaking its whole WebGL context + bloom render targets** (`summer-theme.js:1407-1411`) — repeated load/evict drives toward "Too many active WebGL contexts" and a hard crash; the worst GPU leak.
5. **Add `forceContextLoss()` after every theme `renderer.dispose()`** (`base-theme.js:329-338` + 37 themes) — disposed contexts linger until GC; cycling themes exhausts the context pool and cascades into breakage.
6. **Implement real SRS rotation + wall kicks + hold piece** (`game.js:480-520`, `SinglePlayerMode.js:588-600`) — rotation isn't SRS (no floor/I kicks, no T-spin) and hold is a no-op; two core mechanics modern players expect are missing.
7. **Stop force-overwriting the peer's own board every host snapshot** (`ffa-p2p-game-state.js:1009-1021`) — the local piece rubber-bands backward on every 30Hz snapshot for all non-host players; the most damaging online smoothness defect.
8. **Delete the two `console.log` calls in the collision hot path** (`game.js:72-76`) — unconditional logging during cascades causes avoidable micro-stutter at the most visually active moments.

## 2. Top Priorities (do first)

Ranked by ROI across all dimensions:

| Issue | File:lines | Severity | Effort | Player-facing impact |
|---|---|---|---|---|
| Physics promise has no `.catch` → permanent freeze on any throw | `game.js:722-731` | High | Small | Hard freeze of the whole game on a single transient error; only escape is app restart |
| Delete 2 console.logs in collision hot path | `game.js:72-76` | Medium | Trivial | Micro-stutter during line-clears/cascades; log spam |
| No lock delay / move reset → instant lock on contact | `game.js:531-596` | High | Medium | No tucks/slides/spins; placement feels twitchy and punishing |
| Gamepad held-direction DAS never repeats in single player | `gamepad-controller.js:406-416,1632-1689` | High | Small | Controller play (Steam target) requires mashing the D-pad to move |
| Summer theme leaks GL context + bloom RTs on evict | `summer-theme.js:327,1102-1132,1384-1411` | Critical | Small | Progressive GPU growth → "Too many WebGL contexts" → crash |
| No `forceContextLoss()` after theme renderer dispose (37 themes) | `base-theme.js:329-338` | High | Trivial | Long-session slowdown → context loss cascade breaking all rendering |
| Peer board overwritten by every host snapshot (rubber-band) | `ffa-p2p-game-state.js:1009-1021,1671-1718` | High | Small | Local piece snaps backward 1-2 cells every snapshot online |
| Spawn replays queued input via `setTimeout(0)` | `game.js:419-427` | Low | Trivial | 1-frame piece teleport after clears; dropped taps |
| `onStop`/restart never awaits in-flight physics promise | `SinglePlayerMode.js:364-410` (+Infinity/Odyssey) | Medium | Small | Phantom/double piece spawn, ghost piece "comes back" on quick restart |
| Composer/bloom RT leaks in black-hole/blood-moon/fall/solar-eclipse | `black-hole-theme.js:2986-3018,4104-4183` | Medium | Small | Several MB VRAM leaked per theme cycle; accelerates context pressure |
| Soft drop hardcoded to 50ms (~20 cells/s), not configurable | `controls.js:81-83,92-94` | Medium | Small | Soft drop feels sluggish, can't be tuned unlike DAS |

## 3. Findings by Area

### Input & Game Feel

**No lock delay or move/step reset** — `game.js:531-596, 642-732`
`softDrop()` calls `lockPiece()` the instant `canPlacePiece(y+1)` fails; `processAutoDrop()` treats a failed move as an immediate lock. No `lockTimer`, no grace window, no move/rotation reset exists anywhere. The only `lockDelay: 500` (`MechanicsMixer.js:17/27/37`) is dead config, never read.
*Impact:* At high levels (drop interval floors near 10ms) a piece cements the moment it grazes the stack — no tucks, slides, or spins possible; feels punishing/twitchy.
*Fix:* Add `lockTimer`, `lockResetCount`, `isGrounded` to GameState. In `processAutoDrop`, when grounded, accumulate `lockTimer += delta` (use the authoritative delta, **not** `performance.now()`, to preserve demo/replay determinism) and only call `lockPiece` when `lockTimer >= LOCK_DELAY` or `lockResetCount >= 15`. In `move()`/`rotate()`, reset the timer on a successful action while grounded, capped at 15 resets. Un-ground when a slide reopens space below. Reconcile with the Quadra time-based lock bonus (`game.js:648-656`) — consider measuring it from first-ground-contact rather than spawn. Expose `LOCK_DELAY` / reset cap in `constants.js`.

**Rotation is not SRS; no I/floor kicks, no T-spin** — `game.js:480-520`
`rotate()` tries only horizontal offsets `[0,1,-1,2,-2]` at the same `y` for all pieces including I. `pieces.js:112` comments this "simplified SRS." The piece object has **no orientation field** (`pieces.js:52-58`), so true kick-table lookup isn't even possible yet. No T-spin detection exists (`total_tspins` Steam stat is never incremented).
*Impact:* Wall/floor kicks, I-piece flat-to-vertical, S/Z tucks, and T-spins all silently fail; rotation feels stiff and unpredictable.
*Fix:* Add a `rotation` field (0/1/2/3) to pieces. Implement the standard JLSTZ and separate I-piece SRS kick tables (see §4 for exact offsets), each entry an `(dx, dy)` **pair** — test `canPlacePiece(x+dx, y-dy)` (invert `dy` since this engine's +y is down). Iterate the 5 offsets in table order, apply the first that passes. O piece never kicks. Optionally add T-spin 3-corner detection + a `lastActionWasRotation` flag for scoring. **Determinism caveat:** `rotate()` runs in `DemoPlayer` and P2P — deploy atomically; existing replays may invalidate.

**Hold piece is a no-op** — `SinglePlayerMode.js:588-600`
`window.hold` only calls the (undefined) `originalInputs.hold` and records a demo input. Core `game.js` has no hold logic; `holdEnabled` config is set-only and never read; no hold key is bound.
*Impact:* A core modern convenience (save an I for a Tetris) is entirely missing.
*Fix:* Add `heldPiece`/`holdUsedThisTurn` to GameState; export `holdPiece(gameState, spawnCallbacks)` as a pure core fn (swap or stash, re-spawn via the existing next-piece routine, reset lock state, invalidate ghost cache). Wire `window.hold`, implement `DemoPlayer` `case 'hold'`, add a `hold` keybinding (`'c'` or Shift) to all binding sets, add a hold-slot UI, and finally **read** `holdEnabled` so Odyssey modifiers take effect.

**Soft drop hardcoded to 50ms** — `controls.js:81-83, 92-94, 123-130`
Both keyboard players and the gamepad path pass a literal `50` (~20 cells/s); no `softDropInterval` exists in `DEFAULT_SETTINGS` (only `dasDelay: 120`, `dasInterval: 40`).
*Impact:* Soft drop is slow for experienced players and untunable while DAS is configurable.
*Fix:* Add `softDropInterval: 50` (or a gravity-multiplier `softDropFactor`) to `DEFAULT_SETTINGS`. Replace both literal `50`s in `controls.js` with `currentSettings.softDropInterval ?? 50`; forward it to the gamepad path via `updateDasSettings`. Special-case `interval <= 0` to drop to the floor in one frame. *Note:* the existing DAS sliders in `index.html:1605-1617` are dead controls with no JS handlers — wiring them (plus a new soft-drop slider) is a separate pre-existing gap worth the same pass.

**Gamepad DAS dead in single player** — `gamepad-controller.js:406-416, 1632-1689`
`processDasTimers()` (the only repeater) is reachable only via `advanceGameplayInput()`, called only from the legacy `main.js` loops and `OnlineMultiplayerMode`. The active single-player path (`SinglePlayerMode._startGameLoop` → core `gameLoop`) never calls it; `updateGame` advances only keyboard DAS.
*Impact:* Holding the D-pad/stick moves once then nothing; soft-drop hold doesn't repeat. Nearly unplayable on a controller.
*Fix:* In `game.js updateGame()`, beside `window.inputController.updateDAS(delta)` add `window.gamepadController?.advanceGameplayInput(time)` — pass the loop `time` (not `delta`; the method computes its own delta). This fixes both single-player paths at once. To avoid double-advancing in the legacy loop, either centralize there or add a per-frame timestamp dedupe (early-return if `timestamp === this.lastGameplayTime`).

**Queued input replayed via `setTimeout(0)`** — `game.js:419-427`
A single buffered move/rotate is replayed asynchronously after spawn. `isProcessingPhysics` is already `false` when `spawnPiece` runs, so the deferral is needless and applies the input a frame late (visible teleport), and only one tap is buffered.
*Impact:* After clears, a buffered tap applies a frame late (teleport) and extra taps drop. (Held DAS is *not* lost — it auto-resumes.)
*Fix:* Apply synchronously: drop the `setTimeout`, call `move`/`rotate` inline. Re-check `isPaused`/`isGameOver`/`isProcessingPhysics`/`!currentPiece` before applying (see Async/Correctness below). Optionally make `inputQueue` a small bounded FIFO (~3-4) drained in order.

### Frame Pacing & Rendering

**Two console.logs in the collision hot path** — `game.js:72-76`
`ensureBoardCache()` logs two interpolated template strings on every rebuild. The cache is dirtied on every lock and every gravity step during cascades (`physics.js:272`), so these fire repeatedly during the most active moments.
*Impact:* Avoidable per-action string interpolation + synchronous console I/O → micro-stutter during cascades, badly so with DevTools open in Electron.
*Fix:* Delete both lines, or gate behind `const BOARD_CACHE_DEBUG = false;` mirroring `physics.js`'s `PHYSICS_DEBUG` pattern so the template literal short-circuits.

**Line-clear blocks input for the full animation** — `physics.js:600-883`
`isProcessingPhysics` stays true for the whole async clear (~120ms fade + 16ms/gravity-step per cascade); `move`/`rotate`/`softDrop` early-return throughout, and the next piece doesn't spawn until physics resolves. *Scoped correction:* a non-clearing lock breaks immediately (no awaits), and held-DAS auto-resumes — only discrete taps during actual line-clears are coalesced.
*Impact:* After clears the game feels frozen for ~100ms+; the new piece can't be pre-positioned; discrete taps drop.
*Fix:* (1) Small FIFO input buffer drained on spawn (above). (2) Bigger win: decouple the cosmetic fade from the input/spawn gate — let the next piece spawn after a short fixed ARE (~60-100ms) while the fade renders on a separate layer; keep `isProcessingPhysics` guarding only board-mutating gravity. Cheap interim: shorten the fade (30/20/20) to cut dead time ~40%. *Best-practice:* modern competitive (TETR.IO) uses line-clear delay = 0; overlap clear animation with spawn/ARE so it never stalls input.

**Hybrid interpolation alpha is dead code** — `frame-rate-controller.js:342-371`
`_renderTick` computes an `alpha` that the single-player `renderUpdate(time, alpha)` ignores; the board draws at integer `piece.y`. *Refuted premise:* the board is **not** re-rasterized at high rate — it renders via Phaser's own ~60fps loop independent of the hybrid split, and a dual-layer dirty flag already exists. So there is **no board frame-time win** from removing the split.
*Impact:* Negligible (a few arithmetic ops/render tick). Pure cleanup.
*Fix:* Either delete the `alpha` computation and unused `getInterpolationAlpha()` (zero behavioral change), or, if smooth sub-cell gravity is genuinely wanted, track `piece.y` as a float and thread `alpha` into the draw. Do **not** rip out the hybrid loop expecting a board perf gain.

**Per-cell closure/spread allocation in piece draw** — `base-board-scene.js:885-928`
`drawGhostPiece`/`drawCurrentPiece`/`drawPieceOutline` run every (non-dirty-gated) frame using nested `forEach` (2 closures/row/frame) plus a `{...piece}` spread that's a no-op copy.
*Impact:* ~12-30 short-lived closures + 1 object per frame → incremental GC hitches over long sessions (small magnitude — tetromino shapes are tiny).
*Fix:* Replace nested `forEach` with indexed `for` loops; delete the `tempPiece` spread and call `drawPieceOutline(piece)` directly. Cleanup, not a perf priority.

**FPS `recordFrame()` double-counted when overlay shown** — `main.js:1912-1923`
When the perf overlay is visible, `startFPSMonitor`'s RAF and the game loop both call `updateFPSCounter` → `recordFrame()`, ~2x-inflating `actualFPS`. *Refuted:* triple-count (hybrid `_renderTick`) is dead code; *refuted:* the inflated number does **not** skew adaptive quality (that reads the independent `performanceMonitor`) and no user sees it (legacy fps-counter DOM is hidden).
*Impact:* Inaccurate internal stat only; no functional harm today.
*Fix:* Have `startFPSMonitor` call read-only `getStats()` instead of `recordFrame()` — or simply remove the standalone `startFPSMonitor` RAF and the dead hybrid loop entirely.

**Monitor refresh detected once from a noisy 20-frame startup sample** — `frame-rate-controller.js:46-86`
A single 20-frame RAF burst at construction (during heavy init) sets `monitorRefreshRate` permanently; `<30` falls back to 60. *Dominant real harm:* a 144/240Hz display misdetected as 60 gets auto-capped to 60 FPS for the whole session (auto-target and `needsHybridMode` are self-consistent, so the jittery-hybrid scenario only occurs on manual override).
*Impact:* High-refresh users can be locked to 60 FPS on first run with no correction.
*Fix:* On Electron (primary platform), set `monitorRefreshRate` from `screen.getPrimaryDisplay().displayFrequency` — expose `display.displayFrequency` in `electron/main.js:77`'s get-displays handler (currently omitted). For the web fallback, defer detection to first idle, discard first ~5 frames, sample ~60, use the **median** inter-frame delta, and re-sample if implausibly low.

### Three.js Memory / Theme Lifecycle

**Summer theme leaks GL context + composer RT + bloom (worst offender)** — `summer-theme.js:327, 1102-1132, 1384-1411`
Summer creates its own `WebGLRenderer` (a full GL context), an `EffectComposer` over a large `WebGLRenderTarget` (samples:8, HalfFloat), and an `UnrealBloomPass` (~5 RTs + materials). Its `cleanup()` is just `super.cleanup()`. It's not `resourceProfile:'heavy-gpu'`, so `releaseManagedGpuResources()` never runs, and base cleanup only handles `this.scene`/`this.postComposer` — Summer stores its composer in `this.composer`. **Zero** `dispose()` on renderer/composer/bloom.
*Impact:* Each load→evict (LRU `maxCachedThemes=2`) leaks one GL context + bloom/composer RTs permanently → "Too many active WebGL contexts" crash + rising VRAM/stutter.
*Fix:* Override `cleanup()` to dispose **before** `super.cleanup()`: `this.stop()`, then `this.bloomPass?.dispose()`, `this.composer?.dispose()`, then `this.renderer.dispose()` + `this.renderer.forceContextLoss()` + remove its `domElement`, null all three, then `super.cleanup()`. `bloomPass.dispose()` is mandatory regardless of approach (the heavy-gpu path doesn't dispose it). Audit other 'light'-profile themes that create their own renderer with a no-op cleanup.

**37 themes create their own renderer but ZERO call `forceContextLoss()`** — `base-theme.js:329-338`
`grep forceContextLoss` across all themes = 0 matches; base disposal calls only `renderer.dispose()`. In Three.js, `dispose()` frees programs/state but the browser keeps the `WebGLRenderingContext` alive until GC or `forceContextLoss()`. Themes *are* disposed on switch (LRU eviction), so this is disposed-but-not-released contexts lingering until GC — GC-timing-dependent, not guaranteed every session.
*Impact:* Rapid theme cycling can outrun GC, exceed the ~16-context cap, and force-lose the oldest context, cascading into theme + board-renderer breakage.
*Fix:* In `releaseManagedGpuResources()`, after `renderer.dispose()` add a guarded `renderer.forceContextLoss()` (try/catch), then remove the canvas and null. Mirror in per-theme overrides that dispose their own renderer (`aurora-theme.js:762`, `bioluminescence-theme.js:1993`, etc.). Best long-term: a single `base-theme.disposeRenderer(renderer)` helper routing all teardown through dispose+forceContextLoss+DOM-removal+null. *Best-practice:* keep **one** renderer for the app's lifetime — never new-up a renderer per theme; pair disposal discipline with a `webglcontextrestored` handler that re-marks textures `needsUpdate=true`.

**Composer + bloom RT leaks in 6 themes** — `black-hole-theme.js:2986-3018, 4104-4183` (+ blood-moon, fall, solar-eclipse, luminous-tides, summer)
`EffectComposer.dispose()` (verified in bundled Three) disposes only its 2 RTs + copyPass — it **never** iterates `this.passes`. `UnrealBloomPass.dispose()` frees 11 HalfFloat RTs + ~9 materials. None of the 6 themes call `bloomPass.dispose()`. Composer RTs additionally leak where the theme pre-nulls `this.composer` before base disposal (black-hole `4144`, blood-moon `1141`, solar-eclipse `2170`).
*Impact:* Bloom mip-chain RTs + materials leak in all 6; composer RTs leak in 3 — several MB VRAM per cycle, compounding context pressure.
*Fix:* Before nulling `this.composer`, call `this.bloomPass?.dispose?.()`, `this.chromaticPass?.dispose?.()`, `this.composer?.dispose?.()` (mirror `misty-lake-theme.js:1658-1672`). For black-hole/blood-moon, store passes on the instance so they're reachable. Remove the premature `this.composer = null` assignments so the base heavy-gpu path can run. Systemic fix: have base disposal iterate `composer.passes` and call `pass.dispose?.()` before `composer.dispose()`.

**Sakura fox GLTF geometry/material/textures never disposed** — `sakura-twilight-theme.js:3216-3246`
`stop()` detaches foxes via `scene.remove(fox.model)` without disposing their GLTF geometry/material/textures, and omits `super.stop()`. Because Sakura is heavy-gpu, the base `disposeThreeJSGroup(this.scene)` runs *after* `stop()` has already detached the foxes — so the base traversal can't reach them. Each activation loads a fresh `Fox.glb`.
*Impact:* Repeated Sakura activation accumulates orphaned fox GLTF GPU resources — a slow leak (worsened by theme auto-cycling).
*Fix:* Cleanest: **remove** the manual fox-detach block from `stop()` and add `super.stop()` at the end, letting the heavy-gpu path dispose still-attached foxes. Alternatively, traverse each `fox.model` disposing geometry + every material + every material texture before removal (mirror `disposeThreeJSGroup`, `base-theme.js:518-547`). `SkeletonUtils.clone` shares resources but `dispose()` is idempotent. *Best-practice:* adopt the official per-theme `ResourceTracker` pattern and monitor `renderer.info.memory.{geometries,textures}` post-switch as an automated leak regression guard.

### Listeners / Timers / Cleanup

*(All three below are latent — the relevant teardown/`destroy`/`cleanup` is never invoked today, and the app is a process-lifetime singleton. Fix opportunistically; they future-proof against any soft-reload/re-init.)*

**controls.js global listeners can never be removed** — `controls.js:258-468, 490-522`
keydown/keyup/visibilitychange/click are anonymous arrows with no stored reference; `InputController` has no `cleanup()`, so `main.js:5010`'s `inputController.cleanup()` would throw if ever reached.
*Fix:* Store bound named handlers on the instance, register those, and add a real `cleanup()` that removes them + `clearTimers()`. Cheap perf nit: cache modal `getElementById` lookups and precompute a reverse key→action map so keydown avoids `Object.keys().find` per event.

**App `cleanup()` never drains `cleanupHandlers`** — `main.js:4992-5018`
~11 teardown closures are pushed but never iterated; `cleanup()` itself is never called.
*Fix:* Drain `cleanupHandlers` (try/catch each) at the top of `cleanup()`; register `cleanup()` on `pagehide` if teardown/reuse is ever intended.

**GamepadController.destroy() removeEventListener no-ops** — `gamepad-controller.js:152-160, 2014-2019`
`destroy()` passes bare method refs that differ from the registered arrow wrappers; visibilitychange is never removed. `destroy()` is never called.
*Fix:* Store stable bound handlers in the constructor; register and remove those exact references in `initialize()`/`destroy()`.

### Multiplayer

**Peer board overwritten by every host snapshot — reconciliation is dead** — `ffa-p2p-game-state.js:1009-1021, 1671-1718`
`syncFromHost()` → `_applySnapshotState(state, {forceLocal:true})` overwrites the local player's grid/currentPiece/lockedPieces with 30Hz authoritative state, then calls `_reconcileLocalPlayer()` — which replays `inputHistory`, but **nothing ever pushes to `inputHistory`** (`sendInput` only writes `pendingInputs`). So the peer predicts, then ~33ms later the host snapshot teleports the piece back with zero replay.
*Impact:* Every non-host player's own piece rubber-bands backward 1-2 cells on every snapshot — the most damaging online defect.
*Fix (Option A, recommended ~2 lines):* In `_applySnapshotState`, gate the grid/currentPiece/lockedPieces/nextPieces updates on `!isLocalPlayer` (drop `forceLocal ||` for board fields) while still syncing stats + `lastInputSeq`. Keep `forceLocal` as an explicit full-resync path used only on detected desync, restoring the documented design (the desync detector + `_requestResync` already exist as the safety net). Delete the dead `_reconcileLocalPlayer`/`inputHistory` code.

**Binary delta snapshots sent unreliable but decoded as reliable** — `steam-networking.js:358-413, 486-521, 929-1004`
`GAME_STATE_FULL` is encoded as a binary delta vs `lastBroadcastSnapshot` and sent `unreliable_no_delay`, but the decoder assumes the previous packet was the baseline ("Since we use reliable delivery…"). On loss, host baseline = N while peer baseline = N-1; since only changed fields are sent, the lost change is never re-sent. The `baselineTick` mismatch check exists but is **commented out**. Full snapshots only happen on player-list change.
*Impact:* Opponent mini-boards show stale/garbled grids after any packet loss; never self-heals within a round.
*Fix:* (A) Enforce baseline continuity: have `decodeDeltaSnapshot` reject when `baseline.tick !== baselineTick` (uncomment/harden `binary-encoding.js:590-592`); on mismatch, drop the delta and request a resync. (B) Self-heal: reset `lastBroadcastSnapshot = null` every ~1s to force a periodic full keyframe. Together these bound corruption to ~1s. (`_validateEnvelope` already drops reordered packets, so this is purely the loss case.)

**Binary grid encoding loses colors / mis-types garbage; opponent stacks render empty** — `binary-encoding.js:27-28, 357-387, 784-803`
*Refined diagnosis:* normal tetromino cells round-trip fine (`cell.type` = shapeKey, a valid letter). The real show-stopper: the renderer (`multi-player-canvas-layout.js:1572`) draws opponents from `lockedPieces` + currentPiece, but the encoder **strips lockedPieces** (writes count 0) and `_applySnapshotState` never reconstructs them from the decoded grid. Net in binary mode (production default): opponent **stacks render completely empty**, only the falling piece shows. Garbage cells also mis-encode: `'GARBAGE'`/`'CLEAN_GARBAGE'` shapeKeys aren't in `CELL_TYPE_MAP` (lowercase `'garbage'` only) → decode as empty holes.
*Impact:* Opponent watch-boards appear empty; spectating is useless. Binary (production) only.
*Fix:* Make the opponent renderer grid-driven — reconstruct `lockedPieces` from the decoded grid in `_applySnapshotState`, or draw opponents directly from `gameState.grid`. Normalize garbage typing (lowercase the lookup, add `clean_garbage`). Reconstruct color on decode from canonical type (`COLORS[type]`/`COLORS.GARBAGE`). Add a test using a **real** board (`rebuildBoardGridFromPieces` + a garbage row) that asserts non-empty, correctly-typed/colored opponent render input.

**Host migration never restarts sim loop / jitter buffer / state sync** — `host-migration.js:110-144` (the active `src/core/network/` one)
`becomeHost()` flips flags, starts heartbeat, sends one snapshot — but never calls `startStateSyncLoop()` (no ongoing 30Hz broadcast), never creates the host-only `inputJitterBuffer`/`inputValidator` (null since the node started as a peer → `validateInput` null-deref on first remote input), and never `syncUnifiedLoopPlayers()` (only the local player is registered, so remote gravity stops).
*Impact:* After the host drops, every remote opponent's board freezes (no gravity, inputs error out) and peers stop receiving state; match broken for all but the new host's local player.
*Fix:* Add a `FFAGameStateP2P.promoteToHost()` that lazily creates `inputValidator` (or `.reset()`) and `inputJitterBuffer`, calls `syncUnifiedLoopPlayers()` (or `startGameLoop()`), and `startStateSyncLoop()` (idempotent). Call it from `becomeHost()`. Delete the dead sibling `src/core/multiplayer/host-migration.js`.

**Adaptive jitter buffer drops/skips a tick on depth change** — `input-jitter-buffer.js:187-209, 232-249, 360-377`
`_updateAdaptiveDepth()` mutates `bufferDepth` ±1 at runtime; the process cursor is `currentTick - bufferDepth`. *Verified:* on **decrease** a tick is skipped and later GC'd as `inputsDropped` (real input loss); the **increase** case is a harmless 1-tick pause (not a double-apply, since the entry was already deleted). No per-tick guard, so multiple packets on a `%10` tick can shift depth by >1. Host-side online FFA only.
*Impact:* Under variable latency, occasional dropped remote inputs — pieces that "eat" a movement.
*Fix:* Track a separate monotonic `processCursor`; advance it by exactly 1 per `advanceTick`, and on a depth **decrease** drain the catch-up tick inline rather than abandoning it. Clamp depth changes to ±1 per host tick. Add a unit test for D→D±1 asserting every tick's inputs apply exactly once and `inputsDropped` stays 0.

**State sync on a drifting `setInterval`, not RAF-aligned** — `ffa-p2p-game-state.js:1393-1424, 2188-2204`
Host physics run in the RAF `onUpdate`, but broadcasts run on a separate `setInterval(1000/30)`, adding 0-33ms phase skew + timer coalescing. *Refined:* `hostTick` is **not** the authoritative input tick — the jitter buffer's own `currentTick` is already RAF-aligned, so the only genuine issue is snapshot phase skew.
*Impact:* 0-33ms variable latency on opponent-board updates.
*Fix:* In the host's `onUpdate`, after `updateAllPlayers(delta)`, drive broadcasting from a fixed-step accumulator (~every 2 sim ticks) so the snapshot is always taken post-physics; remove the `setInterval`, keep the 500ms fallback + `hasSignificantStateChanges()` gate.

**`lastInputSeq` never advanced for remote peers** — `ffa-p2p-game-state.js:965-970, 1524, 2213-2253`
`seq` is a sibling of `data`, not inside it; `processInputBatch` forwards only `input.data`, so the `data.seq` guard sees `undefined` and `lastInputSeq` never advances. `processBufferedInputs` also never updates it. Latent (reconciliation is inert anyway).
*Fix:* Forward `seq` inside `data` in `processInputBatch`; update `lastInputSeq` on the applied path in `processBufferedInputs`; populate `inputHistory` in `sendInput`. Defer unless completing client-side prediction.

**Resync re-serializes full match state to JSON+base64** — `ffa-p2p-game-state.js:1826-1872, 1890-1919`
Resync `JSON.stringify`s the full snapshot (every player's grid + lockedPieces), base64-encodes (+33%), chunks at 16KB with per-chunk CRC32 + a 50ms `setInterval`, ignoring the existing binary encoder. Episodic (rejoin/desync only), not a hot path.
*Fix:* Reuse `getBinaryEncoder().encodeSnapshot()` (~90% smaller, typically a single ~1-2KB chunk), send raw bytes, decode via `decodeSnapshot()`. Send `matchConfig`/`sharedSeed`/`matchStartTime` as a tiny JSON header. Low priority.

**Interpolator mutates the cached snapshot object** — `snapshot-interpolation.js:190-196`
`_interpolate()` sets `toState.currentPiece = this._interpolatedPiece` (a reused shared object) on the **buffered** node. Next frame, that node's `currentPiece` now points at last frame's mutated object, collapsing the lerp endpoint toward A — opponent pieces under-shoot/stall then snap.
*Fix:* Never write to `toNode.data`. Return a per-steamId scratch wrapper: `out.currentPiece = interpolatedPiece; out.grid = toState.grid; …; return out;` — keeps zero per-frame allocations while leaving the buffer immutable.

**Duplicate `GAME_ROUND_RESTART` key** — `message-types.js:41-42`
Declared twice (identical value); inert today but a trap for future edits.
*Fix:* Delete line 42; enable eslint `no-dupe-keys`.

### Audio

**No master SFX limiter/compressor → clipping** — `sound-manager.js:303-333`
Every SFX connects straight to `audioContext.destination`; line-clear/level-up sets fire 4-5 overlapping tones via `setTimeout`. With music *also* summing at the same destination, stacked full-amplitude oscillators exceed 0 dBFS and hard-clip.
*Impact:* Audible buzzy distortion on multi-line clears/combos at the most rewarding moments.
*Fix:* Create one shared `sfxBus` (Gain) → `sfxLimiter` (`DynamicsCompressor`, threshold -3 to -6 dBFS, ratio ~12-20, attack ~0.003s, release ~0.1s) → destination, once in `resumeAudioContext()`. Route `createTone`/`createRichTone` to `sfxBus`. Optionally run the music chain through a gentle limiter too.

**Move SFX retriggers every ~40ms DAS step** — `main.js:3254-3260`
`window.move` plays the move SFX on every successful shift; DAS repeats at `dasInterval=40ms`, but move tones are 50-100ms — so consecutive voices overlap into a buzzy drone during slides.
*Impact:* Holding left/right produces continuous buzzing instead of crisp per-step clicks.
*Fix:* Add a per-action min-interval gate in `SoundEffectPlayer.playMove()`: `if (now - this._lastMoveAt < 55) return;` (longer than the longest move tone and the 40ms ARR).

**Music HTMLAudio cold-start hitch** — `sound-manager.js:617-689`
Music streams via `new Audio()` with src-swap; the fade-out preload warms track-to-track switches, but the very first track selection is cold (fetch + initial buffer).
*Fix:* On init / first user gesture, create a hidden `preload='auto'` Audio for the default track and `load()`. Skip in Electron/Steam (local disk). Keep HTMLAudio streaming (don't decode multi-minute tracks to AudioBuffer).

**Dead `audioManager` singleton** — `audio-manager.js:359-372, 443-449`
`new AudioManager()` at import adds a permanent visibilitychange listener + window global; `theme-manager.js`'s `import { audioManager }` is shadowed by the injected SoundManager, and the `?.stopAll()` cleanup guard is a silent no-op (SoundManager has no `stopAll`). *Correction:* no idle AudioContext (lazy) — cost is one idle listener.
*Fix:* Delete the dead import; replace the `stopAll` block with `stopBackgroundMusic()` if stopping on full teardown is intended. Convert `audio-manager.js` to lazy `getAudioManager()` or delete it.

### Async / Correctness

**Physics promise has no `.catch` → permanent freeze** — `game.js:722-731`
`processPhysics(...).then(() => { isProcessingPhysics = false; spawnPiece(); })` has **no** `.catch`. `processPhysics` awaits multiple frames while mutating `boardGrid`/`lockedPieces`; any throw (restart nulling the grid mid-await, malformed grid, callback throw) means `.then` never runs and `isProcessingPhysics` stays `true` forever — every input guard then blocks all gameplay. No `unhandledrejection` handler exists. The multiplayer path (`multiplayer.js:171-183`) already wraps this in `try/finally`, proving the author knows the flag must clear on throw.
*Impact:* Hard freeze of the whole game on a single transient error; only escape is restart. Likely root cause of the repo's many "freeze on lock" fix docs.
*Fix:* Add `.catch((err) => { console.error(...); gameState.isProcessingPhysics = false; markBoardDirty(gameState); if (!gameState.isGameOver && spawnPiece) { try { spawnPiece(); } catch {} } })`. Clear the flag **before** `spawnPiece` in both branches and wrap each `spawnPiece` in its own try/catch. Add a global `unhandledrejection` backstop that clears a stuck flag, optionally a >2s watchdog.

**`onStop`/restart never awaits in-flight physics** — `SinglePlayerMode.js:364-410` (+ Infinity `455-493`, Odyssey `410-462`)
`onStop()` sets `isGameOver`/cancels the loop but never awaits `latestPhysicsPromise`. A clear/cascade spans many frames; when it resolves, its `.then` unconditionally calls `spawnPiece()` against the (now-new) live `gameState` — phantom/double spawn. `DemoPlayer` already awaits `latestPhysicsPromise`, proving the correct pattern.
*Impact:* Phantom/double piece spawn, stale next-queue redraws, ghost piece "comes back" on quick restart-during-cascade.
*Fix:* Guard the spawn site (`game.js:724`) with the captured (old) gameState: `if (gameState.isGameOver || gameState.isStopped) return;`. Set `isGameOver = true` at the top of Infinity/Odyssey `onStop` (SinglePlayer already does). Await `latestPhysicsPromise` (try/catch) in each `onStop` before stopping the loop. Belt-and-suspenders: `if (gameState.isGameOver) return;` as line 1 of core `spawnPiece`.

**`spawnPiece` has no isGameOver guard; top-out doesn't set the flag** — `game.js:369-441`
`spawnPiece` lacks an `isGameOver` early-out; its top-out branch (`432-441`) calls `gameOverCallback()` without setting `gameState.isGameOver = true`. *Refined:* SinglePlayer (`isProcessingGameOver`) and Odyssey (`failLevel` guard) are protected; the Infinity double-handling path is unreachable. The genuine residuals: a stale physics resolution still mutates dead state, and the loop runs across the async handler's first await.
*Fix:* `if (gameState.isGameOver) return;` as line 1 of `spawnPiece`; set `gameState.isGameOver = true` **before** `gameOverCallback()` in the top-out branch; optionally guard the physics `.then` spawn.

**Queued-input `setTimeout` bypasses pause/game-over guards** — `game.js:419-427`
The replayed buffered action calls core `move`/`rotate` directly (which guard only `isProcessingPhysics`/null piece, **not** `isPaused`/`isGameOver`), on a later macrotask. If the player paused or the game ended in the ~0ms gap, the action still mutates `currentPiece`.
*Impact:* Piece jumps/rotates one step right after pausing or game-over — a one-frame desync per piece that had a queued action.
*Fix:* Re-check live guards before applying (combine with the synchronous-apply fix above): `if (gameState.isPaused || gameState.isGameOver || gameState.isProcessingPhysics || !gameState.currentPiece) return;`.

## 4. Game-Feel Tuning Recommendations (best-practice values → exact targets)

Map these to `src/core/constants.js` (`DEFAULT_SETTINGS` + new constants), `src/core/game.js` (lock/rotation logic), and `src/ui/controls.js` / `gamepad-controller.js`.

| Mechanic | Recommended value | Where to apply |
|---|---|---|
| **Lock delay** | ~500ms (30 frames); configurable, 250-500ms for fast modes; **never instant** | New `LOCK_DELAY` const; lock-delay state machine in `game.js processAutoDrop`/`move`/`rotate` |
| **Lock reset mode** | **Move reset, capped at 15** resets/piece (not Infinity, not step) | `lockResetCount` cap in `game.js`; reset on accepted shift/rotate while grounded |
| **DAS** | Guideline 167ms; offer 60-167ms (current `120` is fine) | `DEFAULT_SETTINGS.dasDelay`; charge across spawn |
| **ARR** | Default ~33ms (2 frames); allow **ARR 0** (teleport to wall) | `DEFAULT_SETTINGS.dasInterval` (currently 40); add ARR-0 instant-slide path |
| **Soft drop (SDF)** | Gravity multiplier (e.g. 6x-20x) or configurable ms; allow ∞ (snap to floor, **non-locking**) | New `softDropInterval`/`softDropFactor`; replace hardcoded `50` in `controls.js:81/92` + gamepad |
| **ARE / spawn delay** | ~100ms classic or 0 competitive; **charge DAS + buffer IRS/IHS** during it | New `spawnDelay`; decouple from line-clear fade (see Frame Pacing) |
| **Line-clear delay** | Short ~100-300ms for feel; allow 0; **overlap with spawn** | `physics.js` fade stages (50/40/30); decouple from `isProcessingPhysics` |
| **Input buffering** | Buffer move/rotate/hold/hard-drop during spawn/clear, apply on first frame; carry DAS across spawn | Bounded FIFO replacing single-slot `inputQueue` (`game.js:419-427`) |
| **Hold** | One slot, one swap per piece; IHS pre-hold during ARE | New core `holdPiece` + `holdUsedThisTurn` |
| **Ghost piece** | On by default | Already present (`getGhostLandingY`) |
| **Hard drop** | Instant lock (no lock delay), +2 pts/cell, separate key, brief input-buffer | Already instant; keep separate from soft drop's lock-delay window |
| **7-bag + 5-next** | Fisher-Yates 7-bag, show next 5 | Verify against `pieces.js` bag logic |

**SRS kick tables (best-practice, exact offsets; engine's +y is down so apply `y-dy`):**

- **JLSTZ** — `0→R:(0,0)(-1,0)(-1,+1)(0,-2)(-1,-2)`; `R→0:(0,0)(+1,0)(+1,-1)(0,+2)(+1,+2)`; `R→2:(0,0)(+1,0)(+1,-1)(0,+2)(+1,+2)`; `2→R:(0,0)(-1,0)(-1,+1)(0,-2)(-1,-2)`; `2→L:(0,0)(+1,0)(+1,+1)(0,-2)(+1,-2)`; `L→2:(0,0)(-1,0)(-1,-1)(0,+2)(-1,+2)`; `L→0:(0,0)(-1,0)(-1,-1)(0,+2)(-1,+2)`; `0→L:(0,0)(+1,0)(+1,+1)(0,-2)(+1,-2)`.
- **I-piece (separate table)** — `0→R:(0,0)(-2,0)(+1,0)(-2,-1)(+1,+2)`; `R→0:(0,0)(+2,0)(-1,0)(+2,+1)(-1,-2)`; `R→2:(0,0)(-1,0)(+2,0)(-1,+2)(+2,-1)`; `2→R:(0,0)(+1,0)(-2,0)(+1,-2)(-2,+1)`; `2→L:(0,0)(+2,0)(-1,0)(+2,+1)(-1,-2)`; `L→2:(0,0)(-2,0)(+1,0)(-2,-1)(+1,+2)`; `L→0:(0,0)(+1,0)(-2,0)(+1,-2)(-2,+1)`; `0→L:(0,0)(-1,0)(+2,0)(-1,+2)(+2,-1)`.
- **O** never kicks. **180** optional, dedicated key, default no-kick.

## 5. Quick Wins vs Larger Refactors

**Quick wins (trivial/small effort, high or safety value):**
- Add `.catch` to the physics promise (`game.js:722-731`) — prevents the worst freeze. **(small, do first)**
- Delete the 2 collision-hot-path `console.log`s (`game.js:72-76`).
- Apply queued input synchronously + re-check pause/game-over guards (`game.js:419-427`).
- Drive gamepad DAS from `updateGame` (`game.js:778-783`).
- Make soft drop configurable (`controls.js` + `constants.js`).
- Summer theme `cleanup()` GPU disposal (`summer-theme.js:1407-1411`).
- `forceContextLoss()` in base + per-theme renderer disposal (`base-theme.js:329-338`).
- Bloom/composer `dispose()` in the 6 leaking themes.
- Sakura `super.stop()` + don't pre-detach foxes (`sakura-twilight-theme.js`).
- Peer board overwrite guard — Option A (`ffa-p2p-game-state.js`).
- SFX master limiter + move-SFX throttle (`sound-manager.js`, `sound-effects.js`).
- Delete duplicate `GAME_ROUND_RESTART` key; enable eslint `no-dupe-keys`.
- Snapshot-interpolator scratch wrapper (`snapshot-interpolation.js:190-196`).
- Await `latestPhysicsPromise` + `isGameOver` guard in `spawnPiece` / `onStop` (correctness).

**Larger refactors (medium/large, plan deliberately):**
- **Lock delay + move reset** state machine (`game.js`) — medium, touches multiplayer/demos; deploy with deterministic delta.
- **Full SRS rotation + kick tables (+ optional T-spin)** (`game.js`, `pieces.js`) — large; add orientation field first; invalidates replays, deploy atomically.
- **Hold piece** core implementation + UI + bindings (`game.js`, modes, `controls.js`, `DemoPlayer`).
- **Decouple line-clear fade from input/spawn gate** + bounded input FIFO (`physics.js`, `game.js`).
- **Binary opponent-board encoding** — reconstruct `lockedPieces`/grid + colors + garbage typing (`binary-encoding.js`, `ffa-p2p-game-state.js`) + a real-board test.
- **Multiplayer netcode hardening** — baseline-tick reject + periodic keyframe (`steam-networking.js`), host-migration `promoteToHost()`, jitter-buffer `processCursor` decoupling. Defer client-side prediction (`inputHistory`/`lastInputSeq`) unless actively completing it.
- **Monitor refresh detection via Electron `displayFrequency`** + async re-derivation of recommended settings (`frame-rate-controller.js`, `electron/main.js`).
