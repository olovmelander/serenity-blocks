/**
 * Parhelion geometry: the Vigil Stone (spec §5.1) and its inner-silhouette profile (§2.4).
 *
 * The stone is a leaning, weathered standing stone built as a dense lathe (≈ 2.6k tris) whose
 * rings are displaced OUTWARD only, so the body never shrinks below the core radius the solver
 * relies on. Three outward terms give it a rock's structure instead of a turned vase's:
 *   - a few broad split faces (the lathe pushed out to a circumscribed polygon whose faces
 *     twist slowly with height), so the flanks read as cleaved planes with weathered edges;
 *   - bedding ledges that dip across the stone: the face swells toward each ledge and steps
 *     back above it, leaving narrow up-facing shelves where the material lays snow;
 *   - broad lumps and a fine roughness from a seeded value noise.
 * The crown slants (the windward left shoulder stands highest) and the right shoulder carries
 * a small notch. The mesh is INDEXED with smooth vertex normals: the material shades the rock
 * from them (the old flat 11-facet look read as a placeholder).
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

/** Columns around the stone. */
export const STONE_RADIAL = 48;

/**
 * Lathe control profile (radius, height) in unit space, base → apex: a buried wide foot, a
 * slowly tapering body, a rounded shoulder and a low domed crown. The last entry is the apex.
 * buildStoneRings() resamples it to STONE_ROWS rings.
 */
export const STONE_LATHE = Object.freeze([
    [1.14, 0.0], [1.11, 0.1], [1.075, 0.23], [1.04, 0.38], [1.0, 0.54], [0.985, 0.68],
    [0.97, 0.80], [0.94, 0.885], [0.875, 0.945], [0.74, 0.992], [0.52, 1.028], [0.26, 1.05],
    [0.0, 1.058],
]);

/** Rings between the base and the apex (resampled from STONE_LATHE). */
export const STONE_ROWS = 44;

/** Split faces around the stone (the circumscribed polygon). */
const FACE_COUNT = 7;
/** Bedding ledges: base height (unit), dip amplitude, dip phase. */
const LEDGES = Object.freeze([
    Object.freeze([0.25, 0.035, 0.6]),
    Object.freeze([0.43, 0.045, 2.1]),
    Object.freeze([0.6, 0.03, 4.0]),
    Object.freeze([0.76, 0.04, 5.2]),
]);
/** How far below a ledge its swell begins (unit height) and how far it pushes out. */
const LEDGE_RUN = 0.1;
const LEDGE_PUSH = 0.04;

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

function smoothstep(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/** Seeded 2D value noise (lattice of hashes), periodic in x with `periodX` cells. */
function makeNoise(seed, periodX) {
    const rand = mulberry32(seed);
    const rows = 64;
    const lattice = new Float32Array(periodX * rows);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
    const at = (ix, iy) => lattice[(((iy % rows) + rows) % rows) * periodX + (((ix % periodX) + periodX) % periodX)];
    return (x, y) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;
        const ux = fx * fx * (3 - 2 * fx);
        const uy = fy * fy * (3 - 2 * fy);
        const a = at(ix, iy);
        const b = at(ix + 1, iy);
        const c = at(ix, iy + 1);
        const d = at(ix + 1, iy + 1);
        return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
}

/** STONE_LATHE resampled to `rows` rings + apex: piecewise-linear in arc length, base and apex kept. */
function resampleLathe(rows) {
    const pts = STONE_LATHE;
    const seg = [0];
    for (let i = 1; i < pts.length; i++) {
        seg.push(seg[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    // Rings stop short of the apex; the apex itself is the fan's tip.
    const total = seg[seg.length - 1];
    const out = [];
    for (let r = 0; r < rows; r++) {
        // Bias toward the crown, where the curvature is.
        const u = r / rows;
        const s = total * (u * 0.82 + 0.18 * u * u);
        let i = 1;
        while (i < seg.length - 1 && seg[i] < s) i += 1;
        const f = (s - seg[i - 1]) / Math.max(1e-9, seg[i] - seg[i - 1]);
        out.push([
            pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f,
            pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f,
        ]);
    }
    out.push(pts[pts.length - 1]);
    return out;
}

/**
 * Builds the ring vertices (unit space, un-leaned). Pure data: [ring][col] = {x, y, z}, plus
 * the apex. Exposed for the profile and the unit tests.
 * @param {number} seed
 * @param {{ radial?: number, rows?: number }} [options]
 */
export function buildStoneRings(seed = STONE_SEED, { radial = STONE_RADIAL, rows = STONE_ROWS } = {}) {
    const rand = mulberry32(seed);
    const noise = makeNoise(seed ^ 0x2545f491, 12);
    const lathe = resampleLathe(rows);
    // Split faces: centre angles with a little irregularity, twisting slowly with height.
    const faceAngle = [];
    for (let k = 0; k < FACE_COUNT; k++) faceAngle.push(((k + (rand() - 0.5) * 0.45) / FACE_COUNT) * TWO_PI);
    const faceTwist = (rand() - 0.5) * 0.7;
    const faceDepth = Array.from({ length: FACE_COUNT }, () => 0.55 + rand() * 0.4);
    // Right-shoulder notch: the columns nearest +x on the shoulder rings (§5.1: −4 %).
    const notchCol = Math.round(radial * 0.25);
    const rings = [];
    for (let r = 0; r < rows; r++) {
        const [radius, height] = lathe[r];
        const ring = [];
        const upper = Math.min(1, Math.max(0, (height - 0.78) / 0.28));
        // The crown dome is weathered smooth: the split faces and ledges fade out over it.
        const body = 1 - smoothstep(0.86, 1.0, height);
        for (let c = 0; c < radial; c++) {
            // θ = 0 faces the camera (+z); θ grows toward +x.
            const theta = (c / radial) * TWO_PI;
            // Circumscribed polygon (outward only: 1/cos ≥ 1), its faces twisting with height.
            let poly = 0;
            let best = Infinity;
            let bestK = 0;
            for (let k = 0; k < FACE_COUNT; k++) {
                let d = theta - (faceAngle[k] + faceTwist * height);
                d -= TWO_PI * Math.round(d / TWO_PI);
                if (Math.abs(d) < best) {
                    best = Math.abs(d);
                    bestK = k;
                }
            }
            poly = Math.min(0.13, 1 / Math.cos(Math.min(best, 1.2)) - 1) * faceDepth[bestK];
            // Bedding ledges: swell toward each (dipping) ledge, step back above it. Each ledge
            // comes and goes around the stone (its presence is a noise in θ), so the steps never
            // read as stacked rings.
            const u = (c / radial) * 12;
            let ledge = 0;
            const ledgeW = [0, 0, 0, 0];
            for (let j = 0; j < LEDGES.length; j++) {
                const [y0, dip, phase] = LEDGES[j];
                const yl = y0 + dip * Math.sin(theta + phase);
                ledgeW[j] = smoothstep(0.3, 0.6, noise(u, 20 + j * 7));
                if (height < yl && height > yl - LEDGE_RUN) {
                    const swell = LEDGE_PUSH * ledgeW[j] * smoothstep(yl - LEDGE_RUN, yl - 0.012, height);
                    ledge = Math.max(ledge, swell);
                }
            }
            // Broad lumps and fine roughness (value noise, periodic around the stone).
            const lump = 0.045 * (Math.max(0, noise(u * 0.5, height * 3.0) - 0.35) / 0.65);
            const fine = 0.014 * noise(u * 2.0 + 3.7, height * 14.0);
            let k = 1 + (poly * 0.85 + ledge) * body + lump + fine;
            if (r > 0 && Math.abs(c - notchCol) <= 1 && height > 0.84 && height < 0.95) k *= 0.96;
            let x = Math.sin(theta) * radius * k;
            let y = height;
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
            // Signed unit height above each bedding ledge: the material lays snow on the shelf
            // just above the line and a shadow just under it (linear, so it interpolates exactly).
            const ledgeD = LEDGES.map(([y0, dip, phase]) => height - (y0 + dip * Math.sin(theta + phase)));
            ring.push({
                x, y, z, ledgeD, ledgeW: ledgeW.map((w) => w * body),
            });
        }
        rings.push(ring);
    }
    const apexH = lathe[rows][1];
    const apex = {
        x: -0.10, y: apexH, z: 0, ledgeD: [1, 1, 1, 1], ledgeW: [0, 0, 0, 0],
    };
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
 * @param {{ radial?: number, rows?: number }} [options] coarser meshes for the far stones
 * @returns {{ geometry: THREE.BufferGeometry, profile: Float32Array, crown: {x:number,y:number} }}
 */
export function buildStoneGeometry(seed = STONE_SEED, options = {}) {
    const { rings, apex } = buildStoneRings(seed, options);
    const radial = rings[0].length;
    const positions = [];
    const ledge = [];
    const ledgeW = [];
    for (const ring of rings) {
        for (const v of ring) {
            positions.push(v.x, v.y, v.z);
            ledge.push(...v.ledgeD);
            ledgeW.push(...v.ledgeW);
        }
    }
    positions.push(apex.x, apex.y, apex.z);
    ledge.push(...apex.ledgeD);
    ledgeW.push(...apex.ledgeW);
    const apexIndex = positions.length / 3 - 1;
    const idx = (r, c) => r * radial + (c % radial);

    // θ grows toward +x from +z, so (r,c) → (r,c+1) → (r+1,c+1) winds counter-clockwise seen
    // from outside: every face points away from the axis (pinned by the geometry test).
    const indices = [];
    for (let r = 0; r < rings.length - 1; r++) {
        for (let c = 0; c < radial; c++) {
            indices.push(idx(r, c), idx(r, c + 1), idx(r + 1, c + 1));
            indices.push(idx(r, c), idx(r + 1, c + 1), idx(r + 1, c));
        }
    }
    const top = rings.length - 1;
    for (let c = 0; c < radial; c++) indices.push(idx(top, c), idx(top, c + 1), apexIndex);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aLedge', new THREE.Float32BufferAttribute(ledge, 4));
    geometry.setAttribute('aLedgeW', new THREE.Float32BufferAttribute(ledgeW, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return { geometry, profile: measureStoneProfile(rings), crown: { x: apex.x, y: apex.y } };
}

/** Seed of the far stones' shared mesh (a coarser cousin of the Vigil Stone). */
export const FAR_STONE_SEED = 0x7a11;

/**
 * The far stones (composition FAR_STONES) as ONE instanced mesh: a coarse stone lathe (no
 * ledge attributes), each instance turned, leaned, scaled to its size and sunk a little into
 * the snow. One draw call for the whole row.
 * @param {THREE.Material} material
 * @param {ReadonlyArray<ReadonlyArray<number>>} stones `[x, z, halfWidth, height, lean, turn]`
 */
export function buildFarStoneMesh(material, stones) {
    const { geometry: lathe } = buildStoneGeometry(FAR_STONE_SEED, { radial: 14, rows: 12 });
    // Split slabs, not thumbs: cut the domed crown off along a slanted plane, then shade flat
    // (non-indexed), so each far stone shows cleaved faces and a sharp, leaning top.
    const pos = lathe.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const cut = 0.86 + 0.16 * pos.getX(i) - 0.05 * pos.getZ(i);
        if (pos.getY(i) > cut) pos.setY(i, cut);
    }
    const geometry = lathe.toNonIndexed();
    lathe.dispose();
    geometry.deleteAttribute('aLedge');
    geometry.deleteAttribute('aLedgeW');
    geometry.computeVertexNormals();
    const mesh = new THREE.InstancedMesh(geometry, material, stones.length);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const at = new THREE.Vector3();
    stones.forEach(([x, z, halfWidth, height, lean, turn], i) => {
        euler.set(0, turn, lean, 'ZYX');
        // Slabs: thinner front to back, so a turned stone shows a narrow edge.
        scale.set(halfWidth, height / 1.04, halfWidth * 0.42);
        at.set(x, -1.2, z);
        mesh.setMatrixAt(i, matrix.compose(at, quat.setFromEuler(euler), scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = 'parhelion-far-stones';
    return mesh;
}
