# Black Hole WebGPU Upgrade - QA Checklist

> Status: **Not executed yet**. Use this checklist for manual verification on both WebGPU and WebGL fallback.

## Visual Quality
- [ ] Black hole core renders correctly
- [ ] Photon sphere glow matches expected ring + shimmer
- [ ] Accretion disk spiral animation matches
- [ ] Volumetric disk haze is visible (raymarch pass) and stable
- [ ] Doppler shift colors look correct (blue/red split)
- [ ] Particle gravity behavior matches (suction + burst)
- [ ] Burst sparks timing feels correct (if not unified)
- [ ] Starfield twinkling matches
- [ ] Star stretch near horizon visible (WebGPU + WebGL)
- [ ] Star/particle sprite size correct on WebGPU (instanced sprites, not 1px points)
- [ ] Nebula clouds appear correctly (instanced batch)
- [ ] Hawking radiation particles visible and react to events

## Performance Validation
- [ ] WebGPU FPS >= WebGL FPS on all presets
- [ ] No frame drops during combo effects
- [ ] Memory usage stable over time (no unbounded growth)
- [ ] Dynamic resolution scaling responds to sustained load
- [ ] LOD reduces counts when DRS scale drops

## Feature Flags / Fallbacks
- [ ] `?forceWebGL=1` fallback works
- [ ] `?blackHoleNoCompute=1` uses CPU particles without crashing
- [ ] `?blackHoleNoMRT=1` disables emissive MRT without crashing
- [ ] `?blackHoleNoLensing=1` disables lensing compute
- [ ] `?blackHoleNoPost=1` disables WebGPU post-processing
- [ ] `?blackHoleNoDRS=1` disables dynamic resolution scaling
- [ ] `?blackHoleNoUnified=1` re-enables burst sparks system
- [ ] `?blackHoleNoVolume=1` disables volumetric disk raymarch (uses layered fallback)

## Regression Checks
- [ ] Serenity mode loads without errors
- [ ] Theme switching works (black-hole <-> other themes)
- [ ] Resize is stable (no stretching artifacts)
- [ ] No console errors in WebGPU path
- [ ] No console errors in WebGL fallback path

