# Bioluminescence Theme - Art Direction & Visual Pillars

## Executive Summary
This document defines the strict art direction for the "Bioluminescence" theme upgrade. The goal is to move from a generic "neon cave" look to a **Subnautica-inspired deep-sea/subterranean ecosystem**. Darkness is the canvas; light is used selectively to guide the eye and create depth.

**Companion document:** `BIOLUMINESCENCE_WEBGPU_UPGRADE_PLAN.md` — full technical implementation plan.

---

## 1. Visual Pillars

### A. Darkness is the Canvas
- **Principle:** The screen should be 40-65% dark (near-black) at any given time.
- **Why:** Bioluminescence only reads effectively against a deep, dark background.
- **Implementation:**
    - Ambient light is minimal.
    - Fog base color is Abyss Navy (`#020810`).
    - Clear color is Abyss Navy (`#020810`) — never pure `#000000`.
    - Rocks are dark slate (`#0A1518`) with almost no diffuse contribution, receiving only specular highlights and local point light.

### B. Organic Glow Hierarchy
- **Principle:** Not everything glows equally. There is a strict hierarchy of brightness.
- **Hierarchy (8 tiers, brightest to darkest):**
    1.  **Crystal Tips** (Brightest — bloom weight 1.00, drives MRT bloom peaks)
    2.  **Mushroom Cap Centers** (Strong glow — bloom weight 0.80)
    3.  **Fireflies / Wisp Particles** (Moving high-intensity points — bloom weight 0.70)
    4.  **Mushroom Cap Edges / Gills** (Subsurface scattering soft glow via transmission)
    5.  **Spore Cores & Crystal Bodies** (Medium floating/internal glow — bloom weight 0.60)
    6.  **Mycelium Network** (Pulse-driven, rhythmic connecting glow — bloom weight 0.50)
    7.  **Vine Orbs (0.45), Moss Patches (0.30), God Rays (0.20), Mushroom Stems (0.10), Cave Wall Veins (0.05)** (Subtle ambient glow)
    8.  **Rock Surfaces, Stalactites, Background Void** (Non-emissive — bloom weight 0.00)

- **Water** sits between tiers 6-7: subsurface plankton glow is self-emissive (bloom weight 0.15) but restrained. Water does NOT reflect bioluminescence as bright specular highlights — it absorbs and scatters softly.

### C. Living Motion
- **Principle:** Everything breathes. Nothing is static.
- **Implementation:**
    - Mushrooms gently expand/contract (breathing).
    - Spores drift with curl noise, not linear paths.
    - Light intensity pulses with a biological rhythm (heartbeat), not a mechanical sine wave.
    - Per-instance phase offsets prevent synchronized pulsing (mushrooms must NOT breathe in sync).

### D. Depth Stratification
- **Principle:** The scene must read as a vast 3D volume, not a flat backdrop.
- **Three Biome Bands (Subnautica Composition):**
    1.  **Band A — Foreground Fungal Grove (20-35% frame):** Board-adjacent framing elements, high-detail mushrooms and vine tendrils, controllable occlusion. Occasional large, out-of-focus spores passing near camera.
    2.  **Band B — Mid Cavern Corridor (35-55% frame):** Dominant storytelling layer with mushroom/crystal/mycelium ecosystem and the Tetris board. This is where the play area lives.
    3.  **Band C — Far Abyss Chamber (20-35% frame):** Large silhouettes of distant cave formations, sparse pulses, deep negative space receding into volumetric fog.
- **Rules:**
    - Board readability pocket remains protected in all event states.
    - Each band has separate animation cadence and brightness ceiling.
    - Composition is asymmetric and organic; avoid mirrored placement and repeated silhouettes.
    - Restrict simultaneous hero highlights to at most two major anchors.

---

## 2. Color Palette Lock (Subnautica-Inspired)

| Role | Color Name | Hex Code | Usage |
| :--- | :--- | :--- | :--- |
| **Primary Glow** | **Vivid Cyan** | `#00FFD4` | Mushroom caps, spore cores, primary emissive. |
| **Secondary Glow** | **Bioluminescent Teal** | `#00C9A7` | Crystal interiors, vine orbs, gill glow. |
| **Accent Warm** | **Phosphor Green** | `#66FFAA` | Moss patches, algae, rare firefly trails, Cluster Mini species. |
| **Accent Cool** | **Deep Aqua** | `#0088AA` | Water subsurface, deep crystal, cave veins. |
| **Highlight** | **White-Cyan** | `#CCFFFF` | Brightest bloom peaks, crystal tips, combo flash. Short-lived and event-gated only. |
| **Shadow Base** | **Abyss Navy** | `#020810` | Background void, deep shadows, fog base, clear color. |
| **Rock Base** | **Wet Slate** | `#0A1518` | Cave floor, walls, stalactites (non-emissive). |
| **Water Deep** | **Midnight Teal** | `#001A1A` | Deep water areas, pool center, water attenuation color. |

**Rules:**
- **No RGB Pure Red/Blue/Green:** Avoid standard "programmer colors".
- **Warm Accents are Sparse:** Use `#66FFAA` sparingly (< 5% of screen) to direct attention.
- **Black is not #000000:** Use `#020810` (Abyss Navy) for "black" to maintain atmospheric consistency.
- **`#CCFFFF` highlight is short-lived:** Never baseline ambience — only appears during events and decays within 0.5-2s.
- **Rock and background values stay dark:** Even under combo bursts, non-emissive surfaces must NOT bloom.

### Per-Mushroom Color Variation
Every mushroom in the current theme is identical teal. The upgrade must include:
- Base hue variation: ±15° around primary cyan per mushroom instance.
- Size-correlated brightness: larger mushrooms = brighter base glow.
- Random pulse phase offset: mushrooms must NOT all breathe in sync.
- Species-specific color shift: Cluster Mini → Phosphor Green, Giant Ancient → deeper Teal.

---

## 3. Composition & Framing

### The "Hero" Shot
A successful frame should contain:
- **Left/Right Balance:** Asymmetrical organic framing (e.g., large mushroom cluster on left, receding cave path on right).
- **Central Focus:** The Tetris board is framed by the cave opening (negative space), ensuring gameplay visibility.
- **Verticality:** Stalactites hanging from top, stalagmites/mushrooms from bottom, creating a "teeth" effect that frames the board.

### Readability Safe-Zones
- **Tetris Board:** The area immediately behind the board must be low-frequency and low-contrast.
- **Active Piece Area:** No bright particles or flashing lights should cross the active piece drop zone.
- **Board ROI contrast:** >= 4.5:1 during `LINE_CLEAR`, `COMBO`, and `TETRIS` events.
- **Bloom budget:** Capped per quality tier. Non-emissive leakage in bright bloom mask <= 3.0% of bright pixels.

---

## 4. Motion Grammar

| Element | Movement Pattern | Speed | Phase |
| :--- | :--- | :--- | :--- |
| **Mushrooms** | "Breathing" scale + intensity | Slow (4-9s period, biologically varied) | Offset per instance |
| **Spores** | Curl noise / Brownian motion with intermittent buoyancy lifts | Slow drift | Random |
| **Fireflies** | Short elliptical loops with stochastic rest intervals | Fast bursts, then hover | Independent |
| **Mycelium** | Pulse wave propagation along network paths | Triggered by events | Linear wave from source |
| **Fog** | Slow rolling turbulence | Very slow | n/a |
| **God Rays** | Gentle intensity fluctuation with dust motes | Slow | n/a |

**Anti-Patterns (Automatic Reject):**
- Particles moving in straight, robotic trajectories for long durations.
- Uniform pulse timing across all emissive organisms.
- Strobe-like luminance shifts during events.

---

## 5. Mycelium Network (Signature Visual)

The mycelium network is the **defining feature** of this theme — a bioluminescent neural web connecting all organisms in the cave.

### Visual Description
- Thin glowing tubes (radius 0.3-0.8) connecting nearby mushroom and crystal bases.
- Organic paths using CatmullRomCurve3 with jittered midpoints (no perfectly straight lines).
- Partially visible through terrain via emissive cracks that align with underground mycelium paths.

### Behavior
- **Idle:** Faint ambient glow, barely visible. Subtle rhythmic pulse every 8-15s.
- **Event-triggered:** Game events propagate brightness waves along the network from the event source outward. The wave travels at a biologically plausible speed (not instantaneous), creating a "neural signal" effect.
- **TETRIS event:** Full network fires simultaneously, then desynchronizes back to ambient state over 2s.

### Bloom & Brightness
- Bloom weight: 0.50 (moderate — visible glow but never competing with mushroom/crystal tier).
- Network density scales with quality preset (Extreme: full web, Medium: sparse connections, Low: static tubes only).

---

## 6. Event Reactions

| Game Event | Visual Response | Envelope Duration |
| :--- | :--- | :--- |
| **Piece Lock** | Localized ripple in nearby mycelium/mushrooms. Small discrete spore burst (not just density increase). | 0.3s decay |
| **Line Clear** | Flash of **White-Cyan** light. Cave briefly illuminates. Mycelium pulse from event location. Water ripple. | 0.8s decay |
| **Combo (1-3)** | Progressive brightening of nearby organisms. Spore density increases. Atmosphere lifts slightly. | 1.0s sustained decay |
| **Combo (4+)** | Above + broader atmosphere shift, water glow intensifies, fog density decreases to reveal more depth. | 1.5s sustained decay |
| **Tetris** | Major "Heartbeat" event. All organisms pulse in unison once, full mycelium network fires, atmosphere peaks. Then rapid desynchronization back to calm baseline. | 2.0s decay |
| **Top Out** | Lights dim rapidly to black (power down). All emissive intensities decay to zero over 1.5s. Spores settle. Mycelium goes dark. Final state: only Abyss Navy (`#020810`) remains. | 1.5s to darkness |

### Event Restraint Rules
- Combo effects must not hide board edges or piece contrast.
- Event-driven luminance shifts avoid strobe-like behavior.
- Chromatic aberration remains subtle and event-scaled (baseline near-zero, peak during TETRIS only).
- More than 0.5s of sustained highlight clipping during normal play is an automatic reject.

---

## 7. Water Pool

The cave water pool is a visual centerpiece, not a generic water shader.

### Visual Goals
- **Subsurface plankton glow:** Animated clusters of faint bioluminescent light beneath the water surface. These are self-emissive but restrained (bloom weight 0.15).
- **Depth-based opacity:** Transparent at shallow edges, opaque at deep center.
- **Animated normals:** Multi-layer sine ripples for organic water motion.
- **Caustics:** Faint animated light patterns projected onto underwater terrain (even faked via texture projection).
- **Shore foam:** Noise-based pattern at water's edge.
- **Contact ripples:** Circular ripple patterns at mushroom/crystal bases where they meet the water.

### What Water Does NOT Do
- Water does not produce bright specular reflections that compete with bioluminescent organisms.
- Water surface does not have additive blending — it uses transmission/opacity.
- Water color stays within Midnight Teal (`#001A1A`) to Deep Aqua (`#0088AA`) range.

---

## 8. Technical Constraints for Art

- **Poly Count:** ~300k triangles visible max.
- **Texture Resolution:** Max 2048x2048 for atlases.
- **Point Lights (quality-gated):**
    - Extreme: 8 dynamic point lights
    - Ultra: 6
    - High: 5
    - Medium and below: 0 (emissive-only, no dynamic lights)
    - WebGL fallback: 0 dynamic lights (baked only)
- **Particles (quality-gated):**
    - Extreme: 3000 spores + 200 fireflies + 2000 dust motes
    - High: 1000 spores + 100 fireflies + 1000 dust motes
    - Medium: 500 spores + 50 fireflies
    - Low: 200 spores only
    - WebGL fallback: 200 spores (THREE.Points)
- **Mushroom Species:** 4 distinct types (Tall Spire, Shelf/Bracket, Cluster Mini, Giant Ancient)
- **Crystal Types:** 3 distinct types (Pillar, Ceiling, Micro-Crystal instances)
- Mushroom Species: 4 distinct types
- Crystal Types: 3 distinct types
- **Dust Motes:** Separate atmospheric particles that float freely in the cave volume (distinct from god ray particles). Catch light from nearby emissive sources.
- **Jellyfish (Extreme/Ultra only):** 2-4 translucent ghost-like creatures with gentle pulsing locomotion. Bloom weight 0.55. Not present below Ultra preset.
- **God Rays:** 4-8 cone-shaped light shafts at ceiling openings. Bloom weight 0.20. Contain internal dust mote particles for volumetric depth.

---

## 9. Reference Imagery
*(Mental Sandbox)*
- **Subnautica:** Lost River, Jellyshroom Caves. See the way spacing creates scale. Darkness-first composition with selective emissive organisms.
- **Avatar (2009):** Night scenes. Biolum is outline/accent, not floodlight. Deep volumetric atmosphere.
- **Real Life:** Waitomo Glowworm Caves. Tiny points of light creating a "starfield" on the ceiling.
- **Deep-sea macro footage:** For motion and pulse rhythm reference only (organic, non-mechanical movement language).

### Style Guardrails
- Emulate Subnautica mood principles (darkness-first, selective glow, layered depth), not specific set pieces or exact layouts.
- No direct copying of third-party assets, symbols, creatures, landmarks, or composition replicas.
- Preserve Bioluminescence theme identity through existing mushroom/crystal/mycelium motif and palette lock.
