# 0010 — Tornado `.ts` files join the typecheck island; three stays untyped

- **Status:** accepted
- **Date:** 2026-07-10
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md § Phase 2.10 / 3a

## Context

`src/themes/tornado/**/*.ts` were the repo's only TypeScript source files, and
they were checked by **nothing**: outside the `tsconfig.json` include globs
(`src/core/**/*.js` + `src/events/**/*.js`), and unparseable by the ESLint
config (airbnb-base on the default espree parser, `eslint src --ext .js`). Vite
transpiled them with esbuild, which strips types without checking them.

three@0.181 ships no type declarations and `@types/three` lags the
node-material / TSL API — the same reason [ADR-0003](0003-incremental-typescript-via-ts-check.md)
keeps themes/TSL out of *semantic* type scope (screenshots are the safety net
for visual correctness).

## Decision

Fold `src/themes/tornado/**/*.ts` into the `tsconfig.json` `include`
(`allowImportingTsExtensions: true` for their `.ts` cross-imports). three's
imports (`three/webgpu`, `three/tsl`) resolve to bundled JS with no types, so
those surfaces degrade to `any` — but the tornado files' **own** classes,
params, and cross-file contracts are now type-checked. Do **not** add
`@types/three` to make them stricter without first confirming its TSL coverage;
a partial/lagging types package would produce false errors on valid TSL.

## Consequences

- The only `.ts` in the repo is no longer unchecked. Folding them in
  immediately surfaced two real defects: `private scene/camera/renderer`
  narrowing the (untyped JS) `BaseTheme` contract they inherit (TS2415 —
  BaseTheme reads/writes all three), and a spread of an `unknown`-typed
  `window.settings` field. Both fixed.
- Renaming these to `.js` was the alternative; rejected because they are
  idiomatic TS already and the type-checking has value once scoped correctly.

## Enforcement

`npm run typecheck` (hard CI gate) now covers them via the include glob; the
TS-coverage ratchet ([ts-ratchet.json](../../ts-ratchet.json)) does not track
`.ts` files (they are always checked, no opt-in pragma), but their presence in
the include is load-bearing and covered by the typecheck itself.
