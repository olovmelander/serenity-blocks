# Two-Machine Steam Validation Checklist

*Remediation plan Phase 1.7. This defines what "validated on real Steam" means — the
plan's most-cited release precondition. A release-candidate claim requires one full
recorded run of this checklist (see the Run Log at the bottom).*

## Method (solo-feasible)

- **Machines:** laptop + desktop on the same Steam account family (two accounts with the
  app, or Steam Family; Spacewar 480 works for pre-AppID drills but a real-AppID run is
  required before release).
- **Tier 0 first — mock transport:** every scenario below is first exercised cheaply with
  the in-process mock/BroadcastChannel transport (`?localMpTest=1` / `serenity.localMpTest`)
  so two-machine time is spent *confirming*, not exploring.
- **Flag matrix, not one-session-per-flag:** one two-machine session validates a named
  flag combination (see § Flag matrix). Record which combination each run used.
- **Instrumentation:** keep `netDiag` on (default). Before and after each scenario,
  snapshot the `netDiag` counters on both machines (screenshot or console copy).

## Preconditions (every run)

| # | Check | Pass |
|---|---|---|
| P1 | Identical build hash on both machines (`git rev-parse HEAD`; packaged: build id in support/startup log) | hashes equal |
| P2 | `npm run check:release-gates` green on the build's commit | exit 0 |
| P3 | `localStorage['serenity.netImpair']` unset on BOTH machines (unless scenario E) | unset |
| P4 | Graphics tier + refresh rate recorded per machine | recorded |

## Scenarios

### A — 10-minute 2-peer soak (DAS + cascade storms)
Host on machine 1, join from machine 2. Play a real 10-minute match with sustained
DAS-held movement (hold left/right through spawns) and deliberate cascade storms
(stack for multi-wave clears) on both boards.
**Pass:** `desyncsDetected == 0` and `resyncRequestsSent == 0` (desync-triggered) on both
machines; `deltaDecodeFailures == 0`; final board digests match on both ends for both
players; no console errors; no visible opponent-board stutter > 1 s.

### B — Forced divergence → exactly one clean resync *(pairs with Phase 1.2)*
Mid-match, on the peer machine force a divergence from DevTools:
`window.__getFfa().players.get(<ownId>).score += 1000` (or mutate a grid row), then
keep playing ≥ 10 s.
**Pass:** exactly **one** `forceLocal` resync fires (netDiag `desyncRecoveries` +1, not
more); the board visibly self-corrects within ~1 s; play continues clean for 2 min after
(`desyncsDetected` does not climb — no oscillation).

### C — Host migration mid-match
Kill the host process (Task Manager, not graceful quit) during active play with garbage
in flight.
**Pass:** election completes ≤ 10 s; new host announced on the survivor; match continues;
`migrationEpoch` adopted when the flag is on (no stale-epoch packets applied); **no
duplicate garbage** lands after migration (compare pending-garbage counts before/after);
no double-application of buffered inputs.

### D — Disconnect → rejoin inside the causal window
Peer alt-F4s and rejoins the same lobby within ~30 s while the match is running
(requires `downloadJoin` in the matrix).
**Pass:** rejoin lands as the same player (attribution/frags preserved), board adopted
from the idle-window snapshot, no stuck `awaitingSpawn`, `deltaDecodeFailures == 0`.

### E — Impairment matrix (dev-gated harness)
On ONE machine set `?netImpair=lossy` (5 % loss) then a second pass with jitter ~100 ms
(`?netDelay=100&netMinDelay=50&netMaxDelay=200`). Play 5 min per pass.
**Pass:** gameplay remains playable; `resyncRequestsSent ≤ 1` per 5-min pass;
`deltaDecodeFailures == 0`; recovery always converges (no permanent drift). Confirm the
harness reports **inert** on the unimpaired machine (Phase 1.4 gate).

### F — Spectator + drop-in join during an active cascade
Third participant (or the rejoining machine) joins as watch-only spectator during a
cascade storm; then a drop-in join (flag on) also during a cascade.
**Pass:** join is deferred to the next idle window (no mid-cascade snapshot adoption);
spectator sees frozen-piece-free boards (RAF fix holds); drop-in spawns cleanly on the
next round/idle point; host `pendingResyncs` drains to 0.

## Flag matrix

One session validates a combination. Suggested ladder (record actual):

| Matrix id | Flags on top of defaults |
|---|---|
| M0 | defaults only (peerLocalSim/localBoardHold/holdStats/garbage* = on, rest off) |
| M1 | M0 + `migrationEpoch=1&readyBarrier=1` |
| M2 | M1 + `downloadJoin=1` (enables scenario D/F drop-in) |
| M3 | M2 + `simTickNetcode=1&adaptiveInputJitter=1&adaptiveInterp=1` |

## Pass/fail counter reference (netDiag deltas per scenario)

- `deltaDecodeFailures`: **0** in every scenario.
- Desync-triggered resyncs: **0** (A, C, D, F); **exactly 1** (B); **≤ 1 per 5-min pass** (E).
- Snapshot bytes p95: within `perf-budgets.json` once baselined (record the number now).
- Reliable-message rate: record; no sustained growth over the soak.

## Run log

| Date | Build hash | Machines | Matrix | Scenarios passed | Notes |
|---|---|---|---|---|---|
| — | — | — | — | — | *no full run recorded yet* |
