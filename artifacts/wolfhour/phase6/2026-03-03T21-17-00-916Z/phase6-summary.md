# Wolfhour Phase 6 Validation

- Generated: 2026-03-03T21:18:44.029Z
- Overall: FAIL

## Checks

- webgpu_backend_expected: FAIL
- webgpu_draw_call_budget: PASS
- webgpu_triangle_budget: PASS
- webgpu_point_budget: PASS
- webgpu_p95_frame_budget: FAIL
- compute_toggle_behavior: FAIL
- webgl_fallback_backend: PASS
- soak_memory_growth: SKIP

## Scenario Reports

- webgpu_high
  - idle p95: 2013.2000000029802
  - combat avg draw calls: 1
  - backend: WebGL2
- webgpu_high_no_compute
  - idle p95: 1002.2999999970197
  - combat avg draw calls: 1
  - backend: WebGL2
- webgl_high_force_webgl
  - idle p95: 1002.5
  - combat avg draw calls: 1
  - backend: WebGL2

