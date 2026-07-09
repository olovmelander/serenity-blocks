# Online MP Never-Pause — Fixed-Timestep Clock Decoupled From Window State

**Status: Layer C (forbid-pause) SHIPPED + verified 2026-06-24. Layer B (worker sim clock) = specced
follow-up.** Researched against Quadra (`C:/Users/olovm/repositories/quadra/source`) + the live tree
via a 4-agent workflow. Several feared problems are **already handled** (see §0).

**Layer C shipped:** `unified-game-loop.js` gained a `neverPause` latch (`pause()` no-ops while set) +
`setNeverPause()`; `ffa-p2p-game-state.js` latches it on in `startGameLoop()` / releases in
`stopGameLoop()`; `src/main.js handleVisibilityChange` has an online-match carve-out (never pause/
reduce while `isInMatch` + online mode). **Live-verified** (single window, testMultiplayer): the
latch is set during a match, `pause()` is a no-op, and with `backgroundTabBehavior='pause'` forced a
simulated tab-hide did NOT pause the loop (kept advancing, `isRenderingPaused` stayed false). 29/29
online unit tests pass; console clean. This + Layer A makes the **packaged Electron app** never pause
on menus/occlusion/minimize. The **browser dev-mock** hidden-tab freeze still needs Layer B.

> **User ask:** "in online multiplayer the game should never pause even when in menus and such" +
> "when not having the window open in the browser the gameplay cannot pause, then it will be
> missync." Pausing the sim while a match is live desyncs the netcode.

---

## 0. Already handled (do NOT redo)
- **Electron `backgroundThrottling: false`** — `electron/main.js:434`. RAF **and** timers run
  full-rate in the packaged app even when minimized/occluded. This is the floor.
- **Blur handler guards on `isMinimized()`** — `electron/main.js:490-497`. Alt-tab/occlusion does
  not throttle; only a true minimize would (and backgroundThrottling:false covers even that).
- **1v1 larger opponent board** — `opponent-watch-manager.js:274-286` (count-aware cap: 1 opp →
  0.85vh, 2 → min(620,55vh), 3+ → min(440,42vh)). Shipped.

**Net:** in the **packaged Electron app**, an occluded/minimized window already keeps simulating.
The remaining gaps are (a) the **browser dev-mock** still freezes when the tab is hidden (RAF), and
(b) the architecture **couples authority to render cadence** + has a **latent pause kill-switch** and
a **false-host-migration trap** — so "never pauses" isn't yet *structural*.

---

## 1. Root causes (sim/net can stall)
| # | Location | Cause |
|---|---|---|
| R1 | `unified-game-loop.js:117` | Authoritative loop is `requestAnimationFrame` → ~0 Hz when a browser tab is hidden; cadence can degrade under GPU occlusion. Sim tick == render tick. |
| R2 | `unified-game-loop.js:124,138` | `delta` from RAF; throttled frames → giant lurches → host/peer integrate different deltas → divergence. |
| R3 | `ffa-p2p-game-state.js:3810-3833` | Host authority (sim + `maybeBroadcastPostPhysics`) lives inside `unifiedLoop.onUpdate` (RAF). RAF stall → host stops simulating AND broadcasting → every peer freezes. |
| R5/R6 | `ffa-p2p-game-state.js:2195,2233` | Fallback broadcast + heartbeat on `setInterval` → clamped ≥1000ms in hidden browser tabs. If heartbeat slips past `HEARTBEAT_TIMEOUT=5000` (`host-migration.js:19`), a peer **falsely self-promotes to host → split-brain** (worst case). |
| R8 | `unified-game-loop.js:121` | `if (this.isPaused) return;` is an **unguarded kill switch** — any caller flipping `isPaused` silently freezes the online sim. |
| R9 | `src/main.js:1371-1382` | The generic `backgroundTabBehavior` machine can `pauseAllRendering()`/`reduceRenderingFrameRate()` (dev default `'reduce'`, `:1309`) with **no online-MP carve-out**. |
| R7 | `OnlineMultiplayerMode.js:2774-2786` | `_setupVisibilityHandler` clears held input on `document.hidden` (correct, kills ghost-repeat) — but it's the only visibility hook and offers no positive "keep running" guarantee. |

## 2. Quadra principle
`quadra.cc:413-505`: one **fixed 10ms timestep** driven by a **wall-clock accumulator**
(`acc += SDL_GetTicks()-last; while(acc>=10){acc-=10; overmind.step();}`), **decoupled from render**
(many sim steps per frame; render may lag), **clamped** (`acc>300`→clamp), and a shared
`framecount` all peers advance in lockstep. **No focus-loss pause** — the clock keeps running
regardless of window state. Serenity already has the accumulator+clamp (`_runFixedStepHostSimulation`,
`ffa-p2p-game-state.js:450-479`); what's missing is **a clock that doesn't stop when the window does**.

## 3. The fix (layered)

### Layer A — Electron floor (DONE) — just guard the comment so nobody removes the flag.

### Layer C — Forbid pausing sim/net while online (LOW RISK — implementing now)
The user's "never pause in menus" + occluded-but-visible cases. Make it impossible for any path to
pause the online loop:
- `unified-game-loop.js` — add a `neverPause` latch; `pause()` no-ops (logs) while set, so the
  `isPaused` kill-switch can't freeze an online match.
- `OnlineMultiplayerMode` — set `neverPause` on match activate, clear on teardown; keep
  `onPause/onResume` as no-ops; keep the visibility handler clearing input but never stopping the loop.
- `src/main.js` — carve-out in the background-tab machine: while an online match is active, never
  pause/reduce the game loop (theme RAF may still reduce — render-only, safe).

This makes "never pauses" structural for menus + the packaged app. **It does NOT fix the browser
hidden-tab RAF freeze** (the browser stops calling RAF regardless of our flags) — that needs Layer B.

### Layer B — Decouple the sim tick from RAF (CORE robustness — recommended follow-up)
Drive the online sim from a **Web-Worker tick clock** (a worker's `setInterval` is NOT throttled when
the page is hidden — works in Electron AND browser AND minimized). New file
`src/core/multiplayer/sim-clock-worker.js` emits `{type:'tick'}` at ~120Hz carrying **no state**; the
main thread keeps the accumulator (`_runFixedStepHostSimulation`, already clamps to 250ms / 5 steps).
Wire it in `ffa-p2p-game-state.js` (`configureUnifiedLoopCallbacks`): route host sim + broadcast +
heartbeat off the worker tick, set `unifiedLoop.setExternalPlayerUpdate(true)` so RAF is render-only.
try/catch → fall back to main-thread `setInterval` (fine in Electron with throttling off).
**Risk:** changes the sim's tick source for the heavily-tuned netcode (peerLocalSim/reconcile were
tuned on RAF cadence). Must be flag-guarded + **2-machine validated** before default-on. The fixed-step
accumulator integrates fixed steps regardless of source delta, so host integration stays bit-identical.

### Layer D — Render catch-up (no new code)
Render stays on RAF; when hidden it skips frames; on resume `renderAllPlayers()` reads current sim
state (the worker kept it advancing) → snaps to truth, peers reconcile via the broadcast stream.

## 4. Phased roadmap
- **Phase 0** — comment the Electron flag as load-bearing; dev-assert the loop isn't paused while in a match.
- **Phase 1 (Layer C, this turn)** — forbid pausing online; carve-out the bg-tab machine. *Verify:* open
  the in-game menu / alt-tab in the packaged app → host keeps broadcasting (snapshotSeq climbs), peer board keeps moving.
- **Phase 2 (Layer B)** — worker sim clock, online-only, flag-guarded + worker→setInterval fallback.
  *Verify (browser dev):* hide the tab 10s mid-match → host simTick + snapshotSeq keep advancing, heartbeat never lapses, no false host migration.
- **Phase 3** — peer prediction + input flush off the worker clock (hidden peer keeps sending inputs).
- **Phase 4** — retire the `simTickNetcode` flag gate; delete the dead RAF-delta host branch.

## Key files
- `src/core/multiplayer/unified-game-loop.js` — RAF loop, `pause()`/`isPaused` (97/117/121), `externalPlayerUpdate` (137/196).
- `src/core/multiplayer/ffa-p2p-game-state.js` — fixed-step host sim (450-479), broadcast/heartbeat (2195/2233), `maybeBroadcastPostPhysics` (2420), onUpdate wiring (3810-3833). **Worker-clock driver goes here.**
- `src/core/game-modes/OnlineMultiplayerMode.js` — `_setupVisibilityHandler` (2768-2798), `onPause/onResume` (2955-2971).
- `src/main.js` — background-tab pause/reduce machine (1302-1428); online carve-out at 1371-1382.
- `electron/main.js` — `backgroundThrottling:false` (434, done), `isMinimized()` blur guard (490-497, done).
- `src/core/network/host-migration.js` — `HEARTBEAT_TIMEOUT=5000` (19) — the false-migration trap the worker-driven heartbeat protects.
- NEW: `src/core/multiplayer/sim-clock-worker.js` — non-throttled tick source (Layer B).
