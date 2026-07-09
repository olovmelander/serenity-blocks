# 0005 - Do Not Add WASM Physics for the Puzzle Simulation

- **Status:** accepted
- **Date:** 2026-07-09
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md Phase 0.6

## Context

The core puzzle simulation is grid, timer, RNG, and event logic. The architectural review
found determinism, ownership boundaries, and orchestration debt; it did not identify a
physics throughput problem.

## Decision

Do not introduce a WASM physics engine or native physics layer for the puzzle simulation.
Keep simulation logic in the JavaScript deterministic core until a measured bottleneck
proves otherwise.

## Consequences

- The deterministic core stays inspectable, testable, and easy to replay in Vitest.
- The project avoids cross-language build, packaging, debugging, and determinism costs.
- Visual effects may still use GPU-side math or particle systems when they are observers
  of gameplay state.

## Enforcement

Architecture reviews for Phase 5/6 simulation work must reject new physics runtime
dependencies unless a benchmark and a replacement ADR are provided.
