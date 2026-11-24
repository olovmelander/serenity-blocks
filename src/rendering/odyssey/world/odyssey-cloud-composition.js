import { CLOUD_SHAPES, cloudShapeIndex } from './odyssey-cloud-data.js';

/**
 * THE SKY'S COMPOSITION (2026-11-24): what clouds stand where, and how they move.
 *
 * The journey looks north and north-west from the island, up at the summit from the mountain, and out to the
 * north-east and east from the climb, under one sun that never moves (low, in the west-south-west). So the
 * sky is built in storeys, each at its own height and pace, and each storey in LANES along the one wind:
 *
 *   wall    banks along the horizon all round, the furthest, hardly moving: where the sky ends
 *   giants  a few towers, standing well behind the island: the scale of everything else
 *   fair    the day's own heaps, in the middle distance west, north and east of the mountain
 *   floor   the sea of clouds the evening brings below the climb: broad low shelves flowing under the eye, over a
 *           soft bed (odyssey-cloud-sea.js), never over the island's lee or the mountain
 *   cap     lens clouds standing in the summit's lee through the evening, forming and thinning where they are
 *
 * (The high sky, cirrus and altocumulus, is on the dome: odyssey-high-clouds.js.)
 *
 * A lane is a line down the wind. Its clouds are born small at its head, grow, drift, and are eaten away at
 * its foot, where the next is already on its way: at any moment the lane holds its number of clouds, and no
 * cloud is ever seen twice (its shape, size and turn are drawn again every time round).
 *
 * The lanes leave the AXIS free: nothing lower than the summit's own sky passes over the rail or before the
 * mountain. Where the eye goes is open; the clouds frame it.
 *
 * Coordinates: `s` runs down the wind (toward west-north-west), `q` across it (toward north-north-east), from
 * the world's origin. Pure arithmetic, no three.js.
 */

export const CLOUD_WIND = Object.freeze([-0.928, -0.373]);
const ACROSS = Object.freeze([0.373, -0.928]);

/** World x, z of a place (s down the wind, q across it). */
export function lanePlace(s, q) {
    return [(s * CLOUD_WIND[0]) + (q * ACROSS[0]), (s * CLOUD_WIND[1]) + (q * ACROSS[1])];
}

const lane = (spec) => Object.freeze({
    jitter: 0, tall: [0.92, 1.12], edge: 0.14, softness: 1, turn: null, ...spec,
});

/** The shapes each storey draws from. */
const FAIR = Object.freeze(['heap-a', 'heap-b', 'heap-c', 'heap-d', 'puff-a', 'puff-b', 'puff-c']);
const SMALL = Object.freeze(['puff-a', 'puff-b', 'puff-c', 'heap-d']);
const TALL = Object.freeze(['tower-a', 'tower-b', 'tower-c']);
const FLOOR = Object.freeze(['shelf-a', 'shelf-b', 'shelf-c']);

/** (No giant is taller than the climb takes the eye: by orb 34 it looks down on every one of them.) */
const GIANT_TALL = Object.freeze([0.88, 1.0]);

/**
 * The lanes: `at` [s, q] its middle, `half` its half length (u), `count` clouds in it, `speed` u/s, `w` the
 * widths, `base` the heights of their feet, `jitter` how far off the line they stray (u, across and along).
 */
export const CLOUD_LANES = Object.freeze([
    // the giants, far behind the island: one always in the island's north-west, one to the north, two east
    lane({
        id: 'giants-n', role: 'giant', shapes: TALL, at: [700, 3900], half: 3700, count: 4, speed: 2.2, w: [1500, 1900], base: [790, 825], jitter: 380, tall: GIANT_TALL,
    }),
    lane({
        id: 'giants-w', role: 'giant', shapes: TALL, at: [3900, 1900], half: 1500, count: 1, speed: 2.2, w: [1500, 1900], base: [790, 825], jitter: 240, tall: GIANT_TALL,
    }),
    lane({
        id: 'giants-e', role: 'giant', shapes: TALL, at: [-3700, 2100], half: 1500, count: 2, speed: 2.2, w: [1450, 1850], base: [790, 825], jitter: 320, tall: GIANT_TALL,
    }),
    lane({
        id: 'giants-s', role: 'giant', shapes: TALL, at: [400, -4300], half: 3200, count: 2, speed: 2.2, w: [1500, 1900], base: [790, 825], jitter: 380, tall: GIANT_TALL,
    }),
    // the day's heaps: west of the mountain (the island's sky), few and well apart ...
    lane({
        id: 'fair-w1', role: 'fair', shapes: FAIR, at: [2900, 1900], half: 1500, count: 2, speed: 4.0, w: [820, 1180], base: [880, 930], jitter: 170,
    }),
    lane({
        id: 'fair-w2', role: 'fair', shapes: FAIR, at: [3300, 3300], half: 2200, count: 3, speed: 4.0, w: [760, 1180], base: [880, 940], jitter: 260,
    }),
    lane({
        id: 'fair-w3', role: 'fair', shapes: SMALL, at: [2500, 560], half: 1200, count: 2, speed: 4.0, w: [420, 660], base: [880, 930], jitter: 150,
    }),
    lane({
        id: 'fair-w4', role: 'fair', shapes: FAIR, at: [3500, -900], half: 1700, count: 2, speed: 4.0, w: [620, 960], base: [890, 940], jitter: 240,
    }),
    // ... north of it, and east (the climb's)
    lane({
        id: 'fair-n1', role: 'fair', shapes: FAIR, at: [-200, 3000], half: 2600, count: 4, speed: 4.0, w: [680, 1120], base: [880, 940], jitter: 240,
    }),
    lane({
        id: 'fair-e1', role: 'fair', shapes: FAIR, at: [-2500, 1950], half: 1350, count: 2, speed: 4.0, w: [640, 1000], base: [860, 920], jitter: 200,
    }),
    lane({
        id: 'fair-e2', role: 'fair', shapes: FAIR, at: [-3100, 800], half: 1600, count: 3, speed: 4.0, w: [600, 960], base: [860, 920], jitter: 240,
    }),
    lane({
        id: 'fair-e3', role: 'fair', shapes: SMALL, at: [-2500, -500], half: 1200, count: 2, speed: 4.0, w: [420, 700], base: [870, 920], jitter: 220,
    }),
    // the sea behind the traveller
    lane({
        id: 'fair-s1', role: 'fair', shapes: FAIR, at: [0, -2500], half: 3000, count: 5, speed: 4.0, w: [640, 1040], base: [880, 940], jitter: 320,
    }),
]);

/** The floor's lanes: ten across the wind, shelves flowing down each (odyssey-cloud-sea.js says where one may stand). */
const FLOOR_LANES = Object.freeze([-4300, -3200, -2300, -1500, -700, 200, 1100, 2100, 3200, 4400].map((q, i) => lane({
    id: `floor-${i}`,
    role: 'floor',
    shapes: FLOOR,
    at: [(i % 2) * 420, q - 700],
    half: 5400,
    count: 7,
    speed: 4.6,
    w: [1050, 1800],
    base: [452, 492],
    jitter: 330,
    tall: [0.50, 0.72],
    edge: 0.06,
    softness: 1.15,
})));

/**
 * The wall: banks on the horizon, [bearing from north (degrees, east positive), distance, width, base, shape]. Near
 * and far by turns, and gone as the climb leaves it behind (`WALL_CLIMB`): from very high a ring is a ring.
 */
export const CLOUD_WALL = Object.freeze([
    [-88, 6100, 3300, 600, 'bank-b'], [-66, 7900, 3900, 610, 'bank-a'], [-44, 6800, 3600, 590, 'bank-c'], [-24, 8200, 3700, 620, 'bank-a'],
    [-4, 7000, 4200, 600, 'bank-b'], [17, 8300, 3700, 610, 'bank-c'], [38, 6300, 3500, 590, 'bank-a'], [58, 7800, 4000, 610, 'bank-b'],
    [80, 6600, 3600, 600, 'bank-c'], [104, 8100, 3700, 610, 'bank-a'], [130, 6900, 3700, 600, 'bank-b'], [158, 7700, 3900, 610, 'bank-c'],
    [-176, 6400, 3700, 600, 'bank-a'], [-148, 8000, 3700, 610, 'bank-b'], [-118, 7100, 3700, 600, 'bank-c'],
].map((b) => Object.freeze(b)));
const WALL_CLIMB = Object.freeze([1.35, 2.6]);
/** The wall stands round this place (x, z), the journey's middle. */
export const CLOUD_WALL_CENTRE = Object.freeze([-140, -700]);

/**
 * The summit's cap: lenses in its lee, [u down the wind from the tip, u across, u over it, width, period s, phase].
 * Each swells from a wisp and thins away again on its own clock: they stand still while the wind blows through.
 */
export const CLOUD_CAP = Object.freeze([
    [330, 40, 96, 430, 171, 0.10], [250, -60, 182, 300, 137, 0.52], [470, 90, 236, 360, 203, 0.80],
].map((b) => Object.freeze(b)));

/** A cloud's state. (A class, and `shape` first: plain `{ x, z }` literals share a map with the world's bake data.) */
export class CloudState {
    constructor() {
        this.shape = 0;
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.w = 1;
        this.tall = 1;
        this.yaw = 0;
        this.eaten = 1;
        this.cover = 0;
        this.softness = 1;
        this.seed = 0;
        this.role = '';
        this.dist = 0;
        this.near = 0;
    }
}

const fract = (v) => v - Math.floor(v);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - (2 * t));
};

/** A well-mixed hash of two integers and a salt, 0..1. */
export function cloudHash(a, b, salt) {
    let h = ((a | 0) * 374761393) + ((b | 0) * 668265263) + (salt * 2654435761);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const pick = (range, t) => range[0] + ((range[1] - range[0]) * t);

/** Every cloud of the sky, in a fixed order: the lanes' and the wall's. */
export const SKY_CLOUDS = Object.freeze([
    ...[...CLOUD_LANES, ...FLOOR_LANES].flatMap((l, li) => Array.from({ length: l.count }, (_, k) => Object.freeze({
        key: li * 50 + k, lane: l, k,
    }))),
    ...CLOUD_WALL.map((b, i) => Object.freeze({ key: 5000 + i, wall: b, k: i })),
    ...CLOUD_CAP.map((b, i) => Object.freeze({ key: 6000 + i, cap: b, k: i })),
]);

const NO_WORLD = Object.freeze({
    summit: null, cap: 0, floorAt: null, climb: 1,
});

/**
 * A cloud at `time` (s): where it stands, which shape it wears and how whole it is.
 * @param {object} cloud one of SKY_CLOUDS
 * @param {number} time seconds
 * @param {CloudState} out written and returned
 * @param {{summit?: {x:number,y:number,z:number}, cap?: number, floorAt?: (x:number,z:number,reach:number)=>number, climb?: number}} [world] where the
 *   summit's tip is, how far the evening has brought its cap on (0..1), how much of the sea of clouds may stand
 *   at a place (0..1), and how far the eye has climbed out of the world (1 = not at all)
 */
export function cloudAt(cloud, time, out, world = NO_WORLD) {
    if (cloud.wall) {
        const [bearing, distance, width, base, shape] = cloud.wall;
        // A wall only breathes: it leans a little down the wind and back over many minutes.
        const sway = Math.sin((time / 620) + (cloud.k * 2.1)) * 130;
        const a = (bearing * Math.PI) / 180;
        out.x = CLOUD_WALL_CENTRE[0] + (Math.sin(a) * distance) + (CLOUD_WIND[0] * sway);
        out.z = CLOUD_WALL_CENTRE[1] - (Math.cos(a) * distance) + (CLOUD_WIND[1] * sway);
        out.y = base;
        out.w = width;
        out.tall = 0.86 + (0.24 * cloudHash(cloud.k, 1, 3));
        out.shape = cloudShapeIndex(shape);
        // It faces the island: its length lies across the view.
        out.yaw = -a + ((cloudHash(cloud.k, 2, 3) - 0.5) * 0.5) + (cloudHash(cloud.k, 4, 3) < 0.5 ? Math.PI : 0);
        const left = smooth(WALL_CLIMB[0], WALL_CLIMB[1], world.climb ?? 1);
        out.eaten = Math.min(1, 0.10 + (0.07 * Math.sin((time / 410) + (cloud.k * 1.3))) + left);
        out.cover = 1 - left;
        out.softness = 1;
        out.seed = cloudHash(cloud.k, 5, 3);
        out.role = 'wall';
        return out;
    }
    if (cloud.cap) {
        const [down, side, up, width, period, phase] = cloud.cap;
        const life = clamp01(0.5 + (0.95 * Math.sin(((time / period) + phase) * Math.PI * 2)));
        const tip = world.summit;
        out.x = (tip?.x ?? 0) + (CLOUD_WIND[0] * down) + (ACROSS[0] * side);
        out.z = (tip?.z ?? 0) + (CLOUD_WIND[1] * down) + (ACROSS[1] * side);
        out.y = (tip?.y ?? 0) + up;
        out.w = width * (0.86 + (0.14 * life));
        out.tall = 0.9;
        out.shape = cloudShapeIndex('lens-a');
        // Its length lies across the wind's way, as a wave does.
        out.yaw = Math.atan2(-CLOUD_WIND[1], CLOUD_WIND[0]) + 0.25 + (0.2 * cloud.k);
        out.eaten = 0.62 - (0.58 * smooth(0.05, 0.75, life));
        out.cover = smooth(0.02, 0.30, life) * clamp01(world.cap) * (tip ? 1 : 0);
        out.softness = 0.8;
        out.seed = 0.31 * cloud.k;
        out.role = 'cap';
        return out;
    }
    const l = cloud.lane;
    const turns = ((time * l.speed) / (2 * l.half)) + (cloud.k / l.count) + ((cloudHash(cloud.key, 0, 9) * 0.35) / l.count);
    const cycle = Math.floor(turns);
    const u = turns - cycle;
    const h = (salt) => cloudHash(cloud.key, cycle, salt);
    const s = l.at[0] + ((u - 0.5) * 2 * l.half) + ((h(21) - 0.5) * l.jitter * 0.7);
    const q = l.at[1] + ((h(22) - 0.5) * 2 * l.jitter);
    const [x, z] = lanePlace(s, q);
    out.x = x;
    out.z = z;
    // A grown cloud's base lifts a little as the day's air warms it, then settles.
    out.y = pick(l.base, h(23)) + (14 * Math.sin((time / 190) + (cloud.key * 1.7)));
    // It grows as it is born, and thins as it goes.
    const whole = smooth(0, l.edge, u) * smooth(1, 1 - l.edge, u);
    out.w = pick(l.w, h(24)) * (0.80 + (0.20 * smooth(0, l.edge * 2.4, u)));
    out.tall = pick(l.tall, h(25));
    out.shape = cloudShapeIndex(l.shapes[Math.min(l.shapes.length - 1, Math.floor(h(26) * l.shapes.length))]);
    out.yaw = h(27) * Math.PI * 2;
    out.eaten = (1 - whole) + ((0.05 + (0.05 * Math.sin((time / 83) + (cloud.key * 2.3)))) * whole);
    out.cover = smooth(0, l.edge * 0.45, u) * smooth(1, 1 - (l.edge * 0.45), u);
    out.softness = l.softness;
    out.seed = fract(h(28) + (cloud.key * 0.137));
    out.role = l.role;
    if (l.role === 'floor') {
        // The floor stands where the sea of clouds may, and melts away where it may not.
        // (asked at its edge nearest the mountain, not its middle: it is as wide as the clear air is)
        const may = world.floorAt ? world.floorAt(x, z, out.w * 0.5) : 0;
        out.cover *= smooth(0.02, 0.16, may);
        out.eaten = Math.max(out.eaten, 1 - smooth(0.0, 0.46, may));
    }
    return out;
}

/** A cloud's reach round its foot's middle (u across the ground), and its top over its foot. */
export function cloudExtent(state) {
    const shape = CLOUD_SHAPES[state.shape];
    return { across: Math.hypot(shape.box[0], shape.box[2]) * 0.5 * state.w, up: shape.hi[1] * shape.box[1] * state.w * state.tall };
}
