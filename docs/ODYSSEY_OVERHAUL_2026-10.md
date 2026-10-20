# Odyssey overhaul — every chapter (2026-10-20)

**A record.** Olov's brief, in full: *"I want to do a full visual overhaul of all chapters in the
odyssey mode. We have made so many great themes now using threejs r186.1, blender and other
techniques so we really need to improve the visual stunningness and implementation and seams of all
chapters in odyssey mode now. I want the performance to be good and that we improve the visuals,
the atmosphere, the composition to really have the most visually stunning and perfect odyssey mode
chapter that possibly can be created. ... can chapter 8 be inspired from Neon District? can space
chapter be compositioned and inspired by all the space themes we have with large planets, great
black hole, amazing galaxy and so forth. And how can we make the chapters 3, 4, and 5 more of an
experience and more visually stunning? and how do we finetune and improve the chapter 1 and 2? And
how do we really make it feel like we are in a warp going into the black hole? and how can we not
have the planets like moving as we move along the odyssey path? I want them to be placed in space on
1 place."*

## 0. How the pass was run

- **Audit first.** A before-gallery of all eight chapters (Extreme, WebGPU, 1280×720, eight stations
  each, phase-locked `--time=9 --envTime=30`) and four read-only research passes (ch8 vs Neon
  District; what moves in the space chapters; One World ch3–5; ch1–2 and the ch7 warp).
- **Lanes.** The space chapters (ch5→6→7 heroes, the ch7 warp, the post pipeline and the camera's
  ch6/ch7 code) were done in the integration branch `feature/odyssey-overhaul`; ch8, Act I (ch1–2)
  and Act II (ch3–5) each in their own worktree and branch (`feature/odyssey-overhaul-{ch8,act1,act2}`),
  with a shared protocol, a shared GPU lock and their own records
  (`ODYSSEY_OVERHAUL_{CH8,ACT1,ACT2}_2026-10.md`).
- **Verification.** Every visual change was captured in game (the chapter-capture harness,
  `--settle=2500`, seams `--settle=6000`) and the seams scored with `scripts/odyssey-seam-luma.mjs`.

## 1. What the audit found (before)

| Chapter | What the before-gallery showed |
|---|---|
| 1 Earth Core | A strong lava-lake opening, then cavern walls that read as flat dark slabs, and a brown-to-grey steam veil filling the frame for the chapter's last 40 %. |
| 2 Deep Ocean | Mostly empty mid-blue water, pale wedge shafts, a caustic web that read as a net of lines; a lovely island breach. |
| 3–4 One World | The same snow cone dead ahead at every parked orb (orbs are ~33 u apart, the massif ~1 km away), flat noon light, broccoli trees, sticker clouds, a dark smudge on the mountain face, a fat white rail near the eye. |
| 5 Sky | A plastic-white summit, cotton-ball clouds; a promising departure (the night limb, the aurora). |
| 6 Space | The striped giant held at one SCREEN spot for its whole rise (it slid 31.6° against the stars — "moves as we move"), the hole swelling by a scripted 2.15× on top of its approach, a 40 px galaxy, a flat disk band. |
| 7 Black Hole | A flat disk, a dead black frame at the horizon crossing, a tunnel of concentric rings and pie wedges that streamed at a fixed clock rate (a glide looked the same as sitting still). |
| 8 Urban | A flat synthwave canyon: unlit box towers with dotted windows, a dead street, generic cards. |

## 2. The space chapters — one place for every body (integration branch)

### 2.1 What moved, and what holds still now

- **The giant** (`PLANET_WORLD_SEAT`): ONE world point from the first frame it shows to the end of
  chapter 6, its pole fixed in the world, its world radius fixed. Solved on the real camera
  (`OdysseyCameraController.computeFollowFrame`, BEYOND pinned, seam framing blended with
  `resolveJourneyFraming`): it holds the lower right of the frame from p 0.722 to the 6→7 seam at
  4:3, 16:9 and 21:9, clear of the rail and of the hole's disk band, ~900 u out at p 0.80 and closing
  to ~770 — it grows by approach alone (8.5° → 10° radius). The rail-camera screen seat
  (`PLANET_SEAM_LOCK`) is retired.
- **The black hole** (`OMEN_SPINE_ANCHOR.approachGain` 1.15 → 0): one size in the world, chapter
  7's own; it grows on screen only as the camera closes on it (6.1° → 8.2°).
- **The sky at infinity**: chapter 6's dome and both star shells are seated on the eye (they hung at
  the chapter's centre and slid a few degrees; chapter 7's sky is seated on the eye, so the two
  Milky Ways disagreed by 1.4–3.6° across the 6→7 crossfade). Chapter 7's far starfield is seated
  on the eye too, and no longer turns.
- **The galaxy at infinity** (`GALAXY_SKY_SEAT`): a fixed direction of the sky at a fixed distance
  from the eye, turned once — upper left, 7° in radius.

Guards: `tests/unit/odyssey-ch6-hero-framing.test.js` (one place / one pole / one size for the
giant, with the eye on the rail and off it; motion against the sky bounded by the camera's own
parallax; the galaxy's direction, distance and turn constant), `cosmic-expanse-environment.test.js`.

### 2.2 The ringed giant (`odyssey-ringed-giant.js`, `odyssey-ringed-giant.tsl.js`)

The Stellar Drift giant re-derived for a mesh (theme code is never imported into Odyssey): a band
table by latitude (belts, the jets' wind, how torn the cloud is) read along a latitude the cloud
bends, two flow reads half a cycle apart so the shear never winds up, a storm; the rings as a slab of
ice with an optical depth from one radial profile (C/B/A rings, the division, gaps, a strand), whose
shadow on the cloud tops is traced through the same profile; the giant's shadow across the rings; a
thin limb-lit atmosphere. Lit by ONE world light: the direction to the black hole's disk, so it is
half-lit (an 88° phase from the rail) instead of a flat full face. The old green auroral crown is
opt-in (`?odysseyCh6GiantAurora=1`): on the tipped pole it stood off the limb as flames.

### 2.3 The black hole's lensed image

The far side of the disk is now bowed over the shadow as a broad band (1.0–2.2 shadow radii above,
a thin arc below) carrying the disk's temperature ladder and lanes — Gargantua's read — instead of a
thick white donut. Chapter 6's omen arrives on its own reveal uniform (its materials' opacity was a
dead write, so it used to pop in whole at the boundary). In chapter 7 the image fades out as the
hole outgrows the frame (11° → 22°) and the photon ring dims at the frame's edge.

## 3. The warp (chapter 7)

- **The warp drive** (`advanceWarpDrive`, `CH7_WARP_DRIVE`): the eye's travel speed along the path
  (against one orb spacing per glide) eases into a throttle — a quick punch as a glide starts, a
  slower coast as it lands, a cruise while parked — and the tunnel's PHASE is integrated from it on
  the CPU (never clock × a changing rate). Teleports (map jumps) are ignored; reduced motion caps it;
  `?odysseyCh7Throttle=<0..1.6>` pins it for captures.
- **The tunnel** (`createSingularityWindowTSL`): streaks stretch with speed; a NEAR layer on an inner
  tube runs in linear depth (~3× faster across the screen than the wall at the same angle: real
  parallax, flight rather than zoom); broken ribs of the wall on linear depth replace the concentric
  rings that read as a target; seven soft spokes instead of twelve wedges; a STARBOW on the streak
  heads at speed (violet ahead, white, amber, red at the edge). Every rate is a multiple of 1/64 so
  the phase wraps whole.
- **The rush**: a radial zoom blur in the chapter-7 lens pass, out from the hole's centre, driven by
  the throttle, gated by an `If` (free when off), gone before the mouth opens onto the city.
- **The horizon**: the window starts showing the interior earlier (`portalFrom` 0.55 → 0.46), so
  the crossing is no longer a dead black frame.

## 4. Open / next

(filled in as the lanes land)
