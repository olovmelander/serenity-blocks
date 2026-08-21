# Architecture Decision Records

MADR-lite records for decisions that constrain work in this repo. Each record states the
decision, why it was taken, and what enforces it — per the remediation-plan bar: *any
architecture rule that matters twice must become a type, test, fitness check, budget,
artifact, or release gate; markdown alone is not the control.*

Agent-assisted sessions: load this directory before proposing structural changes —
an agent will happily re-add a forbidden pattern unless the constraint is loadable.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-phaser-three-are-runtime-dependencies.md) | phaser and three are runtime `dependencies` | accepted |
| [0002](0002-lint-policy-decisions.md) | Lint policy: no-bitwise off, unresolved-import ignores, max-len warns | accepted |
| [0003](0003-incremental-typescript-via-ts-check.md) | Incremental TypeScript via `@ts-check` | accepted |
| [0004](0004-host-authoritative-p2p.md) | Host-authoritative P2P is the multiplayer model | accepted |
| [0005](0005-no-wasm-physics.md) | Do not add WASM physics for the puzzle simulation | accepted |
| [0006](0006-no-sim-worker-offload-for-now.md) | No simulation Worker offload for now | accepted |
| [0007](0007-webgpu-tsl-definition-of-done.md) | WebGPU/TSL visual changes require screenshot validation | accepted |
| [0008](0008-hybrid-renderer-and-webgl-holdouts.md) | Hybrid renderer split and WebGL holdouts are intentional | accepted |
| [0009](0009-theme-codegen-pipeline-removed.md) | Do not rebuild the old theme code-generation pipeline | accepted |
| [0010](0010-tornado-ts-in-typecheck-island.md) | Tornado `.ts` files join the typecheck island; three stays untyped | accepted |
| [0011](0011-cascade-cutover-commits-per-wave.md) | Cascade cutover: resolver replay commits state per wave | accepted |
| [0012](0012-fixed-tick-overload-rebases-wall-time.md) | Fixed-tick overload rebases wall time, not tick IDs | accepted |
| [0013](0013-session-global-v2-snapshot-codec.md) | Session-global protocol-v2 snapshot codec | accepted |
| [0014](0014-versioned-reliable-resync-sidecar.md) | Versioned reliable resync sidecar | accepted |
| [0015](0015-keep-the-odyssey-one-world-escape-hatch.md) | Keep the Odyssey One World escape hatch | accepted |
| [0016](0016-perf-claims-require-a-verified-instrument.md) | Performance claims require a content-matched measurement from a verified instrument | accepted |
| [0017](0017-act-i-stays-a-diorama-the-ocean-deepens-in-world.md) | Act I stays a diorama; the ocean deepens in-world | accepted |
| [0018](0018-three-js-pinning-and-upgrade-protocol.md) | three.js is pinned exactly and upgraded by protocol, not by bump | accepted |
| [0019](0019-gate-on-renderer-kind-not-backend.md) | Themes gate material and post-processing choices on renderer kind, not backend | accepted |

Format per record: **Status / Date / Context / Decision / Consequences / Enforcement.**
New records: next number, kebab-case slug, add a row here.
