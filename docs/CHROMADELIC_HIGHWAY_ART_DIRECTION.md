# Chromadelic Highway Art Direction Packet

## Intent

Deliver a high-speed psychedelic tunnel aesthetic that feels cinematic, musical, and readable during gameplay.

Core mood:
- Velocity and forward pull
- Neon wonder without visual noise
- Rhythmic reactivity tied to gameplay events

---

## Visual Hierarchy

Priority order:
1. Road readability and motion direction.
2. Tunnel ring cadence and depth rhythm.
3. Celestial spectacle and atmospheric accents.

Rule:
- Lower-priority layers must never flatten or obscure higher-priority layers.

---

## Color Script

Primary:
- Controlled rainbow progression with dark-value floor preserved.

Secondary:
- Cyan/magenta/orange accents for event spikes.

Constraints:
- Avoid persistent full-frame white bloom.
- Avoid constant peak saturation.
- Keep enough neutral contrast for board-edge readability.

---

## Camera and Composition

Camera principles:
- Stable horizon behavior.
- Road centerline remains legible at all times.
- Planet corridor remains primary focal anchor.

Depth bands:
- Foreground: road + near ring glow
- Midground: active ring cadence + speed particles
- Background: planets, nebula haze, starfield

---

## Hero Frame Definitions

Use these labels when capturing:

1. `hero-idle`
- No active combo burst.
- Road and ring baseline readability.

2. `hero-default`
- During default event playback (`combo ~4`, moderate line clears).
- Validate balanced reactivity.

3. `hero-stress`
- During stress playback (`combo ~8`, strong line clears).
- Validate peak effect containment.

4. `hero-readability-line-clear-4`
- Immediately after 4-line clear anchor.
- Validate board-adjacent clarity and overbloom control.

5. `hero-readability-combo-8`
- Immediately after high-combo anchor.
- Validate ring/particle intensity limits and preserved silhouette contrast.

---

## Readability Acceptance

Pass criteria:
- Road lane flow remains visually trackable in all hero frames.
- Ring edges remain separated (no bloom wash merge).
- Planet remains focal in background, not dominant over gameplay view.
- Event peaks decay quickly enough to restore baseline clarity.

Fail examples:
- Full-screen washout during combo spikes.
- Chromatic aberration causing edge smearing.
- Ring tunnel collapsing into a bright uniform tube.

---

## Capture Notes

Deterministic baseline flags:
- `chromadelicBaseline=1`
- `chromadelicSeed=1234`
- `chromadelicFixedDt=16.666`

Recommended tooling:
- `tests/performance/benchmark-chromadelic-baseline.html`
- `window.chromadelicBaseline.capturePack(...)`
- `window.chromadelicBaseline.captureReadability(...)`

Protocol:
- See `docs/CHROMADELIC_HIGHWAY_BASELINE_CAPTURE_PROTOCOL.md`.
