# Online Multiplayer Performance Review — why MP feels less smooth than single player

*2026-07-18, measured on `main` at `c086471` with all runtime flags at registry defaults
(`src/core/flags.js`). Method: five parallel code-review passes (local input latency, loop
pacing, render cost, main-thread network cost, opponent-board smoothness) with an
adversarial verification pass over every significant finding, plus a conformance check
against [ARCHITECTURAL_REMEDIATION_PLAN.md](ARCHITECTURAL_REMEDIATION_PLAN.md).
Each finding is labeled **[verified]** (independently re-derived from the tree by a second
pass), **[spot-checked]** (key mechanism confirmed, magnitude from the finder), or
**[finder-only]** (single-pass evidence; verification was interrupted). Line numbers are
from this snapshot and will drift — re-verify before executing.*

**Status: Reference (evidence).** Recommendations here should be harvested into the
umbrella plan / issues before execution, per the index rules.

---

## 1. Executive summary

The "MP is less smooth than SP" feeling is real, mechanical, and mostly **not caused by
the network**. On the default flag path:

1. **The host's own keystrokes are ~2–3 display frames late** (~33–50 ms at 60 Hz) because
   the host routes its *own* input through the remote-input jitter buffer (depth 2) with no
   local prediction, and the buffer advances once per rendered frame. Single player applies
   the same input synchronously in the keydown handler. This alone roughly doubles the
   host's input-to-photon latency vs SP — with zero network involved.
2. **Every MP board paints at half the display rate** (~30 Hz effective on a 60 Hz screen)
   because `RENDER_FRAME` handling defers to a *fresh* `requestAnimationFrame` from inside
   the loop's rAF, settling into a 2-frame cycle. SP draws synchronously in the same frame.
   Both host and peers feel this as judder on their own board, the opponents, the garbage
   meter and stats.
3. **Opponent boards on peers stutter by design**: 30 Hz snapshots played back on a
   packet-*arrival*-time timeline (quantized by a 16 ms receive poll) behind a fixed 90 ms
   delay with no extrapolation — so network jitter renders directly as speed-warble and
   freeze-then-teleport. Broadcasts also pause entirely during an opponent's cascade
   (change-gating sees no change), producing a freeze-then-snap on every line clear.
4. **MP frames carry work SP frames never pay**: the host builds, digests, base64-encodes
   (one string concat *per byte*) and IPC-sends full snapshot object graphs at 30 Hz inside
   the frame callback; peers `structuredClone` the full reconstructed world per received
   snapshot; four-plus concurrent rAF loops and a serial per-packet IPC poll compete for
   each 16.7 ms budget.
5. **Occasional MP-only hitches**: the host ACK-and-discards peers' hard/soft-drops that
   arrive during its ~100–300 ms async cascade-animation windows, silently diverging boards
   until the desync backstop fires a `forceLocal` resync — a visible full-board snap plus a
   beat of frozen input.

The single most important structural insight: **most of the cure is already implemented
and dark.** The fixed-tick program (plan §5.3), adaptive interpolation (§6A.1), and the
compact wire (§6A.4) all exist behind default-off flags, and the plan's own cutover ladder
(§5.0) says online MP should be the *first* mode to graduate `fixedTick`. In the meantime
there is a set of small, live-path fixes (§4 below) that need no flag graduation and would
close most of the gap.

Also worth knowing when triaging reports: **the experience is asymmetric.** The host
simulates every board locally at render rate (smooth opponents, laggy own input); peers
get instant own-piece prediction (responsive own input) but the snapshot pipeline for
opponents. A peer watching another *peer* stacks input-batch → host jitter buffer → host
sim → 30 Hz snapshot → 90 ms interpolation ≈ **150–250 ms behind reality**.

---

## 2. Confirmed root causes (live default path)

### 2.1 Host input routed through its own jitter buffer, no prediction — **[verified]** · severity: high

`src/core/multiplayer/ffa-p2p-game-state.js:1538` (buffer branch), `:1643-1645` (host
`sendInput` → `processPlayerInput` directly), `:1692-1694` (`_applyLocalPrediction`
early-returns for the host).

- `useJitterBuffer` defaults on (`:203`); the host-only buffer is built with
  `bufferDepth: 2` (`:198-202`; `input-jitter-buffer.js:32,53`).
- `processPlayerInput` routes **all** players — including `steamId === localPlayerId` —
  into the buffer; with `adaptiveInputJitter` off, `resolveFfaBufferedInputTick` labels the
  input with `buffer.currentTick` (`ffa-input-scheduling.js:21-27,50`; the local-player
  case at `:51-53` is unreachable behind the adaptive check).
- The cursor advances once per rAF `onUpdate` (`:3429-3431`, `advanceTick` at `:3500`), and
  the loop runs `onRender` *before* `onUpdate` (`unified-game-loop.js:180-198`), so a
  buffered input becomes visible ~2–3 frames after the keydown.
- SP comparison: `controls.js:629-649` → `SinglePlayerMode.js:727,775` applies the move
  synchronously in the event handler.
- Peers are unaffected — `_applyLocalPrediction` applies immediately and renders in the
  same frame (`:1672,1691-1707`).

**Impact:** every tap, DAS repeat, rotate and drop on the host lands ~33–50 ms late (worse
when fps drops — the delay is *frames*, not ms). Constant, clearly perceptible, and it
biases perception: whoever hosts feels MP as sluggish.

**Fix:** exempt the host's own input from the buffer branch on the legacy path (apply
immediately, exactly like the no-buffer branch at `:1593-1610`; the double-apply guard in
the comment at `:1528-1537` only requires not applying twice, not buffering). The dark
fixed-tick adapter already does this correctly (`ffa-fixed-input-adapter.js:111-127`).

### 2.2 MP renders at half the display rate (RENDER_FRAME deferral) — **[verified, corrected]** · severity: high

`src/core/game-modes/OnlineMultiplayerMode.js:1830-1843`.

`_handleRenderFrame` does not process the payload; it schedules a fresh
`requestAnimationFrame`. Because the unified loop re-arms its own rAF at the *top* of its
callback (`unified-game-loop.js:160`) before emitting `RENDER_FRAME`
(`ffa-p2p-game-state.js:3407,4035-4060`), the scheduled-flag pattern settles into a
2-frame cycle: `_processRenderFrame` (→ `mainBoardScene.syncFromGameState`, stats, garbage
meter, opponent interpolation) runs only **every other frame**. The payload holds live
`gameState` references (`:4036-4059`), so when it runs it renders fresh state — the defect
is **half-rate updates (+0.5 frame average latency) and visible judder**, not a flat
1-frame delay. SP draws synchronously in the same update (`game.js:1411-1412`,
`SinglePlayerMode.js:900-905`).

Note: the plan §4.1's "RENDER_FRAME is consumed un-throttled at
`OnlineMultiplayerMode.js:1216-1218`" is **stale** — it is now rAF-batched; the batching
itself is what causes the half-rate cycle.

**Fix:** process synchronously when invoked from the loop's own rAF (it already fires
exactly once per frame; the pre-allocated payload at `ffa-p2p-game-state.js:213-226` makes
the batching defense moot), keeping deferral only for out-of-frame emitters such as
`_applyLocalPrediction`'s mid-event emit.

### 2.3 Jitter-buffer cadence bound to display refresh, not its nominal 30 Hz — **[verified]** · severity: medium

`ffa-p2p-game-state.js:3500`, `input-jitter-buffer.js:255-257`.

`tickRate: 30` is passed at construction (`:198-202`) but never drives scheduling; the
cursor advances once per rAF frame. So "depth 2" = 2 *display frames*: ~33 ms at 60 Hz,
~14 ms at 144 Hz, unbounded during hitches (inputs then release in a burst — piece
teleports). The buffer is host-only, so the **host's** monitor and frame hitches set input
cadence for everyone's authoritative application (peers' feel is partially masked by
prediction; the host feels it raw).

**Fix:** advance the buffer from a wall-clock accumulator at its configured `tickInterval`
(exactly what the dark `simTickNetcode`/`fixedTick` path does via the setTimeout driver,
`unified-game-loop.js:209-251`).

### 2.4 Host snapshot build + encode + IPC inside the frame callback — **[verified]** · severity: medium

`ffa-p2p-game-state.js:3435-3437` → `maybeBroadcastPostPhysics` (30 Hz accumulator,
`:2316-2333`; `hasSignificantStateChanges` is ~always true while a piece falls because
`dropCounter` changes every frame, `:2301`).

Per broadcast, synchronously in-frame: `buildStateSnapshot` allocates a fresh object graph
per player — grids, `nextPieces`, `lockedPieces.map`, `garbageEntries.map`
(`:2177-2251`) — plus a string-built DJB2 digest (`:2257-2271`); then binary encode and,
with `wireV2` off, a JSON/base64 wrapper whose `_arrayBufferToBase64` string-concatenates
**one char per byte** (`steam-networking.js:640-744,794-801`); then one
`ipcRenderer.invoke('steam:sendP2PPacket')` **per peer** (`:764-788,477-483`). None of
this exists in an SP frame.

**Impact:** recurring 30 Hz-cadence allocation + IPC bursts on the host; on a loaded frame
this stretches frame time — which, via 2.3, *also stretches the host's input latency*.

**Fix (live path):** chunked base64 (or raw `Buffer` to the main process), scratch-object
reuse for snapshots (the `_renderPayload` pattern at `:211-226` proves it), one batched
IPC invoke for the peer fan-out. **Structural fix:** graduate `wireV2` (§6A.4 — built,
dark, ~8× wire reduction, kills base64/JSON entirely).

### 2.5 Four-plus rAF loops + serial per-packet IPC poll — **[verified]** · severity: medium

During a match the renderer runs: the unified loop's rAF (`unified-game-loop.js:160`), the
deferred RENDER_FRAME rAF re-armed every frame (`OnlineMultiplayerMode.js:1836`),
`OpponentWatchManager`'s always-on rAF (`opponent-watch-manager.js:116-117,680-687`), the
dedicated `Phaser.Game`'s internal rAF (`OnlineMultiplayerMode.js:1022`), plus the theme
loop (also in SP). On top: a `setInterval(16ms)` that **serially awaits one
`ipcRenderer.invoke` round-trip per packet** (`steam-networking.js:832-842`), a 500 ms
state-sync fallback and a 1 s host heartbeat. SP runs the game loop + Phaser + theme.

**Impact:** frame-time variance (roughness even at equal average FPS); ~0–16 ms+ pickup
latency quantization on every inbound packet, which the interpolator then inherits as
timeline jitter (see 2.7).

**Fix:** drive OWM from `_processRenderFrame` instead of its own rAF; fold the deferred
render into the loop frame (2.2); batch packet reads into one IPC invoke returning an
array.

### 2.6 Host ACK-and-discards peer drops during cascade windows → desync snap + input freeze — **[verified]** · severity: medium

`ffa-p2p-game-state.js:1437-1453` (drops `return false` during `isProcessingPhysics`;
moves/rotates queue capped at 4), `:3495` and `:1610` (sequence ACKed unconditionally even
when rejected — never retried), `physics.js:145,225,763-787` (the window is real wall
clock: 30/20/20 ms flash per wave + 16 ms/row gravity ≈ 100–300 ms per clear).

With `peerLocalSim` on (default), the peer's board is never re-based per frame
(`:2786-2790`), so a host-rejected-but-peer-applied drop silently diverges score/board
until the backstop (3 consecutive settled mismatches + 3 s rate limit, `:2375-2407`)
fires `_requestResync` → `forceLocal` adoption, during which `resyncInputFrozen` blocks
`sendInput` entirely (`:1639`; `resync-input-barrier.js:359-368`). The devs' own comment
at `:2382-2383` names "a host-dropped input" as a known trigger. (The backstop working as
designed is plan §1.2 done right — the problem is feeding it avoidable divergences.)

**Impact:** fast players who hard-drop through line clears occasionally get a full-board
teleport/rollback plus a beat of dead input — an MP-only hitch SP can never produce.

**Fix:** defer instead of drop — reschedule drop-inputs arriving during physics into the
buffer's next tick (it supports future ticks), or extend the input queue to hold drops;
the dark fixed-tick path already models this as `INPUT_DISPOSITIONS.DEFERRED_PHYSICS`
(`ffa-fixed-input-adapter.js:153-159,193-199`). Also reconsider the 4-entry queue cap for
remote bursts that arrive time-compressed.

### 2.7 Opponent interpolation: arrival-time timeline, fixed 90 ms, no extrapolation — **[spot-checked]** · severity: high for peers

`OnlineMultiplayerMode.js:115-116` (fixed `interpolationDelay: 90`; `adaptiveInterp` off),
`:1644-1649` (snapshots stamped with `receivedAt`), `snapshot-interpolation.js:158-159`
(delay applied against those timestamps), no extrapolation on buffer underrun (hold-last
then snap), burst recovery collapses spacing to 0.001 ms.

Because timestamps are packet-arrival times quantized/bunched by the 16 ms poll (2.5),
jitter renders directly as opponent-piece speed-warble and freeze-then-teleport. On top:

- **Cascade broadcast gap** [finder-only]: `hasSignificantStateChanges` fields
  (`:2280-2306`) are all static mid-cascade, so snapshots pause for the duration of a
  multi-wave clear → opponents freeze, then one big jump.
- **Grid double-feed** [finder-only]: the raw newest grid (30 Hz apply) and the ~90 ms
  delayed interpolated state write into the same objects → forward-flash/rollback flicker
  around opponent locks/clears. (`lockEvents` stays off precisely because grid-snapping
  locks fight the interpolator — the flag registry says so.)
- **Piece-boundary teleports** [finder-only]: new piece can appear up to a snapshot early;
  final descent is skipped; ≥5-cell moves snap (the `dx<5 && dy<5` heuristic).
- Loss behavior is bounded but visible: unreliable 30 Hz deltas against a ~250 ms reliable
  keyframe → freezes up to ~250 ms ending in a snap. [finder-only]

**Fix:** enable `adaptiveInterp` (dark, built — simTick-based timeline + jitter-sized
delay; registry gates it on the §6A.1 soak). For the cascade gap, add
`isProcessingPhysics`/a cascade-progress counter to the changed-fields list so mid-cascade
snapshots keep flowing. The structural cure is §6B.3 input-stream remote boards.

### 2.8 Opponent mini-board pipeline defeats its own dirty-check — **[spot-checked]** · severity: medium

`opponent-watch-manager.js` — own rAF loop (`:116-117,680-687`); the snapshot-interpolated
piece changes sub-cell position every frame, so the fractional dirty signature differs
every frame and each *watched* opponent gets a full-board connected-component repaint plus
a `getBoundingClientRect()` forced layout per repaint (`:1877`, confirmed in-tree; the
comment at `:902,936` shows this rect feedback has caused blowups before). Per-frame
unconditional DOM writes (frags `textContent`, inline styles, garbage-meter `innerHTML`)
interleave with those layout reads — classic layout thrash [finder-only]; peers run the
DOM update a second time at 30 Hz from the snapshot handler.

**Fix:** cache the rect (recompute on the debounced resize event), guard DOM writes on
change, quantize the piece signature for the *grid* layer and repaint only a piece overlay
at fractional positions, and drive the whole thing from `_processRenderFrame`.

### 2.9 Per-snapshot `structuredClone` of the full world — **[spot-checked]** · severity: medium (GC)

`snapshot-contract.js:20` — `hydrateBinarySnapshot` clones the entire reconstructed
snapshot on every receive; because deltas reconstruct full state before hydration, even a
44-byte delta pays full-world clone cost. Finder estimate: ~330 µs and ~38 KB retained per
4-player snapshot at 30 Hz ≈ ~1 MB/s allocation churn on peers → periodic GC pauses in the
p95/p99 tail (plan §9.5's exact concern). Each snapshot is then consumed twice (FFA
apply + `OnlineMultiplayerMode` normalize/interpolate/HUD) [finder-only].

**Fix:** clone only what is retained as the delta baseline; hand the interpolator/HUD a
read-only view.

---

## 3. Verified negatives (ruled out — don't spend time here)

- **The desync digest / netDiag / netEventLog diagnostics are not the problem.** With
  `peerLocalSim` on, the per-snapshot desync check is two integer compares
  (`:2386-2407`); the DJB2 digest is host-side ~100 chars/broadcast; netDiag is one
  stats-sort per second. Microseconds. **[verified]**
- **The plan's `_originalSize` per-broadcast `JSON.stringify` is really deleted**
  (§6A.4 groundwork note is accurate). **[verified]**
- **The JSON+base64 v1 wire's parse cost is small** (~tens of µs per snapshot) — the wire
  overhead matters for bandwidth (§6A.4's 11× envelope), but the *feel* cost on the
  receive side is dominated by the hydration clone (2.9), which `wireV2` alone will NOT
  fix. **[finder, partially verified]**
- **"MP sim runs at 30 Hz" is false** — the sim advances at rAF rate with variable delta,
  like SP. The 30 Hz cadence is only snapshots/broadcast. **[verified]**
- One refuted claim for the record: "render-before-update ordering adds a frame to DAS
  for every player" — false for peers (DAS repeats go through the same immediate
  prediction + same-frame render path as keydowns); only the host's buffer routing (2.1)
  is real. **[verified refutation]**

---

## 4. Recommendations, prioritized

### P0 — small live-path fixes, no flag graduation needed (days, mostly independent)

| # | Fix | Closes | Expected feel win |
|---|---|---|---|
| 1 | Host-local input bypasses the jitter buffer (apply immediately like the no-buffer branch) | 2.1 | Host input latency back to ~SP level — the single biggest win |
| 2 | Process `RENDER_FRAME` synchronously when emitted from the loop frame | 2.2 | All MP surfaces back to full display rate; kills the judder |
| 3 | Advance the jitter buffer on a wall-clock accumulator at `tickInterval` | 2.3 | Refresh-rate-independent, hitch-tolerant input pacing |
| 4 | Defer (don't ACK-and-discard) peer drops during `isProcessingPhysics`; revisit the 4-entry queue cap | 2.6 | Removes the board-snap + input-freeze hitch class |
| 5 | Keep snapshots flowing mid-cascade (add cascade progress to `hasSignificantStateChanges`) | 2.7 | Opponents stop freezing-then-snapping on every clear |
| 6 | Batch the receive poll into one IPC invoke; chunked/base-free encode; batched per-peer send | 2.4, 2.5 | Less frame-time jitter both ends; less arrival quantization |
| 7 | OWM: cache rect, change-guard DOM writes, piece-overlay repaint, drive from `_processRenderFrame` | 2.8, 2.5 | Cheaper MP frames, especially with 3–4 opponents watched |
| 8 | Hydration: stop `structuredClone`-ing the full world per snapshot | 2.9 | Fewer GC pauses on peers |

Items 1–4 fix code the dark fixed-tick path already gets right — they are back-ports of
its semantics to the legacy path, so they also de-risk the eventual cutover.

### P1 — graduate the dark flags the plan already built (per §6A.1's flag-matrix soak)

1. **`adaptiveInterp=1`** — simTick timeline + jitter-sized delay; directly targets 2.7.
   Lowest-risk graduation; it is receive-side only.
2. **`wireV2=1`** — ~8× smaller dominant packet, deletes base64/JSON from the hot path
   (2.4). Graduation gate: the §6A.4 two-peer soak; §6A.5 negotiation is already landed.
3. **`fixedTick` for online MP** — the plan's own cutover ladder (§5.0 step: *online MP
   first*) — subsumes P0 items 1/3/4 structurally, unifies the clock, and unblocks §6B.
   Requires the §5.10 differential gate; the FFA adapter, runner, input barrier and
   recovery paths are all landed dark and pinned by tests.

### P2 — structural (already sequenced in the umbrella plan; do not re-plan here)

- §5.2 `cascadeV2` cutover: removes the 330–400 ms cascade input dead-time (the largest
  measured input-latency defect, SP and MP alike) and shrinks 2.6's window to ≤1 tick.
- §6B.3 input-stream remote boards: opponents smooth at any latency; retires the
  snapshot-interpolation compromises (2.7) and the grid double-feed.
- §6A.8 backpressure/resync arbitration: bounds resync-burst hitches.

### Validation (so this doesn't regress silently)

- Capture the null baselines in `perf-budgets.json` that cover this surface:
  `reliableMsgsPerSec`, `busEventsPerSec`, `frameP95Ms` for the MP surface; add a
  **host-input-to-apply p95** metric (the 2.1/2.3 KPI) next to `cascadeInputLatencyP95Ms`.
- Every P0 fix lands with the pinning test named in its plan hook; run the §1.7
  two-machine checklist scenarios (a), (e), (f) before/after the P1 flag flips.
- When comparing feel, test **as host and as peer separately** — the asymmetry (§1) means
  a fix can help one role and be invisible to the other.
