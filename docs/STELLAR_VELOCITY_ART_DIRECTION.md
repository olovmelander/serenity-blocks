# Stellar Velocity Art Direction Packet (No Man's Sky Hyperdrive-Inspired)

## North Star

Stellar Velocity should feel like a committed No Man's Sky hyperdrive jump loop:
- route intent,
- charge ritual,
- violent FTL transit,
- clean deterministic recovery.

This is not random "warp speed wallpaper." It is a gameplay-reactive jump sequence with clear phase language.

## Inspiration Guardrail

Use No Man's Sky as a mood/mechanics reference, not as an asset copy target.
- Keep original composition, shaders, and behaviors in Stellar Velocity.
- Do not replicate branded UI/iconography, ships, or specific scene layouts.

## Canon Anchors (Research-Locked)

### Mechanics anchors
- Hyperdrive is the FTL warp system and is tied to map-based system travel.
- Fuel language is `Warp Cell` / `Warp Hypercore`.
- `Warp Hypercore` exists as a high-capacity fuel unit (officially documented in Beyond update notes).
- Community-maintained wiki pages consistently describe one-jump Warp Cell pacing and Galactic Map usage language.

Terminology rule:
- UX/docs must use `Warp Cell` and `Warp Hypercore`.
- `Fusion Cell` is not used in the currently verified canonical references.

### Visual anchors
- Warp transitions were explicitly optimized to feel much faster on newer hardware.
- Hyperdrive warp audiovisuals were explicitly reworked in later updates.
- Lighting direction includes softer bloom behavior, animated lens flare halos, and volumetric lighting cues.
- Color direction explicitly leans into a 1970s sci-fi palette.

## Direction Pillars

1. Destination Commitment
- Jump energy must feel aimed, not random.

2. Ritualized Hyperdrive
- Every jump phase has distinct timing and visual function.

3. Controlled Spectacle
- Peak intensity is dramatic but bounded by board readability.

4. Depth-First Motion
- Near/mid/far layers must show clear parallax and velocity separation.

## No Man's Sky -> Stellar Velocity Translation Matrix

| NMS cue | Stellar Velocity translation | Owner |
|---|---|---|
| Galactic map route commitment | `MAP_LOCK` center-axis convergence + route-bias arcs | Renderer + core FX |
| Hyperdrive charge-up ritual | ring harmonics + core accretion acceleration | Material/reactive envelope |
| FTL tunnel punch | depth-banded streak elongation + velocity surge | Starfield path (CPU/compute parity) |
| Arrival puncture | core-only re-entry flash + fast settle | Post + envelope decay |
| Stylized retro sci-fi skies | cyan/teal/indigo/magenta script on deep black | Nebula grade + color cycle |

## Jump Choreography Spec

1. `MAP_LOCK` (`0.35s-0.65s`)
- Axis tightens toward core.
- Subtle route-guidance glyphs bias toward destination vector.
- Camera shake nearly zero; precision mood.

2. `HYPERDRIVE_SPOOL` (`0.55s-0.95s`)
- Ring shimmer frequency ramps.
- Core disc brightens and accelerates.
- Streak seeds appear but stay short.

3. `FTL_TRANSIT` (`1.20s-2.80s`)
- Star streak length and speed surge.
- Slight tunnel compression/FOV tighten.
- Bloom/chromatic rise with hard caps.

4. `REENTRY_SETTLE` (`0.40s-0.90s`)
- Puncture flash at core only (no full-frame whiteout).
- Rapid deterministic decay to baseline.
- Camera shake resolves predictably.

## Current-Look Lock (From Existing Theme)

These anchors are mandatory to preserve theme identity:
- Cyan-white core remains the dominant focal element.
- Dense central cluster with sparser large peripheral stars remains intact.
- Dark asteroid silhouettes continue to provide scale reference.
- Red/blue/teal nebula sweeps remain the atmospheric frame behind the core.

## Color Script

Primary:
- Deep space black,
- cyan-white core energy,
- cool blue tunnel light.

Reactive accents:
- Teal, indigo, magenta only during elevated states (`combo >= 4`).

Limits:
- No persistent full-frame bloom haze.
- No black crush near board-adjacent regions.
- Maximum saturation reserved for peak jump/combo windows.

## Material and Post Intent

- Bloom should be emissive-isolated when MRT path is available.
- Chromatic aberration remains edge-biased and event-scaled, never baseline-heavy.
- Lens halos should animate subtly with energy, not constantly pulse.
- Nebula layers support depth and mood, not noise fill.

## Gameplay Readability Contract

Pass conditions:
- Core silhouette remains readable in every phase.
- Board-edge contrast remains stable at `combo 8-10`.
- Post-peak decay returns to safe readability quickly and deterministically.
- Depth ordering between stars/debris/core remains legible under stress.

Fail conditions:
- Full-frame white bloom during transit/re-entry.
- Tunnel streaks smearing board-adjacent play space.
- Chromatic or shake values that hide interaction-critical details.

## Phase Integration Requirements

- Single reactive envelope owns pulse/bloom/warp/chromatic/shake writes per frame.
- CPU and compute starfield paths must preserve depth-band behavior parity.
- Deterministic review mode (`seed`, fixed dt) is mandatory for signoff captures.
- Any visual upgrade that breaks WebGL fallback readability is rejected.

## Hero Frame Pack (Approval Set)

1. `hero-idle`
- No jump phase active; baseline atmosphere.

2. `hero-default`
- Mid-energy jump feel (`combo ~3-5`).

3. `hero-stress`
- Peak energy (`combo ~8-10`) with readability preserved.

4. `hero-readability-piece-lock`
- Piece-lock response without clutter.

5. `hero-readability-combo-10`
- Max reactive envelope + controlled rapid decay.

6. `hero-warp-spool`
- Mid-spool clarity for ring harmonics + core acceleration.

7. `hero-warp-transit`
- Long streak transit while core remains visually dominant.

## Validation Workflow

Deterministic flags:
- `stellarVelBaseline=1`
- `stellarVelSeed=1234`
- `stellarVelFixedDt=16.666`

Capture helpers:
- `window.stellarVelocityBaseline.capturePack(...)`
- `window.stellarVelocityBaseline.captureReadability(...)`
- `window.stellarVelocityBaseline.presetSwitchStress(...)`

## Source Notes

Official sources:
1. Next Generation update (Hyperdrive warp speed increase statement):  
https://www.nomanssky.com/next-generation-update/
2. Prisms update (Hyperdrive warp effects sensory overhaul):  
https://www.nomanssky.com/2022/06/prisms-update/
3. Desolation update (bloom/lens flare/volumetric lighting direction):  
https://www.nomanssky.com/desolation-update/
4. Worlds Part I update (explicit 1970s science fiction palette):  
https://www.nomanssky.com/worlds-part-i-update/
5. Beyond update (official `Warp Hypercore` reference and map/UI clarity updates):  
https://www.nomanssky.com/beyond-update/

Community references (used for terminology/mechanics detail):
6. Hyperdrive entry:  
https://nomanssky.fandom.com/wiki/Hyperdrive
7. Warp Cell entry:  
https://nomanssky.fandom.com/wiki/Warp_Cell
