/**
 * @fileoverview Shared STAGE FRAME for set-piece chapters + the Urban finale clock.
 *
 * A "stage frame" is the fixed orthonormal basis a chapter's set piece is authored in
 * (forward = the averaged travel tangent across the chapter, up = the set's "sky"). The
 * Urban Dreams city is built inside such a frame (its corridor container), and the camera
 * must share it — otherwise the camera's own parallel-transported path frame rolls the
 * city on screen (measured: -34 deg at chapter entry growing to -90 deg at the journey end,
 * which laid the whole skyline on its side). Both consumers derive the basis from this one
 * function so they can never disagree.
 *
 * Also hosts the ONE in-chapter finale clock for chapter 8 (spire ignition, city dim,
 * camera crane, post ignition swell) so env / camera / post stop running on three clocks.
 */

import * as THREE from 'three/webgpu';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_Z = new THREE.Vector3(0, 0, 1);

/**
 * Average the curve tangent over [tStart, tEnd] and build the stage basis.
 * Mirrors the original urban corridor maths exactly (near-vertical tangents fall back to
 * world +Z as the reference up).
 * @param {THREE.Curve} curve arc-length parameterised curve (getTangentAt)
 * @param {number} tStart chapter start (0..1)
 * @param {number} tEnd chapter end (0..1)
 * @param {{forward:THREE.Vector3, right:THREE.Vector3, up:THREE.Vector3}} [out]
 * @returns {{forward:THREE.Vector3, right:THREE.Vector3, up:THREE.Vector3}|null}
 */
export function computeStageBasis(curve, tStart, tEnd, out = null) {
    if (!curve || typeof curve.getTangentAt !== 'function'
        || !Number.isFinite(tStart) || !Number.isFinite(tEnd)) {
        return null;
    }
    const target = out || {
        forward: new THREE.Vector3(),
        right: new THREE.Vector3(),
        up: new THREE.Vector3(),
    };
    const forward = target.forward.set(0, 0, 0);
    const sample = new THREE.Vector3();
    const SAMPLES = 16;
    for (let i = 0; i <= SAMPLES; i += 1) {
        const t = tStart + (tEnd - tStart) * (i / SAMPLES);
        curve.getTangentAt(THREE.MathUtils.clamp(t, 0, 1), sample).normalize();
        forward.add(sample);
    }
    if (forward.lengthSq() < 1e-6) return null;
    forward.normalize();

    const refUp = Math.abs(forward.dot(WORLD_UP)) > 0.9 ? WORLD_Z : WORLD_UP;
    // Local +Z = -forward (so local -Z = camera forward); X = refUp x Z; Y = Z x X.
    const zAxis = sample.copy(forward).multiplyScalar(-1);
    target.right.crossVectors(refUp, zAxis).normalize();
    target.up.crossVectors(zAxis, target.right).normalize();
    return target;
}

/**
 * Quaternion whose local axes are (right, up, -forward) — the corridor container rotation.
 * @param {{forward:THREE.Vector3, right:THREE.Vector3, up:THREE.Vector3}} basis
 * @param {THREE.Quaternion} [out]
 * @returns {THREE.Quaternion}
 */
export function stageBasisToQuaternion(basis, out = new THREE.Quaternion()) {
    if (!basis) return out.identity();
    const zAxis = basis.forward.clone().multiplyScalar(-1);
    const m = new THREE.Matrix4().makeBasis(basis.right, basis.up, zAxis);
    return out.setFromRotationMatrix(m);
}

// ── Chapter 8 finale clock ─────────────────────────────────────────────────────────
// One in-chapter clock (local progress 0 = 7->8 boundary, 1 = journey end):
//   • dark arrival     0.00 – 0.35   city lit low, spire dormant, camera dollies the canyon
//   • IGNITION         0.35 – 0.90   spire fires street->crown, sun heats, bloom swells,
//                                    the camera cranes up the spire WITH it
//   • settle / resolve 0.90 – 1.00   city windows gutter out, the sun stays the last light
export const URBAN_FINALE = Object.freeze({
    igniteStart: 0.35,
    igniteEnd: 0.9,
    dimStart: 0.9,
    dimEnd: 1.0,
});

function smootherstep01(x) {
    const t = THREE.MathUtils.clamp(x, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Urban chapter-local progress from global path progress.
 * @param {number} progress global 0..1
 * @param {number} chapterStart ch8 start (global)
 * @param {number} [chapterEnd] ch8 end (global, default 1)
 * @returns {number} 0..1
 */
export function urbanLocalProgress(progress, chapterStart, chapterEnd = 1) {
    if (!Number.isFinite(progress) || !Number.isFinite(chapterStart)) return 0;
    const span = Math.max(1e-6, (chapterEnd ?? 1) - chapterStart);
    return THREE.MathUtils.clamp((progress - chapterStart) / span, 0, 1);
}

/**
 * The eased ignition value (0 dormant -> 1 fully ignited) for a chapter-local progress.
 * @param {number} local 0..1
 * @returns {number}
 */
export function urbanIgnition(local) {
    return smootherstep01(
        (local - URBAN_FINALE.igniteStart) / (URBAN_FINALE.igniteEnd - URBAN_FINALE.igniteStart),
    );
}

/**
 * The eased resolve/dim value (0 -> 1 across the journey's last tenth).
 * @param {number} local 0..1
 * @returns {number}
 */
export function urbanResolve(local) {
    return smootherstep01(
        (local - URBAN_FINALE.dimStart) / (URBAN_FINALE.dimEnd - URBAN_FINALE.dimStart),
    );
}
