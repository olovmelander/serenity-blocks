/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * ROUND ON SCREEN (2026-11-02). Olov's polish list: "The nearest orb looks egg-shaped at the bottom
 * edge of the screen." A flat perspective projection stretches anything off the view's centre
 * along the line from the centre: a ball at angle theta off the axis draws as an oval 1 / cos theta
 * longer that way. The orb the eye has just left, close and at the foot of the frame, read as an
 * egg (~1.2 : 1). Each orb part's vertices are taken into view space and squeezed about the orb's
 * centre by cos theta along that direction (in the plane of the axis and the ray to the orb, square
 * to the ray), which cancels the stretch: the orb draws round wherever it is in the frame. Only its
 * outline moves; its depth along the ray and its shading are untouched.
 */
import {
    cameraViewMatrix, cameraWorldMatrix, dot, length, max, normalize, oneMinus, vec3, vec4,
} from 'three/tsl';

/** Off-axis cosines below this are held here (an orb far round the side is not squeezed flat). */
export const ORB_ROUND_MIN_COS = 0.25;

/**
 * A world position on an orb, squeezed so the orb draws round on screen.
 * @param {*} position vec3 node: the vertex, world space
 * @param {*} centre vec3 node: the orb's centre, world space
 * @returns {*} vec3 node: the vertex, world space
 */
export function roundOnScreen(position, centre) {
    const c = cameraViewMatrix.mul(vec4(centre, 1.0)).xyz.toVar();
    const p = cameraViewMatrix.mul(vec4(position, 1.0)).xyz;
    const n = normalize(c);
    const cosT = max(n.z.negate(), ORB_ROUND_MIN_COS);
    // The view axis made square to the ray: the way the projection stretches the orb.
    const across = vec3(n.x.mul(n.z), n.y.mul(n.z), n.z.mul(n.z).sub(1.0));
    const e = across.div(max(length(across), 1e-5));
    const d = p.sub(c);
    const squeezed = d.sub(e.mul(dot(d, e).mul(oneMinus(cosT))));
    return cameraWorldMatrix.mul(vec4(c.add(squeezed), 1.0)).xyz;
}

/**
 * The same squeeze on the CPU (tests, raycasts): `out` = `position` squeezed about `centre` for a
 * camera with world matrix `cameraMatrixWorld` and its inverse.
 * @param {import('three').Vector3} position world
 * @param {import('three').Vector3} centre world
 * @param {import('three').Camera} camera with up-to-date matrixWorld / matrixWorldInverse
 * @param {import('three').Vector3} out
 * @returns {import('three').Vector3} out
 */
export function roundOnScreenCpu(position, centre, camera, out) {
    const c = centre.clone().applyMatrix4(camera.matrixWorldInverse);
    const p = position.clone().applyMatrix4(camera.matrixWorldInverse);
    const n = c.clone().normalize();
    const cosT = Math.max(-n.z, ORB_ROUND_MIN_COS);
    const e = n.clone().multiplyScalar(n.z).setZ((n.z * n.z) - 1);
    const len = e.length();
    if (len > 1e-5) e.divideScalar(len);
    const d = p.sub(c);
    d.addScaledVector(e, -d.dot(e) * (1 - cosT));
    return out.copy(c.add(d)).applyMatrix4(camera.matrixWorld);
}
