# Winter "Living Blizzard" — Combo & Lock-Piece Effects Design

Creative-director + graphics-tech plan to escalate the winter WebGPU/TSL scene into a breathtaking blizzard during combos, then recede. Everything funnels through **ONE eased master scalar** plus a few decaying transient channels — the world breathes as a single storm, never a flicker of disconnected effects.

> **Good news:** `src/themes/winter/composition/storm-director.js` is ALREADY the exact eased-intensity + transient-channel model the research recommends (`intensity` fast-attack/slow-decay, `gust`/`whiteout`/`flare`/`kick` decaying transients, event pokes, accent palette). We do NOT rebuild it. We add: (1) a `trauma` channel + `onTSpin()`/`onPerfectClear()` pokes, (2) a `setReactive(state)` hook on the effect, and (3) a wind-streak + fog-overlay path. The effect itself currently has NO `setReactive` and NO shake injection — those are the build.

---

## 1. CREATIVE CONCEPT — the blizzard arc

A single scalar **`S = intensity ∈ [0,1]`** (eased, never set directly) drives a 4-act arc that maps 1:1 to the StormDirector's existing `act` getter. Combo state sets `target`; `S` eases toward it (attack 6.0 ≈ answers in ~0.4s, decay 0.55 ≈ settles over ~8–12s). Reward moments DON'T jump `S` — they punch transient channels on top, so the world visibly answers the play without a hard cut.

| Act | `S` range | What the player FEELS / SEES |
|-----|-----------|------------------------------|
| **STILL NIGHT** | `0 – 0.34` (idle floor 0.12) | Serene. Snow drifts near-vertically, lazy. Aurora a faint teal shimmer. Moon crisp, halo soft. Camera breathes. This calm is *load-bearing* — it's the contrast that makes the storm land. |
| **RISING WIND** | `0.34 – 0.70` | The air leans. Snow tilts sideways (breeze ramps ×3), near-flakes start to *streak*. Curl swirls deepen — flakes tumble in eddies, not on rails. Aurora brightens and shifts accent (ice-blue → mint → violet by tier). Mist bands thicken at the horizon. A held breath of weather. |
| **WHITEOUT** | `0.70 – 1.0` | Driving blizzard. Snow blasts near-horizontal in sheets. Fog pulls inward — distant peaks dissolve into pale haze, colour drains toward white. Aurora is a vivid rippling curtain. The whole frame reads VELOCITY. Reserved for sustained high combos / big clears. |
| **RESOLUTION** | decaying `S`, 5–14s silent | The storm *settles*, doesn't snap. Wind relaxes, fog recedes, snow re-verticalizes, aurora drifts back to calm teal. A graceful exhale that rewards the player's run with a visible cool-down. |

**Hierarchy principle (juice research):** routine play stays serene; a Tetris *noticeably* stirs the storm; a Perfect Clear is an unmistakable, rare crescendo. Over-juicing measurably reduces satisfaction — big effects are RESERVED so they keep impact.

---

## 2. EVENT → EFFECT MAP

All magnitudes are MULTIPLIERS / ADDENDS on the per-tier SNOW_TIERS baselines (far/mid/near breeze.x = 12/16/22; curlStr = 16/26/42; fallSpeed = 38/66/92). The effect's `setReactive(state)` derives per-tier values from `S` + transients each frame; events only poke the StormDirector.

### Master derivations from `S` (continuous, every frame, all tiers)
- **Sideways breeze:** `breeze.x = baseBreezeX × (0.6 + 2.4·S) × gustDir`, with a small `breeze.z` lean. Calm ≈ baseline; full ≈ ×3 lateral push → near-horizontal sheets.
- **Swirl:** `curlStr = baseCurl × (1 + 1.4·S)` ; `curlFreq = baseFreq × (1 + 0.5·S)` (keep freq change SMALL so eddies stay coherent).
- **Fall speed:** `fall = baseFall × (1 + 0.15·S)` (mostly constant — it's the *horizontal* that sells "driving").
- **Gust breath:** `gustAmp = baseGust × (0.7 + 1.0·S)` ; `gustFreq = base × (1 + 0.4·S)`.
- **Fog / whiteout:** `fogStr = baseFog + smoothstep(0.4,1.0,S)·0.35` ; mist tint eases toward near-white at high S.
- **Wind-streak stretch:** near tier only, `uStretch = lerp(0, 3, S)` (new uniform).
- **Aurora:** `uIntensity = 0.62 + 0.55·smoothS + flare` ; `uAccent ← director.accent`.

### Transient channels (decay on their own timers, ADD on top of eased S)
- `gust` (decay 0.8/s) → multiplies breeze + curl for a sideways blast.
- `whiteout` (decay 1.4/s) → fog density spike + (capped) flash overlay.
- `flare` (decay 0.9/s) → aurora bloom wave.
- `kick` (decay 3.2/s, ~0.3s) → camera dolly-push punch (forward Z nudge).
- `trauma` (NEW, decay ~0.8/s) → rotational-biased screen shake, `shake = pow(trauma, 2.5)`.

| Event | Visual | Drives (param + magnitude) | Duration / easing |
|-------|--------|----------------------------|-------------------|
| **PIECE_LOCK** | Barely-there stir; faint frost ripple. | `bump(0.015)`. No transient. | Eased into S; negligible. |
| **HARD_DROP** | Impact gust + tiny camera kick; snow shoves sideways once. | `bump(0.045,{gustDir:±1, gust:0.4, kick:0.4, trauma:0.18})` | gust ~0.5s, kick ~0.3s |
| **COMBO ×2** | First lean; snow tilts; faint swirl. | `onCombo(2)`→`bump(0.12,{flare:0.16})` | S up-ramp ~0.6s |
| **COMBO ×4** | Sideways wind + swirl + accent → violet; near-flakes streak. | `bump(0.24,{flare:0.32, kick:0.25, accent:violet})` | flare ~0.4s |
| **COMBO ×6** | Strong drive + a swirling vortex at screen centre. | `bump(0.36,{flare:0.48, kick:0.35, vortex:1})` | vortex ~0.8s |
| **COMBO ×8** | Near-whiteout; fog thickens, streaks max, aurora vivid. | `bump(0.48,{whiteout:0.4, flare:0.6, trauma:0.3, accent:magenta})` | whiteout ~0.5s |
| **COMBO ×10+** | Full blizzard wall; horizontal sheets, pale haze, magenta surge. | `bump(min(0.5,combo·0.06),{whiteout:0.6, flare:0.85, trauma:0.4})` | S held at top |
| **LINE_CLEAR 1–3** | Gust + small accent flash by tier. | `bump(0.12+lines·0.06+combo·0.04,{gust, flare, kick, accent:tier})` | gust ~0.5s |
| **TETRIS (4)** | Bigger gust + soft white flash + aurora flare. | adds `whiteout:0.7, kick:0.9, trauma:0.45` | flash fast-up ~80ms / slow ~400ms |
| **T-SPIN** | A swirling **vortex burst** — air spins around the clear. | NEW `onTSpin(lines)`: `bump(...,{flare:0.5, vortex:1.2, accent:violet, trauma:0.25})`, `curlStr ×1.6` ~0.8s | vortex ~0.8s |
| **PERFECT_CLEAR** | **Whiteout bloom + aurora flare** — the reserved crescendo. | NEW `onPerfectClear()`: `bump(0.4,{whiteout:1.0, flare:1.0, kick:0.6, trauma:0.55})` | whiteout fast-up / slow ~600ms |
| **LEVEL_UP** | Sustained step-up; raises the idle floor so later levels live in a windier night. | `onLevelUp()` + raise `idleFloor` +0.015 (cap ~0.3) + `gust:0.5, flare:0.4` | permanent floor shift |
| **COMBO DROP / IDLE** | Graceful settle; wind relaxes, fog recedes, snow re-verticalizes. | No poke; `target` → `idleFloor`, S decays. | 5–14s exhale |

---

## 3. TECHNICAL ARCHITECTURE

### 3.1 Reuse the StormDirector; add three small things
**File:** `src/themes/winter/composition/storm-director.js`
1. **Add `trauma` channel:** `this.trauma=0`; decay `trauma -= dt*0.8` in `update()`; accept `opts.trauma` in `bump()`; expose in `getState()`. Shake consumed CPU-side as `pow(trauma,2.5)`.
2. **Add pokes:** `onTSpin(lines)`, `onPerfectClear()`; extend `onHardDrop`/`onLineClear` with `trauma`.
3. **Add `vortex` transient** (decay ~1.2/s) so combo×6 / T-spin inject a centered curl burst separate from ambient curl.

### 3.2 `setReactive(state)` hook on the effect
**File:** `src/playground/effects/winter-wonderland.effect.js` — add to the return object. Capture per-tier baselines at tier creation so we MULTIPLY, not clobber. In `update(time)`, after `dt`, map `S` + transients onto each tier's `uBreeze`/`uCurlStr`/`uCurlFreq`/`uFall`/`uGustAmp`/`uGustFreq` and `rend.uFogStr`, plus `aurora.uIntensity`/`uFlare`/`uWhiteout`/`uAccent` and `uSwayAmp` (spruces bend harder in wind). Pure `uniform.value=` writes — zero recompile.

### 3.3 Wind-streak layer (NEW `uStretch`, near tier)
**File:** `src/themes/winter/rendering/snow-renderer.js` — add `uStretch` (default 0); in `vertexNode`, stretch the billboard along the view-space velocity axis (`velocities.element` already read for colour). Round dots → motion streaks as S climbs. No new particles.

### 3.4 Whiteout / fog overlay + flash
- Fog already per-tier (`uFogStr`). For the **flash** (Tetris/Perfect-Clear), drive the aurora's existing `uWhiteout` pale-wash uniform. **`useMRT:false` in WinterPipeline = NO emissive bloom** → do NOT use emissive overdrive for the flash; use the whiteout wash + post grade.
- **WinterPipeline overshoot:** in-game = exposure 0.82 + ACES + cold tint (cuts R, boosts B). Tune accent/flash **bright/warm** in the flat playground; they read dimmer/cooler in-game.

### 3.5 Camera shake (decaying trauma, rotational-biased, tiny)
**File:** `winter-wonderland.effect.js` `camera(time,camera)`. Read `_react.trauma`, apply a SMOOTH-noise rotational wobble (`sin(time*f)` layered — NOT per-frame random) AFTER `lookAt`: tiny roll (≤0.06 rad) + pitch, plus a `kick` forward-Z dolly punch. Bias ROTATION over translation (translation can clip the camera through the framing spruces). `shakeGain` is the accessibility knob.

### 3.6 Theme wrapper: eventBus → director → setReactive
**File:** `src/themes/winter/winter-theme.js`. StormDirector already instantiated + fed events in `setupEventListeners()` + updated each frame. Bridge work: (1) wire `EVENTS.TSPIN → onTSpin`, `EVENTS.PERFECT_CLEAR → onPerfectClear`; (2) after `stormDirector.update(delta)`, call `this.effect?.setReactive?.(stormDirector.getState())` (mirrors summer's `runtime.setReactive(director.getState())`); (3) keep the legacy `stormEnergy`/`windForce` path as-is (additive; Director is the source of truth for the new uniforms).

### 3.7 Vortex injection
Reuse `StormField.addVortex(...)` on combo×6 / T-spin via the `vortex` transient → `setReactive` adds to `uCurlStr` (and calls `addVortex` if the in-game StormField path is active). In the playground (per-tier SnowSim) the `curlStr` pop alone delivers the swirl.

---

## 4. ACCESSIBILITY (attenuate, never delete — mirrors summer-theme.js gating)
- **`backgroundComboEffects === false`** → `mult=0`: zero all bumps (`director.setIntensity(0)`); S relaxes to idle floor; snow still falls gently. Theme stays alive — only the reactive escalation is off.
- **`prefers-reduced-motion: reduce`** → `mult=min(mult,0.45)` AND: `shakeGain=0` (camera shake fully zeroed — #1 sickness trigger), white flash disabled (gentle fog bloom capped ~0.3), **cap S ~0.6** so fog vection/desaturation never hit full whiteout, bound aurora pulse + streak speed. Snow + colour/breeze escalation RETAINED.
- **Flash safety always:** white wash ≤3/sec, asymmetric ease (up ≤80ms / down ≥400ms), peak luminance capped, never a hard cut.
- **Shake always:** `pow(trauma,2.5)` gates trivial actions out; max roll ≤0.06 rad, ~0 translation; tied ONLY to discrete rewards (never ambient S).

---

## 5. ROADMAP — playground-first, one effect per session, screenshot-verified

**Quick wins (highest impact / lowest risk):**
1. **`setReactive` + S-driven breeze & curl** (core sideways-snow + swirl). Add the hook, baselines, per-tier mapping. Drive S via a `?winterStorm=1` debug slider; screenshot S=0 / 0.5 / 1.0. **Delivers ~70% of the felt blizzard.**
2. **Aurora surge + accent** — `uIntensity`/`uFlare`/`uAccent` from state. Cheap, dramatic, no motion risk.
3. **Fog whiteout ramp** — `uFogStr` from `smoothstep(0.4,1,S)` + whiteout transient.

**Mid (one session each):**
4. **Wind-streak layer** — `uStretch` in snow-renderer vertexNode (near tier).
5. **Trauma screen shake + kick** in `camera()` — rotational wobble, no spruce clipping.
6. **Vortex burst** for T-spin / combo×6.

**Full system (port + wire):**
7. Add `trauma`/`vortex` + `onTSpin`/`onPerfectClear` to StormDirector (dependency-free → unit-testable).
8. Wire new events in `winter-theme.js`; call `effect.setReactive(getState())` each frame; add `setIntensity` gating.
9. **Capture-gate in-game** (TDR-safe short session): verify the WinterPipeline-graded result, shake comfort, reduced-motion path.

### Constraints recap
- **`useMRT:false`** → flash via whiteout-wash uniform + post grade, not emissive.
- **WinterPipeline overshoot** → tune magenta/flash/aurora bright & warm in the flat playground.
- **StormDirector is the source of truth** for the new uniforms; the legacy path stays for its own consumers.
- **One small effect per capture session** — never a full-journey WebGPU screenshot.
