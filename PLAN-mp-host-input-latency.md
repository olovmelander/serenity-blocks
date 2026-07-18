# PLAN-mp-host-input-latency — kill the host's ~33–50 ms input lag and MP's half-rate rendering

**Rank: 1 of 5. Do this first.**
Source of truth: `docs/ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18.md` §2.1, §2.2, §2.3 and P0 items 1–3.
Read that document's §2.1–2.3 and §3 (verified negatives) in full before touching code.

## Goal

Three verified, live-default-path defects make online MP feel worse than single-player,
especially for the host:

1. **(P0-1, severity high)** The host's own inputs are routed through its own jitter buffer
   (depth 2, advanced once per rAF), so every host tap/rotate/drop lands ~2–3 frames
   (~33–50 ms) late. Peers predict locally and don't feel this. Fix: host-local input
   bypasses the buffer and applies immediately.
2. **(P0-2, severity high)** `OnlineMultiplayerMode._handleRenderFrame` defers processing to
   a fresh `requestAnimationFrame`. Because the unified loop re-arms its own rAF *before*
   emitting `RENDER_FRAME`, this settles into a 2-frame cycle: all MP board/HUD rendering
   runs at **half the display rate**. Fix: process synchronously when the event comes from
   the loop's own frame.
3. **(P0-3, severity medium)** The jitter buffer's cursor advances once per rAF frame, not at
   its configured 30 Hz. "Depth 2" therefore means 2 *display frames* (~14 ms at 144 Hz,
   unbounded during hitches, burst-release after a hitch). Fix: advance it from a wall-clock
   accumulator at `tickInterval`.

All three are back-ports of semantics the dark fixed-tick path
(`src/core/multiplayer/ffa-fixed-input-adapter.js:111-127`) already gets right. Do **not**
touch the fixed-tick path itself; do **not** graduate any flags.

## Files to touch

| File | What changes |
|---|---|
| `src/core/multiplayer/ffa-p2p-game-state.js` | Host-local bypass in `processPlayerInput` (buffer branch ~line 1538); wall-clock accumulator where `processBufferedInputs`/`advanceTick` is driven from `onUpdate` (~line 3429/3500); set a marker on the `RENDER_FRAME` payload (`_renderPayload`, ~lines 211–226 / emit ~4035–4060) |
| `src/core/multiplayer/ffa-input-scheduling.js` | New helper logic goes here if it doesn't fit in a few lines (see line-ceiling guardrail) |
| `src/core/network/input-jitter-buffer.js` | Optional: an `advanceByWallClock(deltaMs)` helper next to `advanceTick()` (line ~255); `tickInterval` already exists (line 45) |
| `src/core/game-modes/OnlineMultiplayerMode.js` | `_handleRenderFrame` (~line 1830): synchronous processing for loop-frame events, keep rAF deferral for out-of-frame emitters |
| `tests/unit/input-jitter-buffer.test.js`, `tests/unit/ffa-adaptive-input-jitter.test.js` | Extend with pinning tests (new test files are also fine, e.g. `tests/unit/ffa-host-input-bypass.test.js`) |
| `docs/ARCHITECTURAL_REMEDIATION_PLAN.md` | One dated harvest note (step 0) |

## Guardrails (read before step 1)

- **Line ceiling:** `architecture-fitness.json` pins `lines:ffa-p2p-game-state` at **4690**;
  the file is at 4689 now. Net growth of ≥2 lines fails
  `node scripts/architecture-fitness-check.mjs`. Put any logic longer than a couple of lines
  into `ffa-input-scheduling.js` or `input-jitter-buffer.js` and call it. Never raise the
  baseline.
- **Gates that must stay green after every commit:** `npm test`, `npm run typecheck`,
  `npm run lint:ci` (shrink-only, 1458 max), `npm run check:boundaries`,
  `node scripts/architecture-fitness-check.mjs`.
- Several touched files carry `// @ts-check` (see `ts-ratchet.json`) — keep JSDoc types
  consistent or typecheck fails.
- Do not add new feature flags; the review explicitly classifies these as small live-path
  fixes needing no flag graduation.
- Land as **three separate commits**, one per fix, in the order below.

## Steps

### Step 0 — Governance harvest note
`docs/ARCHITECTURE_INDEX.md` says the review's P0 items must be harvested into the umbrella
plan before execution. Add a short dated note to
`docs/ARCHITECTURAL_REMEDIATION_PLAN.md` (a good spot is near §4.1 or as a new bullet in the
Phase 6A.1 area) saying: "2026-07-XX: executing ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18 P0
items 1–3 (host input bypass, synchronous RENDER_FRAME, wall-clock jitter cadence) on the
live path; see PLAN-mp-host-input-latency.md." Nothing more.

### Step 1 — Host-local input bypasses the jitter buffer (P0-1)
1. In `ffa-p2p-game-state.js`, find the buffer branch in `processPlayerInput`
   (`if (this.useJitterBuffer && this.inputJitterBuffer)`, ~line 1539). The host reaches it
   for its own input via `sendInput` → `processPlayerInput(this.localPlayerId, …)`
   (~line 1645).
2. Change the branch condition so the **host's own input skips buffering**:
   `steamId !== this.localPlayerId` must ALSO hold for the input to be buffered. When
   skipped, execution falls through to the existing "No jitter buffer: apply immediately"
   branch (~lines 1596–1610), which already builds the right callbacks
   (`buildPhysicsCallbacks` for local) and calls `acknowledgeFfaInput(player, data?.seq)`.
3. Do NOT duplicate the apply logic — reuse the existing immediate branch by falling
   through. The double-apply warning comment at ~1528–1537 only forbids applying in *both*
   places; a bypassed input is never inserted into the buffer, so it cannot double-apply.

**Edge cases a weaker model would miss:**
- Only the host processes its own input through `processPlayerInput`; peers use
  `_applyLocalPrediction` (early-returns for host). Don't touch the peer path.
- `data?.seq` is undefined for host-local input (seq is only assigned on the peer enqueue
  path). `acknowledgeFfaInput` must tolerate that — it already does; don't "fix" it.
- Remote peers' inputs MUST keep going through the buffer. The test in step 4 pins both.
- `inputValidator.trackInput` runs before the branch — it must still run exactly once.

### Step 2 — Synchronous `RENDER_FRAME` from the loop frame (P0-2)
1. In `ffa-p2p-game-state.js`, find where the `RENDER_FRAME` event payload is built/emitted
   from the loop's `onRender` (the pre-allocated `_renderPayload` at ~211–226, emitted
   ~4035–4060). Add a boolean field to the payload, e.g. `fromLoopFrame: true`, at the
   loop-frame emit site ONLY.
2. In `OnlineMultiplayerMode._handleRenderFrame` (~1830): if `detail.fromLoopFrame` is
   true, call `this._processRenderFrame(detail)` synchronously and clear any pending
   deferred state (`this._pendingRenderDetail = null`; leave `_renderFrameScheduled` as-is —
   the already-scheduled rAF callback must find `_pendingRenderDetail === null` and do
   nothing). Otherwise keep the existing rAF-batching path unchanged.
3. Search `OnlineMultiplayerMode.js` for other `_handleRenderFrame(` call sites (there is at
   least one internal one, ~line 1751, called with a hand-built `{ players }` detail) —
   those must keep the deferred path, i.e. must NOT set `fromLoopFrame`.

**Edge cases:**
- The rAF callback closure currently assumes `_pendingRenderDetail` is set; after this
  change it can legitimately be null — guard it (the existing `if (this._pendingRenderDetail)`
  already guards; verify, don't assume).
- Do not process the same detail twice in one frame: sync processing must null the pending
  detail *after* processing, and must not re-schedule.
- The payload object is **pre-allocated and reused** every frame. Adding a field is fine,
  but set it explicitly at every emit site that uses the shared object (a stale `true` left
  on the shared payload from a previous frame would mislabel an out-of-frame emit — set it
  to the correct value unconditionally wherever the payload is populated).

### Step 3 — Wall-clock jitter-buffer cadence (P0-3)
1. In `input-jitter-buffer.js`, add a method
   `advanceByWallClock(deltaMs)`: accumulate into `this._wallClockAccumulatorMs`, and
   `while (accumulator >= this.tickInterval)` do one `advanceTick()` and subtract
   `tickInterval`. **Cap the number of catch-up ticks per call at 4** and, when the cap is
   hit, discard the remaining accumulator (rebase — same doctrine as ADR-0012: overload
   rebases wall time). Without the cap, a long hitch or background tab releases a burst of
   buffered inputs at once — the exact "piece teleports" defect §2.3 describes.
2. In `ffa-p2p-game-state.js`, the current call path advances the buffer once per rAF
   (`processBufferedInputs` → `advanceTick`, driven from `onUpdate` ~3429–3431). Change the
   driver to pass the loop's frame delta (the loop provides delta ms to `onUpdate` — use
   that, NOT `Date.now()` deltas) into the wall-clock advance, then process due inputs once
   per advanced tick (i.e. inputs due for the cursor are drained after each `advanceTick`,
   not once per frame).
3. Leave `advanceTick()` itself untouched — the adaptive path and tests use it.

**Edge cases:**
- At 144 Hz, several frames pass with zero ticks — inputs must simply wait; nothing else
  polls the buffer. At 30 Hz-ish heavy frames, one frame may advance 2 ticks — both ticks'
  inputs must be drained in order.
- The `adaptiveInputJitter` flag path labels inputs differently
  (`ffa-input-scheduling.js:21-53`). Run its existing tests; behavior with the flag ON must
  not change except cadence.
- First call: initialize the accumulator field in the constructor (undefined + `+=` = NaN).

### Step 4 — Pinning tests (one per fix; write alongside each commit)
- **Host bypass:** host-mode FFA state with `useJitterBuffer` on: `sendInput('move', …)` →
  assert the local player's piece moved during the call (synchronous), AND that a subsequent
  `processBufferedInputs`/tick advance does not move it again (no double-apply). Also assert
  a remote peer's input (via `processPlayerInput('remote-id', …)`) is NOT applied
  synchronously but IS applied after a tick advance.
- **Sync render:** spy on `_processRenderFrame`; dispatch a detail with
  `fromLoopFrame: true` → processed synchronously, zero rAF used; dispatch without the
  flag → processed only after the rAF callback runs (use a rAF stub). Assert no
  double-processing when a deferred detail is pending and a loop-frame detail arrives.
- **Wall clock:** unit test on `advanceByWallClock`: 8 ms × 8 calls advances exactly 1 tick
  (33.3 ms interval → ~64 ms = 1 tick, accumulator retains remainder); one 500 ms call
  advances exactly 4 ticks (cap) and resets the accumulator.

## Acceptance criteria (verify each; all must pass)

1. `npm test` — all suites green including the three new pinning tests.
2. `npm run typecheck`, `npm run lint:ci`, `npm run check:boundaries`,
   `node scripts/architecture-fitness-check.mjs` all pass; `lines:ffa-p2p-game-state` not
   raised.
3. Grep-level proof of behavior: with `useJitterBuffer` default on, the code path for
   `steamId === localPlayerId && isHost` reaches `_applyInputToPlayer` without touching
   `inputJitterBuffer.addInput` (cite the test).
4. Three commits, messages referencing review §2.1/§2.2/§2.3 respectively.
5. Manual (if an interactive session is available; otherwise state it was skipped): a
   2-player mock-transport match (BroadcastChannel dev mode) shows host piece responding on
   the same frame as keydown, and opponent boards updating every frame. Test as host and as
   peer separately — the review warns the asymmetry hides regressions from one role.
