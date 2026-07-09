# 0003 - Incremental TypeScript via `@ts-check`

- **Status:** accepted
- **Date:** 2026-07-09
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md Phase 3a

## Context

The project is JavaScript-first, with a small TypeScript checking island over `src/core`
and `src/events`. A wholesale `.ts` conversion would create a broad, hard-to-review
mechanical diff before the architecture boundaries are stable.

## Decision

Adopt types incrementally with JSDoc and `// @ts-check`. Convert files only when a
specific boundary, protocol, or API contract needs stronger checking. Ratchet checked
coverage upward with explicit baselines instead of running a repository-wide codemod.

## Consequences

- Refactors can add type signal exactly where the risk is.
- The repository avoids a giant syntax migration while the netcode and simulation
  boundaries are still moving.
- Some type debt remains visible for longer.

## Enforcement

`npm run typecheck` gates the checked island. Phase 3a adds the pragma/type-coverage
ratchet and expands the checked surface as contracts are extracted.
