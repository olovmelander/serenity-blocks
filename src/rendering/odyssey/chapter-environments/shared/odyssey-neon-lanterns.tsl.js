/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Chapter 8's lantern strings (2026-10-20 overhaul).
 *
 * Strings of paper lanterns hung across the boulevard between the inner towers, well below the
 * rail, every block or so down the canyon: seen from the eye above they are rows of warm points
 * that converge on the spire, the depth cue the canyon floor lacked, and they replace the nine
 * neon torus "gates" that used to ring the rail (they read as stray circles round it). Neon
 * District hangs lanterns over its street the same way (neon-district-world.js); here they are
 * one instanced draw of camera-facing glows, never thinner than a couple of pixels, with the
 * cable drawn as a faint run of the same sprites between them.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    exp,
    float,
    floor,
    max,
    mix,
    modelViewMatrix,
    positionGeometry,
    screenSize,
    sin,
    uniform,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import { mulberry32, linearRgb } from './odyssey-neon-city-plan.js';
import { neonAir, neonIgnition } from './odyssey-neon-light.tsl.js';

/** Where the strings hang (corridor units). */
export const NEON_LANTERNS = Object.freeze({
    zNear: 30,
    zFar: -470,
    spacing: 58,
    // Below the rail (local y -12..0) by a clear margin.
    yMin: -46,
    yMax: -34,
    halfSpan: 23.2,
    sag: 3.4,
    perString: 15,
});

const LANTERN_HEX = [0xff8a2a, 0xff5a3a, 0xffb347, 0xff3a6a];

/**
 * Plan the strings: one per `spacing` down the canyon, each a sagging run of lanterns.
 * @returns {{x:number, y:number, z:number, size:number, rgb:number[], seed:number, cable:number}[]}
 */
export function planNeonLanterns() {
    const L = NEON_LANTERNS;
    const rand = mulberry32(0x1a77e2);
    const out = [];
    for (let z = L.zNear; z > L.zFar; z -= L.spacing) {
        const zz = z + (rand() - 0.5) * 14;
        const yA = L.yMin + rand() * (L.yMax - L.yMin);
        const yB = L.yMin + rand() * (L.yMax - L.yMin);
        const skew = (rand() - 0.5) * 10;
        const hue = Math.floor(rand() * LANTERN_HEX.length);
        for (let i = 0; i < L.perString; i += 1) {
            const t = (i + 0.5) / L.perString;
            const x = -L.halfSpan + t * 2 * L.halfSpan;
            const y = yA + (yB - yA) * t - L.sag * 4 * t * (1 - t);
            const rgb = linearRgb(LANTERN_HEX[(hue + (rand() < 0.2 ? 1 : 0)) % LANTERN_HEX.length]);
            out.push({
                x, y, z: zz + skew * (t - 0.5), size: 1.05, rgb, seed: rand(), cable: 0,
            });
            // The cable between this lantern and the next: a faint dark-lit run.
            if (i < L.perString - 1) {
                const t2 = (i + 1) / L.perString;
                out.push({
                    x: -L.halfSpan + t2 * 2 * L.halfSpan,
                    y: yA + (yB - yA) * t2 - L.sag * 4 * t2 * (1 - t2) + 0.6,
                    z: zz + skew * (t2 - 0.5),
                    size: 0.45,
                    rgb: [0.5, 0.3, 0.25],
                    seed: rand(),
                    cable: 1,
                });
            }
        }
    }
    return out;
}

/**
 * @param {object} N neon uniforms
 * @returns {THREE.Mesh}
 */
export function createNeonLanterns(N) {
    const items = planNeonLanterns();
    const count = items.length;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    const packed = new Float32Array(count * 8);
    items.forEach((it, i) => {
        packed.set([it.x, it.y, it.z, it.size, it.rgb[0], it.rgb[1], it.rgb[2], it.cable + it.seed * 0.5], i * 8);
    });
    const buffer = new THREE.InstancedInterleavedBuffer(packed, 8, 1);
    geometry.setAttribute('aLantern', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aLanternCol', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.instanceCount = count;
    const a = attribute('aLantern', 'vec4');
    const c = attribute('aLanternCol', 'vec4');
    // The strings sway a little in the wind.
    const centre = a.xyz.add(vec3(0.0, sin(N.uTime.mul(0.9).add(a.z.mul(0.13))).mul(0.12), 0.0));

    const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(centre, 1.0));
    const half = screenSize.mul(0.5);
    const pxPerUnit = N.projY.mul(half.y).div(max(clip.w, 0.5));
    const sizePx = max(a.w.mul(2.6).mul(pxPerUnit), float(2.2));
    const vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(sizePx).div(half).mul(clip.w)), clip.z, clip.w);

    const cable = floor(c.w);
    const air = neonAir(N, centre);
    const ign = neonIgnition(N, centre);
    const flicker = sin(N.uTime.mul(c.w.mul(9.0).add(3.0)).add(c.w.mul(40.0))).mul(0.05).add(0.95);
    // A lantern is warm paper lit from inside; a cable segment only catches a little of it.
    const gain = mix(float(1.25), float(0.05), cable).mul(ign.level.mul(0.5).add(0.5)).mul(flicker);
    const vLight = varying(c.rgb.mul(gain).mul(float(1.0).sub(air.amount.mul(0.9))), 'vNeonLantern');

    const uOpacity = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.name = 'odyssey-neon-lanterns';
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
        const r2 = d.dot(d);
        const g = exp(r2.mul(-9.0)).mul(1.6).add(exp(r2.mul(-2.6)).mul(0.25)).sub(0.02)
            .max(0.0);
        return vec4(vLight.mul(g).mul(uOpacity).mul(N.seamReveal), 0.0);
    })();
    material.uniforms = { uOpacity };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-lantern-strings';
    mesh.frustumCulled = false;
    mesh.renderOrder = 22;
    return mesh;
}
