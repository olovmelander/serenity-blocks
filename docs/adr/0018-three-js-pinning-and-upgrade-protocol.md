# 0018 — three.js is pinned exactly and upgraded by protocol, not by bump

- **Status:** accepted
- **Date:** 2026-08-21
- **Plan hook:** THREE_UPGRADE_RESEARCH_R181_TO_R185_2026-08.md (the r181 → 0.185.1 upgrade, closed
  2026-08-21)

## Context

Every visual surface in this game is WebGPU/TSL, and TSL churns between three.js minor
releases in ways the migration guide does not list. The r181 → r185 upgrade found, by
measurement, that the guide omitted **ten** breaking changes this repo hit (TSL `atan2` /
`.equals` removal, MRT secondary attachments defaulting to opaque, the `viewportTexture`
refresh cadence, the Water addon look change, PBR energy-conservation drift, …), that one
widely-repeated claim about `positionLocal` was **backwards** until proven from generated WGSL,
and that two r185 behaviours were only reachable by running the real game on a real GPU
(`WebGPUBackend.dispose()` destroys the device under in-flight timestamp resolves — a real
defect; and `compileAsync` throwing on a `Group` `targetScene`, which turned out to be the
repo's own inverted argument order that r181 had silently tolerated). A `^0.181.2` caret
had also quietly pinned us for nine months, because on a `0.x` dependency a caret never crosses a minor.

## Decision

1. **`three` is pinned to an exact version** in `package.json` (no caret, no tilde). A new
   version is adopted by an explicit change, never by `npm update`.
2. **An upgrade is a planned project with a written plan**, verified against the **actual
   target tarball source** (`npm pack`, read `src/`), never against the migration guide or
   training data alone. Claims about shader emission order are settled by **generating the
   shader** from both versions (the `WGSLNodeBuilder` harness pattern), not by reading
   `setupPosition`.
3. **Dual-compatible fixes land first**, on the old version, and must be verified
   behavior-identical there before the bump commit.
4. **The bump is a single commit** (`package.json` + lockfile + with-bump code), so rollback
   is one revert; the `three` Vite `manualChunk` stays so A/B builds are clean.
5. **"Done" requires the real-GPU evidence**, not a green build: the Electron theme matrix
   (`capture:themes`, every theme, fresh process each), the game driven through its real
   entry points (a mode started, themes switched, the fallback lane included), and a perf
   re-baseline on the current machine under ADR-0016 — in the same change as any budget
   edit.
6. **Workarounds that touch three privates are pinned by contract tests** that read the
   installed source, so the next upgrade fails loudly where a private moved (and those
   tests are audited for slice/regex bugs that would let them pass silently — one did).

## Consequences

- Upgrades cost days, not minutes, and that is the point: the r185 project caught four bugs
  the build could not see, one of which had silently disabled the entire Odyssey warm-up.
- Dependabot's three bumps are informational; its PRs are closed in favor of a planned
  upgrade.
- The `webgpu-threejs-tsl` skill carries a version stamp and is re-stamped in the bump
  commit, so no agent reads the previous version's rules against the new one.
- Two upstream issues per upgrade is a normal yield; drafts live under `docs/UPSTREAM_*`.

## Enforcement

- `package.json` exact pin (review item; a caret on `three` is a defect).
- Contract tests reading `node_modules/three`: `bloom-dispose-contract`,
  `stillwater-webgpu-dispose-contract`, `odyssey-post-target-compile`,
  `base-theme-dispose-timestamp-quiesce`, `mrt-blend`.
- `capture:themes` (61/61 required) and `perf:budgets:gate` before an upgrade is called done.
- The plan template is the closed r185 document; its §12 phases are the checklist.
