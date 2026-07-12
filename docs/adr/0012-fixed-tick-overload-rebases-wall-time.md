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

## Consequences

- Short stalls below 300 ms are time-conserving and drain over bounded callbacks instead of being
  silently dropped.
- Overload cannot create a catch-up death spiral or impossible gaps in replay/input tick IDs.
- A unilateral online warp can still require authoritative resync. Automatic warp recovery is a
  later netcode decision; this ADR defines only the deterministic local debt policy and telemetry.
- Any future true tick-skipping design must replace this ADR with complete timer, input, artifact,
  and resync semantics rather than incrementing counters in isolation.

## Enforcement

`tests/unit/fixed-tick-clock.test.js` pins the 299/300/301 ms boundary, accumulated debt, overload
telemetry inputs, and lossless bounded drainage. `tests/unit/ffa-p2p-game-state-input-hooks.test.js`
pins contiguous FFA tick IDs and the `sim_clock_warp` payload. The Electron entrypoint source tripwire
in `tests/unit/electron-background-throttling.test.js` pins the packaged-window timer policy.
