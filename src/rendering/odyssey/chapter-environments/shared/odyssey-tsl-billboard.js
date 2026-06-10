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
    normalize,
    positionLocal,
    vec2,
    vec3,
} from 'three/tsl';

/**
 * World-space position of the current quad corner, billboarded (camera-facing)
 * around `center` and scaled by `size` (world units). The base quad must be a
 * PlaneGeometry(1,1) so its corners are in [-0.5, 0.5].
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
    geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.instanceCount = count;
    Object.entries(instancedAttributes).forEach(([name, { array, itemSize }]) => {
        geo.setAttribute(name, new THREE.InstancedBufferAttribute(array, itemSize));
    });
    quad.dispose();
    return geo;
}

export default billboardWorld;
