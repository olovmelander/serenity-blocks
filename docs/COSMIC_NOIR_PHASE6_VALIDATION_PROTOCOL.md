# Cosmic Noir Phase 6 Validation Protocol

This protocol runs the automated Phase 6 performance/stability suite for Cosmic Noir and writes artifacts under:

`artifacts/cosmic-noir/phase6/<timestamp>/`

## Default Command

```bash
npm run validate:cosmic-noir:phase6
```

## What It Captures

1. `webgpu_high`
2. `webgpu_high_no_compute`
3. `webgl_high_force_webgl`

Per scenario:
- Idle capture report
- Combat burst capture report
- Soak capture report (10 minutes by default)
- Combat screenshot (`combat.png`)

## Built-in Checks

1. WebGPU High `p95 <= 16.7ms`
2. `compileAsync` timeout guard behavior
3. Burst draw-call reduction vs `no_compute` (`>= 70%`)
4. Feature scaling consistency across scenarios
5. Soak memory stability trend (textures/geometries)
6. Optional WebGL regression check vs reference baseline JSON

## Optional Environment Overrides

```bash
COSMIC_NOIR_IDLE_MS=15000
COSMIC_NOIR_COMBAT_MS=15000
COSMIC_NOIR_SOAK_MS=600000
COSMIC_NOIR_SKIP_SOAK=1
COSMIC_NOIR_COMBO_EVERY_MS=380
COSMIC_NOIR_COMBO_COUNT=8
COSMIC_NOIR_LINE_COUNT=4
COSMIC_NOIR_WEBGL_REFERENCE=/absolute/path/to/webgl-reference.json
```

## Outputs

- `phase6-summary.json`
- `phase6-summary.md`
- `dev-server.log`
- Per-scenario `results.json` and `combat.png`
