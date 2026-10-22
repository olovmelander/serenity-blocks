# Odyssey chapter 6 — one place for every hero (2026-10-19)

**A record.** Olov's ask: *"In the space chapter 6, the planets and things and assets moves so
much, i want the black hole for example to be locked on the spine path instead of drifting
towards it and then lock just before we go into the black hole and chapter 7. So we need to
improve the overall composition, movements and visuals in this chapter. We have made so many
good space themes in this game so take inspiration from those also."*

## What moved, measured

All numbers come from a replay of the real `OdysseyCameraController` over the real spline
(BEYOND act, 16:9). The guard for the new behaviour is
`tests/unit/odyssey-ch6-hero-framing.test.js`.

- **The black hole marched.** It had three authored poses about 750 u apart, scaled 1.2 → 3.4
  on `approach`. That value is the camera's HEIGHT through the chapter, pinned at 0 until
  p 0.766. A second glide then moved it onto chapter 7's camera lock over the last fifth of
  the chapter. On screen it slid from ndc (−0.56, 0.55) to (0.03, 0.26). It grew from 3.9° to
  8.2° between p 0.828 and p 0.840, about 1 % of the path.
- **Every hero rode the camera's height**, and an orb close-up moves the camera. So each
  close-up moved the heroes too: the hole was pulled into the close-up's view, and the planet
  was glued beside the orb.
- **The galaxy marched** between two poses and turned to face the eye every frame, so it slid
  and swivelled.
- **Whole fields turned.** Both dust tiers and the sprite nebulae yawed about the corridor's
  origin (0.010 / 0.006 rad/s), so the far field slid sideways at 5–13 u/s all chapter.
- **The giant spun its whole group** at 0.025 rad/s, so its tilted rings swung about 45° across
  a crossing, and a roll wobble sat on top of that. The disk light pulsed on its own 9 s sine.

## What it does now

Each hero hangs at ONE point in the world, written in the spine's own frame (along the tangent,
up, right) at a progress. If the path is re-authored, the placement follows it.
`resolveCh6HeroPlaces` caches the three points per layout.

- **The hole on the spine** (`OMEN_SPINE_ANCHOR`). It sits on the rail's own line, 871 u down
  its direction from the 6→7 hand-over, 42 u up and 51 u right. That is exactly where
  chapter 7's camera lock (`GARGANTUA_LOCK`) puts Gargantua for the path camera at that
  progress.
  - The rail flies at it from the chapter's first frame, so it sits at the end of the path
    wherever the path turns.
  - It grows only with progress, from 3.0° to 8.3° (`resolveOmenSpineScale`, smoothstepped).
  - Across the last 0.035 of the chapter (about 10 u, clear of level 46's orb) it settles onto
    the live lock. On the path camera the two are under 0.03 ndc apart.
  - From chapter 7's first frame the two black holes coincide.
  - Its opaque shadow grows out of a point as the omen arrives. It used to appear whole on the
    aurora, ahead of its own light.
- **The omen bends the sky** (`OMEN_LENS`). Chapter 7's screen-space lens now runs in chapter 6
  too, from the omen's own target. The board hands it over first, so chapter 7's hero has the
  last word on the centre at the seam.
  - Strength rises from 0.15 to 0.45 with progress and holds there, just under chapter 7's
    lens at its first frame. Across the seam, chapter 7's lens rises past it.
  - Its reach is 0.6 of chapter 7's, so the stars and the Milky Way bend right round the hole
    while the orbs in the middle of the frame are left alone.
  - The lens variant also masks bloom inside the shadow, which keeps it black. This idea comes
    from the Black Hole theme.
- **The giant.** It keeps the 5→6 seam's screen seat, so the climb's pitch-up cannot slide it.
  The seat is now low and right (ndc (0.25, −0.4)), the composition plan's rule 9.
  - The seat is taken on the RAIL camera (`OdysseyBoardController._syncRailCamera`, published on
    `camera.userData.railCamera`). A close-up or free look therefore leaves the giant where the
    rail's view has it.
  - Over the existing hand-over window it passes to `PLANET_WORLD_SEAT`, the seat's own spot
    there, and stays put. It keeps one world radius, now x1.35 (at 3.1° it read as a small
    striped ball beside the hole), and grows only as the camera closes in.
  - The spin is now 0.003 rad/s with no wobble (Stellar Drift's giant turns at about 0.0055).
- **The galaxy** (`GALAXY_WORLD_SEAT`) is a small far jewel in the upper left, opposite the
  giant. It is turned once to face the chapter's middle, and its scale went from 100 to 130.
- **No whole-field turns**, and no light breath of its own.
- **Orb close-ups in chapter 6 look up the rail** (`ODYSSEY_FOCUS_ALONG_RAIL`). The camera turns
  40° right of the rail (it was 30° left) and keeps the rail's climb. The rail runs from the orb
  up-left into the black hole, with the giant low on the left, clear of the orb's ring.
  Before, a close-up turned left put the hole under the level card, and a levelled one cut it
  off at the top of the frame.

## From the space themes

- **Lunara.** "The moons hold still": a hero is placed once, in a fixed world direction.
- **Stellar Drift.** A giant turns at minutes per revolution, and only small, near things move
  fast.
- **Black Hole.** The lens sized to the projected shadow, and bloom kept out of the shadow.
- **The catalogue's calm rules.** One dominant mass per view, nothing far translates, and
  parallax comes only from the camera's own travel.

## Cost

Interleaved A/B: main against this branch, travel p 0.74 → 0.88 over 20 s, Extreme, RTX 3070
laptop on AC, 131.6 Hz display. The p 0.74 start puts the lens variant's switch at the 5→6 seam
inside the run.

| arm | fps | p99 | worst frame | missed | sync pipeline builds | GPU p50 per second |
|---|---|---|---|---|---|---|
| main r1 | 130.6 | 8.6 ms | 8.9 ms | 0 | 0 | 0.46–0.85 ms |
| branch r1 | 130.4 | 8.7 ms | 9.0 ms | 0 | 0 | 0.52–0.92 ms |
| main r2 | 130.5 | 8.6 ms | 14.8 ms | 2 | 0 | 0.46–0.92 ms |
| branch r2 | 130.9 | 8.6 ms | 18.4 ms | 1 | 0 | 0.52–0.92 ms |

The lens costs nothing measurable. The GPU timer reads in 0.066 ms steps, and both arms' medians
sit at about 0.66 ms. The pre-reveal warm already builds the lens variants, so switching to one at
the boundary built no pipeline.

## Kept as it was

- Chapter 7 stays camera-locked. See `ODYSSEY_CH7_FALL_2026-10.md`: a world-parked hole left the
  chapter about 75 % black on the hairpin.
- The 5→6 seam schedule, the planet's after-dark rise and the nebula field's masses are
  unchanged.
- `APPROACH` survives only as the fallback for an unknown layout.

## 2026-10-22 — the hole rides the path

Olov: *"it feels like the black hole drifts, i want it to be locked at the journey path we are
moving on."*

**Why one world point still drifted.** The rail turns about 26° through chapter 6 (16° net). A
point fixed in the world sits on the path's line only where it was solved, at the hand-over.
Replayed on the real camera (BEYOND, 16:9), the rail's heading holds one place on screen all
chapter: its tangent's vanishing point stays near ndc (−0.02, 0.20). The hole wandered round that
point by up to 0.27 of the frame. It sat below-left of it at the boundary (−0.12, −0.07),
above-right by mid-chapter (0.08, 0.13), and above it at the lock (0.03, 0.26). In game, the blue
ribbon met the hole in its middle, then at its lower rim, then below it.

**What it does now** (`resolveOmenPathPlace`). The hole is written in the spine's frame at the
current progress. It uses `OMEN_SPINE_ANCHOR`'s seat (871 / 42 / 51), pushed down the path's heading
by the length of path still to run to the hand-over, at the seat's angle. So:

- its place against the rail's heading never changes: the offset from the vanishing point holds
  within 0.005 of the frame, and on screen it stays in a 0.05 box around ndc (0.04, 0.25);
- it closes on the eye exactly as fast as the rail runs, 6.6° → 8.2°, one world size as before;
- at the hand-over it IS the seat, which is chapter 7's lock for the path camera. The settle onto
  the live lock is now a few thousandths of the frame, so from the chapter's first frame it holds
  the place chapter 7 will keep it in;
- it is placed by progress, never by where the eye looks, so an orb close-up or free look leaves
  it where the rail has it.

**The eased eye.** A scroll eases the follow eye about 0.14 s behind `currentPosition`. Seated on
the rail's progress, the hole ran ahead of the view on the bends while the eye caught up: 12 px at
720p on a gentle scroll, 27 px on a moderate one, 54 px on a flick. The camera controller now
keeps `followProgress`, the progress the eased eye stands at (it equals the position after any
direct move, such as a glide or teleport). The board publishes it on
`camera.userData.followProgress`, and the hole is seated by it. The worst offset drops to 4 px on
gentle and moderate scrolls and 12 px on a flick. Glides between orbs drive the eye directly, so
they never lagged.

**Guards.** `tests/unit/odyssey-ch6-hero-framing.test.js` checks four things. The hole's offset
from the rail's heading holds within 0.015 all chapter, and it stays within 0.06 of chapter 7's
lock place. An orb eye never moves it. It closes at the rail's speed (0.7–1.3×). The old
placement fails at the first station, 0.35 off the lock. `tests/unit/odyssey-camera-controller.test.js`
checks that the eased eye stands where the frame at `followProgress` puts it. Headless callers
(no camera) keep the hand-over seat.

**Seen in game** (WebGPU, High, 1280×720, six stations at local 0.15–0.90, before and after). Before,
the hole moved round a fixed screen mark from station to station. After, the mark sits on its
shadow at every station, and the ribbon reaches the same spot under it every time. No console or
WebGPU errors.

**Still open.** The ribbon beyond the 6→7 boundary is chapter 7's hairpin. It is drawn ahead at its
pixel floor as a thin line, climbing up and right across the hole's right side. It is the real path,
and the hole cannot sit on it: chapter 7 keeps the hole camera-locked, so the climb only reads as
"into the hole" once you ride it.
