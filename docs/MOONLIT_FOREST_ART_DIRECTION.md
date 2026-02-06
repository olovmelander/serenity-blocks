# Moonlit Forest Art Direction Packet

## Goal
Define non-negotiable visual direction for Moonlit Forest so implementation quality is measured against a clear cinematic target, not ad-hoc taste.

## Hero Frame
- Camera framing: moon visible in upper third, with left/right silhouette framing trees.
- Mid-ground focal basin: fog pocket with highest contrast readability.
- Depth stack: foreground silhouettes, readable mid-ground undergrowth, softened distant canopy.

### Locked Camera Spec (Implementation Target)
- Camera: perspective, `fov ~= 58`, `near = 0.1`, `far = 5000`.
- Camera world position target band: `x ~= 0`, `y = 34 +/- 4`, `z = 180 +/- 40`.
- Look target: `(0, 20, -700)` with small ambient drift only.
- Moon corridor target (camera-space): `NDC x >= 0.18`, `NDC y >= 0.22`.
- Depth tier anchors:
  - `back`: `z ~= -1520 .. -1120`
  - `mid`: `z ~= -1120 .. -760`
  - `front`: `z ~= -760 .. -420`
- Focal fog basin anchor: centered near `z ~= -860` with nested brighter pockets forward.

## Lighting Script
- Primary key: cool moonlight, high in scene, directional with gentle shafting.
- Fill: low-intensity blue ambient fill to preserve shadow detail.
- Rim accents: selective cyan-violet bioluminescent highlights for reactive gameplay moments.
- Exposure target: dark cinematic baseline with controlled highlight rolloff.

## Color Script
- Core palette:
  - Night sky blue: `#0A1628`
  - Deep forest teal: `#0D1F35`
  - Mist cyan: `#C0D8F0`
  - Moon glow: `#F4E8A8`
- Reactive accent palette:
  - Cyan: `#00D9FF`
  - Violet: `#A78BFA`
  - Soft green accent: `#6EE7B7`
- Avoid:
  - Daylight greens
  - Flat monochrome blue wash
  - Over-neon global grading

## Material Direction
- Trunks/rocks: visible normal variation and roughness break-up.
- Foliage: layered roughness with occasional wet moon glints.
- Fog: stratified density by depth; no single flat fog sheet.
- Mushrooms: emissive core with soft halo falloff, not hard sprite bloom.

## Reactive FX Direction
- `LINE_CLEAR`: short moonbeam and mushroom intensity pulses.
- `COMBO`: escalating atmospheric energy (wisps, sparkles, aurora hints at thresholds).
- `PIECE_LOCK`: subtle, sparse spark/mist punctuation only.

## Quality Gates
- All presets retain silhouette readability and moon focal composition.
- Minimal/Low preserve mood first, then reduce density.
- Medium+ add depth richness and post polish without color drift.
- WebGL fallback keeps tone and composition coherent even with fewer effects.

## Review Checklist
- Does the frame read as moonlit night immediately?
- Is there a clear focal basin in the mid-ground?
- Do silhouettes frame, rather than clutter, the scene?
- Is bioluminescence an accent, not the base lighting model?
- Does fallback preserve mood and gameplay readability?
