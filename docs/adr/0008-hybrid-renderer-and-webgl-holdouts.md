# 0008 - Hybrid Renderer Split and WebGL Holdouts Are Intentional

- **Status:** accepted
- **Date:** 2026-07-09
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md Phase 7

## Context

The review found both WebGPU/TSL themes and deliberate WebGL fallback paths. Treating every
ShaderMaterial as accidental debt would break backend compatibility and misread the live
renderer strategy.

## Decision

Keep the hybrid renderer split explicit. WebGPU/TSL is the preferred path for new
high-end theme/chapter work, but WebGL holdouts and fallback paths remain valid when they
are named, backend-gated, and covered by the visual validation workflow.

## Consequences

- Phase 7 is a dual-maintenance retirement program, not a blanket WebGL deletion.
- A WebGL path may stay when it is the compatibility path or the cost of porting exceeds
  its player value.
- New renderer work must declare whether it is WebGPU-primary, WebGL fallback, or
  permanently WebGL.

## Enforcement

Theme/Odyssey changes follow AGENTS.md/CLAUDE.md visual validation. Phase 7 inventory work
should record backend ownership and retirement criteria before removing fallback code.
