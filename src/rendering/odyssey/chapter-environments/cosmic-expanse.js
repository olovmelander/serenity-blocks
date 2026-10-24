/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Cosmic Expanse Environment - Chapter 6 Visual Theme
 *
 * Creates a deep-space vista dominated by a volumetric black hole, a hero gas
 * giant, and a layered nebula. Part of the Odyssey AAA "Cosmic Ascent" overhaul
 * (Phase 4 — chapter level-up); see docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5.
 *
 * WebGPU: the board renderer is now THREE.WebGPURenderer, which cannot draw raw
 * GLSL THREE.ShaderMaterial. The three procedural surfaces (void sky / black-hole
 * accretion + lensing / banded gas giant) are now built by the validated TSL
 * NodeMaterial builders in ./cosmic-expanse.tsl.js, and the three canvas/point
 * particle systems (nebula volume, suction infall, void stars) are instanced
 * billboard quads (THREE.Points renders as 1px on WebGPU) via the shared
 * ./shared/odyssey-tsl-billboard.js helper.
 *
 * Layers (plan §3.2):
 *   0  Nebula void dome      — FBM galactic backdrop, not a flat black sphere
 *   1  Hero anchor           — volumetric black hole: TSL accretion disk
 *                              (swirling plasma + Doppler asymmetry), photon ring,
 *                              fresnel gravitational-lensing shell
 *   1b Hero planet           — banded gas giant with storm bands + atmosphere rim
 *   2  Mid environment       — nebula volume billboards, distant accretion glow
 *   6  Near life             — twinkling starfield + matter spiralling into the void
 *
 * All glow is procedural (uv() disc / fresnel) so create() never needs a
 * `document`/canvas and stays safe in headless tests.
 *
 * Theme: "Journey through stars" -> "The event horizon awaits"
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    exp,
    float,
    fract,
    length,
    materialOpacity,
    mix,
    mod,
    modelWorldMatrixInverse,
    normalize,
    oneMinus,
    positionGeometry,
    positionWorld,
    pow,
    sin,
    smoothstep,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { acquireChapterLight } from './shared/chapter-light-pool.js';
import { getChapterTransitionForChapter } from './shared/chapter-profile.js';
import { getActiveOdysseyChapterPositions, getChapterPathRange, getOdysseyPathCurve } from '../path-utils.js';
import {
    createVoidSkyTSL,
    createBlackHoleTSL,
    OMEN_SHADOW_RADIUS,
    orientBlackHoleOmen,
    createHeroPlanetTSL,
    createDistantGalaxyTSL,
    GALAXY_INCLINATION,
    HERO_PLANET_RADIUS,
    createNebulaPillarTSL,
    createAsteroidRockTSL,
} from './cosmic-expanse.tsl.js';
import { createBakedVoidSkyTSL, GALACTIC_BAND_AXIS } from './odyssey-cosmic-backdrop.js';
import { GARGANTUA_LOCK, resolveGargantuaLockPosition } from './black-hole-transcendence.tsl.js';
import { createNebulaFieldTSL } from './odyssey-nebula-field.js';
import { latticeNoise3 } from './shared/odyssey-lattice-noise.js';
import { fbm3, ridged3 } from './shared/odyssey-tsl-noise.js';
import { billboardLocal, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';
import { pickStellarClass } from './odyssey-stellar-ramp.js';
import { ORBIT_EARTH_SCHEDULE, orbitEarthAt } from '../composition/odyssey-orbit-earth.js';

/**
 * Cosmic Expanse environment configuration
 */
export const COSMIC_EXPANSE_CONFIG = {
    id: 6,
    name: 'cosmic-expanse',
    yStart: 297.5,
    yEnd: 430.0,
    colors: {
        primary: 0x0a0a0a, // Void black
        secondary: 0x1a1a2e, // Deep blue-black
        tertiary: 0xff3300, // Accretion orange
        accent: 0x4400cc, // Event horizon purple
        background: 0x000000, // Pure black
    },
};

// B3b / B-COMPOSE — hero-triad framing march endpoints (lerped by uApproach 0→1 in
// update()). KEY GEOMETRY: across chapter 6 the camera travels local +X/+Y/−Z (forward
// look ≈ (+0.7,+0.5,−0.25)). Heroes placed at a fixed left/deep point therefore DRIFT
// behind + shrink as the camera advances (the screenshots: tiny planet bottom-centre,
// pinprick galaxy far-left). The re-composition LEADS each hero along that forward axis
// (+X/+Y, pulling toward −Z) and grows it, so all three stay framed + clearly visible as
// the camera dollies — the gas giant lower-left foreground, the BH the upper-centre
// destination omen, the galaxy the upper-right far anchor. Module-scoped scratch keeps
// the per-frame lerps allocation-free.
// HERO TRIAD SPREAD (2026-06-15, from the live in-game capture): the previous placement
// crowded all three heroes into the cluttered LEFT (over the carried aurora/mountains) while
// the right half of frame sat dead-empty, and the gas giant read as a tiny dot. The triad is
// now SPREAD across the frame and enlarged so each reads clearly: the black hole holds the
// upper-LEFT (the destination omen), the gas giant becomes a BIG near hero in the lower-CENTRE
// (out of the left clutter), and the galaxy anchors the empty upper-RIGHT. Each marches A→B by
// uApproach as the camera dollies.
// ── SOLVED PLACEMENT (2026-08) ───────────────────────────────────────────────────
// The endpoints below are no longer eyeballed. They were SOLVED offline by replaying
// the real camera (OdysseyCameraController.computeFollowFrame + the 2048-sample path
// LUT, BEYOND act followDistance 42 / fovBase 66) across chapter 6 and least-squares
// fitting A/B so each hero holds a target NDC while the camera dollies.
//
// WHY THE OLD NUMBERS FAILED: chapter 6 runs +X/+Y (forward is ~(0.82, 0.40, -0.40)),
// but the triad was authored as if the corridor ran -Z. Measured against the shipped
// build the heroes sat 31-68 deg off the forward ray versus a ~49 deg horizontal /
// ~33 deg vertical half-FOV — i.e. off the LEFT edge for most of the chapter (the gas
// giant reached ndcX -1.00 by p=0.68). The note that used to live here, about pulling
// the lateral overshoot back ~40% "into the camera direction", moved them the WRONG way.
//
// The re-solve keeps each hero's DISTANCE (so apparent size, and therefore the tuned
// scale ramps below, are unchanged) and only changes direction. Resulting framing,
// verified from 4:3 through 21:9:
//   black hole  ndc (-0.38, +0.20) -> (-0.35, +0.38)  upper-LEFT, rising, 1263 -> 866
//   gas giant   ndc (+0.14, -0.32) -> (+0.21, -0.23)  lower-CENTRE-right, 1047 -> 756
//   galaxy      ndc (+0.50, +0.26) -> (+0.57, +0.38)  upper-RIGHT anchor, 1213 -> 958
// Worst-case |ndcX| across all aspect ratios is 0.75 (galaxy at 4:3); nothing clips.
// Exported for scripts/odyssey-ch6-approach-resolve.mjs, which must read the LIVE values —
// a re-solve against transcribed (stale) coordinates is how the first run fit the wrong pose.
//
// ⚠️ RETIRED AS THE HEROES' SCHEDULE (2026-10-19). Nothing marches any more: each hero hangs at
// one place in the world (OMEN_SPINE_ANCHOR / PLANET_WORLD_SEAT / GALAXY_WORLD_SEAT, below). The
// `*A` poses here are only the fallback when the path layout is unknown, and the history above is
// kept because it records why every number moved.
export const APPROACH = {
    // Black hole: the destination omen, in TWO phases (owner direction 2026-08-15:
    // "the path goes straight into the black hole — it IS the transition"). Phase 1
    // (ease 0 → DIVE_START): holds the upper-left third and LOOMS, the Journey
    // north-star. Phase 2 (DIVE_START → 1): converges onto the camera's EXIT RAY —
    // C sits 700 u down the measured boundary flight axis (camera local (73,65,−52)
    // aiming at (707,242,−289), probed via the real-controller replay) — so the rail
    // flies STRAIGHT INTO the horizon as the Lensing Engage threshold takes over.
    bhDiveStart: 0.7,
    bhScaleA: 1.2,
    bhScaleB: 2.6,
    bhScaleC: 3.4,
    bhXa: 392,
    bhXb: 607,
    bhXc: 700,
    bhZa: -842,
    bhZb: -647,
    bhZc: -285,
    bhYa: 586,
    bhYb: 387,
    bhYc: 240,
    // ⚠️ RE-SOLVED FOR WAVE 1A'S ASCENT (2026-08-16). These endpoints are least-squares fits
    // against a CAMERA REPLAY, so a spline change invalidates them — that is the standing rule
    // in this file and the ascent is exactly the case it was written for. After the rail was
    // lifted, the gas giant projected to ndcX -0.021 at the chapter entry: dead centre, a hair
    // to the LEFT, which breaks the authored triad (black hole upper-left, giant lower-centre-
    // RIGHT, galaxy upper-right) and puts two heroes on the same side of the frame.
    // Corridor-local screen-right at the entry measures (0.972, 0.235, 0), so x is very nearly
    // pure lateral here. +114 (756 -> 870) puts it in the right third with margin on BOTH
    // constraints: it must clear centre (ndcX > 0) AND stay 0.3 of a frame from the galaxy,
    // which is also right-of-centre. Swept: 860 and 880 both pass, 896 collides with the
    // galaxy at 0.297. 870 is the middle of the passing band, not the edge of it.
    // ⚠️ RE-SOLVED AGAIN FOR WAVE 1C'S FLYBY (2026-08-16), same standing rule: the flyby
    // re-authored the climb and translated the space run, which rotated the entry tangent
    // (the camera now banks in at 5.43°), and the old triad broke two ways — the planet
    // read ndcX -0.02 at entry (needs > 0) and the galaxy at 0.29 left the planet no legal
    // band (needs > 0 AND 0.3 clear of the galaxy). Solved by scripts/
    // odyssey-ch6-approach-resolve.mjs with the galaxy moved FIRST (entry 0.35), then the
    // planet against the widened band (entry 0.03, -0.14; moved 77 u, distance 1151 -> 1147
    // so apparent size holds).
    // Masterpiece pass (2026-10): the giant is x1.35 bigger at both ends of the march (it
    // read as a small flat-striped disc). Only `s` changed — positions are the solved fit.
    planetA: {
        x: 880, y: 352, z: -207, s: (34 / 28) * 1.35,
    },
    // planetB moved along the EXIT CAMERA'S RIGHT vector (the exit forward runs
    // nearly down local +x, so screen-lateral is mostly ±z, not ±x — the first nudge
    // moved the planet along the view axis and its ndc barely changed) when the BH
    // dive took the exit axis: the giant must stay clear of the dive line
    // (separation ≥ 0.2 asserted). Distance held ~756 so apparent size is unchanged.
    planetB: {
        x: 855, y: 60, z: -89, s: (60 / 28) * 1.35,
    },
    // Wave 1C: moved right-of-centre to re-open the planet's band (see planetA note).
    // Entry ndc (0.35, 0.27), distance 1214 vs 1215 before — apparent size preserved.
    // (2026-10-03) `s` 155 -> 70 and 250 -> 100: the galaxy is a small, far jewel in the upper
    // right — at 6.6 deg it rivalled the black hole's 8.3 deg at the hand-off.
    galaxyA: {
        x: 810, y: 663, z: 186, s: 70,
    },
    // ⚠️ THE TRIAD IS ONE FIT, NOT THREE — and the summit needed its own keyframe (Wave
    // 1C). A feasibility sweep proved NO single static planetA satisfies both the Ch5
    // summit window and the boundary composition once the flyby banks the camera: the
    // solved planetA reads ndc 1.12-1.24 across the ignite stations. So the giant holds
    // THIS pose through the summit window and travels to planetA across
    // [summitEnd, ch6Start] in update() — a short pre-boundary drift that reads as
    // parallax. Solved by the same resolver, all five derived stations inside |ndc| 0.87.
    // (The transition plan once recorded {875, 175, -275}; that pose was solved before the
    // look-ahead re-scale and now reads ndcY 0.908 at the third station — re-solved.)
    //
    // `s` is OWNER DECISION D3 (2026-08-16): the gas giant gets to be genuinely BIG at the
    // summit. 3.4 vs planetA's 1.214 puts a ~4.3° disc over the mountains (2.8x the entry's
    // apparent size at the summit distance of ~1250 u); the travel to planetA across
    // [summitEnd, ch6Start] carries the scale with it, so the giant settles into the
    // Wave-4-approved entry framing exactly at the boundary. F4 ("the hero reads as set
    // dressing... a small striped disc indistinguishable from a level orb") is what this
    // number exists to kill.
    planetSummit: {
        x: 900, y: 150, z: -250, s: 3.4,
    },
    galaxyB: {
        x: 942, y: 449, z: 39, s: 100,
    },
};

// ── EARTH AT THE SUMMIT ──────────────────────────────────────────────────────────
// "See the earth shape at the top of the mountains BEFORE it gets dark." The "earth"
// is this chapter's hero gas giant; there is no separate earth object (earth-core.js is
// Chapter 1, and Ch5 deliberately renders no planets). It could not appear before dark
// because THREE gates stacked after the darkening: ch6 env opacity was 0 until the
// boundary (0.648), the bright Ch5 dome is hard-gated off by ~0.666, and heroReveal
// (chapter-local `approach`) does not even start until ~0.668 — `approach` is derived
// from camera.y against the chapter's y-range, so it is pinned at 0 through all of Ch5.
//
// Fix: drive the gas giant's reveal from GLOBAL progress instead, across the Ch5 tail
// while the sky is still full daylight. The solved planetA position happens to sweep in
// from the upper right and settle centre-low exactly across that window (measured ndc at
// 16:10: (0.79, 0.38) at p=0.608 -> (0.13, -0.32) at the boundary), so the planet needs
// no extra keyframe — it simply fades up where it already sits and stays put.
//
// Expressed as fractions of the Ch5 span so it tracks any future layout re-authoring.
export const SUMMIT_EARTH_REVEAL = Object.freeze({
    // ⚠️ RETIMED A THIRD TIME 0.18/0.085 -> 0.0723/0.0106 (owner, same day: "the gas planet is
    // seen very early and then drifts as we get into space"). The giant now RISES AFTER DARK, as
    // the aurora grows from the limb: 0.725 -> 0.75, and is held at one place on screen through
    // the hand-off (PLANET_SEAM_LOCK) instead of travelling a summit keyframe. The first stars
    // lead it, in the twilight (`starsFromBeforeBoundary`). Order: mountain -> the sky deepens ->
    // first stars -> the aurora grows from the limb -> the planet rises -> space.
    //
    // (Previous note, superseded:) ⚠️ RETIMED AGAIN 0.28/0.15 -> 0.18/0.085 (owner report
    // 2026-10-02: "align everything correctly when it comes to when the planets shows"). At 0.28/0.15 the gas giant faded up
    // across p 0.6408 -> 0.6935 into a FULL DAYLIGHT sky — a striped planet hanging in the blue
    // — and stayed there until the sky finally went dark from ~0.69. It now rises WITH the
    // twilight: it starts as the sky begins to deepen (p 0.6813) and is full as the sky reaches
    // near-black (p 0.7198), then the first stars take over [summitEnd, ch6Start]. Order of
    // beats: mountain (to ~0.648) -> the sky deepens -> the planet rises with the dark -> the
    // stars -> the aurora over the limb -> space.
    // ⚠️ RETIMED 0.41 -> 0.28 (north-island plan Wave 0, owner playtest 2026-08-16). At
    // 0.41 the ignite started at p 0.5881 — INSIDE the massif flyby's in-frame pass
    // (0.545–0.648) — so the D3-sized giant faded up mid-mountain-beat and read as
    // arriving "so early" (the owner's words). 0.28 starts the ignite at p 0.6408, as the
    // crown exits the frame: mountain first, then the world blooms into the emptied sky
    // at the crest, then the first stars. Beats stop competing.
    //
    // (History: these comments once said 0.610/0.634, computed from skySpan = 0.648−0.556
    // — but 0.556 is LEVEL 31's position, not chapter 5's start. The CODE always derived
    // from chapterPositions at runtime; only the prose lied. Derive facts by importing the
    // modules, never by parsing source.)
    startBeforeBoundary: 0.0723, // p 0.725 — after dark
    // Fully present just before the boundary (p 0.75), with the aurora at its height.
    endBeforeBoundary: 0.0106,
    // The NEAR star tier leads the planet: it fades up from here (p 0.7048, as the sky deepens
    // to near-black) to `starsBeforeDark` at the boundary.
    starsFromBeforeBoundary: 0.122,
    // Fraction of the Space span over which the REST of the chapter (stars, black hole,
    // nebula, dust, lights) ramps in past the boundary. Deliberately short: it must not
    // re-wash Space bright, and nothing but the earth may bleed into the daylight sky.
    //
    // 0.06 -> 0.16 (Act II->Space §8.3 step 3). At 0.06 the gate was 0.0074 of p wide and
    // `spaceReveal` read as a BINARY FLIP: the bank-off arm measures +96.2 luma per 0.01p at
    // p=0.7441, and today that pop is invisible only because the cloud bank is a fully
    // opaque wall in front of it (its alpha hard-clamps to 1.0 at both 0.7401 and 0.7441).
    // Widening it to 0.16 spreads the same arrival over 0.0197 of p.
    //
    // ⚠️ HARD CEILING 0.18004. `gateEnd` must stay below
    // `worldOff = ch6Start + ONE_WORLD_ACT_MARGIN (0.0222)` = 0.7623, and must stay ABOVE
    // ch6Start — both are ORDERING invariants in odyssey-seam-56-schedule.test.js:86,:101,
    // not tunable numbers. (0.7623 - 0.7401) / 0.1233 = 0.18004. 0.16 leaves 0.0025 of
    // margin; 0.175 leaves 0.00062, which is not enough to survive another re-layout.
    spaceGateBand: 0.16,
    // The 5->6 HAND-OFF WINDOW, as fractions of the Space span either side of the boundary.
    // Space arriving after the boundary is a rise BY CONSTRUCTION, so the systems that make
    // up "space" must begin arriving BEFORE it, while the bank is still falling. Only used
    // to raise `nebulaReveal` (never to lower it) — see `spaceArrival` in updateCosmicExpanse.
    //
    // ⚠️ RETIMED after the limb landed, and the pre-boundary half PROVED WASTED. These
    // reveals are all multiplied by `spaceReveal`, which is exactly 0 below ch6Start — so
    // a hand-off starting at p=0.71013 bought nothing: the bank-off arm measured luma 1.78
    // at p=0.7221 both before and after it was added. What it DID do was drive the nebula
    // to ~0.9 by p=0.7501, which capture-review showed as a saturated green field flooding
    // the frame — a +23.1 luma per 0.01p rise, the largest remaining defect at that point.
    //
    // The trough it was meant to fill is now the LIMB's job (measured: p=0.7221 goes 1.78
    // -> 26.16 with the limb in). So the hand-off keeps only the half that was ever load-
    // bearing: saturating before the metric window closes, which is what removes the tail
    // rises at p=0.7941/0.8001.
    handoverBeforeBoundary: 0.0, // p = 0.74010 — the boundary itself
    handoverAfterBoundary: 0.373, // p = 0.78610 — clear of the last two stations
    // STARS BEFORE DARK (Wave 3). The NEAR star tier is deliberately not baked into the
    // void dome precisely so it can arrive while there is still blue sky — this is the
    // opacity ceiling it may reach before the boundary. The window is [summitEnd,
    // ch6Start]: zero through the whole earth-ignite (nothing but the earth may bleed
    // into full daylight), then the first stars fade up across the final climb as the
    // zenith deepens, and the normal `starReveal x spaceReveal` staging takes over past
    // the boundary via max() — it can only ever arrive EARLIER, never dip.
    starsBeforeDark: 0.5,
});

const _omenLock = new THREE.Vector3();
const _keyLocal = new THREE.Vector3();
const _galaxyFacing = new THREE.Vector3();
const _cometLight = new THREE.Vector3();
const _cometPath = new THREE.Vector3();
const _spineTangent = new THREE.Vector3();
const _spineRight = new THREE.Vector3();
const _spineUp = new THREE.Vector3();
const SPINE_WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * THE GAS GIANT HOLDS ITS PLACE THROUGH THE 5->6 HAND-OFF (owner report 2026-10-02: "seen very
 * early and then drifts as we get into space"). A real-camera replay measured the authored poses
 * sliding the giant diagonally across the whole frame (ndc (0.53, 0.49) -> (-0.03, -0.35) over
 * p 0.685-0.72, as the camera pitches up 28 deg with the climb), parking it ON the rail for
 * 0.72-0.755 while it shrank 3.4 -> 1.64, then sliding right again. Across the hand-off the giant
 * is now seated from the CAMERA — at a fixed screen position right of the rail, a fixed distance
 * and a fixed angular size — rising a touch as it fades in, and handed over [handoverFrom,
 * handoverTo] (fractions of the Space span past the boundary) to its place in the world
 * (PLANET_WORLD_SEAT), which sits on the seat's own spot there. Only with a real perspective
 * camera (the live journey); headless callers go straight to the world place.
 */
export const PLANET_SEAM_LOCK = Object.freeze({
    // (0.25, -0.09) until 2026-10-19: LOW now (the plan's rule 9, "hang the giant low +
    // diagonal"), since the black hole hangs at the end of the rail — the giant keeps clear of
    // the hole's disk band in flight, and of the orb in the close-ups that look up the rail.
    ndcX: 0.25,
    ndcY: -0.4,
    // Starts this much lower and rises into the seat as it fades in.
    rise: 0.07,
    distance: 1050,
    // Scale per world unit of distance, so the giant's world radius is the same through the seat,
    // the hand-over and the world place. x1.35 the old march's s/d (0.00195) since 2026-10-19:
    // hung low, the giant has the room, and at 3.1 deg it read as a small striped ball beside
    // the hole (the march used to grow it to 5.9 deg by the seam).
    sizeRatio: 0.00195 * 1.35,
    handoverFrom: 0.178, // p ~0.775
    handoverTo: 0.435, // p ~0.805
});

// ── ONE PLACE IN THE WORLD FOR EVERY HERO (2026-10-19) ───────────────────────────────
// Owner: "the planets and things and assets moves so much, i want the black hole for example
// to be locked on the spine path instead of drifting towards it and then lock just before we go
// into the black hole and chapter 7." Each hero used to MARCH between authored poses on the
// camera's HEIGHT through the chapter — which also swung with every orb close-up, so the heroes
// lurched whenever the eye left the rail — and the black hole ran a second glide onto ch7's
// lock over the last fifth of the chapter. Measured on the real camera it crossed a quarter of
// the frame and grew 3.9 -> 8.2 deg in the last 1 % of the path. Now each hero hangs at ONE
// point in the world, written in the SPINE'S OWN FRAME at a progress (along its tangent, up,
// right — so the placement follows the rail if the path is ever re-authored), and only the
// camera moves.

/**
 * THE HOLE'S SEAT AT THE HAND-OVER. 856 u down the rail's direction from the 6->7 hand-over (80 u
 * below its tangent, 39 u right, so it sits where the rail's drawn end points; 871 / 42 up / 51
 * until 2026-10-22, when the rail met the hole at its rim): exactly where ch7's camera lock puts
 * Gargantua for the path camera there (solved by replaying the real controller over the real
 * spline). Through the chapter the hole rides the path at this seat's angle (resolveOmenPathPlace),
 * so it arrives here on its own; in the last few units before the hand-over it settles onto the
 * live lock — on the path camera a correction of a few thousandths of the frame — so chapter 7
 * picks it up where it already is.
 */
export const OMEN_SPINE_ANCHOR = Object.freeze({
    along: 855.6,
    up: -79.7,
    right: 39,
    // How much smaller than ch7's the shadow's world radius starts, on top of the real closing
    // distance: 1 / (1 + approachGain) at the boundary -> ch7's at the hand-over. 1.15 until the
    // 2026-10-20 overhaul (2.9 -> 8.2 deg, 2.15x of it a scripted swell that read as the hole
    // flying at you); 0 now: one size in the world, ch7's own, and it grows by approach alone
    // (6.1 -> 8.2 deg) — a great black hole from the chapter's first frame.
    approachGain: 0,
});

/**
 * The gas giant's place once the seam's screen seat lets go: the seat's own spot (ndc (0.25,
 * -0.4) at 1050 u) for the path camera at `at` (a fraction of the Space span past the
 * boundary, inside the hand-over window), in the spine's frame there.
 */
export const PLANET_WORLD_SEAT = Object.freeze({
    // ONE PLACE FOR ITS WHOLE VISIBLE SPAN (overhaul 2026-10-20). Olov: "how can we not have the
    // planets like moving as we move along the odyssey path? I want them to be placed in space on 1
    // place." The giant used to be held at a fixed SCREEN spot (on the rail camera) from its rise
    // to p 0.775 and only then handed to a world point — in that window it slid 31.6 deg against
    // the stars, the "moves with us" read. It now hangs here from the first frame it shows: solved
    // on the real camera (BEYOND pinned, seam framing blended) so it holds the lower right of the
    // frame from p 0.722 to the 6->7 seam at 4:3, 16:9 and 21:9, clear of the rail and of the
    // hole's disk band, ~900 u out at p 0.80 and closing to ~770 (it grows by approach alone).
    at: 0.4,
    along: 655.3,
    up: -277.5,
    right: 490.7,
    // World radius (8.5 deg from the p 0.80 view): a large planet whose rings span a third of
    // the frame's width, not a striped ball.
    radius: 133,
    // The pole: the camera's up at the seat tipped TOWARD the rail by `poleTilt` (so the rings
    // open into an ellipse and their north face, lit from the hole, faces the eye), then rolled
    // about the line of sight.
    poleTilt: THREE.MathUtils.degToRad(18),
    poleRoll: THREE.MathUtils.degToRad(-14),
});

/**
 * THE GALAXY AT INFINITY (overhaul 2026-10-20): a fixed direction of the sky, as the stars are,
 * written in the spine's frame at the chapter's middle (along, up, right — unit vector), kept at
 * `distance` from the eye so it never grows or slides against the stars. Solved on the real
 * camera: upper left of the frame through the whole chapter at 4:3-21:9, clear of the hole's
 * disk band. `angularRadius` sizes the disc: 7 deg reads as a grand spiral, not a speck.
 */
export const GALAXY_SKY_SEAT = Object.freeze({
    along: 0.897,
    up: 0.1661,
    right: -0.4096,
    distance: 1600,
    angularRadius: THREE.MathUtils.degToRad(7),
});

/**
 * The galaxy: a small far jewel in the upper left of the path camera's frame, opposite the giant,
 * 1700 u out (the seat ndc (-0.4, 0.4) at `at`; inside a 4:3 frame all chapter), turned once
 * to face the chapter's mid-point and inclined — no march, and no turning to the eye every frame.
 */
export const GALAXY_WORLD_SEAT = Object.freeze({
    at: 0.48,
    along: 1521.6,
    up: 125.5,
    right: -667,
    // 100 read as a 16 px speck at 1600x850; the hole still owns the frame at 2.2 deg.
    scale: 130,
});

// THE 6->7 LOCK, BY PROGRESS (seamless pass). It completes exactly where ch7 first appears (the
// boundary minus ch6's seam half-width), so from the crossfade's first frame the two black holes
// coincide. Across this fraction of the Space span (~10 u of path, clear of level 46's orb) the
// omen settles from its place on the spine onto the live lock.
export const OMEN_HANDOFF_SPAN = 0.035;

/**
 * Global-progress schedule of the omen -> Gargantua handoff.
 * @returns {{start: number, end: number}|null} null when the layout is unknown
 */
export function resolveOmenHandoffWindow(chapterPositions) {
    const ch6Start = chapterPositions?.[5];
    const ch7Start = chapterPositions?.[6];
    if (!Number.isFinite(ch6Start) || !Number.isFinite(ch7Start) || ch7Start <= ch6Start) return null;
    const seamWidth = getChapterTransitionForChapter(6)?.seamWidth ?? 0.0222;
    const end = ch7Start - seamWidth;
    return { start: end - (ch7Start - ch6Start) * OMEN_HANDOFF_SPAN, end };
}

/**
 * A point written in the spine's own frame at `progress`: `along` its tangent, `up` (world up
 * made square to the tangent) and `right`.
 * @returns {THREE.Vector3} `out`
 */
export function resolveSpineFramePoint(progress, seat, out) {
    const curve = getOdysseyPathCurve();
    const at = THREE.MathUtils.clamp(progress, 0, 1);
    curve.getPointAt(at, out);
    curve.getTangentAt(at, _spineTangent).normalize();
    _spineRight.crossVectors(_spineTangent, SPINE_WORLD_UP);
    if (_spineRight.lengthSq() < 1e-8) _spineRight.set(1, 0, 0);
    _spineRight.normalize();
    _spineUp.crossVectors(_spineRight, _spineTangent).normalize();
    return out.addScaledVector(_spineTangent, seat.along)
        .addScaledVector(_spineUp, seat.up)
        .addScaledVector(_spineRight, seat.right);
}

const _omenPathSeat = { along: 0, up: 0, right: 0 };

/**
 * THE HOLE RIDES THE PATH (2026-10-22). Olov: "it feels like the black hole drifts, i want it to be
 * locked at the journey path we are moving on." Parked at its hand-over seat, the hole sat on the
 * path's line only at the hand-over: the rail turns ~26 deg through the chapter, so on the path
 * camera it wandered round the rail's vanishing point by up to 0.27 of the frame (below-left of it
 * at the boundary, above-right mid-chapter, above it at the lock) and the ribbon met it at a
 * different place at every orb. It is now written in the spine's frame at the CURRENT progress:
 * OMEN_SPINE_ANCHOR's seat, pushed down the path's heading by the path still to run to the
 * hand-over, at the seat's angle. So it holds one place against the rail all chapter, closes on
 * the eye exactly as fast as the rail runs (6.6 -> 8.2 deg), and at `handoffEnd` it IS the seat.
 * @returns {THREE.Vector3} `out`
 */
export function resolveOmenPathPlace(progress, handoffEnd, out) {
    const ahead = Math.max(0, handoffEnd - progress) * getOdysseyPathCurve().getLength();
    const k = (OMEN_SPINE_ANCHOR.along + ahead) / OMEN_SPINE_ANCHOR.along;
    _omenPathSeat.along = OMEN_SPINE_ANCHOR.along * k;
    _omenPathSeat.up = OMEN_SPINE_ANCHOR.up * k;
    _omenPathSeat.right = OMEN_SPINE_ANCHOR.right * k;
    return resolveSpineFramePoint(progress, _omenPathSeat, out);
}

// The heroes' places only change with the layout (the curve object is rebuilt when it does).
const _heroPlaces = {
    curve: null,
    key: '',
    revision: 0,
    omen: new THREE.Vector3(),
    planet: new THREE.Vector3(),
    // The planetrise (see below): where the giant hangs before it, and the arc it rises on (a
    // turn about the rail point at the rise's middle, about this horizontal axis).
    planetBelow: new THREE.Vector3(),
    planetRiseCentre: new THREE.Vector3(),
    planetRiseAxis: new THREE.Vector3(1, 0, 0),
    galaxy: new THREE.Vector3(),
    // Where the galaxy turns to face, once: the spine at the chapter's middle.
    galaxyFaces: new THREE.Vector3(),
    // The giant's pole and the direction toward its light (the black hole), world space.
    planetPole: new THREE.Vector3(0, 1, 0),
    planetLight: new THREE.Vector3(0, 1, 0),
    // The galaxy's fixed direction in the sky (unit, world space).
    galaxyDir: new THREE.Vector3(0, 0, -1),
};
const _seatOrigin = new THREE.Vector3();
const _toRail = new THREE.Vector3();
const _riseTurn = new THREE.Quaternion();

/**
 * The turn that carries the giant from its seat back down the planetrise's arc at `rise` (0 = it
 * hangs below the limb, 1 = it is at its seat): identity at the seat.
 */
export function resolvePlanetRiseTurn(places, rise, out = new THREE.Quaternion()) {
    const down = (1 - THREE.MathUtils.clamp(rise, 0, 1)) * THREE.MathUtils.degToRad(ORBIT_EARTH_SCHEDULE.riseDeg);
    return out.setFromAxisAngle(places.planetRiseAxis, -down);
}

/** The giant's world place at `rise` on the planetrise's arc (see resolveCh6HeroPlaces). */
export function resolvePlanetRisePlace(places, rise, out = new THREE.Vector3()) {
    resolvePlanetRiseTurn(places, rise, _riseTurn);
    return out.copy(places.planet).sub(places.planetRiseCentre).applyQuaternion(_riseTurn)
        .add(places.planetRiseCentre);
}

/**
 * World positions of the heroes for the active layout (cached per curve + chapter layout).
 * @returns {{omen: THREE.Vector3, planet: THREE.Vector3, galaxy: THREE.Vector3,
 *   galaxyFaces: THREE.Vector3, revision: number}|null} null when the layout is unknown
 */
export function resolveCh6HeroPlaces(chapterPositions) {
    const handoff = resolveOmenHandoffWindow(chapterPositions);
    if (!handoff) return null;
    const ch6Start = chapterPositions[5];
    const span = chapterPositions[6] - ch6Start;
    const curve = getOdysseyPathCurve();
    const key = `${handoff.end}|${ch6Start}|${span}`;
    if (_heroPlaces.curve !== curve || _heroPlaces.key !== key) {
        resolveSpineFramePoint(handoff.end, OMEN_SPINE_ANCHOR, _heroPlaces.omen);
        resolveSpineFramePoint(ch6Start + span * PLANET_WORLD_SEAT.at, PLANET_WORLD_SEAT, _heroPlaces.planet);
        resolveSpineFramePoint(ch6Start + span * GALAXY_WORLD_SEAT.at, GALAXY_WORLD_SEAT, _heroPlaces.galaxy);
        curve.getPointAt(THREE.MathUtils.clamp(ch6Start + span * 0.5, 0, 1), _heroPlaces.galaxyFaces);
        // The giant's pole: the spine's up at its seat made square to the line back to the rail,
        // tipped toward the rail, rolled about that line.
        const seatP = THREE.MathUtils.clamp(ch6Start + span * PLANET_WORLD_SEAT.at, 0, 1);
        resolveSpineFramePoint(seatP, { along: 0, up: 0, right: 0 }, _seatOrigin);
        _toRail.copy(_seatOrigin).sub(_heroPlaces.planet).normalize();
        _heroPlaces.planetPole.copy(_spineUp).addScaledVector(_toRail, -_spineUp.dot(_toRail)).normalize()
            .multiplyScalar(Math.cos(PLANET_WORLD_SEAT.poleTilt))
            .addScaledVector(_toRail, Math.sin(PLANET_WORLD_SEAT.poleTilt))
            .normalize()
            .applyAxisAngle(_toRail, PLANET_WORLD_SEAT.poleRoll);
        // Its light is the black hole's disk: one fixed direction, giant -> omen.
        _heroPlaces.planetLight.copy(_heroPlaces.omen).sub(_heroPlaces.planet).normalize();
        // The galaxy's sky direction, from the spine frame at the chapter's middle.
        const midP = THREE.MathUtils.clamp(ch6Start + span * 0.5, 0, 1);
        resolveSpineFramePoint(midP, { along: 0, up: 0, right: 0 }, _seatOrigin);
        _heroPlaces.galaxyDir.set(0, 0, 0)
            .addScaledVector(_spineTangent, GALAXY_SKY_SEAT.along)
            .addScaledVector(_spineUp, GALAXY_SKY_SEAT.up)
            .addScaledVector(_spineRight, GALAXY_SKY_SEAT.right)
            .normalize();
        // THE PLANETRISE (docs/ODYSSEY_INTO_SPACE_2026-10.md §4). The Earth's limb always lies below
        // the level and the giant's seat above it, so before it rises the giant hangs at ONE point
        // `riseDeg` straight below its seat, seen from the rail at the rise's middle, behind the
        // limb. It rises on one arc about that rail point to its seat (`orbitEarthAt().planetRise`),
        // turned with the arc so it looks as it will hang, and never moves again.
        const R = ORBIT_EARTH_SCHEDULE;
        resolveSpineFramePoint(
            ch6Start + span * ((R.rise[1] - R.rise[0]) / 2),
            { along: 0, up: 0, right: 0 },
            _heroPlaces.planetRiseCentre,
        );
        _toRail.copy(_heroPlaces.planet).sub(_heroPlaces.planetRiseCentre);
        _heroPlaces.planetRiseAxis.crossVectors(_toRail, SPINE_WORLD_UP).normalize();
        resolvePlanetRisePlace(_heroPlaces, 0, _heroPlaces.planetBelow);
        _heroPlaces.curve = curve;
        _heroPlaces.key = key;
        _heroPlaces.revision += 1;
    }
    return _heroPlaces;
}

/**
 * The omen's group scale at `toLock` (0 = the boundary, 1 = the hand-over): ch7's shadow radius
 * at the lock, 1 / (1 + approachGain) of it at the boundary, smoothstepped between.
 */
/**
 * THE OMEN BENDS THE SKY (2026-10-19). The black hole used to be painted on an unbent sky until
 * the 6->7 seam switched chapter 7's lens on. It now publishes a lens target from its place on the
 * rail (lensWorldPos, read by the board): the stars and the Milky Way are pulled round it more as
 * it nears — strength from `from` to `to` across the chapter's progress to the lock, where it
 * holds while chapter 7's lens rises past it across the seam — over a shorter `reach` than
 * chapter 7's, so the orbs in the middle of the frame are left alone.
 */
export const OMEN_LENS = Object.freeze({
    from: 0.15,
    // Just under chapter 7's at its first frame (~0.49 with the music at rest), which then takes over.
    to: 0.45,
    reach: 0.6,
});

export function resolveOmenSpineScale(toLock) {
    const lockScale = GARGANTUA_LOCK.shadowRadius / OMEN_SHADOW_RADIUS;
    return lockScale / (1 + OMEN_SPINE_ANCHOR.approachGain * (1 - smoothstep01(toLock)));
}

// B3 (Overdraw) — hard caps on the nebula billboard tiers. The wispy nebula is a
// fill-rate multiplier (many large overlapping additive quads), so the COUNT is capped
// independently of the preset `particleCount` so high tiers can't scale the cloud into a
// heavy overdraw stack. "Fewer, bigger" reads the same as "many, faint" but costs less
// overdraw — see ODYSSEY_PERFORMANCE_OPTIMIZATION_PLAN.md §3b "fewer-bigger additive layers".
const NEBULA_NEAR_CAP = 110;
const NEBULA_FAR_CAP = 90;

// B-COSMIC-DUST — caps on the DENSE drifting mote field. These are SMALL hard-cored
// motes (not big soft fill), so they tolerate far higher counts than the wispy nebula
// before overdraw bites — but still capped so a high `particleCount` preset can't
// runaway the instance count. Two tiers (near brighter, far dimmer) give parallax depth.
const DUST_NEAR_CAP = 650;
const DUST_FAR_CAP = 800;

// ── THE STARFIELD (masterpiece pass, 2026-10) ────────────────────────────────────────
// The two shells used to sit at r 200-330 / 120-190 around the chapter centre — NEARER than
// every hero (750-1260 u) and every nebula (z -300..-1390), so stars drew IN FRONT of the gas
// and the planet, and with billboardWorld facing the world origin rather than the camera
// most of them rendered as edge-on slivers. They now live on deep shells just inside the
// 2400 u dome (behind everything), are billboarded in their own frame, and are sized for
// that distance (a 3-8 px quad around a 1-2 px core). A share of the far tier is pulled
// into the dome's galactic plane so the sky has a Milky Way, not an even sprinkle.
export const CH6_STARFIELD = Object.freeze({
    far: Object.freeze({
        radiusMin: 1950, radiusSpan: 330, sizeBase: 6, sizeSpan: 13, perParticle: 5.5, min: 600,
    }),
    near: Object.freeze({
        radiusMin: 1700, radiusSpan: 220, sizeBase: 9, sizeSpan: 22, perParticle: 1.1, min: 160,
    }),
    // Share of the far tier seated in the galactic band, and the band's half-thickness.
    bandShare: 0.45,
    bandSigma: 0.09,
    // The dome bake's galactic lane axis — the SAME constant, so glow and stars are one band.
    bandAxis: GALACTIC_BAND_AXIS,
    // Diffraction spikes are the brightest class's signature only (coreGain ≥ this).
    spikeCoreGain: 1.15,
});

export const COSMIC_ENTRY_CONTINUITY_SETTINGS = Object.freeze({
    starRevealStart: 0.04,
    starRevealEnd: 0.28,
    heroRevealStart: 0.12,
    heroRevealEnd: 0.36,
    nebulaRevealStart: 0.24,
    nebulaRevealEnd: 0.58,
    clutterRevealStart: 0.22,
    clutterRevealEnd: 0.5,
    destinationFloor: 0.16,
    starFloor: 0.08,
});

/**
 * DEEP SPACE, ONE THING AT A TIME (2026-10-24, step 5 of docs/ODYSSEY_INTO_SPACE_2026-10.md).
 * Past the 5->6 boundary the Earth's aurora is up and the ringed giant rises over its edge
 * (composition/odyssey-orbit-earth.js) until ~0.15 of the chapter, and the dome's Milky Way, the
 * gas and the black hole's light all used to arrive in the same 0.005 of p under them, on the
 * space gate. Each now comes up in clear sky after the one before, as the Earth falls away: the
 * Milky Way (the dome's painted cosmos, and the far star tier seated in its band), then the gas
 * (the nebula field and sprites, and the disk light that paints them), then the black hole's
 * light (its disk, rings and lens; its shadow is there from the boundary, a void at the rail's
 * end). Fractions of chapter 6's span past the boundary, so a re-layout carries them. The space
 * gate still decides whether space is drawn at all; these only stage what is in it.
 */
export const DEEP_SPACE_BEATS = Object.freeze({
    milkyWay: Object.freeze([0.15, 0.29]),
    nebula: Object.freeze([0.24, 0.40]),
    hole: Object.freeze([0.30, 0.58]),
});

const DEEP_SPACE_WHOLE = Object.freeze({ milkyWay: 1, nebula: 1, hole: 1 });

/**
 * How far each deep-space beat has come at journey progress `progress` (0..1 each); all 1
 * without a layout.
 * @param {number} progress global journey progress
 * @param {number[]} chapterPositions the live chapter boundaries
 * @returns {{ milkyWay: number, nebula: number, hole: number }}
 */
export function resolveDeepSpaceBeats(progress, chapterPositions) {
    const b = chapterPositions?.[5];
    const c = chapterPositions?.[6];
    if (!Number.isFinite(progress) || !Number.isFinite(b) || !Number.isFinite(c) || c <= b) {
        return DEEP_SPACE_WHOLE;
    }
    const span = c - b;
    const at = ([from, to]) => rampBetween(progress, b + span * from, b + span * to);
    return {
        milkyWay: at(DEEP_SPACE_BEATS.milkyWay),
        nebula: at(DEEP_SPACE_BEATS.nebula),
        hole: at(DEEP_SPACE_BEATS.hole),
    };
}

function smoothstep01(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}

function rampBetween(value, start, end) {
    return smoothstep01((value - start) / Math.max(1e-5, end - start));
}

/**
 * Resolve the two GLOBAL-progress gates that stage the Sky -> Space hand-off.
 *
 * `earthReveal` fades the hero gas giant up during the Ch5 summit, while the sky is
 * still bright; `spaceReveal` holds everything else (stars, black hole, nebula, dust,
 * lights) at zero until the camera is actually past the boundary, so the early ignite
 * cannot leak deep-space clutter into the daylight frame.
 *
 * `spaceReveal` is 0 through ALL of chapter 5 (not just the summit window — the manager draws
 * ch6 before the window opens) and ramps in past the boundary; it is 1 outside chapter 5 so
 * headless callers that pass a chapter-local progress (no camera) behave exactly as before.
 *
 * @param {number} progress global path progress 0..1
 * @param {number} ch5Start global progress where chapter 5 begins
 * @param {number} ch6Start global progress where chapter 6 begins (the Space boundary)
 * @param {number} ch7Start global progress where chapter 7 begins
 * @param {{chapterLocal?: boolean}} [opts] `chapterLocal`: `progress` is CHAPTER-LOCAL (headless
 *   callers with no camera pass one), so the chapter-5 gate cannot apply to it
 * @returns {{earthReveal: number, spaceReveal: number, summitStart: number, summitEnd: number}}
 */
export function resolveSummitEarthStaging(progress, ch5Start, ch6Start, ch7Start, opts = {}) {
    if (!Number.isFinite(progress) || !Number.isFinite(ch5Start) || !Number.isFinite(ch6Start)
        || ch6Start <= ch5Start) {
        return {
            earthReveal: 0, spaceReveal: 1, summitStart: Number.NaN, summitEnd: Number.NaN,
        };
    }
    const skySpan = ch6Start - ch5Start;
    const summitStart = ch6Start - skySpan * SUMMIT_EARTH_REVEAL.startBeforeBoundary;
    const summitEnd = ch6Start - skySpan * SUMMIT_EARTH_REVEAL.endBeforeBoundary;
    const spaceSpan = (Number.isFinite(ch7Start) && ch7Start > ch6Start)
        ? ch7Start - ch6Start
        : 0.167;
    const gateEnd = ch6Start + spaceSpan * SUMMIT_EARTH_REVEAL.spaceGateBand;

    const earthReveal = rampBetween(progress, summitStart, summitEnd);
    // THE SPACE GATE IS SHUT THROUGH ALL OF CHAPTER 5 (owner report 2026-10-02: "suddenly the
    // sky turns black, it pops back to sky colors and then we get into space"). It used to be
    // shut only inside the summit window and returned 1 — FULL SPACE — below it, on the belief
    // that "the manager keeps the chapter at zero opacity anyway" there. That stopped being true
    // when the summit window was retimed later (0.41 -> 0.28) and the manager's ch6 ignite was
    // not: from p 0.572 the manager drew ch6 with its void sky at full reveal, so a hard-edged
    // black backdrop covered the daylight sky (0.59 -> 0.64), then flipped back to blue the frame
    // the summit window opened. Now: 0 from ch5's start to the boundary, ramping in over the gate
    // after it; 1 outside chapter 5 (headless callers with a chapter-local progress, other acts).
    const windowStart = opts.chapterLocal ? summitStart : ch5Start;
    const spaceReveal = (progress >= windowStart && progress < gateEnd)
        ? rampBetween(progress, ch6Start, gateEnd)
        : 1;

    return {
        earthReveal, spaceReveal, summitStart, summitEnd,
    };
}

export function resolveCosmicEntryContinuity(progress) {
    const t = THREE.MathUtils.clamp(progress ?? 0, 0, 1);
    const settings = COSMIC_ENTRY_CONTINUITY_SETTINGS;
    const starReveal = settings.starFloor
        + (1 - settings.starFloor) * rampBetween(t, settings.starRevealStart, settings.starRevealEnd);
    const heroReveal = rampBetween(t, settings.heroRevealStart, settings.heroRevealEnd);
    const destinationReveal = settings.destinationFloor
        + (1 - settings.destinationFloor) * heroReveal;
    const nebulaReveal = rampBetween(t, settings.nebulaRevealStart, settings.nebulaRevealEnd);
    const clutterReveal = rampBetween(t, settings.clutterRevealStart, settings.clutterRevealEnd);

    return {
        starReveal,
        heroReveal,
        destinationReveal,
        nebulaReveal,
        clutterReveal,
    };
}

function setOpacityScale(root, scale, chapterOpacity = 1) {
    if (!root) return;
    const opacity = THREE.MathUtils.clamp(scale, 0, 1)
        * THREE.MathUtils.clamp(chapterOpacity, 0, 1);
    // Fully-faded content is SKIPPED, not drawn at alpha 0. This matters now that the
    // 5→6 early ignite makes the whole chapter present (and therefore drawable) across
    // the Ch5 summit while only the earth is allowed to show: without this the nebula
    // and dust billboard stacks would pay their full fill cost for nothing. The material
    // opacities are still written every call so nothing can pop back at a stale value.
    //
    // ⚠️ THE `material.opacity` WRITE BELOW IS A DEAD WRITE UNLESS THE MATERIAL'S
    // `opacityNode` READS `materialOpacity` BACK. In r181 NodeMaterial resolves alpha as
    // `this.opacityNode ? float(this.opacityNode) : materialOpacity` (NodeMaterial.js:872),
    // so ASSIGNING an opacityNode REPLACES the uniform this function drives. Every
    // opacityNode in this module therefore ends in `.mul(materialOpacity)`, and
    // cosmic-expanse-environment.test.js pins that so a new material cannot opt out.
    //
    // MEASURED, 2026-08-16 (Act II->Space §8.4): while the re-arm was missing, the ONLY
    // live effect of this whole function was the `root.visible` threshold on the next
    // line — a binary flip at 0.2%. The seam metric proved it: across a 10x change in
    // `spaceReveal` (0.107 -> 1.0 at p=0.7441..0.7621) mean frame luma moved 41.5 -> 43.9,
    // i.e. not at all. Widening the space gate 0.06 -> 0.16 changed the pop by +1.8 luma
    // because the ramp was never reaching a fragment.
    root.visible = opacity > 0.002;
    root.traverse((child) => {
        // FADE-EXEMPT meshes (the omen's shadow) are opaque occluders whose visibility the
        // chapter drives itself; flipping them transparent is what let stars through the hole.
        if (child.userData?.odysseyFadeExempt) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
            if (!material || typeof material.opacity !== 'number') return;
            if (material.userData.baseOpacity === undefined) {
                material.userData.baseOpacity = material.opacity;
            }
            material.transparent = true;
            material.opacity = material.userData.baseOpacity * opacity;
        });
    });
}

// ── AMBIENT CORRIDOR FRAME ───────────────────────────────────────────────────────
// The nebula tiers, dust tiers, streak motes and asteroid garland are all authored the
// same way: spread in local x/y, depth running along local -Z. That assumes a -Z
// corridor, but chapter 6 travels +X/+Y — so measured against the shipped build those
// fields sat 43-84 deg off the camera's forward ray. The camera flew down an empty lane
// with the whole cloud mass off to one side.
//
// Rather than re-author every field's spans, put them under ONE group whose origin sits
// on the camera's travel and whose -Z points down the chapter corridor. Every authored
// parameter then means what it says. Re-measured with this frame, the same fields land
// 1-14 deg off-axis. The chapter chord is used as the corridor axis (7.4 deg off the
// mean camera forward — immaterial for fields that subtend 30+ deg) so this stays
// correct if the spline is re-authored again.
const CORRIDOR_BACKSET = 40;
const CORRIDOR_LOCAL_FORWARD = new THREE.Vector3(0, 0, -1);
const PATH_UP = new THREE.Vector3(0, 1, 0);

/**
 * Local-space frame for chapter 6's ambient fields.
 * @param {{start: THREE.Vector3, end: THREE.Vector3}|null} chapterRange
 * @returns {{origin: THREE.Vector3, forward: THREE.Vector3, quaternion: THREE.Quaternion}}
 */
export function resolveCosmicCorridorFrame(chapterRange) {
    const forward = new THREE.Vector3(0, 0, -1);
    if (chapterRange?.start && chapterRange?.end) {
        forward.copy(chapterRange.end).sub(chapterRange.start);
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
    }
    const quaternion = new THREE.Quaternion().setFromUnitVectors(CORRIDOR_LOCAL_FORWARD, forward);
    // The eye trails the path by followDistance, so the corridor origin sits slightly
    // BEHIND the chapter's mid point (which is the group origin) — that centres the
    // fields on the camera's travel rather than on the rail.
    const origin = forward.clone().multiplyScalar(-CORRIDOR_BACKSET);
    return { origin, forward, quaternion };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

// ── WAVE 0 BISECT LEVERS (docs/ODYSSEY_CH6_SPACE_OVERHAUL_PLAN_2026-08.md §5) ──
// One URL flag per cost family so gpu-split can price the incumbent tier by tier:
//   ?odysseyCh6NoDome=1    — the per-fragment-FBM void sky dome
//   ?odysseyCh6NoHeroes=1  — the NDC-marched hero triad (black hole / gas giant / galaxy)
//   ?odysseyCh6NoNebula=1  — both additive FBM nebula tiers + the pillar
//   ?odysseyCh6NoDust=1    — dust tiers + suction debris + streak motes
//   ?odysseyCh6NoStars=1   — both instanced starfield tiers
//   ?odysseyCh6NoAurora=1  — the hero's auroral crown, BOTH halves (Wave 5); the crown is
//                            opt-in since the 2026-10-20 ringed giant (?odysseyCh6GiantAurora=1)
//   (`?odysseyCh6LegacyKeyFrame=1` is RETIRED, 2026-10: the nebula masses are emissive gas
//    now and have no key light whose frame could slip.)
// Polarity: every flag REMOVES its tier, so `baseline` is the shipped chapter and each
// differential is that tier's own cost (draws + fill + vertex + pipeline — the tier is
// never built, the `no-water` lever shape). The asteroid garland (12 opaque instances)
// and the aurora bridge (3 curtains) are deliberately unlevered: both are below the
// 65.536 µs timer tick on Lane A and the garland is the chapter's on-law template.
function readCh6UrlFlag(name) {
    if (typeof window === 'undefined') return false;
    try {
        const value = new URLSearchParams(window.location?.search || '').get(name);
        return value === '1' || value === 'true';
    } catch {
        return false;
    }
}

function resolveCh6BisectLevers() {
    return {
        dome: !readCh6UrlFlag('odysseyCh6NoDome'),
        heroes: !readCh6UrlFlag('odysseyCh6NoHeroes'),
        nebula: !readCh6UrlFlag('odysseyCh6NoNebula'),
        dust: !readCh6UrlFlag('odysseyCh6NoDust'),
        stars: !readCh6UrlFlag('odysseyCh6NoStars'),
        aurora: !readCh6UrlFlag('odysseyCh6NoAurora'),
    };
}

export function createCosmicExpanseEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'cosmic-expanse-environment';
    group.userData.chapterId = 6;
    group.userData.yStart = COSMIC_EXPANSE_CONFIG.yStart;
    group.userData.yEnd = COSMIC_EXPANSE_CONFIG.yEnd;
    const chapterRange = getChapterPathRange(6);
    const fallbackCenterY = (COSMIC_EXPANSE_CONFIG.yStart + COSMIC_EXPANSE_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    // TSL uniform nodes (expose `.value`, so the existing update() ticks them
    // unchanged). Shared into every TSL builder + billboard material so the whole
    // chapter animates from one clock.
    const uniforms = {
        uTime: uniform(0),
        uEnergy: uniform(0.3),
        // B3b — chapter-progress omen (0 at chapter entry → 1 at the 6→7 seam). Drives
        // the BH ever-present loom (scale/z/y), the hero-triad framing march (planet +
        // galaxy positions), and the one-time hero nebula PILLAR reveal. A plain scalar
        // ticked from camera progress in update() — no per-frame allocation.
        uApproach: uniform(0),
        // The void dome is deliberately held out of the first Sky→Space hand-off beats
        // so Chapter 5's aurora can pass overhead before hard vacuum takes the frame.
        uVoidSkyOpacity: uniform(0),
        // ...and its painted cosmos (the Milky Way) comes up on its own beat (DEEP_SPACE_BEATS).
        uVoidSkyGlow: uniform(1),
    };
    group.userData.uniforms = uniforms;
    // The omen's lens target (see OMEN_LENS): world centre + lensRadius / lensStrength / lensReach.
    group.userData.lensWorldPos = new THREE.Vector3();
    group.userData.lensWorldPos.lensStrength = 0;

    // Ambient fields (nebula / dust / streaks / asteroids) hang off this so their
    // authored -Z depth axis actually runs down the chapter corridor. Heroes are NOT
    // parented here — they are solved directly in group-local space (see APPROACH).
    const corridorFrame = resolveCosmicCorridorFrame(chapterRange);
    const corridor = new THREE.Group();
    corridor.name = 'cosmic-corridor';
    corridor.position.copy(corridorFrame.origin);
    corridor.quaternion.copy(corridorFrame.quaternion);
    group.add(corridor);
    group.userData.corridor = corridor;
    group.userData.corridorFrame = corridorFrame;

    const particleCount = options.particleCount || 1000;
    const bisect = resolveCh6BisectLevers();
    group.userData.ch6Bisect = bisect;

    // 0. Nebula void dome. The BAKED dome ships (Wave 2 swap); the retired FBM dome
    // stays restorable behind `?odysseyCh6ProceduralDome=1` (ADR-0015 escape hatch,
    // gpu-split configuration `ch6-procedural-dome` — its differential is the cost of
    // ADDING the old dome back).
    let voidSky = null;
    if (bisect.dome) {
        voidSky = readCh6UrlFlag('odysseyCh6ProceduralDome')
            ? createVoidSky(uniforms)
            : createBakedVoidSky(uniforms);
    }
    if (voidSky) {
        group.add(voidSky);
        group.userData.voidSky = voidSky;
    }

    // 1. The black hole — the act's DESTINATION OMEN. Starts far/small in the upper
    // third and LOOMS larger as the camera approaches the 6→7 seam (driven by uApproach
    // in update(): scale 1.25→3.0, z -900→-640, y 20→70 so it rides the upper third and
    // never sits as a tiny dot on the bottom edge — the #1 Space hero fix). Initial pose
    // matches APPROACH.*A so the first frame / smoke test agrees with the march.
    const blackHole = bisect.heroes ? createBlackHole(uniforms) : null;
    if (blackHole) {
        blackHole.position.set(APPROACH.bhXa, APPROACH.bhYa, APPROACH.bhZa);
        blackHole.scale.setScalar(APPROACH.bhScaleA);
        group.add(blackHole);
        group.userData.blackHole = blackHole;
    }

    // 1b. Hero gas giant
    const heroPlanet = bisect.heroes ? createHeroPlanet(uniforms, bisect) : null;
    if (heroPlanet) {
        group.add(heroPlanet);
        group.userData.heroPlanet = heroPlanet;
    }

    // 1c. Distant galaxy / quasar — a sharp, persistent deep-space focal anchor
    // up and to the right of the hero, so Space always has a bright far point.
    const galaxy = bisect.heroes ? createDistantGalaxy(uniforms) : null;
    if (galaxy) {
        group.add(galaxy);
        group.userData.galaxy = galaxy;
    }

    // 2. Matter spiralling into the void (aligned to the disk plane). Tracks the BH
    // omen's transform each frame in update() so the infall stays seated on the hole as
    // it looms (starts at the BH entry pose).
    const debris = bisect.dust ? createSuctionParticles(uniforms, particleCount) : null;
    if (debris) {
        // Initial pose = the BH entry pose (APPROACH.*A) rather than a copy of the hole's
        // transform, so the infall stays seated even when the hero tier is bisected out
        // (update() only re-seats it when BOTH exist).
        debris.position.set(APPROACH.bhXa, APPROACH.bhYa, APPROACH.bhZa);
        debris.rotation.x = -1.12;
        debris.scale.setScalar(APPROACH.bhScaleA);
        group.add(debris);
        group.userData.debris = debris;
    }

    // 6. Crisp pinpoint starfield — TWO depth tiers on deep shells BEHIND everything (see
    // CH6_STARFIELD): a dense far field with a galactic band, static, and a sparser, brighter,
    // gently twinkling near tier whose rare B stars carry the diffraction spikes.
    const starsFar = !bisect.stars ? null : createVoidStars(uniforms, Math.max(
        CH6_STARFIELD.far.min,
        Math.floor(particleCount * CH6_STARFIELD.far.perParticle),
    ), {
        ...CH6_STARFIELD.far,
        coreExp: 2.6,
        twinkle: false,
        bandShare: CH6_STARFIELD.bandShare,
        name: 'void-stars-far',
    });
    if (starsFar) {
        group.add(starsFar);
        group.userData.starsFar = starsFar;
    }

    const starsNear = !bisect.stars ? null : createVoidStars(uniforms, Math.max(
        CH6_STARFIELD.near.min,
        Math.floor(particleCount * CH6_STARFIELD.near.perParticle),
    ), {
        ...CH6_STARFIELD.near,
        // B3b — crisper punch-through near tier so stars read OVER the brightest cloud:
        // bigger base, hotter core, a small constant emissive floor, wider diffraction.
        coreExp: 2.0,
        coreMult: 1.45,
        spikeWidth: 11.0,
        emissiveFloor: 0.06,
        brightWeight: 0.7,
        name: 'void-stars-near',
    });
    if (starsNear) {
        group.add(starsNear);
        group.userData.starsNear = starsNear;
    }

    // 2b. Nebula volume — WISPY, color-varied, parallax-tiered (B3b). The flat-pink
    // smoke that dominated 75% of the chapter is broken into fewer/smaller/dimmer near
    // wisps on a cool+warm palette (true-black gaps), PLUS a slower-drifting FAR tier so
    // camera travel reveals parallax depth (near + far + void-dome backstop = 3 planes).
    // B3 (Overdraw): count CAPPED + per-sprite size/alpha nudged up so the same cloud mass
    // reads with ~⅔ the billboards (fewer-bigger — less overdraw, no uniform-haze regression).
    // WAVE 3 SWAP: the sculpted nebula FIELD ships; the additive sprite tiers + the
    // billboard pillar are the retired incumbent, restorable as a TRUE swap (field
    // off, sprites on) via `?odysseyCh6NebulaSprites=1` — gpu-split configuration
    // `ch6-nebula-sprites`, so the differential IS the swap's price in one window.
    const nebulaSprites = readCh6UrlFlag('odysseyCh6NebulaSprites');
    const nebulaField = (bisect.nebula && !nebulaSprites) ? createNebulaFieldTSL({
        uTime: uniforms.uTime,
        // The board's quality preset (seamless pass): Medium/Low trim the gas's finest octaves.
        qualityTier: options.qualityTier,
    }) : null;
    if (nebulaField) {
        corridor.add(nebulaField.mesh);
        group.userData.nebulaField = nebulaField.mesh;
    }

    const nebulaVolume = !(bisect.nebula && nebulaSprites) ? null : createNebulaVolume(
        uniforms,
        Math.min(NEBULA_NEAR_CAP, Math.max(30, Math.floor(particleCount * 0.26))),
        {
            sizeBase: 22,
            sizeSpan: 52,
            spanX: 620,
            spanY: 300,
            zBase: -640,
            zSpan: 520,
            alphaBase: 0.12,
            driftScale: 1.0,
            name: 'nebula-volume-points',
        },
    );
    if (nebulaVolume) {
        corridor.add(nebulaVolume);
        group.userData.nebulaVolume = nebulaVolume;
    }

    // 2c. FAR nebula tier — large, very dim, deep, drifting much slower for parallax.
    // B3 (Overdraw): the far tier's huge sprites (the biggest fill cost) get the deepest
    // count cut + cap; size/alpha bumped slightly so the deep backdrop body still reads.
    const nebulaFar = !(bisect.nebula && nebulaSprites) ? null : createNebulaVolume(
        uniforms,
        Math.min(NEBULA_FAR_CAP, Math.max(20, Math.floor(particleCount * 0.3))),
        {
            sizeBase: 72,
            sizeSpan: 140,
            spanX: 900,
            spanY: 520,
            zBase: -1100,
            zSpan: 500,
            alphaBase: 0.06,
            driftScale: 0.25,
            detailOctaves: 4,
            name: 'nebula-volume-far',
        },
    );
    if (nebulaFar) {
        corridor.add(nebulaFar);
        group.userData.nebulaFar = nebulaFar;
    }

    // 2e. DENSE drifting mote field (the user's "more particles" — murmuration /
    // blood-moon density). TWO tiers for parallax: a NEAR tier of brighter iridescent
    // motes that fills the corridor with twinkling life, plus a FAR tier of fine dim dust
    // for deep parallax. Both INSTANCED + CAPPED + scaled off particleCount; the near tier
    // drifts faster than the far for a strong parallax read as the camera dollies.
    const dustNear = !bisect.dust ? null : createCosmicDust(
        uniforms,
        Math.min(DUST_NEAR_CAP, Math.max(120, Math.floor(particleCount * 0.40))),
        {
            sizeBase: 0.7,
            sizeSpan: 2.2,
            spanX: 520,
            spanY: 320,
            zBase: -260,
            zSpan: 460,
            alphaBase: 0.55,
            driftScale: 1.0,
            driftAmp: 12.0,
            sparkRatio: 0.26,
            name: 'cosmic-dust-near',
        },
    );
    if (dustNear) {
        corridor.add(dustNear);
        group.userData.dustNear = dustNear;
    }

    const dustFar = !bisect.dust ? null : createCosmicDust(
        uniforms,
        Math.min(DUST_FAR_CAP, Math.max(160, Math.floor(particleCount * 0.5))),
        {
            sizeBase: 0.5,
            sizeSpan: 1.4,
            spanX: 820,
            spanY: 520,
            zBase: -560,
            zSpan: 760,
            alphaBase: 0.34,
            driftScale: 0.38,
            driftAmp: 7.0,
            sparkRatio: 0.16,
            name: 'cosmic-dust-far',
        },
    );
    if (dustFar) {
        corridor.add(dustFar);
        group.userData.dustFar = dustFar;
    }

    // 2d. Hero nebula PILLAR — a one-time Pillars-of-Creation reveal off the mid-act
    // path, faded in via uApproach (mid-chapter beat). Capped to ONE.
    const nebulaPillar = (bisect.nebula && nebulaSprites) ? createNebulaPillar(uniforms, corridorFrame) : null;
    if (nebulaPillar) {
        group.add(nebulaPillar);
        group.userData.nebulaPillar = nebulaPillar;
    }

    // 2f. ASTEROID GARLAND (creative plan asset 4): 12 dark silhouette rocks crossing
    // the corridor diagonally through the dead-air stretch (progress 0.35–0.65 of the
    // travel), staged UP-RIGHT of the rail with the hero march. Orange accretion rim
    // toward the hole + violet fill come free from the chapter's two lights. Two or
    // three pass within ~30 units of the camera corridor for genuine scale shock.
    const asteroids = createAsteroidGarland();
    corridor.add(asteroids);
    group.userData.asteroids = asteroids;

    // 2g. AURORA→FILAMENT BRIDGE (creative plan asset 8, Transition In beat 3): the
    // final aurora curtains carried INTO the chapter — stretched filaments that recolor
    // green → crimson (#3DFF8E → #C71F37 → #E8485C) across the entry and dissolve by
    // ~18% local progress, becoming the first crimson nebula filaments.
    // 2h. STREAK-MOTE TIER (creative plan asset 6): a sparse rail-hugging tier of
    // slightly elongated quads that sell forward speed through the long middle act.
    const streakMotes = bisect.dust ? createStreakMotes(uniforms, 90) : null;
    if (streakMotes) {
        corridor.add(streakMotes);
        group.userData.streakMotes = streakMotes;
    }

    // The comet (Wave 5): the reef's authored moment — unlevered, two opaque draws.
    const comet = createComet();
    corridor.add(comet);
    group.userData.comet = comet;

    // (The aurora bridge, a curtain band round the eye, lived here until 2026-10-24: the aurora is
    // now the Earth below's, on its night side — composition/odyssey-orbit-earth.js.)
    // Buckets tolerate bisected-out tiers: filter(Boolean) so update()'s forEach walks
    // only what was actually built.
    group.userData.entryContinuity = {
        // The near tier is on its own key: STARS BEFORE DARK stages it against global
        // progress before the boundary, which the far tier must never join (a whole
        // starfield in daylight reads as noise; a few bright early stars read as dusk).
        stars: [starsFar].filter(Boolean),
        starsNear: [starsNear].filter(Boolean),
        destination: [blackHole].filter(Boolean),
        // The hole's debris glitters only in its light, so it comes up with that (DEEP_SPACE_BEATS).
        debris: [debris].filter(Boolean),
        // EARTH AT THE SUMMIT: the gas giant is staged on its own GLOBAL-progress reveal
        // so it can rise over the still-bright Ch5 sky (see SUMMIT_EARTH_REVEAL). Every
        // other Space element — the galaxy included — stays behind the post-boundary
        // gate, so nothing but the earth bleeds into the daylight frame.
        earth: [heroPlanet].filter(Boolean),
        heroes: [galaxy].filter(Boolean),
        nebula: [nebulaVolume, nebulaFar].filter(Boolean),
        clutter: [dustNear, dustFar, asteroids].filter(Boolean),
        // The speed streaks belong to THE PULL, not to the whole chapter: they used to rush the
        // lens from the first frame of space, with the camera parked in orbit.
        streaks: [streakMotes].filter(Boolean),
    };

    // Lighting (ominous accretion key)
    setupCosmicLighting(group);

    // Anchor the whole environment to the path's FULL centre (x/y/z), not just Y,
    // so the void dome / black hole / hero planet stay locked to the path corridor
    // and the path never clips out the side of the chapter geometry.
    if (chapterRange?.center) {
        group.position.set(chapterRange.center.x, chapterCenterY, chapterRange.center.z);
    } else {
        group.position.y = chapterCenterY;
    }

    // WAVE 5 — FOG OFF for the WHOLE chapter, not just the planet.
    //
    // The summit-earth fix (see createHeroPlanetNebulaAnchor) disabled fog on the planet
    // anchor and stopped there, so everything else in Space kept scene fog switched on. The
    // board rewrites scene.fog every frame from the chapter profile and FogExp2 is
    // 1 - exp(-(d*z)^2), so at Space's own density 0.0006 the accretion disk and lensing
    // shell — 2020 u out, and the chapter's HERO — were rendering 77% in fog colour. During
    // the 5->6 handover it is worse: the early-ignite path above deliberately makes this whole
    // chapter drawable across the Ch5 summit, where density 0.0022 saturates that distance to
    // 100%. Nothing in Space is meant to be atmospheric; it is a vacuum.
    //
    // This never showed up in the playground because the playground has no scene.fog at all,
    // which is the exact "right in isolation, washed in-game" signature this trap always has.
    // Guarded by tests/unit/odyssey-chapter-fog-optout.test.js, which walks the built
    // environment rather than the source — a traverse only covers what is parented when it
    // runs, so pinning the call site would not have caught this.
    group.traverse((child) => {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
            if (material) material.fog = false;
        });
    });

    return group;
}

function createBakedVoidSky(uniforms) {
    // WAVE 2 (Space overhaul): the shipped dome. One texture fetch per fragment from
    // a seeded CPU bake, replacing the ~15 per-fragment FBM fields that Wave 0
    // measured at 13.37 ms of the 17.04 ms Lane B reef frame (78%, plus the whole
    // frame tail). Same contract as the FBM dome: renderOrder −100, BackSide,
    // depthWrite off, uVoidSkyOpacity staging.
    const { mesh } = createBakedVoidSkyTSL(
        uniforms.uTime,
        uniforms.uEnergy,
        uniforms.uVoidSkyOpacity,
        {},
        uniforms.uVoidSkyGlow,
    );
    return mesh;
}

function createVoidSky(uniforms) {
    // TSL builder: FBM galactic backdrop (-100 backstop). Returns { mesh } already
    // positioned at renderOrder -100 with BackSide / depthWrite off.
    const { mesh } = createVoidSkyTSL(uniforms.uTime, uniforms.uEnergy, uniforms.uVoidSkyOpacity);
    return mesh;
}

function createBlackHole(uniforms) {
    // TSL builder: assembles the converted accretion disk + lensing shell with the
    // plain horizon / photon ring / glow rings. Returns { group, disk, lens }.
    const { group } = createBlackHoleTSL(uniforms.uTime, uniforms.uEnergy);
    group.userData.uniforms = uniforms;
    return group;
}

function createHeroPlanet(uniforms, bisect = {}) {
    // TSL builder: the ringed giant (odyssey-ringed-giant*.js). Returns { group, planet };
    // update() places it at its one world point. NO AURORAL CROWN since the 2026-10-20 overhaul:
    // on the ringed giant, lit amber by the hole and seen with its pole tipped toward the eye,
    // the green curtains stood off the north limb as flames (capture) and fought the chapter's
    // amber/violet. `?odysseyCh6GiantAurora=1` still builds it for comparison.
    const { group, planet } = createHeroPlanetTSL(uniforms.uTime, {
        aurora: bisect.aurora !== false && readCh6UrlFlag('odysseyCh6GiantAurora'),
    });
    group.position.set(APPROACH.planetA.x, APPROACH.planetA.y, APPROACH.planetA.z);
    group.scale.setScalar(APPROACH.planetA.s);
    group.userData.planet = planet;
    // FOG OFF — the reason the summit earth read as a pale ghost instead of a dark world.
    // This is a celestial body at effectively infinite distance, but it is a real mesh
    // ~1050 units out, and Chapter 5's bright daylight FogExp2 (density ~0.0024) fogs
    // that distance by ~99.8% — the planet was being painted almost entirely in sky
    // colour. Capture confirmed it: washed-out pale disc while the sky was bright, correct
    // moody banding once Space went dark and the fog with it. Disabling fog is what makes
    // the ask ("darker, and that we still see it") true against the daylight sky; it costs
    // nothing in Space, where there is no fog to lose.
    group.traverse((child) => {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
            if (material) material.fog = false;
        });
    });
    return group;
}

function createNebulaVolume(uniforms, count, opts = {}) {
    const {
        sizeBase = 18,
        sizeSpan = 42,
        spanX = 620,
        spanY = 300,
        zBase = -640,
        zSpan = 520,
        alphaBase = 0.10,
        driftScale = 1.0,
        // Creative plan item 6 (far-nebula blockiness, frames 10/12): the far tier's
        // huge sprites under-sample the FBM at 3 octaves, so the deep tier requests 4.
        detailOctaves = 2,
        name = 'nebula-volume-points',
    } = opts;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    // B3b — palette rebalanced AWAY from magenta so cool + warm coexist: one indigo,
    // one cobalt, one (single) magenta, one warm rust, PLUS teal + deep-indigo. This
    // makes the wisps color-varied (with true-black gaps) instead of a flat-pink wash.
    const palette = [
        new THREE.Color(0x6633ff), // indigo
        new THREE.Color(0x2f6bff), // cobalt
        new THREE.Color(0xff5fb0), // magenta (single)
        new THREE.Color(0xffa14a), // warm rust
        new THREE.Color(0x2fd0ff), // teal
        new THREE.Color(0x2a1a6a), // deep indigo
    ];

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        positions[stride] = (Math.random() - 0.5) * spanX;
        positions[stride + 1] = (Math.random() - 0.5) * spanY;
        positions[stride + 2] = zBase - Math.random() * zSpan;

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;

        sizes[index] = sizeBase + Math.random() * sizeSpan;
        phases[index] = Math.random() * Math.PI * 2;
    }

    // Instanced billboard quads (THREE.Points renders as 1px on WebGPU).
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aPhase: { array: phases, itemSize: 1 },
    });

    const time = uniforms.uTime;
    const aBase = attribute('aBase', 'vec3');
    const aColor = attribute('aColor', 'vec4');
    const aSize = attribute('aSize', 'float');
    const aPhase = attribute('aPhase', 'float');

    // Animate the soft-cloud CENTER (mirror the old GLSL vertex drift on position).
    const center = vec3(
        aBase.x.add(sin(time.mul(0.05).add(aPhase)).mul(6.0)),
        aBase.y.add(cos(time.mul(0.04).add(aPhase)).mul(4.0)),
        aBase.z,
    );

    // gl_PointSize ~4..90px → small world size; the perspective term is automatic.
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardLocal(center, aSize);

    // ── BLOOD-MOON WISP TEXTURE (adapted to TSL) ──────────────────────────────────
    // Each wisp used to be a flat radial-feather disc — the cause of the "flat pink
    // smoke" wash in the screenshots. We now give every sprite an INTERNAL domain-warped
    // FBM body (the blood-moon nebula technique): warp the sprite uv with a small FBM
    // offset, sample fbm for the gas body + ridged for fibrous strands, and light the
    // strand crests hot. The result is fibrous, billowing volume per sprite instead of a
    // soft blob — so far fewer, bigger sprites read as a rich cloud (perf-safe overdraw).
    // A per-instance phase seed (aPhase) decorrelates each sprite so they don't tile.
    const p = uv().sub(0.5);
    const dist = length(p);
    // Round soft envelope feathered to 0 before the quad edge (no square clip).
    const envelope = pow(oneMinus(dist.mul(2.0)).max(0.0), 1.7);
    const seed = aPhase.mul(3.17);
    // Domain warp the sample coord (the reference's "fluid billowy distortion"). Kept to
    // 2 octaves — the warp only needs low-frequency bend, and these run per-fragment over
    // big additive quads, so octave counts are held LOW to protect fill-rate (perf-safe).
    const warp = vec2(
        fbm3(vec3(p.mul(3.0).add(seed), time.mul(0.05)), 1),
        fbm3(vec3(p.mul(3.0).add(seed).add(7.0), time.mul(0.04).negate()), 1),
    ).sub(0.5).mul(0.55);
    const sp3 = vec3(p.mul(4.2).add(warp).add(seed), time.mul(0.03));
    // Gas body: thresholded FBM so the wisp has dark internal voids, not a solid fill.
    // 3 octaves — enough for fibrous structure without the full 5-octave fragment cost.
    const bodyRaw = fbm3(sp3, detailOctaves);
    const body = smoothstep(0.32, 0.78, bodyRaw);
    // Fibrous strands: ridged crests give the twisting filament structure.
    const strandRaw = ridged3(sp3.mul(0.9).add(4.0), detailOctaves);
    const strand = smoothstep(0.40, 0.80, strandRaw);
    // Hot incandescent strand cores (blood-moon volume highlight) — only the brightest
    // crest tips light up, kept small + warm so the cloud has bright filament cores.
    const core = pow(smoothstep(0.66, 0.9, strandRaw), 2.0);
    // Compose the wisp colour: the instance tint for the body, a warm-hot lift on the
    // strand cores. Capped well below 1 (additive, soft) — ACES + bloom downstream.
    const wispColor = aColor.mul(body.mul(0.7).add(strand.mul(0.5)))
        .add(vec3(1.0, 0.62, 0.5).mul(core).mul(0.5));
    material.colorNode = wispColor;
    // Density = envelope * (body + strands), so the sprite is fibrous + pocketed inside.
    // vAlpha breathes around alphaBase (kept faint) so wisps stay pocketed — variety +
    // parallax + internal structure, not density (never a uniform haze, never blows out).
    const density = envelope.mul(body.mul(0.7).add(strand.mul(0.5)).add(core).max(0.0));
    const breathe = alphaBase * 0.5;
    const vAlpha = varying(sin(time.mul(0.3).add(aPhase)).mul(breathe).add(alphaBase));
    // Cap opacity at 0.6 (additive, soft) so even stacked wisps never approach white
    // blowout — the new internal structure carries the richness, not raw opacity.
    material.opacityNode = clamp(density.mul(vAlpha).mul(2.0), 0.0, 0.6).mul(materialOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const points = new THREE.Mesh(geometry, material);
    points.name = name;
    // B3 (Overdraw / QW10): the nebula is a BOUNDED volume (not camera-locked), so give it
    // an explicit instance-cloud bounding sphere and re-enable frustum culling — three's
    // default boundingSphere is computed from the 1×1 base quad (origin-tiny) and would cull
    // the whole system the instant the camera looked away, so we must size it ourselves.
    // Centre = cloud centroid (drift is small + symmetric); radius covers the half-extents
    // plus the max sprite half-size + the per-frame drift so sprites never pop at the edge.
    const maxHalfSize = (sizeBase + sizeSpan) * 0.5;
    const cx = 0;
    const cy = 0;
    const cz = zBase - zSpan * 0.5;
    const hx = spanX * 0.5 + maxHalfSize + 6; // +6/+4 = the sin/cos centre drift below
    const hy = spanY * 0.5 + maxHalfSize + 4;
    const hz = zSpan * 0.5 + maxHalfSize;
    geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(cx, cy, cz),
        Math.sqrt(hx * hx + hy * hy + hz * hz),
    );
    points.frustumCulled = true;
    points.userData.driftScale = driftScale;
    return points;
}

// Where the pillar sits in the corridor frame: deep ahead, off to the LEFT, lifted.
// Tuned against the real camera: the column tracks 15 deg -> 39 deg off the forward
// ray across its reveal window (vs a ~49 deg horizontal half-FOV), so it is fully in
// frame from the moment it fades up and only drifts wide as the camera passes it.
const PILLAR_CORRIDOR_OFFSET = Object.freeze({ depth: 780, left: 230, lift: 160 });
// The new station is ~1.3x further out than the authored one, so the plane grows by
// the same factor: apparent size is unchanged, only the direction is fixed.
const PILLAR_SCALE = Object.freeze({ width: 260, height: 546 });
const _pillarScratch = new THREE.Vector3();
const _pillarRight = new THREE.Vector3();

function createNebulaPillar(uniforms, corridorFrame) {
    // Hero nebula PILLAR (one-time mid-chapter reveal), faded in by uApproach. A single
    // tall additive plane — capped to one (no per-frame alloc).
    //
    // Placed FROM the corridor frame rather than parented to it: a Pillars-of-Creation
    // column has to stand upright, and the corridor rotation would tilt it ~45 deg. So
    // take the corridor's deep-left station but keep world-vertical, yawing only enough
    // to face back down the corridor. Its authored local station (-170, 40, -600) sat
    // 58-94 deg off the camera's forward ray — on the opposite side from everything else.
    const { mesh } = createNebulaPillarTSL(uniforms.uTime, uniforms.uApproach);
    const frame = corridorFrame ?? resolveCosmicCorridorFrame(null);
    _pillarRight.crossVectors(frame.forward, PATH_UP).normalize();
    _pillarScratch.copy(frame.origin)
        .addScaledVector(frame.forward, PILLAR_CORRIDOR_OFFSET.depth)
        .addScaledVector(_pillarRight, -PILLAR_CORRIDOR_OFFSET.left);
    _pillarScratch.y += PILLAR_CORRIDOR_OFFSET.lift;
    mesh.position.copy(_pillarScratch);
    // Yaw-only billboard toward the corridor origin so the column stays vertical.
    mesh.rotation.y = Math.atan2(frame.origin.x - mesh.position.x, frame.origin.z - mesh.position.z);
    mesh.scale.set(PILLAR_SCALE.width, PILLAR_SCALE.height, 1);
    mesh.frustumCulled = false;
    return mesh;
}

function createSuctionParticles(uniforms, count) {
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const radii = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 0;

        phases[i] = Math.random() * Math.PI * 2;
        speeds[i] = 0.5 + Math.random() * 1.5;
        radii[i] = 30 + Math.random() * 55;
    }

    // Instanced billboard quads (THREE.Points renders as 1px on WebGPU).
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aPhase: { array: phases, itemSize: 1 },
        aSpeed: { array: speeds, itemSize: 1 },
        aRadius: { array: radii, itemSize: 1 },
    });

    const time = uniforms.uTime;
    const aBase = attribute('aBase', 'vec3');
    const aPhase = attribute('aPhase', 'float');
    const aSpeed = attribute('aSpeed', 'float');
    const aRadius = attribute('aRadius', 'float');

    // Matter spiralling into the void — mirror the old GLSL vertex displacement.
    const t = mod(time.mul(aSpeed).add(aPhase), 10.0);
    const progress = oneMinus(t.div(10.0)); // 1.0 (start) -> 0.0 (center)
    const r = aRadius.mul(progress);
    const angle = aPhase.add(progress.mul(24.0));
    const center = vec3(
        cos(angle).mul(r),
        sin(angle).mul(r).mul(0.32),
        aBase.z.add(oneMinus(progress).mul(6.0)),
    );

    // gl_PointSize (2 + progress*2)px → small world size; perspective is automatic.
    const size = progress.mul(0.5).add(0.5);
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardLocal(center, size);
    // Redshift as it falls in (blue -> orange-red).
    material.colorNode = mix(vec3(0.45, 0.65, 1.0), vec3(1.0, 0.3, 0.12), oneMinus(progress));
    // glow = pow(1 - dist*2, 1.4) round-discarded at dist > 0.5; alpha = progress.
    const dist = length(uv().sub(0.5));
    const glow = pow(oneMinus(dist.mul(2.0)).max(0.0), 1.4);
    material.opacityNode = glow.mul(progress).mul(materialOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const points = new THREE.Mesh(geometry, material);
    points.name = 'suction-particles';
    points.frustumCulled = false;
    return points;
}

function createVoidStars(uniforms, count, opts = {}) {
    const {
        radiusMin = CH6_STARFIELD.far.radiusMin,
        radiusSpan = CH6_STARFIELD.far.radiusSpan,
        sizeBase = CH6_STARFIELD.far.sizeBase,
        sizeSpan = CH6_STARFIELD.far.sizeSpan,
        coreExp = 2.6,
        coreMult = 1.15,
        spikeWidth = 14.0,
        emissiveFloor = 0.0,
        brightWeight = 0.0,
        // Far tier: static (a distant field does not visibly scintillate, and a static layer
        // under a twinkling one is what makes the twinkle read). Near tier: per-star twinkle.
        twinkle = true,
        bandShare = 0,
        name = 'void-stars',
    } = opts;

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count);
    // rgb = class colour x its emissive push, w = its core-exponent gain. The core gain
    // travels in the alpha slot rather than in a fifth instanced attribute ON PURPOSE:
    // this geometry already binds position/normal/uv + 4 instanced buffers, and 8 is the
    // vertex-buffer ceiling (see the note in odyssey-tsl-billboard.js about the
    // 6-attribute billboard that overflowed it).
    const colors = new Float32Array(count * 4);

    // WAVE 5 — THE STELLAR RAMP. Two hand-mixed palettes and a bare `Math.random() > 0.3`
    // split used to live here; see odyssey-stellar-ramp.js for why a quantised blackbody
    // ladder replaced them, and why the three per-class gains are the part that matters.
    // SEEDED (the same lesson the asteroid garland paid for in e9ccc0f6): under bare
    // Math.random the whole field re-rolled on every reload, so no two captures of this
    // chapter were ever comparable. `name` seeds it, so the near and far tiers differ.
    let rngState = 1013904223;
    for (let i = 0; i < name.length; i += 1) rngState = Math.imul(rngState ^ name.charCodeAt(i), 2654435761) >>> 0;
    const rng = () => {
        rngState = Math.imul(rngState ^ (rngState >>> 15), 2246822519);
        rngState = (rngState + 0x6d2b79f5) >>> 0;
        return ((rngState ^ (rngState >>> 13)) >>> 0) / 4294967296;
    };

    // Galactic-plane basis (n = plane normal; u, v span the plane).
    const n = new THREE.Vector3(...CH6_STARFIELD.bandAxis).normalize();
    const u = new THREE.Vector3(0, 1, 0).cross(n).normalize();
    const v = n.clone().cross(u).normalize();
    const dir = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
        if (rng() < bandShare) {
            // In the band: a random azimuth in the plane, a gaussian-ish latitude off it.
            const az = rng() * Math.PI * 2;
            const lat = ((rng() + rng() + rng()) / 3 - 0.5) * 2 * CH6_STARFIELD.bandSigma * 2.2;
            dir.copy(u)
                .multiplyScalar(Math.cos(az))
                .addScaledVector(v, Math.sin(az))
                .multiplyScalar(Math.cos(lat))
                .addScaledVector(n, Math.sin(lat))
                .normalize();
        } else {
            const theta = rng() * Math.PI * 2;
            const phi = Math.acos(2 * rng() - 1);
            dir.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
        }
        const r = radiusMin + rng() * radiusSpan;
        positions[i * 3] = r * dir.x;
        positions[i * 3 + 1] = r * dir.y;
        positions[i * 3 + 2] = r * dir.z;
        twinkles[i] = rng() * Math.PI * 2;

        // `brightWeight` (the near tier's punch dial) now biases the DRAW toward the hot
        // end of the ladder instead of toward a second flat palette: one extra sample,
        // keep the hotter of the two. Same knob, but it means something physical.
        let cls = pickStellarClass(rng);
        if (brightWeight > 0 && rng() < brightWeight) {
            const other = pickStellarClass(rng);
            if (other.kelvin > cls.kelvin) cls = other;
        }
        // Sparse big-star distribution: most stars tiny, a few large — squaring the
        // random keeps the field reading as fine pinpoints with rare bright anchors.
        // The class gain rides on top, so a rare M giant is genuinely the biggest thing
        // in the field and a B star the hardest.
        sizes[i] = (sizeBase + rng() * rng() * sizeSpan) * cls.sizeGain;
        colors[i * 4] = cls.color[0] * cls.emissive;
        colors[i * 4 + 1] = cls.color[1] * cls.emissive;
        colors[i * 4 + 2] = cls.color[2] * cls.emissive;
        colors[i * 4 + 3] = cls.coreGain;
    }

    // Instanced billboard quads (THREE.Points renders as 1px on WebGPU).
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aTwinkle: { array: twinkles, itemSize: 1 },
        aColor: { array: colors, itemSize: 4 },
    });

    const time = uniforms.uTime;
    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aTwinkle = attribute('aTwinkle', 'float');
    const aColor = attribute('aColor', 'vec4');

    // TWINKLE IN ALPHA ONLY, at a per-star rate. It used to scale the SIZE at one shared
    // 2.2 rad/s, so the whole field pulsed in lockstep and sub-pixel stars popped in and out
    // as their quads shrank under a pixel. Now each star scintillates at its own rate
    // (0.7-3.3 rad/s, derived from its phase) and depth, and its footprint never changes.
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardLocal(aBase, aSize);
    material.colorNode = aColor.xyz;
    let scint = float(1.0);
    if (twinkle) {
        const rate = fract(aTwinkle.mul(1.618)).mul(2.6).add(0.7);
        const depth = fract(aTwinkle.mul(2.414)).mul(0.25).add(0.15);
        scint = varying(float(1.0).sub(sin(time.mul(rate).add(aTwinkle)).mul(0.5).add(0.5).mul(depth)));
    }
    // Sharp HOT pinpoint: a very tight core (high exponent) for a crisp center and a faint
    // thin halo for a glow seat, feathered to 0 before the quad edge — crisp, not hazy.
    const p = uv().sub(0.5);
    const dist = length(p);
    const fall = oneMinus(dist.mul(2.0)).max(0.0);
    // The class's core gain rides the EXPONENT, not the brightness: a high gain is a
    // tighter, harder pinpoint and a low gain a soft one. That is what tells a big dim
    // red giant apart from a near blue-white — size alone just makes a bigger dot.
    const core = pow(fall, aColor.w.mul(coreExp)).mul(coreMult);
    const halo = pow(fall, 1.6).mul(0.10);
    // Diffraction spikes ONLY on the brightest class — a thin hot cross on every star made
    // the field read as a sprinkle of plus-signs; on the few B stars it reads as brilliance.
    const spikeMask = smoothstep(CH6_STARFIELD.spikeCoreGain - 0.03, CH6_STARFIELD.spikeCoreGain + 0.03, aColor.w);
    const spike = pow(oneMinus(p.x.abs().mul(spikeWidth)).max(0.0), 3.0)
        .add(pow(oneMinus(p.y.abs().mul(spikeWidth)).max(0.0), 3.0))
        .mul(fall.mul(fall))
        .mul(0.6)
        .mul(spikeMask);
    // A small constant emissive floor (near tier) keeps the brightest pinpoints reading
    // OVER bright nebula cloud rather than washing out against it.
    const floorTerm = fall.mul(fall).mul(emissiveFloor);
    // MAGNITUDE: a per-star brightness drawn from its phase (no new attribute), heavily
    // skewed faint — a real sky is a dust of faint stars with a few bright ones, not an
    // even snowfall of identical dots.
    const magnitude = pow(fract(aTwinkle.mul(1.37)), 2.5).mul(0.82).add(0.18);
    material.opacityNode = core.add(halo).add(spike).add(floorTerm)
        .mul(magnitude)
        .mul(scint)
        .mul(materialOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const points = new THREE.Mesh(geometry, material);
    points.name = name;
    points.frustumCulled = false;
    return points;
}

// B-COSMIC-DUST — DENSE drifting particle field (adapts murmuration motes +
// blood-moon sparks to the perf-safe instanced-billboard contract). A wide volume of
// fine glowing motes on an iridescent magenta/cyan/mint+gold palette, each with a
// per-particle phase so the field drifts organically (parallax via per-tier driftScale
// in update()). INSTANCED + CAPPED + scaled off particleCount; no per-frame allocation.
// Unlike the wispy nebula (big soft fill), these are SMALL hard-cored motes that add
// twinkling DENSITY between the stars and the cloud — the "more particles" the user
// wants — feathered to 0 before the quad edge, additive + capped (no blowout).
function createCosmicDust(uniforms, count, opts = {}) {
    const {
        sizeBase = 0.6,
        sizeSpan = 1.8,
        spanX = 560,
        spanY = 340,
        zBase = -420,
        zSpan = 620,
        alphaBase = 0.5,
        driftScale = 1.0,
        driftAmp = 10.0,
        sparkRatio = 0.22,
        name = 'cosmic-dust',
    } = opts;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const sparks = new Float32Array(count);

    // Iridescent palette adapted from murmuration (magenta / cyan / mint) plus a
    // warm gold mote so the field shares the nebula's cool+warm temperature split.
    const palette = [
        new THREE.Color(0xff4fd0), // hot magenta
        new THREE.Color(0xb45cff), // violet
        new THREE.Color(0x33d6ff), // cyan
        new THREE.Color(0x5cffd0), // mint
        new THREE.Color(0xffc46a), // warm gold
        new THREE.Color(0xcfe0ff), // cool white
    ];

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        positions[stride] = (Math.random() - 0.5) * spanX;
        positions[stride + 1] = (Math.random() - 0.5) * spanY;
        positions[stride + 2] = zBase - Math.random() * zSpan;

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;

        // Power-law sizing (blood-moon spark distribution): squaring keeps most motes
        // tiny with a few brighter sparks, so the field reads as fine dust + rare glints.
        sizes[index] = sizeBase + Math.random() * Math.random() * sizeSpan;
        phases[index] = Math.random() * Math.PI * 2;
        // A minority of motes are "sparks" — brighter, hotter core (energy-driven glow,
        // adapted from murmuration's speed→brightness, here a static per-mote flag).
        sparks[index] = Math.random() < sparkRatio ? 1.0 : 0.0;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aPhase: { array: phases, itemSize: 1 },
        aSpark: { array: sparks, itemSize: 1 },
    });

    const time = uniforms.uTime;
    const energy = uniforms.uEnergy;
    const aBase = attribute('aBase', 'vec3');
    const aColor = attribute('aColor', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aPhase = attribute('aPhase', 'float');
    const aSpark = attribute('aSpark', 'float');

    // Organic per-particle drift (murmuration's per-index phase-shifted turbulence):
    // three decorrelated sines so adjacent motes diverge — a living, parallaxing field.
    const dt = time.mul(driftScale * 0.18);
    const center = vec3(
        aBase.x.add(sin(dt.add(aPhase)).mul(driftAmp)),
        aBase.y.add(cos(dt.mul(0.82).add(aPhase.mul(1.7))).mul(driftAmp * 0.7)),
        aBase.z.add(sin(dt.mul(0.6).add(aPhase.mul(2.3))).mul(driftAmp * 0.5)),
    );

    // Twinkle: sparks pulse harder; dust motes shimmer gently. Energy lifts the whole
    // field a touch (audio reactor downstream) — kept subtle so it never goes hazy.
    const twinkle = sin(time.mul(2.4).add(aPhase)).mul(0.5).add(0.5);
    const sparkPulse = aSpark.mul(twinkle).mul(0.6).add(1.0);
    const sizeWorld = aSize.mul(sparkPulse).mul(energy.mul(0.25).add(0.85));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardLocal(center, sizeWorld);
    // Hot-cored mote: tight core + thin halo + a small spark-only diffraction glint, all
    // feathered to 0 before the quad edge (crisp, not hazy). Sparks get a warm-white core
    // lift so they read as energetic glints; dust stays the instance tint.
    const p = uv().sub(0.5);
    const d = length(p);
    const fall = oneMinus(d.mul(2.0)).max(0.0);
    const moteCore = pow(fall, 2.4);
    const moteHalo = pow(fall, 1.2).mul(0.18);
    const glint = pow(oneMinus(p.x.abs().mul(9.0)).max(0.0), 3.0)
        .add(pow(oneMinus(p.y.abs().mul(9.0)).max(0.0), 3.0))
        .mul(fall.mul(fall))
        .mul(aSpark)
        .mul(0.4);
    const moteColor = aColor.add(vec3(1.0, 0.85, 0.7).mul(aSpark).mul(moteCore).mul(0.45));
    material.colorNode = moteColor;
    const vEnergy = varying(twinkle.mul(0.4).add(0.6));
    // Cap below blowout: additive, soft. alphaBase is the per-mote ceiling.
    material.opacityNode = clamp(
        moteCore.add(moteHalo).add(glint).mul(vEnergy).mul(alphaBase),
        0.0,
        0.85,
    ).mul(materialOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const points = new THREE.Mesh(geometry, material);
    points.name = name;
    // Bounded volume — give it an explicit instance-cloud bounding sphere so frustum
    // culling works (three's default is computed from the tiny base quad). Centre =
    // centroid; radius covers half-extents + max mote half-size + drift amplitude.
    const maxHalf = (sizeBase + sizeSpan) * 0.5 + driftAmp;
    const hx = spanX * 0.5 + maxHalf;
    const hy = spanY * 0.5 + maxHalf;
    const hz = zSpan * 0.5 + maxHalf;
    geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(0, 0, zBase - zSpan * 0.5),
        Math.sqrt(hx * hx + hy * hy + hz * hz),
    );
    points.frustumCulled = true;
    points.userData.driftScale = driftScale;
    return points;
}

// Shared scratch for the asteroid tumble (zero per-frame allocation).
const _asteroidDummy = new THREE.Object3D();

/**
 * ASTEROID GARLAND (creative plan asset 4): 12 instanced dark rocks, 4–18 units,
 * strung diagonally up-right across the corridor between the mid-act stations. A lit
 * MeshStandardMaterial silhouette — the orange accretion key (diskLight) rims the
 * holeward edges, the violet rim directional fills the far sides. Per-rock tumble
 * data lives in userData; update() rewrites the instance matrices with a shared dummy.
 */
// A lumpy rock, not a ball (masterpiece pass): the garland's detail-1 icosahedra read as
// perfectly round dark discs — "holes punched in the nebula". Each vertex is pushed in/out by
// a seeded value-noise of its direction; the geometry is non-indexed, so coincident vertices
// get the same push (no cracks) and the recomputed normals stay faceted, like stone.
function createAsteroidGeometry() {
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    const pos = geometry.getAttribute('position');
    const lump = (x, y, z) => {
        const h = Math.sin((x * 12.9898) + (y * 78.233) + (z * 37.719)) * 43758.5453;
        return h - Math.floor(h);
    };
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).normalize();
        // Two octaves of lattice hash on the direction: a few big lobes + chipped facets.
        const qx = Math.round(v.x * 2.2);
        const qy = Math.round(v.y * 2.2);
        const qz = Math.round(v.z * 2.2);
        const big = lump(qx, qy, qz);
        const small = lump(Math.round(v.x * 5), Math.round(v.y * 5), Math.round(v.z * 5));
        const r = 0.74 + (big * 0.34) + (small * 0.12);
        pos.setXYZ(i, v.x * r, v.y * r * 0.82, v.z * r);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
}

function createAsteroidGarland() {
    const count = 12;
    const geometry = createAsteroidGeometry();
    // The authored note claimed an "orange accretion rim + violet fill come free from the
    // chapter's two lights" — in practice the rig is one dim ambient plus a point light
    // 600u away, so 0x0b0e18 rendered as pure black. That went unnoticed while the garland
    // sat 43-84 deg off the forward ray; now that the corridor frame puts it where the
    // camera is actually looking, capture showed it punching flat black holes in the frame
    // (worst over the carried Ch5 aurora). A lifted albedo plus a small self-lit floor makes
    // them read as dark rock silhouettes independent of how much light reaches them.
    // Self-shaded (see createAsteroidRockTSL): this chapter's light rig cannot light the
    // garland, and the previous MeshStandardMaterial rendered as pure black discs punched
    // through the carried aurora.
    const material = createAsteroidRockTSL();
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'asteroid-garland';
    mesh.frustumCulled = false;

    const seats = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const spins = new Float32Array(count * 3);
    // §3b rule 7 (witnesses, not filler): three UNEVEN clusters replacing the old
    // even-lerp diagonal — a tight close pass of small sharp rocks, a mid swarm, and
    // a sparse far trio of the biggest. Near = small + crisp, far = large (the
    // parallax-speed ratio against the slow giants IS the scale statement). Seats
    // are SEEDED (the old Math.random re-rolled the garland every build, which also
    // made capture A/Bs incomparable).
    let rngState = 421;
    const rng = () => {
        rngState = Math.imul(rngState ^ (rngState >>> 15), 0x2545f491) >>> 0;
        return rngState / 4294967296;
    };
    const clusters = [
        {
            n: 5, x: -110, y: -30, z: -240, spread: 42, sMin: 2.5, sMax: 5,
        },
        {
            n: 4, x: 150, y: 70, z: -430, spread: 58, sMin: 4, sMax: 8,
        },
        {
            n: 3, x: 30, y: 130, z: -720, spread: 75, sMin: 9, sMax: 15,
        },
    ];
    const seatOf = [];
    clusters.forEach((c) => {
        for (let k = 0; k < c.n; k += 1) seatOf.push(c);
    });
    for (let i = 0; i < count; i += 1) {
        const c = seatOf[i];
        // Diagonal garland: low-left near → high-right far (with the hero march), a few
        // pulled tight to the corridor for the close passes. Now that the garland really
        // does sit on the camera's lane (corridor frame), the close rocks are held off the
        // rail laterally so they graze the frame instead of eclipsing it, and the biggest
        // ones are kept to the far end of the run.
        seats[i * 3] = c.x + (rng() - 0.5) * 2 * c.spread;
        seats[i * 3 + 1] = c.y + (rng() - 0.5) * 2 * c.spread * 0.6;
        seats[i * 3 + 2] = c.z + (rng() - 0.5) * 2 * c.spread;
        scales[i] = c.sMin + rng() * (c.sMax - c.sMin);
        spins[i * 3] = (rng() - 0.5) * 0.3;
        spins[i * 3 + 1] = (rng() - 0.5) * 0.3;
        spins[i * 3 + 2] = (rng() - 0.5) * 0.3;
        _asteroidDummy.position.set(seats[i * 3], seats[i * 3 + 1], seats[i * 3 + 2]);
        _asteroidDummy.rotation.set(0, 0, 0);
        _asteroidDummy.scale.setScalar(scales[i]);
        _asteroidDummy.updateMatrix();
        mesh.setMatrixAt(i, _asteroidDummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.seats = seats;
    mesh.userData.scales = scales;
    mesh.userData.spins = spins;
    return mesh;
}

/**
 * STREAK-MOTE TIER (creative plan asset 6): rail-hugging elongated additive quads
 * whose streak mask runs along the travel diagonal — the forward-speed cue through
 * the long middle act. GPU-driven wrap (no per-frame CPU).
 */
/**
 * THE PULL (2026-10-03) — chapter 6's last beat, in chapter-local progress: the gas streams
 * toward the black hole, warms to the disk's amber, and the speed streaks arrive. Before it the
 * chapter is still (Orbit, Drift, Cathedral); `PULL_STREAM_RATE` is the wisps' speed in noise
 * cells per second at full pull (one cell in ~14 s: a visible, unhurried current).
 */
const PULL_BEAT = Object.freeze({ from: 0.6, to: 0.82 });
const PULL_STREAM_RATE = 0.07;

function createStreakMotes(uniforms, count) {
    const bases = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        bases[i * 3] = (Math.random() - 0.5) * 110;
        bases[i * 3 + 1] = (Math.random() - 0.5) * 70;
        bases[i * 3 + 2] = -60 - Math.random() * 520;
        seeds[i] = Math.random() * Math.PI * 2;
    }
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSeed: { array: seeds, itemSize: 1 },
    });

    const { uTime, uApproach } = uniforms;
    const aBase = attribute('aBase', 'vec3');
    const aSeed = attribute('aSeed', 'float');

    // Rush toward the camera (+Z wrap over the corridor span) so the streaks sell speed.
    const travel = mod(aBase.z.add(600.0).add(uTime.mul(46.0)).add(aSeed.mul(600.0)), 600.0);
    const center = vec3(aBase.x, aBase.y, travel.sub(620.0));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardLocal(center, 2.6);
    // Elongated streak mask along the travel diagonal (fixed angle in quad space).
    // THE DIVE STRETCH (Wave 5): as the BH dive begins (uApproach past bhDiveStart)
    // the streaks elongate ~2.3x and brighten — the acceleration read for the fall.
    // Deliberately NOT a speed change: mod(time*speed(t)) phase-jumps when speed
    // varies, so the length carries the speed statement instead.
    const diveT = smoothstep(0.7, 1.0, uApproach ?? uniform(0));
    const STREAK_COS = Math.cos(-0.5);
    const STREAK_SIN = Math.sin(-0.5);
    const p0 = uv().sub(0.5);
    const px = p0.x.mul(STREAK_COS).sub(p0.y.mul(STREAK_SIN));
    const py = p0.x.mul(STREAK_SIN).add(p0.y.mul(STREAK_COS));
    const streak = pow(
        clamp(oneMinus(length(vec2(px.mul(2.0), py.mul(mix(float(7.0), float(3.0), diveT))))), 0.0, 1.0),
        1.4,
    );
    material.colorNode = vec3(0.56, 0.69, 0.94); // cool starlight streak (#8FB0FF family)
    // Near fade: billboarded properly (billboardLocal) a streak rushing past the lens swells
    // into a big soft blue oval — it reads as a smudge, not speed. Fade it out inside ~120 u.
    const nearFade = smoothstep(40.0, 140.0, length(cameraPosition.sub(positionWorld)));
    material.opacityNode = streak.mul(diveT.mul(0.24).add(0.34)).mul(nearFade).mul(materialOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    // r181 splits a transparent DoubleSide material into a back-face pass and a front-face
    // pass (Renderer.js:3131), so this material bills TWICE. Blending here is Additive with
    // depthWrite off, which makes the two passes order-independent — the split buys nothing
    // and forceSinglePass reclaims it for free. Precedent: odyssey-planet-aurora.js:301-309.
    material.forceSinglePass = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'cosmic-streak-motes';
    mesh.frustumCulled = false;
    return mesh;
}

// ── THE COMET (Wave 5, §3.2 "the comet moment"; the level is literally named
// Comet Chase) — a sculpted opaque head + a luminous additive tail sweeping a long chord
// through the reef stretch. Unlevered like the garland: two draws.
// Staging follows the nebula-field pattern: OUTSIDE the entryContinuity buckets
// (setOpacityScale would flip these opaque materials transparent and dead-write
// opacity), on a shared uReveal ticked by update() = staging × reef-window × chord
// end-fade, dissolved by the same screen-space hash dither.
//
// RE-SEATED 2026-10-03. The old chord (250,70,-330) -> (-270,-50,-790) ran AWAY from the camera
// (440 -> 800 u) and, on the real camera, straight behind the rail and its nodes (ndc x 0.5 ->
// -0.2 at y 0.1): a 7 px head hidden by the path. This chord was solved by unprojecting two
// screen points at the Drift's middle (p 0.802): it enters at the right edge at mid height and
// sweeps down-left across the open lower-right sky to the bottom of the frame, 420 -> 300 u out,
// crossing the Milky Way and passing clear of the gas giant (>= 0.3 ndc) for the whole Drift.
export const COMET_PATH = Object.freeze({
    a: new THREE.Vector3(300, 104, -256),
    b: new THREE.Vector3(75, -150, -210),
    periodSec: 70,
});

/**
 * The comet's window as seen by the crossing under way: the value `windowNow` had when this chord
 * began (latched in `state`), so a crossing that has started runs to its end whatever the window
 * does meanwhile, and the window only decides each crossing as it starts.
 * @param {{chord?: number, passWindow?: number}} state mutated: the latch
 * @param {number} time board clock (s)
 * @param {number} windowNow 0..1 the comet's progress window now
 * @returns {number} the window this crossing runs at
 */
export function resolveCometPassWindow(state, time, windowNow) {
    const chord = Math.floor(time / COMET_PATH.periodSec);
    if (state.chord !== chord) {
        state.chord = chord;
        state.passWindow = windowNow;
    }
    return state.passWindow;
}

function createComet() {
    const uReveal = uniform(0);
    // Comet-local directions, set by update(): the tails stream AWAY from the black hole's light
    // (`uTailDir`), and the dust tail bends back along the comet's path (`uBendDir`).
    const uTailDir = uniform(new THREE.Vector3(0, 0, 1));
    const uBendDir = uniform(new THREE.Vector3(1, 0, 0));
    const group = new THREE.Group();
    group.name = 'comet-chase';
    // The eye in the comet's own frame (the group is translated inside the rotated corridor).
    const camLocal = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz;

    // THE COMA (overhaul 2026-10-20). The head was an opaque ice ball faded through a screen-space
    // dither: in captures a speckled pink-white blob. A comet's head is its coma — a soft glow of
    // gas round a nucleus too small to see — so it is now light: a camera-facing quad, a wide soft
    // halo and a hard bright core, fading through `uReveal` like the tails.
    const comaMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    comaMat.transparent = true;
    comaMat.depthWrite = false;
    comaMat.blending = THREE.AdditiveBlending;
    comaMat.forceSinglePass = true;
    const toCam = normalize(camLocal);
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    const up = cross(toCam, right);
    const COMA = 34;
    comaMat.positionNode = right.mul(positionGeometry.x.mul(COMA)).add(up.mul(positionGeometry.y.mul(COMA)));
    const cr = length(uv().sub(0.5)).mul(2.0);
    const coma = exp(cr.mul(cr).mul(-7.0)).mul(0.55).add(exp(cr.mul(cr).mul(-120.0)).mul(2.2));
    comaMat.colorNode = mix(vec3(0.62, 0.86, 1.0), vec3(1.0, 0.98, 0.94), exp(cr.mul(cr).mul(-60.0)));
    comaMat.opacityNode = clamp(coma, 0.0, 1.0).mul(uReveal).mul(materialOpacity);
    comaMat.userData.emitsBloom = true;
    const head = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), comaMat);
    head.name = 'comet-head';
    head.frustumCulled = false;
    group.add(head);

    // THE TAILS: camera-facing ribbons built in the vertex stage along a curve in the comet's frame,
    // turned about their own axis to face the eye (DoubleSide: a world-space ribbon's winding can
    // face away). The ION tail runs dead straight away from the light, blue and streaked; the DUST
    // tail is broader, paler gold and curves back along the path, as a real comet's two tails do.
    const ribbon = ({
        name, length: L, width0, width1, bend, tint, streak, gain,
    }) => {
        const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
        mat.transparent = true;
        mat.depthWrite = false;
        mat.blending = THREE.AdditiveBlending;
        mat.forceSinglePass = true;
        const along = positionGeometry.y.add(0.5);
        const dir = normalize(uTailDir);
        const centre = dir.mul(along.mul(L)).add(uBendDir.mul(along.mul(along).mul(bend)));
        const tangent = normalize(dir.mul(L).add(uBendDir.mul(along.mul(2.0 * bend))));
        const side = normalize(cross(tangent, normalize(camLocal.sub(centre))));
        const w = mix(float(width0), float(width1), along);
        mat.positionNode = centre.add(side.mul(positionGeometry.x.mul(w)));
        const t = uv().y;
        const across = clamp(abs(uv().x.sub(0.5)).mul(2.0), 0.0, 1.0);
        const profile = exp(across.mul(across).mul(-3.2));
        const fade = pow(clamp(oneMinus(t), 0.0, 1.0), 1.25).mul(smoothstep(0.0, 0.05, t));
        const strands = latticeNoise3(vec3(uv().x.mul(streak), t.mul(2.5), 3.7)).mul(0.6).add(0.55);
        mat.colorNode = tint;
        mat.opacityNode = clamp(profile.mul(fade).mul(strands).mul(gain), 0.0, 1.0)
            .mul(uReveal).mul(materialOpacity);
        mat.userData.emitsBloom = true;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 32), mat);
        mesh.name = name;
        mesh.frustumCulled = false;
        return mesh;
    };
    group.add(ribbon({
        name: 'comet-tail',
        length: 230,
        width0: 5,
        width1: 16,
        bend: 0,
        tint: vec3(0.42, 0.66, 1.0),
        streak: 9.0,
        gain: 0.9,
    }));
    group.add(ribbon({
        name: 'comet-dust-tail',
        length: 160,
        width0: 8,
        width1: 46,
        bend: 55,
        tint: vec3(1.0, 0.86, 0.64),
        streak: 3.0,
        gain: 0.55,
    }));

    group.userData.uReveal = uReveal;
    group.userData.uTailDir = uTailDir;
    group.userData.uBendDir = uBendDir;
    group.userData.materials = group.children.map((m) => m.material);
    return group;
}

function createDistantGalaxy(uniforms) {
    // Sharp, persistent spiral-galaxy/quasar billboard — a crisp deep-space focal anchor
    // up-right of the hero. B-COMPOSE marches it inward toward frame + grows it as the
    // camera approaches the seam ((150,150,-820)/120 → (120,170,-720)/175) via uApproach
    // in update(), so it reads as a real bright spiral rather than a pinprick off-edge.
    const { mesh } = createDistantGalaxyTSL(uniforms.uTime);
    mesh.position.set(APPROACH.galaxyA.x, APPROACH.galaxyA.y, APPROACH.galaxyA.z);
    mesh.scale.setScalar(APPROACH.galaxyA.s);
    mesh.frustumCulled = false;
    return mesh;
}

function setupCosmicLighting(group) {
    group.add(acquireChapterLight(6, 'AmbientLight', { color: 0x141425, intensity: 0.5 }));

    const diskLight = acquireChapterLight(6, 'PointLight', { color: 0xff6a2a, intensity: 1.1, distance: 600 });
    diskLight.position.set(0, 18, -640);
    group.add(diskLight);
    group.userData.diskLight = diskLight;

    const rimLight = acquireChapterLight(6, 'DirectionalLight', { color: 0x6a4cff, intensity: 0.4 });
    rimLight.position.set(-60, 50, -200);
    group.add(rimLight);
}

export function updateCosmicExpanseEnvironment(group, delta, time, camera = null, ...updateArgs) {
    // Manager calls update(group, delta, time, camera, cameraProgress, directorState).
    const [cameraProgress = null, directorState = null] = updateArgs;
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }
    // Autonomous energy breath (Phase 6 will drive this from the audio reactor).
    if (uniforms?.uEnergy) {
        const audioEnergy = directorState
            ? THREE.MathUtils.clamp((directorState.energy || 0) * 0.72 + (directorState.bass || 0) * 0.28, 0, 1)
            : null;
        uniforms.uEnergy.value = audioEnergy === null
            ? 0.32 + Math.sin(time * 0.5) * 0.16
            : 0.24 + audioEnergy * 0.64 + (directorState.beatPulse || 0) * 0.08;
    }

    // ── B3b APPROACH ─────────────────────────────────────────────────────────────
    // Chapter-local progress (0 entry → 1 at the 6→7 seam) from the camera's ascent through the
    // chapter y-range, falling back to the global cameraProgress, then 0 (smoke tests / no
    // camera). It still stages the entry reveals (stars, nebula, clutter) — the HEROES no longer
    // ride it (see resolveCh6HeroPlaces): it swung with every orb close-up.
    let approach = 0;
    const { yStart, yEnd } = group.userData;
    if (camera?.position && Number.isFinite(yStart) && Number.isFinite(yEnd) && yEnd !== yStart) {
        approach = THREE.MathUtils.clamp((camera.position.y - yStart) / (yEnd - yStart), 0, 1);
    } else if (Number.isFinite(cameraProgress)) {
        approach = THREE.MathUtils.clamp(cameraProgress, 0, 1);
    }
    if (uniforms?.uApproach) {
        uniforms.uApproach.value = approach;
    }
    const entryState = resolveCosmicEntryContinuity(approach);
    group.userData.entryContinuityState = entryState;
    // THE CHAPTER'S BEAT (2026-10-03): chapter-local progress BY PROGRESS when the journey gives
    // a global one (a camera is present); headless callers' value is already chapter-local.
    // `approach` is the camera's HEIGHT through the chapter — pinned at 0 until p 0.766 and only
    // 0.82 at the hand-off — which is why everything staged on it arrived in one bunch.
    const beatPositions = getActiveOdysseyChapterPositions();
    const beatT = (camera && Number.isFinite(cameraProgress)
        && Number.isFinite(beatPositions?.[5]) && Number.isFinite(beatPositions?.[6])
        && beatPositions[6] > beatPositions[5])
        ? THREE.MathUtils.clamp((cameraProgress - beatPositions[5]) / (beatPositions[6] - beatPositions[5]), 0, 1)
        : approach;
    group.userData.beatT = beatT;
    // THE PULL — the chapter's last beat (nodes 45-46, chapter-local 0.6 -> 0.82 = p 0.824 ->
    // 0.85): the gas streams toward the hole and the speed streaks arrive.
    const pull = THREE.MathUtils.smoothstep(beatT, PULL_BEAT.from, PULL_BEAT.to);
    group.userData.pull = pull;

    // ── EARTH AT THE SUMMIT / SPACE GATE ─────────────────────────────────────────
    // Driven by GLOBAL progress (not `approach`, which is pinned at 0 until the camera
    // climbs past the chapter's yStart around p=0.66 — long after the sky has gone).
    // `earthReveal` fades the gas giant up over the bright Ch5 summit; `spaceReveal`
    // holds the rest of the chapter at zero until the camera is actually in Space, so
    // the early ignite cannot drag stars, the black hole or nebula into the daylight.
    const chapterPositions = getActiveOdysseyChapterPositions();
    // With a camera (the live journey) the progress is GLOBAL and the chapter-5 gate applies;
    // headless callers (no camera) pass a chapter-local progress.
    const staging = resolveSummitEarthStaging(
        cameraProgress,
        chapterPositions?.[4],
        chapterPositions?.[5],
        chapterPositions?.[6],
        { chapterLocal: !camera },
    );
    const { spaceReveal } = staging;

    // THE 5->6 HAND-OFF (Act II->Space §8.3 step 2).
    //
    // `nebulaReveal` is driven by `approach`, a CAMERA-Y ramp that is pinned at 0 through
    // the whole ascent and is still climbing well inside chapter 6 — measured 0.478 at
    // p=0.7941 and 0.786 at p=0.8001. That climb IS the two tail rises the seam metric
    // fails on (+6.7 and +4.7 luma per 0.01p in the bank-off arm): the void dome and the
    // nebula field are still fading UP while the transition is supposed to have settled.
    //
    // Fixing that here, at source, rather than masking it with cloud-bank opacity: the
    // residual arc needed to cancel these rises optically survives with under 0.3 luma of
    // margin against ~1.5 of capture noise, i.e. it is not a real mechanism.
    //
    // ⚠️ Math.max, never a replacement — this may only ever make space arrive EARLIER.
    const spaceSpan = (Number.isFinite(chapterPositions?.[6]) && Number.isFinite(chapterPositions?.[5]))
        ? chapterPositions[6] - chapterPositions[5]
        : 0.167;
    const seamHandover = Number.isFinite(chapterPositions?.[5])
        ? rampBetween(
            cameraProgress,
            chapterPositions[5] - spaceSpan * SUMMIT_EARTH_REVEAL.handoverBeforeBoundary,
            chapterPositions[5] + spaceSpan * SUMMIT_EARTH_REVEAL.handoverAfterBoundary,
        )
        : 0;
    const spaceArrival = Math.max(entryState.nebulaReveal, seamHandover);
    group.userData.summitEarthStaging = staging;
    // DEEP SPACE, ONE THING AT A TIME (DEEP_SPACE_BEATS): by global progress on the journey;
    // headless callers (a chapter-local progress) see the chapter whole.
    const deep = camera ? resolveDeepSpaceBeats(cameraProgress, chapterPositions) : DEEP_SPACE_WHOLE;
    group.userData.deepSpaceBeats = deep;
    // The earth, once shown from the summit, never dips back out (the ask was that we
    // "still see it" once space darkens) — hence max() against the staged hero reveal.
    const earthReveal = Math.max(entryState.heroReveal, staging.earthReveal);

    const { blackHole, debris } = group.userData;
    // THE HEROES' PLACES (2026-10-19): one point in the world each, for the active layout.
    const heroPlaces = resolveCh6HeroPlaces(chapterPositions);
    const handoffWindow = resolveOmenHandoffWindow(chapterPositions);
    // Progress from the boundary to the 6->7 lock — by PROGRESS with a camera (global), the
    // headless caller's chapter-local value otherwise. Never the camera's height.
    const toLock = (camera && Number.isFinite(cameraProgress) && handoffWindow)
        ? THREE.MathUtils.clamp(
            (cameraProgress - chapterPositions[5]) / Math.max(1e-6, handoffWindow.end - chapterPositions[5]),
            0,
            1,
        )
        : beatT;
    // THE OMEN ARRIVES BY PROGRESS too, over the chapter's first fifth (it rode `approach`, the
    // camera's height, so an orb close-up could dim it), from the floor it is born at.
    const destinationReveal = COSMIC_ENTRY_CONTINUITY_SETTINGS.destinationFloor
        + (1 - COSMIC_ENTRY_CONTINUITY_SETTINGS.destinationFloor) * rampBetween(beatT, 0.02, 0.22);
    // ITS LIGHT ARRIVES SLOWLY (overhaul 2026-10-20). At its one world size the omen subtends ~6
    // deg from the first frame of space; its disk, photon ring and lensed halo now fade in over the
    // chapter's first ~60 % instead of popping in whole (the 5->6 gate's +14 luma rise), while
    // the aurora fades out — the hole materialises as the sky darkens.
    // (2026-10-24) On the journey it comes up last, in clear sky, as the Earth falls away
    // (DEEP_SPACE_BEATS.hole); headless, over the chapter's first half as before.
    const holeBeat = camera ? deep.hole : smoothstep01(THREE.MathUtils.clamp(beatT / 0.5, 0, 1));
    const omenReveal = spaceReveal * holeBeat;
    if (blackHole?.userData?.uReveal) blackHole.userData.uReveal.value = omenReveal;
    if (blackHole) {
        // THE HOLE RIDES THE PATH (resolveOmenPathPlace): placed by the progress the eased eye
        // stands at (the board's `followProgress`; a scroll eases the eye ~0.14 s behind the rail,
        // and seated on the rail itself the hole ran up to ~0.05 of the frame ahead of the view on
        // the bends), never by where the eye looks, so a close-up or free look leaves it where the
        // rail has it. Without a live camera it waits at its hand-over seat; without a resolved
        // layout, the old entry pose.
        blackHole.scale.setScalar(resolveOmenSpineScale(toLock));
        const followProgress = camera?.userData?.followProgress;
        const omenProgress = Number.isFinite(followProgress) ? followProgress : cameraProgress;
        if (heroPlaces && camera && Number.isFinite(omenProgress)) {
            resolveOmenPathPlace(omenProgress, handoffWindow.end, blackHole.position).sub(group.position);
        } else if (heroPlaces) {
            blackHole.position.copy(heroPlaces.omen).sub(group.position);
        } else {
            blackHole.position.set(APPROACH.bhXa, APPROACH.bhYa, APPROACH.bhZa);
        }
        // THE LOCK, just before chapter 7: across the hand-over window's few units the omen
        // settles from its place onto ch7's live camera lock (on the path camera the two are a
        // fraction of a degree apart — they were solved to coincide). Needs a REAL camera (a view
        // direction); its size is already ch7's there.
        let omenShadowLive = true;
        const lockCamera = camera?.userData?.heroCamera ?? camera;
        if (camera?.isCamera && handoffWindow && Number.isFinite(cameraProgress)) {
            // Strictly past the window end is where ch7 (and its shadow) is on screen.
            omenShadowLive = cameraProgress <= handoffWindow.end;
            const lock = THREE.MathUtils.smoothstep(cameraProgress, handoffWindow.start, handoffWindow.end);
            if (lock > 0) {
                // The hero camera while looking around (see black-hole-transcendence.js).
                resolveGargantuaLockPosition(lockCamera, _omenLock).sub(group.position);
                blackHole.position.lerp(_omenLock, lock);
            }
        }
        // Square to the eye (ch7's Gargantua pose): the shadow faces the camera and the disk
        // band reads across the frame wherever the corridor turns.
        orientBlackHoleOmen(blackHole, lockCamera);
        // EXACTLY ONE OPAQUE SHADOW. The omen's shadow covers the hole until the handoff is
        // complete — the frame ch7 appears, with Gargantua's identical shadow (same lock, same
        // radius) taking over there (black-hole-transcendence.js). Opacity is re-asserted
        // because, until the environment manager honours `odysseyFadeExempt`, it still writes a
        // crossfade opacity into this material each frame.
        const { shadow } = blackHole.userData;
        if (shadow) {
            shadow.visible = omenShadowLive;
            if (shadow.material) shadow.material.opacity = 1;
            // THE SHADOW OPENS WITH THE OMEN'S ARRIVAL. An opaque occluder cannot fade, so it used
            // to appear whole the frame the chapter let it draw — a black disc on the aurora ahead
            // of its own light. It grows out of a point as the light around it fades in.
            shadow.scale.setScalar(Math.max(1e-3, Math.sqrt(omenReveal)));
        }
    }
    const lens = group.userData.lensWorldPos;
    if (lens) {
        // The group is translated, never rotated: world = local + group position.
        if (blackHole) lens.copy(blackHole.position).add(group.position);
        lens.lensRadius = blackHole ? OMEN_SHADOW_RADIUS * blackHole.scale.x : 0;
        lens.lensStrength = blackHole
            ? THREE.MathUtils.lerp(OMEN_LENS.from, OMEN_LENS.to, smoothstep01(toLock)) * destinationReveal * spaceReveal
            : 0;
        lens.lensReach = OMEN_LENS.reach;
        lens.portal = 0;
    }
    if (debris && blackHole) {
        // Keep the infall seated on the hole as it looms — and IN its disk plane.
        debris.position.copy(blackHole.position);
        debris.scale.copy(blackHole.scale);
        const { face, diskPivot } = blackHole.userData;
        if (face && diskPivot) {
            debris.quaternion.copy(blackHole.quaternion).multiply(face.quaternion).multiply(diskPivot.quaternion);
        }
    }

    const { heroPlanet } = group.userData;
    if (heroPlanet) {
        // Its place in the world (PLANET_WORLD_SEAT) — the seam's screen seat below hands over
        // to it. Without a resolved layout it keeps the old entry pose.
        // ONE PLACE, ONE POSE, ONE SIZE (overhaul 2026-10-20): the world point it has from its first
        // visible frame (PLANET_WORLD_SEAT), its pole fixed in the world, its world radius fixed —
        // it grows only as the camera closes on it, and its spin lives in the cloud shader (the
        // group never turns, so the rings never swing). Nothing here reads the camera.
        heroPlanet.scale.setScalar(PLANET_WORLD_SEAT.radius / HERO_PLANET_RADIUS);
        if (heroPlaces) {
            // From behind the Earth's limb up to its seat (the planetrise, by progress alone, so an
            // orb close-up never moves it); headless callers see it at its seat.
            const rise = camera ? orbitEarthAt(cameraProgress, chapterPositions).planetRise : 1;
            resolvePlanetRisePlace(heroPlaces, rise, heroPlanet.position).sub(group.position);
            if (heroPlanet.userData.posedRevision !== heroPlaces.revision || heroPlanet.userData.posedRise !== rise) {
                resolvePlanetRiseTurn(heroPlaces, rise, _riseTurn);
                heroPlanet.quaternion.setFromUnitVectors(SPINE_WORLD_UP, heroPlaces.planetPole).premultiply(_riseTurn);
                heroPlanet.userData.uLight?.value.copy(heroPlaces.planetLight).applyQuaternion(_riseTurn);
                heroPlanet.userData.posedRevision = heroPlaces.revision;
                heroPlanet.userData.posedRise = rise;
            }
        } else {
            heroPlanet.position.set(APPROACH.planetA.x, APPROACH.planetA.y, APPROACH.planetA.z);
        }
        // THE AURORA DARKNESS GATE (owner report 2026-08-16). The crown's own night
        // mask only knows the PLANET's terminator; during the ascent the planet's
        // night side faces a bright daylight sky and the curtains blazed at full
        // effect from p≈0.62 (measured). The earth is the ONE element allowed before
        // the boundary — its aurora is not. Both aurora halves share this uniform
        // and arrive with the dark, exactly like every other space element.
        const auroraGate = heroPlanet.userData.uAuroraReveal;
        if (auroraGate) auroraGate.value = spaceReveal;
    }

    // NO WHOLE-FIELD TURNS (2026-10-19). The nebula sprite tiers and both dust tiers used to yaw
    // about the corridor's origin every frame (0.006 / 0.010 rad/s), which at 500-1300 u slid the
    // whole far field sideways at 5-13 u/s, in the same direction, all chapter. They now hold
    // still; the motes' own small drift (in their shader) and the camera's travel are the motion.
    const { galaxy } = group.userData;
    if (galaxy) {
        // ONE place (GALAXY_WORLD_SEAT), turned ONCE to face the chapter's mid-point and inclined
        // ~60 deg. It used to march between two poses on the camera's height and turn to the eye
        // every frame, so it slid and swivelled; from the rail's 300 u the view of it changes by
        // a few degrees, which a far inclined disc does not need corrected.
        // AT INFINITY (overhaul 2026-10-20): a fixed direction of the sky kept a fixed distance from
        // the eye, so it never slides against the stars nor swells as the camera travels; turned
        // once (square to that direction, then inclined), so its ellipse never changes either.
        if (heroPlaces && camera?.position) {
            galaxy.position.copy(camera.position)
                .addScaledVector(heroPlaces.galaxyDir, GALAXY_SKY_SEAT.distance)
                .sub(group.position);
            if (galaxy.userData.facedRevision !== heroPlaces.revision) {
                _galaxyFacing.copy(galaxy.position).sub(heroPlaces.galaxyDir);
                galaxy.lookAt(_galaxyFacing.add(group.position));
                galaxy.rotateX(GALAXY_INCLINATION);
                galaxy.rotateZ(0.6);
                galaxy.userData.facedRevision = heroPlaces.revision;
            }
        } else if (heroPlaces) {
            galaxy.position.copy(heroPlaces.galaxy).sub(group.position);
        } else {
            galaxy.position.set(APPROACH.galaxyA.x, APPROACH.galaxyA.y, APPROACH.galaxyA.z);
        }
        // The quad's disc reaches 0.47 of its side: size it to the seat's angular radius.
        galaxy.scale.setScalar((GALAXY_SKY_SEAT.distance * Math.tan(GALAXY_SKY_SEAT.angularRadius)) / 0.47);
    }

    const { diskLight } = group.userData;
    if (diskLight) {
        // It paints the gas, so it arrives with it (DEEP_SPACE_BEATS.nebula).
        const lightReveal = Math.max(destinationReveal, entryState.nebulaReveal * 0.75)
            * spaceReveal * deep.nebula;
        // No breath of its own (it pulsed on a 9 s sine): it follows the music's energy only.
        diskLight.intensity = (1.0 + (uniforms?.uEnergy?.value ?? 0) * 0.4) * lightReveal;
    }

    // Asteroid garland: slow per-rock tumble (shared dummy — zero allocation). Twelve
    // matrix rewrites per frame is negligible; the rocks otherwise hold their stations.
    const { asteroids } = group.userData;
    if (asteroids?.userData?.seats) {
        const { seats, scales, spins } = asteroids.userData;
        for (let i = 0; i < scales.length; i += 1) {
            _asteroidDummy.position.set(seats[i * 3], seats[i * 3 + 1], seats[i * 3 + 2]);
            _asteroidDummy.rotation.set(
                time * spins[i * 3],
                time * spins[i * 3 + 1],
                time * spins[i * 3 + 2],
            );
            _asteroidDummy.scale.setScalar(scales[i]);
            _asteroidDummy.updateMatrix();
            asteroids.setMatrixAt(i, _asteroidDummy.matrix);
        }
        asteroids.instanceMatrix.needsUpdate = true;
    }

    const chapterOpacity = group.userData.chapterOpacity ?? 1;
    // THE VOID SKY OWNS THE BACKGROUND BEFORE THE WORLD LETS GO (seamless pass). It used to
    // ride `spaceArrival` too, which is still ~0.52 at p 0.7765 — the frame the One World
    // switches off — so the colour behind the departing sky changed from the world's to the
    // director's clear colour. It now rides the space gate alone, which completes at
    // gateEnd (0.7730, held below the switch-off by odyssey-seam-56-schedule.test.js). The
    // dome is a dark backdrop (one band below the gas), so arriving faster is no luma rise.
    //
    // ...AND IT ARRIVES AT ONCE (overhaul 2026-10-20). On the slow space gate (0.7543 -> 0.7730)
    // and under the chapter's crossfade weight, the dome was ~20 % opaque at p 0.758, the frame the
    // world's night sky stops covering the background: the clear colour behind it — a blend of
    // ch5's light-cyan fog and ch6's black — showed as a NAVY sky for ~0.012 of p (+6.6 luma in
    // 0.002 p; main shows the same flash). The dome is dark, so it now owns the background within
    // the first 3 % of the chapter, at full weight while the chapter is arriving.
    const domeArrival = Number.isFinite(cameraProgress) && Number.isFinite(chapterPositions?.[5])
        ? rampBetween(cameraProgress, chapterPositions[5], chapterPositions[5] + spaceSpan * 0.03)
        : spaceReveal;
    const arriving = Number.isFinite(cameraProgress) && Number.isFinite(chapterPositions?.[5])
        && cameraProgress < chapterPositions[5] + spaceSpan * 0.5;
    const voidSkyOpacity = Math.max(spaceReveal * chapterOpacity, arriving ? domeArrival : 0);
    if (uniforms?.uVoidSkyOpacity) {
        uniforms.uVoidSkyOpacity.value = voidSkyOpacity;
    }
    // The dome owns the background from the boundary, near-black; its Milky Way comes up later.
    if (uniforms?.uVoidSkyGlow) uniforms.uVoidSkyGlow.value = deep.milkyWay;
    if (group.userData.voidSky) {
        group.userData.voidSky.visible = voidSkyOpacity > 0.002;
    }
    // THE SKY AT INFINITY (overhaul 2026-10-20). The dome and both star shells used to hang at the
    // chapter's centre, so the camera's ~300 u of travel slid them a few degrees, and chapter 7 —
    // which seats the same baked sky on the eye — disagreed with them by 1.4-3.6 deg across the 6->7
    // crossfade (a doubled Milky Way). Seated on the eye, the sky is a fixed set of directions:
    // the reference everything else is judged against, and identical on both sides of the seam.
    if (camera?.position) {
        const skyLayers = [group.userData.voidSky, group.userData.starsFar, group.userData.starsNear];
        for (let i = 0; i < skyLayers.length; i += 1) {
            if (skyLayers[i]) skyLayers[i].position.copy(camera.position).sub(group.position);
        }
    }

    // The sculpted nebula field stages itself OUTSIDE the entryContinuity buckets:
    // setOpacityScale would flip its opaque material transparent and write the dead
    // `material.opacity` (opacityNode owns opacity in r181). Same staging product,
    // delivered as a uniform driving the dithered opaque dissolve.
    const nebulaFieldMesh = group.userData.nebulaField;
    if (nebulaFieldMesh?.userData?.uReveal) {
        const fieldReveal = spaceArrival * spaceReveal * chapterOpacity * deep.nebula;
        nebulaFieldMesh.userData.uReveal.value = fieldReveal;
        nebulaFieldMesh.visible = fieldReveal > 0.002;
        // THE BEAT and THE KEY (2026-10-03): each mass fades in on its own window of the
        // chapter's progress (odyssey-nebula-field-specs.js `beat`), and every mass is painted
        // by one light — the black hole, wherever it is — handed over in the corridor's frame.
        if (nebulaFieldMesh.userData.uBeat) nebulaFieldMesh.userData.uBeat.value = beatT;
        // THE PULL: across the chapter's last beat the gas's wisps stream toward the hole and
        // its lit face warms to the disk's amber.
        if (nebulaFieldMesh.userData.uPull) {
            nebulaFieldMesh.userData.uPull.value = pull;
            nebulaFieldMesh.userData.uPullPhase.value += THREE.MathUtils.clamp(delta, 0, 0.05)
                * pull * PULL_STREAM_RATE;
        }
        const { corridor: nebulaCorridor, blackHole: keyHole } = group.userData;
        if (nebulaFieldMesh.userData.uKey && nebulaCorridor && keyHole) {
            keyHole.getWorldPosition(_keyLocal);
            nebulaCorridor.updateWorldMatrix(true, false);
            nebulaCorridor.worldToLocal(_keyLocal);
            nebulaFieldMesh.userData.uKey.value.copy(_keyLocal);
        }
    }

    // The comet sweeps its chord on a fixed period, alive only through the reef
    // window (chapter-local ~0.28-0.74) and dither-faded at the chord's ends so it
    // enters and leaves as a distant glint, never a pop.
    const { comet } = group.userData;
    if (comet?.userData?.uReveal) {
        const s = (time % COMET_PATH.periodSec) / COMET_PATH.periodSec;
        comet.position.lerpVectors(COMET_PATH.a, COMET_PATH.b, s);
        // Its tails stream away from the hole's light, the dust tail bent back along its path.
        if (blackHole && comet.parent && comet.userData.uTailDir) {
            blackHole.getWorldPosition(_cometLight);
            comet.parent.worldToLocal(_cometLight);
            comet.userData.uTailDir.value.copy(comet.position).sub(_cometLight).normalize();
            _cometPath.copy(COMET_PATH.a).sub(COMET_PATH.b).normalize();
            comet.userData.uBendDir.value.copy(_cometPath)
                .addScaledVector(comet.userData.uTailDir.value, -_cometPath.dot(comet.userData.uTailDir.value))
                .normalize();
        }
        const endFade = THREE.MathUtils.smoothstep(s, 0, 0.1)
            * (1 - THREE.MathUtils.smoothstep(s, 0.9, 1));
        // (2026-10-03) On the chapter's BEAT, not the camera's height (`approach` is pinned at
        // 0 until p 0.766): the comet is the Drift's one event, crossing the quiet sky before
        // the gas arrives, and gone before the pull.
        const reefWindow = THREE.MathUtils.smoothstep(beatT, 0.24, 0.34)
            * (1 - THREE.MathUtils.smoothstep(beatT, 0.56, 0.68));
        // A CROSSING THAT HAS BEGUN RUNS TO ITS END (2026-10-20, in-game feedback: things
        // "disappear before we have moved past them"). The window closes over p 0.820-0.834 —
        // the L43 -> L45 glides — and the comet used to dissolve mid-sky there with 60-75 % of
        // its chord in frame. The window now only decides each crossing as it starts (latched
        // per chord); the crossing under way leaves the way every crossing does, as a glint at
        // the chord's end (`endFade`).
        const passWindow = resolveCometPassWindow(comet.userData, time, reefWindow);
        // No `clutterReveal` factor any more: that ramp rides the camera's height and only opens
        // at beat ~0.34-0.65, which pushed the comet out of the Drift and into the pull.
        const cometReveal = spaceReveal * chapterOpacity * passWindow * endFade;
        comet.userData.uReveal.value = cometReveal;
        comet.visible = cometReveal > 0.02;
    }

    const entryTargets = group.userData.entryContinuity;
    if (entryTargets) {
        // The far tier is the Milky Way's (a share of it is seated in the galactic band).
        entryTargets.stars.forEach((object) => setOpacityScale(
            object,
            entryState.starReveal * spaceReveal * deep.milkyWay,
            chapterOpacity,
        ));
        // STARS BEFORE DARK (Wave 3): the near tier alone may arrive pre-boundary,
        // fading up across [summitEnd, ch6Start] to a capped ceiling while the sky is
        // still blue. max() with the normal staging so the boundary hand-off can only
        // ever be earlier, never a dip.
        // (2026-10-02) They now LEAD the planet: from `starsFromBeforeBoundary` (the sky deepening
        // to near-black), not from the planet's reveal end.
        const starsFrom = Number.isFinite(chapterPositions?.[4]) && Number.isFinite(chapterPositions?.[5])
            ? chapterPositions[5] - (chapterPositions[5] - chapterPositions[4])
                * SUMMIT_EARTH_REVEAL.starsFromBeforeBoundary
            : Number.NaN;
        const starsEarly = (Number.isFinite(starsFrom) && Number.isFinite(cameraProgress))
            ? rampBetween(cameraProgress, starsFrom, chapterPositions[5])
                * SUMMIT_EARTH_REVEAL.starsBeforeDark
            : 0;
        (entryTargets.starsNear || []).forEach((object) => setOpacityScale(
            object,
            Math.max(entryState.starReveal * spaceReveal, starsEarly),
            chapterOpacity,
        ));
        entryTargets.destination.forEach((object) => setOpacityScale(
            object,
            destinationReveal * spaceReveal,
            chapterOpacity,
        ));
        (entryTargets.debris || []).forEach((object) => setOpacityScale(
            object,
            destinationReveal * spaceReveal * deep.hole,
            chapterOpacity,
        ));
        // The earth is the ONE element allowed through before the boundary.
        entryTargets.earth.forEach((object) => setOpacityScale(object, earthReveal, chapterOpacity));
        entryTargets.heroes.forEach((object) => setOpacityScale(
            object,
            entryState.heroReveal * spaceReveal,
            chapterOpacity,
        ));
        entryTargets.nebula.forEach((object) => setOpacityScale(
            object,
            entryState.nebulaReveal * spaceReveal * deep.nebula,
            chapterOpacity,
        ));
        entryTargets.clutter.forEach((object) => setOpacityScale(
            object,
            entryState.clutterReveal * spaceReveal,
            chapterOpacity,
        ));
        (entryTargets.streaks ?? []).forEach((object) => setOpacityScale(
            object,
            entryState.clutterReveal * spaceReveal * pull,
            chapterOpacity,
        ));
    }
}

export default {
    config: COSMIC_EXPANSE_CONFIG,
    create: createCosmicExpanseEnvironment,
    update: updateCosmicExpanseEnvironment,
};
