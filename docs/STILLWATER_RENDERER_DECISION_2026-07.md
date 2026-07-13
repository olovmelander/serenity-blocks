# Stillwater Waves 1-2 evidence and renderer decision

**Date:** 2026-07-13

**Scope:** Wave 1 composition blockout and Wave 2 lake proof from
[`STILLWATER_MASTERPIECE_PLAN_2026-07.md`](STILLWATER_MASTERPIECE_PLAN_2026-07.md).

**Decision:** **Provisional go for continued TSL integration; no production cutover.**

**Formal section 12 result:** **Deferred, not failed.**

The Wave 2 lake pilot is accepted as the sole WebGPU-primary implementation candidate,
with `WebGPURenderer`'s forced-WebGL2 backend serving the same TSL graph. This authorizes
the next isolated pilots. It does not authorize replacing production Stillwater, porting
the incomplete blockout into the real theme, or deleting the intentional WebGL island
described by ADR-0008.

## Wave 1 — composition exit

[`stillwater-composition.effect.js`](../src/playground/effects/stillwater-composition.effect.js)
implements only the camera, sky/value bands, smoothed S shoreline, terrain masses,
canopy gaps, board guide, and spirit/troll anchors. It deliberately has no particles or
post-processing. Projection-based diagnostics prove that both character anchors remain
outside the playfield and that the lake occupies the intended lower 35-42% band.

| Layout | Capture | Lake frame fraction | Board clear |
|---|---|---:|:---:|
| Solo 16:9 + split reference | [`composition-solo-16x9-split-final.png`](../artifacts/themes/stillwater/wave1-2026-07-13/composition-solo-16x9-split-final.png) | 0.4070 | Yes |
| Solo 16:10 | [`composition-solo-16x10-final.png`](../artifacts/themes/stillwater/wave1-2026-07-13/composition-solo-16x10-final.png) | 0.4082 | Yes |
| Solo ultrawide | [`composition-solo-ultrawide-final.png`](../artifacts/themes/stillwater/wave1-2026-07-13/composition-solo-ultrawide-final.png) | 0.3974 | Yes |
| Duo 16:9 | [`composition-duo-16x9-final.png`](../artifacts/themes/stillwater/wave1-2026-07-13/composition-duo-16x9-final.png) | 0.4079 | Yes |
| Quad 16:9 | [`composition-quad-16x9-final.png`](../artifacts/themes/stillwater/wave1-2026-07-13/composition-quad-16x9-final.png) | 0.4091 | Yes |
| Odyssey 16:9 | [`composition-odyssey-16x9-final.png`](../artifacts/themes/stillwater/wave1-2026-07-13/composition-odyssey-16x9-final.png) | 0.4070 | Yes |

All six native-WebGPU captures reached `window.__PLAYGROUND_READY__ === true`, reported
no playground error, and had clean console and WebGPU validation output. The generated
16:9 reference and exact prompt/provenance are preserved in
[`stillwater-composition-concept-2026-07.md`](../public/playground-refs/stillwater-composition-concept-2026-07.md).

**Wave 1 exit:** passed. The silhouette reads, the board remains the dominant aperture,
and the story anchors remain peripheral in every requested layout.

## Wave 2 — lake proof

[`stillwater-water.effect.js`](../src/playground/effects/stillwater-water.effect.js) proves:

- one r181 TSL graph on native WebGPU and forced WebGL2;
- MaterialX domain-warped flow, optical normals, Fresnel, and broken ripple crests;
- a plan-aligned High reflector at 0.45 resolution scale, with mip blur, no bounces, and
  a composition-only reflection layer;
- a Low analytic sky/spirit/troll reflection and an `off` path that constructs neither
  reflection graph;
- a board-center calm mask, dark shore depth, contact darkening, submerged forms, and
  restrained bed-only Worley caustics;
- ACES plus a teal-shadow/warm-highlight grade, with an ACES-only comparison mode;
- a single upward-facing transparent lake pass (`FrontSide`), bounded profiling, honest
  unavailable counters, and explicit reflector/pass/post/material/geometry disposal.

Fixed wake slots and feedback compute remain intentionally absent; they belong to Wave 3.

### Capture contract

The final matrix came from the production preview, not the development server:

- Three `0.181.2`, Chrome `150.0.0.0`, Windows;
- native adapter reported NVIDIA/Blackwell; forced WebGL2 reported ANGLE D3D11 on an
  NVIDIA GeForce RTX 5080 Laptop GPU;
- renderer internal resolution 1920x1080, DPR 1, pixel ratio 1, with no DRS or
  `effectScale` override;
- identical solo camera, grade, board guide, seed/content, and fixed `t=4`, `t=8`, and
  `t=12` inputs for every row;
- the HUD-hidden evidence canvas was presented at 1600x900 while the renderer continued
  to execute the 1920x1080 workload;
- 24 canonical images (2 backends x 2 tiers x 2 reflection modes x 3 times), one
  ACES-only image, and two guide-free hero images; all 27 are unique 1600x900 PNGs;
- combined sorted manifest SHA-256:
  `C8DC0D106BECA81EA5A8F36865B94433DD04E9389596CD127A97F75053E5D00E`.

Representative clean captures:

- [native WebGPU High/auto, t=8](../artifacts/themes/stillwater/wave2-2026-07-13/webgpu-high-auto-t08-clean.png)
- [forced WebGL2 High/auto, t=8](../artifacts/themes/stillwater/wave2-2026-07-13/webgl2-high-auto-t08-clean.png)
- [native WebGPU High/auto, ACES-only, t=8](../artifacts/themes/stillwater/wave2-2026-07-13/webgpu-high-auto-aces-t08.png)

Every canonical row reported ready, no playground error, the requested backend, the
expected reflection path, and zero console warnings, errors, issues, or validation errors.

The DevTools/model image preview intermittently displayed hard black rectangles in large
images. This was not present in saved PNG data: dimension/hash checks, RGB spot checks,
and a grid audit found no suspicious black regions. The files above are the evidence, not
the faulty transient preview.

### Visual backend parity

At `t=8`, a fixed 90,000-pixel sampling grid found a mean absolute channel difference of
only approximately `0.0265 / 255` between native WebGPU and forced WebGL2. Approximately
0.44-0.45% of sampled pixels differed at all, concentrated on sparse rasterized edges;
all four High/Low and auto/off comparisons had the same result. The two backends are
therefore visually equivalent for this isolated graph within the measured tolerance.

High/auto adds the intended reflected trunks, spirit, troll, and depth cues. Low/auto
retains the narrative through narrow analytic reflection lanes. `off` is a useful
ablation, but is not the missing repaired production-WebGL candidate.

### Renderer counters

Canonical captures include the board diagnostic, which costs exactly four calls, 48
triangles, and two geometries. Guide-free counters represent the clean-art pilot:

| Tier / reflection | Guide-free calls | Triangles | Geometries | Textures |
|---|---:|---:|---:|---:|
| High / auto | 27 | 9,281 | 16 | 6 |
| High / off | 17 | 5,105 | 16 | 3 |
| Low / auto | 17 | 5,105 | 16 | 3 |
| Low / off | 17 | 5,105 | 16 | 3 |

Native WebGPU and forced WebGL2 reported the same counters. The High pilot is under the
section 11 limit of 32 calls. The 17-call Low blockout is two calls above the final-theme
target of 15, so Low draw merging remains an integration target rather than being waived.
`programs` remains explicitly unavailable on this renderer and is not counted as zero.

### Warm t=8 performance pilot

Each row used `profile=1&trackTimestamp=1`, a three-second warmup, profiler reset, and an
approximately five-second measurement window. Cells are `n: p50 / p95 / p99 / max` in
milliseconds.

| Backend | Tier / reflection | CPU submission | Frame interval | GPU timestamp |
|---|---|---|---|---|
| WebGPU | High / auto | 884: 0.5 / 0.9 / 1.1 / 1.4 | 883: 5.6 / 6.2 / 6.5 / 7.0 | 29: 0.590 / 1.049 / 1.049 / 1.049 |
| WebGPU | High / off | 881: 0.5 / 0.7 / 0.8 / 1.1 | 880: 5.6 / 6.3 / 6.6 / 6.7 | 29: 1.180 / 1.638 / 1.638 / 1.638 |
| WebGPU | Low / auto | 886: 0.4 / 0.7 / 0.7 / 0.9 | 885: 5.6 / 6.2 / 6.5 / 6.7 | 29: 0.328 / 0.393 / 0.786 / 0.786 |
| WebGPU | Low / off | 880: 0.5 / 0.8 / 0.9 / 1.4 | 879: 5.7 / 6.3 / 6.6 / 7.4 | 29: 0.328 / 0.459 / 0.590 / 0.590 |
| WebGL2/TSL | High / auto | 877: 0.6 / 0.8 / 1.0 / 1.8 | 876: 5.7 / 6.3 / 6.6 / 7.0 | 29: 0.758 / 1.206 / 1.754 / 1.754 |
| WebGL2/TSL | High / off | 886: 0.4 / 0.6 / 0.7 / 0.9 | 885: 5.6 / 6.2 / 6.5 / 7.0 | 29: 0.747 / 1.199 / 1.210 / 1.210 |
| WebGL2/TSL | Low / auto | 868: 0.5 / 1.2 / 1.8 / 4.2 | 867: 5.7 / 6.4 / 6.8 / 20.6 | 28: 0.470 / 0.922 / 0.963 / 0.963 |
| WebGL2/TSL | Low / off | 878: 0.5 / 0.7 / 0.8 / 1.1 | 877: 5.7 / 6.3 / 6.6 / 6.9 | 29: 0.777 / 1.542 / 1.595 / 1.595 |

All eight pilot rows pass the section 13 60 Hz limits: frame p95 at most 16.6 ms,
CPU p95 at most 6 ms, GPU p95 at most 9 ms, and frame p99 at most 20.8 ms. Their frame
p95 values also fall below the 120 Hz (8.3 ms) and 144 Hz (6.9 ms) pilot thresholds.
This is strong isolated evidence on the recorded discrete GPU, not an iGPU result or a
full-game guarantee. The small, quantized GPU sample sets also make tiny auto/off
differences run variance, not reliable feature-cost attribution.

## Section 12 decision

| Gate | Result | Reason |
|---|---|---|
| One TSL graph on WebGPU and forced WebGL2 | Pilot pass | Both backends are console-clean and visually equivalent. |
| Lake hero capability | Pilot pass | True High reflection and credible Low analytic reflection materially improve the lake language. |
| Section 13 warm frame budgets | Pilot pass | All eight isolated rows pass through the 144 Hz p95 threshold on the recorded discrete GPU. |
| Matched optimized-WebGL comparison | Open | The historical WebGL scene and this isolated lake contain different content and cameras. |
| Full height-fog/selective-bloom target | Open | Wave 2 proves lake optics and grade; later waves own atmosphere and post. |
| Startup and VRAM delta below 10% | Not tested | Requires matched integrated candidates and cold runs. |
| Device/context-loss rebuild and lifecycle soak | Not tested | Disposal hooks exist, but repeated real-theme rebuild evidence does not. |
| Real board, gameplay reactions, layouts, iGPU, resize, and quality matrix | Not tested | These belong to the integrated section 13 ship gate. |

The historical standalone WebGL audit (67 calls, 77,137 triangles, rAF
p50/p95/p99 4.2/4.3/4.5 ms) remains useful context, but it is not numerically comparable:
it used a different boardless whole scene at 1904x985 and predates the final matched
candidate. Reflection `off` and forced WebGL2/TSL are not substitutes for that candidate.

**Recorded decision:** continue developing the TSL candidate through the isolated water,
forest/flora, character, and atmosphere pilots. Keep the production WebGL implementation
and its raw GLSL until three matched integrated candidates pass the complete section 12
and section 13 gates. No renderer conversion or GLSL deletion is approved by Wave 2.

## Verification

- ESLint: composition effect, water effect, playground harness, and Wave tests pass.
- Vitest: `stillwater-playground-waves` plus Wave 0 regressions, 19/19 tests pass.
- Production Vite build: 853 modules transformed; success. The existing Odyssey/Serenity/
  Summer circular-chunk warning remains unrelated.
- `git diff --check`: global and scoped checks pass.

The next authorized visual step is Wave 3's fixed-slot dimple/wake system in the isolated
lake pilot. It must not create per-event meshes, programs, or geometry growth.
