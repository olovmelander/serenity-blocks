# Stillwater production renderer decision

**Date:** 2026-07-25
**Updated:** 2026-07-26

**Decision status:** Accepted for the Stillwater implementation

**Ship-validation status:** **Accepted.** The final immutable same-build renderer,
performance, recovery, lifecycle, and live-layout acceptance set is all-pass.

**Plan hook:** `STILLWATER_MASTERPIECE_PLAN_2026-07.md` §12 and
`ARCHITECTURAL_REMEDIATION_PLAN.md` Phase 7.3

**ADR:** [ADR-0008](adr/0008-hybrid-renderer-and-webgl-holdouts.md)

## Decision

Stillwater is a WebGPU-primary theme. Its compatibility path is
`WebGPURenderer`'s forced-WebGL2 backend running the same TSL and NodeMaterial graphs.
The old raw-GLSL production twin is retired; no second Stillwater shader implementation
is retained.

This is a Stillwater-specific opt-in under ADR-0008. It does not change the default for
other documented WebGL islands and is not authority for a blanket renderer port.

The earlier
[`STILLWATER_RENDERER_DECISION_2026-07.md`](STILLWATER_RENDERER_DECISION_2026-07.md)
remains the historical Waves 1–3 checkpoint. Its “no production cutover” conclusion was
correct for that checkpoint but is superseded for the integrated Stillwater
implementation by this decision.

## Why the opt-in earned its cost

Stillwater's product target depends on capabilities that belong to one integrated graph:

- reduced-resolution planar lake reflection on High+ and analytic reflection below it;
- fixed water wake slots coupled to physical/optical surface response;
- colored height fog and depth-aware soft atmosphere;
- MRT-isolated selective emissive bloom;
- one ACES and teal-shadow/warm-highlight output treatment;
- identical reaction, material, and quality behavior on native WebGPU and forced WebGL2.

The final implementation contains zero non-node materials and zero missing Stillwater MRT
roles in the canonical captures. The compacted High native-WebGPU graph reports 45 idle
aggregate draws and 85,739 triangles. `renderer.info.programs` is unavailable on this
renderer and is not counted as zero.

Every response-enabled quality tier now constructs the bounded `lean-four-wake` water
response graph. It preserves the four opposing Tetris depth wakes while avoiding the
former repeated fragment-graph work. The final
[High WebGPU Tetris capture](../artifacts/themes/stillwater/wave8/final-playground/water-high-tetris-lean-periodic-webgpu-v5.png)
visually verifies that composition with one ready WebGPU canvas and no shader, pipeline,
or console error. High still retains its 0.30-scale planar reflection and 0.45-scale
selective bloom; the response optimization did not flatten the premium tier.

The complete visual and performance record is in
[`STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md`](STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md).

## Section 12 disposition

| Proof-gate requirement | Disposition |
|---|---|
| One TSL graph on WebGPU and forced WebGL2 | Pass. Both backends use the same production builders; the final immutable [forced-WebGL2 Medium run](../artifacts/themes/stillwater/wave8/final-v5-webgl2-medium-1080p60/stillwater-wave8-summary.json) is an overall pass and console/shader clean. |
| Lake/reflection/height-fog/selective-bloom capability | Pass. All four capabilities are integrated and visually captured. |
| Production frame budgets | Pass. All six final same-fingerprint performance lanes pass stationary/comparable neutral warmup, absolute CPU/GPU/workload budgets, applicable 60 Hz p99 gates, and reaction-increment gates. AMD low-power WebGPU Medium records 5.22 ms idle p95, below both the 16.6 ms absolute limit and independently enforced 6.6 ms calibrated ceiling. p99 remains diagnostic at configured 120/144. |
| Matched optimized legacy-WebGL comparison | Not numerically established. The historical raw-WebGL scene used different content/camera and is not presented as a ≥15% A/B win. |
| Startup and VRAM proxy below 10%, or explicit hero trade | The explicit hero-capability trade was invoked. No matched numeric startup/VRAM regression below 10% was established. The four shipped troll LODs being 91.75% smaller than the retained source is separate asset evidence, not that missing A/B. |
| No raw GLSL twin retained | Pass. `src/themes/stillwater/stillwater-shaders.js` is deleted. |
| Device-loss teardown/rebuild owned | Pass in [`final-v5-device-loss`](../artifacts/themes/stillwater/wave8/final-v5-device-loss/stillwater-wave8-summary.json). Deliberate native-WebGPU device destruction recovered once to forced WebGL2 in 3.663 s with one Stillwater canvas and zero console or shader/pipeline failures. |
| Repeated-switch disposal owned | Pass in [`final-v5-webgpu-high-switch30`](../artifacts/themes/stillwater/wave8/final-v5-webgpu-high-switch30/stillwater-wave8-summary.json), scoped to the selected forced-GC retained-object/native-allocation classes it measures rather than universal absence of retention. |

The unmatched historical renderer comparison is explicitly disclosed. The decision does
not claim a measured 15% improvement over that incomparable scene. The agreed reflection,
selective post, unified grade, fixed reactions, asset reduction, backend parity, and
measured production budgets are the product-value route through the proof gate.

## Compatibility and recovery policy

- Normal path: native WebGPU.
- Compatibility path and WebGPU-loss fallback: forced WebGL2 through
  `WebGPURenderer`, not a raw `WebGLRenderer`/GLSL fork.
- Recovery is attempted once. A repeated terminal GPU failure follows the shared
  resilience policy rather than entering a rebuild loop.
- Quality-disabled reflection, bloom, LUT, mist, and particle work is omitted
  structurally.
- Pixel ratio remains routed through the shared quality/display policy.
- Reduced motion changes motion and reaction behavior without selecting another shader
  implementation.

## Release consequence

The accepted immutable distribution is
[`immutable-build-final-20260726-1618-v5`](../artifacts/themes/stillwater/wave8/immutable-build-final-20260726-1618-v5/)
with local-build fingerprint
`6c91dad8fe2144b02b9dc6aab5b7135a23394f814bd0690792760e7baafb200c`
under provenance schema `stillwater-source-build-v5`. This is a
`local-build-content-identity`: it hashes the captured build closure, performance budget,
and validation logic. Its own scope records `cryptographicAttestation: false`,
`servedBytesVerified: false`, and `gitContextIncludedInFingerprint: false`. It is neither
a signature nor proof that preview served those exact bytes.

All values below are milliseconds from the harness's
`isolated-manual-production-frame` workload (`CPU submission + GPU timestamp`). Every row
is an overall pass and carries the fingerprint above.

| Artifact | Active adapter / backend | Profile and configured target | Idle p95 / p99 | Reactions p95 / p99 | Incremental p95 |
|---|---|---|---:|---:|---:|
| [`final-v5-amd-minimal-1080p60`](../artifacts/themes/stillwater/wave8/final-v5-amd-minimal-1080p60/stillwater-wave8-summary.json) | AMD Radeon 610M / WebGPU | Minimal, 1920×1080, 60 | 4.67 / 5.00 | 4.70 / 4.89 | 0.03 |
| [`final-v5-amd-medium-1080p60`](../artifacts/themes/stillwater/wave8/final-v5-amd-medium-1080p60/stillwater-wave8-summary.json) | AMD Radeon 610M / WebGPU | Medium, 1920×1080, 60 | 5.22 / 5.61 | 5.74 / 6.14 | 0.52 |
| [`final-v5-amd-high-1080p60-r2`](../artifacts/themes/stillwater/wave8/final-v5-amd-high-1080p60-r2/stillwater-wave8-summary.json) | AMD Radeon 610M / WebGPU | High, 1920×1080, 60 | 9.20 / 9.54 | 9.96 / 10.33 | 0.76 |
| [`final-v5-webgl2-medium-1080p60`](../artifacts/themes/stillwater/wave8/final-v5-webgl2-medium-1080p60/stillwater-wave8-summary.json) | AMD Radeon 610M / forced WebGL2 | Medium, 1920×1080, 60 | 5.50 / 5.92 | 5.68 / 6.09 | 0.18 |
| [`final-v5-rtx-high-1080p120`](../artifacts/themes/stillwater/wave8/final-v5-rtx-high-1080p120/stillwater-wave8-summary.json) | RTX 5080 Laptop / WebGPU | High, 1920×1080, 120 | 1.50 / 1.73 | 1.60 / 1.83 | 0.10 |
| [`final-v5-rtx-extreme-1440p144`](../artifacts/themes/stillwater/wave8/final-v5-rtx-extreme-1440p144/stillwater-wave8-summary.json) | RTX 5080 Laptop / WebGPU | Extreme, 2560×1440, 144 | 1.72 / 1.92 | 1.76 / 1.96 | 0.03 |

The 60/120/144 values are configured target frequencies used to pace the isolated manual
driver. They are not observed display refresh rates or display-FPS measurements. The
workload totals do not include compositor presentation, and queue-drain and scheduler
pacing are recorded separately. The harness gates p99 at configured 60 only; p99 is
diagnostic at configured 120/144.

Real production-path layout capture also passes for
[two players](../artifacts/themes/stillwater/wave8/final-v5-live-local-2p/stillwater-live-local-2p.json)
and
[four players](../artifacts/themes/stillwater/wave8/final-v5-live-local-4p/stillwater-live-local-4p.json):
the expected duo/quad layout, exact live board and safe-region counts, one Stillwater
canvas, and zero console or shader/pipeline errors were observed.

Lifecycle conclusions must remain scoped to the classes actually sampled. The passing
[`final-v5-webgpu-high-switch30`](../artifacts/themes/stillwater/wave8/final-v5-webgpu-high-switch30/stillwater-wave8-summary.json)
census establishes stability for its selected Stillwater theme, renderer, NodeFrame,
Scene, post graph, Mesh, NodeMaterial, `GPUDevice`, `GPUTexture`, render-target,
render-target-texture, depth-texture, canvas, and listener populations across thirty
switches. Their before/after retained-object counts are stable; output-quad listeners
decrease from seven to six. It cannot prove that no other JavaScript or native object is
retained. Three r181's pooled-renderer `renderer.info.memory.textures` count can drift as
stale bookkeeping and is diagnostic, not an allocation census.

Startup evidence has matching limits. Hero GLTF timing combines load, parse, and attach;
GPU upload is not measured separately. `warmRenderComplete` records return from the CPU
render call, and `canvasReveal` records a DOM opacity write rather than compositor or GPU
presentation. The LongTask observer can establish the recorded main-thread
`PerformanceLongTaskTiming` result around that DOM boundary. Every final Wave 8 validation
lane has zero LongTasks overlapping or starting after reveal; the forced-WebGL2 lane's two
recorded LongTasks are fully DOM-masked before reveal. This does not rule out shorter
16.6–50 ms hitches, GC pauses, GPU stalls, or compositor delay.

This record closes the Stillwater renderer proof gate for the frozen distribution and
fingerprint above. It remains a Stillwater-specific decision under ADR-0008 and does not
substitute for separately reported repository-wide test, lint, boundary, build, diff, or
artifact-hygiene gates.
