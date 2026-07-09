# 0006 - No Simulation Worker Offload For Now

- **Status:** accepted
- **Date:** 2026-07-09
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md Phase 0.6 and Section 9 budgets

## Context

Moving the simulation into a Worker would add message serialization, ownership transfer,
debugging complexity, and new timing failure modes. The current measured risks are
architecture boundaries and boot/render orchestration, not a proven CPU bottleneck in the
core game loop.

## Decision

Keep the live puzzle simulation on the main thread for now. Revisit Worker offload only if
the Phase 9 performance budgets show repeated simulation-driven p95/p99 frame hitches or
resync-burst stalls after the deterministic core exists.

## Consequences

- Phase 5 can focus on deterministic state, fixed tick, replay, and mutation boundaries.
- Rendering and asset work still need their own budgets; this decision is not permission
  to put unbounded work on the main thread.
- A future Worker experiment needs a replay-compatible message contract and a new ADR.

## Enforcement

Phase 5/6 code reviews should reject Worker-based simulation paths unless the revisit
trigger is documented with traces and the protocol boundary is defined first.
