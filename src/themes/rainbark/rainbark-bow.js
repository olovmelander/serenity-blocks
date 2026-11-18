/**
 * Rainbark — the Sunshower's bow.
 *
 * Rain in sunlight makes a rainbow, and a back-to-back run is rain in sunlight. While it lives a
 * bow stands in the grove (BOW in the core): an arch from the frame's left edge up over the card
 * and down into the gold air on its right, red outside and violet inside, a second fainter one
 * beyond it with its colours turned round, the air inside the first a little brighter than
 * outside it. It stands in the far rain, so the grove's trunks are dark in front of it (drawn at
 * the far plane, depth-tested): additive, out of the card's band, its light through the iris.
 *
 * One full-screen triangle that is not drawn at all while no bow shows (its vertices collapse:
 * a zero uniform alone would still shade every pixel of the frame).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    acos,
    clamp,
    dot,
    float,
    max,
    positionGeometry,
    screenUV,
    smoothstep,
    step,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BOW,
    DEG,
    rbFxMaterial,
    rbPart,
    rbViewRay,
} from './rainbark-tsl.js';

/** The bow draws over the rain. */
const BOW_ORDER = 76;

/** The unit vector toward the bow's centre (BOW.azimuth off the view axis −z, BOW.drop under the horizon). */
export function bowCentre(out = [0, 0, 0]) {
    const az = BOW.azimuth * DEG;
    const el = -BOW.drop * DEG;
    out[0] = Math.sin(az) * Math.cos(el);
    out[1] = Math.sin(el);
    out[2] = -Math.cos(az) * Math.cos(el);
    return out;
}

/** A hue (0 red … 0.78 violet) as linear-ish rgb: the pure spectral sweep, never a palette. */
const spectrum = (h) => {
    const r = clamp(abs(h.mul(6.0).sub(3.0)).sub(1.0), 0.0, 1.0);
    const g = clamp(float(2.0).sub(abs(h.mul(6.0).sub(2.0))), 0.0, 1.0);
    const b = clamp(float(2.0).sub(abs(h.mul(6.0).sub(4.0))), 0.0, 1.0);
    return vec3(r, g, b);
};

/**
 * The bow's draw.
 * @param {object} u  the shared uniforms (u.bow: how much of it shows, 0 … 1)
 */
export function createBow(u) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    // (At the far plane, depth-tested: the grove's trunks stand in front of it.)
    const material = rbFxMaterial('RainbarkBow', { depthTest: true });
    material.depthFunc = THREE.LessEqualDepth;
    const C = bowCentre();
    // (No bow: no triangle. The frame pays for it only while it shows.)
    material.vertexNode = vec4(positionGeometry.xy.mul(step(0.002, u.bow)), 1.0, 1.0);
    material.colorNode = Fn(() => {
        const dir = rbViewRay(u, screenUV).toVar();
        const angle = acos(clamp(dot(dir, vec3(...C)), -1.0, 1.0)).mul(180 / Math.PI).toVar();
        // The first bow: violet inside to red outside over its width, soft at both edges.
        const half = BOW.width / 2;
        const a = angle.sub(BOW.radius).div(half).toVar();
        const band = smoothstep(-1.25, -0.55, a).mul(float(1.0).sub(smoothstep(0.55, 1.25, a)));
        const first = spectrum(clamp(float(0.39).sub(a.mul(0.39)), 0.0, 0.78)).mul(band);
        // The second: wider, fainter, its colours turned round.
        const b = angle.sub(BOW.second).div(half * 1.7).toVar();
        const band2 = smoothstep(-1.25, -0.55, b).mul(float(1.0).sub(smoothstep(0.55, 1.25, b)));
        const second = spectrum(clamp(b.mul(0.39).add(0.39), 0.0, 0.78)).mul(band2).mul(BOW.secondGain);
        // (Inside the first the drops send light back: the air there a touch brighter.)
        const inside = float(1.0).sub(smoothstep(BOW.radius - 9, BOW.radius - half, angle)).mul(0.35).add(0.65)
            .mul(float(1.0).sub(smoothstep(BOW.radius - half, BOW.radius, angle)))
            .mul(BOW.inner);
        const r = u.cardRect;
        const away = max(max(r.x.sub(screenUV.x), screenUV.x.sub(r.z)), max(r.y.sub(screenUV.y), screenUV.y.sub(r.w)));
        const clear = smoothstep(BOW.card[0], BOW.card[1], away);
        // (It stands in the lit air, never down in the mist's glare nor up in the crowns' shade.)
        const air = smoothstep(-0.36, -0.14, dir.y).mul(float(1.0).sub(smoothstep(0.3, 0.5, dir.y)));
        const light = first.add(second).add(vec3(inside)).mul(u.bow).mul(u.iris)
            .mul(clear)
            .mul(air);
        return vec4(max(light, vec3(0.0)), 0.0);
    })();
    return rbPart('RainbarkBow', geometry, material, BOW_ORDER);
}
