# Serenity Blocks — Peer Local-Board Glitch: Root Cause & Quadra-Aligned Fix

## 1. Root cause (one paragraph)

The peer's own falling piece is **not locally authoritative** — it is destroyed and rebuilt from a stale, latency-lagged host snapshot every reconcile cycle. On each `syncFromHost`, `_applySnapshotState(state, { reconcileLocal: true })` runs with `shouldApplyBoardState` true for the local player (`ffa-p2p-game-state.js:2653-2654`) and wholesale-assigns `player.gameState.currentPiece = { ...playerData.currentPiece }` (`:2665-2667`) plus `dropCounter`/`dropInterval`/`nextPieces` (`:2674-2676`). This clobbers the locally-predicted piece's **x and rotation** with the host's value from ~1 RTT ago. The recent jitter fix only re-asserts the predicted **Y** (`:2270-2275`) — x and rotation are left snapped to the stale authoritative state. `_reconcileLocalPlayer` (`:2281-2319`) is supposed to repair this by replaying unacked inputs, but its replay calls `_applyInputToPlayer` which **early-returns** (buffering, not applying) whenever `gameState.isProcessingPhysics || !gameState.currentPiece` (`:1190-1207`). Because the peer runs its own local gravity/lock (`unified-game-loop.js:187` → `game.js:1034` sets `isProcessingPhysics = true` during the lock/line-clear animation), any snapshot that lands inside a local lock window has its corrective rotate/move replays **silently swallowed**, leaving the piece pinned at the host's stale x/rotation = the visible snap. Quadra has no such path: the local piece is a pure deterministic local simulation that the network never reads back (`player.cc:499` self-applies the lock from a locally-built packet; `net.cc:1090` skips the originator on rebroadcast).

## 2. Recommended fix — local player owns its own falling piece

**Principle (mirror Quadra):** the peer's *active falling piece* (`currentPiece` x / rotation / y / dropCounter) is **never overwritten** by a reconcile snapshot. The host snapshot is authoritative only for: the **settled board grid**, **garbage queue**, **score/lines/frags/alive**, and **piece-lock transitions** (when the host says the local player's piece locked, that is the one moment the peer adopts the host's resulting board + next piece). The continuously-falling piece is simulated locally and only *reconciled on detected divergence*.

### 2a. Stop overwriting the local active piece in `_applySnapshotState`

The single load-bearing change. The current code overwrites `currentPiece` for the local player under `reconcileLocal`.

**Before** (`ffa-p2p-game-state.js:2659-2677`):
```js
if (shouldApplyBoardState) {
    // Update full board state for opponent rendering
    if (playerData.grid) {
        player.gameState.boardGrid = playerData.grid;
        player.gameState.grid = playerData.grid;
    }
    player.gameState.currentPiece = playerData.currentPiece ? {
        ...playerData.currentPiece,
    } : null;
    player.gameState.lockedPieces = playerData.lockedPieces || [];
    player.gameState.boardCache = null;
    player.gameState.boardCacheDirty = true;
}

if (shouldApplyBoardState) {
    player.gameState.dropCounter = playerData.dropCounter || 0;
    player.gameState.dropInterval = playerData.dropInterval || 1000;
    player.gameState.nextPieces = playerData.nextPieces ? [...playerData.nextPieces] : [];
}
```

**After** — split "board ownership" (always adopt) from "active-piece ownership" (local-only owns it):
```js
// The local player OWNS its falling piece (Quadra model: pure local sim,
// never read back from authority mid-fall). The host snapshot is authoritative
// for the SETTLED board, but not for the live currentPiece x/rotation/y.
const ownsLocalPiece = isLocalPlayer && reconcileLocal && !forceLocal;

if (shouldApplyBoardState) {
    // Settled board grid IS authoritative even for the local player (garbage,
    // host-side locks of OTHER pieces, line clears). Adopt it always.
    if (playerData.grid) {
        player.gameState.boardGrid = playerData.grid;
        player.gameState.grid = playerData.grid;
    }
    player.gameState.lockedPieces = playerData.lockedPieces || [];
    player.gameState.boardCache = null;
    player.gameState.boardCacheDirty = true;

    if (ownsLocalPiece) {
        // Do NOT clobber the locally-simulated falling piece. Only reconcile
        // it if it has actually diverged or the host reports a lock transition.
        this._reconcileLocalPiece(player, playerData);
    } else {
        // Opponents (and forceLocal hard-resync) adopt the snapshot piece verbatim.
        player.gameState.currentPiece = playerData.currentPiece ? {
            ...playerData.currentPiece,
        } : null;
    }
}

if (shouldApplyBoardState && !ownsLocalPiece) {
    player.gameState.dropCounter = playerData.dropCounter || 0;
    player.gameState.dropInterval = playerData.dropInterval || 1000;
    player.gameState.nextPieces = playerData.nextPieces ? [...playerData.nextPieces] : [];
}

if (ownsLocalPiece) {
    // dropInterval (speed) is still authoritative — adopt it without touching
    // dropCounter (which drives the local gravity phase we want to keep smooth).
    player.gameState.dropInterval = playerData.dropInterval || player.gameState.dropInterval || 1000;
    // nextPieces: adopt only if the queue grew/changed identity, else keep local.
    if (playerData.nextPieces && !this._sameNextQueue(player.gameState.nextPieces, playerData.nextPieces)) {
        player.gameState.nextPieces = [...playerData.nextPieces];
    }
}
```

### 2b. New `_reconcileLocalPiece` — adopt only on divergence or lock transition

Add this method next to `_reconcileLocalPlayer` (`~:2320`). It replaces the blanket overwrite + Y-only re-assert with explicit divergence detection.

```js
/**
 * Reconcile the LOCAL falling piece against the host snapshot WITHOUT
 * clobbering smooth local control. Adopt the authoritative piece only when:
 *   (a) the host reports a NEW piece (type/spawn changed → a lock happened), or
 *   (b) the locally-simulated piece has genuinely DIVERGED from where the host
 *       believes it is (illegal in the freshly-adopted grid, or x/rotation drift
 *       beyond the reconciliation that replaying unacked inputs can repair).
 * Otherwise keep the local x/rotation/y exactly as predicted.
 */
_reconcileLocalPiece(player, playerData) {
    const gs = player.gameState;
    const local = gs.currentPiece;
    const host = playerData.currentPiece ? { ...playerData.currentPiece } : null;

    // Host says no active piece (it just locked / line-clear in progress) but we
    // still have one locally → the host's lock is authoritative. Adopt host state
    // (incl. clearing the piece); local lock will re-sync on the next spawn.
    if (!host) {
        if (local) { gs.currentPiece = null; }
        return;
    }
    if (!local) { gs.currentPiece = host; return; }

    // (a) Piece IDENTITY changed → a lock/spawn boundary crossed on the host.
    // Adopt the new piece verbatim (this is the ONLY moment we hard-snap, and it
    // is a fresh spawn so there is nothing to "snap" visually).
    const hostLockSeq = playerData.lockSeq;
    const lockAdvanced = hostLockSeq != null
        && this._lastAdoptedLockSeq != null
        && hostLockSeq !== this._lastAdoptedLockSeq;
    if (host.type !== local.type || host.id !== local.id || lockAdvanced) {
        gs.currentPiece = host;
        this._lastAdoptedLockSeq = hostLockSeq;
        return;
    }
    this._lastAdoptedLockSeq = hostLockSeq;

    // (b) Same piece, still falling. Trust local x/rotation/y. The ONLY safety
    // net is hard divergence: the local pose is illegal in the freshly-adopted
    // authoritative grid (e.g. host inserted garbage / cleared lines under us).
    if (!canPlacePiece(gs, local, local.x, local.y)) {
        // Local pose no longer fits the new board. Snap to host as last resort
        // (rare; only on garbage/line-clear collisions), then let replay refine.
        gs.currentPiece = host;
    }
    // else: keep local x / rotation / y untouched. No snap.
}
```

`_sameNextQueue` is a trivial helper comparing the queue's piece types (length + element identity); keep it cheap so it can run per-snapshot.

### 2c. Fix the swallowed-replay hole so reconciliation can never get stuck

Even with (2a/2b), the divergence path in (b) and the existing `_reconcileLocalPlayer` replay both go through `_applyInputToPlayer`, which buffers-and-drops during `isProcessingPhysics`. Gate reconciliation so it only runs when the piece is actually steerable; otherwise defer it one tick.

**Before** (`syncFromHost`, `:2263-2264`):
```js
this._applySnapshotState(state, { forceLocal: false, reconcileLocal: true });
this._reconcileLocalPlayer();
```

**After:**
```js
this._applySnapshotState(state, { forceLocal: false, reconcileLocal: true });
// Replaying unacked inputs is meaningless (and gets silently swallowed at
// _applyInputToPlayer:1190) while the local piece is mid-lock or absent.
// Skip the replay this cycle — the board grid was already adopted, and the
// next spawn re-bases the local sim cleanly.
const lp = this.players.get(this.localPlayerId);
if (lp?.gameState?.currentPiece && !lp.gameState.isProcessingPhysics) {
    this._reconcileLocalPlayer();
}
```

With the active piece no longer overwritten (2a), the Y-only re-assertion block (`:2270-2275`) becomes **dead code and should be removed** — we now preserve x, rotation, *and* y by simply not clobbering them.

## 3. Divergence-detection safeguard (cannot permanently desync)

Three layers, cheapest first:

1. **Per-snapshot local legality** — `_reconcileLocalPiece` step (b): if the locally-simulated pose is illegal in the freshly-adopted authoritative grid (`canPlacePiece` false), snap to the host piece immediately. This handles garbage insertion / line clears landing under the falling piece. Cost: one `canPlacePiece` per snapshot (~30Hz), negligible.

2. **Lock-boundary re-base** — step (a): every host lock transition (`lockSeq` advance, already plumbed at `:2630`/`:2071`) hard-adopts the next spawn. Because a spawn is at the top with no prior visual position, this is a snap-free re-synchronization point that runs on *every piece*. The local sim therefore can never drift for longer than one piece's lifetime.

3. **Digest hard-resync (already present, keep it)** — `syncFromHost:2220-2247` already computes a state digest and, after 5 consecutive mismatches, calls `_requestResync()` (`:2324`). That path should set `forceLocal: true` on the resulting snapshot so the local piece *is* fully overwritten on a genuine, persistent desync. Verify `_requestResync` → resync snapshot routes through `_applySnapshotState(..., { forceLocal: true })` (the `ownsLocalPiece` guard in 2a already excludes `forceLocal`, so this works automatically).

Net: the local piece is trusted within a single piece's fall, validated against the real board every snapshot, hard re-based every lock, and force-corrected on sustained digest divergence. It is structurally impossible to stay desynced past one piece.

## 4. How this maps to Quadra

| Quadra (lag-free) | Serenity after fix |
|---|---|
| Local piece is a pure local sim; gravity advances in-frame (`player.cc:503`), moves/rotations mutate `canvas->bloc` immediately (`player.cc:151-210`). | `_applyLocalPrediction` (`:1538`) already applies input immediately; fix stops the snapshot from undoing it. |
| Network **never** reads back your falling piece — `net.cc:1090` skips the originator; only `P_MOVES`/`P_STAMPBLOCK` flow outward. | `_reconcileLocalPiece` never adopts the host's mid-fall x/rotation/y; host is authoritative only at lock/board/garbage. |
| Lock is **self-applied** locally from a locally-built packet (`player.cc:498-499` `sendtcp(&p); exec(new Player_stamp(canvas,&p))`). | Local lock runs via the peer's own `processAutoDrop`/`processPhysics` (`game.js:1034`); host lock only re-bases the *next* spawn (step a). |
| Determinism via shared seed (`game.cc:941-950` `c->rnd.set_seed(p->seed)`) means local == authoritative; no correction needed. | Serenity is host-authoritative not lock-step, so we *do* keep a correction path — but only on real divergence (step b) and lock boundaries (step a), not every frame. |
| Render x is **smoothed** toward the logical block column (`player.cc:462-476`, `side_speed` lerp) for snap-free motion. | Optional polish: lerp the local piece's *rendered* x toward its logical x in `renderAllPlayers` (see Risks). |

The fix makes Serenity's *local* piece behave exactly like Quadra's — owned locally, never overwritten — while retaining host authority over the settled board (which Quadra gets "for free" from determinism and Serenity must reconcile explicitly).

## 5. Risks + two-machine validation checklist

**Risks**
- **Garbage / line-clear under the falling piece.** Covered by step (b)'s `canPlacePiece` legality check; verify a garbage burst arriving mid-fall snaps cleanly rather than overlapping. This is the highest-value test case.
- **Lock-timing divergence.** If the peer's local lock fires a frame before/after the host's, `lockSeq` re-base (step a) corrects it on the next spawn; worst case is a one-piece-late board grid, self-healing. Confirm no double-lock or dropped piece.
- **`dropInterval` (speed) changes** from garbage/level-up must still be adopted (2a keeps this). Verify peer speeds up with level/garbage like the host.
- **Render smoothing (optional)** — if you add Quadra-style x-lerp, ensure it lerps the *display* position only and never feeds back into `currentPiece.x` (logical), or you reintroduce divergence.
- **`nextPieces` queue identity** — `_sameNextQueue` must not thrash; if it falsely reports "changed," you re-snap the preview but not the active piece (harmless). If it falsely reports "same," the preview lags — verify against a hold/garbage sequence.

**Two-machine validation checklist** (host + peer on separate machines, peer on a light theme to isolate the network path):
1. **Sustained DAS slide** — hold left/right across the full board on the peer; piece must glide with zero rubber-banding/snap-back. (Directly exercises the removed x-overwrite.)
2. **Rapid rotation spam** — rotate 10x/sec while falling; no rotation reverting to a previous orientation. (Directly exercises the removed rotation-overwrite + swallowed-replay fix.)
3. **Move-during-lock** — slide/rotate in the last 100ms before lock; input must register or cleanly no-op, never cause a visible jump. (Exercises the `isProcessingPhysics` replay-skip.)
4. **Garbage mid-fall** — opponent sends garbage while peer's piece is low; piece must re-seat legally, no overlap, no tunneling. (Exercises divergence step b.)
5. **High-latency soak** — throttle the peer's Steam connection (or add artificial 150-250ms); control must stay instant locally; only board/garbage may lag. (Confirms the local sim is decoupled from RTT.)
6. **Desync injection** — force a digest mismatch (e.g., drop 6 input batches); confirm `_requestResync` fires and `forceLocal` snaps the board back within ~1s, then control returns to smooth.
7. **Long match** — 5+ minute game; confirm no slow drift and the digest desync counter stays at 0 in steady state.
8. **Topout correctness** — peer tops out; host must agree (board/lock authoritative), no "ghost survive."

Add temporary instrumentation: log when `_reconcileLocalPiece` takes step (a)/(b) vs. keeps-local. In a healthy match, the overwhelming majority of snapshots should be "keep-local," with step (a) firing once per piece and step (b) near-zero. A high step-(b) rate means real divergence to investigate.

## 6. Is a deeper Quadra-style deterministic input-streaming rewrite worth it later?

**Not now; revisit only if the prediction model proves insufficient.** Quadra's zero-reconciliation elegance depends on **bit-exact determinism**: integer fixed-point block coordinates, a shared RNG seed driving the identical piece sequence on every canvas (`game.cc:941-950`), and a synchronous fixed-timestep step loop. Serenity's simulation is **float-based** and its physics is an **async Promise** (`game.js:1035` `processPhysics` returns a Promise; line-clear animations are time-based), so it is not trivially deterministic — a true lock-step port would require: (1) replacing float piece math with integer/fixed-point, (2) making `processPhysics` fully synchronous and frame-deterministic, (3) a shared seeded bag-RNG with guaranteed identical consumption order across machines, and (4) a fixed-timestep accumulator decoupled from render (which Quadra has at `quadra.cc:425-446` but Serenity does not). That is effectively a simulation rewrite, high-risk, and the **prediction-only fix in §2-§3 already delivers the user-visible goal** (instant, glitch-free local control) because it makes the local piece locally-owned — the same observable property that makes Quadra feel good — without requiring determinism. Defer the deterministic rewrite unless: divergence-driven snaps become frequent in real play (step-b rate stays high after the fix), or you later want **true peer-to-peer lock-step** (no host authority) for cost/latency reasons. If you do pursue it, the cheapest precursor worth doing independently is the **shared seeded bag-RNG**, since it removes piece-sequence as a divergence source and benefits the current model too.