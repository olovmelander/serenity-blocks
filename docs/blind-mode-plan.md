# Quadra Blind Mode — Implementation Plan

> Status: Blind is **broken end-to-end** in the current build. Garbage lines arrive, but the blackout never appears, the timer never counts down, and in online FFA the blind entries silently jam (or get dropped) in the queue. This plan diagnoses each broken link with file:line, sets Quadra as the quality bar, and lays out a phased fix that delivers a visible win fast.

---

## 1. Diagnosis — what's actually happening today

Tracing one blind attack through the full pipeline (generation → local route → online route → consumption → decrement → render):

| Link | Status | Where |
|---|---|---|
| Generation (local + online) | Works | `garbage.js:200-209` (`blind`), `garbage.js:237-246` (`full_blind`) |
| Local routing (enqueue) | Works but **lossy** | `multi-player-state.js:709-725` |
| Local consumption | **Broken (not wired)** | `main.js:4810-4825`, `4836-4837` |
| Timer decrement | **Missing everywhere** | no decrement of `blindTimers` anywhere in `src/` |
| Rendering / blackout | **Missing entirely** | zero `blindTimers` refs in `src/rendering/` |
| Online routing (FFA) | **Broken (no consumer)** | `ffa-p2p-game-state.js:1124-1141` |
| Online encoding | **Lossy** (type + duration dropped) | `binary-encoding.js:430-431`, `913` |
| Legacy local path | Works (but unused) | `multiplayer.js:133-134`, `236-252` |

### Root causes (priority order)

1. **Current local path never consumes blind entries.** `LocalMultiplayerMode` spawns via `main.js`'s `spawnPiece` callback → `drainGarbageEntries()` (`main.js:4810-4825`), which only calls `queue.dequeueLineBurst()`. That returns `[]` when the head entry isn't `'line'` (`garbage.js:761-767`) and **never** calls `takePendingBlindEntries()` (`garbage.js:753-759`). So blind entries sit at the queue head and also **block any line entries behind them**. The working consumer (`multiplayer.js:133-134`) is on the legacy `MultiplayerState` path that `LocalMultiplayerMode` doesn't use.
2. **The blackout is never rendered.** `applyBlindEffect`/`applyFullBlindEffect` (`multiplayer.js:236-252`) write `blindTimers`/`piece.blindTime`, but **nothing in `src/rendering/` reads them.** `drawBoardFromGrid()` (`base-board-scene.js:734-828`) only branches on `cell.type`; `update()` and `renderGameState()` never touch blind state. No overlay layer exists.
3. **Timers are write-only.** `blindTimers` is init'd (`game.js:457-460`), reset (`game.js:519-522`), set by the apply fns, and **never decremented anywhere** — once set it would stay forever. `piece.blindTime` is set but never read.
4. **Local enqueue drops the duration.** `multi-player-state.js:711-721` enqueues `{ type, sourcePlayerId, attackId }` — **no `duration`**. So the legacy consumer (`applyBlindEffect(gameState, entry.duration)`) would get `undefined` and early-return (`multiplayer.js:237`).
5. **Online FFA has no blind consumer.** `ffa-p2p-game-state.js insertPendingGarbage()` (host-only, `1124-1141`) calls only `dequeueLineBurst()`; no blind handling. Entries enqueued by `ffa-attack-router.js:343` jam the head exactly as in #1.
6. **Wire format is lossy.** `_encodeGarbageEntry()` (`binary-encoding.js:430-431`) packs type as a single bit (`'line'?0:1`) with no duration; `_decodeGarbageEntry()` (`binary-encoding.js:913`) reconstructs every non-line as `'other'`. `blind`/`full_blind` and their duration can't survive the wire.

**Net effect:** local blind jams the queue and renders nothing; online blind additionally can't survive the wire. The feature is effectively dead in every active path.

---

## 2. How Quadra does it (the bar)

- **Per-cell countdown.** `blinded[36][18]` `uint8_t` (`canvas.h:95`), separate from occupancy — a *render flag only*; never affects collision or clears.
- **Partial vs full are distinct.** `ATTACK_BLIND` obscures **only the incoming garbage rows** (each row carries `bon[].blind_time`, `canvas.h:105`, stamped at `player.cc:1483-1506`). `ATTACK_FULLBLIND` calls `blind_all()` (`canvas.cc:382-398`) to blind **every occupied cell** (`canvas.cc:429-433`).
- **Duration scaling differs.** BLIND uses `param` per row (PRESET param=30). FULLBLIND scales by attack size: `blind_all(nb*nc*param)` (param=12).
- **Decrement is time-quantized** (every 16 frames, pause-aware, `player.cc:56-66`). *Serenity should replicate the real-time duration, not the frame quantization.*
- **"Hidden but still solid."** A blinded occupied cell draws the background instead of its block (`canvas.cc:941,1017`) — invisible but fully collision-solid.
- **Graceful expiry** via a short reveal flash (`bflash`); round-end clears all blind (`game.cc:439-450`).
- **Shadow assist** — blind presets force the falling-piece shadow on (`canvas.cc:210-213`) so an obscured board stays playable.

Two ideas Serenity must adopt: **partial-blind obscures only the new garbage rows**, and **blinded cells are visual-only (board stays fully playable).**

---

## 3. Design — best-in-class Blind for Serenity

### 3.1 Data model — field-level timers + a per-cell mark (hybrid)

Keep the existing field-level `blindTimers` as the duration source of truth, add a lightweight per-cell/per-piece marker for partial-blind extent, and **do NOT** replicate Quadra's full `blinded[][]` countdown grid (it changes every tick and would defeat Serenity's dirty-flag static-layer cache at `base-board-scene.js:166,705`).

Extend `game.js:457-460`:
```
blindTimers = {
  field:      0,   // full-blind: seconds remaining, obscures whole locked stack
  fieldMax:   0,   // original duration, for fade math
  pending:    0,   // partial-blind: seconds remaining, obscures flagged garbage rows
  pendingMax: 0,
}
```
For **partial blind**, reuse the currently-dead `piece.blindTime` (`garbage.js:224`): set it on the inserted garbage pieces; render obscures those while `pending > 0`. For **full blind**, no per-cell data — one `field` timer drives a whole-board overlay.

> Open question (recommend, don't invent): partial-blind = **incoming garbage rows only** (Quadra) vs whole-board flash. Recommend Quadra semantics. If the owner prefers a whole-board flash, partial+full collapse into one overlay and the per-piece marker is unneeded.

### 3.2 Semantics
- **Partial (`type:'blind'`)** — obscure only this attack's garbage rows for `duration`s. Driven by `pending` + `piece.blindTime`.
- **Full (`type:'full_blind'`)** — obscure the entire locked stack (active piece + ghost stay visible) for `duration`s. Driven by `field`. Optionally size-scale duration like Quadra using the `param` from `garbage.js:140-144`.
- **Solid, not removed** — blind is render-only; collision/gravity/line-clear operate on `boardGrid`/`lockedPieces`, which blind never touches.

### 3.3 Time-based decrement (real dt, not frames)
Decrement in seconds of real time using the scene/loop `delta`. Single authoritative site per game state in the **logic loop** (deterministic, pause-aware) — rendering only reads timers:
```
decrementBlindTimers(gameState, dtSeconds):
  bt = gameState.blindTimers
  if bt.field   > 0: bt.field   = max(0, bt.field   - dt); if 0: bt.fieldMax = 0
  if bt.pending > 0: bt.pending = max(0, bt.pending - dt); if 0: bt.pendingMax = 0; clear piece.blindTime on garbage pieces
```

### 3.4 Local vs online
- **Local:** decrement in `LocalMultiplayerMode`'s loop; consume in `main.js`'s `spawnPiece` callback.
- **Online FFA:** apply **authoritatively on the host** (`ffa-p2p-game-state.js insertPendingGarbage`, `1124`), host decrements, and **include `blindTimers` in the snapshot** (`buildStateSnapshot()` ~`1542-1548`) so clients render from synced state.
- **Wire format:** widen `_encode/_decodeGarbageEntry` to carry type as ≥2 bits (`line`/`blind`/`full_blind`/`other`) + a duration byte; serialize `blindTimers` in snapshots. Until widened, FFA blind can't round-trip — Phase 3 codec gates online parity.
- **Event bus:** emit `BLIND_APPLIED`/`BLIND_EXPIRED` (same pattern as `EVENTS.PIECE_LOCK`, `main.js:4803`) for SFX/theme/renderer reactions.

---

## 4. Implementation steps — phased & concrete

### Phase 1 — Wire local consumption + timer decrement (makes blind *function*)
1. **Preserve duration on enqueue** — `multi-player-state.js:711-721`: include `duration: entry.duration` on the blind objects. (Root cause #4.)
2. **Consume blind in the active path** — in `drainGarbageEntries()` (`main.js:4810-4825`) or its caller (`4836-4837`), call `takePendingBlindEntries()` **before** `dequeueLineBurst()`; route `'blind'`→`applyBlindEffect`, `'full_blind'`→`applyFullBlindEffect` (reuse `multiplayer.js:236-252`, port onto `MultiPlayerState` if not reachable). Stamp `piece.blindTime = duration` on the garbage pieces inserted at `main.js:4845` for partial blind. (Root causes #1, #2-data.)
3. **Confirm the duration unit** at `garbage.js:140-144` (seconds vs centiseconds); convert once and comment it.
4. **Add `decrementBlindTimers(gameState, dt)`** and call once per tick from `LocalMultiplayerMode._startGameLoop` (skip while paused/stopped). (Root cause #3.)
5. **Reset on round start** — extend `game.reset()` (`game.js:519-522`) to zero `fieldMax`/`pendingMax` and clear lingering `piece.blindTime`.

*Exit:* blind no longer jams the queue; timers rise on attack and fall to 0 over `duration`. (Still no visuals.)

### Phase 2 — Render the blackout overlay (the visible win)
6. **Add a blind overlay layer** in `createGraphicsLayers()` (`base-board-scene.js:326-341`), aliased in `attachGraphicsLayerAliases()` (`346-350`), drawn above board but keeping the active piece/ghost visible.
7. **Draw it each frame** via a new `drawBlindOverlay()` from `renderGameState()` (`base-board-scene.js:697-719`); clear it in `update()` (`171-172`). Full → whole-board rect; partial → obscure cells of garbage pieces with `blindTime > 0`.
8. **Fade in/out** using `field/fieldMax` (and `pending/pendingMax`) for overlay alpha; keep piece/ghost full opacity.
9. **Don't break the dirty cache** — overlay lives on a *dynamic* layer (like `pieceGraphics`), not the cached static `boardGraphics`.

*Exit:* a received blind visibly blacks out the board (full) or new rows (partial), then fades — in local MP.

### Phase 3 — Online parity (encode / route / snapshot)
10. **Widen the codec** — `_encodeGarbageEntry` (`binary-encoding.js:424-441`): type ≥2 bits + duration byte; mirror in `_decodeGarbageEntry` (`911-925`); bump the format/version constant. (Root cause #6.)
11. **Add an FFA blind consumer** — `ffa-p2p-game-state.js insertPendingGarbage()` (`1124-1141`): `takePendingBlindEntries()` before `dequeueLineBurst()`, apply to `blindTimers` (shared helper). (Root cause #5.)
12. **Decrement on host tick** for each alive player.
13. **Snapshot the timers** — include `blindTimers` in `buildStateSnapshot()` (`1542-1548`) and apply on clients.
14. **Wire the client renderer** — feed synced `blindTimers` into the same `drawBlindOverlay()` via `multiplayer/board-panel.js`.

*Exit:* blind survives the wire, applies on host, syncs to clients, renders for all FFA players.

### Phase 4 — Partial-vs-full polish + tuning
15. **Full-blind duration scaling** — flat vs `param`-scaled (Quadra) using `garbage.js:140-144`; tune multipliers.
16. **Falling-piece assist** — force the ghost on while `field > 0` (Quadra parity).
17. **Expiry beat** — reveal flash on reaching 0 via `shared-effects.js`; emit `BLIND_EXPIRED`.
18. **SFX/theme reactions** — `BLIND_APPLIED` hook (`sound-effects.js`/`sound-manager.js`).

---

## 5. Rendering approach (the blackout)

Hook: a new `drawBlindOverlay()` from `renderGameState()` (`base-board-scene.js:697-719`) onto a **dedicated dynamic blind layer** (`createGraphicsLayers()` `326-341`), cleared each frame (`update()` `171-172`).

- **Full blind (`field > 0`):** one near-opaque rect over the visible play area (from `getVisibleRowRange()` + `blockSize`, cf. `734-744`); alpha = `min(1, field/fieldMax)`. Keep the active piece + ghost visible by drawing the overlay below the piece layer (or redrawing the piece/ghost on top). Lowest-risk; matches "obscure the stack, not the controls."
- **Partial blind (`pending > 0`, full inactive):** obscure cells of garbage pieces with `blindTime > 0` — **per-piece rect (recommended, cheap)**: iterate `lockedPieces`, fill cells of garbage pieces at the fade alpha. (Or a coarser per-row band.) Avoid a per-cell countdown grid (breaks the static dirty cache).
- **Fade:** alpha from `field/fieldMax`/`pending/pendingMax`; ease the last ~0.3s for a smooth reveal; optional one-frame brighten (Phase 4).
- **Playability:** overlay touches *only graphics* — `boardGrid`/`lockedPieces`/collision/clears are never read or modified by blind.

---

## 6. Edge cases & testing

**Edge cases:** multi-round/rematch reset (`game.reset()` zeroes all four timers + clears `piece.blindTime`); simultaneous blind + garbage (blind taken before lines unblocks the queue); stacking blinds (`Math.max` extends, update `*Max`); full supersedes partial; blind on dying/dead player (guard `isAlive`/`isGameOver`, FFA already guards `1128`); pause (decrement skips while `isStopped`); host migration (timers are snapshotted; new host inherits, else fail-safe clear); codec version compatibility.

**Tests:**
- *Unit — queue ordering* (`garbage.js`): `takePendingBlindEntries()` then `dequeueLineBurst()` returns blinds first and unblocks lines.
- *Unit — apply/decrement* (`multiplayer.js`): apply sets `pending`/`field`+`*Max`; `decrementBlindTimers(dt)` drains over `duration`, respects pause.
- *Unit — codec* (`binary-encoding.js`): encode→decode preserves `type` and `duration`.
- *Integration — local* (`src/core/__tests__/`, beside `multi-player-handicap.test.js`): blind attack obscures then clears; lines behind a blind still insert.
- *Integration — FFA* (`ffa-p2p-game-state.js`): host consumes/decrements/snapshots; client applies.
- *Render smoke (if harness allows):* `drawBlindOverlay()` draws when timers > 0, nothing at 0, leaves static dirty flag untouched.

---

## 7. Effort & sequencing

| Phase | Scope | Rough effort | Delivers |
|---|---|---|---|
| **1 — Local consume + decrement** | enqueue duration, wire `takePendingBlindEntries` in `main.js`, `decrementBlindTimers`, reset | **~0.5–1 day** | Blind stops jamming; timers behave. Foundation. |
| **2 — Render blackout** | blind layer, `drawBlindOverlay()`, fade, keep piece playable | **~1–1.5 days** | **First visible win** — blind actually works locally. |
| **3 — Online parity** | widen codec, FFA consumer, host decrement, snapshot, client render | **~1.5–2.5 days** | Blind works in online FFA. Highest-risk (netcode + codec versioning). |
| **4 — Polish + tuning** | full-blind scaling, ghost assist, expiry flash, SFX/events | **~0.5–1 day** | Quadra-grade feel. |

**Order: 1 → 2 → 3 → 4.** Phases 1+2 make blind real and *visible* locally with least risk (fastest answer to "is it working?"). Phase 3 is heaviest/riskiest (codec + host authority + versioning) — do it once the mechanic and renderer are proven. Phase 4 is independent polish.

### Load-bearing files
- Generation/queue: `src/core/garbage.js` (`140-144`, `200-209`, `237-246`, `753-778`)
- Local route: `src/core/multi-player-state.js` (`709-725`)
- Local consume (active, broken): `src/main.js` (`4810-4825`, `4836-4837`, `4845`)
- Legacy consume + apply: `src/core/multiplayer.js` (`133-134`, `236-252`)
- State/timers: `src/core/game.js` (`457-460`, `519-522`)
- Rendering: `src/rendering/phaser/base-board-scene.js` (`143-193`, `326-350`, `697-719`, `734-828`); online panel `src/rendering/phaser/multiplayer/board-panel.js`; effects `src/rendering/phaser/shared-effects.js`
- Online FFA: `src/core/multiplayer/ffa-p2p-game-state.js` (`1124-1141`, `1542-1548`); router `src/core/multiplayer/ffa-attack-router.js` (`329-343`)
- Wire codec: `src/core/network/binary-encoding.js` (`424-441`, `911-925`)
- Tests: `src/core/__tests__/`

### Decisions for the owner (unverified)
- **Duration unit** (seconds vs centiseconds) — confirm at `garbage.js:140-144` before Phase 1.
- **Partial-blind semantics** (incoming rows only vs whole-board flash) — recommend Quadra's rows-only; confirm before Phase 2.
- **Full-blind size scaling** (flat vs `param`-scaled) — decide in Phase 4.
- Whether the active `MultiPlayerState` exposes `applyBlindEffect`/`applyFullBlindEffect` or they must be ported from `multiplayer.js` — verify in Phase 1 step 2.
