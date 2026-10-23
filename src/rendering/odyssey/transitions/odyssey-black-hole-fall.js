/**
 * THE FALL — chapter 7's schedule, as one pure function of path progress (2026-10-02).
 *
 * The owner's brief: "the black hole floats right next to the journey — I want to be sucked into
 * it and have amazing warp effects while inside." Gargantua stays CAMERA-LOCKED (a world-parked
 * hero slid out of frame on ch7's hairpin and kinks and left the chapter ~75 % black — the reason
 * the lock exists), but its ANGULAR SIZE is now authored by progress: it grows from the lock's
 * 8.3 deg radius until it swallows the frustum, drifting to dead centre as it comes. Its surface is a window onto the singularity's interior (the warp tunnel), which fades in
 * as the shadow fills the frame — so "inside" is reached without a cut. The accretion disk's plane
 * sweeps through edge-on on the way (the disk-plane crossing), and the camera picks up a gentle,
 * progress-driven forward pull, roll and a widening FOV (frame dragging / speed), all zero at the chapter's
 * start and back to exactly zero where the 7->8 window opens (the city's stage alignment needs an
 * unrolled basis).
 *
 * Every consumer (the hero pose, the window shader, the post lens/bloom, the camera framing) reads
 * this one function, so they cannot drift out of step.
 *
 * THE DIVE IS AT LEVEL 49 (2026-10-22). Olov: "I dont want to see any of the path behind it before
 * we really get into the black hole." Spread over levels 49-52, the fall left levels 50-52 and the
 * rail between them in front of the growing hole, drawn across its face, and the journey's
 * remaining path was laid out before the eye was inside. The whole plunge now happens on the glide
 * from level 49 (the mouth, where chapter 6's rail runs into the hole's centre) to level 50: every
 * stage keeps its order and shape, scaled onto a horizon just before level 50, and the path past
 * level 49 is laid out only once the eye is inside (odyssey-path-horizon.js). The camera's pull,
 * roll and widening FOV are unchanged: they build inside the warp and settle before the city.
 */

import { seamHalfWidth, smooth01, smoother01 } from './odyssey-seam-schedule.js';

const DEG = Math.PI / 180;

/** The lock's geometry (mirrors GARGANTUA_LOCK; duplicated here so the camera need not import a
 * chapter environment). */
const LOCK_DEPTH = 900;
// The rail runs into the hole's centre (GARGANTUA_LOCK, 2026-10-22: was 150 up / 26 right).
const LOCK_UP = 29;
const LOCK_RIGHT = 4;
const SHADOW_RADIUS = 132;
const LOCK_DISTANCE = Math.hypot(LOCK_DEPTH, LOCK_UP, LOCK_RIGHT);

// The plunge's schedule was authored for a horizon at local 0.44 (just past level 52); it is now
// that schedule scaled onto 0.105, just before level 50 (local 0.14). One factor, so every stage
// keeps its place in the plunge.
const PLUNGE = 0.105 / 0.44;

export const CH7_FALL = Object.freeze({
    /** Local ch7 progress (0 = level 49 / ch7 start, 1 = ch8 start) where the frustum is
     * swallowed: just before level 50 (local 0.14), so the plunge is the glide from level 49. */
    horizon: 0.44 * PLUNGE,
    /** Angular radius of the shadow at rest (the lock: 8.3 deg) and at the horizon (covers a
     * 70 deg-FOV frustum's corners with margin). */
    restAlpha: Math.asin(SHADOW_RADIUS / LOCK_DISTANCE),
    horizonAlpha: 72 * DEG,
    /** Growth exponent on u = local/horizon: slow at first, then the plunge. */
    growth: 1.9,
    /** The shadow's near surface never comes closer than this to the eye, so the rail and the
     * level nodes (all within ~100 u) always draw in front of it. */
    nearSurface: 150,
    /** Local progress by which the hole has drifted onto the view axis. */
    centred: 0.3 * PLUNGE,
    /** The window onto the interior opens over this u range (u = local/horizon). 0.55 until the
     * 2026-10-20 overhaul: the shadow had swallowed most of the frame (local 0.3, ~50 deg) while
     * the window was still ~80 % black — a dead frame at the crossing. It now glimmers from where
     * the shadow is ~22 deg (u 0.46), so the interior is already moving by then. */
    portalFrom: 0.46,
    portalTo: 1.0,
    /** The disk-plane crossing: the band's tilt sweeps through edge-on. */
    diskTiltRest: 0.10,
    diskTiltAfter: -0.14,
    diskCrossFrom: 0.14 * PLUNGE,
    diskCrossTo: 0.34 * PLUNGE,
    /** The band, its fold arcs and the embers fade out once the disk has swept past. */
    bandFadeFrom: 0.30 * PLUNGE,
    bandFadeTo: 0.44 * PLUNGE,
    /** The warp (streak speed / zoom) ramps up across the horizon. */
    warpFrom: 0.36 * PLUNGE,
    warpTo: 0.52 * PLUNGE,
    /** "Inside": from this far before the horizon, over this span (the far stars and the dome
     * stop drawing once the window covers every pixel). */
    insideLead: 0.04 * PLUNGE,
    insideSpan: 0.06 * PLUNGE,
    /** Camera: a brief compression gives the attraction weight before the horizon rush. */
    fovCompressionDeg: 2.2,
    /** Frame dragging and speed stay bounded; the camera never changes logical rail progress. */
    rollPeakDeg: 14,
    fovPeakDeg: 10,
    camForwardPeak: 6.5,
});

const REST = Object.freeze({
    active: false,
    local: 0,
    u: 0,
    alpha: CH7_FALL.restAlpha,
    centring: 0,
    portal: 0,
    diskTilt: CH7_FALL.diskTiltRest,
    band: 1,
    warp: 0,
    inside: 0,
    rollDeg: 0,
    fovOffset: 0,
    camForward: 0,
});

/** The fall at rest (before ch7, or with no layout): the plain camera lock. */
export function blackHoleFallAtRest() {
    return { ...REST };
}

/**
 * Local ch7 progress at which the 7->8 window opens (the camera's city alignment starts there,
 * so the camera's pull, roll and FOV must be back to zero by then).
 * @param {number[]} chapterPositions
 * @returns {number|null}
 */
export function resolveBlackHoleFallExit(chapterPositions) {
    const ch7Start = chapterPositions?.[6];
    const ch8Start = chapterPositions?.[7];
    if (!Number.isFinite(ch7Start) || !Number.isFinite(ch8Start) || ch8Start <= ch7Start) return null;
    const windowStart = ch8Start - seamHalfWidth(7);
    return (windowStart - ch7Start) / (ch8Start - ch7Start);
}

/**
 * The camera's share of the fall, from LOCAL ch7 progress alone (the camera's framing resolver
 * receives in-chapter progress). Attraction briefly compresses the lens, the plunge pushes
 * the eye forward and widens it, and the warp holds that momentum before easing to rest.
 * All envelopes have zero slope at their joins and at both seams. Phase positions are relative
 * to the LIVE exit, so a shorter chapter still settles before the city begins revealing.
 * @param {number} local in-chapter progress (0 = ch7 start)
 * @param {number} [exit] local progress where the 7->8 window opens
 * @returns {{ rollDeg: number, fovOffset: number, camForward: number }}
 */
export function resolveBlackHoleFallCamera(local, exit = 0.82) {
    if (!Number.isFinite(local) || !Number.isFinite(exit) || exit <= 0 || local <= 0 || local >= exit) {
        return { rollDeg: 0, fovOffset: 0, camForward: 0 };
    }
    const phase = local / exit;
    const compression = smoother01(phase / 0.18)
        * (1 - smoother01((phase - 0.18) / 0.22));
    const pull = smoother01((phase - 0.10) / 0.46)
        * (1 - smoother01((phase - 0.74) / 0.26));
    const rush = smoother01((phase - 0.20) / 0.38)
        * (1 - smoother01((phase - 0.74) / 0.26));
    const drag = smoother01((phase - 0.06) / 0.46)
        * (1 - smoother01((phase - 0.66) / 0.34));
    return {
        rollDeg: CH7_FALL.rollPeakDeg * drag,
        fovOffset: CH7_FALL.fovPeakDeg * rush - CH7_FALL.fovCompressionDeg * compression,
        camForward: CH7_FALL.camForwardPeak * pull,
    };
}

/**
 * The whole fall at a path progress.
 * @param {number} progress absolute path progress
 * @param {number[]} chapterPositions live chapter boundaries
 * @returns {{active:boolean, local:number, u:number, alpha:number, centring:number, portal:number,
 *   diskTilt:number, band:number, warp:number, inside:number, rollDeg:number, fovOffset:number,
 *   camForward:number}}
 */
export function resolveBlackHoleFall(progress, chapterPositions) {
    const ch7Start = chapterPositions?.[6];
    const ch8Start = chapterPositions?.[7];
    if (!Number.isFinite(progress) || !Number.isFinite(ch7Start) || !Number.isFinite(ch8Start)
        || ch8Start <= ch7Start) {
        return blackHoleFallAtRest();
    }
    const local = (progress - ch7Start) / (ch8Start - ch7Start);
    if (local <= 0) return { ...REST, local };
    const F = CH7_FALL;
    const u = Math.min(1, local / F.horizon);
    const alpha = F.restAlpha + ((F.horizonAlpha - F.restAlpha) * (u ** F.growth));
    const exit = resolveBlackHoleFallExit(chapterPositions) ?? 0.82;
    const camera = resolveBlackHoleFallCamera(local, exit);
    return {
        active: true,
        local,
        u,
        alpha,
        centring: smooth01(local / F.centred),
        portal: smooth01((u - F.portalFrom) / (F.portalTo - F.portalFrom)),
        diskTilt: F.diskTiltRest + ((F.diskTiltAfter - F.diskTiltRest)
            * smoother01((local - F.diskCrossFrom) / (F.diskCrossTo - F.diskCrossFrom))),
        band: 1 - smooth01((local - F.bandFadeFrom) / (F.bandFadeTo - F.bandFadeFrom)),
        warp: smooth01((local - F.warpFrom) / (F.warpTo - F.warpFrom)),
        inside: smooth01((local - (F.horizon - F.insideLead)) / F.insideSpan),
        rollDeg: camera.rollDeg,
        fovOffset: camera.fovOffset,
        camForward: camera.camForward,
    };
}

/**
 * The path progress at which the eye is wholly inside the hole (the fall's `inside` reaches 1):
 * the path past the mouth is laid out only from here (odyssey-path-horizon.js).
 * @param {number[]} chapterPositions live chapter boundaries
 * @returns {number|null} null without a usable layout
 */
export function resolveBlackHoleInsideProgress(chapterPositions) {
    const ch7Start = chapterPositions?.[6];
    const ch8Start = chapterPositions?.[7];
    if (!Number.isFinite(ch7Start) || !Number.isFinite(ch8Start) || ch8Start <= ch7Start) return null;
    const F = CH7_FALL;
    return ch7Start + ((ch8Start - ch7Start) * (F.horizon - F.insideLead + F.insideSpan));
}

/**
 * THE PLUNGE TAKES ITS TIME (2026-10-23). Olov: "it feels like the orb path just quits before we
 * go into the black hole". A trip between orbs eases over ~1 s, and the plunge (the mouth to the
 * eye being inside) was a third of the 48 -> 49 trip, in its middle, where the ease runs fastest:
 * the hole grew from 8 deg to swallowing the frame in ~0.12 s — seven frames, a cut. Every path
 * travel now spends its time as if the plunge were `dwell` times longer (the camera controller's
 * travel eases in this measure, not in progress), and a short trip through it is given `extraMs`
 * more: the hole looms, the rail's inflow draws the eye in, and the photon ring sweeps past the
 * frame over ~1.4 s, then the tunnel takes the eye on at full speed.
 */
export const CH7_PLUNGE_TRAVEL = Object.freeze({
    /** How much more a unit of progress through the plunge weighs than open path. */
    dwell: 12,
    /** Progress over which that weight eases in before the mouth and out after the inside point. */
    shoulder: 0.004,
    /** Time added to a trip that crosses the whole plunge... */
    extraMs: 2600,
    /** ...in full up to this trip length (progress), fading to none by `longTrip + longFade`
     * (a trip across the journey has seconds of its own to spend in the hole). */
    longTrip: 0.04,
    longFade: 0.1,
});

/**
 * The plunge stretch: from the mouth (chapter 7's start) to where the eye is inside the hole.
 * @param {number[]} chapterPositions live chapter boundaries
 * @returns {{ from: number, to: number }|null} null without a usable layout
 */
export function resolvePlungeStretch(chapterPositions) {
    const inside = resolveBlackHoleInsideProgress(chapterPositions);
    if (!Number.isFinite(inside)) return null;
    return { from: chapterPositions[6], to: inside };
}

// ∫0..x of smooth01: x^3 - x^4 / 2 (so 1/2 over a whole shoulder).
const shoulderArea = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return (t ** 3) - ((t ** 4) / 2);
};

/**
 * The travel measure of progress `p`: progress itself plus the plunge's extra weight up to `p`
 * (monotone, so it inverts). Travel eased in this measure slows through the plunge.
 * @param {number} p path progress
 * @param {number[]} chapterPositions live chapter boundaries
 * @returns {number}
 */
export function plungeTravelMeasure(p, chapterPositions) {
    const stretch = resolvePlungeStretch(chapterPositions);
    if (!stretch || !Number.isFinite(p)) return p;
    const { dwell, shoulder: s } = CH7_PLUNGE_TRAVEL;
    const a = stretch.from;
    const b = stretch.to;
    let area;
    if (p <= a - s) area = 0;
    else if (p <= a) area = s * shoulderArea((p - (a - s)) / s);
    else if (p <= b) area = (s / 2) + (p - a);
    else {
        const x = Math.min(1, (p - b) / s);
        area = (s / 2) + (b - a) + (s * (x - shoulderArea(x)));
    }
    return p + ((dwell - 1) * area);
}

/**
 * The progress at travel measure `m` (the inverse of plungeTravelMeasure).
 * @param {number} m travel measure
 * @param {number[]} chapterPositions live chapter boundaries
 * @returns {number}
 */
export function plungeTravelProgress(m, chapterPositions) {
    if (!resolvePlungeStretch(chapterPositions) || !Number.isFinite(m)) return m;
    // The measure grows at least as fast as progress, so the answer lies in [m - extra, m].
    let lo = m - ((CH7_PLUNGE_TRAVEL.dwell - 1) * 1.01);
    let hi = m;
    for (let i = 0; i < 48; i += 1) {
        const mid = (lo + hi) / 2;
        if (plungeTravelMeasure(mid, chapterPositions) < m) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/**
 * Whether a trip between `p0` and `p1` passes through the plunge's weighted stretch at all.
 * @returns {boolean}
 */
export function plungeTravelTouches(p0, p1, chapterPositions) {
    const stretch = resolvePlungeStretch(chapterPositions);
    if (!stretch || !Number.isFinite(p0) || !Number.isFinite(p1)) return false;
    const s = CH7_PLUNGE_TRAVEL.shoulder;
    return Math.max(p0, p1) > stretch.from - s && Math.min(p0, p1) < stretch.to + s;
}

/**
 * The time a trip between `p0` and `p1` is given on top of its own for the plunge (ms).
 * @returns {number}
 */
export function plungeTravelExtraMs(p0, p1, chapterPositions) {
    const stretch = resolvePlungeStretch(chapterPositions);
    if (!stretch || !Number.isFinite(p0) || !Number.isFinite(p1)) return 0;
    const lo = Math.min(p0, p1);
    const hi = Math.max(p0, p1);
    const crossed = Math.max(0, Math.min(hi, stretch.to) - Math.max(lo, stretch.from)) / (stretch.to - stretch.from);
    const T = CH7_PLUNGE_TRAVEL;
    const short = 1 - smooth01(((hi - lo) - T.longTrip) / T.longFade);
    return T.extraMs * crossed * short;
}

/**
 * How far ahead of the eye the hero's centre must sit so that a shadow of angular radius `alpha`
 * keeps its near surface at least `nearSurface` away: never closer than the lock itself.
 * @param {number} alpha angular radius (rad)
 * @returns {number} distance along the view axis
 */
export function resolveBlackHoleFallDepth(alpha) {
    const s = Math.sin(Math.max(0, Math.min(alpha, 89 * DEG)));
    return Math.max(LOCK_DEPTH, CH7_FALL.nearSurface / Math.max(1e-3, 1 - s));
}

export const CH7_FALL_LOCK = Object.freeze({
    depth: LOCK_DEPTH, up: LOCK_UP, right: LOCK_RIGHT, shadowRadius: SHADOW_RADIUS, distance: LOCK_DISTANCE,
});
