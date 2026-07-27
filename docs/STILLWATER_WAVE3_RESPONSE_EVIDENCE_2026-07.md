# Stillwater Wave 3 — integrated water-response evidence

**Date:** 2026-07-25
**Scope:** isolated `stillwater-water` playground pilot only
**Decision:** **Wave 3 visual/resource exit passed; production cutover remains deferred.**

This result is subordinate to
[`ARCHITECTURAL_REMEDIATION_PLAN.md`](ARCHITECTURAL_REMEDIATION_PLAN.md), ADR-0008,
and the provisional renderer decision in
[`STILLWATER_RENDERER_DECISION_2026-07.md`](STILLWATER_RENDERER_DECISION_2026-07.md).
It does not change production Stillwater's intentional WebGL ownership.

## What changed

The Wave 2 lake now has one preallocated response system:

- High constructs 10 slots; Low constructs 4.
- Slot 0 is structurally reserved for one dominant Tetris or T-spin response.
- Remaining slots are circularly reused for routine lock dimples.
- Two fixed-length packed `vec4` arrays hold state and shape data. Events mutate existing
  objects; they never resize the arrays or create render resources.
- A Tetris special evaluates four curved, broken bank wakes and a later mirror swell once,
  rather than duplicating the special graph in every slot.
- A T-spin evaluates one inward annulus plus paired cyan/violet counter-rotating turns.
- The same response field supplies physical height, optical slope/reflection distortion,
  and restrained crest emission.
- The former 94-triangle lake was replaced at create time by one S-outline radial fill:
  4,512 triangles on High and 2,208 on Low. The bed and water still share that single
  geometry, and events never alter it.
- `responses=off` removes the complete response graph before material construction for a
  truthful matched-cost ablation.

The deterministic capture contract is:

```text
event=idle|lock|tetris|tspin
fxAge=<seconds>
t=8
quality=High|Low
reflection=auto|off
responses=on|off
```

The URL event is seeded once during creation. Repeated fixed-time `update(8, 0)` calls only
advance the shared time uniform and cannot retrigger it.

## Visual validation

Chrome DevTools MCP reached `window.__PLAYGROUND_READY__ === true` with no playground
error, console warning, console error, issue, or WebGPU validation message for:

| Backend | Tier | Validated states | Expected path |
|---|---|---|---|
| native WebGPU | High | idle, lock, Tetris, T-spin | 10 slots, 0.45 reflector |
| native WebGPU | Low | T-spin | 4 slots, analytic reflection |
| forced WebGL2/TSL | High | Tetris | 10 slots, 0.45 reflector |
| forced WebGL2/TSL | Low | lock | 4 slots, analytic reflection |

The hierarchy reads in the fixed hero frames:

- lock is one small ivory depression/ring;
- Tetris is four imperfect wakes entering from opposite banks, visibly broader than lock;
- T-spin is the dominant event, with a lavender outer turn and cyan/violet inner rune.

Durable 1920×1080 forced-WebGL2 parity captures:

- [idle](../artifacts/themes/stillwater/wave3-2026-07-25/webgl2-high-idle-t08.png)
- [lock](../artifacts/themes/stillwater/wave3-2026-07-25/webgl2-high-lock-t08.png)
- [Tetris](../artifacts/themes/stillwater/wave3-2026-07-25/webgl2-high-tetris-t08.png)
- [T-spin](../artifacts/themes/stillwater/wave3-2026-07-25/webgl2-high-tspin-t08.png)
- [Low T-spin](../artifacts/themes/stillwater/wave3-2026-07-25/webgl2-low-tspin-t08.png)

The native-WebGPU frames were inspected directly through DevTools. The connector rejected
explicit local screenshot paths despite the target being inside the workspace, so the
durable files above use the visually equivalent forced-WebGL2 path rather than falsely
labelling a headless fallback as native WebGPU.

## Resource-stability gate

After warmup, a 48-event sequence containing 42 routine locks, 3 Tetrises, and 3 T-spins
was written through the debug API. Every fixed array and slot object retained identity.

| Counter | Before | After |
|---|---:|---:|
| draw calls | 27 | 27 |
| triangles | 18,117 | 18,117 |
| geometries | 16 | 16 |
| textures | 6 | 6 |
| root objects | 22 | 22 |
| owned geometries | 15 | 15 |
| owned materials | 14 | 14 |
| water material version | 0 | 0 |

`renderer.info.programs` was `null` on both backends and remains explicitly unavailable,
not a claimed zero. There was no mesh, material, geometry, texture, object, draw, triangle,
or material-version growth.

## Warm performance A/B

Measurements came from the production preview at an internal 2137×1167 resolution,
pixel ratio 1.25, fixed `t=8`, after warmup and profiler reset. Each row contains more
than 700 bounded samples and zero frame intervals over 16.67 ms.

| Backend | Graph/state | CPU p50 / p95 / p99 / max | Frame p50 / p95 / p99 / max |
|---|---|---|---|
| WebGPU | responses off, idle | 0.4 / 0.8 / 0.9 / 0.9 ms | 5.7 / 6.2 / 6.4 / 6.7 ms |
| WebGPU | responses on, T-spin | 0.4 / 0.8 / 0.9 / 1.1 ms | 5.6 / 6.2 / 6.4 / 6.9 ms |
| forced WebGL2 | responses off, idle | 0.3 / 0.7 / 0.8 / 0.9 ms | 5.8 / 6.1 / 6.2 / 6.5 ms |
| forced WebGL2 | responses on, T-spin | 0.4 / 0.7 / 0.8 / 1.1 ms | 5.9 / 6.1 / 6.3 / 6.6 ms |

The measured incremental CPU p95 is `0.0 ms` on both backends, within the `0.25 ms`
reaction target. Frame p95 is unchanged and every warmed maximum stays below 7 ms.

The opt-in GPU timestamp session closed its Chrome target before returning samples.
Because this machine's workflow explicitly warns against repeated long WebGPU captures,
the attempt was not repeated. Incremental GPU cost is therefore **unavailable**, not
recorded as zero and not used to claim the `0.75 ms` target. Wave 2's successful bounded
GPU pilot remains the renderer-decision evidence; a future short timestamp session can
close this attribution gap.

## Verification

- ESLint passes for the effect, response state, and focused tests.
- Vitest passes 25/25 Wave 0–3 focused tests.
- Production Vite build passes with 891 modules transformed.
- The pre-existing Odyssey/Infinity/Serenity/Summer circular-chunk warning is unrelated.

Wave 3's stated exit is satisfied: the response hierarchy reads, while warmed events add
no meshes, programs, geometry, materials, objects, draw calls, or triangles. The next
isolated visual step is Wave 4's forest/canopy study; production integration remains
deferred until the section 12/13 gates authorize it.
