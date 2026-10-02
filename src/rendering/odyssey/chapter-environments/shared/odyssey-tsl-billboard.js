/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Odyssey TSL billboard-particle helper.
 *
 * Part of the Odyssey AAA WebGPU migration (P3 — particle fix). See
 * docs/ODYSSEY_AAA_MASTER_PLAN.md §3.6.
 *
 * WHY THIS EXISTS: on the WebGPU backend, THREE.Points renders as true 1px GPU
 * points — three's PointsNodeMaterial only billboards into sprite quads when the
 * object is NOT `isPoints` (see three setupVertex/setupVertexSprite). So sized,
 * round, soft particles (embers, stars, accretion sparks, breach bursts, node
 * sparkles) must be drawn as INSTANCED BILLBOARD QUADS, not THREE.Points: a unit
 * PlaneGeometry (which has real `position` + `uv`) instanced per particle, with a
 * positionNode that faces each quad to the camera. Then `uv()` is the sprite
 * coordinate (no "uv not found" warning, no gl_PointCoord) and the look matches
 * the WebGL board.
 *
 * Usage:
 *   const geo = makeQuadInstancedGeometry(count, { aBase: { array, itemSize: 3 }, aSeed: { array, itemSize: 1 } });
 *   const center = ...;            // vec3 world center per instance (from attribute('aBase') etc.)
 *   material.positionNode = billboardWorld(center, sizeWorld);
 *   material.colorNode/opacityNode use uv() for the sprite mask;
 *   const mesh = new THREE.Mesh(geo, material);   // plain Mesh + InstancedBufferGeometry
 */

import * as THREE from 'three/webgpu';
import {
    cameraPosition,
    cross,
    modelWorldMatrixInverse,
    normalize,
    positionLocal,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

/**
 * World-space position of the current quad corner, billboarded (camera-facing)
 * around `center` and scaled by `size` (world units). The base quad must be a
 * PlaneGeometry(1,1) so its corners are in [-0.5, 0.5].
 *
 * ⚠️ Correct ONLY when the mesh's parent chain is the identity (see `billboardLocal`): the
 * returned position is consumed as LOCAL space while the camera is read in WORLD space.
 * Anything under an anchored chapter group should use `billboardLocal`.
 * @param {*} center vec3 node — the particle's world-space center
 * @param {*} size float node — world-space half-extent multiplier
 * @returns {*} vec3 node
 */
export function billboardWorld(center, size) {
    const toCam = normalize(cameraPosition.sub(center));
    // Guard against the degenerate up==toCam case with a stable reference up.
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    const up = cross(toCam, right);
    const corner = positionLocal.xy; // quad corner in [-0.5, 0.5]
    return center
        .add(right.mul(corner.x.mul(size)))
        .add(up.mul(corner.y.mul(size)));
}

/**
 * Camera-facing quad corner around a centre given in the MESH'S OWN LOCAL FRAME.
 *
 * WHY THIS EXISTS (masterpiece pass, 2026-10). `positionNode` is a LOCAL-space position —
 * three applies the model matrix to whatever it returns — but `billboardWorld` aims the quad
 * with the WORLD `cameraPosition`. The two only agree when the mesh's whole parent chain is
 * the identity. Odyssey's chapter groups are anchored at their path centre (ch6 sits ~1200 u
 * up and ~1100 u out; ch7 likewise), so every billboard in them faced the world ORIGIN, not
 * the camera: sprites rendered foreshortened or edge-on (stars dropped to slivers or
 * vanished). Here the camera is first brought into the mesh's local frame, so the quad
 * faces the eye under any parent offset, rotation or uniform scale.
 *
 * `size` is in local units (a uniformly scaled parent scales the sprite with it).
 * @param {*} center vec3 node — the particle's centre in the mesh's local frame
 * @param {*} size float node — half-extent multiplier, local units
 * @returns {*} vec3 node (local)
 */
export function billboardLocal(center, size) {
    const cameraLocal = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz;
    const toCam = normalize(cameraLocal.sub(center));
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    const up = cross(toCam, right);
    const corner = positionLocal.xy; // quad corner in [-0.5, 0.5]
    return center
        .add(right.mul(corner.x.mul(size)))
        .add(up.mul(corner.y.mul(size)));
}

/**
 * World-space position of the current quad corner, billboarded around `center` but with
 * a LOCKED WORLD-UP axis (the quad yaws to face the camera but never pitches/rolls), and
 * with independent horizontal/vertical half-extents. This is the right primitive for
 * volumetric column haze that should always stand vertically in the world (a cyan-low /
 * magenta-high neon fog curtain), unlike `billboardWorld` whose up axis tilts with the
 * view. ADDITIVE-only companion to `billboardWorld`; the existing export is unchanged.
 * @param {*} center vec3 node — the particle's world-space center
 * @param {*} sizeXY vec2 node — world-space (half-width, half-height) of the quad
 * @returns {*} vec3 node
 */
export function billboardVerticalWorld(center, sizeXY) {
    const toCam = cameraPosition.sub(center);
    // Yaw-only facing: flatten the camera vector onto the horizontal plane so the quad
    // stays upright (world +Y) regardless of how far the camera cranes up the canyon.
    const flat = normalize(vec3(toCam.x, 0.0, toCam.z));
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), flat));
    const up = vec3(0.0, 1.0, 0.0);
    const corner = positionLocal.xy; // quad corner in [-0.5, 0.5]
    const size = vec2(sizeXY);
    return center
        .add(right.mul(corner.x.mul(size.x)))
        .add(up.mul(corner.y.mul(size.y)));
}

/**
 * Build an InstancedBufferGeometry: one unit quad (position + uv) drawn `count`
 * times, with the supplied per-instance attributes. Render with a plain THREE.Mesh.
 * @param {number} count instance count
 * @param {Object<string,{array:Float32Array,itemSize:number}>} instancedAttributes
 * @returns {THREE.InstancedBufferGeometry}
 */
export function makeQuadInstancedGeometry(count, instancedAttributes = {}) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    // `normal` is kept: some billboard materials DO read it (e.g. normalView), so removing
    // it globally floods "Vertex attribute normal not found". The 9-vertex-buffer overflow
    // is fixed per-billboard at the call site instead (see the offending 6-attribute one).
    geo.setAttribute('normal', quad.getAttribute('normal'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.instanceCount = count;
    Object.entries(instancedAttributes).forEach(([name, { array, itemSize }]) => {
        geo.setAttribute(name, new THREE.InstancedBufferAttribute(array, itemSize));
    });
    quad.dispose();
    return geo;
}

export default billboardWorld;
