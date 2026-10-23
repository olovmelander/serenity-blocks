/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Chapter 8's skybridges (2026-10-20 overhaul).
 *
 * Glazed walkways spanning the boulevard between the inner towers (Neon District hangs a lit
 * bridge over its street the same way, neon-district-world.js): a dark box with a band of warm
 * windows on both long faces, a chasing LED strip under the glazing, and a roof whose edges are
 * lit — the eye flies over them, so the roof matters as much as the sides. One instanced draw.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    exp,
    float,
    floor,
    fract,
    fwidth,
    materialOpacity,
    max,
    min,
    mix,
    normalGeometry,
    oneMinus,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { hash21 } from './odyssey-tsl-noise.js';
import {
    neonCityPos,
    neonAtmosphere,
    neonGlow,
    neonIgnition,
} from './odyssey-neon-light.tsl.js';

/** [target z, y (deck centre), seed] down the canyon (corridor units). */
export const NEON_SKYBRIDGES = Object.freeze([
    [12, -46, 3],
    [-158, -28, 7],
    [-332, -40, 11],
]);
const SPAN = 56;
const HEIGHT = 6;
const DEPTH = 8;

/**
 * Seat each bridge between the two inner towers nearest its target: its z where both towers'
 * flanks overlap, its ends 1 u into each wall (nothing floats in the gap between two blocks).
 * @param {object[]} towers dealCityTowers()
 * @returns {{x:number, y:number, z:number, span:number, seed:number}[]}
 */
export function seatNeonSkybridges(towers) {
    const inner = towers.filter((t) => t.bank === 0);
    return NEON_SKYBRIDGES.map(([target, y, seed]) => {
        let best = null;
        inner.filter((t) => t.side < 0).forEach((left) => {
            const right = inner.find((t) => t.side > 0 && t.rank === left.rank);
            if (!right) return;
            const lo = Math.max(left.z - left.depth / 2, right.z - right.depth / 2);
            const hi = Math.min(left.z + left.depth / 2, right.z + right.depth / 2);
            const top = Math.min(left.y + left.height / 2, right.y + right.height / 2);
            if (hi - lo < DEPTH + 2 || top < y + HEIGHT) return;
            const z = (lo + hi) / 2;
            if (!best || Math.abs(z - target) < Math.abs(best.z - target)) {
                const innerL = Math.abs(left.x) - left.width / 2;
                const innerR = Math.abs(right.x) - right.width / 2;
                best = {
                    x: (innerR - innerL) / 2, y, z, span: innerL + innerR + 2, seed,
                };
            }
        });
        return best;
    }).filter(Boolean);
}

/**
 * @param {object} N neon uniforms
 * @param {object[]} towers dealCityTowers()
 * @returns {THREE.InstancedMesh}
 */
export function createNeonSkybridges(N, towers) {
    const seats = seatNeonSkybridges(towers);
    const geometry = new THREE.BoxGeometry(SPAN, HEIGHT, DEPTH);
    const seeds = new Float32Array(Math.max(1, seats.length));
    seats.forEach(({ seed }, i) => { seeds[i] = seed; });
    geometry.setAttribute('aBridgeSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    const seedV = varying(attribute('aBridgeSeed', 'float'), 'vBridgeSeed').setInterpolation('flat', 'either');
    const nV = varying(normalGeometry, 'vBridgeNormal').setInterpolation('flat', 'either');
    const pcV = neonCityPos(N, 'vBridgePos');

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-neon-skybridges';
    material.fog = false;
    material.colorNode = Fn(() => {
        const pc = pcV.toVar();
        // Clamped: MSAA evaluates a thin far bridge's uv at pixel centres OUTSIDE 0..1, and the
        // roof edge's exp() of a negative distance overflowed into a magenta bloom blob.
        const st = clamp(uv(), 0.0, 1.0);
        const n = nV;
        const seed = seedV;
        const ign = neonIgnition(N, pc);
        const isSide = step(0.5, abs(n.z));
        const isTop = step(0.5, n.y);
        // Along the span (metres) on the long faces; across the deck on the roof.
        const along = st.x.mul(SPAN);
        const aaAlong = fwidth(along).add(0.02);
        // ── Long faces: a band of warm glazing over a chasing LED strip ──
        const bay = fract(along.div(2.4));
        const aaBay = aaAlong.div(2.4);
        const mullion = smoothstep(float(0.06).sub(aaBay), float(0.06).add(aaBay), min(bay, oneMinus(bay)));
        const band = smoothstep(0.26, 0.3, st.y).mul(oneMinus(smoothstep(0.78, 0.82, st.y)));
        const lit = step(0.25, hash21(vec2(floor(along.div(2.4)), seed)));
        const cool = step(0.8, hash21(vec2(floor(along.div(2.4)), seed.add(5.0))));
        const lamp = mix(vec3(1.0, 0.62, 0.32), vec3(0.62, 0.82, 1.0), cool);
        const windows = lamp.mul(0.55).mul(lit).mul(mullion).mul(band)
            .mul(mix(float(1.08), float(0.75), st.y))
            .mul(ign.level.mul(0.5).add(0.5));
        const ledRow = smoothstep(0.1, 0.12, st.y).mul(oneMinus(smoothstep(0.17, 0.19, st.y)));
        const chase = smoothstep(0.65, 1.0, fract(along.mul(0.05).sub(N.uTime.mul(0.5)).add(seed.mul(0.13))));
        const ledCol = mix(vec3(1.0, 0.1, 0.45), vec3(0.08, 0.78, 1.0), step(0.5, fract(seed.mul(0.37))));
        const led = ledCol.mul(chase.mul(1.1).add(0.3)).mul(ledRow).mul(ign.level);
        // ── Roof: dark, its two long edges lit ──
        const edgeY = max(min(st.y, oneMinus(st.y)), 0.0).mul(DEPTH);
        const roofEdge = exp(edgeY.mul(-5.0)).mul(0.55);
        const roofLed = ledCol.mul(roofEdge).mul(chase.mul(0.6).add(0.4)).mul(ign.level);
        // ── The city's light on the dark body ──
        const glow = neonGlow(N, pc, 0).add(neonGlow(N, pc, 1).mul(0.5));
        const body = vec3(0.02, 0.019, 0.026).mul(glow.mul(0.9).add(vec3(0.25, 0.22, 0.35)));
        const sides = body.add(windows).add(led);
        const roof = body.mul(0.8).add(roofLed);
        const col = mix(mix(body, sides, isSide), roof, isTop);
        return neonAtmosphere(N, max(col, vec3(0.0)), pc);
    })();

    // The 7->8 carry: arrive through the tunnel's mouth (times the manager's crossfade weight).
    material.opacityNode = materialOpacity.mul(N.seamReveal);
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, seats.length));
    mesh.name = 'neon-skybridges';
    mesh.count = seats.length;
    const m = new THREE.Matrix4();
    seats.forEach(({
        x, y, z, span,
    }, i) => {
        m.makeScale(span / SPAN, 1, 1).setPosition(x, y, z);
        mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
}
