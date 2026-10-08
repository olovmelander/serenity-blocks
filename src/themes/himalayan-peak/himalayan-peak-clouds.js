/**
 * Himalayan Peak — the cloud sea.
 *
 * The basin between the pass and the headwall is full of cloud, and the peaks stand out of it
 * like islands. It is a surface, not a volume: a fan of quads about the eye, lifted into
 * billows by the noise texture, drawn far to near so its soft shore against the mountain blends
 * without a depth sort. What makes it a sea of cloud is the light:
 *
 *  - the amphitheatre's shadow lies across it (the cloud-top horizon in the horizon map), and
 *    draws back toward the headwall as the chain raises the sun;
 *  - every billow shades the one behind it (one more read of the billows toward the sun);
 *  - the creases between billows are dark, their crests toward the sun burn;
 *  - it thins to nothing where the ground comes up through it (the field's coarse heights), so
 *    it laps the walls instead of cutting them.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    clamp,
    dot,
    float,
    max,
    normalize,
    positionGeometry,
    sign,
    smoothstep,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { EYE } from './himalayan-peak-core.js';
import { WEDGE } from './himalayan-peak-field.js';
import {
    hpAtmosphere, hpCloudLight, hpFxMaterial, hpGround, hpPart, hpPow4, hpWaveLight,
} from './himalayan-peak-tsl.js';

/** The fan runs from under the lower edge of the widest frame to where the haze has taken it. */
const NEAR = 420;
const FAR = 44000;

/** Swell, billow and curd: [metres across one tile of noise, metres of height]. */
const SWELL = [14000, 250];
const BILLOW = [3700, 115];
const CURD = [900, 36];

/**
 * @param {object} u  shared uniforms
 * @param {object} options
 * @param {[number, number]} options.cloud   [columns, rows] of the fan
 * @param {number} options.billows           octaves the shading reads (2 or 3)
 * @param {number} options.air               shadow samples through the haze
 */
export function createCloudSea(u, { cloud = [224, 160], billows = 3, air = 4 } = {}) {
    const [columns, rows] = cloud;
    const positions = new Float32Array(columns * rows * 3);
    for (let j = 0; j < rows; j++) {
        const r = NEAR * (FAR / NEAR) ** (j / (rows - 1));
        for (let i = 0; i < columns; i++) {
            const a = -WEDGE * 1.06 + (i / (columns - 1)) * 2 * WEDGE * 1.06;
            const o = (j * columns + i) * 3;
            positions[o] = EYE.x + Math.sin(a) * r;
            positions[o + 1] = 0;
            positions[o + 2] = EYE.z - Math.cos(a) * r;
        }
    }
    // Far rows first: the fan paints itself back to front.
    const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
    let k = 0;
    for (let j = rows - 2; j >= 0; j--) {
        for (let i = 0; i < columns - 1; i++) {
            const a = j * columns + i;
            const b = a + 1;
            const c = a + columns;
            const d = c + 1;
            indices.set([a, b, c, b, d, c], k);
            k += 6;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    /** The cloud top over a design-space xz: { h: metres, grad: its slope }. */
    const surface = (xz, octaves) => {
        const drift = vec2(u.windRun.mul(0.03), u.windRun.mul(0.007));
        const n1 = u.noise(xz.sub(drift).div(SWELL[0]));
        const n2 = u.noise(xz.sub(drift.mul(1.6)).div(BILLOW[0]).add(0.37));
        // Billows are rounded on top and creased between: |2v − 1|.
        const fold2 = n2.x.mul(2.0).sub(1.0);
        let h = n1.x.sub(0.42).mul(SWELL[1]).add(abs(fold2).sub(0.42).mul(BILLOW[1]));
        let grad = n1.yz.mul((20 * SWELL[1]) / SWELL[0]).add(n2.yz.mul(sign(fold2)).mul((40 * BILLOW[1]) / BILLOW[0]));
        if (octaves >= 3) {
            const n3 = u.noise(xz.sub(drift.mul(2.3)).div(CURD[0]).add(0.71));
            const fold3 = n3.x.mul(2.0).sub(1.0);
            h = h.add(abs(fold3).sub(0.42).mul(CURD[1]));
            grad = grad.add(n3.yz.mul(sign(fold3)).mul((40 * CURD[1]) / CURD[0]));
        }
        return { h, grad };
    };

    const material = hpFxMaterial('HimalayanPeakCloudSea');
    const lifted = vec3(positionGeometry.x, surface(positionGeometry.xz, 2).h, positionGeometry.z);
    material.positionNode = lifted;
    const vP = varying(lifted, 'hpCloudP');

    material.colorNode = Fn(() => {
        const P = vP;
        const top = surface(P.xz, billows);
        const N = normalize(vec3(top.grad.x.negate(), 1.0, top.grad.y.negate()));
        const st = u.fieldUv(P.xz);
        // It laps the walls: thin where the ground comes up through it.
        const shore = smoothstep(4.0, 120.0, top.h.sub(hpGround(u, P.xz)));
        const sun = hpCloudLight(u, st, top.h);
        // The billows toward the sun shade this one.
        const reach = float(460.0);
        const ahead = surface(P.xz.add(u.sunFlat.mul(reach)), 2).h;
        const self = float(1.0).sub(smoothstep(0.0, 110.0, ahead.sub(top.h.add(reach.mul(max(u.sunTan, 0.03))))));
        const crest = smoothstep(-110.0, 170.0, top.h);
        const wrap = clamp(dot(N, u.sunDir).add(0.5).div(1.5), 0.0, 1.0);
        const direct = u.sunCol.mul(wrap.mul(sun).mul(self).mul(crest.mul(0.7).add(0.3)));
        // The creases between billows see little sky.
        const ambient = u.shade.mul(1.05).add(u.zenith.mul(0.6)).add(u.horizon.mul(0.14)).mul(crest.mul(crest).mul(0.78).add(0.22));
        const eye = vec3(cameraPosition.x.div(u.squeeze), cameraPosition.y, cameraPosition.z);
        const V = normalize(eye.sub(P));
        // Looking into the light, the crests are lined with it.
        const into = hpPow4(max(dot(V.negate(), u.sunDir), 0.0));
        const lining = u.sunCol.mul(into.mul(sun).mul(self).mul(crest).mul(0.55));
        const wave = hpWaveLight(u, float(0.0));
        const col = u.cloudCol.mul(direct.mul(0.46).add(ambient)).add(lining.mul(0.8))
            .add(u.cloudCol.mul(wave.rgb).mul(0.5))
            .mul(u.breath.mul(0.85).add(0.15));
        const alpha = shore.mul(0.985);
        return vec4(hpAtmosphere(u, col, P, { steps: air }).mul(alpha), alpha);
    })();

    const part = hpPart('HimalayanPeakCloudSea', geometry, material, 30);
    part.cells = (columns - 1) * (rows - 1);
    return part;
}
