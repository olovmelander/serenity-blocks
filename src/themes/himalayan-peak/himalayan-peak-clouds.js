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
 *  - before the sun reaches it, the sky lights it: every billow's flank that faces the sunrise
 *    takes the glow over the wall, the rest the blue of the zenith;
 *  - it thins to nothing where the ground comes up through it (the field's coarse heights), so
 *    it laps the walls instead of cutting them.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraPosition,
    clamp,
    dot,
    float,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
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
const SWELL = [14700, 270];
const BILLOW = [4100, 125];
const CURD = [970, 18];

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
        const drift = vec2(u.windRun.mul(0.45), u.windRun.mul(0.092));
        // The mesh carries only broad lobes; high-frequency vertex displacement tessellates
        // a distant inversion into hard rock facets. Save the smaller curds for the normal.
        const n1 = u.noise(xz.sub(drift).div(SWELL[0])).level(2.0);
        const n2 = u.noise(xz.sub(drift.mul(1.6)).div(BILLOW[0]).add(0.37)).level(1.5);
        const shoulder = clamp(n2.x.sub(0.24).div(0.56), 0, 1);
        const round = shoulder.mul(shoulder).mul(float(3).sub(shoulder.mul(2)));
        const slope = shoulder.mul(float(1).sub(shoulder)).mul(6 / 0.56);
        const bank = n1.x.mul(0.8).add(0.42);
        const lift = sin(u.windRun.mul(0.0017)).mul(17).add(sin(u.windRun.mul(0.00073)).mul(14));
        let h = n1.x.sub(0.47).mul(SWELL[1]).add(round.sub(0.5).mul(BILLOW[1]).mul(bank)).add(lift);
        let grad = n1.yz.mul((20 * SWELL[1]) / SWELL[0])
            .add(n2.yz.mul(slope).mul((20 * BILLOW[1]) / BILLOW[0]).mul(bank));
        let tufts = n2.w;
        if (octaves >= 3) {
            const n3 = u.noise(xz.sub(drift.mul(2.3)).div(CURD[0]).add(0.71));
            h = h.add(n3.x.sub(0.50).mul(CURD[1]).mul(bank));
            grad = grad.add(n3.yz.mul((22 * CURD[1]) / CURD[0]).mul(bank));
            tufts = n2.w.mul(0.64).add(n3.x.mul(0.36));
        }
        return {
            h, grad, bank: n1.w, tufts,
        };
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
        const crest = smoothstep(-86.0, 135.0, top.h);
        const wrap = clamp(dot(N, u.sunDir).add(0.68).div(1.68), 0.0, 1.0);
        const direct = u.sunCol.mul(wrap.mul(sun).mul(self).mul(crest.mul(0.7).add(0.3)));
        // The creases between billows see little sky.
        const ambient = u.shade.mul(1.07).add(u.zenith.mul(0.28)).add(u.horizon.mul(0.25))
            .mul(crest.mul(0.60).add(0.43));
        const eye = vec3(cameraPosition.x.div(u.squeeze), cameraPosition.y, cameraPosition.z);
        const V = normalize(eye.sub(P));
        // Looking into the light, the crests are lined with it.
        const into = hpPow4(max(dot(V.negate(), u.sunDir), 0.0));
        const lining = u.sunCol.mul(into.mul(sun).mul(self).mul(crest).mul(0.55));
        const wave = hpWaveLight(u, float(0.0));
        // The sky's glow over the wall on the flanks that face it; strongest where the sun has
        // not yet come (once it has, the direct light says the same thing louder).
        const toward = clamp(dot(N.xz, u.sunFlat).div(length(N.xz).add(0.24)).mul(0.65).add(0.5), 0.0, 1.0);
        const shoulder = smoothstep(0.23, 0.76, top.bank);
        const glowLit = u.glow.mul(toward.mul(toward).mul(0.23).add(0.065))
            .mul(crest.mul(0.67).add(0.33)).mul(float(1.0).sub(sun.mul(0.65)));
        // Rose light penetrates the thinnest shoulders while the deeper troughs retain skylight.
        const transmission = u.horizon.mul(0.21).add(u.glow.mul(0.13))
            .mul(shoulder.mul(crest).mul(toward.mul(0.66).add(0.34)));
        const light = u.cloudCol.mul(direct.mul(0.44).add(ambient).add(glowLit))
            .add(lining.mul(0.65)).add(transmission).add(u.cloudCol.mul(wave.rgb).mul(0.5));
        // Skylight scattered inside the bank fills its folds and lifts it off the blue ice foreground.
        const fog = u.shade.mul(vec3(1.15, 1.32, 1.02)).add(u.horizon.mul(0.30));
        const near = smoothstep(11000, 3600, length(P.xz.sub(eye.xz)));
        const tuft = smoothstep(0.36, 0.67, top.tufts);
        const scallop = tuft.mul(near).mul(crest.mul(0.68).add(0.32)).mul(toward.mul(0.57).add(0.43));
        const curds = u.shade.mul(0.54).add(u.horizon.mul(0.48)).add(u.glow.mul(0.12)).mul(scallop);
        const col = mix(light.add(curds), fog, float(0.26).sub(crest.mul(0.12))).mul(u.breath.mul(0.85).add(0.15));
        const alpha = shore.mul(0.985);
        return vec4(hpAtmosphere(u, col, P, { steps: air }).mul(alpha), alpha);
    })();

    const part = hpPart('HimalayanPeakCloudSea', geometry, material, 30);
    part.cells = (columns - 1) * (rows - 1);
    return part;
}
