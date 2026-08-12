# Odyssey Ch6 — earth-at-summit + space placement

**STATUS: SHIPPED 2026-08-11.** Both asks are implemented, unit-guarded, and verified with
real WebGPU in-game captures. This document now records what was measured, what changed, and
what was deliberately left alone. The original diagnosis is kept (§1–§2) because the numbers
are what the fix was solved against.

## The two user asks

1. "adjust the path spline so that we see the earth shape at the top of the mountains **before
   it gets dark**" — and "I love that we see the earth form in distance from the mountain top
   but it needs to be **darker and that we still see it**".
2. "adjust the spline and the assets in space to have **better placement** or fix the path so
   it is **better aligned with the camera**."

## Chapter anchors

`chapterPositions = [0.000, 0.093, 0.204, 0.389, 0.556, 0.648, 0.815, 0.944, 1.000]`
ch5 = 0.556, **ch6 = 0.648**, ch7 = 0.815, `spaceSpan = 0.167`.

---

## §1 Ask 1 — why the earth could not appear before dark

There is **no dedicated earth object**. The round planet seen from the summit is the Ch6 hero
gas giant (`createHeroPlanet`); `earth-core.js` is Chapter 1 and `sky-drift.js` renders no
planets in Ch5 by design. Three gates all landed *after* the darkening:

| Event | global progress |
|---|---|
| ch6 env opacity is 0 until the boundary (no 5→6 early ignite) | ≤ 0.648 |
| SPACE-BACKDROP FADE begins (`sky-drift.js`, band = `spaceSpan*0.12`) | 0.648 |
| bright dome hard-gated `.visible = false` | ≈ 0.666 |
| `heroReveal` STARTS | ≈ 0.668 |

The windows were **disjoint**. Note `approach` (which drives `heroReveal`) is derived from
camera.y against the chapter's y-range, so it is pinned at 0 through all of Ch5 — it cannot be
used for a pre-boundary reveal at all.

### There was a second, hidden cause — FOG

Even once the planet was made visible pre-boundary, capture showed it as a **pale ghost**, not
a dark world. Ch5's bright daylight `FogExp2` (density ≈ 0.0024) fogs the planet's ~1050-unit
distance by **≈99.8%** — it was being painted almost entirely in sky colour. `material.fog =
false` on the hero planet is what actually delivered "darker, and that we still see it".
(Same class of bug as the Ch3/4/5 sky-dome fog unlock.)

## §2 Ask 2 — the heroes were off the camera's look axis

Measured on the shipped build: heroes sat **31–68° off the forward ray** against a ~49°
horizontal / ~33° vertical half-FOV — the gas giant reached **ndcX −1.00 by p=0.68**, i.e.
entirely off the left of the screen. The baseline capture confirms it: both planets crammed
half-clipped against the left edge with the right 40% of frame dead-empty.

The root cause was **not** the asset positions alone — it was the spline. Replaying
`computeFollowFrame` over the shipped curve:

- cp17 stalled in z (−654 → −662 while x ran +32) and cp18/19 overshot to x=+61 before
  snapping back to cp20's x=0.
- Aim lurched **13.13°/0.3% of progress**, pitch swinging 32 → 42 → −10, yaw 57 → 83 → 103.
- The aim **pitched below the horizon** mid-ascent.

With the aim swinging ~50° in each axis, no fixed A→B asset lerp could stay framed.

---

## §3 What shipped

### 3.1 Ch6 spline + 6→7 corner re-authored — `src/core/odyssey/data/odyssey-layout.js`

Control points 17–20 turn the zigzag into one smooth banking climb **and** replace the
6→7 hairpin with a helical climb-and-turn:

| | shipped | now |
|---|---|---|
| cp17 | (−63.5, 765.5, −662.0) | (−38.1, 763.3, −693.1) |
| cp18 | (15.0, 781.0, −718.0) | (53.4, 798.6, −742.8) |
| cp19 | (61.0, 782.0, −708.0) | (64.1, 812.9, −729.3) |
| cp20 | (0.0, 804.0, −680.0) | (1.3, 840.3, −677.3) |

| metric | before | after |
|---|---|---|
| max Ch6 aim turn | 13.13°/0.3%p | **2.25** |
| total aim turn across Ch6 | 127° | **28°** |
| Ch6 aim pitch below horizon | yes (to −10°) | **never below +10°** |
| **Ch7-entry max RAIL turn** | **146.4** | **17.1** |
| rail ever descending (0.648→0.905) | yes | **never** |

**The 6→7 hairpin.** The shipped path ran +X to x=+61 then *reversed* straight back to
cp20's x=0 — a 118° tangent flip inside 0.006 of progress, which is the hard elbow visible
in-game. (My first pass made it slightly worse at 122° and added a descent through it.) It
cannot be removed by shortening the excursion — total arc length is fixed, so the detour has
to exist. The fix is to spend that length as a **wide helical sweep that keeps climbing
through the turn** instead of an out-and-back: the turn is now spread across ~0.02 of
progress and the rail never stops ascending.

> Constraining only the rail was not enough. An intermediate solve fixed the corner but let
> the optimiser flatten the path early to set up the turn, which dropped the Ch6 camera aim
> to −2° — the rail still rose while the camera stared at nothing. The objective needs a
> floor on the **aim pitch**, not just on the rail tangent.

> **ARC LENGTH IS LOAD-BEARING.** Path positions are arc-length parameterised over the WHOLE
> curve, so changing total length re-maps every chapter's p → world position. A first attempt
> shortened the curve 74u and slid chapters 1–5 by up to **54u** — which would have silently
> broken the Ch4 hero-peak clearance. The shipped points hold the total at **1767.58 vs
> 1767.57**: ch1–ch4 within 0.01u, ch5 within 0.28u. Pinned by `odyssey-path-layout.test.js`.

### 3.2 Hero triad re-solved — `cosmic-expanse.js` `APPROACH`

Endpoints were **solved**, not eyeballed: the real camera was replayed across Ch6 and A/B
least-squares fitted so each hero holds a target NDC. Each hero's *distance* is preserved, so
apparent size and the tuned scale ramps are unchanged — only direction changed.

| hero | ndc entry → exit | distance |
|---|---|---|
| black hole | (−0.38, +0.20) → (−0.35, +0.38) upper-LEFT | 1263 → 866 |
| gas giant | (+0.14, −0.32) → (+0.21, −0.23) lower-CENTRE-right | 1047 → 756 |
| galaxy | (+0.50, +0.26) → (+0.57, +0.38) upper-RIGHT | 1213 → 958 |

Worst-case |ndcX| across 4:3 → 21:9 is 0.75. Nothing clips.

**Re-solve the fit whenever the spline moves.** The endpoints are fitted against a replay of
the camera, so any control-point edit invalidates them.

### 3.3 Ambient corridor frame — `cosmic-expanse.js`

The nebula tiers, dust tiers, streak motes and asteroid garland are all authored with depth
along local −Z, which assumed a −Z corridor; Ch6 travels +X/+Y, so they sat **43–84° off-axis**.
They now hang off one `cosmic-corridor` group whose origin sits on the camera's travel and
whose −Z runs down the chapter chord. Same authored parameters, now **1–14° off-axis**; in
corridor space the camera travels almost straight down −Z with only ±23 lateral drift. Dust
tiers contain the travel 11/11 samples; nebula tiers correctly stay ahead as backdrop.

The nebula **pillar** is placed *from* the corridor frame but not parented to it (the corridor
rotation would tilt a Pillars-of-Creation column ~45°); it stays world-vertical, yaws to face
back down the corridor, and tracks 15° → 39° off-axis across its reveal window.

### 3.4 Earth-at-summit staging — `cosmic-expanse.js` + `ChapterEnvironmentManager.js`

- `SEAM_56_EARTH_IGNITE_*` (manager): ignites ch6 across the Ch5 tail so the group is present
  (and its `update()` runs) while the sky is still daylight. It **saturates before** the
  boundary so it does not compound with the earth's own reveal ramp, and is released just past
  the boundary once the ecotone crossfade has caught up.
- `resolveSummitEarthStaging()` (env): `earthReveal` fades the gas giant up over the summit;
  `spaceReveal` holds **everything else** — stars, black hole, nebula, dust, void dome, aurora
  bridge, lights — at zero until the camera is actually in Space.
- `setOpacityScale` now also flips `.visible`, so the pre-boundary presence costs no fill.
- `material.fog = false` on the hero planet (see §1).

### 3.5 Ch6 horizon levelling — `OdysseyCameraController.js`

`CHAPTER_FRAMING_OVERRIDES[6].worldUp = 0.55`. Ch5 hands over at worldUp 0.5 (roll ≈ 11.6°);
ch6 used to drop to worldUp 0 and roll **23.3°** — a lurch right where the carried summit ring
and aurora are still on screen. Now enters at 10.5° (continuous) and settles to ~5.7°.

### 3.6 Asteroid garland — now self-shaded (`createAsteroidRockTSL`)

The garland's note claimed rim/fill light "comes free from the chapter's two lights". It does
not: the rig is one dim ambient plus a point light 600u away, so `0x0b0e18` rendered as **pure
black**. That went unnoticed while the garland was 43–84° off-axis; once the corridor frame put
it where the camera looks, it punched flat black holes through the carried aurora.

`MeshStandardMaterial` could not be rescued — at every albedo/emissive/intensity combination
tried the rocks stayed black or went flat, because **no usable light reaches them** (a bright
emissive just swamped what little there was and erased all form). Chapter 6 is otherwise
entirely unlit MeshBasic/TSL surfaces with hand-authored shading, so the rocks now do the same:
a wrapped view-space key, a warm accretion bounce, a fresnel rim, and a shadow floor that is
never pure black. Shading in **view space** is not world-anchored but is immune to
instanced-normal handling and guarantees every rock shows a lit face, a terminator and a dark
side from any angle. Seats were also widened and scales trimmed so the close passes graze the
frame rather than eclipse it.

---

## §4 Verification

**Unit guards** (all green, and each falsified against the pre-fix values):
- `tests/unit/odyssey-ch6-hero-framing.test.js` — drives the REAL `OdysseyCameraController`
  over the REAL spline with the REAL framing, builds the REAL env, projects each hero. Fails
  on the old values with `blackHole ndcX −1.29`.
- `odyssey-path-layout.test.js` — Ch6 turn-rate + no-dive + **total arc length**. Fails on the
  old spline with max turn 17.4 (limit 3). The pre-existing Ch4 hero-peak clearance test still
  passes.
- `cosmic-expanse-environment.test.js` — summit staging, corridor placement, hero march.
- `ChapterEnvironmentManager.test.js` — ignite ramp, saturation, release, chapter scoping.

Full suite: **310 test files pass.**

**In-game captures** (WebGPU, `npm run capture:odyssey:chapter`, per-chapter short sessions):
- `artifacts/odyssey/wave-v/seam-5-6-high-webgpu/seam-5-6-6000ms.png` — **p=0.6346, full
  daylight**: the gas giant reads as a solid banded world above the summit. This is ask 1.
- `.../seam-5-6-6600ms.png` — p=0.6535: still visible as the sky fades. "That we still see it."
- `.../chapter-06-high-webgpu/chapter-06-motion-03.png` — heroes spread across the frame;
  compare against the baseline capture where both planets were half-clipped off the left edge.
  Also shows the garland reading as dark rocks with form rather than black discs.
- `.../seam-6-7-high-webgpu/seam-6-7-7600ms.png` — p=0.8331, exactly where the hairpin used to
  be: the rail now sweeps through as one continuous curve.

> The **first frame of every capture run shows the main menu** — the board has not taken over
> yet. That is a harness warm-up artifact (present in baseline too), not a rendering fault.
> Also: the seam pan is **eased, not linear** in time. Read `currentPosition` from the JSON
> sidecar; do not assume offset ÷ duration. And `cd` out of the artifact directory before
> re-capturing or the harness fails with `EBUSY`.

## §5 Constraints — all honoured

1. **Space was not re-washed bright.** Deep space stays black/starfield; the gate runs the
   other way too (nothing but the earth may enter the daylight frame).
2. **5→6 aurora carry untouched** (`SEAM_56_AURORA_CARRY_BAND` 0.85 / hold 0.4).
3. **Spline arc length preserved**, so Ch5 hero-peak clearance is intact (≤0.28u drift).
4. `cosmic-expanse-environment.test.js`, `sky-drift-environment.test.js`,
   `chapter-environment-manager.test.js`, `OdysseyDirector.test.js` all green.

## §6 Known, pre-existing, NOT addressed

- **The Ch5 aurora/cloud carry washes the left ~55% of early Ch6 green.** Present identically
  in the baseline capture. It is protected by constraint 2, so it was left alone — but it is
  the most obvious remaining blemish in Space and is worth its own pass.
- Ch7's deep shaft (cp21+) is near-vertical, which makes yaw degenerate there. Measured,
  deliberately not touched — the 6→7 *corner* leading into it is fixed (§3.1).
