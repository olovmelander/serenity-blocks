/**
 * The ground the aurora stands over: glacial horns rising from eroded foothills, a frozen
 * lake that mirrors the whole sky, two snow banks with conifers framing the near corners,
 * and a far forest along the foot of the range.
 *
 * The lake is the second hero. On the upper tiers it is a true planar mirror (the scene
 * rendered once more from below the water); on the cheapest tiers it mirrors analytically:
 * the sky gradient, the curtain buffer read along the reflected ray, and the skyline from a
 * baked ridge profile. Clear ice carries stationary pressure cracks over the reflection.
 * Narrow leads and gameplay rings bend that reflection on every tier.
 *
 * Every surface takes its light from the display itself: snow facing the sky glows with
 * the colour of the curtain standing above it (a magenta pulse turns the snow under it
 * magenta), and every surface is fogged by the same air (aurora-atmosphere.js).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, abs, atan, attribute, cameraPosition, clamp, dot, exp, float, floor, fract, int, length, max, mix,
    normalWorld, normalize, positionGeometry, positionWorld, pow, reflector, screenUV, select, sin, smoothstep, step,
    texture, uniform, uniformArray, vec2, vec3,
    pow3,
} from 'three/tsl';
import { fbm2 } from './aurora-noise.js';
import { createAuroraConifers, createConiferShade } from './aurora-conifers.js';
import {
    SHORE_ICE, SHORE_Z, bakeShoreIce, bankHeight, forestCover, rangeHeight, smooth,
} from './aurora-terrain.js';
import { AURORA_COLORS } from './aurora-palette.js';
import { cloudedSky, moonPath, moonRadiance } from './aurora-sky.js';
import { sessionRangeGrid, sessionShoreIce } from './aurora-bakes.js';
import { prepareSessionGeometry, sessionGeometry } from '../shared/session-geometry.js';
import { drainSteps, stepClock } from '../shared/build-steps.js';

export {
    SHORE_ICE, SHORE_Z, bakeShoreIce, bankHeight, forestCover, rangeHeight,
};

const LAKE_HALF_WIDTH = 5200;
const PROFILE_BINS = 512;
const PROFILE_MAX_ELEVATION = 0.4;
const DEG = Math.PI / 180;
/** How fast a lake ring fades (1/s): the shader and the slot choice read the same. */
const RIPPLE_FADE = 0.55;
/**
 * The lake's columns of light: how far above the mirrored ray each tap looks (degrees: twice a
 * wavelet facet's tilt), the share of that sky it throws to the eye (steeper facets are rarer
 * and reflect less), and how much of it a glassy lane keeps. A tier takes the first
 * `lakeStreaks` of them.
 */
const LAKE_STREAKS = Object.freeze([
    [11, 0.2, 0.3],
    [22, 0.13, 0.1],
    [5, 0.22, 0.6],
    [33, 0.07, 0.03],
]);
/** Moon-glitter cells per tangent of view, measured from the resting eye. */
const MOON_GLITTER = 190;
/** How long one slice of the range's cover runs before it yields to the page (ms). */
const RANGE_SLICE_MS = 8;
const triple = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);
/** vec2 → vec3 in [0, 1): hash without sine, so a cell keeps its value on every GPU. */
const hash23 = /* @__PURE__ */ Fn(([cell]) => {
    const p3 = fract(vec3(cell.x, cell.y, cell.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yzz).mul(p3.zyx));
}).setLayout({ name: 'aurora_hash23', type: 'vec3', inputs: [{ name: 'cell', type: 'vec2' }] });

function buildGrid(columns, rows, place) {
    const count = columns * rows;
    const positions = new Float32Array(count * 3);
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const [x, y, z] = place(column / (columns - 1), row / (rows - 1));
            positions.set([x, y, z], (row * columns + column) * 3);
        }
    }
    return buildGridFrom(columns, rows, positions);
}

/** The grid's triangles and normals over its points (buildGrid's, or aurora-terrain.js's). */
function buildGridFrom(columns, rows, positions) {
    const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
    let cursor = 0;
    for (let row = 0; row < rows - 1; row += 1) {
        for (let column = 0; column < columns - 1; column += 1) {
            const a = row * columns + column;
            const b = a + 1;
            const c = a + columns;
            const d = c + 1;
            indices.set([a, b, c, b, d, c], cursor);
            cursor += 6;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    return geometry;
}

/** Skyline elevation by azimuth as seen from below the water: the low tiers' mirror mask. */
export function bakeRidgeProfile(positions, eyeHeight, columns = 1) {
    const profile = new Float32Array(PROFILE_BINS);
    let previousBin = 0;
    let previousElevation = 0;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        const bin = (Math.atan2(x, -z) / Math.PI + 0.5) * (PROFILE_BINS - 1);
        const elevation = y > 0 ? Math.atan2(y + eyeHeight, Math.hypot(x, z)) : 0;
        const nearest = Math.round(bin);
        if (nearest >= 0 && nearest < PROFILE_BINS) profile[nearest] = Math.max(profile[nearest], elevation);
        // Project the connected row, not just its vertices. On Minimal a single triangle
        // spans several bins; empty bins reflected as straight black bars down the lake.
        if ((i / 3) % columns !== 0 && bin > previousBin) {
            const first = Math.max(0, Math.ceil(previousBin));
            const last = Math.min(PROFILE_BINS - 1, Math.floor(bin));
            for (let b = first; b <= last; b += 1) {
                const t = (b - previousBin) / (bin - previousBin);
                profile[b] = Math.max(profile[b], previousElevation + (elevation - previousElevation) * t);
            }
        }
        previousBin = bin;
        previousElevation = elevation;
    }
    const data = new Uint8Array(PROFILE_BINS * 4);
    for (let bin = 0; bin < PROFILE_BINS; bin += 1) {
        const before = profile[Math.max(0, bin - 2)];
        const after = profile[Math.min(PROFILE_BINS - 1, bin + 2)];
        data[bin * 4] = Math.round(Math.min(1, profile[bin] / PROFILE_MAX_ELEVATION) * 255);
        data[bin * 4 + 1] = Math.round(255 * smooth(-0.016, 0.026, after - before));
        data[bin * 4 + 3] = 255;
    }
    return data;
}

/**
 * The range's mesh over the grid's points (aurora-bakes.js), as steps: its triangles and normals,
 * then the snow and forest cover in rows, yielding once a slice has run RANGE_SLICE_MS, then the
 * skyline profile. The same values in the same order as in one piece.
 * @returns {Generator<string, { geometry: THREE.BufferGeometry, ridgeProfile: Uint8Array }>}
 */
function* rangeMeshSteps(columns, rows, seed, eyeHeight) {
    const built = buildGridFrom(columns, rows, sessionRangeGrid(columns, rows, seed));
    yield 'range normals';
    const clock = stepClock(RANGE_SLICE_MS);
    const positions = built.attributes.position.array;
    const normals = built.attributes.normal.array;
    const cover = new Float32Array(columns * rows * 4);
    const horizon = new Float32Array(columns);
    for (let i = 0; i < positions.length; i += 3) {
        const column = (i / 3) % columns;
        const elevation = (positions[i + 1] - eyeHeight) / Math.max(1, -positions[i + 2]);
        horizon[column] = Math.max(horizon[column], elevation);
    }
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const i = row * columns + column;
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];
            const flatness = normals[i * 3 + 1];
            // Snow lies on gentle ground and thins on steep faces, which stay bare rock.
            // Dark spruce forest fills the low slopes in patches.
            const snow = smooth(0.37, 0.86, flatness) * (0.73 + 0.27 * smooth(40, 220, y))
                + 0.13 * fbm2(x / 90, z / 90, { seed: seed + 411, octaves: 2 });
            cover[i * 4] = Math.max(0, Math.min(1, snow));
            cover[i * 4 + 1] = Math.max(0, Math.min(1, forestCover(x, y, z, seed)));
            // A snow bowl sees less of the luminous western sky than a cornice. Look toward
            // that sky at three distances in the already-baked grid, once per vertex.
            let shelter = 0;
            for (let stride = 1; stride <= 9; stride *= 3) {
                const west = Math.max(0, column - stride);
                const north = Math.min(rows - 1, row + stride);
                const n = (north * columns + west) * 3;
                const span = Math.hypot(positions[n] - x, positions[n + 2] - z);
                shelter = Math.max(shelter, (positions[n + 1] - y) / Math.max(1, span));
            }
            cover[i * 4 + 2] = 1 - smooth(0.08, 0.9, shelter);
            cover[i * 4 + 3] = horizon[column] - (y - eyeHeight) / Math.max(1, -z);
        }
        if (clock.due()) {
            yield 'range cover';
            clock.restart();
        }
    }
    built.setAttribute('cover', new THREE.BufferAttribute(cover, 4));
    return { geometry: built, ridgeProfile: bakeRidgeProfile(positions, eyeHeight, columns) };
}

/** a + Σ vᵢ·kᵢ over (v, k) pairs, for the spruce builder's small vectors. */
function offset(a, ...terms) {
    const out = [a[0], a[1], a[2]];
    for (let i = 0; i < terms.length; i += 2) {
        out[0] += terms[i][0] * terms[i + 1];
        out[1] += terms[i][1] * terms[i + 1];
        out[2] += terms[i][2] * terms[i + 1];
    }
    return out;
}

/**
 * Turn every triangle so its winding agrees with the normals written at its corners. A
 * double-sided node material flips the normal of a back face, so a triangle wound against
 * its normals would shade as if it faced the other way (a snowy roof lit as an underside).
 */
export function orientTriangles(positions, normals, indices) {
    let flipped = 0;
    for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
        const ux = positions[b] - positions[a];
        const uy = positions[b + 1] - positions[a + 1];
        const uz = positions[b + 2] - positions[a + 2];
        const vx = positions[c] - positions[a];
        const vy = positions[c + 1] - positions[a + 1];
        const vz = positions[c + 2] - positions[a + 2];
        const fx = uy * vz - uz * vy;
        const fy = uz * vx - ux * vz;
        const fz = ux * vy - uy * vx;
        const nx = normals[a] + normals[b] + normals[c];
        const ny = normals[a + 1] + normals[b + 1] + normals[c + 1];
        const nz = normals[a + 2] + normals[b + 2] + normals[c + 2];
        if (fx * nx + fy * ny + fz * nz < 0) {
            const swap = indices[i + 1];
            indices[i + 1] = indices[i + 2];
            indices[i + 2] = swap;
            flipped += 1;
        }
    }
    return flipped;
}

/**
 * One spruce, unit height: a tapering trunk, a dark core, and whorls of drooping branches.
 * Each branch is a narrowing tent — a roof that carries snow over a dark underside — with
 * sub-branch tips hanging from both lower edges, so the silhouette is ragged at every scale
 * and snow lies in strips along the boughs. Normals are written, and every triangle is
 * wound to agree with them. `snow` holds each vertex's snow load (0..1).
 */
export function buildSpruceGeometry(random, {
    whorls = 22, segments = 5, teeth = true, branches = 9, coreSides = 10, coreRings = 6,
} = {}) {
    const positions = [];
    const normals = [];
    const loads = [];
    const indices = [];
    const UP = [0, 1, 0];
    const vertex = (p, n, load) => {
        positions.push(p[0], p[1], p[2]);
        const size = Math.hypot(n[0], n[1], n[2]) || 1;
        normals.push(n[0] / size, n[1] / size, n[2] / size);
        loads.push(load);
        return positions.length / 3 - 1;
    };

    // Trunk: a tapering hexagonal prism up into the leader.
    const trunkSides = 6;
    const trunkBase = positions.length / 3;
    for (let ring = 0; ring < 2; ring += 1) {
        const y = ring === 0 ? -0.02 : 0.93;
        const radius = ring === 0 ? 0.024 : 0.005;
        for (let side = 0; side < trunkSides; side += 1) {
            const a = (side / trunkSides) * Math.PI * 2;
            vertex([Math.cos(a) * radius, y, Math.sin(a) * radius], [Math.cos(a), 0.1, Math.sin(a)], 0);
        }
    }
    for (let side = 0; side < trunkSides; side += 1) {
        const a = trunkBase + side;
        const b = trunkBase + ((side + 1) % trunkSides);
        indices.push(a, b, b + trunkSides, a, b + trunkSides, a + trunkSides);
    }

    // The core: a dark cone inside the boughs, so the crown is a mass and not a lattice.
    const coreBase = positions.length / 3;
    for (let ring = 0; ring <= coreRings; ring += 1) {
        const f = ring / coreRings;
        const y = 0.12 + f * 0.82;
        const radius = (0.25 * (1 - f) ** 0.95 + 0.028) * 0.5 * (1 - f * 0.3);
        for (let side = 0; side < coreSides; side += 1) {
            const a = (side / coreSides) * Math.PI * 2;
            vertex([Math.cos(a) * radius, y, Math.sin(a) * radius], [Math.cos(a), 0.45, Math.sin(a)], 0);
        }
    }
    for (let ring = 0; ring < coreRings; ring += 1) {
        for (let side = 0; side < coreSides; side += 1) {
            const a = coreBase + ring * coreSides + side;
            const b = coreBase + ring * coreSides + ((side + 1) % coreSides);
            indices.push(a, b, b + coreSides, a, b + coreSides, a + coreSides);
        }
    }

    const branch = (origin, angle, reach, droop, load) => {
        const dir = [Math.cos(angle), 0, Math.sin(angle)];
        const side = [-Math.sin(angle), 0, Math.cos(angle)];
        const apex = [];
        const left = [];
        const right = [];
        const underLeft = [];
        const underRight = [];
        const edges = { 1: [], [-1]: [] };
        const widths = [];
        for (let k = 0; k <= segments; k += 1) {
            const s = k / segments;
            // Out from the trunk, sagging under its load, the tip turning up a little.
            const sag = -droop * s ** 1.5 + droop * 0.32 * s ** 4;
            const centre = offset(origin, dir, reach * s, UP, sag);
            const half = reach * (0.32 * (1 - s) ** 0.8 + 0.04);
            const rise = half * 0.7;
            widths.push(half);
            // The roof follows the sag: tilt its normals with the branch's slope.
            const slope = (-1.5 * droop * s ** 0.5 + 1.28 * droop * s ** 3) / reach;
            const roofUp = offset(UP, dir, -slope);
            const l = offset(centre, side, half, UP, -rise * 0.5);
            const r = offset(centre, side, -half, UP, -rise * 0.5);
            const settled = load * (1 - 0.65 * s ** 3);
            apex.push(vertex(offset(centre, UP, rise * 0.5), roofUp, settled));
            left.push(vertex(l, offset([0, 0, 0], roofUp, 0.82, side, 0.58), settled * 0.55));
            right.push(vertex(r, offset([0, 0, 0], roofUp, 0.82, side, -0.58), settled * 0.55));
            underLeft.push(vertex(l, offset([0, 0, 0], UP, -1, side, 0.25), 0));
            underRight.push(vertex(r, offset([0, 0, 0], UP, -1, side, -0.25), 0));
            edges[1].push(l);
            edges[-1].push(r);
        }
        for (let k = 0; k < segments; k += 1) {
            indices.push(apex[k], apex[k + 1], left[k + 1], apex[k], left[k + 1], left[k]);
            indices.push(apex[k], right[k], right[k + 1], apex[k], right[k + 1], apex[k + 1]);
            indices.push(
                underLeft[k],
                underRight[k],
                underRight[k + 1],
                underLeft[k],
                underRight[k + 1],
                underLeft[k + 1],
            );
        }
        // The tip: close the roof onto a point a little beyond the last section.
        const tip = vertex(offset(origin, dir, reach * 1.08, UP, -droop * 0.62), UP, 0);
        indices.push(apex[segments], tip, left[segments], apex[segments], right[segments], tip);
        if (!teeth) return;
        // Sub-branch tips hang from the lower edges, alternating long and short.
        for (let k = 0; k < segments; k += 1) {
            for (const sign of [1, -1]) {
                const a = edges[sign][k];
                const b = edges[sign][k + 1];
                const half = (widths[k] + widths[k + 1]) * 0.5;
                const toothLength = half * (0.45 + random() * 0.65) * (k % 2 === 0 ? 1 : 0.6);
                const middle = offset(a, b, 1);
                middle[0] *= 0.5;
                middle[1] *= 0.5;
                middle[2] *= 0.5;
                const point = offset(middle, side, sign * toothLength * 0.7, UP, -toothLength * 1.15, dir, reach * 0.04);
                const outward = offset([0, 0, 0], side, sign * 0.8, UP, -0.35);
                indices.push(vertex(a, outward, 0), vertex(b, outward, 0), vertex(point, outward, 0));
            }
        }
    };

    for (let w = 0; w < whorls; w += 1) {
        // Whorls crowd toward the top, where a spruce is densest.
        const f = ((w + 0.3 + random() * 0.4) / whorls) ** 0.9;
        const height = 0.07 + f * 0.88;
        const reach = 0.26 * (1 - f) ** 0.95 + 0.026;
        const count = Math.max(5, Math.round(branches - f * 3));
        const twist = random() * Math.PI * 2;
        for (let b = 0; b < count; b += 1) {
            const angle = twist + ((b + (random() - 0.5) * 0.6) / count) * Math.PI * 2;
            const boughLength = reach * (0.72 + random() * 0.5);
            const droop = boughLength * (0.4 + random() * 0.35) * (1 - f * 0.55);
            const load = (0.42 + random() * 0.58) * (1 - f * 0.3);
            branch([0, height, 0], angle, boughLength, droop, load);
        }
    }
    // The leader: a short spike above the last whorl.
    const leaderBase = positions.length / 3;
    for (let side = 0; side < 4; side += 1) {
        const a = (side / 4) * Math.PI * 2;
        vertex([Math.cos(a) * 0.012, 0.92, Math.sin(a) * 0.012], [Math.cos(a), 0.3, Math.sin(a)], 0.3);
    }
    const peak = vertex([0, 1.0, 0], UP, 0.5);
    for (let side = 0; side < 4; side += 1) indices.push(leaderBase + side, leaderBase + ((side + 1) % 4), peak);
    orientTriangles(positions, normals, indices);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('snow', new THREE.BufferAttribute(new Float32Array(loads), 1));
    const index = positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return geometry;
}

/**
 * Where the far forest stands: spruces on the range's low, gentle, forested slopes and a
 * thinner fringe along the whole shore, inside the fan the camera can see. Deterministic
 * for a seed. Returns [x, y, z, height] rows.
 */
export function placeForest(count, random, seed = 0) {
    const trees = [];
    if (!(count > 0)) return trees;
    // Groves, not a plantation: first the places where a stand of spruce grows (forested
    // low slopes, and clumps along the shore), then a dense clump of trees round each one,
    // tallest in its middle, as a stand grows.
    const groves = [];
    const wanted = Math.max(3, Math.round(count / 11));
    let guard = 0;
    while (groves.length < wanted && guard < wanted * 300) {
        guard += 1;
        // Every other stand grows at the waterline: together they draw a dark treeline
        // between the lake and the snowfields, broken where a clump is missing.
        const shore = groves.length % 2 === 0;
        const reach = shore ? 15 + random() * 140 : 20 + random() ** 1.3 * 880;
        const z = SHORE_Z - reach;
        const x = (random() * 2 - 1) * (120 - z * 1.05);
        const y = rangeHeight(x, z, seed);
        const roll = random();
        if (shore ? y < 2 || y > 26 : y < 3 || y > 130) continue;
        if (!shore && roll > forestCover(x, y, z, seed)) continue;
        if (shore && roll > 0.8) continue;
        groves.push({ x, z, radius: shore ? 30 + random() * 45 : 16 + random() * 34 + reach * 0.03 });
    }
    if (groves.length === 0) return trees;
    guard = 0;
    while (trees.length < count && guard < count * 30) {
        guard += 1;
        const grove = groves[trees.length % groves.length];
        // Box–Muller: a round, dense clump that thins at its edge.
        const spread = Math.sqrt(-2 * Math.log(Math.max(1e-6, random())));
        const turn = random() * Math.PI * 2;
        const ring = spread * 0.55;
        const x = grove.x + Math.cos(turn) * ring * grove.radius;
        const z = grove.z + Math.sin(turn) * ring * grove.radius;
        if (z > SHORE_Z - 6) continue;
        const y = rangeHeight(x, z, seed);
        if (y < 1.5 || y > 160) continue;
        const slope = Math.hypot(rangeHeight(x + 6, z, seed) - y, rangeHeight(x, z - 6, seed) - y) / 6;
        if (slope > 0.8) continue;
        const tall = Math.exp(-ring * ring * 0.9);
        trees.push([x, y - 1.2, z, 10 + tall * 10 + random() * 8]);
    }
    return trees;
}

/** One adult spruce and two younger neighbours, small enough across the lake to share a
 * continuous crown mesh. Sparse skirt edges shape the silhouette; upper rows catch snow. */
function farGroveGeometry() {
    const positions = [];
    const loads = [];
    const indices = [];
    const grow = (x, z, height, girth, tiers, sides, phase) => {
        const base = positions.length / 3;
        const ringCount = tiers * 2 + 1;
        for (let ring = 0; ring < ringCount; ring += 1) {
            const edge = ring % 2 === 0;
            const level = ring / (ringCount - 1);
            for (let side = 0; side < sides; side += 1) {
                const a = (side / sides) * Math.PI * 2 + phase + Math.floor(ring / 2) * 0.24;
                const lobe = Math.sin(a * 3.4 + ring * 1.18);
                const radius = girth * (1 - level) ** 0.84 * (edge ? 0.94 + 0.21 * lobe : 0.49);
                const y = 0.07 + level * 0.93 + (edge ? lobe * 0.04 * (1 - level) : 0);
                positions.push(
                    x + Math.cos(a) * radius + level * level * girth * 0.13,
                    y * height,
                    z + Math.sin(a) * radius,
                );
                loads.push(edge ? 0.15 + 0.1 * lobe : 0.87);
                if (ring === 0) continue;
                const here = base + ring * sides + side;
                const next = base + ring * sides + ((side + 1) % sides);
                indices.push(here - sides, here, next - sides);
                if (ring < ringCount - 1) indices.push(next - sides, here, next);
            }
        }
    };
    grow(0, 0, 1, 0.19, 6, 7, 0.8);
    grow(-0.22, 0.18, 0.64, 0.15, 4, 5, 1.6);
    grow(0.36, -0.12, 0.48, 0.085, 3, 5, 2.1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('snow', new THREE.Float32BufferAttribute(loads, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

export class AuroraLandscape {
    /**
     * @param {object} options
     * @param {THREE.Object3D} options.parent
     * @param {object} options.preset quality preset
     * @param {import('./aurora-curtains.js').AuroraCurtains} options.curtains
     * @param {import('./aurora-atmosphere.js').AuroraAtmosphere} options.atmosphere
     * @param {THREE.Texture} options.noiseTexture shared noise tile (not owned)
     * @param {object} options.uniforms shared world uniforms (time, activity, auroraLight, and the
     *   hour of the night: skylight, moonLight, skyZenith, skyHorizon, airglow)
     * @param {Function} options.random seeded generator
     * @param {number} options.seed
     * @param {number} options.eyeHeight camera height above the lake
     * @param {boolean} [options.build=true] false: the owner builds it, by buildSteps(options)
     */
    constructor({
        parent, preset, curtains, atmosphere, noiseTexture, uniforms, random, seed = 0, eyeHeight = 8, build = true,
    }) {
        this.parent = parent;
        this.preset = preset;
        this.uniforms = uniforms;
        this.atmosphere = atmosphere;
        this.noiseTexture = noiseTexture;
        this.seed = seed;
        this.eyeHeight = eyeHeight;
        this.disposed = false;
        this.group = new THREE.Group();
        this.group.name = 'Aurora — landscape';
        parent.add(this.group);
        this.geometries = new Set();
        this.materials = new Set();
        this.textures = new Set();
        this.reflection = null;
        this.bankInverseWidth = uniform(1);
        this.forest = null;
        this.forestCount = 0;

        const slots = Math.max(1, preset.rippleSlots);
        this.rippleSlots = slots;
        this.rippleCount = uniform(0, 'int');
        this.rippleUntil = uniform(-1);
        // x, z, birth time, strength — and tint with the ring's travel speed in w.
        this.rippleData = Array.from({ length: slots }, () => new THREE.Vector4(0, 0, -1000, 0));
        this.rippleTint = Array.from({ length: slots }, () => new THREE.Vector4(0.3, 1, 0.6, 26));

        if (build) drainSteps(this.buildSteps({ random, curtains, noiseTexture }));
    }

    /**
     * The landscape's parts as steps (the world's build breathes between them:
     * shared/build-steps.js), the same work in the same order, from the constructor's `random`,
     * `curtains` and `noiseTexture`. Built in one task, they were 27 ms of a first visit's switch
     * frame (the range 16 of them, 2026-10-31).
     */
    * buildSteps({ random, curtains, noiseTexture }) {
        yield* this.createRangeSteps();
        yield 'range';
        this.createBanks();
        this.createSpruces(random);
        yield 'banks and spruces';
        this.createForest(random);
        this.createLake(curtains, noiseTexture);
    }

    /**
     * Night light on snow, rock and needles. Skylight is a cold blue from everywhere; the
     * aurora arrives from above, a little bleached, so snow facing the sky glows mint and
     * every slope facing away falls into blue shadow. `aurora` is the radiance of the display
     * standing over the surface: it gives facing snow the curtain's own colour and lights
     * rims that stand against it. `backlit` (0..1) says how much of the surface can glow so.
     * The hour of the night (aurora-hours.js) sets the skylight, and a risen moon over the
     * range silvers whatever faces it: tops and ridges, the slopes turned to the eye left in
     * blue shadow (no shadow map: the moonlight is soft, the land lit only where it faces).
     */
    litSurface(albedo, normal, { aurora = null, backlit = 1 } = {}) {
        const u = this.uniforms;
        const bleached = mix(u.auroraLight, vec3(dot(u.auroraLight, vec3(0.25, 0.6, 0.15))), 0.38);
        const overhead = max(dot(normal, vec3(0.12, 0.86, -0.3)), 0);
        const fill = max(dot(normal, vec3(0, 0.45, 0.9)), 0);
        const facing = abs(dot(normal, normalize(cameraPosition.sub(positionWorld))));
        const rim = pow3(float(1).sub(facing)).mul(max(normal.y, 0))
            .toVar();
        const moon = max(dot(normal, u.moonDirection), 0);
        const light = u.skylight.mul(normal.y.mul(0.55).add(0.45))
            .add(bleached.mul(overhead.mul(1.15).add(fill.mul(0.16)).add(rim.mul(0.5)).add(0.03)))
            .add(u.moonLight.mul(moon))
            .toVar();
        if (aurora) {
            // The display itself: a soft wash on whatever faces the sky, and a bright rim
            // where a snow edge stands against the curtains behind it.
            light.addAssign(aurora.mul(overhead.mul(0.07).add(rim.mul(backlit).mul(0.32))));
        }
        return albedo.mul(light);
    }

    createRange() {
        drainSteps(this.createRangeSteps());
    }

    * createRangeSteps() {
        const { terrainColumns: columns, terrainRows: rows } = this.preset;
        const {
            seed, atmosphere, noiseTexture, eyeHeight,
        } = this;
        // The range's mesh (its points, normals, cover and the skyline profile) is kept for the
        // session (shared/session-geometry.js), over the grid's points (aurora-bakes.js: a first
        // visit bakes them in a worker): ~28 ms of main thread on every Aurora start before. A
        // session's first build makes it in steps and takes that mesh itself, as sessionGeometry
        // hands it out; a later one gets a new geometry over the kept arrays.
        const key = `aurora:range:${columns}x${rows}:${seed}:${eyeHeight}`;
        let made = null;
        yield* prepareSessionGeometry(null, key, function* rangeSteps() {
            made = yield* rangeMeshSteps(columns, rows, seed, eyeHeight);
            return made;
        });
        const { geometry, ridgeProfile } = made
            ?? sessionGeometry(null, key, () => drainSteps(rangeMeshSteps(columns, rows, seed, eyeHeight)));
        this.ridgeProfile = ridgeProfile;

        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'Aurora — snow range';
        material.colorNode = Fn(() => {
            const normal = normalize(normalWorld).toVar();
            const mask = attribute('cover', 'vec4').toVar();
            const p = positionWorld.xz.toVar();
            // Three world-space reads of the shared tile: snowfields, gullies and grain.
            const broad = texture(noiseTexture, p.div(2300)).toVar();
            const mid = texture(noiseTexture, p.div(760).add(vec2(0.31, 0.17))).toVar();
            const fine = texture(noiseTexture, p.div(190).add(vec2(0.53, 0.29))).toVar();
            const steep = smoothstep(0.16, 0.5, normal.y.oneMinus()).toVar();
            // Descending couloirs, sampled in a common oblique rock plane. Using the same
            // coordinates on neighbouring triangles keeps the chute together across a ridge.
            const across = p.x.add(p.y.mul(0.26)).add(positionWorld.y.mul(0.37)).add(broad.a.mul(39));
            const gully = texture(noiseTexture, vec2(across.div(550), positionWorld.y.add(p.y.mul(0.15)).div(2300)));
            const streaks = smoothstep(0.36, 0.69, gully.r.mul(0.72).add(fine.g.mul(0.28)));
            // Rock ribs: thin crests of the mid noise, bared on steep faces only; snow fills
            // the gullies between them, which is what makes a face read as a mountain.
            const rib = pow(float(1).sub(abs(mid.r.mul(2).sub(1))), 5);
            const field = mask.x
                .add(broad.b.sub(0.5).mul(0.3))
                .add(mid.b.sub(0.5).mul(0.42))
                .add(fine.g.sub(0.5).mul(0.24))
                .add(streaks.mul(steep).mul(0.7))
                .sub(rib.mul(steep).mul(0.5));
            const snow = smoothstep(0.35, 0.64, field).toVar();
            // Strata in the bare rock, warped so they never rule a straight line.
            const strata = sin(positionWorld.y.mul(0.13).add(mid.a.mul(9)).add(broad.a.mul(4))).mul(0.5).add(0.5);
            const rock = triple(AURORA_COLORS.rock).mul(mix(0.45, 1.4, strata.mul(fine.r.mul(0.6).add(0.4))));
            // Wind has worked the open snow into drifts: broad mottling, never flat white.
            const drifts = mix(0.72, 1.04, smoothstep(0.2, 0.8, mid.g.mul(0.6).add(broad.a.mul(0.4))));
            const snowAlbedo = triple(AURORA_COLORS.snow).mul(mix(0.82, 1.0, fine.r)).mul(drifts);
            const forest = vec3(0.013, 0.029, 0.037);
            const albedo = mix(mix(rock, snowAlbedo, snow), forest, mask.y.mul(0.82));
            const aurora = atmosphere.auroraAbove(positionWorld).toVar();
            const west = smoothstep(-0.24, 0.84, dot(normal, vec3(-0.72, 0.53, 0.44))).mul(mask.z);
            const striations = mix(0.64, 1.16, gully.r);
            const crest = smoothstep(0.0008, 0.014, mask.w.add(mid.a.sub(0.5).mul(0.005))).oneMinus()
                .mul(snow).mul(west.mul(0.76).add(0.24))
                .mul(mask.y.oneMinus());
            const crestLight = vec3(0.082, 0.12, 0.145).add(aurora.mul(0.31)).add(this.uniforms.moonLight.mul(0.8));
            const lit = this.litSurface(albedo, normal, { aurora, backlit: snow }).mul(0.76)
                .add(albedo.mul(vec3(0.017, 0.031, 0.077)))
                .add(albedo.mul(vec3(0.114, 0.168, 0.22)).mul(west).mul(striations))
                .add(crestLight.mul(crest));
            return atmosphere.apply(lit, positionWorld, { aurora });
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Aurora — snow range';
        mesh.matrixAutoUpdate = false;
        this.range = mesh;
        this.geometries.add(geometry);
        this.materials.add(material);
        this.group.add(mesh);
    }

    createBanks() {
        const {
            seed, atmosphere, eyeHeight, noiseTexture,
        } = this;
        const u = this.uniforms;
        const geometry = buildGrid(84, 40, (gu, gv) => {
            const x = (gu * 2 - 1) * 190;
            const z = 18 - 200 * gv;
            return [x, bankHeight(x, z, seed), z];
        });
        const glints = this.preset.sparkCount > 0;
        // Glint cells per radian seen from the resting eye: a few pixels a cell at 1080p.
        const density = 120 + Math.min(260, this.preset.sparkCount);
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'Aurora — snow banks';
        this.coniferShade = createConiferShade();
        this.textures.add(this.coniferShade);
        material.colorNode = Fn(() => {
            const normal = normalize(normalWorld).toVar();
            // Wind-raked ledges: broad drifts break into swept lines in the same direction.
            const grain = texture(noiseTexture, positionWorld.xz.div(68)).toVar();
            const wind = vec2(positionWorld.x.add(positionWorld.z.mul(0.43)), positionWorld.z);
            const comb = texture(noiseTexture, wind.div(vec2(58, 166)).add(grain.ab.mul(0.11))).toVar();
            const grains = texture(noiseTexture, positionWorld.xz.div(14)).r;
            const grainMix = mix(grain.g, comb.r, grain.b.mul(0.65)).add(grains.sub(0.5).mul(0.17));
            const ridge = smoothstep(0.32, 0.76, grainMix);
            const drift = mix(0.81, 1.02, ridge);
            const aurora = atmosphere.auroraAbove(positionWorld).toVar();
            const lit = this.litSurface(triple(AURORA_COLORS.snow).mul(drift).mul(0.82), normal, { aurora })
                .add(vec3(0.006, 0.013, 0.029).mul(ridge).mul(normal.y.max(0)))
                .toVar();
            if (glints) {
                // Frost glints: a crystal here and there turns a face to the sky for a moment.
                // The grid lives in the angles the RESTING eye sees, so a cell is a few
                // pixels at any range and stays put while the camera breathes.
                const point = positionWorld;
                const flat = max(length(point.xz), 0.5);
                const grid = vec2(point.x.div(max(point.z.negate(), 0.5)), float(eyeHeight).div(flat)).mul(density);
                const cell = floor(grid);
                const h = hash23(cell).toVar();
                const offCentre = length(fract(grid).sub(0.5).sub(h.xy.sub(0.5).mul(0.55)));
                const spot = float(1).sub(smoothstep(0.06, 0.3, offCentre));
                const beat = fract(h.z.mul(17).add(u.time.mul(h.x.mul(0.6).add(0.22))));
                const flare = smoothstep(0, 0.08, beat).mul(float(1).sub(smoothstep(0.1, 0.26, beat)));
                const chosen = step(h.y, 0.045);
                const sparkle = spot.mul(flare).mul(chosen).mul(smoothstep(0.35, 0.8, normal.y));
                const tint = mix(vec3(0.75, 0.9, 1.0), u.auroraLight.mul(7).add(aurora.mul(0.6)), 0.45);
                lit.addAssign(tint.mul(sparkle).mul(0.5));
            }
            const shadeUv = positionGeometry.xz.add(vec2(190, 182)).div(vec2(380, 200));
            const shade = texture(this.coniferShade, shadeUv).r;
            return atmosphere.apply(lit.mul(shade.mul(-0.72).add(1)), positionWorld, { aurora });
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Aurora — snow banks';
        mesh.matrixAutoUpdate = false;
        this.banks = mesh;
        this.geometries.add(geometry);
        this.materials.add(material);
        this.group.add(mesh);
    }

    /** Needles near-black, snow in strips along the boughs, rims lit by the display behind. */
    spruceMaterial(name) {
        const { atmosphere, noiseTexture } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = name;
        material.colorNode = Fn(() => {
            const normal = normalize(normalWorld).toVar();
            const load = attribute('snow', 'float');
            const clumps = texture(noiseTexture, positionGeometry.xz.mul(1.9).add(positionGeometry.y.mul(0.7))).r;
            const snowed = smoothstep(0.32, 0.62, load.mul(normal.y.mul(0.6).add(0.55)).add(clumps.sub(0.5).mul(0.5)))
                .toVar();
            const albedo = mix(vec3(0.0055, 0.0105, 0.0095), triple(AURORA_COLORS.snow).mul(0.72), snowed);
            const aurora = atmosphere.auroraAbove(positionWorld).toVar();
            const lit = this.litSurface(albedo, normal, { aurora, backlit: snowed.mul(0.8).add(0.2) });
            return atmosphere.apply(lit, positionWorld, { aurora });
        })();
        return material;
    }

    createSpruces(random) {
        const conifers = createAuroraConifers(this, random);
        if (conifers) {
            this.spruces = conifers;
            return;
        }
        const count = Math.max(2, this.preset.treeCount);
        const geometry = buildSpruceGeometry(random);
        const material = this.spruceMaterial('Aurora — spruces');
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.name = 'Aurora — spruces';
        const dummy = new THREE.Object3D();
        for (let i = 0; i < count; i += 1) {
            // Alternate banks. Trees stand along the frame's edges, the nearest ones tallest,
            // so they close the corners without ever crossing behind the board.
            const side = i % 2 === 0 ? -1 : 1;
            const rank = Math.floor(i / 2) / Math.max(1, Math.ceil(count / 2) - 1);
            const reach = 38 + rank * 100 + random() * 12;
            const azimuth = side * (35 + random() * 12 - rank * 5) * DEG;
            const x = Math.sin(azimuth) * reach;
            const z = -Math.cos(azimuth) * reach;
            const height = 22 - rank * 8 + random() * 6;
            dummy.position.set(x, Math.max(0, bankHeight(x, z, this.seed)) - 0.5, z);
            dummy.rotation.set((random() - 0.5) * 0.06, random() * Math.PI * 2, (random() - 0.5) * 0.06);
            dummy.scale.set(height * (0.9 + random() * 0.35), height, height * (0.9 + random() * 0.35));
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        this.spruces = mesh;
        this.geometries.add(geometry);
        this.materials.add(material);
        this.group.add(mesh);
    }

    /** The far forest: small spruces along the shore and up the range's low slopes. */
    createForest(random) {
        const trees = placeForest(Math.max(0, this.preset.forestCount ?? 0), random, this.seed);
        this.forestCount = trees.length;
        if (trees.length === 0) return;
        const geometry = farGroveGeometry();
        const material = this.spruceMaterial('Aurora — far forest');
        const mesh = new THREE.InstancedMesh(geometry, material, trees.length);
        mesh.name = 'Aurora — far forest';
        const dummy = new THREE.Object3D();
        trees.forEach(([x, y, z, height], i) => {
            dummy.position.set(x, y, z);
            dummy.rotation.set(0, random() * Math.PI * 2, 0);
            const girth = height * (0.85 + random() * 0.4);
            dummy.scale.set(girth, height, girth);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        this.forest = mesh;
        this.geometries.add(geometry);
        this.materials.add(material);
        this.group.add(mesh);
    }

    createLake(curtains, noiseTexture) {
        const u = this.uniforms;
        const { atmosphere } = this;
        const geometry = new THREE.PlaneGeometry(LAKE_HALF_WIDTH * 2, 900, 1, 1);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, 0, SHORE_Z * 0.5 - 30);
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'Aurora — mirror lake';
        const ripples = uniformArray(this.rippleData, 'vec4');
        const tints = uniformArray(this.rippleTint, 'vec4');
        if (this.preset.mirrorScale > 0) {
            this.reflection = reflector({ resolutionScale: this.preset.mirrorScale, bounces: false, samples: 0 });
            this.reflection.target.rotation.x = -Math.PI / 2;
            this.reflection.target.position.y = 0;
            this.group.add(this.reflection.target);
        } else {
            this.profileTexture = new THREE.DataTexture(
                this.ridgeProfile,
                PROFILE_BINS,
                1,
                THREE.RGBAFormat,
                THREE.UnsignedByteType,
            );
            this.profileTexture.name = 'Aurora — skyline profile';
            this.profileTexture.magFilter = THREE.LinearFilter;
            this.profileTexture.minFilter = THREE.LinearFilter;
            this.profileTexture.colorSpace = THREE.NoColorSpace;
            this.profileTexture.needsUpdate = true;
            this.textures.add(this.profileTexture);
        }
        this.iceTexture = new THREE.DataTexture(
            sessionShoreIce(this.seed),
            SHORE_ICE.width,
            SHORE_ICE.height,
            THREE.RGBAFormat,
            THREE.UnsignedByteType,
        );
        this.iceTexture.name = 'Aurora — shore ice';
        this.iceTexture.magFilter = THREE.LinearFilter;
        this.iceTexture.minFilter = THREE.LinearMipmapLinearFilter;
        this.iceTexture.generateMipmaps = true;
        this.iceTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.iceTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.iceTexture.colorSpace = THREE.NoColorSpace;
        this.iceTexture.needsUpdate = true;
        this.textures.add(this.iceTexture);
        const { reflection, profileTexture, iceTexture } = this;

        material.colorNode = Fn(() => {
            const point = positionWorld.xz.toVar();
            const toEye = cameraPosition.sub(positionWorld).toVar();
            const view = normalize(toEye).toVar();

            // Shore ice along the banks: it stills the water under it.
            const iceRead = texture(iceTexture, vec2(
                point.x.mul(this.bankInverseWidth).add(SHORE_ICE.half).div(SHORE_ICE.half * 2),
                point.y.sub(SHORE_ICE.near).div(SHORE_ICE.far - SHORE_ICE.near),
            )).toVar();
            const ice = smoothstep(0.42, 0.58, iceRead.r).toVar();
            const open = ice.oneMinus().toVar();

            // Clear black ice carries the reflection in one piece. Only narrow leads still move
            // with the wind; stationary grain is visible beneath the surrounding sheet.
            const frozen = texture(noiseTexture, point.mul(vec2(0.0021, 0.00094))).toVar();
            const ruffle = smoothstep(0.57, 0.79, frozen.b).toVar();
            const fine = texture(noiseTexture, point.mul(0.021).add(vec2(0.13, 0.37))).toVar();
            const chop = texture(noiseTexture, point.mul(0.0058)
                .add(vec2(u.time.mul(-0.002), u.time.mul(0.0032)))).toVar();
            const slope = fine.rg.sub(0.5).mul(0.022).add(chop.rg.sub(0.5).mul(ruffle).mul(0.62)).toVar();
            const glint = vec3(0).toVar();
            const rings = select(u.time.lessThan(this.rippleUntil), this.rippleCount, int(0));
            Loop(rings, ({ i }) => {
                // A ring: a short wave packet riding an expanding front, fading as it goes.
                const ring = ripples.element(i).toVar();
                const tint = tints.element(i).toVar();
                const offsetFromRing = point.sub(ring.xy).toVar();
                const radius = max(length(offsetFromRing), 0.001).toVar();
                const age = u.time.sub(ring.z).toVar();
                const front = radius.sub(age.mul(tint.w)).toVar();
                If(abs(front).lessThan(30), () => {
                    const packet = exp(front.mul(front).mul(-0.012))
                        .mul(ring.w).mul(exp(age.mul(-RIPPLE_FADE))).mul(smoothstep(0, 0.12, age))
                        .toVar();
                    slope.addAssign(offsetFromRing.div(radius).mul(sin(front.mul(0.52)).mul(packet).mul(0.8)));
                    const crest = max(sin(front.mul(0.52).add(1.1)), 0);
                    const crest2 = crest.mul(crest);
                    glint.addAssign(tint.rgb.mul(packet.mul(crest2.mul(crest2).mul(crest2)).mul(1.2)));
                });
            });
            slope.mulAssign(open);

            // A tilted facet throws the mirrored ray mostly up or down, hardly sideways:
            // that is what draws every reflection into a vertical streak.
            const grazing = clamp(view.y, 0.02, 1);
            let mirror;
            if (reflection) {
                const coord = screenUV.flipX().add(clamp(vec2(slope.x.mul(0.033), slope.y.mul(0.13)), -0.06, 0.06));
                const smear = vec2(0, ruffle.mul(0.008).add(0.0008).add(ice.mul(0.013)));
                mirror = reflection.sample(coord).rgb.mul(0.5)
                    .add(reflection.sample(coord.add(smear)).rgb.mul(0.25))
                    .add(reflection.sample(coord.sub(smear)).rgb.mul(0.25));
            } else {
                const bounced = normalize(vec3(
                    view.x.negate().add(clamp(slope.x.mul(0.045), -0.018, 0.018)),
                    abs(view.y).add(clamp(slope.y.mul(0.16), -0.035, 0.035)).max(0.004),
                    view.z.negate(),
                )).toVar();
                const up = clamp(bounced.y, 0, 1);
                const sheet = curtains.sampleSky(bounced).toVar();
                const baseSky = mix(u.skyZenith, u.skyHorizon, exp(up.mul(-5.2)))
                    .add(u.airglow.mul(exp(up.mul(-13))))
                    .mul(u.activity.mul(0.35).add(1))
                    .add(moonRadiance(u, bounced, noiseTexture))
                    .add(sheet.rgb);
                const sky = cloudedSky(baseSky, sheet, u);
                const azimuth = atan(bounced.x, bounced.z.negate()).div(Math.PI).add(0.5);
                const profile = texture(profileTexture, vec2(azimuth, 0.5)).level(0).rg.toVar();
                const skyline = sin(profile.x.mul(PROFILE_MAX_ELEVATION)).toVar();
                const depth = skyline.sub(bounced.y).toVar();
                const width = ruffle.mul(0.014).add(0.009);
                const land = smoothstep(width.negate(), width, depth);
                // A dim lit face beneath its crest blends into the mist at the waterline.
                // A single dark cutout made the tilted mirror look like two flat colours.
                const face = profile.y.mul(0.57).add(0.43)
                    .mul(smoothstep(0.005, 0.065, depth).mul(-0.78).add(1));
                const rock = u.skyHorizon.mul(0.53).add(u.auroraLight.mul(0.046));
                const snow = u.skylight.mul(0.48).add(u.moonLight.mul(0.21)).add(vec3(0.008, 0.016, 0.031));
                mirror = mix(sky, rock.add(snow.mul(face)), land);
            }
            mirror = mirror.toVar();

            // Ruffled water mirrors higher sky. A flat lake seen from the shore shows only the
            // lowest few degrees over the far range, so the curtains standing high over it never
            // reached the water. Every wavelet facet tilted toward the eye throws a higher piece
            // of sky down instead: the display lies on the lake as long columns of its own
            // colour, wide where the wind ruffles it and thin in the glassy lanes, and flecked by
            // the wavelets. The taps climb the sky along the mirrored ray's own bearing.
            const heading = normalize(vec2(view.x.negate(), view.z.negate()).add(vec2(1e-5, 0))).toVar();
            const mirrorSlope = grazing.div(max(length(view.xz), 0.05)).toVar();
            const flecks = mix(0.78, 1.18, smoothstep(0.3, 0.74, fine.b.mul(0.6).add(chop.b.mul(0.4)))).toVar();
            const columns = vec3(0).toVar();
            LAKE_STREAKS.slice(0, this.preset.lakeStreaks ?? 2).forEach(([lift, weight, glassy], k) => {
                // The wavelets under each pixel are tilted a little differently: the lift wanders.
                const facet = k % 2 === 0 ? fine.a : mix(frozen.a, chop.a, ruffle);
                const tilt = float(Math.tan(lift * DEG)).mul(mix(0.72, 1.3, facet));
                const raised = mirrorSlope.add(tilt).div(max(mirrorSlope.mul(tilt).oneMinus(), 0.2));
                const skyward = normalize(vec3(heading.x, raised, heading.y));
                columns.addAssign(curtains.sample(skyward).mul(mix(glassy + 0.12, 0.92, ruffle).mul(weight)));
            });
            columns.mulAssign(flecks.mul(open));
            // The same facets throw the moon down the water: its path toward the eye, as glitter.
            // A point of the lake glints by the CHANCE that a facet there is turned to the moon,
            // in cells laid out in the angles the resting eye sees (a glint is a few pixels at any
            // range, round, and stays put while the camera breathes), each on its own beat.
            const odds = moonPath(u, heading, mirrorSlope, ruffle).toVar();
            const range = max(length(point), 0.5);
            const grid = vec2(point.x.div(max(point.y.negate(), 0.5)), float(this.eyeHeight).div(range))
                .mul(MOON_GLITTER).toVar();
            const dice = hash23(floor(grid)).toVar();
            const offCentre = length(fract(grid).sub(0.5).sub(dice.xy.sub(0.5).mul(0.5)));
            const spot = float(1).sub(smoothstep(0.08, 0.4, offCentre));
            const beat = max(sin(u.time.mul(dice.x.mul(2.4).add(1.3)).add(dice.z.mul(40))), 0);
            const lit = step(odds.mul(0.6).oneMinus(), dice.y);
            columns.addAssign(vec3(1.0, 0.96, 0.88)
                .mul(spot.mul(beat.mul(beat)).mul(lit).mul(1.5).add(odds.mul(0.035))
                    .mul(open)));

            const fresnel = float(1).sub(grazing).pow(5).mul(0.96)
                .add(0.04)
                .toVar();
            const aurora = atmosphere.auroraAbove(positionWorld).toVar();
            const body = triple(AURORA_COLORS.water).add(u.auroraLight.mul(0.012));
            const water = mix(body, mirror, fresnel).add(columns)
                .add(glint.mul(0.5).mul(fresnel).mul(open)).toVar();

            // Snow settles into combs across the rougher plates. The two edges of a pressure
            // crack sit at different depths: a dark top lip and a pale wall seen through ice.
            const reach = max(point.y.negate(), 1);
            const fracture = texture(iceTexture, vec2(
                point.x.div(reach.mul(SHORE_ICE.tangentWidth)).add(0.5),
                float(1).div(reach.mul(SHORE_ICE.maxInverseDepth)),
            )).ba.toVar();
            const frost = smoothstep(0.35, 0.85, iceRead.g).toVar();
            const mottled = frost.mul(frozen.b.mul(0.36).add(0.73)).add(fine.g.sub(0.5).mul(0.09));
            const iceAlbedo = mix(vec3(0.14, 0.24, 0.35), triple(AURORA_COLORS.snow).mul(0.78), mottled);
            const iceLit = this.litSurface(iceAlbedo, vec3(0, 1, 0), { aurora, backlit: 0 }).toVar();
            const iceColor = iceLit.add(mirror.mul(fresnel.mul(0.35).add(0.03)).mul(frost.oneMinus()));
            // A thin bright lip where the ice ends at open water.
            const lip = smoothstep(0.3, 0.46, iceRead.r).mul(float(1).sub(smoothstep(0.5, 0.62, iceRead.r)));
            water.assign(mix(water, iceColor, ice).add(iceLit.mul(lip).mul(0.8)));
            const dust = smoothstep(0.48, 0.76, frozen.a.add(fine.r.sub(0.5).mul(0.31))).mul(fine.b.mul(0.6).add(0.45));
            water.addAssign(vec3(0.022, 0.039, 0.061).mul(dust).mul(open).mul(ruffle.oneMinus()));
            const clearIce = ice.mul(frost).mul(0.85).oneMinus();
            const seamLight = vec3(0.031, 0.062, 0.094).add(u.auroraLight.mul(0.29))
                .add(aurora.mul(0.08)).add(glint.mul(0.5));
            water.mulAssign(float(1).sub(fracture.x.mul(clearIce).mul(0.38)));
            water.addAssign(seamLight.mul(fracture.y).mul(clearIce));
            return atmosphere.apply(water, positionWorld, { aurora });
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Aurora — mirror lake';
        mesh.matrixAutoUpdate = false;
        this.lake = mesh;
        this.geometries.add(geometry);
        this.materials.add(material);
        this.group.add(mesh);
    }

    setAspect(aspect) {
        const width = this.spruces?.setAspect?.(aspect) ?? 1;
        if (!this.banks) return;
        this.banks.scale.x = width;
        this.banks.updateMatrix();
        this.bankInverseWidth.value = 1 / width;
    }

    /**
     * Start a ring on the lake at world (x, z). `tint` is a linear RGB triple.
     * Takes the ring with the least left to give (strength × its fade, as the shader fades
     * it), so in rapid play rings pile into the mirror instead of a strong one being cut
     * mid-spread by the next lock. Allocates nothing.
     */
    ripple(time, x, z, strength, tint, speed = 26) {
        if (this.disposed || !(strength > 0)) return false;
        let slot = 0;
        let weakest = Infinity;
        for (let i = 0; i < this.rippleSlots; i += 1) {
            const ring = this.rippleData[i];
            const left = ring.w * Math.exp(-Math.max(0, time - ring.z) * RIPPLE_FADE);
            if (left < weakest) {
                weakest = left;
                slot = i;
            }
        }
        this.rippleData[slot].set(x, z, time, Math.min(1.5, strength));
        this.rippleTint[slot].set(tint[0], tint[1], tint[2], speed);
        this.rippleCount.value = Math.max(this.rippleCount.value, slot + 1);
        this.rippleUntil.value = time + 15;
        return true;
    }

    resetRipples() {
        for (const ring of this.rippleData) ring.set(0, 0, -1000, 0);
        this.rippleCount.value = 0;
        this.rippleUntil.value = -1;
    }

    getDiagnostics() {
        return {
            terrain: [this.preset.terrainColumns, this.preset.terrainRows],
            spruces: this.spruces.count,
            forest: this.forestCount,
            rippleSlots: this.rippleSlots,
            mirror: this.reflection ? this.preset.mirrorScale : 'analytic',
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.group.removeFromParent();
        this.reflection?.target.removeFromParent();
        this.reflection?.dispose();
        this.reflection = null;
        // A landscape stopped part-way through its steps has only some of its parts.
        this.spruces?.dispose();
        this.forest?.dispose();
        for (const geometry of this.geometries) geometry.dispose();
        for (const material of this.materials) material.dispose();
        for (const map of this.textures) map.dispose();
        this.geometries.clear();
        this.materials.clear();
        this.textures.clear();
        this.group.clear();
    }
}
