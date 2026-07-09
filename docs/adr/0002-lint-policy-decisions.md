# 0002 — Lint policy: no-bitwise off, unresolved-import ignores, max-len warns

- **Status:** accepted
- **Date:** 2026-07-09
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md § Phase 0.3

## Context

After the 2026-07-09 layout autofix, three error classes remained that are *decisions*,
not cleanup:

1. **`no-bitwise` (265 errors, 30 files).** Airbnb bans bit operators to catch `&`/`&&`
   typos. In this codebase every hit is idiomatic game/graphics/netcode bit manipulation:
   CRC32 + binary wire encoding (`src/core/network/binary-encoding.js`, 62 hits), hex
   color packing/unpacking (`0xRRGGBB >> 16 & 255` across themes/rendering), seeded-hash
   mixing, and Phaser render masks. 30 scattered `eslint-disable` headers would be noise
   with no typo-catching value left.
2. **`import/no-unresolved` (154 errors).** Three false-positive families the resolver
   cannot see without configuration: `three/addons/*` (subpath exports of `three`),
   the Vite path aliases `@core|@rendering|@themes|@ui|@utils|@events` (vite.config.js
   `resolve.alias`), and Vite `?url` asset-suffix imports.
3. **`max-len` (≈1.1k).** Stays a *warning*: real readability signal, but not worth a
   thousand-line mechanical rewrap that would pollute blame for zero behavior value.

## Decision

- `no-bitwise: off` repo-wide, recorded here as a deliberate airbnb deviation.
- `import/no-unresolved` keeps error severity with an explicit `ignore` list for the three
  families above (kept in `.eslintrc.json` so the pattern list is reviewable in one place).
- `max-len` remains `warn` at 120 chars; the CI hard gate acts on **errors**.

## Consequences

- The remaining lint-error count reflects only genuine code-quality debt
  (no-unused-vars, no-param-reassign, prefer-destructuring, …) and can ratchet to zero.
- A typo'd alias import (e.g. `@utills/`) would no longer be caught by lint — Vite build
  failure and vitest cover that class.

## Enforcement

`.eslintrc.json` is the control; the lint-error-count ratchet
(`scripts/lint-ratchet-check.mjs`, hard in CI) prevents any rule-class from silently
regrowing, and the Phase 3d fitness harness pins the count so it can only shrink.
