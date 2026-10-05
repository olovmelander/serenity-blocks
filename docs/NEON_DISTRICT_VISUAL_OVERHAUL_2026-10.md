# Neon District visual overhaul — October 2026

Neon District uses a coherent cyan, rose, cobalt and warm shop-light palette,
stable architectural detail, a wet street, drifting smog and city-scale reactions.
Three.js remains pinned to **0.186.1**, with node materials on native WebGPU and
the WebGPURenderer's WebGL2 compatibility backend.

## City and materials

- Facade windows remain attached to architecture as the camera moves. Correct
  wall projection and derivative filtering replace distance-dependent quantization.
  The same facade factory serves distant LODs; near buildings retain their artwork
  and gain deterministic window hues, softer detail and reactive emission.
- Cyan/rose light pollution, smog, moon corona and softer billboard scanlines
  define the sky. A broken civic hologram crowns the horizon tower; elevated
  transit currents and soft-edged street steam add movement and depth.
- Wet asphalt has tier-gated impact ripples, corrected view-space normals and
  neon reflection bands. High+ native WebGPU keeps planar reflections; WebGL2
  retains its cheaper environmental reflection treatment.
- Photographic HDR highlights are compressed before environment filtering,
  preventing extreme sun/headlamp radiance from bleaching wet clearcoat and bloom
  while preserving the spatial detail and hue of skyline reflections.
- Narrow twin paint lines replace the old raised emissive road stripe, which
  produced an enormous yellow wedge beneath the camera.
- Camera ascent preserves the street canyon. Both backends share authored
  lighting, with tier-scaled shadows. Tiers without post-processing use inexpensive
  distance fog; sky, stars and moon remain clear.

## Gameplay response

Locks produce pavement ripples. Clears send cyan energy up the canyon and lift
data sparks from the road edges. Combos add broken rose holographic orbits;
four-line clears and larger combos also trigger restrained camera and sky responses.
Scan geometry stays behind foreground signs and outside the camera's near field.

`NeonDistrictEvents` preallocates reusable slots and particle geometry. Events
coalesce per frame and recycle the oldest slot, without event-time geometry or
material allocation. Dormant effects compile during loading; live slot state
restores visibility safely if gameplay resumes while compilation is pending.

| Tier | Slots across lock/clear/combo | Maximum pooled data particles |
| --- | ---: | ---: |
| Minimal | 3 | 40 |
| Low | 3 | 64 |
| Medium | 6 | 224 |
| High | 6 | 384 |
| Ultra | 9 | 768 |
| Extreme | 9 | 960 |

The theme consumes canonical `LINE_CLEAR`/`lineCount` events. The obsolete
`LINES_CLEARED` subscription did not receive events. Subscriptions detach on stop
and return after retained-scene restart. Responses decay by elapsed time and
return bloom/grade to exact resting values. Reduced motion holds the camera
still, suppresses lightning and keeps static feedback; preferences resynchronize
after inactivity. Unused legacy spark/lightning allocation paths are removed.

## Verification

`scripts/neon-district-visual-validation.mjs` captures the actual isolated shipping
theme and canonical events. The matrix covers High desktop (1280×720), Low mobile
portrait (390×844) and landscape (844×390), on native WebGPU and forced WebGL2.
Each profile captures ambient, piece-lock, four-line clear and combo phases.

```sh
node scripts/neon-district-visual-validation.mjs --lane both --offscreen \
  --out reports/neon-district-overhaul/final
```

Playwright can be supplied through `PLAYWRIGHT_MODULE` and
`PLAYWRIGHT_EXECUTABLE_PATH`. Final screenshots and machine-readable evidence
live in `reports/neon-district-overhaul/final/`. Isolated studies live in
`src/playground/effects/neon-district-*.effect.js`.

These software-browser rendering checks verify production shaders and reflections.
Native WebGPU target/readback does not test native canvas presentation. Physical
device performance and full game boot are not measured.

Regression coverage includes canonical dispatch, stop/restart ownership, malformed
payloads, frame-rate-independent timing, fixed resource budgets, reduced motion,
scan bounds, asynchronous prewarm cancellation/resume and idempotent disposal.
The full Vitest suite passed **528 files and 5,647 tests** with two workers.
Production build, boot-closure verification, TypeScript and dependency boundaries
pass. The lint error ceiling is reduced to reflect the removed legacy code.
