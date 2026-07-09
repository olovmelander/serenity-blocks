# 0009 - Do Not Rebuild the Old Theme Code-generation Pipeline

- **Status:** accepted
- **Date:** 2026-07-09
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md Phase 0.6

## Context

The repository previously accumulated generated theme scaffolding and plan sprawl. The
current architecture favors explicit theme modules, shared helpers, and the playground
workflow for visual iteration.

## Decision

Do not recreate a broad theme code-generation pipeline. Prefer small shared helpers,
templates documented for humans, and playground effects that can be ported intentionally
into a theme or Odyssey chapter.

## Consequences

- Theme diffs remain readable and reviewable.
- Shared abstractions must earn their place by reducing real duplication.
- Repetitive visual experiments can still be automated locally, but generated code should
  not become an unreviewed source of truth.

## Enforcement

New code-generation tooling for themes requires a replacement ADR that explains the
review model, ownership, and deletion path.
