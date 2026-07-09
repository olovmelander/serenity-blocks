# Gameplay Visual Effects — Best-in-Class Improvement Plan

> Goal: make the on-canvas gameplay effects (playing, line clears, combos, cascades,
> locks, drops) visually stunning and best-in-class.
>
> Status: planning doc. Branch context: `development_phaser_20251011` (Phaser 4 migration).
> Generated from a full-codebase audit of the rendering/effects stack.

---

## Headline

The tech is **not** the bottleneck — the wiring is. The engine already has a Three.js
post-processing stack, a WebGPU fluid-sim theme, an audio-reactive director, pooling,
tweens, and a spring-physics juice system. The gaps are: **flat-filled blocks**, a
**gorgeous background/post-FX stack that barely reacts to gameplay**, **no escalation
model** (a single clear ≈ a Tetris; cascades 2–9 are invisible; perfect clears are
silent), and **no shared effect orchestrator**.

---

## What already exists (don't rebuild)

| System | Where | Notes |
|---|---|---|
| Render core | `src/rendering/phaser/base-board-scene.js` | Phaser 4 WebGL. 3 layers: dirty-tracked board, per-frame piece/ghost, per-frame effects. Transparent over a separate WebGL/WebGPU background scene. |
| Post-FX pipeline | `src/rendering/odyssey/effects/PostProcessingStack.js` | Bloom, chromatic aberration, vignette, film grain + quality presets. |
| Audio reactor | `src/rendering/odyssey/composition/OdysseyAudioReactor.js` | Exposes `energy/bass/mid/treble/beat/sinceBeatMs`. |
| Director | `src/rendering/odyssey/composition/OdysseyDirector.js` | Already maps audio → bloom/godray; ideal place to ingest gameplay metrics. |
| Spring juice | `src/rendering/phaser/board-juice.js` | `nudge/dip/bounce/tilt/pulse` via GPU CSS transforms. |
| Shared effects | `src/rendering/phaser/shared-effects.js` | Line-clear flash/particles, combo popup, cascade mega, lock ripple, hard-drop beam. |
| Pooling | `src/utils/object-pool.js` | Generic pool + `particlePool` (100/500), `piecePool`, `garbageEntryPool`. |
| Event-driven theme reactions | `src/themes/electric-dreams-v3/sim/fluid-emitters.js`, `src/themes/himalayan-peak/...` | Already subscribe to `LINE_CLEAR`/`COMBO`/`PIECE_LOCK`. Pattern to generalize. |
| Quality budgets | `src/rendering/phaser/utils/quality.js` | Per-effect quality scaling already wired. |

---

## The four structural gaps

1. **Blocks are flat `fillRect`** — `src/rendering/phaser/base-board-scene.js:942`
   (`drawBlock`). Biggest "looks cheap" tell; runs every frame for every cell.
2. **Background/post-FX stack barely reacts to gameplay.** The Tetris-Effect magic is a
   line clear rippling into the *whole world*. Machinery exists but isn't generalized.
3. **No escalation model.** Single clear ≈ Tetris; cascades 2–9 produce nothing
   (`src/rendering/phaser/shared-effects.js:638`); B2B and perfect clears aren't celebrated.
4. **No shared effect orchestrator.** Effects are ad-hoc `delayedCall` chains; no
   event→effect registry, no intensity bus, no hit-stop controller.

---

## Foundations to build first (force multipliers)

### A. Unified "Juice Bus" / effect registry
One module mapping every gameplay event → a tiered recipe (particles + shake + flash +
post-FX boost + audio duck + board-juice impulse), scaled by an **intensity** derived
from `lineCount × comboTier × b2b × cascadeDepth`. Centralizes logic currently scattered
across `shared-effects.js`, `board-juice.js`, and per-mode callbacks. Tune one curve,
everything scales; free quality-tier downgrading.

### B. Bridge gameplay → background/post-FX world (the Tetris-Effect move)
Generalize `src/themes/electric-dreams-v3/sim/fluid-emitters.js:104`. Feed a `gameMetrics`
object (recent clears, combo, cascade depth, time-since-clear, danger level) into
`src/rendering/odyssey/composition/OdysseyDirector.js` so the entire scene responds:
bloom blooms on a Tetris, exposure pulses on combos, clears send a shockwave ring across
the background dome.

### C. Upgrade the block material (highest per-pixel ROI)
Replace flat `fillRect` with one of:
- **Pre-rendered block skins** — beveled/glossy/emissive RoundedRect textures cached per
  theme color (like `ensureCircleTexture` in `src/rendering/phaser/utils/graphics.js:17`), then blit.
- **Connected/merged piece rendering** — round only the *outer* corners so a tetromino
  reads as one glossy shape (modern Tetris standard).
- **Custom Phaser WebGL pipeline** for inner glow + rim light + gradient + emissive pulse
  on the *active* piece (the 3-layer split already isolates active piece from locked board).

### D. Hit-stop / time-scale controller
20–80ms freeze-frames on big impacts (Tetris, hard-drop lock, perfect clear). Cheapest,
most visceral juice trick. Gate behind reduced-motion.

---

## Per-event upgrade plan

| Event | Today | Proposed | Key files |
|---|---|---|---|
| **Spawn** | Pops in, no anim (`src/core/game.js:270`) | Scale-in (0.85→1.0, `Back.easeOut`, ~90ms) + faint emissive ignite | `game.js`, `shared-effects.js` |
| **Move** | Trail + spring nudge (good) | Soft contact-glow when sliding against stack | `src/rendering/draw.js`, `board-juice.js` |
| **Rotate** | Snaps, no anim/kick cue (`src/core/game.js:654`) | ~60ms spin-tween + **wall-kick spark** on pivot (SRS already reports kick) | `game.js`, `shared-effects.js` |
| **Soft drop** | No feedback | Speed-lines + motion-blur trail while held; ramps with speed | `game.js`, `src/ui/controls.js`, `shared-effects.js` |
| **Hard drop** | Beam + ripple + dip/bounce (good) | **Landing dust at contact cells** + directional shockwave + shake (scaled to distance) + 30–50ms hit-stop | `game.js`, `shared-effects.js` |
| **Lock** | Ripple, no pre-lock cue (`shared-effects.js:171`) | **Lock-delay telegraph**: rim brightens/pulses faster as the ~500ms delay drains | `game.js`, `shared-effects.js` |
| **Line clear** | Flash + particles, 1 line ≈ 4 lines | **Tier hard**: Single = clean slice; Double/Triple = brighter + dust; **Tetris = white flash + full-width beam + big shake + hit-stop + background shockwave** | `physics.js`, `shared-effects.js` |
| **Combo** | Popup + particles (good) | Escalating audio pitch + accumulating screen "heat" (rising bloom/vignette/chromatic per step) | `shared-effects.js`, `OdysseyDirector.js` |
| **Cascade** | **Invisible 2–9**, mega text 10+ (`shared-effects.js:638`) | Per-stage ripple + rising chime pitch crescendo (Puyo-style) | `physics.js`, `shared-effects.js` |
| **B2B** | Not visualized | Distinct color/sound signature + persistent "charged" border aura while alive | `physics.js`, `shared-effects.js` |
| **Perfect / All clear** | Score only, no event/visual (`physics.js:880`) | Emit real `PERFECT_CLEAR` event → full-screen radial supernova + slow-mo + board inhale→exhale + environment white-hot reset | `event-bus.js`, `physics.js`, `shared-effects.js` |
| **T-spin** | **Not detected** (SRS kicks exist) | 3-corner detection → signature swirl/vortex burst (Steam stat increments currently never fire) | `game.js`, `physics.js`, `shared-effects.js` |
| **Level-up / speed-up** | — | Brief world tint shift + tempo cue (gear-shift feel) | `OdysseyDirector.js`, mode files |
| **Danger / top-out risk** | — | Pulsing red vignette + rising low hum as stack nears top | `shared-effects.js`, `PostProcessingStack.js` |
| **Game over** | — | Stack desaturates and crumbles into particles; background mourns (exposure dip) | `shared-effects.js`, mode files |
| **Hold** | **Not implemented** | Implement + flip-swap tween between hold slot and board | `game.js`, `src/ui/next-queue-ui.js`, mode files |
| **Ghost** | Pulsing (good) | Keep; optional landing-row highlight | `src/rendering/canvas-utils.js` |

---

## Signature "wow" moments

- **The Tetris flash** — one unmistakable quad-clear punch (white-out → beam → shake →
  hit-stop → background shockwave). Make players *want* to wait for tetrises.
- **Perfect-clear supernova** — biggest untapped moment; reward exists in scoring but is
  visually silent. Should be the most beautiful thing in the game.
- **Combo "heat" takeover** — screen progressively saturates with bloom/chromatic/particles,
  peaking (but still readable) at 10+.
- **Beat-synced board** — locked blocks subtly pulse/shimmer on the beat via
  `OdysseyAudioReactor` → block emissive. The "board is alive" feeling, nearly free.
- **"Zone"-style mechanic** (ambitious) — meter that slows time and lets clears stack for a
  massive release; enabled by foundation D.

---

## Guardrails

- **Readability first** — never obscure the active piece, landing zone, or top 4 rows.
  Effects fire behind/around play, not over it.
- **Accessibility** — honor reduced-motion (cap shake/hit-stop); add a photosensitivity-safe
  mode (flashes/bloom can trigger seizures). Table stakes for "best in class."
- **Quality tiers** — every new effect registers a low/off path via
  `src/rendering/phaser/utils/quality.js` so low-end stays 60fps.

---

## Suggested order of attack

1. **Block material upgrade** (Foundation C) — biggest visual jump per hour; every frame.
2. **Tiered line-clear + hit-stop** (Foundations A + D) — grades existing clears; quick win.
3. **Fix silent events** — cascade 2–9 feedback + perfect-clear celebration + emit missing
   events. High impact, low effort, fills embarrassing gaps.
4. **Gameplay → background bridge** (Foundation B) — the "wow" multiplier; unlocks
   Tetris-Effect-class moments across all themes.
5. **Beat-synced board + combo heat** — leverages the audio reactor for ambient magic.
6. **T-spin + hold + wall-kick sparks** — completeness and competitive feel.

---

## Recommended first PR

**Tiered line-clear system + hit-stop controller + cascade/perfect-clear gap fixes.**
Self-contained in `src/rendering/phaser/shared-effects.js`, `src/core/physics.js`, and
`src/events/event-bus.js`. No new dependencies. Most immediately *felt* improvement.

_Alternative first PR:_ block-material upgrade (Foundation C) for the biggest visual punch.

---

## Key file index

- `src/rendering/phaser/base-board-scene.js` — render loop, layers, `drawBlock` (`:942`)
- `src/rendering/phaser/board-scene.js` — Phaser-4 effects (clears, ripples, combos, shake)
- `src/rendering/phaser/shared-effects.js` — central effects (flash, particles, popups, ripple, beam)
- `src/rendering/phaser/board-juice.js` — spring motion (`nudge/dip/bounce/tilt/pulse`)
- `src/rendering/phaser/utils/quality.js` — per-effect quality budgets
- `src/rendering/phaser/utils/graphics.js` — `ensureCircleTexture` (`:17`), procedural textures
- `src/core/game.js` — piece spawn/move/rotate/drop/lock + SRS kick tables
- `src/core/physics.js` — line detection, cascade loop, perfect-clear detection (`:880`)
- `src/core/scoring.js` — perfect-clear bonus formula
- `src/events/event-bus.js` — add `PERFECT_CLEAR`, `CASCADE`, `B2B`, `TSPIN` events here
- `src/rendering/odyssey/composition/OdysseyDirector.js` — ingest `gameMetrics` here
- `src/rendering/odyssey/composition/OdysseyAudioReactor.js` — beat/energy signals
- `src/rendering/odyssey/effects/PostProcessingStack.js` — bloom/chromatic/vignette/grain
- `src/themes/electric-dreams-v3/sim/fluid-emitters.js` — event→impulse pattern to generalize
- `src/utils/object-pool.js` — pooling for particles/effects
