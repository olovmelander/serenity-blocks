/**
 * Aurora — the land's pure functions (three-free): the range's height, the forest's cover, the
 * banks' height and the shore ice. The landscape (aurora-landscape.js) builds its meshes from
 * them; ice and the range's height grid are kept for the session and a first visit bakes them in
 * a module Worker (aurora-bakes.js), with the shared noise.
 */
import { fbm2, ridged2 } from './aurora-noise.js';

/** Far shore: where the lake meets the foot of the range. */
export const SHORE_Z = -640;
export const RANGE_DEPTH = 2700;
/** The range grid fans out from the eye: half-width per unit of distance. */
export const RANGE_FAN = 1.3;
/** Height of the tallest summits above the lake. */
const RANGE_PEAK = 700;
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

export const smooth = (edge0, edge1, value) => {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

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

/**
 * The range grid's points, as the landscape lays them (aurora-landscape.js createRange): rows
 * crowd toward the shore, where the range is largest on screen, and the columns fan out with
 * distance so no vertex is spent outside the view.
 * @returns {Float32Array} columns × rows × 3
 */
export function rangeGridPositions(columns, rows, seed = 0) {
    const positions = new Float32Array(columns * rows * 3);
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const v = row / (rows - 1);
            const u = column / (columns - 1);
            const z = SHORE_Z - RANGE_DEPTH * v ** 1.5;
            const x = (u * 2 - 1) * (120 - z * RANGE_FAN);
            positions.set([x, rangeHeight(x, z, seed), z], (row * columns + column) * 3);
        }
    }
    return positions;
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
