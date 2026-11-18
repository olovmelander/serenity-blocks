/**
 * Cosmic Noir — the rock the lighthouse stands on, shaped on the CPU (three-free).
 *
 * The rock is a distance field kept in a small volume: a skerry of bedded stone with a level
 * footing for the tower, a stack beside it, a ledge on the side the waves come from, low rocks
 * before and behind and one tooth standing off alone. It is shaped once, here, where real noise is
 * cheap, and the shader only reads it:
 *   - each lump is the meeting of planes laid on an ellipsoid (a faceted block of about that shape),
 *     and the lumps are melted into one another where they meet;
 *   - its space is warped at two scales, so no face is flat and no edge ruled;
 *   - it lies in beds that dip one way and wander, each of its own thickness; hard beds stand
 *     proud as ledges, soft ones are eaten back, and the sea has opened every bedding plane;
 *   - upright cracks run through it where a ridge of noise says, never on a grid;
 *   - and its skin is weathered at two finer scales.
 *
 * Frame: the lamp at the origin, y up (the lighthouse's own frame). A pure function of its seed
 * and its grid, kept in the shared bake cache; a first visit bakes it in the theme's worker.
 */
import {
    PULSAR, SEA, TAU, TOWER, mulberry32,
} from './cosmic-noir-core.js';
import { bakeOnce } from '../shared/bake-cache.js';
import { toHalfFloat } from '../shared/half-float.js';

/** The sea's mean height and the tower's foot, from the lamp. */
const Y_SEA = SEA.level - PULSAR.height;
const Y_FOOT = Y_SEA + TOWER.footLift;

/** The seed the rock is shaped from. */
export const ROCK_SEED = 1907;

/** The box the volume fills (the lamp's frame): the rock stands clear of every side but its floor. */
export const ROCK_BOX = Object.freeze({
    min: Object.freeze([-4.6, Y_SEA - 1.5, -4.5]),
    max: Object.freeze([6.2, Y_SEA + 4.4, 4.5]),
});

/** The volume's grid for an edge length of its cells (scene units). */
export function rockGrid(cell) {
    const size = ROCK_BOX.max.map((hi, k) => hi - ROCK_BOX.min[k]);
    return size.map((s) => Math.max(8, Math.round(s / cell)));
}

/** The bake cache's key. */
export const rockFieldKey = (seed, cell) => `cosmic-noir:rock:${seed}:${cell}`;

/**
 * The lumps: each a list of planes (unit normal, reach along it). Fixed by a seed: the same rock
 * every visit.
 */
export function rockShards(seed = ROCK_SEED) {
    const rand = mulberry32(seed);
    const lumps = [
        {
            c: [0.15, Y_FOOT - 1.9, 0.05], r: [2.75, 2.0, 2.4], sides: 9, bevels: 4, flat: true, lean: 0.14,
        },
        {
            c: [-2.6, Y_SEA + 0.1, 0.95], r: [0.95, 3.4, 0.85], sides: 6, bevels: 3, lean: 0.1,
        },
        {
            c: [2.65, Y_SEA - 0.5, 0.9], r: [1.65, 1.75, 1.4], sides: 7, bevels: 3, flat: true, lean: 0.26,
        },
        {
            c: [0.7, Y_SEA - 0.6, 2.55], r: [1.6, 1.3, 1.05], sides: 6, bevels: 3, flat: true, lean: 0.3,
        },
        {
            c: [-1.1, Y_SEA - 0.4, -2.2], r: [1.4, 2.0, 1.2], sides: 5, bevels: 2, lean: 0.18,
        },
        {
            c: [4.8, Y_SEA - 0.3, 1.55], r: [0.6, 2.0, 0.54], sides: 5, bevels: 2, lean: 0.09,
        },
    ];
    return lumps.map(({
        c, r, sides, bevels, flat, lean,
    }) => {
        const list = [];
        const face = (n, cut) => {
            const l = Math.hypot(n[0], n[1], n[2]);
            const m = n.map((v) => v / l);
            // The ellipsoid's reach along this face's normal, cut a little short.
            const reach = Math.hypot(m[0] * r[0], m[1] * r[1], m[2] * r[2]) * cut;
            list.push([m[0], m[1], m[2], reach + m[0] * c[0] + m[1] * c[1] + m[2] * c[2]]);
        };
        // The top: level under the tower and on the ledges, tipped with the beds elsewhere.
        face(flat ? [0.03, 1, -0.04] : [0.2 + rand() * 0.3, 1, rand() * 0.3 - 0.2], 1);
        // The flanks, all the way round (so the lump is closed): cliffs, leaning in a little.
        const turn = rand() * TAU;
        for (let i = 0; i < sides; i++) {
            const a = turn + ((i + rand() * 0.7) / sides) * TAU;
            face([Math.cos(a), lean * (0.4 + rand() * 1.2), Math.sin(a)], 0.74 + rand() * 0.26);
        }
        // Bevels: the corners between top and flank struck off.
        for (let i = 0; i < bevels; i++) {
            const a = rand() * TAU;
            face([Math.cos(a), 0.7 + rand() * 0.9, Math.sin(a)], 0.82 + rand() * 0.12);
        }
        return list;
    });
}

/** Gradient noise in three dimensions (about −1 .. 1), from a seeded table. */
function makeNoise(seed) {
    const rand = mulberry32(seed);
    const perm = new Uint8Array(512);
    const order = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = order[i & 255];
    const grad = new Float32Array(256 * 3);
    for (let i = 0; i < 256; i++) {
        const zc = rand() * 2 - 1;
        const a = rand() * TAU;
        const r = Math.sqrt(1 - zc * zc);
        grad[i * 3] = r * Math.cos(a);
        grad[i * 3 + 1] = r * Math.sin(a);
        grad[i * 3 + 2] = zc;
    }
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    const at = (ix, iy, iz, dx, dy, dz) => {
        const k = perm[(ix & 255) + perm[(iy & 255) + perm[iz & 255]]] * 3;
        return grad[k] * dx + grad[k + 1] * dy + grad[k + 2] * dz;
    };
    return (x, y, z) => {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const z0 = Math.floor(z);
        const tx = x - x0;
        const ty = y - y0;
        const tz = z - z0;
        const sx = fade(tx);
        const sy = fade(ty);
        const sz = fade(tz);
        const a0 = at(x0, y0, z0, tx, ty, tz);
        const a1 = at(x0 + 1, y0, z0, tx - 1, ty, tz);
        const b0 = at(x0, y0 + 1, z0, tx, ty - 1, tz);
        const b1 = at(x0 + 1, y0 + 1, z0, tx - 1, ty - 1, tz);
        const c0 = at(x0, y0, z0 + 1, tx, ty, tz - 1);
        const c1 = at(x0 + 1, y0, z0 + 1, tx - 1, ty, tz - 1);
        const d0 = at(x0, y0 + 1, z0 + 1, tx, ty - 1, tz - 1);
        const d1 = at(x0 + 1, y0 + 1, z0 + 1, tx - 1, ty - 1, tz - 1);
        const lo = a0 + (a1 - a0) * sx + (b0 + (b1 - b0) * sx - a0 - (a1 - a0) * sx) * sy;
        const hi = c0 + (c1 - c0) * sx + (d0 + (d1 - d0) * sx - c0 - (c1 - c0) * sx) * sy;
        return (lo + (hi - lo) * sz) * 1.5;
    };
}

const smoothstep = (lo, hi, v) => {
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
};

/** The beds: how thick one is on the average, the way they dip, how far a hard bed stands proud. */
export const ROCK_BEDS = Object.freeze({
    thick: 0.5, dip: Object.freeze([0.21, -0.12]), stand: 0.26,
});

/**
 * The rock's distance field as a function of a point (the lamp's frame): negative inside. Not an
 * exact distance once it is carved (the walk that reads it steps short).
 */
export function rockField(seed = ROCK_SEED) {
    const noise = makeNoise(seed);
    const shards = rockShards(seed);
    const fract = (v) => v - Math.floor(v);
    /** How proud a bed stands (0 eaten back .. 1 hard): its own, by its number. */
    const hardness = (k) => fract(Math.sin(k * 127.1 + 311.7) * 43758.5453);
    /** The lumps alone, melted where they meet. */
    const lumps = (x, y, z) => {
        let d = 1e9;
        for (let s = 0; s < shards.length; s++) {
            const planes = shards[s];
            let m = -1e9;
            for (let i = 0; i < planes.length; i++) {
                const p = planes[i];
                const side = p[0] * x + p[1] * y + p[2] * z - p[3];
                if (side > m) m = side;
            }
            const h = Math.max(0.3 - Math.abs(d - m), 0) / 0.3;
            d = Math.min(d, m) - h * h * 0.3 * 0.25;
        }
        return d;
    };
    return (x, y, z) => {
        // Far from the skin the lumps' own distance is all anyone reads.
        const coarse = lumps(x, y, z);
        if (coarse > 0.95 || coarse < -0.95) return coarse;
        // Its space, warped at two scales.
        const wx = x + 0.26 * noise(x * 0.4 + 3.1, y * 0.4, z * 0.4) + 0.08 * noise(x * 1.25, y * 1.25 + 7.7, z * 1.25);
        const wy = y + 0.14 * noise(x * 0.4, y * 0.4 + 5.3, z * 0.4);
        const wz = z + 0.26 * noise(x * 0.4, y * 0.4, z * 0.4 + 9.1) + 0.08 * noise(x * 1.25 + 2.2, y * 1.25, z * 1.25);
        const d = lumps(wx, wy, wz);
        // Beds that dip and wander, each of its own thickness.
        const level = wy + ROCK_BEDS.dip[0] * wx + ROCK_BEDS.dip[1] * wz
            + 0.22 * noise(x * 0.33, y * 0.33, z * 0.33 + 4.0);
        const bed = level / ROCK_BEDS.thick + 0.75 * noise(level * 1.1, 3.3, 8.8);
        const course = Math.floor(bed);
        const within = bed - course;
        const stands = hardness(course) + (hardness(course + 1) - hardness(course)) * smoothstep(0.8, 1.0, within);
        // (A level top stays level: the tower's footing and the ledges the sea runs up.)
        const proud = (stands - 0.42) * ROCK_BEDS.stand;
        const plane = (1 - smoothstep(0, 0.12, Math.min(within, 1 - within))) * 0.045;
        // Upright cracks, where a ridge of noise says.
        const ridge = 1 - Math.abs(noise(x * 0.95 + 11.0, y * 0.4, z * 0.95 - 3.0));
        const crack = smoothstep(0.92, 0.995, ridge) * 0.12;
        const ridge2 = 1 - Math.abs(noise(x * 2.1 - 5.0, y * 0.9 + 2.0, z * 2.1 + 6.0));
        const crack2 = smoothstep(0.95, 0.998, ridge2) * 0.05;
        // The weathered skin.
        const skin = 0.045 * noise(x * 2.9, y * 2.9, z * 2.9) + 0.02 * noise(x * 6.7, y * 6.7, z * 6.7);
        return d - proud + plane + crack + crack2 + skin;
    };
}

/**
 * The rock as a volume of half floats, x fastest, then y, then z.
 * @param {number} seed
 * @param {number} cell  the edge of a cell, scene units
 * @returns {{ data: Uint16Array, nx: number, ny: number, nz: number }}
 */
export function bakeRockField(seed = ROCK_SEED, cell = 0.085) {
    return bakeOnce(rockFieldKey(seed, cell), () => {
        const [nx, ny, nz] = rockGrid(cell);
        const field = rockField(seed);
        const data = new Uint16Array(nx * ny * nz);
        const { min, max } = ROCK_BOX;
        let o = 0;
        for (let k = 0; k < nz; k++) {
            const z = min[2] + ((k + 0.5) / nz) * (max[2] - min[2]);
            for (let j = 0; j < ny; j++) {
                const y = min[1] + ((j + 0.5) / ny) * (max[1] - min[1]);
                for (let i = 0; i < nx; i++) {
                    const x = min[0] + ((i + 0.5) / nx) * (max[0] - min[0]);
                    data[o] = toHalfFloat(Math.max(-2, Math.min(6, field(x, y, z))));
                    o += 1;
                }
            }
        }
        return {
            data, nx, ny, nz,
        };
    });
}

/** The rock's own heights, for whoever stands something on it. */
export const ROCK_LEVELS = Object.freeze({ sea: Y_SEA, foot: Y_FOOT });
