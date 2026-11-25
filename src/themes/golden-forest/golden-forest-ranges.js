/**
 * Golden Forest — the shape of the far ranges (CPU only, three-free).
 *
 * Behind the wooded hill and the fells stand two ranges of rock and snow. They are real ground,
 * not painted cards: a height function made of folded noise (sharp crests, round cols), highest
 * along each range's own line, with one summit standing over the right shore as there has always
 * been, and a col where the sun stands so its disc rests between two shoulders. The backdrop
 * draws it as a grid and lights its faces from the sky (golden-forest-backdrop.js); the tests
 * read the same function.
 */

/** Where the grid lies (metres), and the two ranges: their line, half width and crest height. */
export const GOLDEN_FOREST_RANGES = Object.freeze({
    minX: -2700,
    maxX: 2700,
    minZ: -1760,
    maxZ: -900,
    front: Object.freeze({
        z: -1070, half: 150, crest: 215, wander: 46,
    }),
    back: Object.freeze({
        z: -1470, half: 230, crest: 300, wander: 70,
    }),
    /** The summit over the right shore: its place, its reach and what it adds. */
    summit: Object.freeze({
        x: 560, z: -1440, reach: 520, lift: 250,
    }),
    /** The eye the ranges are composed for, and the sun's bearing from it (degrees). */
    eyeZ: 14.5,
    sunAzimuth: -21,
    /** How far the crest sinks where the sun stands, and how wide the col is (m at the front range). */
    col: Object.freeze({ drop: 0.5, width: 190 }),
});

/** A small seeded generator (mulberry32). */
function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const LATTICE = 64;

/** Smooth value noise over the plane from a seeded lattice (tiles every LATTICE cells). */
function planeNoise(random) {
    const table = Float32Array.from({ length: LATTICE * LATTICE }, () => random());
    const at = (x, z) => table[(((z % LATTICE) + LATTICE) % LATTICE) * LATTICE + (((x % LATTICE) + LATTICE) % LATTICE)];
    return (x, z) => {
        const x0 = Math.floor(x);
        const z0 = Math.floor(z);
        const fx = x - x0;
        const fz = z - z0;
        const ux = fx * fx * (3 - 2 * fx);
        const uz = fz * fz * (3 - 2 * fz);
        const top = at(x0, z0) + (at(x0 + 1, z0) - at(x0, z0)) * ux;
        const bottom = at(x0, z0 + 1) + (at(x0 + 1, z0 + 1) - at(x0, z0 + 1)) * ux;
        return top + (bottom - top) * uz;
    };
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/**
 * The ranges' height function for a seed. `height(x, z)` is metres above the lake (0 outside the
 * grid's reach); the same seed gives the same mountains.
 * @param {number} [seed]
 */
export function createGoldenForestRanges(seed = 2341) {
    const random = seeded(Math.floor(Number.isFinite(seed) ? seed : 2341));
    const noise = planeNoise(random);
    const phases = Array.from({ length: 6 }, () => random() * Math.PI * 2);
    const R = GOLDEN_FOREST_RANGES;
    const sunTan = Math.tan((R.sunAzimuth * Math.PI) / 180);

    /** Folded noise: sharp crests and round cols, each octave riding the crests of the last. */
    const folded = (x, z) => {
        let sum = 0;
        let weight = 0.5;
        let frequency = 1;
        let carry = 1;
        for (let octave = 0; octave < 5; octave += 1) {
            let fold = 1 - Math.abs(2 * noise(x * frequency + octave * 17.3, z * frequency + octave * 9.1) - 1);
            fold *= fold;
            sum += fold * weight * (0.35 + 0.65 * carry);
            carry = fold;
            weight *= 0.5;
            frequency *= 2.09;
        }
        return sum;
    };

    const range = (x, z, line, phase) => {
        const centre = line.z + line.wander * Math.sin(x * 0.0013 + phases[phase])
            + line.wander * 0.5 * Math.sin(x * 0.0031 + phases[phase + 1]);
        const across = clamp01(1 - Math.abs(z - centre) / line.half);
        if (across <= 0) return 0;
        // Broad massifs along the range, and the col where the sun stands.
        const massif = 0.62 + 0.38 * Math.sin(x * 0.0021 + phases[phase + 2]) * Math.sin(x * 0.00087 + phases[phase]);
        const sunX = sunTan * (R.eyeZ - z);
        const width = R.col.width * ((R.eyeZ - z) / (R.eyeZ - R.front.z));
        const col = 1 - R.col.drop * Math.exp(-(((x - sunX) / width) ** 2));
        const relief = 0.3 + 1.5 * folded(x / 560, z / 560);
        return line.crest * massif * col * relief * across ** 1.2;
    };

    const height = (x, z) => {
        if (!(x >= R.minX && x <= R.maxX && z >= R.minZ && z <= R.maxZ)) return 0;
        // The grid's rim sinks to the lake on every side, so no wall stands at its edge.
        const rim = Math.min(1, (x - R.minX) / 320, (R.maxX - x) / 320, (z - R.minZ) / 90, (R.maxZ - z) / 90);
        const base = Math.max(range(x, z, R.front, 0), range(x, z, R.back, 3));
        const { summit } = R;
        const reach = Math.hypot(x - summit.x, (z - summit.z) * 1.7) / summit.reach;
        // A horn: steep to its top, with shoulders the folds break up.
        const horn = reach < 1 ? summit.lift * (1 - reach) ** 1.7 * (0.72 + 0.56 * folded(x / 240, z / 240)) : 0;
        return Math.max(0, (base + horn) * Math.max(0, rim));
    };

    return { height };
}
