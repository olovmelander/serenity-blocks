# 0001 — phaser and three are runtime `dependencies`

- **Status:** accepted
- **Date:** 2026-07-09
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md § Phase 2.5 (blocks Phase 0.3)

## Context

`phaser` and `three` sat in `devDependencies` while being the two largest pieces of code
actually shipped to players (compiled into `dist/` by Vite). Consequences:

- 149 hard `import/no-extraneous-dependencies` ESLint errors (every `import ... from 'three'`
  in `src/` counted as importing a dev-only package).
- `npm audit --omit=dev` and any SBOM generated from `dependencies` under-reported the
  shipped attack/vulnerability surface — the audit gate was green while ignoring the two
  biggest shipped libraries.

The only argument for keeping them in devDeps would be an `npm ci --omit=dev` packaging
flow. This repo does not use one: electron-builder packages `dist/**` + `electron/**` only,
with native modules copied via `extraResources` — moving the packages does not change the
artifact size or contents.

## Decision

`phaser` and `three` live in `dependencies`. `dependencies` = everything whose code ships
to players (including bundled-by-Vite libraries); `devDependencies` = build/test/tooling
only.

## Consequences

- `npm audit --omit=dev` (the hard CI gate) now covers phaser + three. It remains at 0
  vulnerabilities as of this date.
- SBOMs generated for release builds are honest about the shipped surface.
- The 149 lint errors are gone without rule suppression.

## Enforcement

`import/no-extraneous-dependencies` (airbnb-base, error severity) fails any new shipped
import from a devDependency once the lint gate is hard (Phase 0.3).
