import * as THREE from 'three/webgpu';
import { ODYSSEY_PATH_DATA } from './path-data.js';
import { createOdysseyPathCurve } from './odyssey-path-stretch.js';

export const ODYSSEY_PATH_CURVE_TYPE = 'catmullrom';
export const ODYSSEY_PATH_TENSION = 0.3;
export const ODYSSEY_SURFACE_BREAKOUT_Y_OFFSET = 10;

let cachedCurve = null;
let activeControlPoints = ODYSSEY_PATH_DATA.controlPoints.map((point) => ({ ...point }));
let activeChapterPositions = [...(ODYSSEY_PATH_DATA.chapterPositions || [])];
// Wave-0 E: getActiveOdysseyChapterPositions() sits on the per-frame hot path (called via
// default args ~5×/frame in Ch3, 2× in Ch4, 1× in Ch5), and used to clone a fresh array on
// every call → steady 60 fps GC pressure. The positions only change when the path layout is
// re-authored, so cache a FROZEN copy and hand out that shared reference. Callers read it
// read-only (verified — none sort/push/mutate it); the freeze turns any accidental mutation
// into a throw instead of silently corrupting the source. Rebuilt only in set/reset below.
let frozenChapterPositions = Object.freeze(activeChapterPositions.slice());

function cloneControlPoints(controlPoints = []) {
    return controlPoints.map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
        z: Number(point.z),
    }));
}

export function setOdysseyPathLayout(layout = {}) {
    const nextControlPoints = Array.isArray(layout.controlPoints) && layout.controlPoints.length >= 2
        ? cloneControlPoints(layout.controlPoints)
        : null;
    const nextChapterPositions = Array.isArray(layout.chapterPositions)
        ? layout.chapterPositions.filter((position) => Number.isFinite(position))
        : null;

    if (nextControlPoints) {
        activeControlPoints = nextControlPoints;
        cachedCurve = null;
    }

    if (nextChapterPositions && nextChapterPositions.length >= 2) {
        // The fold's stretch is placed by chapter 7's boundaries: a new curve when they move.
        const moved = nextChapterPositions.length !== activeChapterPositions.length
            || nextChapterPositions.some((position, index) => position !== activeChapterPositions[index]);
        activeChapterPositions = [...nextChapterPositions];
        frozenChapterPositions = Object.freeze(activeChapterPositions.slice());
        if (moved) cachedCurve = null;
    }
}

export function resetOdysseyPathLayout() {
    activeControlPoints = cloneControlPoints(ODYSSEY_PATH_DATA.controlPoints || []);
    activeChapterPositions = [...(ODYSSEY_PATH_DATA.chapterPositions || [])];
    frozenChapterPositions = Object.freeze(activeChapterPositions.slice());
    cachedCurve = null;
}

export function getActiveOdysseyPathData() {
    return {
        ...ODYSSEY_PATH_DATA,
        controlPoints: cloneControlPoints(activeControlPoints),
        chapterPositions: [...activeChapterPositions],
    };
}

export function getActiveOdysseyChapterPositions() {
    return frozenChapterPositions;
}

/**
 * `?odysseyFoldStretch=0`: the shorter rail through chapter 7 too; `?odysseyCityStretch=0`: the
 * shorter rail through chapter 8 too (A/B captures; odyssey-path-stretch.js).
 */
function readStretchFlag(name) {
    if (typeof window === 'undefined' || !window.location?.search) return true;
    const value = new URLSearchParams(window.location.search).get(name)?.toLowerCase();
    return !(value === '0' || value === 'false' || value === 'off');
}

export function buildOdysseyPathCurve(pathData = ODYSSEY_PATH_DATA) {
    const sourcePoints = pathData === ODYSSEY_PATH_DATA
        ? activeControlPoints
        : pathData.controlPoints;
    const points = sourcePoints.map(
        (point) => new THREE.Vector3(point.x, point.y, point.z),
    );
    // Chapter 7's middle (the fold) and chapter 8 after its seam (the city) are longer in the
    // world than their share of progress: the same curve everywhere else (odyssey-path-stretch.js).
    const chapterPositions = pathData === ODYSSEY_PATH_DATA
        ? activeChapterPositions
        : pathData.chapterPositions;
    return createOdysseyPathCurve(
        points,
        ODYSSEY_PATH_CURVE_TYPE,
        ODYSSEY_PATH_TENSION,
        chapterPositions,
        { fold: readStretchFlag('odysseyFoldStretch'), city: readStretchFlag('odysseyCityStretch') },
    );
}

export function getOdysseyPathCurve(pathData = ODYSSEY_PATH_DATA) {
    if (pathData !== ODYSSEY_PATH_DATA) {
        return buildOdysseyPathCurve(pathData);
    }

    if (!cachedCurve) {
        cachedCurve = buildOdysseyPathCurve(getActiveOdysseyPathData());
    }

    return cachedCurve;
}

export function getOdysseyPathPointAt(position) {
    const curve = getOdysseyPathCurve();
    const t = THREE.MathUtils.clamp(position ?? 0, 0, 1);
    return curve.getPointAt(t);
}

/**
 * A point on TODAY'S rail (the curve's `baseCurve`): what the One World (Act II's island, its
 * forest, clouds, sea and rocks) was baked and measured against. Its rail samples span the whole
 * journey, and the longer rails inside the black hole and through the city (odyssey-path-stretch.js)
 * swing out over the island's far ground (the fold's spiral reaches z -1290) where they would
 * promote far trees to the hero tier for chapters that never show the island. The forest's
 * visibility stamp reads the same rail (odyssey-forest-visibility-stamp.js).
 * @param {number} position progress 0..1
 * @returns {THREE.Vector3}
 */
export function getOdysseyWorldRailPointAt(position) {
    const curve = getOdysseyPathCurve();
    const t = THREE.MathUtils.clamp(position ?? 0, 0, 1);
    return (curve.baseCurve ?? curve).getPointAt(t);
}

/**
 * A chapter's ends and centre, where its set piece is anchored. Read on TODAY'S rail (the curve's
 * `baseCurve`): the longer rails (odyssey-path-stretch.js) leave every chapter boundary where it
 * was but the journey's end, which the city's carried rail moves on down the boulevard; the city,
 * its Retrosun and the camera's stage frame stay where they were authored.
 */
export function getChapterPathRange(chapterId) {
    const startPosition = activeChapterPositions[chapterId - 1];
    if (startPosition === undefined) return null;

    const endPosition = activeChapterPositions[chapterId] ?? 1;
    const curve = getOdysseyPathCurve();
    const rail = curve.baseCurve ?? curve;
    const start = rail.getPointAt(THREE.MathUtils.clamp(startPosition, 0, 1));
    const end = rail.getPointAt(THREE.MathUtils.clamp(endPosition, 0, 1));
    const center = start.clone().add(end).multiplyScalar(0.5);

    return { start, end, center };
}
