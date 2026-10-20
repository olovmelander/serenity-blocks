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

- **The 5→6 boundary**: the void dome now owns the background within the first 3 % of chapter 6
  (it was ~20 % opaque when the world's night sky stopped covering the background, so the clear
  colour — a blend of ch5's light-cyan fog and ch6's black — flashed a navy sky for ~0.012 p;
  main showed the same flash).

## 4. The lanes (each has its own record)

- **Chapter 8 — the neon city** (`ODYSSEY_OVERHAUL_CH8_2026-10.md`): one city plan places the
  towers and bakes a glow map of what the signs throw; walls, street, rain, mist and sky read it
  (Neon District's light-the-air idea, rewritten in the rotated corridor's space). Tube blades,
  wall signs, shopfront strips, roof boxes and a few giant screens spell on as the spire's
  ignition reaches them; a wet boulevard with lane paint, kerb LEDs, traffic, sign reflections
  and an analytic reflection of the Retrosun; rain lit by what is behind it, following the eye;
  a smog sky lit from below with sheet lightning; lantern strings, skybridges, a needle mast. The
  torus gates, tube trails, holo cards and corridor sheets are retired. Draw calls per station
  73–91 → 42–49; frame time unchanged within noise.
- **Act I — Earth Core and the deep** (`ODYSSEY_OVERHAUL_ACT1_2026-10.md`): one continuous rock
  shaft round the climb (ledges that catch the lake's light, heat cracks, a glowing vent) instead
  of the slab colonnade; four lava falls pouring toward the rising camera; lava bubbles on the
  lake (High); ember gusts on beats and glides. The deep ocean darkens with depth; marine snow is
  lit inside the shafts and mostly sinks; shafts breathe on their own timing; the caustic net
  became soft light; a whale shark and a manta (Ocean theme's models, copied) pass above the
  camera in the deep half. Ch1 climb GPU p50 1.6 → 1.25 ms, drawables 51 → 42.
- **Act II — the One World** (`ODYSSEY_OVERHAUL_ACT2_2026-10.md`): every ch3/ch4 orb holds its own
  angle on the island (the glide between orbs is the pan) instead of eight near-identical views of
  the cone; a rainbow on a shower veil at the true antisolar point; gulls, swallows and a goose
  skein in one draw; the Himalayan Peak eagle thermalling over the face; pollen, thistle down and
  diamond dust; a summit snow plume into the banner cloud; soft cloud shadows over all dry land
  (they replaced the hard-edged blobs that read as a smudge on the massif); a thinner rail near
  the eye; a whiter high sun. 130.5 fps through ch3–5 at Extreme.

## 5. Open / next

- **5→6 rising steps.** After the boundary fix the gate still counts gentle rises (+3–4 luma per
  0.01 p) as the hole materialises and the nebula and comet arrive; main fails the same rule
  (two rises). A build-up, not a pop; left as it is.
- **Chapter 1's steam** (local 0.8–1.0) is still mostly vapour; the 1→2 gate now has ~15 luma of
  headroom for a brighter, golder steam with structure.
- **Chapters 3–5** are richer but still cartoon-painted: tree crowns, sticker clouds, a smooth
  summit cone in close shots; not built from the research list: the waterfall, the glory, the
  storm cell, light shafts in air. L27/L28 still look ~45° up the face (a camera-rig change).
- **Chapter 6's near nebula mass** still reads as a cotton ball.
- **Chapter 8**: the nearest towers' lit windows show faintly over the tunnel just before the
  mouth opens; rain-on-glass (Neon District's lens drops) proposed for the post — an owner call
  (it would sit over the orbs and the rail).
- **The warp**: an FOV kick on glides (the camera's FOV path is shared with the fall, pulses and
  portals — not touched); the Low tier pays the same tunnel as High.
