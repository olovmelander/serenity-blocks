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

## Amendment — 2026-10-13 (packaging did ship `node_modules`)

The Context above says moving the packages "does not change the artifact size or contents",
because electron-builder packages only `dist/**` and `electron/**`. That premise was wrong.
electron-builder adds the production `dependencies` and their transitive dependencies to
`app.asar` unless `build.files` excludes them. An `electron-builder --dir` run on 2026-10-13
found 193 MiB of `node_modules` in `app.asar`, including phaser and three, which Vite had
already bundled into `dist/`. Nothing loaded them: the main process imports only Node
built-ins, `electron`, and the Steam native module from `resources/native_modules`.

`build.files` now ends with `"!**/node_modules/**/*"`. A re-run found no `node_modules`
entries in `app.asar`, and the packaged app still boots. `tests/unit/packaging-config.test.js`
fails if the exclusion is dropped, or if `electron/` imports a package that is not shipped
through `extraResources`.

The decision itself stands. `dependencies` still means "code that ships to players". That
code now reaches players only through `dist/` and `extraResources`.
