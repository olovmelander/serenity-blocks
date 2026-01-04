import * as THREE from 'three';
import { JOURNEY_PATH_DATA } from './path-data.js';

let cachedCurve = null;

export function getJourneyPathCurve() {
    if (!cachedCurve) {
        const points = JOURNEY_PATH_DATA.controlPoints.map(
            (point) => new THREE.Vector3(point.x, point.y, point.z),
        );
        const curve = new THREE.CatmullRomCurve3(points);
        curve.curveType = 'catmullrom';
        curve.tension = 0.5;
        cachedCurve = curve;
    }

    return cachedCurve;
}

export function getJourneyPathPointAt(position) {
    const curve = getJourneyPathCurve();
    const t = THREE.MathUtils.clamp(position ?? 0, 0, 1);
    return curve.getPointAt(t);
}

export function getChapterPathRange(chapterId) {
    const positions = JOURNEY_PATH_DATA.chapterPositions || [];
    const startPosition = positions[chapterId - 1];
    if (startPosition === undefined) return null;

    const endPosition = positions[chapterId] ?? 1;
    const start = getJourneyPathPointAt(startPosition);
    const end = getJourneyPathPointAt(endPosition);
    const center = start.clone().add(end).multiplyScalar(0.5);

    return { start, end, center };
}
