# 0007 - WebGPU/TSL Visual Changes Require Screenshot Validation

- **Status:** accepted
- **Date:** 2026-07-09
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md Phase 7 and AGENTS.md/CLAUDE.md

## Context

WebGPU/TSL failures can compile cleanly while rendering a blank canvas, validating
incorrectly on specific adapters, or freezing on this development machine's iGPU. Build
success is not enough evidence that a theme or Odyssey chapter works visually.

## Decision

Use the playground-first loop for WebGPU/TSL visual work. A theme or Odyssey chapter
change is not done until a screenshot has been captured, console/WebGPU validation errors
have been checked, and the proven effect has been ported into the real surface.

## Consequences

- Visual work carries a concrete artifact instead of relying on code review imagination.
- Work stays scoped to one small effect/session to avoid iGPU TDR crashes.
- Non-visual governance, CI, and backend changes are exempt unless they touch
  `src/themes/<id>/` or `src/rendering/odyssey/`.

## Enforcement

AGENTS.md and CLAUDE.md require the workflow. Future Phase 3/7 fitness checks may attach
screenshot artifacts for GPU-sensitive surfaces.
