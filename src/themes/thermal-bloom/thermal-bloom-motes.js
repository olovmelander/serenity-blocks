/**
 * Thermal Bloom — motes: droplets condensed from the steam drifting through the near air in the
 * warm seasons, diamond dust glittering in the cold ones (First Frost and Deep Cold; in a basin's
 * winter the air over the springs sparkles with ice).
 *
 * Every mote is one camera-facing speck, a pixel or two across, fixed in the world (the camera's
 * breath gives them parallax) and drifting with the wind on its own closed-form loop, fading in
 * and out at the loop's ends so nothing pops. A few at a time catch the sun and flash above the
 * bloom's knee, so the bloom haloes them; between flashes they are faint. One draw call; the
 * world seeds their resting places from the rest rig (`part.setVolume(plan)`).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cos,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { mulberry32, rigFrame } from './thermal-bloom-core.js';
import {
    tbAerial,
    tbFxMaterial,
    tbHash21,
    tbPart,
} from './thermal-bloom-tsl.js';
import { flatVarying } from '../shared/flat-varying.js';

/** The near air the motes fill (metres along the rest rig's view rays). */
const NEAR = 14;
const FAR = 150;

/**
 * The motes.
 * @param {object} u     the shared uniforms
 * @param {number} count the tier's motes
 */
export function createMotes(u, count) {
    const n = Math.max(1, count);
    const positions = new Float32Array(n * 4 * 3);
    const motes = new Float32Array(n * 4 * 4);
    const index = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, y], c) => {
            positions.set([x, y, 0], (i * 4 + c) * 3);
        });
        index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const moteAttr = new THREE.BufferAttribute(motes, 4);
    geometry.setAttribute('aMote', moteAttr);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));

    const aMote = attribute('aMote', 'vec4');
    const seed = aMote.w;
    const h1 = tbHash21(vec2(seed, 1.3));
    const h2 = tbHash21(vec2(seed, 4.7));
    // Each mote's loop: 14–24 s, drifting downwind, rising a little, swirling as it goes.
    const period = h1.mul(10.0).add(14.0);
    const phase = fract(u.time.div(period).add(h2));
    const along = phase.sub(0.5).mul(period);
    const wind = vec3(u.windDir.x, 0.0, u.windDir.y).mul(u.windSpeed.mul(0.45));
    const swirlT = u.time.mul(h2.mul(0.5).add(0.35)).add(seed.mul(5.1));
    const swirl = vec3(sin(swirlT), sin(swirlT.mul(1.37).add(1.1)).mul(0.5), cos(swirlT.mul(0.83))).mul(0.9);
    const centre = aMote.xyz.add(wind.mul(along)).add(vec3(0.0, along.mul(0.06), 0.0)).add(swirl);
    // In the warm seasons only a third of them (droplets near the steam); in the cold, all.
    const cold = max(u.frost, u.snow);
    const alive = step(h1, mix(float(0.35), float(1.0), cold)).mul(step(0.5, seed));
    const vFade = varying(alive.mul(sin(phase.mul(Math.PI))), 'vMoteFade');
    const vCorner = varying(positionGeometry.xy, 'vMoteCorner');
    const vSeed = flatVarying(seed, 'vMoteSeed'); // flat: a mote flashes whole
    const vDist = varying(length(u.camPos.sub(centre)), 'vMoteDist');

    const material = tbFxMaterial('ThermalBloomMotes');
    material.positionNode = Fn(() => {
        const toCam = u.camPos.sub(centre);
        const d = length(toCam);
        const f = toCam.div(max(d, 1e-3));
        const right = normalize(vec3(f.z.negate(), 0.0, f.x));
        const up = normalize(vec3(0.0, 1.0, 0.0).sub(f.mul(f.y)));
        // At least about a pixel and a half across, so a speck never shimmers in and out.
        const size = max(float(0.012).add(h2.mul(0.014)), d.mul(u.pixelAngle).mul(0.8));
        const corner = right.mul(positionGeometry.x).add(up.mul(positionGeometry.y)).mul(size);
        return mix(vec3(0.0, -1e5, 0.0), centre.add(corner), alive);
    })();
    const moteFn = Fn(() => {
        const r = length(vCorner);
        const disc = smoothstep(1.0, 0.2, r);
        // Flashes: now and then a mote's facet meets the sun's mirror angle — a sharp pulse.
        const rate = float(0.55);
        const tick = floor(u.time.mul(rate).add(vSeed.mul(0.37)));
        const g = fract(u.time.mul(rate).add(vSeed.mul(0.37)));
        const lucky = step(0.62, tbHash21(vec2(vSeed, tick)));
        const pulse = g.sub(0.5).mul(11.0);
        const flash = exp(pulse.mul(pulse).negate()).mul(lucky).mul(mix(float(0.6), float(1.0), cold));
        const a = disc.mul(vFade).mul(float(0.3).add(flash.mul(0.7)));
        // Droplets warm pearl, ice blue-white; a flash is the sun itself, well above the knee.
        const tint = mix(vec3(1.0, 0.96, 0.9), vec3(0.9, 0.96, 1.05), cold);
        const col = u.sunColor.mul(tint).mul(float(0.75).add(flash.mul(5.5)));
        const out = tbAerial(u, col, vDist, vec3(0.0, -0.3, -1.0));
        return vec4(out.mul(a), a);
    });
    material.colorNode = moteFn();
    const part = tbPart('ThermalBloomMotes', geometry, material, 64);
    /**
     * Seed the motes' resting places through the near air the rest rig sees: along view rays
     * spread over the frame, 14–150 m out (more of them near), never under the ground.
     */
    part.setVolume = (plan) => {
        const rand = mulberry32(0x3075);
        const f = rigFrame(plan.rig);
        const tanV = Math.tan((plan.rig.fov * Math.PI) / 360);
        const tanH = tanV * (plan.aspect ?? 16 / 9);
        for (let i = 0; i < n; i++) {
            const nx = (2 * rand() - 1) * tanH * 1.1;
            const ny = (1 - 2 * rand()) * tanV * 1.05;
            const dir = [0, 1, 2].map((k) => f.forward[k] + f.right[k] * nx + f.up[k] * ny);
            const len = Math.hypot(dir[0], dir[1], dir[2]);
            let d = NEAR + (FAR - NEAR) * rand() ** 1.6;
            // Stay in the air: at most most of the way to where the ray meets the ground.
            if (dir[1] < 0) d = Math.min(d, (0.85 * f.position[1] * len) / -dir[1]);
            const t = d / len;
            const s = 0.5 + i + rand() * 0.25;
            for (let c = 0; c < 4; c++) {
                const o = (i * 4 + c) * 4;
                motes[o] = f.position[0] + dir[0] * t;
                motes[o + 1] = Math.max(0.6, f.position[1] + dir[1] * t);
                motes[o + 2] = f.position[2] + dir[2] * t;
                motes[o + 3] = s;
            }
        }
        moteAttr.needsUpdate = true;
    };
    part.count = n;
    return part;
}
