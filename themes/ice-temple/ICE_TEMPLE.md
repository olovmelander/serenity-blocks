# 🎨 Ice Temple Theme (8 Layers)

**Base Inspiration:**
![Ice Temple Reference](reference.jpg)

**Theme Name:** Frostborn Sanctum

## Mood & Style

- **Atmosphere:** Mystical, serene, ancient — a frozen cathedral of ice and light, where crystalline structures reach toward cosmic auroras.
- **Color Palette:** Deep blues (#0a1628, #1a2e4a), cyan/teal (#74b9ff, #55efc4, #00d4ff), ice white (#e3f2ff), purple/violet accents (#a29bfe, #8b7bd8).
- **Emotions:** Awe, tranquility, isolation, otherworldly wonder — players should feel like they've entered a sacred frozen realm touched by celestial magic.

---

## 🌌 Layer Breakdown

### Layer 1 – Sky / Background

- **Design:** Deep gradient from midnight blue (#0a1628) at top to slightly lighter blue (#1a2e4a) at horizon.
- **Elements:** Dense star field with subtle twinkling (small white dots, varied opacity 0.3–0.8).
- **Motion:** Very subtle stars twinkle with 3–5s fade cycles, randomly offset.
- **Implementation:** Canvas layer with scattered dots using seeded random for consistent placement.

### Layer 2 – Aurora Borealis

- **Design:** Flowing curtains of cyan (#74b9ff), teal (#55efc4), and violet (#a29bfe) northern lights.
- **Elements:** 3–4 translucent vertical wave forms stretching from top to mid-screen.
- **Motion:** Slow undulating animation (20–30s cycles), each curtain phase-shifted for natural variance.
- **Glow:** Soft blur/glow effect to create ethereal luminescence.

### Layer 3 – Distant Ice Mountains

- **Design:** Silhouetted jagged mountain peaks in deep blue (#1a3a5a), appearing far on horizon.
- **Elements:** Sharp triangular peaks with slight transparency (0.6 opacity).
- **Motion:** Very slow parallax movement (0.1x scroll speed).
- **Details:** Faded to suggest extreme distance, minimal detail.

### Layer 4 – Midground Crystalline Structures

- **Design:** Large geometric ice formations — sharp angular crystal towers and spires.
- **Elements:** Translucent cyan/blue crystals (#74b9ff at 0.4–0.5 opacity) with white edge highlights.
- **Motion:** Medium parallax (0.3x scroll speed).
- **Details:** Geometric shapes (triangular, hexagonal), some reaching from floor upward, others suspended.

### Layer 5 – Foreground Ice Architecture

- **Design:** Bold, high-contrast ice crystals and frozen structures in immediate foreground.
- **Elements:**
  - Large stalactites hanging from ceiling (top of screen)
  - Stalagmites rising from floor (bottom of screen)
  - Sharp geometric forms in brighter ice white (#e3f2ff) with cyan tints
- **Motion:** Faster parallax (0.5x scroll speed).
- **Details:** Crisp edges, strong highlights, subtle refraction lines within crystals.

### Layer 6 – Atmospheric Overlay (Frozen Mist)

- **Design:** Wispy, translucent ice fog drifting across screen.
- **Elements:** Soft white/cyan mist patches (opacity 0.1–0.2).
- **Motion:** Slow horizontal drift (15–25s loop), some layers moving left, others right.
- **Purpose:** Adds depth and mystical atmosphere without obscuring gameplay.

### Layer 7 – Particles & Motion Effects

- **Design:** Falling snowflakes and floating ice crystals.
- **Elements:**
  - **Snowflakes:** Small white dots falling gently (varied sizes 1–3px)
  - **Ice Dust:** Tiny glittering particles catching light, drifting upward occasionally
  - **Frozen Sparkles:** Occasional bright flashes on crystal surfaces
- **Motion:**
  - Snow falls slowly with slight horizontal sway
  - Ice dust drifts with subtle randomized paths
  - Sparkles pulse 0.5–1s duration at random intervals
- **Count:** ~30–50 particles total for visual richness without performance hit.

### Layer 8 – Dynamic Light Refractions

- **Design:** Prismatic light rays refracting through ice structures.
- **Elements:** Thin colored rays (cyan, white, violet) emanating from crystals at angles.
- **Motion:** Subtle rotation (30–60s), gentle opacity pulsing (0.2–0.5 range).
- **Effect:** Creates sense of living light within frozen temple.
- **Sync:** Could intensify slightly during gameplay combos or special events.

---

## ✨ Optional Dynamic Notes

- **Color Cycle:** Aurora colors could shift slightly warmer (more violet/purple) during intense gameplay moments, cooler (more cyan/blue) during calm periods.
- **Parallax Strength:**
  - Layer 1 (Sky): 0x (static)
  - Layer 2 (Aurora): 0.05x
  - Layer 3 (Mountains): 0.1x
  - Layer 4 (Mid Crystals): 0.3x
  - Layer 5 (Foreground): 0.5x
  - Layer 6–8 (Atmosphere/Particles): Variable drift, not camera-locked
- **Special Feature:** **Prismatic Pulse** — when player achieves combos or clears lines, crystals briefly flash with rainbow refraction, and aurora intensifies for 1–2 seconds.

---

## 📛 Theme Name

**Frostborn Sanctum**

Alternative names:
- Glacial Cathedral
- Aurora Temple
- Crystalis Shrine

---

## 📚 Reference Existing Themes

For implementation examples, see:
- **[Wolfhour](../../script.js#L4318)** - `createWolfhourScene()` - Dense star fields, nebula clouds, shooting stars
- **[Lunara](../../script.js#L4571)** - `createLunaraScene()` - Twinkling stars, aurora streaks, twin planets with glow
- **[Neon Dusk](../../script.js#L4924)** - `createNeonDuskScene()` - Neon stars, purple clouds, meteors, mountain silhouettes

**Current Implementation:** [script.js#L123](../../script.js#L123) - `createIceTempleScene()`

---

## 🎯 Implementation Checklist

- [x] Layer 1: Starfield background with twinkling animation
- [x] Layer 2: Multi-colored aurora curtains with wave animation
- [x] Layer 3: Distant mountain silhouettes with minimal parallax
- [x] Layer 4: Midground crystal formations with medium parallax
- [x] Layer 5: Foreground ice architecture (stalactites/stalagmites) with strong parallax
- [x] Layer 6: Drifting frozen mist overlay
- [x] Layer 7: Snowfall and ice particle system
- [x] Layer 8: Light refraction rays with rotation/pulse
- [ ] Dynamic: Prismatic pulse effect on player actions (future enhancement)
- [x] Optimization: Canvas caching for static crystal layers
- [x] Testing: Implementation complete, ready for user testing

---

## 🔧 Technical Notes

**Current Implementation Uses:**
- WebGL renderer for crystal architecture (3 layers cached)
- Seeded random for deterministic crystal placement
- Canvas caching system for performance
- DOM elements for aurora curtains, waterfalls, and refractions

**Recommended Enhancements:**
- Consolidate all layers into WebGL pipeline for better performance
- Implement particle buffer pooling for snowflakes
- Add subtle shader effects for ice refraction (if WebGL capability exists)
- Consider reducing DOM manipulation in favor of canvas/WebGL rendering
