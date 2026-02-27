# Swedish Forest Water: Best-in-Class Visual Upgrade

## Context
The Swedish Forest WebGPU water currently has a solid foundation but relies entirely on layered sine waves for surface detail and a basic sun path. The user wants realistic sun reflections, stunning surface details, and seamless integration with the Firewatch sunset palette. The water should look alive — organic, not mechanical.

## Files to Modify
1. **`src/themes/swedish-forest/swedish-forest-materials.js`** — All shader changes in `createWaterNodeMaterial()` (lines 1402-1596) + new `fbm2D` helper + new import
2. **`src/themes/swedish-forest/swedish-forest-theme.js`** — New parameter values in `createWebGPUWater()` (line 2878)

## Changes

### 1. Add `fbm2D` utility (after existing `noise2D` at line 51)
- 4-octave Fractional Brownian Motion using existing `noise2D`
- Unrolled loop (TSL doesn't support dynamic loops)
- Reusable across multiple effects below

### 2. New uniforms in `createWaterNodeMaterial()`
| Uniform | Default | Purpose |
|---------|---------|---------|
| `uMicroDetailStrength` | 0.35 | Fine ripple highlight intensity |
| `uCausticStrength` | 0.12 | Animated caustic pattern brightness |
| `uSubsurfaceStrength` | 0.18 | SSS glow on wave crests |
| `uSubsurfaceColor` | 0xffd08a | Warm gold SSS tint |
| `uSparkleIntensity` | 0.55 | Dancing sparkle point brightness |
| `uSunPathWidth` | 0.32 | Sun reflection column width |
| `uSecondaryGlowStrength` | 0.15 | Soft outer glow around sun path |

### 3. Multi-octave surface detail (replace lines 1466-1478)
- Keep large sine waves for primary motion
- Add **medium ripples** via `fbm2D` at 0.04 scale — organic rolling motion
- Add **micro-ripples** via `noise2D` at 0.18 scale — fine detail that catches light
- Composite: 30% sine A + 20% sine B + 30% medium + 20% micro
- **Wave-height color**: crests lighter/warmer, troughs deeper — not just uniform tinting
- **Micro-crest highlights**: fine sparkle-catching peaks for surface richness

### 4. Organic vertex displacement (enhance lines 1428-1432)
- Add noise-based displacement (`noise2D` at 0.06 scale, amplitude 0.12) on top of existing sine waves
- Breaks up the perfectly periodic wave motion

### 5. Enhanced sun path & specular (replace lines 1528-1560)
- **Noise-distorted path axis** — the sun column wobbles organically, not straight
- **Wider secondary glow** — soft wide falloff around the main bright path
- **Dancing sparkle points** — two noise layers with sharp threshold create discrete glinting points that appear/disappear on wave crests
- **Dual specular lobes**: tight pow(80) for intense highlights + broad pow(12) for warm ambient glow
- **View-dependent intensity**: stronger when camera looks toward the sun

### 6. Subsurface scattering (new section after specular)
- Simulates light passing through thin water at wave crests
- `dot(viewDir, -sunDir)` drives back-lighting factor
- Gated by `waveCrestMask` — only crests glow
- `uSubsurfaceColor` (warm gold) creates convincing light transmission

### 7. Caustic light patterns (new section before sun path addition)
- `abs(noise1 - noise2)` at slightly different scales → cell-edge brightening
- Resembles real underwater caustics
- Depth-faded: strongest at mid-depth, fades at horizon and near shore
- Warm gold color (0.18, 0.10, 0.03) multiplied by `uCausticStrength`

### 8. Color depth improvements (after depth gradient)
- **Temperature variation**: slow-moving noise patches shift warm/cool subtly across surface
- **Radial depth**: center of lake slightly brighter than edges

### 9. Updated final assembly & emissive
- Final color: `waterBase + sunPathColor + sunSpecularColor + sssColor + fresnelRim`
- Emissive: `(sunPath + specular + sss*0.5 + caustics*0.3) * emissiveStrength`

### 10. Theme parameter updates
- Bump `sunPathStrength: 0.72` (new breakup allows higher intensity)
- Bump `emissiveStrength: 0.32` (SSS and caustics add bloom-worthy content)

## Performance
- ~10 additional `noise2D` calls per fragment + 1 `fbm2D` (= 4 noise2D)
- Total ~14 noise evaluations — each is 4 hash calls (dot + sin + fract)
- Single mesh, bounded screen coverage (~30-50%)
- RTX 3070 at 1080p handles this easily
- All new features can be disabled by setting their strength uniform to 0

## Verification
- Load Swedish Forest theme in WebGPU mode
- Confirm water has organic multi-scale ripple detail (no more uniform sine stripes)
- Confirm sun path has noise breakup and dancing sparkle points
- Confirm warm golden glow on wave crests (SSS) when looking toward sun
- Confirm subtle animated caustic patterns in mid-depth water
- Confirm performance stays near 60fps on F3 overlay
- Confirm shore foam, object foam, and edge fade still work correctly
