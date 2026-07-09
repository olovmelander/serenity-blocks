# Stellar Drift Art Direction Packet

## Intent

Deliver a cinematic space-flight mood with clear gameplay readability.

Core mood:
- Majestic, slow celestial drift around a dominant hero gas giant.
- Layered nebula depth with controlled saturation peaks.
- Event-reactive warp pulses that feel fast but never noisy.

---

## Visual Hierarchy

Priority order:
1. Hero gas giant and ring silhouette.
2. Meteor belt rhythm and near-field motion.
3. Nebula depth layers and distant stars.

Rule:
- Lower-priority layers must not flatten or overpower higher-priority layers.

---

## Color Script

Primary:
- Deep black/indigo base with magenta/cyan/amber accents.

Secondary:
- White-hot highlights for combo peaks and shooting stars.

Constraints:
- Avoid persistent full-frame bloom wash.
- Keep dark-value floor for board-edge contrast.
- Reserve strongest saturation for lock/combo beats.

---

## Camera and Composition

Camera principles:
- Stable framing with subtle drift; no chaotic camera jumps.
- Hero gas giant remains compositional anchor.
- Warp/tunnel effects should intensify center focus, not smear edges.

Depth bands:
- Foreground: meteors, shockwave rings, shooting stars.
- Midground: hero planet + dust ring.
- Background: nebula planes and distant starfield.

---

## Hero Frame Definitions

Use these labels for baseline capture packs:

1. `hero-idle`
- No active combo burst.
- Validate default readability and composition.

2. `hero-default`
- During default playback (`combo ~4-6`).
- Validate controlled reactive uplift.

3. `hero-stress`
- During stress playback (`combo ~8-12`).
- Validate peak containment and no bloom washout.

4. `hero-readability-piece-lock`
- Immediately after `PIECE_LOCK`.
- Validate star twinkle and dust pulse do not obscure board context.

5. `hero-readability-combo-10`
- Immediately after high-combo anchor.
- Validate warp effects remain readable and recover quickly.

---

## Readability Acceptance

Pass criteria:
- Hero planet silhouette remains legible in all hero frames.
- Meteor belt remains distinguishable and non-flickery during warp.
- Vignette/chromatic effects do not hide board-adjacent contrast.
- Effect peaks decay quickly back to baseline clarity.

Fail examples:
- Full-screen bloom haze at combo peaks.
- Excessive color fringing causing edge blur.
- Dense particle bursts masking focal structure.

---

## Capture Notes

Deterministic flags:
- `stellarBaseline=1`
- `stellarSeed=1234`
- `stellarFixedDt=16.666`

Tooling:
- `tests/performance/benchmark-stellar-baseline.html`
- `window.stellarBaseline.capturePack(...)`
- `window.stellarBaseline.captureReadability(...)`

Protocol:
- See `docs/STELLAR_DRIFT_BASELINE_CAPTURE_PROTOCOL.md`.
