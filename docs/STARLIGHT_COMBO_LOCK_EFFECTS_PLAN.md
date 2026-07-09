# Starlight — Combo + Lock-Piece Effects Plan (DEFINITIVE)

> Lead technical art direction for magical space-phenomena LOCK + COMBO effects in the
> Starlight WebGPU/TSL theme. Built ruthlessly on the existing subsystems; one new
> renderer, justified. Verified against live source (function names, signatures,
> uniforms, event payloads) on 2026-06-15.

---

## 0. TL;DR (the decision)

**Chosen direction: a HYBRID with Concept A (Stellar Ignition / Star Birth) as the
spine, C (Cosmic Resonance) grafted as the universal cheap backbone, and B
(Gravitational) mined for restraint + a single optional Tier-2 warp.**

The three judge lenses split: **Magic/Theme-fit → A (8.5)**, **Feasibility → C (9)**,
**Performance/Readability → B (8)**. No single concept wins all three, and the
recommendations converge on the *same* hybrid. This plan codifies it:

- **A's grammar is the skeleton** — each tier ADDS a new sensory channel
  (flicker → accrete → bloom → ignite → birth-and-remember), and its peak literally
  delivers the brief's headline ("a star you could wish upon" = the supernova that
  leaves the `wish` pentagram). A's palette is *literally the sim's baked seed colors*
  (`WARM = [1.0, 0.91, 0.76]`), so warm-gold = earned holds for free.
- **C's twinkle-wave is the cheap hero of EVERY beat** — ~3 uniforms + ~6 lines in the
  existing `deep-starfield.js` `colorNode`, both backends, zero bloom-contract risk.
  Every event rides it so the WebGL2 fallback never degrades to "nothing". C's aurora
  surge joins the choir at high combo; C's inverted twinkle-wave is the T-spin signature.
- **B's discipline tames A's spectacle** — replace A's flash-heavy "detonate/bang"
  climaxes with a brightness + tiny-warp "inhale → bloom → settle"; keep flashes off
  lock and combos entirely. B's "bend, don't add" warp is built as an **optional Tier-2
  only**, board-masked and screenshot-gated (it is genuinely new WebGPU-only post code).

**One new renderer:** `rendering/shockwave-renderer.js` — an instanced additive
quad pool cloned from `meteor-renderer.js`, serving the thin nova ring AND the thick
light-echo shell as presets. ~150 lines, both backends, bloom-correct, pool-capped.

**One worthwhile correctness fix all three name:** map the lock cell / cleared-row
centroid into the backdrop's world space and use it as the impulse + wave + ring origin
(replacing the random-jitter `_pos.set` in `starlight-emitters.js`).

---

## 1. Vision

**The feeling.** The Starlight canopy is a *nursery of cool dust* — a still, breathing
twilight you could wish upon. The player's hands coax light out of it. Nothing
detonates; light *ignites*, *accretes*, and *is remembered*. The cosmos notices you,
swells, then exhales back to calm. Flow is an oscillation, never a monotonic ramp
(Tetris Effect's MacDonald): every crescendo must *recede* so the next has somewhere
to climb.

**How LOCK and COMBO differ — the structural contract.**

| | LOCK (every piece, ~0.3–1s apart) | COMBO (earned, escalating) |
|---|---|---|
| Role | The **floor**. The quiet that makes the crescendo land. | The **ceiling**. A building, rewarding swell. |
| Amplitude | **FLAT every time.** Vary *texture* (which mote ignites, per-star phase), never intensity. | **Escalates** with `comboCount`; each tier ADDS a sensory channel. |
| Channels | starfield twinkle-wave + one ATTRACTOR tug + ≤3 spark motes. **No flash, no camera, no meteor.** | + ring → + meteors/aurora → + camera lean → + constellation. |
| Origin | The actual lock **cell** (world-mapped). | The cleared-row **centroid** (world-mapped). |
| Cost | Near-zero. Must never fatigue (WCAG: a sub-second full-screen flash breaches 3-flashes/sec). | Bounded; crests then decays to rest. |

**The space-phenomena language (the escalation axis).** Phenomena split cleanly into
*flicker* (twinkle, airglow — cheapest, reuses existing stars), *added-light* (ignition,
ring, light-echo, aurora, cluster — the mid payoff family), and *dominant emitters*
(nova, supernova — the peak reserve), with *bend* (warp/lens) as a refined optional
accent. The ladder climbs that axis: **flicker → accrete → bloom → ignite → birth +
remember.** The verb/shape changes per tier so tiers never blur into "just brighter."

**Color grammar (held throughout).** cool blue-white `#CFE0FF` = calm bed; warm-gold
`#FFD9A8`/`#FFCE7A` = special/earned (the sim's literal `WARM` seed); silver-cyan
`#9FE8FF` = structure/constellation; teal `#6FE3D2` + lavender `#9D8CE0` = aurora.
Warm-gold + the `wish` pentagram are reserved strictly for the earned peaks
(Tetris / Perfect / combo 10+).

---

## 2. Chosen Direction & Why (citing the verdicts)

**Backbone = A, because it won the lens that matters most for a *magical* theme.** The
Magic/Theme-fit judge scored A **8.5** (vs C 7.5, B 6.5): "the most iconic, legible,
wondrous space story… the only one that pays off 'a canopy you could wish upon'
literally… best crescendo by a clear margin: each tier ADDS a new sensory channel
rather than turning a dial." A's color claim is verified true in source —
`stardust-particles.js` bakes `WARM = [1.0, 0.91, 0.76]`, so "warm-gold = earned
creation against a calm cool field" is not a metaphor, it is the material.

**But A as-written tips into spectacle**, the one thing the brief de-prioritizes. The
same judge: "the vocabulary (detonate / nova / bang) and heavy peaks (flashPunch 0.5 +
fovPunch -3 + shake) lean toward SPECTACLE… the most fatigue-prone of the three. It
also overclaims 'reuse': flashPunch and warpPunch are NOT wired" — confirmed:
`render-pipeline.js updateDynamic` reads only `bloomBoost / chromaticBoost /
vignetteBoost / exposureDip`; `flashPunch` only multiplies bloom (`fx.flashPunch*0.35`
into `bloomBoost` in `starlight-theme.js`); there is **no warp node, field, or branch
anywhere.** So we graft restraint and honesty.

**Graft C as the cheap, backend-safe backbone**, because the Feasibility judge scored it
**9** ("the only concept that requires NO new renderer and NO warp; its hero — the
twinkle-wave — is verifiably a ~5-line edit to deep-starfield.js's existing colorNode")
and the Performance judge confirmed it is the lowest-risk core. C is also the best pure
atmosphere fit ("the sky is a singing bowl… almost a verbatim restatement of the
brief"). C's weakness — "the LEAST shape-distinct… risks reading as brighter, brighter,
brighter" — is exactly what A's grammar fixes. So: **C's twinkle-wave + aurora surge
provide the always-present, both-backends layer; A's distinct phenomena ride on top.**

**Mine B for the readability principle and one optional accent**, because the
Performance judge scored it **8** ("the only concept whose CORE MECHANIC is inherently
board-safe: distortion-first means it bends existing starfield light rather than adding
peripheral brightness") — but Feasibility scored it **4** ("its CORE identity is the
post-process UV-warp, and that warp does not exist in any form… the single most invasive
change"). Verdict: adopt B's *philosophy* (lead peaks with bend-and-settle, keep flashes
off frequent events) and keep its literal warp as a **deferred, optional, screenshot-
gated Tier-2** that is never load-bearing.

**Grafted ideas the judges explicitly flagged (all incorporated below):**
1. C's **inverted twinkle-wave for T-SPIN** (stars dim-then-rebrighten = a *twist*) — "the single most elegant theme-true micro-idea across all three."
2. C's **aurora surge** at high combo (drives the existing capped, `emitsBloom=false` `uStrength`).
3. C's **twinkle-wave** as the universal lock + low-combo hero.
4. A's **add-a-channel-per-tier** escalation grammar.
5. A's **supernova-leaves-a-constellation** remnant ("the sky remembers" — `trigger('wish')` places in the upper sky, NOT at the cell; framed correctly).
6. A's **bottom→top vertical sweep for Tetris** (shape-distinct from a point-origin combo).
7. B's **bend + settle ("inhale → bloom") for the PEAKS** instead of a white flash.
8. B's **center-pull lens** as the optional special-moment warp signature (Tier-2 only).
9. The shared **lock-cell → world-space origin** fix.
10. The shared discipline: **flat lock, no flash, no camera, cut the current 0.04 lock shake.**
11. C's **reduce-motion toggle** gating warp/flash/camera (the only concept to propose it).
12. The unaddressed gap all three leave: **explicitly budget the 8-slot impulse pool** so multi-impulse specials can't stomp live combo impulses.

---

## 3. The Lock-Piece Effect — "First Light"

> Every lock births a single point of light where the piece settled. Cheap, subtle,
> tactile, identical-amplitude every time (escalation is FORBIDDEN at lock).

### 3.1 What fires (exact calls, params, durations)

On `PIECE_LOCK` (`{ piece }`), with `origin = lockCellWorld(piece)` (see §7.4):

1. **Twinkle-wave (the hero, both backends, ~free).**
   `theme.starfield.triggerWave(origin, { speed: 9.0, boost: 0.4, sigma: 40.0 })`.
   A soft brightening shell ripples outward across existing stars from the lock cell.
   Full local falloff in ~**450 ms**. Implemented as new uniforms in `deep-starfield.js`
   (§6.1). This is the cheapest high-impact layer in the whole system.
2. **Settle ATTRACTOR (compute-gated; no-ops on WebGL2).**
   `theme.stardustSim.pushImpulse(origin, 1.6, AXIS, IMPULSE_TYPE.ATTRACTOR)`.
   Nearby motes lean inward and "accrete" toward the new star (the Journey/Sky
   "particles fly IN" beat, calmer than a burst). Auto-decays at the engine's ~170 ms
   half-life (`decayImpulses`, `k = exp(-delta*4)`). `jitter = 0` (origin is the cell).
3. **Spark flash on 1–3 nearest motes (both backends, ~free).** Carried by the same
   twinkle-wave shader path: a tight, warm-gold (`#FFD9A8`) in-shader gate on the
   `boost` ride near `origin`, decaying over ~**220 ms** — the literal "ignition spark."
   (Distance-gated in-shader on `aStarPos`; no per-instance CPU writes.)

**Explicitly NOT fired at lock:** no `flashPunch`, no `bloomPunch` above 0.04, no
camera shake (the current `shake(0.04, 140)` is **cut** — shake-per-lock is textbook
over-juice and the brief is calm-positioned), no meteor. Response is sub-100 ms and
**identical every time**; predictability lets the frequent cue fade into rhythm.

### 3.2 How it varies by lock type / height (texture, not intensity)

The *amplitude* is flat; only the *texture* varies, so the cue stays delightful and
never patterns into monotony:

- **By piece type (`piece.shapeKey`):** a tiny per-type hue nudge within the warm band —
  e.g. `I/O` lean cooler-gold `#FFE9B0`, `S/Z/T/L/J` lean warmer `#FFD9A8` — and a small
  per-type `sigma` jitter so the wave shell looks subtly different per piece. Cosmetic;
  ≤±8% on color, 0% on brightness.
- **By board height (lock row, normalized `0..1`):** the *direction* of the wave's
  faint anisotropy tilts — low locks ripple slightly upward (room to grow), high/near-top
  locks ripple slightly outward-flat. This is a 1-line bias on the wave origin's
  in-shader gradient; it reads subconsciously as "the sky reacting to where you are."
  Amplitude stays flat regardless of height — height never raises intensity.

### 3.3 Lock → world-position mapping (proposed, §7.4 has the code)

The piece carries grid coords `{ x, y, shape, rotation }` in board space (`COLS=10`,
`ROWS=20`, `HIDDEN_ROWS=4` → 24 rows total, 20 visible). The Starlight backdrop renders
in its own world (camera at `(0, 0.4, 14)`, FOV 40), and there is **no shared
grid→world transform** — the board is a separate DOM element over the canvas. So we
define a deliberate **normalized mapping into a brightness-safe "action plane"**:

```
cx = (cellCol + 0.5) / COLS              // 0..1 across board
cy = (cellRow + 0.5) / VISIBLE_ROWS      // 0..1 down board (row excludes hidden rows)
ndcX = (cx * 2 - 1)                        // -1..1
ndcY = (1 - cy) * 2 - 1                    // -1..1, y-up
worldX = ndcX * ORIGIN_SPAN_X            // ORIGIN_SPAN_X ≈ 5.5 (board half-width in world)
worldY = ndcY * ORIGIN_SPAN_Y            // ORIGIN_SPAN_Y ≈ 6.5
worldZ = ORIGIN_Z                          // ≈ -2.0 (just behind the board plane)
```

`cellCol`/`cellRow` = the centroid of the piece's filled cells (lock) or the centroid
of `clearedRows` (line clear). The spans are tuned ONCE in the playground so effects
originate *visually behind/around* the board without ever entering the brightness-capped
board pocket. Constants live in `starlight-emitters.js` (`ORIGIN_SPAN_X/Y`, `ORIGIN_Z`).

---

## 4. Combo Escalation Ladder — "Accretion → Nova"

`comboCount` is a mix fader; each tier UNMUTES a new channel and changes the *verb*, then
the field decays to calm. Origin = `clearedRowCentroidWorld(data)`; falls back to the
last lock origin if `clearedRows` is absent.

| Combo | Phenomenon | Subsystem calls (verb / shape) | Palette | Duration | Reads as escalating because… |
|---|---|---|---|---|---|
| **1–3** | **Sparks Catch** (Low, *accrete*) | `starfield.triggerWave(origin, {speed:9, boost:0.7})`; `pushImpulse(origin, 1.5 + c*0.3, AXIS, ATTRACTOR)`. No camera, no meteor, no ring. | gold `#FFD9A8` spark on cool `#CFE0FF` bed | wave ~500 ms; impulse ~170 ms | Brighter wave than lock + dust *pulls inward* — "the dust noticed." Same channel as lock, slightly louder. |
| **4–6** | **Cluster Bloom** (Mid, *bloom*) | inhale→bloom: `pushImpulse(origin, 3.0, AXIS, ATTRACTOR)` then **next frame** `pushImpulse(origin, 3.0, AXIS, RADIAL)`; `shockwave.spawn(origin, RING_PRESET, {color:#FFCE7A})` (1 thin ring); `meteors.spawnShower(2, 0.45)`; `camera.dolly(0.08)`; `_bump('bloomPunch', 0.14)`. | gold ring + warm meteors | inhale 1 frame → ring 550 ms; meteors ~1.5 s | NEW channels added: first **ring** + first **camera lean** + meteors. Verb shifts accrete→bloom (gather then release). |
| **7–9** | **Nova** (High, *ignite*) | one-frame spike `pushImpulse(origin, 8.0, AXIS, RADIAL)` (energy=speed auto-brightens the thrown shell; `decayImpulses` snaps it back = ignite→settle); `shockwave.spawn(origin, RING_PRESET, {color:#FFF6E8})` (1 bright ring); `meteors.spawnShower(3, 0.6)`; `camera.fovPunch(-2)`; `_bump('bloomPunch', 0.22)`. **No flash** (bend+bloom, per B). Tier-2: `warpPunch(origin, 0.018)` ripple if enabled. | warm-white→gold ring; brighter bloom | ring 600 ms; bloom decays ~5 frames | NEW channels: bright ring + fovPunch + (Tier-2) warp. Verb shifts bloom→ignite. Clearly the brightest non-special beat. |
| **10+** | **Supernova + Constellation** (Peak, *birth + remember*) | **inhale** `pushImpulse(origin, 4.0, AXIS, ATTRACTOR)` + dim ~180 ms; **bloom** `pushImpulse(origin, 10.0, AXIS, RADIAL)` + `shockwave.spawn(origin, ECHO_PRESET)` (thick soft light-echo shell) + `_bump('bloomPunch', 0.26)` + a SMALL warm `_bump('flashPunch', 0.30)` (capped, sub-3/sec, warm-not-white); **aurora surge** `aurora.surge(0.9, 1200)`; **remnant** `constellations.trigger('wish')` (the sky remembers); `meteors.spawnShower(4, 0.7)`; `camera.fovPunch(-2.5)` + `shake(0.10, 180)`. Then decay to calm. | warm-white→gold; aurora teal/lavender joins; silver-cyan constellation | inhale 180 ms → bloom → echo 700 ms → constellation 1.8 s draw → ~1 s resaturation tail | ADDS aurora + constellation + the full inhale→bloom arc — the cosmos "wakes up", then exhales. |

**Why it reads as escalating (not a dial):** the verb changes per tier
(accrete → bloom → ignite → birth), and each tier ADDS a sensory channel rather than
turning one up: *dust → +ring → +bright-ring/camera/(warp) → +aurora/constellation/flash*.
A player feels the system progressively recruit the whole sky.

**Pool discipline (the gap the judges flagged):** `MAX_IMPULSES = 8` and `pushImpulse`
overwrites slot 0 when full. The two-frame inhale→bloom specials are sequenced (not same
frame) and the emitter caps itself to **≤2 concurrent impulse pushes per event**, leaving
≥6 slots for interleaved locks. The shockwave pool is capped at **12 concurrent**.

---

## 5. Special Moments (each a distinct beat)

| Moment | Event | The beat (shape-distinct) | Calls |
|---|---|---|---|
| **Tetris (4-line)** | `LINE_CLEAR {lineCount>=4, clearedRows}` | **Vertical sweep**: four staggered ignitions bottom→top across the four cleared rows (**50 ms apart**) converging into one RADIAL bloom + ring. A different *silhouette* from the point-origin combo. | per-row: `triggerWave(rowOrigin, {boost:0.8})` staggered; then `pushImpulse(centroid, 8.0, RADIAL)`; `shockwave.spawn(centroid, RING_PRESET, #FFF6E8)`; `meteors.spawnFireball()`; `constellations.trigger('wish')`; `camera.fovPunch(-2.0)`; `_bump('flashPunch', 0.30)` (capped warm); `_bump('bloomPunch', 0.20)`. |
| **PERFECT_CLEAR** | `PERFECT_CLEAR {depth}` | The **held-breath Zone**: longest inhale (~**250 ms**) at board center, biggest light-echo shell, then a slow color-resaturation tail (GRIS). The rarest, biggest exhale. | inhale `pushImpulse(center, 5.0, ATTRACTOR)` + dim 250 ms; bloom `pushImpulse(center, 11.0, RADIAL)` + `shockwave.spawn(center, ECHO_PRESET)`; `aurora.surge(1.0, 1600)`; `meteors.spawnWishingStar()` + `spawnFireball()`; `constellations.trigger('wish')`; `_bump('flashPunch', 0.36)` (capped); `_bump('bloomPunch', 0.28)`; `camera.pullBack(0.35)` (the cosmos steps back in awe — distinct from Tetris's fovPunch). |
| **T-SPIN** | `TSPIN {lineCount}` | **The twist (bend, not strike)**: C's inverted twinkle-wave — stars DIM-then-rebrighten — + one VORTEX impulse (the spin literally swirls the dust) + one lavender ring. No ring train, no flash. | `starfield.triggerWave(origin, {boost:0.6, invert:true})`; `pushImpulse(origin, 4.0, AXIS, VORTEX)`; `shockwave.spawn(origin, RING_PRESET, {color:#9D8CE0})`; `_bump('chromaPunch', 0.10)`. Tier-2: `warpPunch(origin, -0.020)` center-pull twist. |
| **B2B** | `B2B {active:true}` | **The echo / sustain**: re-fire the *prior* special's signature at half amplitude a beat later (a paired second ring), + lengthen the next wave's decay. "The previous wave hasn't finished ringing." A modifier, not its own event. | sets `this._b2bActive = true` for ~1.5 s; the next special schedules a second `shockwave.spawn(lastOrigin, RING_PRESET, {scale:0.6})` ~180 ms after its primary, and passes `decayMul: 1.4` into `triggerWave`. |
| **CASCADE** | `LINE_CLEAR {cascadeCount>1}` (and standalone `CASCADE`) | **Marching chain**: N sequential lock-style `triggerWave` + spark flashes, one per cascade step, marching up the board (Destiny "hero shatters into seekers"). Pure starfield+spark, near-free. | for `k in 0..cascadeCount`: `setTimeout(k*70ms)` → `triggerWave(rowOrigin(k), {boost:0.5})` + `pushImpulse(rowOrigin(k), 1.4, ATTRACTOR)`. No camera, no flash. |
| **LEVEL_UP** | `LEVEL_UP` | **The earned milestone**: a wishing star + a single soft light-echo shell + an aurora breath (the "world brightens" GRIS beat) — calm, not a combo climax. | `meteors.spawnWishingStar()`; `shockwave.spawn(center, ECHO_PRESET, {alpha:0.5})`; `aurora.surge(0.7, 1400)`; `pushImpulse(center, 2.0, RADIAL)`; `_bump('bloomPunch', 0.12)`. No flash, no shake. |

All `clearedRows`-derived origins use §7.4 mapping; if data is missing they fall back to
board center. `wish` is reserved strictly for Tetris / Perfect / combo 10+.

---

## 6. New Components (only what's justified)

### 6.1 `deep-starfield.js` — twinkle-wave (NOT a new renderer; uniform + node edit)

- **File:** `src/themes/starlight/rendering/deep-starfield.js` (edit existing).
- **Technique:** add uniforms `uWaveOrigin (vec3)`, `uWaveTime (float)`, `uWaveSpeed`,
  `uWaveBoost`, `uWaveSigma`, `uWaveInvert (float 0/1)`, `uWaveDecayMul`. In the existing
  fragment `colorNode`, after `lum` is computed:
  ```
  delay = length(aStarPos.sub(uWaveOrigin)).div(uWaveSpeed);
  phase = uTime.sub(uWaveTime).sub(delay);
  pulse = exp(phase.mul(phase).mul(uWaveSigma.negate())).mul(step(0.0, phase));
  signed = mix(pulse, pulse.negate(), uWaveInvert);   // inverted = T-spin twist
  lum = lum.mul(float(1.0).add(signed.mul(uWaveBoost)).clamp(0.4, 1.6)); // cap stacking
  ```
- **Bloom contract:** unchanged — it modulates the already-`emitsBloom=true` emissive;
  cannot break the contract. Cumulative pulse clamped to `[0.4, 1.6]` (the over-bright
  stacking failure mode C named).
- **Cost:** one `distance` + one gaussian per star, in a node already running per star.
  Zero new geometry, zero new draw call, no CPU per-instance writes.
- **WebGPU + WebGL2:** safe on both (it is the existing `MeshBasicNodeMaterial`).
- **Forks:** nothing — extends the existing material. Add `triggerWave(origin, opts)` to
  the returned API (sets `uWaveOrigin`, `uWaveTime = uTime.value`, and the opt uniforms).

### 6.2 `shockwave-renderer.js` — expanding ring / light-echo pool (the ONE new renderer)

- **File:** `src/themes/starlight/rendering/shockwave-renderer.js` (NEW, ~150 lines).
- **Why new:** a literal expanding ring/shell is the one space-phenomenon a twinkle-wave
  cannot draw, and impulses/meteors cannot either. Justified by all three judges.
- **Technique:** `InstancedBufferGeometry` of camera-facing unit quads (clone of
  `meteor-renderer.js`), per-instance attrs `aOrigin (vec3)`, `aBirth (float)`,
  `aColor (vec3)`, `aSpan (float)`, `aWidth (float)`, `aAlpha (float)`. SDF ring in the
  `colorNode`:
  ```
  uvc = positionLocal.xy; d = length(uvc).mul(2.0);
  age = (uTime - aBirth) / LIFETIME;            // 0..1
  radius = age * aSpan;
  ring = smoothstep(aWidth, 0.0, abs(d - radius));
  fade = (1.0 - age) * smoothstep(0.0, 0.12, age);  // fade-in (anti-pop) * fade-out
  bright = (ring * fade * aAlpha).clamp(0.0, 2.2);    // HDR cap, mirrors meteor renderer
  return vec4(aColor * bright, bright.clamp(0.0,1.0));
  ```
- **Presets:** `RING_PRESET` = thin (`aWidth≈0.05`), `aSpan≈1.0`, sharp, bright;
  `ECHO_PRESET` = thick/soft (`aWidth≈0.45`), large `aSpan`, low `aAlpha≈0.5`,
  multi-instance staggered birth (2–3 shells) for the light-echo.
- **Bloom contract:** `material.emissiveNode = colorNode.rgb`, `userData.emitsBloom = true`,
  `clamp(0.0, 2.2)` so additive+bloom can never white-out (exactly the meteor renderer's
  discipline). `AdditiveBlending`, `depthWrite:false`, `DoubleSide`.
- **Cost:** one additive quad per event, `length`+`smoothstep`/pixel, overdraw only
  inside the quad. **Pool-capped at 12 concurrent**, low alpha on the echo preset (the
  only overdraw risk).
- **WebGPU + WebGL2:** safe on both (same `MeshBasicNodeMaterial` + `attribute()` pattern
  proven by starfield + meteors). Bloom *amplification* is WebGPU-only; the ring is still
  visible additively on WebGL2.
- **Forks:** `meteor-renderer.js` (the SDF ring is *simpler* — no velocity stretch). CPU
  side mirrors `MeteorSystem`'s flat-array pool: spawn writes a slot, `update()` flags
  `needsUpdate`, dead slots collapse to `aSpan=0`.

### 6.3 `aurora-band.js` — surge method (no new renderer; one driven uniform)

- **File:** `src/themes/starlight/rendering/aurora-band.js` (edit existing).
- **Technique:** add a `surge(targetStrength, durationMs)` that ramps the existing
  `uStrength` up then eases back (a small CPU tween updated from the theme's animate
  loop, or a `uSurge` uniform decayed per-frame like `fxState`). The existing luminance
  cap `min(outc, vec3(0.17))` and `emitsBloom = false` mean it CANNOT wash the board.
- **Cost:** one uniform tween; zero new geometry. WebGPU + WebGL2 safe (aurora already
  renders on both). Gated to High/Ultra/Extreme (where aurora exists). Correction to
  C's claim: aurora exposes only `uTime`/`uStrength` (no "ripple uniform") — the surge
  drives `uStrength` only.

### 6.4 (Tier-2, OPTIONAL) `render-pipeline.js` — UV-warp post node

- **File:** `src/themes/starlight/post/render-pipeline.js` + `starlight-theme.js` fxState.
- **Technique:** new uniforms `uWarpOrigin (vec2 screen)`, `uWarpRadius`, `uWarpAmp`;
  in `_setupWebGPU`, before the chroma samples (lines ~196–199), offset the sample UV
  by an SDF-ring-masked, normalized-from-origin displacement (positive = radial shock,
  negative = center-pull lens). **Reuse the existing chroma screen-samples** — ride the
  warp on those rather than adding taps (the precise, near-free path B identified).
  Add a `warpPunch` field to `fxState` + decay line + an `updateDynamic` branch.
- **Board-mask (mandatory):** multiply `uWarpAmp` by `(1 - boardMask)` using the existing
  `uBoardHaloHalfSize`/`uBoardHaloCenter` rounded-rect SDF so the board pocket never
  distorts. (The gap the Feasibility judge flagged.)
- **Cost:** near-free (rides existing samples). **WebGPU-only** — no-ops on WebGL2, so it
  is NEVER load-bearing; every beat that uses it ALSO carries a ring + wave + impulse.
- **Honesty:** this is genuinely new post-graph code, the most invasive change in the
  plan. Ship Tiers 1–4 without it; add it only after a playground screenshot per CLAUDE.md.

**No god-ray post pass** (iGPU TDR risk). **No portal-disc renderer** (use the ECHO_PRESET
ring as the wormhole stand-in if a literal portal is ever wanted; screenshot-gate first).

---

## 7. Integration Points

### 7.1 Rewrite the handler map in `starlight-emitters.js`

Replace `_impulse` (which jitters a random `_pos`) with origin-aware helpers and rewrite
every handler to the §3–§5 spec. New subscriptions for the currently-unused events:

```js
attach() {
  this._unsubs.push(
    eventBus.on(EVENTS.PIECE_LOCK,    (d) => this._onPieceLock(d)),
    eventBus.on(EVENTS.HARD_DROP,     ()  => this._onHardDrop()),
    eventBus.on(EVENTS.LINE_CLEAR,    (d) => this._onLineClear(d)),
    eventBus.on(EVENTS.COMBO,         (d) => this._onCombo(d)),
    eventBus.on(EVENTS.LEVEL_UP,      ()  => this._onLevelUp()),
    eventBus.on(EVENTS.PERFECT_CLEAR, ()  => this._onPerfectClear()),
    eventBus.on(EVENTS.TSPIN,         (d) => this._onTSpin(d)),   // NEW
    eventBus.on(EVENTS.B2B,           (d) => this._onB2B(d)),     // NEW
    eventBus.on(EVENTS.CASCADE,       (d) => this._onCascade(d)), // NEW
  );
  return () => this.detach();
}
```

New helpers: `_impulseAt(origin, strength, type)`; `_wave(origin, opts)` →
`theme.starfield?.triggerWave(...)`; `_ring(origin, preset, opts)` →
`theme.shockwaves?.spawn(...)`; `_auroraSurge(s, ms)` → `theme.aurora?.surge(...)`.
Track `this._lastOrigin` (updated each lock) and `this._b2bActive` (with a timer).

### 7.2 Orchestrator wiring in `starlight-theme.js`

- Construct + register the shockwave pool next to meteors:
  `this.shockwaves = new ShockwaveSystem(12); this.shockwaveRenderer =
  createShockwaveRenderer(this.shockwaves); this.scene.add(this.shockwaveRenderer.mesh);`
  and in the animate loop `this.shockwaves.update(delta, this.time);
  this.shockwaveRenderer.update();` Tear down in `stop()`.
- Pass the camera's projection so the shockwave quads size correctly (same
  `setProjection` pattern as starfield, if camera-facing world sizing is used).
- (Tier-2) add `warpPunch` to `fxState`, a decay line (`fx.warpPunch *= 0.8`), and feed
  `dp.warpBoost = fx.warpPunch` into `updateDynamic`.

### 7.3 New event subscriptions (TSPIN / B2B / CASCADE)

Verified to exist in `event-bus.js` and to be emitted by the game modes with payloads:
`TSPIN {lineCount}`, `B2B {active:true}`, `LINE_CLEAR {lineCount, clearedRows,
cascadeCount}` (cascade rides line-clear; `CASCADE` also fires standalone in some modes).
Subscribe to all three (§7.1). They are currently unused by Starlight — this is net-new
reactivity, no migration needed.

### 7.4 Lock → world-position mapping (the approach + code)

The piece carries grid coords; the cleared rows carry grid row indices. Add a pure helper
to `starlight-emitters.js`:

```js
import { COLS, ROWS, HIDDEN_ROWS } from '../../../core/constants.js';
const VISIBLE_ROWS = ROWS;                 // 20
const ORIGIN_SPAN_X = 5.5, ORIGIN_SPAN_Y = 6.5, ORIGIN_Z = -2.0; // tuned in playground

_cellToWorld(col, row, out) {
  const cx = (col + 0.5) / COLS;
  const cy = (row + 0.5) / VISIBLE_ROWS;
  out.set((cx * 2 - 1) * ORIGIN_SPAN_X, ((1 - cy) * 2 - 1) * ORIGIN_SPAN_Y, ORIGIN_Z);
  return out;
}

_lockOrigin(piece, out) {            // centroid of the piece's filled cells
  // sum filled (r,c) of piece.shape at piece.rotation, offset by piece.x/y;
  // subtract HIDDEN_ROWS from row so hidden spawn rows map off-screen-top.
  return this._cellToWorld(meanCol, meanRow - HIDDEN_ROWS, out);
}

_rowsOrigin(clearedRows, out) {      // centroid of cleared rows (col = board middle)
  const meanRow = avg(clearedRows) - HIDDEN_ROWS;
  return this._cellToWorld(COLS / 2 - 0.5, meanRow, out);
}
```

Reuse two preallocated `THREE.Vector3` scratch vectors (no per-event allocation). If
`piece`/`clearedRows` are missing (some modes), fall back to `this._lastOrigin` or board
center `(0, 0, ORIGIN_Z)`. Spans are calibrated once visually so origins sit *behind/
around* the board, never inside the brightness-capped pocket.

---

## 8. Palette & Timing language

**Hex (semantic):**
- Calm bed / lock twinkle: blue-white `#CFE0FF`, white `#FFF6E8`.
- Ignition spark / cluster ring: gold `#FFD9A8` → `#FFCE7A`.
- Nova / supernova / Tetris ring + flash: warm-white `#FFF6E8` → gold `#FFD9A8`
  (**never pure `#FFFFFF`, never red-adjacent** — WCAG general-flash + red-flash limits).
- T-spin ring: lavender `#9D8CE0`. Aurora surge: teal `#6FE3D2` / lavender `#9D8CE0`
  (capped `min(,0.17)`, `emitsBloom=false`).
- Constellation: gold node `#FFCE7A` + silver-cyan line `#9FE8FF` (bloom-eligible).
- Meteor heat ramp (existing): `#EAF4FF → #FFE9B0 → #FF8A4A → #9A1F1F`.
- Void rest: `#05060F`.

**Timing (ms):** lock spark **220**, lock/low-combo twinkle-wave **450–500**; cluster ring
**550**; nova ring **600**, nova spike **1 frame** + bloom decay ~5 frames; supernova
inhale **180** → bloom → echo **700** → `wish` draw **~1800** → resaturation tail **~1000**;
Tetris row stagger **50** each (×4), flash decay **~5 frames** (`fxState` `*=0.78`/frame);
perfect inhale **250**; cascade step stagger **70**; aurora surge ramp **1200–1600**;
B2B echo offset **180**, B2B window **~1500**. Engine impulse half-life **~170 ms**
(`k=exp(-delta*4)`), `fxState` decays: bloom `*=0.86`, vignette `*=0.82`, chroma `*=0.8`,
flash `*=0.78` per frame.

---

## 9. Board-readability & Performance budget

**Per-tier scaling / what drops:**

| Quality tier | Twinkle-wave | Shockwave ring | Light-echo | Meteors/shower | Aurora surge | Camera | Flash | (Tier-2) Warp |
|---|---|---|---|---|---|---|---|---|
| Minimal/Low | ✓ (only layer) | ✓ thin only | drop (use thin ring) | reduced count | drop (no aurora) | minimal | off | off |
| Medium | ✓ | ✓ | ✓ | ✓ | drop (no aurora) | ✓ | small only | off |
| High/Ultra/Extreme | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | small only | optional |

- **Board pocket is sacrosanct.** All origins map *behind/around* the board via §7.4
  spans; bloom is MRT-selective (only HDR emissive: stars/dust/meteors/rings glow; sky +
  aurora are luminance-capped, `emitsBloom=false`). Never a full-screen white-out.
- **Cost:** added per-frame budget is ~one quad pool (≤12 instances) + ~7 uniforms +
  one aurora tween. Impulses are fixed-cost (8-slot loop runs regardless). 60 fps safe
  on the target iGPU by construction (no new compute, no new post pass in Tiers 1–4).
- **Photosensitivity:** flashes fire ONLY on nova-peak / supernova / Tetris / Perfect —
  all small-area, warm (never near-red, never pure white), capped (`flashPunch ≤ 0.36`),
  and never on lock or combos (a sub-second lock with any full-screen flash would breach
  WCAG 2.3.1's 3-flashes/sec). The HDR `clamp(0,2.2)` on rings/meteors prevents
  additive+bloom blowout. **`reduce-motion` toggle** (graft from C): drops wave boost to
  +15%, disables flash + camera + warp, caps meteor showers — a global gate read by the
  emitter.

---

## 10. Playground-first Validation Plan

Per CLAUDE.md: nothing is "done" without a playground screenshot + clean console. **One
small effect per session** (iGPU TDR risk). Prototype these as
`src/playground/effects/*.effect.js`:

1. **`twinkle-wave.effect.js`** — the starfield colorNode edit in isolation: a static
   star field + a `?t=`-driven expanding brightening shell from a fixed origin.
   *Checkpoint:* shell expands smoothly, no banding, no WebGPU validation errors;
   capture at `?t=0.2` (mid-expansion) and `?t=0.6` (decayed). Verify inverted variant
   (T-spin) dims-then-rebrightens. Verify `?forceWebGL=1` parity.
2. **`shockwave-ring.effect.js`** — the ring SDF + age fade, both `RING_PRESET` and
   `ECHO_PRESET`. *Checkpoint:* thin ring is crisp + fades as it grows; echo shell is
   soft + low-alpha + does not overdraw to white; HDR clamp holds under bloom; capture
   `?t=0.15` and `?t=0.5`. `?forceWebGL=1` shows the additive ring (no bloom halo).
3. **`aurora-surge.effect.js`** — the aurora band with `uStrength` ramped 0.6→0.9→0.6.
   *Checkpoint:* stays in the upper band, never crosses the board pocket, `min(,0.17)`
   cap holds. (Cheapest; can share a session.)
4. **(Tier-2 only) `warp-pinch.effect.js`** — center-pull lens on a test scene with a
   board-mask rect. *Checkpoint:* stars bow into an Einstein ring; the masked rect stays
   undistorted; amp ≤ 0.025; WebGPU-only (skip on WebGL2).

After each clean screenshot, port the proven node code into the real subsystem
(§6), then validate the *wired* effect via the in-game event bus (trigger a combo/Tetris
in a dev build).

---

## 11. Phased Roadmap (each independently shippable)

- **Phase 0 — Origin mapping + lock honesty (no new renderer).** Add §7.4
  `_cellToWorld`/`_lockOrigin`/`_rowsOrigin`; rewrite `_onPieceLock` to fire the
  ATTRACTOR at the cell, **cut the 0.04 lock shake**, drop `bloomPunch` to ≤0.04.
  Ships immediately; instantly more tactile, zero new assets.
- **Phase 1 — Twinkle-wave (§6.1).** Playground-validate, then wire into lock + combo
  1–3 + cascade. Highest ROI, both backends, no renderer. Ships the "the sky responded"
  feel everywhere.
- **Phase 2 — Shockwave renderer (§6.2).** Build the pool, validate both presets, wire
  the cluster ring (combo 4–6) + nova ring (7–9) + Tetris ring. The only new file.
- **Phase 3 — Supernova + constellation peak (combo 10+) & specials.** Inhale→bloom arc,
  `wish` remnant (reserved), Tetris vertical sweep, T-spin inverted wave + VORTEX,
  B2B echo, LEVEL_UP wishing-star + echo.
- **Phase 4 — Aurora surge (§6.3).** Wire `surge()` into combo 10+ / Perfect / LEVEL_UP.
- **Phase 5 — Reduce-motion toggle + impulse-pool budgeting + photosensitivity audit.**
  Global accessibility gate; verify ≤2 impulses/event and the WCAG flash budget in a
  rapid-combo capture.
- **Phase 6 (OPTIONAL) — Tier-2 UV-warp (§6.4).** Only after Phases 1–5 ship and a
  board-masked `warp-pinch` screenshot is clean. Adds the nova ripple + T-spin twist +
  wormhole pinch as a WebGPU-only polish layer; never load-bearing.

---

## 12. Open Questions for the user

1. **Origin span calibration.** `ORIGIN_SPAN_X/Y = 5.5/6.5`, `ORIGIN_Z = -2.0` are
   first-guess values for "behind/around the board, outside the bright pocket." These
   need a one-time visual calibration in your desktop session (the board's on-screen
   rect vs the WebGPU canvas). Want me to expose them as live-tunable debug uniforms?
2. **Tier-2 warp: build it or shelve it?** It is the one genuinely-invasive,
   WebGPU-only change. The plan ships a complete, magical system *without* it. Do you
   want it in scope, or deferred until the rest is capture-verified?
3. **Audio coupling.** The Tetris Effect research is emphatic that 1:1:1 audio-visual
   weight is what makes this land (a quantized note per lock rising with combo). Is the
   sound layer in scope for this work, or visual-only for now (with hooks left for audio)?
4. **`reduce-motion` source of truth.** Is there an existing settings flag
   (`window.settings.reducedMotion` / `prefers-reduced-motion`) the emitter should read,
   or should I add one?
5. **CASCADE in practice.** Cascade rides `LINE_CLEAR {cascadeCount}` in most modes but
   `CASCADE` also fires standalone in some. Do you want the marching-chain on *every*
   cascade, or only above a threshold (`cascadeCount >= 2`) to keep it special?
6. **Combo cap.** Should combo 10+ be the terminal tier (clamp), or do you want a rare
   "combo 15+" super-peak (e.g. a second constellation figure) for very long chains?
