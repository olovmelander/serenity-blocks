# 0012 — Fixed-tick overload rebases wall time, not tick IDs

- **Status:** accepted
- **Date:** 2026-07-12
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md § 5.3 (explicit catch-up/warp policy)

## Context

The fixed FFA runner executes at most five canonical ticks per timer callback. Its initial migration
policy also capped newly elapsed time at 250 ms and retained only one owed tick. A 250 ms callback
therefore simulated roughly 100 ms and silently discarded the rest, below the plan's stated 300 ms
overload boundary.

The plan's phrase “warp forward” is ambiguous. Jumping only `simTick` or `GameState.simFrame` would
create state that the simulation never produced. A real skipped-tick operation would also have to age
every integer timer, advance every jitter cursor, assign dispositions and ACKs to skipped input,
update peer projections, and serialize the discontinuity in match artifacts and resync snapshots.
Those semantics do not exist yet.

## Decision

Canonical simulation tick IDs remain contiguous. The runner may retain at most 300 ms of total
wall-time debt, execute at most five ticks per callback, and carry all retained debt across later
callbacks. Debt beyond 300 ms is discarded as a wall-time rebase and emits `sim_clock_warp` with the
requested, retained, and discarded durations. Merely having a catch-up backlog does not emit a warp
and does not discard time.

Pause/resume is a separate case: the timeout owner reanchors its monotonic origin, so paused time is
never submitted as simulation debt. Packaged Electron keeps the timer active in occluded windows via
`backgroundThrottling: false`; ordinary browsers are not claimed to provide that guarantee.

The default-off normal single-player adapter uses the same five-step/300 ms policy. Its existing
`FrameRateController` remains the sole timer owner, while a session generation plus exact `GameState`
identity fences stale logic/render callbacks across stop, restart, and mode replacement. Player-0
keyboard/gamepad edges drain inside `advanceTick`; fixed input-initiated drops carry the explicit
`{ fixedTick: true, inputPhase: true }` token and gravity carries `{ fixedTick: true }`. Pause clears
held canonical input before the timer origin is reanchored.

Normal single-player also latches its simulation-clock identity independently of the runtime flag, because
game-over teardown retires that flag before persistence runs. The unversioned local high-score table and
Steam leaderboards/aggregate stats accept only `legacy-variable-v1` sessions. Experimental fixed sessions
still finalize and auto-save their versioned demo and show an explicitly unranked session modal, but do
not query, present, or contaminate legacy result stores; unknown future clocks fail closed until §5.8
versions those sinks. Stop captures one immutable generation-stamped bundle containing the exact
`GameState`, simulation clock, demo, and demo ID. Restart waits for that teardown, deactivation waits before
clearing state, persistence consumes only the bundle, and stale generations cannot present result UI.

Infinity is the third default-off consumer of the same runner and overload policy. `FrameRateController`
remains the sole timer owner; the mode latches deterministic board-anchor spawning, per-player input
handling, reduced-motion hit-stop policy, and `fixed60-v1` into one generation-stamped session. Fixed
keyboard/gamepad commands drain inside `advanceTick`, and input-initiated drops carry the same explicit
timing token as normal single-player. Render is observer-only. The runner's `afterTick` seam computes
Infinity top-row truth, bounded expansion, row-reach stats, and the one-shot roof transition only while
async physics is stable, then hands `rowsAdded` to presentation-only camera compensation.

Infinity stop captures exactly `{ generation, gameState, simulationClock }`, synchronously retires the
timer and input owners, drains captured physics, and fences restart, deactivation, exploration, delayed
camera work, spawn, game-over, modal, and event continuations by generation. Flag-off starts still latch
`legacy-variable-v1`, so existing ranked behavior is unchanged; fixed or unknown clocks are unranked and
cannot write any local or Steam legacy sink until §5.8 versions those stores.
The remaining legacy BoardJuice global-input decoration is owned by a UI-layer identity adapter, not the
core mode, and disposal restores globals only while that exact adapter is still installed.

The timer-free single-board runner exposes an `afterTick` maintenance seam. It runs only while the
captured generation and exact `GameState` still own the session, after `advanceTick` completes and
before another catch-up tick begins. A stopped or replaced owner cannot receive the callback, and a
throwing callback consumes the completed tick's debt before the error propagates.

If a live online FFA **peer** discards wall-time debt, it requests an exact authoritative resync only
after all retained ticks in that callback finish and the captured round/run ownership still holds. The
request is suppressed while join/download/apply/input-barrier recovery is already active and is paced by
the transport and host cooldowns. The peer does not freeze input itself; the authenticated PREPARE token
continues to own freeze, retained-history flush, and release. A warped **host** remains the canonical state
owner and neither imports peer state nor proactively fans a large resync burst to every peer. Any replica
that actually diverges from a host rebase uses the existing confirmed-digest path to request its own exact
recovery.

## Consequences

- Short stalls below 300 ms are time-conserving and drain over bounded callbacks instead of being
  silently dropped.
- Overload cannot create a catch-up death spiral or impossible gaps in replay/input tick IDs.
- Normal single-player and Infinity can exercise the canonical clock behind `fixedTick` without changing
  Odyssey, Local MP, DemoPlayer, or any flag-off legacy loop.
- Fixed-clock demo recordings use rules version 2.1 and are stamped `fixed60-v1`; legacy recordings
  remain version 2.0. The legacy DemoPlayer accepts explicit or
  missing `legacy-variable-v1` only and rejects fixed artifacts until a fixed replay adapter exists,
  so experimental recordings cannot be silently replayed under different clock semantics.
- A unilateral peer warp automatically enters the existing exact recovery transaction without inventing
  skipped simulation state. Host rebase recovery remains replica-initiated and digest-targeted, avoiding
  an unpaced N-peer reliable burst before §6A.8.
- Any future true tick-skipping design must replace this ADR with complete timer, input, artifact,
  and resync semantics rather than incrementing counters in isolation.

## Enforcement

`tests/unit/fixed-tick-clock.test.js` pins the 299/300/301 ms boundary, accumulated debt, overload
telemetry inputs, and lossless bounded drainage. `tests/unit/ffa-p2p-game-state-input-hooks.test.js`
pins contiguous FFA tick IDs and the `sim_clock_warp` payload. `ffa-clock-warp-recovery.test.js` pins the
peer/host ownership split, post-tick ordering, active-recovery guards, stale-round suppression, and the
request-to-PREPARE composition; `steam-networking-resync-request.test.js` pins transport cooldown and
telemetry. The Electron entrypoint source tripwire
in `tests/unit/electron-background-throttling.test.js` pins the packaged-window timer policy.
`single-player-fixed-tick.test.js` and `single-player-fixed-tick-mode.test.js` pin 30/60/144 cadence,
the same overload boundary, pause/stale-owner fences, player-0 adapter identity, legacy callback
shape, fixed drop tokens, and DemoPlayer exclusion. `demo-replay-clock.test.js` pins clock-stamp
compatibility and the fixed-artifact rejection gate. `single-player-result-compatibility.test.js` pins
the teardown-order clock latch, immutable bundle ownership, deferred physics/demo/save restart and
deactivation races, legacy persistence, and fixed/unknown fail-closed behavior. The focused game-over
modal suite (`game-over-modal-result-compatibility.test.js`) pins unranked markup, zero legacy
rank/stat/leaderboard access, and stale async presentation cancellation.
`infinity-result-lifecycle.test.js` pins exact frozen stop bundles, synchronous invalidation, deferred
physics/restart/deactivation races, generation-fenced callbacks, exploration pause ownership, delayed
camera/listener/input-wrapper cleanup, stale result suppression, legacy parity, and fixed/unknown
fail-closed results. `infinity-fixed-tick-mode.test.js` pins sole timer/input ownership, fixed drop tokens,
observer-only render, stable-only maintenance, expansion compensation, roof transition, legacy callback
parity, and hit-stop independence from live settings/theme tiers.
`infinity-fixed-tick-determinism.test.js` composes the real runner, seeded board-anchor spawn policy,
zero-wave fixed lock/spawn, and Infinity maintenance to an equal canonical projection at 30/60/144 Hz.
`legacy-board-juice-input-wrapper.test.js` pins active-session decoration and replacement-safe disposal.
`single-player-fixed-tick.test.js` additionally pins `afterTick`
ordering, stale/stop/replacement fencing, and throw/debt semantics;
`infinity-simulation-maintenance.test.js` pins the renderer-free Infinity truth seam.
