/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Chapter 8's sky traffic (2026-10-20 overhaul).
 *
 * After Neon District's flying traffic (src/themes/neon-district/neon-district-lights.js
 * createTraffic): every vehicle is a pair of lights, closed form (its place is a function of the
 * clock), drawn as one camera-facing quad sized in corridor units and never under a couple of
 * pixels: WHITE headlights coming up the canyon toward the eye, RED tail lights going away from
 * it, and amber-white streaks crossing town far down the boulevard. It replaces the eighteen
 * neon tubes that used to slide down the canyon (they read as stray lines crossing the frame):
 * one draw instead of eighteen.
 *
 * Lanes keep a clear tube round the rail (|x| < 15 near the rail's height): the canyon decks run
 * along the walls below the eye and above the roofs of the inner bank.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    modelViewMatrix,
    positionGeometry,
    screenSize,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { mulberry32 } from './odyssey-neon-city-plan.js';
import { neonAir } from './odyssey-neon-light.tsl.js';

/** Canyon lanes run z from FAR to NEAR (corridor units); cross-town lanes x within ±CROSS. */
export const NEON_TRAFFIC = Object.freeze({
    near: 140,
    far: -680,
    cross: 620,
});

/**
 * @param {object} N neon uniforms
 * @param {number} count vehicles
 * @param {{seed?: number}} [opts]
 * @returns {THREE.Mesh}
 */
export function createNeonTraffic(N, count, opts = {}) {
    const rand = mulberry32(opts.seed ?? 0x7f1c);
    const T = NEON_TRAFFIC;
    const aSeed = new Float32Array(count * 4);
    const aLane = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
        const kind = i % 6;
        const dir = rand() < 0.5 ? -1 : 1;
        aSeed.set([rand(), rand(), rand(), rand()], i * 4);
        if (kind < 2) {
            // The canyon's low deck, along the walls under the eye; keep right.
            aLane.set([0, dir, dir * (16 + rand() * 5), -36 + rand() * 12], i * 4);
        } else if (kind < 4) {
            // The high deck over the inner roofs, wider.
            aLane.set([0, dir, dir * (22 + rand() * 40), 26 + rand() * 30], i * 4);
        } else {
            // Cross-town, far down the boulevard, high over the city.
            aLane.set([1, dir, -240 - rand() * 420, 50 + rand() * 150], i * 4);
        }
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    const packed = new Float32Array(count * 8);
    for (let i = 0; i < count; i += 1) {
        packed.set(aSeed.subarray(i * 4, i * 4 + 4), i * 8);
        packed.set(aLane.subarray(i * 4, i * 4 + 4), i * 8 + 4);
    }
    const buffer = new THREE.InstancedInterleavedBuffer(packed, 8, 1);
    geometry.setAttribute('aTrafficSeed', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aTrafficLane', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.instanceCount = count;
    const seed = attribute('aTrafficSeed', 'vec4');
    const lane = attribute('aTrafficLane', 'vec4');

    const cross = lane.x;
    const dir = lane.y;
    const speed = seed.y.mul(18.0).add(28.0);
    const canyonLen = T.near - T.far;
    const zCanyon = fract(seed.x.add(N.uTime.mul(speed).mul(dir).div(canyonLen))).mul(canyonLen).add(T.far);
    const crossRun = N.uTime.mul(speed.mul(1.5)).mul(dir).div(T.cross * 2);
    const xCross = fract(seed.x.add(crossRun)).mul(T.cross * 2).sub(T.cross);
    const bob = sin(N.uTime.mul(0.7).add(seed.z.mul(40.0))).mul(0.6);
    const centre = vec3(
        mix(lane.z, xCross, cross),
        lane.w.add(bob),
        mix(zCanyon, lane.z, cross),
    );
    // Coming toward the eye (+z): white. Going away: red. Cross-town: white one way, amber back.
    const coming = mix(step(0.0, dir), step(0.5, seed.w), cross);
    const tint = mix(vec3(1.0, 0.1, 0.05), vec3(0.78, 0.88, 1.0), coming);
    const crossTint = mix(vec3(1.0, 0.62, 0.25), vec3(0.8, 0.9, 1.0), step(0.0, dir));
    const colour = mix(tint, crossTint, cross);

    const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(centre, 1.0));
    const half = screenSize.mul(0.5);
    const pxPerUnit = N.projY.mul(half.y).div(max(clip.w, 0.5));
    // A vehicle is a short streak along its travel: sideways for cross-town, a pair of lamps
    // (a short bar) down the canyon.
    const sizeU = vec2(mix(float(3.2), float(9.0), cross), mix(float(1.3), float(1.6), cross));
    const minPx = vec2(mix(float(3.0), float(6.0), cross), 2.0);
    const sizePx = max(sizeU.mul(pxPerUnit), minPx);
    const vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(sizePx).div(half).mul(clip.w)), clip.z, clip.w);

    const air = neonAir(N, centre);
    const through = float(1.0).sub(air.amount.mul(0.85));
    const ends = mix(
        smoothstep(T.far, T.far + 90, centre.z).mul(smoothstep(T.near, T.near - 30, centre.z)),
        smoothstep(T.cross, T.cross - 90, centre.x.abs()),
        cross,
    );
    const near = smoothstep(4.0, 22.0, length(centre.sub(N.camCity)));
    const vLight = varying(colour.mul(through).mul(ends).mul(near).mul(N.uEnergy.mul(0.2).add(0.9)), 'vNeonTraffic');
    const vCross = varying(cross, 'vNeonTrafficCross');

    const uOpacity = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.name = 'odyssey-neon-traffic';
    material.fog = false;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.forceSinglePass = true;
    material.vertexNode = vertexNode;
    material.colorNode = Fn(() => {
        const d = uv().sub(0.5).mul(2.0);
        // Down the canyon: two lamps side by side; cross-town: one streak.
        const lamps = exp(d.x.abs().sub(0.55).mul(d.x.abs().sub(0.55)).mul(-26.0)).mul(exp(d.y.mul(d.y).mul(-6.0)));
        const streak = exp(d.x.mul(d.x).mul(-3.0)).mul(exp(d.y.mul(d.y).mul(-8.0)));
        const g = mix(lamps.mul(1.9), streak.mul(1.4), vCross);
        return vec4(vLight.mul(g.sub(0.02).max(0.0)).mul(uOpacity).mul(N.seamReveal), 0.0);
    })();
    material.uniforms = { uOpacity };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sky-traffic-light-trails';
    mesh.frustumCulled = false;
    mesh.renderOrder = 23;
    return mesh;
}
