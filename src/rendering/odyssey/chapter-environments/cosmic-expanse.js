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
    attribute,
    cameraPosition,
    clamp,
    color as tslColor,
    cos,
    dot,
    float,
    fract,
    length,
    mix,
    materialOpacity,
    mod,
    normalWorld,
    normalize,
    oneMinus,
    positionWorld,
    pow,
    screenCoordinate,
    sin,
    smoothstep,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { getActiveOdysseyChapterPositions, getChapterPathRange } from '../path-utils.js';
import {
    createVoidSkyTSL,
    createBlackHoleTSL,
    createHeroPlanetTSL,
    createDistantGalaxyTSL,
    createNebulaPillarTSL,
    createAsteroidRockTSL,
} from './cosmic-expanse.tsl.js';
import { createBakedVoidSkyTSL } from './odyssey-cosmic-backdrop.js';
import { createNebulaFieldTSL } from './odyssey-nebula-field.js';
import { fbm3, ridged3 } from './shared/odyssey-tsl-noise.js';
import { billboardWorld, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';
import { pickStellarClass } from './odyssey-stellar-ramp.js';

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
const APPROACH = {
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
    planetA: {
        x: 870, y: 322, z: -277, s: 34 / 28,
    },
    // planetB moved along the EXIT CAMERA'S RIGHT vector (the exit forward runs
    // nearly down local +x, so screen-lateral is mostly ±z, not ±x — the first nudge
    // moved the planet along the view axis and its ndc barely changed) when the BH
    // dive took the exit axis: the giant must stay clear of the dive line
    // (separation ≥ 0.2 asserted). Distance held ~756 so apparent size is unchanged.
    planetB: {
        x: 855, y: 60, z: -89, s: 60 / 28,
    },
    galaxyA: {
        x: 750, y: 743, z: 106, s: 155,
    },
    galaxyB: {
        x: 942, y: 449, z: 39, s: 250,
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
    // 0.41 of the Ch5 span before the boundary => p = 0.5873, just as the camera crests.
    // ⚠️ THESE TWO COMMENTS USED TO SAY 0.610 AND 0.634 AND WERE WRONG (fixed 2026-08-16 by
    // the Act II->Space transition audit). They were computed from `skySpan = 0.648 - 0.556`,
    // but 0.556 is LEVEL 31's path position, not chapter 5's start. Chapter 5 starts at
    // level 28, p = 0.500, so skySpan is 0.148 and the real window is 0.5873 -> 0.6258.
    // The CODE was always right — it derives the span from `chapterPositions` at runtime —
    // so nothing shipped wrong; but anyone retiming this seam from the comments was reading
    // numbers that do not exist. Verified by importing the modules, never by parsing source
    // (a regex over levels.js mis-pairs id/chapter and invents a plausible false table).
    startBeforeBoundary: 0.41,
    // Fully present by p = 0.6258 — comfortably before the 5->6 backdrop fade begins.
    endBeforeBoundary: 0.15,
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
});

/**
 * Level trim on the carried Ch5 aurora bridge, applied after the hue fix above. 0.65 rather
 * than a deeper cut because switching to managed `color()` already removes most of the
 * excess on its own; this only takes the remaining edge off so the curtains sit behind the
 * cloud limb instead of competing with it.
 */
const BRIDGE_LEVEL = 0.65;
/**
 * How much of the bridge's chroma survives (1 = untouched, 0 = greyscale). The curtains are
 * additive and were measuring 99-100 % saturation across ~44 % of the non-black pixels at
 * p=0.7501, against a cloud-limb frame whose mean lit saturation is 38 %.
 */
const BRIDGE_CHROMA = 0.55;

const _approachVec = new THREE.Vector3();

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
 * `spaceReveal` is 1 OUTSIDE the summit window in both directions — below it the manager
 * keeps the chapter at zero opacity anyway, and returning 1 there keeps headless callers
 * that pass a chapter-local progress (no camera) behaving exactly as before.
 *
 * @param {number} progress global path progress 0..1
 * @param {number} ch5Start global progress where chapter 5 begins
 * @param {number} ch6Start global progress where chapter 6 begins (the Space boundary)
 * @param {number} ch7Start global progress where chapter 7 begins
 * @returns {{earthReveal: number, spaceReveal: number, summitStart: number}}
 */
export function resolveSummitEarthStaging(progress, ch5Start, ch6Start, ch7Start) {
    if (!Number.isFinite(progress) || !Number.isFinite(ch5Start) || !Number.isFinite(ch6Start)
        || ch6Start <= ch5Start) {
        return { earthReveal: 0, spaceReveal: 1, summitStart: Number.NaN };
    }
    const skySpan = ch6Start - ch5Start;
    const summitStart = ch6Start - skySpan * SUMMIT_EARTH_REVEAL.startBeforeBoundary;
    const summitEnd = ch6Start - skySpan * SUMMIT_EARTH_REVEAL.endBeforeBoundary;
    const spaceSpan = (Number.isFinite(ch7Start) && ch7Start > ch6Start)
        ? ch7Start - ch6Start
        : 0.167;
    const gateEnd = ch6Start + spaceSpan * SUMMIT_EARTH_REVEAL.spaceGateBand;

    const earthReveal = rampBetween(progress, summitStart, summitEnd);
    const spaceReveal = (progress >= summitStart && progress < gateEnd)
        ? rampBetween(progress, ch6Start, gateEnd)
        : 1;

    return { earthReveal, spaceReveal, summitStart };
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
//   ?odysseyCh6NoAurora=1  — the hero's auroral crown, BOTH halves (Wave 5)
//   ?odysseyCh6LegacyKeyFrame=1 — ADD-BACK polarity: restores the Wave 6 lighting slip,
//                            i.e. the masses' corridor-local key dotted against world
//                            normals raw (55.8-95.5 deg off the accretion key). The
//                            SHIPPED default now applies that key in the frame it was
//                            authored in (25.7-57.1 deg). Owner flipped it 2026-08-16.
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
        authoredKeyFrame: !readCh6UrlFlag('odysseyCh6LegacyKeyFrame'),
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
    };
    group.userData.uniforms = uniforms;

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
    const voidSky = !bisect.dome ? null
        : (readCh6UrlFlag('odysseyCh6ProceduralDome')
            ? createVoidSky(uniforms)
            : createBakedVoidSky(uniforms));
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
        blackHole.rotation.x = -1.12;
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

    // 6. Crisp pinpoint starfield — TWO depth tiers so Space reads DEEP + CLEAR
    // with sharp hot-white pinpoints (the opposite of Sky's haze): a sparse, far
    // shell of small hard pinpoints + a nearer tier of brighter, fewer stars.
    const starsFar = !bisect.stars ? null : createVoidStars(uniforms, Math.max(96, Math.floor(particleCount * 2.4)), {
        radiusMin: 200,
        radiusSpan: 130,
        sizeBase: 0.7,
        sizeSpan: 1.6,
        coreExp: 2.6,
        name: 'void-stars-far',
    });
    if (starsFar) {
        group.add(starsFar);
        group.userData.starsFar = starsFar;
    }

    const starsNear = !bisect.stars ? null : createVoidStars(uniforms, Math.max(36, Math.floor(particleCount * 0.7)), {
        radiusMin: 120,
        radiusSpan: 70,
        // B3b — crisper punch-through near tier so stars read OVER the brightest cloud:
        // bigger base, hotter core, a small constant emissive floor, wider diffraction.
        sizeBase: 1.8,
        sizeSpan: 2.8,
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
        authoredFrame: bisect.authoredKeyFrame,
        corridorQuaternion: corridorFrame.quaternion,
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

    // 2e. DENSE drifting mote field (the user's "more particles" — electric-dreams-v3 /
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

    // AURORA BRIDGE — Ch6-OWNED aurora that ramps in via uApproach (NOT Ch5's daylight uDusk cap)
    // so the northern lights greet the 5→6 handoff and linger over the now-dark vacuum (in-game
    // "aurora gone" fix). The builder existed (createAuroraFilamentBridge, below) but was never
    // added to the group. It self-gates via uApproach so it's present at the handoff.
    // MISPLACEMENT FIX (owner report 2026-08-15, "the aurora feels misplaced"): the
    // curtains are authored in the -Z corridor convention (x spread, y overhead,
    // depth down -Z) but were parented to the chapter GROUP — the exact 43-84 deg
    // off-axis bug the `cosmic-corridor` frame was built to fix, and every other
    // ambient field moved there; the bridge never did. Corridor-parented, the
    // greeting curtains actually hang over the camera's entry stretch.
    const auroraBridge = createAuroraFilamentBridge(uniforms);
    corridor.add(auroraBridge);
    group.userData.auroraBridge = auroraBridge;
    // Buckets tolerate bisected-out tiers: filter(Boolean) so update()'s forEach walks
    // only what was actually built.
    group.userData.entryContinuity = {
        stars: [starsFar, starsNear].filter(Boolean),
        destination: [blackHole, debris].filter(Boolean),
        // EARTH AT THE SUMMIT: the gas giant is staged on its own GLOBAL-progress reveal
        // so it can rise over the still-bright Ch5 sky (see SUMMIT_EARTH_REVEAL). Every
        // other Space element — the galaxy included — stays behind the post-boundary
        // gate, so nothing but the earth bleeds into the daylight frame.
        earth: [heroPlanet].filter(Boolean),
        heroes: [galaxy].filter(Boolean),
        nebula: [nebulaVolume, nebulaFar].filter(Boolean),
        clutter: [dustNear, dustFar, asteroids, streakMotes].filter(Boolean),
        // The carried aurora filaments self-gate on uApproach, which is 0 through all of
        // Ch5 — i.e. fully green and fully alive. Without this they would hang in the
        // daylight sky the moment the early ignite makes the chapter visible.
        bridge: [auroraBridge],
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
    const { mesh } = createBakedVoidSkyTSL(uniforms.uTime, uniforms.uEnergy, uniforms.uVoidSkyOpacity);
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
    // TSL builder: banded gas-giant surface + plain atmosphere/ring decor. Returns
    // { group, planet }. group.userData.planet is set so update() can spin it. Initial
    // pose matches APPROACH.planetA (update() lerps it onward) so the first frame agrees.
    const { group, planet } = createHeroPlanetTSL(uniforms.uTime, {
        aurora: bisect.aurora !== false,
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
    material.positionNode = billboardWorld(center, aSize);

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
    material.positionNode = billboardWorld(center, size);
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
        radiusMin = 200,
        radiusSpan = 120,
        sizeBase = 0.8,
        sizeSpan = 2.4,
        coreExp = 2.6,
        coreMult = 1.15,
        spikeWidth = 14.0,
        emissiveFloor = 0.0,
        brightWeight = 0.0,
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

    for (let i = 0; i < count; i++) {
        const theta = rng() * Math.PI * 2;
        const phi = Math.acos(2 * rng() - 1);
        const r = radiusMin + rng() * radiusSpan;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
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
    const aColor = attribute('aColor', 'vec3');

    // twinkle = 0.78 + 0.22 * sin(...): keep stars mostly ON (sharp + persistent),
    // only a gentle scintillation, so the field never dims into haze. Slightly
    // higher floor than before so the pinpoints stay crisp against the deeper black.
    const twinkle = sin(time.mul(2.2).add(aTwinkle)).mul(0.22).add(0.78);
    const size = aSize.mul(twinkle).mul(0.62);
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(aBase, size);
    material.colorNode = aColor.xyz;
    // Sharp HOT pinpoint: a very tight core (high exponent) for a crisp center, a
    // faint thin halo for a glow seat, plus a subtle 4-point diffraction glint along
    // the sprite axes so the brightest stars read as hot pinpoints. All feathered to
    // 0 before the quad edge — crisp, not hazy.
    const p = uv().sub(0.5);
    const dist = length(p);
    const fall = oneMinus(dist.mul(2.0)).max(0.0);
    // The class's core gain rides the EXPONENT, not the brightness: a high gain is a
    // tighter, harder pinpoint and a low gain a soft one. That is what tells a big dim
    // red giant apart from a near blue-white — size alone just makes a bigger dot.
    const core = pow(fall, aColor.w.mul(coreExp)).mul(coreMult);
    const halo = pow(fall, 1.2).mul(0.14);
    // Diffraction spikes: bright along x≈0 and y≈0, decaying with radius — a thin
    // hot cross that sells the "pinpoint star" sparkle without bloating the sprite. The
    // near tier widens these (smaller multiplier → fatter cross) for punchier glints.
    const spike = pow(oneMinus(p.x.abs().mul(spikeWidth)).max(0.0), 3.0)
        .add(pow(oneMinus(p.y.abs().mul(spikeWidth)).max(0.0), 3.0))
        .mul(fall.mul(fall))
        .mul(0.5);
    const vAlpha = varying(twinkle);
    // A small constant emissive floor (near tier) keeps the brightest pinpoints reading
    // OVER bright nebula cloud rather than washing out against it. Capped via core math.
    const floorTerm = fall.mul(fall).mul(emissiveFloor);
    material.opacityNode = core.add(halo).add(spike).add(floorTerm)
        .mul(vAlpha)
        .mul(materialOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const points = new THREE.Mesh(geometry, material);
    points.name = name;
    points.frustumCulled = false;
    return points;
}

// B-COSMIC-DUST — DENSE drifting particle field (adapts electric-dreams-v3 motes +
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

    // Iridescent palette adapted from electric-dreams-v3 (magenta / cyan / mint) plus a
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
        // adapted from electric-dreams-v3's speed→brightness, here a static per-mote flag).
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

    // Organic per-particle drift (electric-dreams-v3's per-index phase-shifted turbulence):
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
    material.positionNode = billboardWorld(center, sizeWorld);
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
function createAsteroidGarland() {
    const count = 12;
    const geometry = new THREE.IcosahedronGeometry(1, 1);
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
 * AURORA→FILAMENT BRIDGE (creative plan Transition In): three stretched curtain
 * filaments at the chapter entry, recoloring green → crimson as the first ~12% of the
 * chapter elapses and dissolving by ~18% — the sky has become interstellar gas.
 */
export function createAuroraFilamentBridge(uniforms) {
    const group = new THREE.Group();
    group.name = 'aurora-filament-bridge';
    const { uTime, uApproach } = uniforms;

    const vUv = uv();
    const strands = pow(sin(vUv.x.mul(42.0).add(uTime.mul(1.2))).mul(0.5).add(0.5), 2.0)
        .mul(0.7)
        .add(0.3);
    // Recolor completes across the first ~12% of the chapter; the filaments stretch as
    // they recolor (handled by the plane scale below) and are gone by ~18%.
    const recolor = clamp(uApproach.mul(3.2), 0.0, 1.0);
    // ⚠️ THESE WERE LINEAR LITERALS WRITTEN AS IF THEY WERE THE sRGB HEXES BESIDE THEM.
    // `vec3()` is consumed as a LINEAR working-space value, but #3DFF8E linearises to
    // (0.047, 1.000, 0.270) — the shipped (0.24, 1.0, 0.56) carried ~5x the red and ~2x the
    // blue the author named. Same slip on both crimsons.
    //
    // MEASURED consequence (capture arm-limb-v2, p=0.7501): 19.8 % of the frame — about 44 %
    // of every non-black pixel — sat at hue 152, saturation 99-100 %, against a limb frame
    // whose mean lit saturation is 38 %. The post stack's saturation lift (MASTER 1.15 x ch6
    // 1.06) then clipped the red channel to literal 0. This carried-Ch5 aurora, not the
    // nebula field, IS the green wall in that frame; the field's own reveal there is ~0.056.
    //
    // `color()` routes through THREE.Color's colour management, so these now MEAN the hexes.
    const green = tslColor(0x3dff8e); // Ch5's last aurora green
    const crimson = mix(tslColor(0xc71f37), tslColor(0xe8485c), strands);
    // A modest level cut on top. The bridge is additive, so out = colour x alpha and this is
    // numerically identical to trimming the alpha ceiling — but it belongs in colorNode,
    // because the opacityNode is one of the eight bound by the materialOpacity re-arm
    // contract. Cutting alpha alone would fix the LEVEL and leave the hue clipping.
    const toned = mix(green, crimson, recolor);
    // ⚠️ THE HUE FIX ABOVE MAKES THIS MORE VIVID, NOT LESS — it was mis-read once already.
    // The shipped (0.24, 1.0, 0.56) was an accidentally PALE green; the hex it claimed to be
    // linearises to (0.047, 1.000, 0.270), which is further from grey. Correcting the slip is
    // right because the code should mean what it says, but on its own it INCREASES the clash.
    // The desaturation is the term that actually calms the frame, so the two ship together.
    const graded = mix(
        vec3(dot(toned, vec3(0.2126, 0.7152, 0.0722))),
        toned,
        BRIDGE_CHROMA,
    ).mul(BRIDGE_LEVEL);
    const vertical = smoothstep(0.0, 0.3, vUv.y).mul(smoothstep(1.0, 0.2, vUv.y));
    // Linger as a visible aurora across most of the crossing, then dissolve into nebula filaments
    // (was smoothstep(0.22,0.44) → gone by ~18% local progress, too brief to read as the hero aurora).
    const alive = oneMinus(smoothstep(0.5, 0.85, uApproach));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = graded.mul(strands.add(0.4));
    material.opacityNode = vertical.mul(strands).mul(0.46).mul(alive).mul(materialOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    // r181 splits a transparent DoubleSide material into a back-face pass and a front-face
    // pass (Renderer.js:3131), so this material bills TWICE. Blending here is Additive with
    // depthWrite off, which makes the two passes order-independent — the split buys nothing
    // and forceSinglePass reclaims it for free. Precedent: odyssey-planet-aurora.js:301-309.
    material.forceSinglePass = true;
    material.userData.emitsBloom = true;

    // Seats are CORRIDOR-LOCAL (entry ≈ z +150, exit ≈ z −150): the three curtains
    // span the first half of the travel so the camera passes UNDER them while they
    // are still green — the 5→6 greeting — instead of watching them off to one side.
    [
        {
            x: -60, y: 70, z: 60, w: 460, h: 92, rotZ: 0.05,
        },
        {
            x: 40, y: 84, z: -30, w: 540, h: 88, rotZ: -0.04,
        },
        {
            x: -10, y: 92, z: -120, w: 500, h: 80, rotZ: 0.03,
        },
    ].forEach((cfg) => {
        const filament = new THREE.Mesh(new THREE.PlaneGeometry(cfg.w, cfg.h, 1, 1), material);
        filament.position.set(cfg.x, cfg.y, cfg.z);
        filament.rotation.z = cfg.rotZ;
        // Stretched horizontally — curtains elongating into filaments.
        filament.scale.set(1.3, 0.85, 1);
        filament.renderOrder = -9;
        filament.frustumCulled = false;
        group.add(filament);
    });
    return group;
}

/**
 * STREAK-MOTE TIER (creative plan asset 6): rail-hugging elongated additive quads
 * whose streak mask runs along the travel diagonal — the forward-speed cue through
 * the long middle act. GPU-driven wrap (no per-frame CPU).
 */
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
    material.positionNode = billboardWorld(center, 2.6);
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
    material.opacityNode = streak.mul(diveT.mul(0.24).add(0.34)).mul(materialOpacity);
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
// Comet Chase) — a sculpted opaque head + dithered opaque tail sweeping a long chord
// through the reef stretch. Unlevered like the garland: two draws, opaque queue.
// Staging follows the nebula-field pattern: OUTSIDE the entryContinuity buckets
// (setOpacityScale would flip these opaque materials transparent and dead-write
// opacity), on a shared uReveal ticked by update() = staging × reef-window × chord
// end-fade, dissolved by the same screen-space hash dither.
const COMET_PATH = Object.freeze({
    a: new THREE.Vector3(250, 70, -330),
    b: new THREE.Vector3(-270, -50, -790),
    periodSec: 70,
});

function cometDither(uReveal) {
    const hash = fract(
        sin(dot(screenCoordinate.xy.floor(), vec2(12.9898, 78.233))).mul(43758.5453),
    );
    return uReveal.sub(hash).add(0.5);
}

function createComet() {
    const uReveal = uniform(0);
    const group = new THREE.Group();
    group.name = 'comet-chase';

    const keyDir = normalize(uniform(new THREE.Vector3(-0.48, 0.36, -0.62)));
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));

    // Head: 2-band ice paint on the chapter's causal key + a drawn fresnel edge —
    // the asteroid template's language in the witnesses' tiny+sharp register.
    const headMat = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
    headMat.transparent = false;
    headMat.depthWrite = true;
    headMat.alphaTest = 0.5;
    const wrap = float(0.72);
    const d = dot(N, keyDir).add(wrap).div(wrap.add(1));
    const band = smoothstep(0.42, 0.54, d);
    const base = mix(vec3(0.23, 0.30, 0.49), vec3(0.81, 0.91, 0.95), band);
    const edge = vec3(0.95, 0.98, 1.0).mul(clamp(oneMinus(dot(N, V)), 0, 1).pow(2.5).mul(0.5));
    headMat.colorNode = base.add(edge);
    headMat.opacityNode = cometDither(uReveal).mul(materialOpacity);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(6, 1), headMat);
    head.name = 'comet-head';
    group.add(head);

    // Tail: an open cone pointing opposite the travel. ⚠️ ORIENTATION MEASURED, not
    // assumed: on ConeGeometry `uv().y` is 0 at the BASE (local −Y, the end hugging
    // the head) and 1 at the TIP (local +Y, the trailing end) — probed directly, and
    // the first draft had both gradients inverted, painting a tail that dissolved at
    // the nucleus and went solid-bright at its far end. Bright + dense where it
    // leaves the head, cooling and dithering away as it trails.
    const tailMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    tailMat.transparent = false;
    tailMat.depthWrite = true;
    tailMat.alphaTest = 0.5;
    const along = uv().y;
    tailMat.colorNode = mix(vec3(0.85, 0.94, 0.97), vec3(0.35, 0.52, 0.66), along);
    tailMat.opacityNode = cometDither(uReveal.mul(oneMinus(smoothstep(0.25, 0.95, along)))).mul(materialOpacity);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(5, 95, 12, 1, true), tailMat);
    tail.name = 'comet-tail';
    // Cone axis is +Y with the tip at +Y/2; orient so the tip trails the head along
    // the (fixed) chord direction and the open base hugs the head.
    const dir = COMET_PATH.b.clone().sub(COMET_PATH.a).normalize();
    tail.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    tail.position.copy(dir.clone().multiplyScalar(-52));
    group.add(tail);

    group.userData.uReveal = uReveal;
    group.userData.materials = [headMat, tailMat];
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
    group.add(new THREE.AmbientLight(0x141425, 0.5));

    const diskLight = new THREE.PointLight(0xff6a2a, 1.1, 600);
    diskLight.position.set(0, 18, -640);
    group.add(diskLight);
    group.userData.diskLight = diskLight;

    const rimLight = new THREE.DirectionalLight(0x6a4cff, 0.4);
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

    // ── B3b APPROACH OMEN ────────────────────────────────────────────────────────
    // Chapter-local progress (0 entry → 1 at the 6→7 seam). Prefer the camera's ascent
    // through the chapter y-range (mirrors black-hole-transcendence), fall back to the
    // global cameraProgress, then hold at 0 (smoke tests / no camera).
    let approach = 0;
    const { yStart, yEnd } = group.userData;
    if (camera?.position && Number.isFinite(yStart) && Number.isFinite(yEnd) && yEnd !== yStart) {
        approach = THREE.MathUtils.clamp((camera.position.y - yStart) / (yEnd - yStart), 0, 1);
    } else if (Number.isFinite(cameraProgress)) {
        approach = THREE.MathUtils.clamp(cameraProgress, 0, 1);
    }
    const ease = THREE.MathUtils.smoothstep(approach, 0, 1);
    if (uniforms?.uApproach) {
        uniforms.uApproach.value = approach;
    }
    const entryState = resolveCosmicEntryContinuity(approach);
    group.userData.entryContinuityState = entryState;

    // ── EARTH AT THE SUMMIT / SPACE GATE ─────────────────────────────────────────
    // Driven by GLOBAL progress (not `approach`, which is pinned at 0 until the camera
    // climbs past the chapter's yStart around p=0.66 — long after the sky has gone).
    // `earthReveal` fades the gas giant up over the bright Ch5 summit; `spaceReveal`
    // holds the rest of the chapter at zero until the camera is actually in Space, so
    // the early ignite cannot drag stars, the black hole or nebula into the daylight.
    const chapterPositions = getActiveOdysseyChapterPositions();
    const staging = resolveSummitEarthStaging(
        cameraProgress,
        chapterPositions?.[4],
        chapterPositions?.[5],
        chapterPositions?.[6],
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
    // The earth, once shown from the summit, never dips back out (the ask was that we
    // "still see it" once space darkens) — hence max() against the staged hero reveal.
    const earthReveal = Math.max(entryState.heroReveal, staging.earthReveal);

    const { blackHole, debris } = group.userData;
    if (blackHole) {
        // Ever-present DESTINATION OMEN, two phases: loom in the upper-left third
        // (the north star), then DIVE onto the exit flight axis — the rail flies
        // straight into the horizon and the 6→7 threshold takes over.
        const { bhDiveStart } = APPROACH;
        if (ease < bhDiveStart) {
            const t = ease / bhDiveStart;
            blackHole.scale.setScalar(THREE.MathUtils.lerp(APPROACH.bhScaleA, APPROACH.bhScaleB, t));
            blackHole.position.set(
                THREE.MathUtils.lerp(APPROACH.bhXa, APPROACH.bhXb, t),
                THREE.MathUtils.lerp(APPROACH.bhYa, APPROACH.bhYb, t),
                THREE.MathUtils.lerp(APPROACH.bhZa, APPROACH.bhZb, t),
            );
        } else {
            const t = THREE.MathUtils.smoothstep((ease - bhDiveStart) / (1 - bhDiveStart), 0, 1);
            blackHole.scale.setScalar(THREE.MathUtils.lerp(APPROACH.bhScaleB, APPROACH.bhScaleC, t));
            blackHole.position.set(
                THREE.MathUtils.lerp(APPROACH.bhXb, APPROACH.bhXc, t),
                THREE.MathUtils.lerp(APPROACH.bhYb, APPROACH.bhYc, t),
                THREE.MathUtils.lerp(APPROACH.bhZb, APPROACH.bhZc, t),
            );
        }
        // Subtle precession of the whole assembly.
        blackHole.rotation.z -= delta * 0.04;
    }
    if (debris && blackHole) {
        // Keep the infall seated on the hole as it looms.
        debris.position.copy(blackHole.position);
        debris.scale.copy(blackHole.scale);
    }

    const { heroPlanet } = group.userData;
    if (heroPlanet) {
        // March the gas giant toward mid-distance left-third + grow it (radius 28→40).
        heroPlanet.position.set(
            THREE.MathUtils.lerp(APPROACH.planetA.x, APPROACH.planetB.x, ease),
            THREE.MathUtils.lerp(APPROACH.planetA.y, APPROACH.planetB.y, ease),
            THREE.MathUtils.lerp(APPROACH.planetA.z, APPROACH.planetB.z, ease),
        );
        const planetScale = THREE.MathUtils.lerp(APPROACH.planetA.s, APPROACH.planetB.s, ease);
        heroPlanet.scale.setScalar(planetScale);
        heroPlanet.rotation.y += delta * 0.025;
        heroPlanet.rotation.z = Math.sin(time * 0.08) * 0.025;
        // THE AURORA DARKNESS GATE (owner report 2026-08-16). The crown's own night
        // mask only knows the PLANET's terminator; during the ascent the planet's
        // night side faces a bright daylight sky and the curtains blazed at full
        // effect from p≈0.62 (measured). The earth is the ONE element allowed before
        // the boundary — its aurora is not. Both aurora halves share this uniform
        // and arrive with the dark, exactly like every other space element.
        const auroraGate = heroPlanet.userData.uAuroraReveal;
        if (auroraGate) auroraGate.value = spaceReveal;
    }

    const { nebulaVolume, nebulaFar } = group.userData;
    if (nebulaVolume) {
        nebulaVolume.rotation.y += delta * 0.006 * (nebulaVolume.userData.driftScale ?? 1);
    }
    if (nebulaFar) {
        // Far tier drifts MUCH slower for parallax depth.
        nebulaFar.rotation.y += delta * 0.006 * (nebulaFar.userData.driftScale ?? 0.25);
    }

    // DENSE mote field — the per-particle drift runs in-shader off uTime; a gentle group
    // yaw on top (near faster than far) adds bulk parallax as the camera dollies. No
    // per-frame allocation — just two scalar rotation ticks.
    const { dustNear, dustFar } = group.userData;
    if (dustNear) {
        dustNear.rotation.y += delta * 0.010 * (dustNear.userData.driftScale ?? 1);
    }
    if (dustFar) {
        dustFar.rotation.y += delta * 0.010 * (dustFar.userData.driftScale ?? 0.38);
    }

    const { galaxy } = group.userData;
    if (galaxy) {
        // March the galaxy inward toward frame so it stays a crisp focal point.
        _approachVec.set(
            THREE.MathUtils.lerp(APPROACH.galaxyA.x, APPROACH.galaxyB.x, ease),
            THREE.MathUtils.lerp(APPROACH.galaxyA.y, APPROACH.galaxyB.y, ease),
            THREE.MathUtils.lerp(APPROACH.galaxyA.z, APPROACH.galaxyB.z, ease),
        );
        galaxy.position.copy(_approachVec);
        galaxy.scale.setScalar(THREE.MathUtils.lerp(APPROACH.galaxyA.s, APPROACH.galaxyB.s, ease));
        // Slow billboard roll so the spiral arms turn (the quad stays camera-facing
        // via billboardWorld, but its z-roll spins the sprite's uv frame).
        galaxy.rotation.z += delta * 0.012;
    }

    const { diskLight } = group.userData;
    if (diskLight) {
        const lightReveal = Math.max(entryState.destinationReveal, entryState.nebulaReveal * 0.75)
            * spaceReveal;
        diskLight.intensity = (
            1.0 + Math.sin(time * 0.7) * 0.25 + (uniforms?.uEnergy?.value ?? 0) * 0.4
        ) * lightReveal;
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
    // `spaceArrival` (not raw nebulaReveal) — see THE 5->6 HAND-OFF above.
    const voidSkyOpacity = spaceArrival * spaceReveal * chapterOpacity;
    if (uniforms?.uVoidSkyOpacity) {
        uniforms.uVoidSkyOpacity.value = voidSkyOpacity;
    }
    if (group.userData.voidSky) {
        group.userData.voidSky.visible = voidSkyOpacity > 0.002;
    }

    // The sculpted nebula field stages itself OUTSIDE the entryContinuity buckets:
    // setOpacityScale would flip its opaque material transparent and write the dead
    // `material.opacity` (opacityNode owns opacity in r181). Same staging product,
    // delivered as a uniform driving the dithered opaque dissolve.
    const nebulaFieldMesh = group.userData.nebulaField;
    if (nebulaFieldMesh?.userData?.uReveal) {
        const fieldReveal = spaceArrival * spaceReveal * chapterOpacity;
        nebulaFieldMesh.userData.uReveal.value = fieldReveal;
        nebulaFieldMesh.visible = fieldReveal > 0.002;
    }

    // The comet sweeps its chord on a fixed period, alive only through the reef
    // window (chapter-local ~0.28-0.74) and dither-faded at the chord's ends so it
    // enters and leaves as a distant glint, never a pop.
    const comet = group.userData.comet;
    if (comet?.userData?.uReveal) {
        const s = (time % COMET_PATH.periodSec) / COMET_PATH.periodSec;
        comet.position.lerpVectors(COMET_PATH.a, COMET_PATH.b, s);
        const endFade = THREE.MathUtils.smoothstep(s, 0, 0.1)
            * (1 - THREE.MathUtils.smoothstep(s, 0.9, 1));
        const reefWindow = THREE.MathUtils.smoothstep(approach, 0.28, 0.38)
            * (1 - THREE.MathUtils.smoothstep(approach, 0.62, 0.74));
        const cometReveal = entryState.clutterReveal * spaceReveal * chapterOpacity
            * reefWindow * endFade;
        comet.userData.uReveal.value = cometReveal;
        comet.visible = cometReveal > 0.02;
    }

    const entryTargets = group.userData.entryContinuity;
    if (entryTargets) {
        entryTargets.stars.forEach((object) => setOpacityScale(
            object,
            entryState.starReveal * spaceReveal,
            chapterOpacity,
        ));
        entryTargets.destination.forEach((object) => setOpacityScale(
            object,
            entryState.destinationReveal * spaceReveal,
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
            entryState.nebulaReveal * spaceReveal,
            chapterOpacity,
        ));
        entryTargets.clutter.forEach((object) => setOpacityScale(
            object,
            entryState.clutterReveal * spaceReveal,
            chapterOpacity,
        ));
        entryTargets.bridge.forEach((object) => setOpacityScale(object, spaceReveal, chapterOpacity));
    }
}

export default {
    config: COSMIC_EXPANSE_CONFIG,
    create: createCosmicExpanseEnvironment,
    update: updateCosmicExpanseEnvironment,
};
