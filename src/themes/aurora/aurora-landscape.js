/**
 * The ground the aurora stands over: a range of snow peaks baked from ridged noise, a
 * lake that mirrors the whole sky, two snow banks with spruces framing the near corners,
 * and a far forest along the foot of the range.
 *
 * The lake is the second hero. On the upper tiers it is a true planar mirror (the scene
 * rendered once more from below the water); on the cheapest tiers it mirrors analytically:
 * the sky gradient, the curtain buffer read along the reflected ray, and the skyline from a
 * baked ridge profile. Both paths bend the mirror with the same ripples, so gameplay rings
 * travel through the reflected curtains on every tier. Shore ice rims the snow banks.
 *
 * Every surface takes its light from the display itself: snow facing the sky glows with
 * the colour of the curtain standing above it (a magenta pulse turns the snow under it
 * magenta), and every surface is fogged by the same air (aurora-atmosphere.js).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, atan, attribute, cameraPosition, clamp, dot, exp, float, floor, fract, length, max, mix,
    normalWorld, normalize, positionGeometry, positionWorld, pow, reflector, screenUV, sin, smoothstep, step,
    texture, uniformArray, vec2, vec3,
} from 'three/tsl';
import { fbm2, ridged2 } from './aurora-noise.js';
import { AURORA_COLORS } from './aurora-palette.js';

/** Far shore: where the lake meets the foot of the range. */
export const SHORE_Z = -640;
const RANGE_DEPTH = 2700;
/** The range grid fans out from the eye: half-width per unit of distance. */
const RANGE_FAN = 1.3;
/** Height of the tallest summits above the lake. */
const RANGE_PEAK = 700;
const LAKE_HALF_WIDTH = 5200;
const PROFILE_BINS = 512;
const PROFILE_MAX_ELEVATION = 0.4;
const DEG = Math.PI / 180;
/** The shore-ice mask covers the near water: x within ±half, z from `near` out to `far`. */
export const SHORE_ICE = Object.freeze({
    half: 200, near: 20, far: -220, width: 256, height: 160,
});

/**
 * Where the range stands tall. Two hero massifs frame the board; the saddle between them
 * stays low behind it, with a farther chain closing the horizon.
 */
const MASSIFS = [
    {
        x: -900, z: -1650, weight: 1.0, spreadX: 430, spreadZ: 380,
    },
    {
        x: -2050, z: -1500, weight: 0.8, spreadX: 600, spreadZ: 420,
    },
    {
        x: -430, z: -1150, weight: 0.3, spreadX: 260, spreadZ: 200,
    },
    {
        x: -150, z: -2600, weight: 0.62, spreadX: 520, spreadZ: 380,
    },
    {
        x: 420, z: -2800, weight: 0.55, spreadX: 520, spreadZ: 380,
    },
    {
        x: 1080, z: -1800, weight: 1.05, spreadX: 430, spreadZ: 380,
    },
    {
        x: 2250, z: -1560, weight: 0.82, spreadX: 620, spreadZ: 420,
    },
    {
        x: 620, z: -1180, weight: 0.28, spreadX: 250, spreadZ: 190,
    },
];

const triple = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);
const smooth = (edge0, edge1, value) => {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

/** vec2 → vec3 in [0, 1): hash without sine, so a cell keeps its value on every GPU. */
const hash23 = /* @__PURE__ */ Fn(([cell]) => {
    const p3 = fract(vec3(cell.x, cell.y, cell.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yzz).mul(p3.zyx));
}).setLayout({ name: 'aurora_hash23', type: 'vec3', inputs: [{ name: 'cell', type: 'vec2' }] });

/** Height of the range above the lake at a world position. Negative = under water. */
export function rangeHeight(x, z, seed = 0) {
    const inland = SHORE_Z - z;
    if (inland <= 0) return -8;
    const warpX = x + 230 * (fbm2(x / 870, z / 870, { seed: seed + 5, octaves: 3 }) - 0.5);
    const warpZ = z + 230 * (fbm2(x / 870 + 31.7, z / 870 - 12.3, { seed: seed + 9, octaves: 3 }) - 0.5);
    let envelope = 0.27;
    for (const massif of MASSIFS) {
        const dx = (warpX - massif.x) / massif.spreadX;
        const dz = (warpZ - massif.z) / massif.spreadZ;
        envelope += massif.weight * Math.exp(-(dx * dx + dz * dz));
    }
    // The summits come from the ridges, not from the envelope: a massif is a place where
    // many sharp crests stand tall, never a smooth dome.
    const ridge = ridged2(warpX / 900, warpZ / 900, { seed: seed + 21, octaves: 5, sharpness: 2.2 });
    const crag = ridged2(warpX / 300, warpZ / 300, { seed: seed + 77, octaves: 4, sharpness: 2.4 });
    const grain = fbm2(warpX / 95, warpZ / 95, { seed: seed + 131, octaves: 2 }) - 0.5;
    const shape = ridge ** 1.35 * 0.9 + crag * (0.16 + 0.34 * ridge) + grain * 0.05;
    // The saddle behind the board, and a rise out of the water.
    const saddle = 1 - 0.36 * Math.exp(-((x / 560) ** 2)) * (1 - smooth(1500, 2400, inland) * 0.5);
    return RANGE_PEAK * Math.min(1.3, envelope) * shape * saddle * smooth(0, 300, inland) - 8;
}

/** Where the range's low slopes carry dark spruce forest (0..1); the far trees stand here. */
export function forestCover(x, y, z, seed = 0) {
    return (1 - smooth(50, 150, y)) * smooth(2, 14, y)
        * smooth(0.4, 0.6, fbm2(x / 260, z / 260, { seed: seed + 433, octaves: 3 }));
}

/**
 * Height of the near snow banks: two spits reaching into the lake from the frame's lower
 * corners. The channel between them widens with distance, so the water runs to the eye.
 */
export function bankHeight(x, z, seed = 0) {
    const away = Math.max(0, -z);
    const side = smooth(11 + away * 0.3, 34 + away * 0.62, Math.abs(x));
    const near = 1 - smooth(40, 165, away);
    const mound = 5.6 + 3.4 * fbm2(x / 46, z / 46, { seed: seed + 301, octaves: 3 });
    return -1.6 + side * near * mound;
}

function buildGrid(columns, rows, place) {
    const count = columns * rows;
    const positions = new Float32Array(count * 3);
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const [x, y, z] = place(column / (columns - 1), row / (rows - 1));
            positions.set([x, y, z], (row * columns + column) * 3);
        }
    }
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
export function bakeRidgeProfile(positions, eyeHeight) {
    const profile = new Float32Array(PROFILE_BINS);
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (y <= 0) continue;
        const bin = Math.round((Math.atan2(x, -z) / Math.PI + 0.5) * (PROFILE_BINS - 1));
        if (bin < 0 || bin >= PROFILE_BINS) continue;
        const elevation = Math.atan2(y + eyeHeight, Math.hypot(x, z));
        if (elevation > profile[bin]) profile[bin] = elevation;
    }
    const data = new Uint8Array(PROFILE_BINS * 4);
    for (let bin = 0; bin < PROFILE_BINS; bin += 1) {
        // Close single-bin gaps between grid columns, then quantise.
        const before = profile[Math.max(0, bin - 1)];
        const after = profile[Math.min(PROFILE_BINS - 1, bin + 1)];
        const elevation = Math.max(profile[bin], Math.min(before, after));
        data[bin * 4] = Math.round(Math.min(1, elevation / PROFILE_MAX_ELEVATION) * 255);
        data[bin * 4 + 3] = 255;
    }
    return data;
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

/**
 * Shore ice: a frozen rim along the banks' waterline that runs out into the channel in
 * tongues. R = ice cover (0..1), G = frost (snow dusting the ice). The mask's border texels
 * stay empty, so the clamped lookup leaves open water everywhere beyond it.
 */
export function bakeShoreIce(seed = 0) {
    const { width, height } = SHORE_ICE;
    const data = new Uint8Array(width * height * 4);
    for (let j = 0; j < height; j += 1) {
        for (let i = 0; i < width; i += 1) {
            const index = (j * width + i) * 4;
            data[index + 3] = 255;
            if (i === 0 || j === 0 || i === width - 1 || j === height - 1) continue;
            const x = (i / (width - 1)) * 2 * SHORE_ICE.half - SHORE_ICE.half;
            const z = SHORE_ICE.near + (j / (height - 1)) * (SHORE_ICE.far - SHORE_ICE.near);
            const depth = -bankHeight(x, z, seed);
            // How deep the ice reaches, in water depth: tongues out into the channel, never across it.
            const tongue = fbm2(x / 24, z / 24, { seed: seed + 701, octaves: 4 });
            const reach = Math.min(1.35, 0.85 + 1.1 * (tongue - 0.5) * 2);
            const ice = 1 - smooth(reach - 0.05, reach + 0.05, depth);
            const frost = fbm2(x / 7, z / 7, { seed: seed + 733, octaves: 3 });
            data[index] = Math.round(Math.max(0, Math.min(1, ice)) * 255);
            data[index + 1] = Math.round(frost * 255);
        }
    }
    return data;
}

export class AuroraLandscape {
    /**
     * @param {object} options
     * @param {THREE.Object3D} options.parent
     * @param {object} options.preset quality preset
     * @param {import('./aurora-curtains.js').AuroraCurtains} options.curtains
     * @param {import('./aurora-atmosphere.js').AuroraAtmosphere} options.atmosphere
     * @param {THREE.Texture} options.noiseTexture shared noise tile (not owned)
     * @param {object} options.uniforms shared world uniforms (time, activity, auroraLight)
     * @param {Function} options.random seeded generator
     * @param {number} options.seed
     * @param {number} options.eyeHeight camera height above the lake
     */
    constructor({
        parent, preset, curtains, atmosphere, noiseTexture, uniforms, random, seed = 0, eyeHeight = 8,
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
        this.forest = null;
        this.forestCount = 0;

        const slots = Math.max(1, preset.rippleSlots);
        this.rippleSlots = slots;
        this.rippleCursor = 0;
        // x, z, birth time, strength — and tint with the ring's travel speed in w.
        this.rippleData = Array.from({ length: slots }, () => new THREE.Vector4(0, 0, -1000, 0));
        this.rippleTint = Array.from({ length: slots }, () => new THREE.Vector4(0.3, 1, 0.6, 26));

        this.createRange();
        this.createBanks();
        this.createSpruces(random);
        this.createForest(random);
        this.createLake(curtains, noiseTexture);
    }

    /**
     * Night light on snow, rock and needles. Skylight is a cold blue from everywhere; the
     * aurora arrives from above, a little bleached, so snow facing the sky glows mint and
     * every slope facing away falls into blue shadow. `aurora` is the radiance of the display
     * standing over the surface: it gives facing snow the curtain's own colour and lights
     * rims that stand against it. `backlit` (0..1) says how much of the surface can glow so.
     */
    litSurface(albedo, normal, { aurora = null, backlit = 1 } = {}) {
        const u = this.uniforms;
        const bleached = mix(u.auroraLight, vec3(dot(u.auroraLight, vec3(0.25, 0.6, 0.15))), 0.38);
        const overhead = max(dot(normal, vec3(0.12, 0.86, -0.3)), 0);
        const fill = max(dot(normal, vec3(0, 0.45, 0.9)), 0);
        const facing = abs(dot(normal, normalize(cameraPosition.sub(positionWorld))));
        const rim = float(1).sub(facing).pow(3).mul(max(normal.y, 0))
            .toVar();
        const light = vec3(0.013, 0.022, 0.047).mul(normal.y.mul(0.55).add(0.45))
            .add(bleached.mul(overhead.mul(1.15).add(fill.mul(0.16)).add(rim.mul(0.5)).add(0.03)))
            .toVar();
        if (aurora) {
            // The display itself: a soft wash on whatever faces the sky, and a bright rim
            // where a snow edge stands against the curtains behind it.
            light.addAssign(aurora.mul(overhead.mul(0.07).add(rim.mul(backlit).mul(0.32))));
        }
        return albedo.mul(light);
    }

    createRange() {
        const { terrainColumns: columns, terrainRows: rows } = this.preset;
        const { seed, atmosphere, noiseTexture } = this;
        const geometry = buildGrid(columns, rows, (u, v) => {
            // Rows crowd toward the shore, where the range is largest on screen, and the
            // columns fan out with distance so no vertex is spent outside the view.
            const z = SHORE_Z - RANGE_DEPTH * v ** 1.5;
            const x = (u * 2 - 1) * (120 - z * RANGE_FAN);
            return [x, rangeHeight(x, z, seed), z];
        });
        const positions = geometry.attributes.position.array;
        const normals = geometry.attributes.normal.array;
        const cover = new Float32Array(columns * rows * 2);
        for (let i = 0; i < columns * rows; i += 1) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];
            const flatness = normals[i * 3 + 1];
            // Snow lies on gentle ground and thins on steep faces, which stay bare rock.
            // Dark spruce forest fills the low slopes in patches.
            const snow = smooth(0.6, 0.86, flatness) * (0.7 + 0.3 * smooth(40, 220, y))
                + 0.16 * fbm2(x / 90, z / 90, { seed: seed + 411, octaves: 2 });
            cover[i * 2] = Math.max(0, Math.min(1, snow));
            cover[i * 2 + 1] = Math.max(0, Math.min(1, forestCover(x, y, z, seed)));
        }
        geometry.setAttribute('cover', new THREE.BufferAttribute(cover, 2));
        this.ridgeProfile = bakeRidgeProfile(positions, this.eyeHeight);

        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'Aurora — snow range';
        material.colorNode = Fn(() => {
            const normal = normalize(normalWorld).toVar();
            const mask = attribute('cover', 'vec2').toVar();
            const p = positionWorld.xz.toVar();
            // Three world-space reads of the shared tile: snowfields, gullies and grain.
            const broad = texture(noiseTexture, p.div(2300)).toVar();
            const mid = texture(noiseTexture, p.div(760).add(vec2(0.31, 0.17))).toVar();
            const fine = texture(noiseTexture, p.div(190).add(vec2(0.53, 0.29))).toVar();
            const steep = smoothstep(0.16, 0.5, normal.y.oneMinus()).toVar();
            // Face space: across the fall line and up the face. Streaks read along this pair
            // run straight down the slope, as snow does in a gully. (The tiny offset keeps the
            // direction defined on flat ground, where `steep` is 0 anyway.)
            const fall = normalize(vec2(normal.z.negate(), normal.x).add(vec2(1e-4, 1e-5)));
            const across = dot(p, fall);
            const gully = texture(noiseTexture, vec2(across.div(170), positionWorld.y.div(1400)).add(vec2(0.71, 0.23)));
            const streaks = smoothstep(0.56, 0.72, gully.r.mul(0.7).add(fine.g.mul(0.3)));
            // Rock ribs: thin crests of the mid noise, bared on steep faces only; snow fills
            // the gullies between them, which is what makes a face read as a mountain.
            const rib = pow(float(1).sub(abs(mid.r.mul(2).sub(1))), 5);
            const field = mask.x
                .add(broad.b.sub(0.5).mul(0.3))
                .add(mid.b.sub(0.5).mul(0.42))
                .add(fine.g.sub(0.5).mul(0.24))
                .add(streaks.mul(steep).mul(0.55))
                .sub(rib.mul(steep).mul(0.62));
            const snow = smoothstep(0.42, 0.6, field).toVar();
            // Strata in the bare rock, warped so they never rule a straight line.
            const strata = sin(positionWorld.y.mul(0.13).add(mid.a.mul(9)).add(broad.a.mul(4))).mul(0.5).add(0.5);
            const rock = triple(AURORA_COLORS.rock).mul(mix(0.55, 1.3, strata.mul(fine.r.mul(0.6).add(0.4))));
            // Wind has worked the open snow into drifts: broad mottling, never flat white.
            const drifts = mix(0.72, 1.04, smoothstep(0.2, 0.8, mid.g.mul(0.6).add(broad.a.mul(0.4))));
            const snowAlbedo = triple(AURORA_COLORS.snow).mul(mix(0.82, 1.0, fine.r)).mul(drifts);
            const forest = vec3(0.008, 0.015, 0.014);
            const albedo = mix(mix(rock, snowAlbedo, snow), forest, mask.y.mul(0.85));
            const aurora = atmosphere.auroraAbove(positionWorld).toVar();
            const lit = this.litSurface(albedo, normal, { aurora, backlit: snow });
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
        const { seed, atmosphere, eyeHeight } = this;
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
        material.colorNode = Fn(() => {
            const normal = normalize(normalWorld).toVar();
            // Wind-packed snow: faint sastrugi in the hollows, none of it flat white.
            const drift = sin(positionWorld.x.mul(0.31).add(positionWorld.z.mul(0.23)))
                .mul(sin(positionWorld.z.mul(0.47).sub(positionWorld.x.mul(0.11))))
                .mul(0.07).add(0.93);
            const aurora = atmosphere.auroraAbove(positionWorld).toVar();
            const lit = this.litSurface(triple(AURORA_COLORS.snow).mul(drift).mul(0.82), normal, { aurora })
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
            return atmosphere.apply(lit, positionWorld, { aurora });
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
        // A far tree is a few dozen pixels tall: one segment a bough is enough.
        const geometry = buildSpruceGeometry(random, {
            whorls: 8, segments: 1, teeth: false, branches: 6, coreSides: 7, coreRings: 4,
        });
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
            bakeShoreIce(this.seed),
            SHORE_ICE.width,
            SHORE_ICE.height,
            THREE.RGBAFormat,
            THREE.UnsignedByteType,
        );
        this.iceTexture.name = 'Aurora — shore ice';
        this.iceTexture.magFilter = THREE.LinearFilter;
        this.iceTexture.minFilter = THREE.LinearFilter;
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
                point.x.add(SHORE_ICE.half).div(SHORE_ICE.half * 2),
                point.y.sub(SHORE_ICE.near).div(SHORE_ICE.far - SHORE_ICE.near),
            )).toVar();
            const ice = smoothstep(0.42, 0.58, iceRead.r).toVar();
            const open = ice.oneMinus().toVar();

            // Wind works the water in patches: glassy lanes between ruffled ones.
            const ruffle = smoothstep(0.34, 0.72, texture(noiseTexture, point.mul(0.0017).add(u.time.mul(0.0006))).b);
            const fine = texture(noiseTexture, point.mul(0.021).add(vec2(u.time.mul(0.011), u.time.mul(0.007))));
            const chop = texture(noiseTexture, point.mul(0.0058).add(vec2(u.time.mul(-0.004), u.time.mul(0.0052))));
            const slope = fine.rg.sub(0.5).mul(0.6).add(chop.rg.sub(0.5))
                .mul(ruffle.mul(0.78).add(0.22))
                .toVar();
            const glint = vec3(0).toVar();
            for (let slot = 0; slot < this.rippleSlots; slot += 1) {
                // A ring: a short wave packet riding an expanding front, fading as it goes.
                const ring = ripples.element(slot);
                const tint = tints.element(slot);
                const offsetFromRing = point.sub(ring.xy);
                const radius = max(length(offsetFromRing), 0.001);
                const age = u.time.sub(ring.z);
                const front = radius.sub(age.mul(tint.w));
                const packet = exp(front.mul(front).mul(-0.012))
                    .mul(ring.w).mul(exp(age.mul(-0.55))).mul(smoothstep(0, 0.12, age));
                slope.addAssign(offsetFromRing.div(radius).mul(sin(front.mul(0.52)).mul(packet).mul(0.8)));
                // Light rides the crests: a few thin bright rings, not a lit disc.
                const crest = max(sin(front.mul(0.52).add(1.1)), 0);
                const crest2 = crest.mul(crest);
                glint.addAssign(tint.rgb.mul(packet.mul(crest2.mul(crest2).mul(crest2)).mul(1.2)));
            }
            slope.mulAssign(open);

            // A tilted facet throws the mirrored ray mostly up or down, hardly sideways:
            // that is what draws every reflection into a vertical streak.
            const grazing = clamp(view.y, 0.02, 1);
            let mirror;
            if (reflection) {
                const coord = screenUV.flipX().add(vec2(slope.x.mul(0.035), slope.y.mul(0.2)));
                const smear = vec2(0, ruffle.mul(0.012).add(0.004).add(ice.mul(0.02)));
                mirror = reflection.sample(coord).rgb.mul(0.5)
                    .add(reflection.sample(coord.add(smear)).rgb.mul(0.25))
                    .add(reflection.sample(coord.sub(smear)).rgb.mul(0.25));
            } else {
                const bounced = normalize(vec3(
                    view.x.negate().add(slope.x.mul(0.1)),
                    abs(view.y).add(slope.y.mul(0.32)).max(0.004),
                    view.z.negate(),
                )).toVar();
                const up = clamp(bounced.y, 0, 1);
                const sky = mix(triple(AURORA_COLORS.skyZenith), triple(AURORA_COLORS.skyHorizon), exp(up.mul(-5.2)))
                    .add(triple(AURORA_COLORS.airglow).mul(exp(up.mul(-13))))
                    .mul(u.activity.mul(0.35).add(1))
                    .add(curtains.sample(bounced));
                const azimuth = atan(bounced.x, bounced.z.negate()).div(Math.PI).add(0.5);
                const skyline = texture(profileTexture, vec2(azimuth, 0.5)).level(0).r.mul(PROFILE_MAX_ELEVATION);
                const land = smoothstep(skyline.sub(0.006), skyline.add(0.004), bounced.y).oneMinus();
                mirror = mix(sky, vec3(0.0035, 0.007, 0.013).add(u.auroraLight.mul(0.03)), land);
            }
            mirror = mirror.toVar();

            const fresnel = float(1).sub(grazing).pow(5).mul(0.96)
                .add(0.04)
                .toVar();
            const aurora = atmosphere.auroraAbove(positionWorld).toVar();
            const body = triple(AURORA_COLORS.water).add(u.auroraLight.mul(0.012));
            const water = mix(body, mirror, fresnel).add(glint.mul(0.5).mul(fresnel).mul(open)).toVar();

            // The ice: frosted, cracked, a dim and blurred mirror, with snow blown over it.
            const crackRead = texture(noiseTexture, point.div(23).add(vec2(0.13, 0.61))).toVar();
            const cracks = pow(float(1).sub(abs(crackRead.r.mul(2).sub(1))), 14)
                .add(pow(float(1).sub(abs(crackRead.g.mul(2).sub(1))), 22).mul(0.6));
            const frost = smoothstep(0.35, 0.85, iceRead.g).toVar();
            const iceAlbedo = mix(vec3(0.15, 0.21, 0.29), triple(AURORA_COLORS.snow).mul(0.78), frost)
                .mul(float(1).sub(cracks.mul(0.55).mul(frost.oneMinus().mul(0.7).add(0.3))));
            const iceLit = this.litSurface(iceAlbedo, vec3(0, 1, 0), { aurora, backlit: 0 }).toVar();
            const iceColor = iceLit.add(mirror.mul(fresnel.mul(0.35).add(0.03)).mul(frost.oneMinus()));
            // A thin bright lip where the ice ends at open water.
            const lip = smoothstep(0.3, 0.46, iceRead.r).mul(float(1).sub(smoothstep(0.5, 0.62, iceRead.r)));
            water.assign(mix(water, iceColor, ice).add(iceLit.mul(lip).mul(0.8)));
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

    /**
     * Start a ring on the lake at world (x, z). `tint` is a linear RGB triple.
     * Reuses the oldest slot; allocates nothing.
     */
    ripple(time, x, z, strength, tint, speed = 26) {
        if (this.disposed || !(strength > 0)) return false;
        const slot = this.rippleCursor;
        this.rippleCursor = (slot + 1) % this.rippleSlots;
        this.rippleData[slot].set(x, z, time, Math.min(1.5, strength));
        this.rippleTint[slot].set(tint[0], tint[1], tint[2], speed);
        return true;
    }

    resetRipples() {
        for (const ring of this.rippleData) ring.set(0, 0, -1000, 0);
        this.rippleCursor = 0;
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
        this.spruces.dispose();
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
