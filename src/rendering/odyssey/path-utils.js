import * as THREE from 'three';
import { ODYSSEY_PATH_DATA } from './path-data.js';

let cachedCurve = null;

export function getOdysseyPathCurve() {
    if (!cachedCurve) {
        const points = ODYSSEY_PATH_DATA.controlPoints.map(
            (point) => new THREE.Vector3(point.x, point.y, point.z),
        );
        const curve = new THREE.CatmullRomCurve3(points);
        curve.curveType = 'catmullrom';
        curve.tension = 0.5;
        cachedCurve = curve;
    }

    return cachedCurve;
}

export function getOdysseyPathPointAt(position) {
    const curve = getOdysseyPathCurve();
    const t = THREE.MathUtils.clamp(position ?? 0, 0, 1);
    return curve.getPointAt(t);
}

export function getChapterPathRange(chapterId) {
    const positions = ODYSSEY_PATH_DATA.chapterPositions || [];
    const startPosition = positions[chapterId - 1];
    if (startPosition === undefined) return null;

    const endPosition = positions[chapterId] ?? 1;
    const start = getOdysseyPathPointAt(startPosition);
    const end = getOdysseyPathPointAt(endPosition);
    const center = start.clone().add(end).multiplyScalar(0.5);

    return { start, end, center };
}
