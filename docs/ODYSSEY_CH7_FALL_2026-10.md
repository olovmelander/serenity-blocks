# Odyssey — Chapter 7: The Fall (2026-10)

**Status: LANDED on `feature/odyssey-ch7-fall`.** The owner's brief: "the black hole floats right
next to the journey — I want to be sucked into the black hole and have amazing warp effects while
inside." Follows the [seamless pass](ODYSSEY_SEAMLESS_PASS_2026-10.md).

## 0. Why the black hole floated (read before changing ch7)

Gargantua is **camera-locked**: re-seated ~913 u ahead of the eye every frame
(`GARGANTUA_LOCK`, `resolveGargantuaLockPosition`). That is deliberate — an earlier world-parked
hero slid out of frame on ch7's hairpin (p 0.878–0.893) and two near-vertical kinks
(0.925–0.935, 0.940–0.953) and left the chapter ~75 % black (ODYSSEY_CHAPTER_BY_CHAPTER_IMPROVEMENT_PLAN
§ch7). A world point at the lock pose leaves the frame by p 0.89 and sits behind the camera from
0.90 to 0.926. So the fix is **not** to un-lock it: the lock stays, and the fall is authored on top.

## 1. The fall — one pure schedule

`src/rendering/odyssey/transitions/odyssey-black-hole-fall.js` — `resolveBlackHoleFall(progress,
chapterPositions)` — is read by the hero pose, the window shader, the post lens/bloom and the
camera framing, so they cannot drift apart. Local ch7 progress (0 = level 49, 1 = ch8 start):

| Beat | Local | What happens |
|---|---|---|
| The pull | 0 → 0.30 | angular radius 8.3° → ~35° (u^1.9), eases onto the view axis by 0.30 |
| Disk-plane crossing | 0.14 → 0.34 | the band's tilt sweeps +0.10 → −0.14 rad through edge-on: a razor line across the hole |
| The horizon | → 0.44 (just past level 52) | the shadow reaches 72° (wider than the frame's corners); its surface has become the window onto the interior (portal 0.55 → 1 of u) |
| Inside — the warp | 0.44 → 0.82 | the warp tunnel fills the view; band, fold arcs and embers gone; void dome and far stars stop drawing |
| The exit | 7→8 window (0.82 → 1 and on) | the vanishing point glides onto the Retrosun and the tunnel's mouth opens from it, the city and its sun through it |

**Keeping the rail visible:** the hero recedes along the view axis just enough to keep the
shadow's near surface ≥ 150 u from the eye (`resolveBlackHoleFallDepth`), and is scaled so it
subtends the scheduled angle. The rail and level nodes (within ~100 u) always draw in front.

**The disk:** its outer edge is held in front of the eye (≤ 0.85 of the hero's distance). At its
physical 4.8 shadow radii it passed behind the camera once the hole outgrew ~12° and its face
became a cream floor under half the frame (bench capture).

## 2. The singularity window (`createSingularityWindowTSL`)

The shadow's own material: opaque, depth-writing, fade-exempt — the same pipeline state as the
black shadow it replaced, alpha-tested from creation (the exit mouth), so nothing changes at
runtime (ADR-0020). Black while `uPortal` = 0.

The tunnel is computed from the **view ray** in the shadow's local frame (+Z to the eye, XY the
screen), not from geometry: a ray at angle θ from the axis meets a unit-radius tunnel at depth
cot θ. On that:
- 56 angular streak lanes, per-lane speed and dash, scrolling toward the eye; a spiral twist that
  grows with the warp;
- accretion filaments: 2 baked-lattice fetches, stretched along the tunnel on **log** depth (cot θ
  crowds everything into the centre; its log spreads features evenly across screen radius);
- the **journey palette** — ember, deep ocean, island green, snow, aurora, nebula violet, accretion
  amber, neon — banded on log depth and zooming outward (an 8-texel sRGB texture);
- the exit light dead ahead (it becomes the Retrosun);
- the mouth (`uOpen`, rad): alpha-tested away, with a blazing rim that fades as it widens (at full
  width a fixed rim was a huge bright circle — a +20 luma spike in the 7→8 gate); the tunnel walls
  dim as it widens so brightness eases into the darker city.

Cost per pixel: one atan2 (+1 for the mouth), two hashes, two lattice fetches, one palette fetch.

## 3. Post and camera

- **Post:** the lens target publishes `portal`; the lens variant's in-shadow bloom mask (0.06)
  lifts with it so the tunnel's light blooms. A uniform in the existing variant — no new variant.
  The lens's chromatic aberration gives the streaks their rainbow fringes for free.
- **Camera:** new framing key `rollDeg` (applied about the view axis after `lookAt`); chapter 7's
  resolver reads `resolveBlackHoleFallCamera`: roll up to 14° and +6° FOV, sin-shaped from the
  chapter's start to where the 7→8 window opens — exactly zero at both seams (the city's stage
  alignment needs an unrolled basis). Roll is zeroed under `prefers-reduced-motion`
  (`setOdysseyCameraReducedMotion` hook).

## 4. Verification

- Playground bench `src/playground/effects/ch7-fall.effect.js` (`?effect=ch7-fall&orbit=0&t=8&fallT=…`):
  the real environment, path and camera; no post.
- In game (WebGPU, High): seam 6→7 maxStep 38.9 PASS; 7→8 −21.4 PASS; a 17-station luma sweep
  through ch7 (`--seam=7-8 --offsets=…`) stays within the gate (approach 14 → 34, the black frame
  dip 22, inside 30–46, exit 45 → city 32). No console errors.
- `tests/unit/odyssey-black-hole-fall.test.js` pins: at rest before ch7, monotone growth, inside
  by level 52, near surface ≥ 150 u, the disk crossing, roll/FOV zero at both seams, reduced motion.

## 5. Performance

Lane A (RTX 3070, High 1080p, GPU p50 ms; `baseline/baseline-repeat`), the fall branch vs main
`bbdf5390`, alternating per station on a quiet machine:

| Station (p) | Main | The fall | Draws |
|---|---|---|---|
| 0.88 — the pull (6→7 crossfade still drawing ch6) | 0.72 / 0.79 | 0.79 / 0.79 | 53 → 53 |
| 0.91 — at the horizon | 0.39 / 0.39 | 0.39 / 0.39 | 30 → 30 |
| 0.94 — inside the tunnel | 0.39 / 0.39 | 0.39 / 0.39 | 30 → 24 |

Neutral: within one timer tick (~0.066 ms) at every station. Inside, the window replaces the void
dome, far starfield, disk, fold arcs and embers (−6 draws); the window shader costs no more than the
fill it replaces. JSONs: `repos/odyssey-gpu/perf-baseline/ch7fall-1/`.

## 6. Open items

- A radial zoom blur during the warp (more speed) — would need taps in the lens variant; the
  chromatic fringes already sell much of it. Measure before adding.
- Quality tiers: the window costs the same on every tier today (it is cheap — §2); Low could drop
  the second lattice octave.
- The in-game `settings.reducedMotion` toggle is not yet plumbed to the camera (only the OS
  media query is honoured).
