# Wolfhour Phase 6 Validation

- Generated: 2026-03-14T11:57:28.381Z
- Overall: FAIL

## Checks

- webgpu_backend_expected: SKIP
- webgl_fallback_backend: PASS
- cooldown_memory_recovery: FAIL
- soak_memory_growth: SKIP

## Scenario Reports

- webgpu_high
  - idle p95: 1001.5
  - combat avg draw calls: 1
  - backend: WebGL2
  - cooldown textures: 16
  - cooldown geometries: 33
  - reactive queue max depth: 54
  - reactive pool misses: 0
- webgpu_high_no_compute
  - idle p95: 1001.5999999996275
  - combat avg draw calls: 1
  - backend: WebGL2
  - cooldown textures: 16
  - cooldown geometries: 33
  - reactive queue max depth: 54
  - reactive pool misses: 0
- webgl_high_force_webgl
  - idle p95: 1002.1000000014901
  - combat avg draw calls: 1
  - backend: WebGL2
  - cooldown textures: 16
  - cooldown geometries: 36
  - reactive queue max depth: 54
  - reactive pool misses: 0

