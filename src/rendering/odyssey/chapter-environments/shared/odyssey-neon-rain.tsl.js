/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Chapter 8's rain (2026-10-20 neon overhaul).
 *
 * After Neon District's rain (src/themes/neon-district/neon-district-weather.js createRain):
 * streaks falling through a box of air, closed form (a streak's height is a function of the
 * clock; nothing is simulated), each a strip never thinner than a pixel and a half, and every
 * streak LIT BY WHAT IS BEHIND IT — rose under a rose sign, white in the traffic's glare, almost
 * nothing in the dark between. Rain is only ever seen by the light it catches.
 *
 * Neon District's box is pinned to a camera that never moves. This eye flies, so the box FOLLOWS
 * it in corridor space while every drop keeps its own column of air: a drop's x and z are its
 * seed wrapped into a box-sized window around the eye, `c = eye + (fract((seed·B − eye) / B) −
 * 0.5)·B`, so the eye flies THROUGH the rain instead of the rain riding along with it.
 *
 * The mesh lives in the corridor group: its local space IS corridor space, so the strip is built
 * with modelViewMatrix directly.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    modelViewMatrix,
    normalize,
    positionGeometry,
    screenSize,
    smoothstep,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { STREET_Y, mulberry32 } from './odyssey-neon-city-plan.js';
import { neonGlow, neonIgnition } from './odyssey-neon-light.tsl.js';

/** The box of air the rain falls through (corridor units, centred on the eye in x and z). */
export const NEON_RAIN_BOX = Object.freeze({
    width: 150,
    depth: 300,
    // The box's centre runs ahead of the eye (it looks down -z).
    ahead: 115,
    top: 70,
    bottom: STREET_Y,
});

/**
 * @param {object} N neon uniforms (odyssey-neon-light.tsl.js) — reads camCity, uTime, uRainDensity
 * @param {number} count streaks
 * @param {{seed?: number}} [opts]
 * @returns {THREE.Mesh}
 */
export function createNeonRain(N, count, opts = {}) {
    const rand = mulberry32(opts.seed ?? 0x7a11);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i += 1) seeds[i] = rand();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setAttribute('aRainSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;
    const seed = attribute('aRainSeed', 'vec4');
    const B = NEON_RAIN_BOX;
    const span = B.top - B.bottom;

    // ── Where this streak is now ──
    const speed = seed.w.mul(22.0).add(62.0);
    const fall = fract(seed.z.add(N.uTime.mul(speed).div(span)));
    const y = float(B.top).sub(fall.mul(span));
    const eye = N.camCity;
    const cz = eye.z.sub(B.ahead);
    const x = eye.x.add(fract(seed.x.mul(B.width).sub(eye.x).div(B.width)).sub(0.5).mul(B.width));
    const z = cz.add(fract(seed.y.mul(B.depth).sub(cz).div(B.depth)).sub(0.5).mul(B.depth));
    // A light wind leans the fall.
    const lean = 0.08;
    const head = vec3(x.add(y.mul(lean)), y, z);
    // Motion blur over ~1/30 s.
    const lengthU = speed.mul(0.032);
    const along = normalize(vec3(lean, 1.0, 0.0));
    const centre = head.add(along.mul(positionGeometry.y.mul(lengthU)));

    // Camera-facing strip, at least a pixel and a half wide.
    const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(centre, 1.0));
    const tip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(centre.add(along.mul(0.5)), 1.0));
    const half = screenSize.mul(0.5);
    const s0 = clip.xy.div(clip.w).mul(half);
    const s1 = tip.xy.div(tip.w).mul(half);
    const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dir.y.negate(), dir.x);
    const dist = length(centre.sub(eye));
    // Pixels per corridor unit at this depth (P[1][1] = 1 / tan(fov / 2)).
    const pxPerUnit = N.projY.mul(half.y).div(max(clip.w, 0.5));
    const widthPx = max(float(0.05).mul(pxPerUnit), 1.5);
    const vertex = vec4(
        clip.xy.add(nrm.mul(positionGeometry.x.mul(widthPx)).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );

    // ── What lights it (per vertex: a streak is tiny) ──
    const ign = neonIgnition(N, head);
    const hAbove = max(head.y.sub(STREET_Y), 0.0);
    const signs = neonGlow(N, head, 0).mul(exp(max(hAbove.sub(30.0), 0.0).mul(-1 / 40)));
    const street = neonGlow(N, head, 1).mul(exp(hAbove.mul(-1 / 22))).mul(1.6);
    const ambient = N.mistLow.mul(0.9).add(vec3(0.004, 0.005, 0.009));
    // Streaks dissolve into the haze, and the nearest are soft and faint (out of focus).
    const visible = exp(dist.mul(1 / 330).pow(2.0).negate())
        .mul(smoothstep(2.0, 14.0, dist))
        .mul(mix(float(0.35), float(1.0), smoothstep(6.0, 30.0, dist)));
    const alive = smoothstep(0.0, 0.05, N.uRainDensity.sub(seed.x.mul(0.999)));
    const energy = ambient.add(signs.add(street).mul(ign.level).mul(0.5))
        .mul(visible)
        .mul(alive)
        // A thin streak spread over a pixel and a half keeps its energy.
        .mul(float(0.05).mul(pxPerUnit).div(widthPx).mul(0.75)
            .add(0.25));
    const vLight = varying(energy, 'vNeonRainLight');

    const uOpacity = uniform(1); // 7->8 crossfade bridge (rain used to POP in at the seam)
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.name = 'odyssey-neon-rain';
    material.fog = false;
    // Premultiplied "over" with alpha 0 = pure addition that leaves the target's alpha alone.
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.forceSinglePass = true;
    material.vertexNode = vertex;
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.x.sub(0.5)).mul(2.0)).max(0.0);
        const alongFade = smoothstep(0.0, 0.3, st.y).mul(smoothstep(1.0, 0.55, st.y));
        const a = across.mul(across).mul(alongFade);
        return vec4(vLight.mul(a).mul(2.6).mul(uOpacity), 0.0);
    })();
    material.uniforms = { uOpacity };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'rain-streak-curtain';
    mesh.frustumCulled = false;
    mesh.renderOrder = 40;
    return mesh;
}
