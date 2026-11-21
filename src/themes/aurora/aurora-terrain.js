/**
 * Aurora — the land's pure functions (three-free): the range's height, the forest's cover, the
 * banks' height and the shore ice. The landscape (aurora-landscape.js) builds its meshes from
 * them; ice and the range's height grid are kept for the session and a first visit bakes them in
 * a module Worker (aurora-bakes.js), with the shared noise.
 */
import { fbm2, ridged2, valueNoise2 } from './aurora-noise.js';

/** Far shore: where the lake meets the foot of the range. */
export const SHORE_Z = -640;
export const RANGE_DEPTH = 2700;
/** The range grid fans out from the eye: half-width per unit of distance. */
export const RANGE_FAN = 1.3;
/** Height of the tallest summits above the lake. */
const RANGE_PEAK = 700;
/** The shore-ice mask covers the near water: x within ±half, z from `near` out to `far`. */
export const SHORE_ICE = Object.freeze({
    half: 200,
    near: 20,
    far: -220,
    width: 512,
    height: 224,
    // The two fracture channels use a perspective grid centred on the resting eye.
    tangentWidth: 2.9,
    maxInverseDepth: 0.065,
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

// Glacial horns rising from the rounded foothills. Each summit has a long descending arête
// on one side and a short north wall. Their feet merge into the eroded terrain below.
const HORNS = [
    [-630, -1620, 448, 370, 435, -0.62],
    [-405, -1840, 305, 325, 380, 0.48],
    [705, -1700, 477, 430, 500, 0.56],
    [490, -1880, 360, 340, 395, -0.42],
    [80, -2550, 245, 380, 420, 0.45],
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
    let height = RANGE_PEAK * Math.min(1.3, envelope) * shape * saddle * smooth(0, 300, inland) - 8;
    if (inland > 450) {
        for (const [cx, cz, peak, width, depth, dip] of HORNS) {
            const dz = (z - cz + (warpZ - z) * 0.36) / depth;
            const dx = (x - cx + (warpX - x) * 0.59) / width + dz * dip;
            const along = Math.abs(dx) * (dx < 0 ? 0.77 : 1.12);
            const across = Math.abs(dz) * (dz > 0 ? 1.18 : 0.75);
            const face = 1 - Math.max(along + across * 0.38, across + along * 0.34);
            if (face <= 0) continue;
            // Couloirs cut *through* an arête. Where one reaches the skyline a notch divides
            // two rock teeth; farther down the same cut forms a steep shady face. Stagger
            // their widths and directions so the two sides of a horn weather differently.
            const run = dx + dz * (0.63 + 0.23 * dip) + (warpZ - z) * 0.0014;
            const first = 1 - smooth(0.016, 0.18, Math.abs(run + 0.44 + dip * 0.12));
            const second = 1 - smooth(0.01, 0.13, Math.abs(run - 0.22 + dz * 0.22));
            const third = 1 - smooth(0.01, 0.11, Math.abs(run - 0.56 - dip * 0.18));
            const notch = peak * (first * 0.19 + second * 0.125 + third * 0.13);
            const buttresses = (ridge - 0.42) * 133 + (crag - 0.35) * 76;
            height = Math.max(height, face * (peak + buttresses - notch));
        }
    }
    return height;
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
    const bend = (x < 0 ? 3.4 : 2.7) * Math.sin(away * 0.057 + (x < 0 ? 1.3 : 0.15));
    const side = smooth(6 + away * 0.21 + bend, 24 + away * 0.47 + bend, Math.abs(x));
    const near = 1 - smooth(40, 165, away);
    if (side === 0 || near === 0) return -1.6;
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
 * tongues. R = opaque shore ice, G = frost. B and A map the surface and submerged edges
 * of a few pressure fractures in the clear lake ice. Their UVs resolve the ice seen from
 * shore, so a line near the eye gets as much detail as one crossing the far channel.
 */
export function bakeShoreIce(seed = 0) {
    const { width, height } = SHORE_ICE;
    const data = new Uint8Array(width * height * 4);
    for (let j = 0; j < height; j += 1) {
        for (let i = 0; i < width; i += 1) {
            const index = (j * width + i) * 4;
            if (i === 0 || j === 0 || i === width - 1 || j === height - 1) continue;
            const x = (i / (width - 1)) * 2 * SHORE_ICE.half - SHORE_ICE.half;
            const z = SHORE_ICE.near + (j / (height - 1)) * (SHORE_ICE.far - SHORE_ICE.near);
            const depth = -bankHeight(x, z, seed);
            // Beyond the furthest ice tongue both channels are zero. Under the snow bank
            // both are hidden, and don't need seven more octaves of noise.
            if (depth > 1.4) continue;
            if (depth < -0.4) {
                data[index] = 255;
                data[index + 1] = 180;
                continue;
            }
            // How deep the ice reaches, in water depth: tongues out into the channel, never across it.
            const tongue = fbm2(x / 24, z / 24, { seed: seed + 701, octaves: 4 });
            const reach = Math.min(1.35, 0.85 + 1.1 * (tongue - 0.5) * 2);
            const ice = 1 - smooth(reach - 0.05, reach + 0.05, depth);
            const frost = fbm2(x / 7, z / 7, { seed: seed + 733, octaves: 3 });
            data[index] = Math.round(Math.max(0, Math.min(1, ice)) * 255);
            data[index + 1] = Math.round(frost * 255);
        }
    }
    paintPressureCracks(data);
    return data;
}

// A crack across a lake grows in nearly straight runs, changing direction when a plate
// breaks and leaving smaller, abruptly ending branches on the same joint. Positions are
// metres across and out from shore. The two lips separate in perspective with ice depth.
function paintPressureCracks(data) {
    const {
        width, height, tangentWidth, maxInverseDepth,
    } = SHORE_ICE;
    const project = (x, reach, depth) => [
        (0.5 + x / reach / tangentWidth) * width - 0.5,
        ((1 + depth / 8) / (reach * maxInverseDepth)) * height - 0.5,
    ];
    const stroke = (a, b, channel, weight, breadth) => {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const length2 = Math.max(0.0001, dx * dx + dy * dy);
        const x0 = Math.max(1, Math.floor(Math.min(a[0], b[0]) - 3));
        const x1 = Math.min(width - 2, Math.ceil(Math.max(a[0], b[0]) + 3));
        const y0 = Math.max(1, Math.floor(Math.min(a[1], b[1]) - 3));
        const y1 = Math.min(height - 2, Math.ceil(Math.max(a[1], b[1]) + 3));
        for (let y = y0; y <= y1; y += 1) {
            for (let x = x0; x <= x1; x += 1) {
                const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length2));
                const distance = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
                const coverage = weight * (1 - smooth(0, breadth, distance));
                const i = (y * width + x) * 4 + channel;
                data[i] = Math.max(data[i], Math.round(255 * coverage));
            }
        }
    };
    const crack = (points, strength) => {
        for (let i = 1; i < points.length; i += 1) {
            const [ax, az] = points[i - 1];
            const [bx, bz] = points[i];
            const sections = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
            let previousX = ax;
            let previousZ = az;
            for (let part = 1; part <= sections; part += 1) {
                const t = part / sections;
                const reach = az + (bz - az) * t;
                const kink = part === sections ? 0 : (valueNoise2(reach * 0.53, ax) - 0.5) * 0.41;
                const x = ax + (bx - ax) * t + kink;
                const depth = 0.14 + 0.14 * Math.sin(x * 0.16 + reach * 0.09);
                const opacity = strength * (0.22 + 0.78 * smooth(0.28, 0.72, valueNoise2(x * 0.16, reach * 0.12)));
                stroke(project(previousX, previousZ, 0), project(x, reach, 0), 2, opacity, 0.95);
                stroke(project(previousX, previousZ, depth), project(x, reach, depth), 3, opacity, 1.1);
                previousX = x;
                previousZ = reach;
            }
        }
    };
    crack([[-27, 29], [-21.4, 31.7], [-18.8, 37.4], [-15.3, 38.2], [-13, 42],
        [-13.5, 44], [-10.7, 47], [-9, 52]], 0.95);
    crack([[-18.8, 37.4], [-20.5, 40.2], [-19.4, 44.6], [-20.1, 48]], 0.55);
    crack([[-17, 63], [-12, 68.1], [-9.8, 67.7], [-6.4, 71], [1, 72.4]], 0.46);
    crack([[34, 36], [28.5, 38.7], [26.2, 43.3], [24.4, 44.7], [22.4, 44.7],
        [18.9, 48.8], [14.8, 49.7], [12.8, 52.4]], 0.83);
    crack([[26.2, 43.3], [26.6, 46.8], [29, 50.5]], 0.44);
    crack([[4, 23], [6.4, 24.8], [7.1, 28.4], [10.8, 30.1], [12.2, 32.8]], 0.48);
    crack([[-48, 73], [-38.2, 77.6], [-36.8, 81], [-30, 84], [-26.5, 84.2]], 0.36);
}
