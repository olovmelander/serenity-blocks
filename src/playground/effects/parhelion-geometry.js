/**
 * Parhelion geometry: the Vigil Stone (spec §5.1) and its inner-silhouette profile (§2.4).
 *
 * The stone is a leaning glacial erratic / bautasten built as a low-poly lathe (≈250 tris)
 * whose rings are jittered OUTWARD only (0–6 % plus broad lumps), twisted and height-jittered
 * so the facet grid never reads as a turned vase. It is returned NON-indexed, so every
 * triangle is a flat facet that carries:
 *   - `aFacet` (float, per triangle) — a seeded hash the material turns into facet tones;
 *   - `aBary`  (vec3, per vertex)    — barycentrics, for a few frost cracks along facet edges;
 *   - `normal` — SMOOTH vertex normals computed before de-indexing (the gold rim needs them;
 *     the flat facet normal comes from screen derivatives in the material).
 *
 * Unit space: core radius 1, base at y 0 (buried), crown ≈ STONE.UNIT_CROWN. The solver in
 * parhelion-composition.js scales it (sx, sy, sx · DEPTH_SCALE), leans it (rotation.z = −LEAN)
 * and places it at (0, 0, STONE.Z). `profile[STONE.BANDS]` is measured from the finished mesh
 * and must stay equal to DEFAULT_STONE_PROFILE for the default seed (pinned by a unit test).
 */

import * as THREE from 'three/webgpu';
import { STONE } from './parhelion-composition.js';

/** Default stone seed (§5.1). */
export const STONE_SEED = 0x5057;

/** Facets around the stone (§5.1: 11). */
export const STONE_RADIAL = 11;

/**
 * Lathe profile (radius, height) in unit space, base → apex: a buried wide foot, a slowly
 * tapering body, a rounded shoulder and a low domed crown. The last entry is the apex.
 */
export const STONE_LATHE = Object.freeze([
    [1.14, 0.0], [1.11, 0.1], [1.075, 0.23], [1.04, 0.38], [1.0, 0.54], [0.985, 0.68],
    [0.97, 0.80], [0.94, 0.885], [0.875, 0.945], [0.74, 0.992], [0.52, 1.028], [0.26, 1.05],
    [0.0, 1.058],
]);

function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const TWO_PI = Math.PI * 2;

/**
 * Builds the ring vertices (unit space, un-leaned). Pure data: [ring][col] = {x, y, z}, plus
 * the apex. Exposed for the profile and the unit tests.
 * @param {number} seed
 */
export function buildStoneRings(seed = STONE_SEED) {
    const rand = mulberry32(seed);
    const rows = STONE_LATHE.length - 1; // rings (the last lathe entry is the apex)
    const rings = [];
    // Right-shoulder notch: the column nearest +x on two shoulder rings (§5.1: −4 %).
    const notchCol = Math.round(STONE_RADIAL * 0.25);
    for (let r = 0; r < rows; r++) {
        const [radius, height] = STONE_LATHE[r];
        const ring = [];
        const upper = Math.min(1, Math.max(0, (height - 0.78) / 0.28));
        for (let c = 0; c < STONE_RADIAL; c++) {
            const jitter = rand() * 0.06;
            const twist = (rand() - 0.5) * 0.28;
            const lift = r === 0 ? 0 : (rand() - 0.5) * 0.03;
            // Broad asymmetric lumps, outward only — the silhouette never shrinks below the core.
            const lump = 0.07 * Math.max(0, Math.sin(r * 0.9 + c * 1.7 + 0.5));
            let k = r === 0 ? 1 : 1 + jitter + lump;
            if (c === notchCol && (r === 7 || r === 8)) k *= 0.95;
            // θ = 0 faces the camera (+z); θ grows toward +x.
            const theta = ((c + twist) / STONE_RADIAL) * TWO_PI;
            let x = Math.sin(theta) * radius * k;
            let y = height + lift;
            const z = Math.cos(theta) * radius * k;
            // Asymmetric crown: the peak leans left, the right shoulder falls away lower.
            if (x > 0) {
                x *= 1 - 0.05 * upper;
                y -= 0.02 * upper;
            }
            // A slanted crown — the windward (left) shoulder stands higher — reads as a standing
            // stone, never as a rounded loaf.
            y -= 0.05 * x * upper;
            x -= 0.10 * upper;
            ring.push({ x, y, z });
        }
        rings.push(ring);
    }
    const apexH = STONE_LATHE[rows][1];
    const apex = { x: -0.10, y: apexH, z: 0 };
    return { rings, apex };
}

/**
 * Inner-silhouette profile (§2.4): for each of STONE.BANDS equal bands of unit height
 * [0, UNIT_SHOULDER], the MINIMUM over the band of min(left, right) silhouette half-width of
 * the un-leaned stone (core radius 1). Ring extents are interpolated linearly between rings.
 */
export function measureStoneProfile(rings) {
    const extents = rings.map((ring) => {
        let left = 0;
        let right = 0;
        let y = 0;
        for (const v of ring) {
            left = Math.max(left, -v.x);
            right = Math.max(right, v.x);
            y += v.y / ring.length;
        }
        return { y, half: Math.min(left, right) };
    });
    const profile = new Float32Array(STONE.BANDS);
    const bandH = STONE.UNIT_SHOULDER / STONE.BANDS;
    const halfAt = (y) => {
        for (let i = 0; i < extents.length - 1; i++) {
            const a = extents[i];
            const b = extents[i + 1];
            if (y <= b.y) {
                const f = Math.min(1, Math.max(0, (y - a.y) / Math.max(1e-6, b.y - a.y)));
                return a.half + (b.half - a.half) * f;
            }
        }
        return extents[extents.length - 1].half;
    };
    for (let b = 0; b < STONE.BANDS; b++) {
        let m = Infinity;
        for (let s = 0; s <= 8; s++) m = Math.min(m, halfAt((b + s / 8) * bandH));
        profile[b] = Math.round(m * 1000) / 1000;
    }
    return profile;
}

/**
 * Builds the Vigil Stone geometry and its profile.
 * @param {number} [seed]
 * @returns {{ geometry: THREE.BufferGeometry, profile: Float32Array, crown: {x:number,y:number} }}
 */
export function buildStoneGeometry(seed = STONE_SEED) {
    const { rings, apex } = buildStoneRings(seed);
    const positions = [];
    for (const ring of rings) for (const v of ring) positions.push(v.x, v.y, v.z);
    positions.push(apex.x, apex.y, apex.z);
    const apexIndex = positions.length / 3 - 1;
    const idx = (r, c) => r * STONE_RADIAL + (c % STONE_RADIAL);

    const indices = [];
    const pushTri = (a, b, c) => {
        // Orient every facet outward (away from the stone's axis), whatever the jitter did.
        const ax = positions[a * 3];
        const ay = positions[a * 3 + 1];
        const az = positions[a * 3 + 2];
        const ux = positions[b * 3] - ax;
        const uy = positions[b * 3 + 1] - ay;
        const uz = positions[b * 3 + 2] - az;
        const vx = positions[c * 3] - ax;
        const vy = positions[c * 3 + 1] - ay;
        const vz = positions[c * 3 + 2] - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const cx = (ax + positions[b * 3] + positions[c * 3]) / 3;
        const cy = (ay + positions[b * 3 + 1] + positions[c * 3 + 1]) / 3 - 0.45;
        const cz = (az + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
        if (nx * cx + ny * cy + nz * cz < 0) indices.push(a, c, b);
        else indices.push(a, b, c);
    };
    for (let r = 0; r < rings.length - 1; r++) {
        for (let c = 0; c < STONE_RADIAL; c++) {
            pushTri(idx(r, c), idx(r, c + 1), idx(r + 1, c + 1));
            pushTri(idx(r, c), idx(r + 1, c + 1), idx(r + 1, c));
        }
    }
    const top = rings.length - 1;
    for (let c = 0; c < STONE_RADIAL; c++) pushTri(idx(top, c), idx(top, c + 1), apexIndex);

    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    indexed.setIndex(indices);
    indexed.computeVertexNormals();
    const geometry = indexed.toNonIndexed();
    indexed.dispose();

    // Per-facet hash and per-vertex barycentrics.
    const triCount = geometry.attributes.position.count / 3;
    const facet = new Float32Array(triCount * 3);
    const bary = new Float32Array(triCount * 9);
    const rand = mulberry32(seed ^ 0x9e3779b9);
    for (let t = 0; t < triCount; t++) {
        const h = rand();
        for (let k = 0; k < 3; k++) {
            facet[t * 3 + k] = h;
            bary[t * 9 + k * 3 + k] = 1;
        }
    }
    geometry.setAttribute('aFacet', new THREE.BufferAttribute(facet, 1));
    geometry.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
    geometry.computeBoundingSphere();
    return { geometry, profile: measureStoneProfile(rings), crown: { x: apex.x, y: apex.y } };
}
