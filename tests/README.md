# Test suite

Every test file in this repo runs in CI, or it doesn't exist — that is the
Phase 2.6 contract from `docs/ARCHITECTURAL_REMEDIATION_PLAN.md`. `npm test`
(vitest) is a hard CI gate.

## Layout

- `tests/unit/**/*.test.js` — the unit suite (vitest include glob).
- `src/**/*.test.js` — colocated tests (also in the vitest glob), used by
  Odyssey chapter environments and similar rendering-adjacent pins.

Anything that does not match those globs is dead weight: the 2026-07 triage
deleted ~110 unrun files (phase-completion pins of long-shipped theme work,
mock-against-mock "integration" tests, and stale browser benchmark pages).
Do not add `test-*.js` files — name new tests `*.test.js` so the runner picks
them up, and let a failing pin be fixed or deleted, never orphaned.

## Performance measurement

Perf work does not live here. Use the playground (`npm run dev:playground`)
with per-theme capture/baseline scripts under `scripts/`, and the §9 perf
budgets (`perf-budgets.json`, Phase 3d) once landed.
