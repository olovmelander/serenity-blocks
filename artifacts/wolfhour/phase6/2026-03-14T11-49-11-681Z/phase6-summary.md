# Wolfhour Phase 6 Validation

- Generated: 2026-03-14T11:52:34.474Z
- Overall: FAIL

## Checks

- webgpu_backend_expected: SKIP
- webgl_fallback_backend: PASS
- cooldown_memory_recovery: FAIL
- soak_memory_growth: SKIP

## Scenario Reports

- webgpu_high
  - idle p95: 1001.9000000003726
  - combat avg draw calls: 1
  - backend: WebGL2
  - cooldown textures: 16
  - cooldown geometries: 36
  - reactive queue max depth: 54
  - reactive pool misses: 0
- webgpu_high_no_compute
  - idle p95: 2000.699999999255
  - combat avg draw calls: 1
  - backend: WebGL2
  - cooldown textures: 16
  - cooldown geometries: 33
  - reactive queue max depth: 54
  - reactive pool misses: 0
- webgl_high_force_webgl
  - idle p95: 1001.3999999985099
  - combat avg draw calls: 1
  - backend: WebGL2
  - cooldown textures: 16
  - cooldown geometries: 33
  - reactive queue max depth: 54
  - reactive pool misses: 0

