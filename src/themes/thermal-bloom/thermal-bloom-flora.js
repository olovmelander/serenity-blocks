/**
 * Thermal Bloom — the ghost pines (iris-springs.md §1.2, §1.4): stands of dead lodgepole pines,
 * silver-grey, with white silica "socks" where they stand in shallow runoff.
 *
 * Every pine is one camera-facing card (it turns about its own trunk), drawn in one call; its
 * fragment draws the silhouette procedurally — a tapering trunk with a slight lean and a dozen
 * broken branch stubs angled up and out — anti-aliased by the pixel's footprint, so a trunk a
 * pixel wide still reads as a continuous silver line. Side-lit from the sun's side, the shade
 * side cool; the sock below a metre is white sinter with a wet sheen. Frost (First Frost)
 * feathers the stubs white; snow (Deep Cold) caps the stubs' tops. Still: they are dead.
 *
 * The world places the stands from screen anchors (thermal-bloom-core.js PINE_STANDS) and writes
 * each tree's (x, z, height, seed) into the instance attribute.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    dot,
    exp,
    float,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    tbAerial,
    tbCloudShade,
    tbBounce,
    tbFxMaterial,
    tbHash21,
    tbPart,
} from './thermal-bloom-tsl.js';
import { flatVarying } from '../shared/flat-varying.js';

/** Branch stubs a pine carries (evaluated per fragment; a fixed small loop, unrolled). */
const STUBS = 8;

/**
 * The ghost pines: `count` cards, their placements written later by `part.setTrees(trees)`.
 * @param {object} u     the shared uniforms
 * @param {number} count the tier's pines
 */
export function createPines(u, count) {
    const n = Math.max(1, count);
    const positions = new Float32Array(n * 4 * 3);
    const tree = new Float32Array(n * 4 * 4);
    const index = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
        [[-1, 0], [1, 0], [1, 1], [-1, 1]].forEach(([x, y], c) => {
            positions.set([x, y, 0], (i * 4 + c) * 3);
        });
        index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const treeAttr = new THREE.BufferAttribute(tree, 4);
    geometry.setAttribute('aTree', treeAttr);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));

    const aTree = attribute('aTree', 'vec4');
    const vLocal = varying(positionGeometry.xy, 'vPineLocal');
    // The tree's own numbers, flat: interpolated, its seed came out a few bits off from pixel to
    // pixel and every stub's height, side and length with it (ragged, speckled stubs).
    const vTree = flatVarying(aTree, 'vPineTree');
    /** The card's half-width in metres for a tree of height h (room for the stubs). */
    const halfWidth = (h) => h.mul(0.14).add(0.8);

    const material = tbFxMaterial('ThermalBloomPines');
    material.positionNode = Fn(() => {
        const base = vec3(aTree.x, 0.0, aTree.y);
        const h = aTree.z;
        const toCam = normalize(u.camPos.xz.sub(base.xz).add(vec2(1e-3, 0.0)));
        const right = vec2(toCam.y.negate(), toCam.x);
        const xz = base.xz.add(right.mul(positionGeometry.x).mul(halfWidth(h)));
        // Lifted from below the ground so the sock meets the apron without a seam.
        return vec3(xz.x, positionGeometry.y.mul(h.add(0.6)).sub(0.6), xz.y).mul(step(0.5, h));
    })();

    const pineFn = Fn(() => {
        const h = vTree.z;
        const seed = vTree.w;
        // Metres in the card: x across (signed), y up from the foot.
        const x = vLocal.x.mul(halfWidth(h)).toVar();
        const y = vLocal.y.mul(h.add(0.6)).sub(0.6).toVar();
        const f = clamp(y.div(h), 0.0, 1.0);
        // A trunk tapering to a snag, leaning a little, broken off at its top.
        const lean = tbHash21(vec2(seed, 2.1)).sub(0.5).mul(0.21).mul(y);
        const radius = mix(float(0.34), float(0.07), f).mul(tbHash21(vec2(seed, 4.3)).mul(0.5).add(0.8));
        const px = max(fwidth(x), 1e-4);
        const trunkD = abs(x.sub(lean)).sub(radius);
        const trunk = clamp(float(0.5).sub(trunkD.div(px)), 0.0, 1.0).mul(step(y, h)).toVar();
        // Branch stubs: short, angled up and out, thinner and fewer toward the top.
        const stubs = float(0.0).toVar();
        for (let k = 0; k < STUBS; k++) {
            const hk = tbHash21(vec2(seed, 11.0 + k)).mul(0.75).add(0.18).mul(h);
            const side = step(0.5, tbHash21(vec2(seed, 31.0 + k))).mul(2.0).sub(1.0);
            const len = tbHash21(vec2(seed, 51.0 + k)).mul(1.8).add(0.8).mul(float(1.0).sub(hk.div(h).mul(0.6)));
            const dir = normalize(vec2(side, tbHash21(vec2(seed, 71.0 + k)).mul(0.8).add(0.35)));
            const o = vec2(x.sub(lean), y.sub(hk));
            const along = clamp(dot(o, dir), 0.0, len);
            const dist = length(o.sub(dir.mul(along))).sub(mix(float(0.15), float(0.05), along.div(max(len, 1e-3))));
            stubs.assign(max(stubs, clamp(float(0.5).sub(dist.div(px)), 0.0, 1.0)));
        }
        // The wet dark patch where the tree stands in runoff, a smear round its sock.
        const footX = x.div(max(radius.mul(7.0), px.mul(2.0)));
        const footY = y.add(0.1).div(0.35);
        const foot = exp(footX.mul(footX).add(footY.mul(footY)).negate()).mul(0.55);
        const cover = max(max(trunk, stubs), foot).toVar();
        cover.lessThan(0.004).discard();
        // Light: silver-grey dead wood, lit on the sun's side of the trunk, cool in shade.
        const P = positionWorld;
        const toCam = u.camPos.sub(P);
        const dist = length(toCam);
        const V = toCam.div(max(dist, 1e-3));
        const rightW = normalize(vec3(V.z, 0.0, V.x.negate()));
        const sunSide = dot(rightW, u.sunDir).mul(x.sub(lean).div(max(radius, 0.05)).clamp(-1.0, 1.0));
        const lit = clamp(sunSide.mul(0.5).add(0.55), 0.15, 1.0);
        const wood = mix(vec3(0.46, 0.45, 0.43), vec3(0.6, 0.58, 0.55), tbHash21(vec2(seed, 9.9)));
        // The sock: white silica below about a metre, wet at its foot.
        const sock = smoothstep(1.1, 0.7, y);
        const frost = u.frost.mul(stubs).mul(0.6).add(u.snow.mul(stubs).mul(0.5));
        const albedo = mix(mix(wood, vec3(0.86, 0.85, 0.8), sock), vec3(0.92, 0.94, 0.96), clamp(frost, 0.0, 1.0))
            .toVar();
        albedo.assign(mix(albedo, vec3(0.26, 0.25, 0.23), foot.mul(float(1.0).sub(max(trunk, stubs)))));
        const col = albedo.mul(u.sunColor.mul(lit.mul(0.95).mul(tbCloudShade(u, P))).add(mix(u.haze, u.zenith, 0.5).mul(0.3))
            .add(tbBounce(u, vec3(0.0, 0.0, 1.0))));
        const out = tbAerial(u, col, dist, V.negate());
        return vec4(out.mul(cover), cover);
    });
    material.colorNode = pineFn();
    const part = tbPart('ThermalBloomPines', geometry, material, 57);
    /** Write the trees: [{ x, z, height, seed }], at most the tier's count (the rest fold away). */
    part.setTrees = (trees) => {
        for (let i = 0; i < n; i++) {
            const t = trees[i];
            for (let c = 0; c < 4; c++) {
                const o = (i * 4 + c) * 4;
                tree[o] = t ? t.x : 0;
                tree[o + 1] = t ? t.z : 0;
                tree[o + 2] = t ? t.height : 0;
                tree[o + 3] = t ? t.seed : 0;
            }
        }
        treeAttr.needsUpdate = true;
    };
    part.count = n;
    return part;
}
