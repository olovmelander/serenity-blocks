/**
 * THE FALL — chapter 7's schedule, as one pure function of path progress (2026-10-02).
 *
 * The owner's brief: "the black hole floats right next to the journey — I want to be sucked into
 * it and have amazing warp effects while inside." Gargantua stays CAMERA-LOCKED (a world-parked
 * hero slid out of frame on ch7's hairpin and kinks and left the chapter ~75 % black — the reason
 * the lock exists), but its ANGULAR SIZE is now authored by progress: it grows from the lock's
 * 8.3 deg radius until it swallows the frustum just past level 52, drifting to dead centre as it
 * comes. Its surface is a window onto the singularity's interior (the warp tunnel), which fades in
 * as the shadow fills the frame — so "inside" is reached without a cut. The accretion disk's plane
 * sweeps through edge-on on the way (the disk-plane crossing), and the camera picks up a gentle,
 * progress-driven forward pull, roll and a widening FOV (frame dragging / speed), all zero at the chapter's
 * start and back to exactly zero where the 7->8 window opens (the city's stage alignment needs an
 * unrolled basis).
 *
 * Every consumer (the hero pose, the window shader, the post lens/bloom, the camera framing) reads
 * this one function, so they cannot drift out of step.
 */

import { seamHalfWidth, smooth01, smoother01 } from './odyssey-seam-schedule.js';

const DEG = Math.PI / 180;

/** The lock's geometry (mirrors GARGANTUA_LOCK; duplicated here so the camera need not import a
 * chapter environment). */
const LOCK_DEPTH = 900;
const LOCK_UP = 150;
const LOCK_RIGHT = 26;
const SHADOW_RADIUS = 132;
const LOCK_DISTANCE = Math.hypot(LOCK_DEPTH, LOCK_UP, LOCK_RIGHT);

export const CH7_FALL = Object.freeze({
    /** Local ch7 progress (0 = level 49 / ch7 start, 1 = ch8 start) where the frustum is
     * swallowed: just past level 52 (local 0.4286). */
    horizon: 0.44,
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
    centred: 0.3,
    /** The window onto the interior opens over this u range (u = local/horizon). */
    portalFrom: 0.55,
    portalTo: 1.0,
    /** The disk-plane crossing: the band's tilt sweeps through edge-on. */
    diskTiltRest: 0.10,
    diskTiltAfter: -0.14,
    diskCrossFrom: 0.14,
    diskCrossTo: 0.34,
    /** The band, its fold arcs and the embers fade out once the disk has swept past. */
    bandFadeFrom: 0.30,
    bandFadeTo: 0.44,
    /** The warp (streak speed / zoom) ramps up across the horizon. */
    warpFrom: 0.36,
    warpTo: 0.52,
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
        inside: smooth01((local - (F.horizon - 0.04)) / 0.06),
        rollDeg: camera.rollDeg,
        fovOffset: camera.fovOffset,
        camForward: camera.camForward,
    };
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
