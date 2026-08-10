import * as THREE from 'three/webgpu';
import { ODYSSEY_PATH_DATA } from './path-data.js';

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
        activeChapterPositions = [...nextChapterPositions];
        frozenChapterPositions = Object.freeze(activeChapterPositions.slice());
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

export function buildOdysseyPathCurve(pathData = ODYSSEY_PATH_DATA) {
    const sourcePoints = pathData === ODYSSEY_PATH_DATA
        ? activeControlPoints
        : pathData.controlPoints;
    const points = sourcePoints.map(
        (point) => new THREE.Vector3(point.x, point.y, point.z),
    );
    const curve = new THREE.CatmullRomCurve3(points);
    curve.curveType = ODYSSEY_PATH_CURVE_TYPE;
    curve.tension = ODYSSEY_PATH_TENSION;
    return curve;
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

export function getChapterPathRange(chapterId) {
    const startPosition = activeChapterPositions[chapterId - 1];
    if (startPosition === undefined) return null;

    const endPosition = activeChapterPositions[chapterId] ?? 1;
    const start = getOdysseyPathPointAt(startPosition);
    const end = getOdysseyPathPointAt(endPosition);
    const center = start.clone().add(end).multiplyScalar(0.5);

    return { start, end, center };
}
