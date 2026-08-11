# Odyssey Ch6 — earth-at-summit + space placement (handoff)

Status as of 2026-08-11. **Ch3 work is DONE and shipped** (see commits below). This document carries
the *unstarted* half: the two Ch6 asks. Everything here was measured by replaying the real spline and
camera math, not estimated — trust the numbers.

## The two user asks (verbatim intent)

1. "adjust the path spline so that we see the earth shape at the top of the mountains **before it gets
   dark**" — and, from earlier feedback, "I love that we see the earth form in distance from the
   mountain top but it needs to be **darker and that we still see it**".
2. "adjust the spline and the assets in space to have **better placement** or fix the path so it is
   **better aligned with the camera**."

## Chapter anchors

`chapterPositions = [0.000, 0.093, 0.204, 0.389, 0.556, 0.648, 0.815, 0.944, 1.000]`
ch4 = 0.389, ch5 = 0.556, **ch6 = 0.648**, ch7 = 0.815, `spaceSpan = 0.167`.

## Ask 1 — why the earth CANNOT currently appear before dark

There is **no dedicated earth object**. The round planet seen from the summit is the Ch6 **hero gas
giant** (`createHeroPlanet`, `cosmic-expanse.js:467-476`). `earth-core.js` is Chapter 1 (lava core),
and `sky-drift.js:320` deliberately renders no planets in Ch5.

Three gates stack, and all three land *after* the darkening:

| Event | Metric | Value |
|---|---|---|
| ch6 env opacity is 0 until the boundary (`ChapterEnvironmentManager.js:1084-1086`; no 5→6 early-ignite — the `_seamInBoostFor` early-reveal is 7→8 only, `:1090-1096`) | global | ≤ 0.648 |
| SPACE-BACKDROP FADE begins (`sky-drift.js:487-513`, band = `spaceSpan*0.12` = 0.02004) | global | 0.648 |
| bright dome half gone | global | ≈ 0.658 |
| bright dome hard-gated `.visible = false` | global | ≈ 0.666 |
| `heroReveal = rampBetween(approach, 0.12, 0.36)` STARTS (`cosmic-expanse.js:141-152`, applied `:1278`) | global | ≈ 0.668 |
| earth fully visible | global | ≈ 0.708 |

**The windows are disjoint.** The earth is a dark-space-only object by construction.

`nebulaReveal`/`uVoidSkyOpacity` use `rampBetween(approach, 0.24, 0.58)` (`:1262-1268`), so at
`approach <= 0` they are 0 — i.e. an early ch6 ignite would *probably* not drag the void dome into
Ch5 and darken it. **Verify that claim in source before relying on it.**

## Ask 2 — the heroes are off the camera's look axis

Camera is tangent-follow, no fixed look-at (`computeFollowFrame`, `OdysseyCameraController.js:1656-1731`).
BEYOND act: `followDistance 42`, `fovBase 66` (`chapter-profile.js:81-83`) → **half-FOV ≈ 49° horizontal,
≈ 33° vertical**. `climbBias = clamp((tangent.y+0.15)*0.55, 0, 0.65) * climbScale` pushes the aim UP
(`:1711-1713`). Ch6 framing overrides (`:123-128`): `lookRight:-3.2, lookUp:2.4, camRight:2.6, camUp:1.0`;
ch6 has `worldUp:0` (no leveling — Ch5 *does* use worldUp, `:288-317`).

Measured angle between camera forward and the direction to each hero:

```
p=0.648 approach 0.00 camPos(-213,638,-577) fwd(0.70,0.54,-0.46): BH 48.8°  PLANET 44.1°  GALAXY 31.8°
p=0.70  approach 0.32 camPos(-154,696,-620) fwd(0.74,0.50,-0.45): BH 51.1°  PLANET 46.4°  GALAXY 33.5°
p=0.73  approach 0.51 camPos(-117,720,-654) fwd(0.74,0.65,-0.15): BH 68.2°  PLANET 64.5°  GALAXY 50.5°
p=0.76  approach 0.93 camPos( -83,773,-649) fwd(0.81,0.04,-0.58): BH 41.8°  PLANET 33.4°  GALAXY 28.2°
```

31–68° off-axis against ~49°/33° → at or beyond the frame edge for most of the chapter. The angle
**spikes near p=0.73 because the path crests** (tangent.y peaks 0.75) while the assets stay low and deep.

Current `APPROACH` table (local coords, lerped A→B by `smoothstep(approach)`, `cosmic-expanse.js:94-122`),
group anchor world `(-75.2, 718.3, -656.1)`:

```
bhXa:100 bhXb:200 | bhYa:70 bhYb:185 | bhZa:-1080 bhZb:-900 | bhScaleA:1.2 bhScaleB:2.6
planetA {x:170,y:30,z:-840,s:34/28}   planetB {x:280,y:95,z:-740,s:60/28}
galaxyA {x:340,y:250,z:-900,s:155}    galaxyB {x:450,y:310,z:-820,s:250}
nebula pillar FIXED local (-170,40,-600) → world (-245,758,-1256)  ← OPPOSITE side from the heroes
```

Note `cosmic-expanse.js:100-103`: a previous "move planets into camera direction" fix pulled the
lateral +X overshoot back ~40%. **That moved them the wrong way.**

Ideal on-axis LOCAL positions computed at p=0.648 (same distance, on the forward ray):
`BH (696,569,-474)`, `PLANET (544,451,-373)`, `GALAXY (658,540,-448)` — i.e. currently ~450–600 too far
−X, ~300–500 too low, ~450–600 too deep. **Caveat: a single fixed A→B lerp cannot stay framed**, because
the ideal Y target collapses from ~570 at entry to ~90 by p=0.76 as the path crests. Consider a 3-point
march (A→M→B) or deriving positions from the camera forward ray at runtime.

Spline (`src/core/odyssey/data/odyssey-layout.js:13-42`, CatmullRom tension 0.3), Ch5→Ch6 span:
```
idx15 {x:-210,y:622,z:-572}  idx16 {x:-96,y:733,z:-654}  idx17 {x:-63.5,y:765.5,z:-662}
idx18 {x:15,y:781,z:-718}    idx19 {x:61,y:782,z:-708}
```
Ch6 travel Δworld = (+218, +127, −124) — a climbing arc, **not** a −z tunnel.

## Three candidate approaches

- **(A) Move the assets** onto the look ray (raise +X/+Y, roughly halve −Z depth). Must solve the
  p=0.73 crest.
- **(B) Flatten the Ch6 aim** so forward points where the heroes already live: `climbScale` well below
  1, a partial `worldUp` (as Ch5 uses), and/or strong negative `lookUp` in `CHAPTER_FRAMING_OVERRIDES[6]`.
  This kills the `climbBias` up-push that currently throws the aim above the heroes.
- **(C) Re-author the spline** (control points 15→19 climb +Y ~160 while going −Z only ~145 → ~45°
  upward tangent). **HIGHEST RISK** — the spline is load-bearing for Ch5 hero-peak clearance.

## HARD CONSTRAINTS — do not violate

1. **Do not re-wash space bright.** The user already complained space was "much too bright when
   viewing the planets"; it was fixed by the fast backdrop fade + dark void (commit b7db9d62). Deep
   space must stay black/starfield with the planet **dark but visible**.
2. **Do not kill the 5→6 aurora carry** (`SEAM_56_AURORA_CARRY_BAND` 0.85 / hold band 0.4).
3. The spline is load-bearing for Ch5 hero-peak clearance.
4. Tests to keep green: `cosmic-expanse-environment.test.js`, `sky-drift-environment.test.js`,
   `chapter-environment-manager.test.js`, `OdysseyDirector.test.js`.

## Verification

Capture with `npm run capture:odyssey:chapter -- --seam 5-6 --seamWidth 0.06 --duration 8000 --offsets ...`
(and `--chapter 6`). Use a **fresh `ODYSSEY_CAPTURE_PORT` each run** and redirect stdout to a file.
⚠️ Per-chapter short sessions only — full-journey WebGPU captures have TDR-crashed the iGPU.

Prove: (a) the earth-form is clearly visible from the summit **while the sky is still bright**, and
stays visible (dark, not blown out) as space darkens; (b) the heroes are inside the frame at all four
sampled progress values **including the p=0.73 crest**.
