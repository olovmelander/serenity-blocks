// @ts-check
/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview A chapter build as a sequence of small steps (perf audit 2026-10-28, "chapter
 * builds hitch the live map").
 *
 * A chapter's `create…Environment()` ran in one go: chapter 1 measured 100-250 ms of main thread
 * (its shaft wall's noise grid alone 45-80 ms), chapter 6 25-140 ms (Node on a cloud CPU; relative
 * figures, ADR-0016). Under the loading cover that costs nothing anyone sees; built while the map
 * is on screen (the background loader after the reveal, a boundary preload while scrolling, a far
 * orb picked in the navigator) the map froze for that long. A chapter that can be built in steps also exports `build…EnvironmentSteps()`,
 * a generator that pauses (`yield`) between pieces of a few milliseconds, and its
 * `create…Environment()` runs that same generator straight through: one build, the same with or
 * without the pauses.
 *
 * The contract for a steps generator: it pauses only between whole pieces of work, and its group
 * is not added to any scene until it is returned, so nothing half-built is ever drawn. Callers
 * pausing it run nothing in between that draws from the build's own state.
 */

import { BufferAttribute, Vector3 } from 'three/webgpu';

/** Triangles accumulated per step by computeVertexNormalsSteps (~1-2 ms in the Node measurement). */
export const NORMALS_TRIANGLES_PER_STEP = 8192;
/** Normals normalised per step. */
const NORMALS_VERTICES_PER_STEP = 16384;

/**
 * Run a build's steps straight through (startup under the loading cover, tests, the playground).
 * @template T
 * @param {Generator<unknown, T, unknown>} steps
 * @returns {T}
 */
export function runChapterSteps(steps) {
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
}

/**
 * `geometry.computeVertexNormals()` for an indexed geometry, in steps. The loop is three r186's
 * own (BufferGeometry.computeVertexNormals, then normalizeNormals), with the same vectors and the
 * same order of accumulation, so the normals are bit-identical to the one-shot call
 * (tests/unit/chapter-build-steps.test.js compares them). A geometry without an index or a
 * position attribute gets the one-shot call, in one step.
 * @param {import('three/webgpu').BufferGeometry} geometry
 * @param {number} [trianglesPerStep]
 * @returns {Generator<void, void, unknown>}
 */
export function* computeVertexNormalsSteps(geometry, trianglesPerStep = NORMALS_TRIANGLES_PER_STEP) {
    const { index } = geometry;
    const positionAttribute = geometry.getAttribute('position');
    if (!index || positionAttribute === undefined) {
        geometry.computeVertexNormals();
        return;
    }
    let normalAttribute = geometry.getAttribute('normal');
    if (normalAttribute === undefined || normalAttribute.count !== positionAttribute.count) {
        normalAttribute = new BufferAttribute(new Float32Array(positionAttribute.count * 3), 3);
        geometry.setAttribute('normal', normalAttribute);
    } else {
        for (let i = 0, il = normalAttribute.count; i < il; i += 1) normalAttribute.setXYZ(i, 0, 0, 0);
    }

    const pA = new Vector3(); const pB = new Vector3(); const pC = new Vector3();
    const nA = new Vector3(); const nB = new Vector3(); const nC = new Vector3();
    const cb = new Vector3(); const ab = new Vector3();
    const stride = Math.max(1, Math.floor(trianglesPerStep)) * 3;
    for (let start = 0, il = index.count; start < il; start += stride) {
        const end = Math.min(il, start + stride);
        for (let i = start; i < end; i += 3) {
            const vA = index.getX(i);
            const vB = index.getX(i + 1);
            const vC = index.getX(i + 2);
            pA.fromBufferAttribute(positionAttribute, vA);
            pB.fromBufferAttribute(positionAttribute, vB);
            pC.fromBufferAttribute(positionAttribute, vC);
            cb.subVectors(pC, pB);
            ab.subVectors(pA, pB);
            cb.cross(ab);
            nA.fromBufferAttribute(normalAttribute, vA);
            nB.fromBufferAttribute(normalAttribute, vB);
            nC.fromBufferAttribute(normalAttribute, vC);
            nA.add(cb);
            nB.add(cb);
            nC.add(cb);
            normalAttribute.setXYZ(vA, nA.x, nA.y, nA.z);
            normalAttribute.setXYZ(vB, nB.x, nB.y, nB.z);
            normalAttribute.setXYZ(vC, nC.x, nC.y, nC.z);
        }
        yield;
    }

    const v = new Vector3();
    for (let start = 0, il = normalAttribute.count; start < il; start += NORMALS_VERTICES_PER_STEP) {
        const end = Math.min(il, start + NORMALS_VERTICES_PER_STEP);
        for (let i = start; i < end; i += 1) {
            v.fromBufferAttribute(normalAttribute, i);
            v.normalize();
            normalAttribute.setXYZ(i, v.x, v.y, v.z);
        }
        if (end < il) yield;
    }
    normalAttribute.needsUpdate = true;
}
