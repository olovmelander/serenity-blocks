/**
 * Ocean — core (CPU only, three-free).
 *
 * The reef's numbers: the rest camera, the seabed's shape, the slot counts and timings of
 * everything the board can start, the paths the school and the large animals swim, and the small
 * pure functions the world, the shaders' CPU twins and the tests share. Nothing here touches the
 * GPU.
 *
 * World frame: metres, y up. The sand under the viewer lies at y = 0 and the sea's surface at
 * y = SURFACE; the viewer rests in the mouth of a reef canyon and looks along −z, a little
 * upward, out into open water.
 *
 * "Stage space" is the canyon as built. On a narrow frame the stage is drawn in toward the
 * middle (x · squeeze), so both reef shoulders still stand beside the board on a tall phone.
 */

import { bakeOnce } from '../shared/bake-cache.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** 1 − e^(−rate·dt): the share of the way to a target an eased value covers in one step. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Smoothstep on the CPU (edges in the usual order; equal edges give a step). */
export function smooth(lo, hi, v) {
    if (hi === lo) return v < lo ? 0 : 1;
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** (1 − |x|)² inside |x| < 1, else 0. */
export function bell(x) {
    const k = Math.max(0, 1 - Math.abs(x));
    return k * k;
}

export function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── The sea ─────────────────────────────────────────────────────────────────────

/** Height of the sea's surface over the sand at the viewer's feet (metres). */
export const SURFACE = 15;

/** Metres one tile of the baked light pattern covers (the caustic net and the shafts' mask). */
export const LIGHT_TILE = 24;

/**
 * The index the surface refracts with when seen from below. Water's own (1.33) puts the edge of
 * Snell's window 41° above the horizontal, out of a wide frame; a little less brings its bright
 * rim down into the top of the picture.
 */
export const WINDOW_INDEX = 1.2;

// ── The rest camera ─────────────────────────────────────────────────────────────

export const EYE = Object.freeze({
    x: 0,
    y: 2.5,
    z: 10,
    /** It looks a little upward: the surface closes the top of the frame, the reef its foot. */
    pitch: 13 * DEG,
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 82,
    minFov: 36,
    maxFov: 66,
    near: 0.2,
    far: 420,
});

/** The vertical field of view (degrees) that holds the rig's horizontal one at an aspect. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((EYE.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(EYE.minFov, Math.min(EYE.maxFov, v));
}

/** tan of half the horizontal field of view the frame really has at an aspect. */
export function halfWidthTan(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    return Math.tan((fovForAspect(a) * DEG) / 2) * a;
}

/**
 * How far the stage is drawn in toward the middle on a frame too narrow for it (1 = as built).
 * The reef's shoulders stand at x · squeeze, so a tall phone still holds a garden on either side
 * of the card.
 */
export function squeezeFor(aspect) {
    const full = Math.tan((EYE.hFov * DEG) / 2);
    return Math.max(0.34, Math.min(1, (halfWidthTan(aspect) / full) * 1.12));
}

/** A unit vector from an azimuth (0 = straight ahead along −z, positive to the right) and an elevation. */
export function skyDirection(azimuth, elevation, out = [0, 0, 0]) {
    const c = Math.cos(elevation);
    out[0] = Math.sin(azimuth) * c;
    out[1] = Math.sin(elevation);
    out[2] = -Math.cos(azimuth) * c;
    return out;
}

/**
 * Where a ray that climbs through the water along `dir` goes on in the air (the flat surface,
 * WINDOW_INDEX): the sun the sky function draws must stand there for its image to sit at the
 * top of the shafts.
 */
export function refractToAir(dir, out = [0, 0, 0]) {
    const cosI = Math.max(0, Math.min(1, dir[1]));
    const k = 1 - WINDOW_INDEX * WINDOW_INDEX * (1 - cosI * cosI);
    if (k <= 0) {
        // Past the window's edge: lay it on the horizon the way it was heading.
        const flat = Math.hypot(dir[0], dir[2]) || 1;
        out[0] = dir[0] / flat;
        out[1] = 0;
        out[2] = dir[2] / flat;
        return out;
    }
    const up = Math.sqrt(k) - WINDOW_INDEX * cosI;
    out[0] = WINDOW_INDEX * dir[0];
    out[1] = WINDOW_INDEX * dir[1] + up;
    out[2] = WINDOW_INDEX * dir[2];
    const n = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= n;
    out[1] /= n;
    out[2] /= n;
    return out;
}

// ── The seabed ──────────────────────────────────────────────────────────────────

function lattice(ix, iz) {
    let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise on the plane, 0..1. */
export function valueNoise(x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = lattice(ix, iz);
    const b = lattice(ix + 1, iz);
    const c = lattice(ix, iz + 1);
    const d = lattice(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Three octaves of it, 0..1. */
export function rollingNoise(x, z) {
    return (valueNoise(x, z) * 4 + valueNoise(x * 2.03 + 17.3, z * 2.03 - 9.1) * 2
        + valueNoise(x * 4.11 - 3.7, z * 4.11 + 21.9)) / 7;
}

/**
 * Coral heads and outcrops: rounded mounds standing out of the reef (stage x, z, radius, height).
 * The first four frame the foot of the picture, one garden to each side of the card.
 */
export const MOUNDS = Object.freeze([
    [-3.9, 4.4, 2.2, 2.4], [4.4, 3.8, 2.5, 2.6], [-9.5, -2.5, 4.2, 2.8], [10.4, -4.5, 4.6, 3.2],
    [-5.6, -12, 2.8, 1.6], [6.4, -17, 3.2, 2.0], [-15, -17, 5.0, 2.4], [17, -21, 5.5, 2.2],
    [-8, -30, 3.6, 1.7], [9.5, -34, 4.0, 2.0],
]);

/** Far pinnacles: columns of rock out in the blue, seen as shapes in the haze. */
export const PINNACLES = Object.freeze([
    [-19, -42, 3.4, 9.5], [15.5, -50, 3.8, 11], [-7.5, -64, 3.2, 8.5], [25, -37, 4.2, 8.5],
    [5, -80, 4.4, 10], [-30, -58, 5.2, 9], [34, -66, 5.5, 10.5],
]);

/** The canyon's middle line wanders a little (stage x at a z). */
export const channelAxis = (z) => 1.4 * Math.sin(z * 0.06 + 0.4);

/** 0 in the sandy channel, 1 up on a reef shoulder (stage space). */
export function shoulderRise(x, z) {
    return smooth(3.4, 14, Math.abs(x - channelAxis(z)));
}

/**
 * Height of the seabed at a stage point. Sand in a channel that runs out from under the viewer
 * and falls away into the blue; a reef shoulder rising to either side (the left one the taller);
 * coral heads at the foot of the picture and pinnacles far out.
 */
export function seabedHeight(x, z) {
    const off = x - channelAxis(z);
    const ax = Math.abs(off);
    const right = off >= 0;
    const out = Math.max(0, -z);
    let h = -0.03 * out - 13 * smooth(58, 105, out);
    const rise = smooth(3.4, 14, ax);
    const crest = right ? 5.4 : 6.6;
    const along = 0.78 + 0.22 * Math.sin(z * 0.09 + (right ? 2.1 : 0.3));
    const sink = 1 - 0.55 * smooth(40, 100, out);
    h += rise * crest * along * sink;
    h += smooth(14, 30, ax) * 1.1 * Math.sin(ax * 0.2 + z * 0.07);
    let lumps = 0;
    for (let i = 0; i < MOUNDS.length; i += 1) {
        const m = MOUNDS[i];
        const dx = x - m[0];
        const dz = z - m[1];
        lumps += m[3] * Math.exp(-(dx * dx + dz * dz) / (m[2] * m[2]));
    }
    for (let i = 0; i < PINNACLES.length; i += 1) {
        const m = PINNACLES[i];
        const dx = x - m[0];
        const dz = z - m[1];
        lumps += m[3] * Math.exp(-(dx * dx + dz * dz) / (m[2] * m[2]));
    }
    h += lumps;
    const rocky = Math.min(1, rise + lumps * 0.5);
    h += (rollingNoise(x * 0.11, z * 0.11) - 0.5) * 1.4 * (0.3 + 0.7 * rocky);
    h += (rollingNoise(x * 0.47 + 9, z * 0.47 - 4) - 0.5) * 0.34 * (0.2 + 0.8 * rocky);
    // Reef rock is not a dune: it stands in crags, and it grows in shelves.
    const crag = 1 - Math.abs(2 * rollingNoise(x * 0.21 + 5, z * 0.21 + 13) - 1);
    h += (crag - 0.55) * 0.9 * rocky;
    const over = h - (-0.03 * out);
    if (over > 0.5 && rocky > 0.05) {
        const shelf = 1.3;
        const level = over / shelf + (rollingNoise(x * 0.07 + 40, z * 0.07 + 3) - 0.5) * 0.9;
        const whole = Math.floor(level);
        const stepped = (whole + smooth(0.5, 0.92, level - whole) - level) * shelf;
        h += stepped * 0.6 * rocky * smooth(0.5, 1.8, over);
    }
    // No rock comes within three metres of the surface: a soft ceiling, continuous in slope.
    const knee = SURFACE - 5;
    if (h > knee) h = SURFACE - 3 - 2 * Math.exp(-(h - knee) / 2);
    return h;
}

/** The seabed's upward normal at a stage point (central differences), into `out`. */
export function seabedNormal(x, z, out = [0, 1, 0], step = 0.2) {
    const dx = (seabedHeight(x + step, z) - seabedHeight(x - step, z)) / (2 * step);
    const dz = (seabedHeight(x, z + step) - seabedHeight(x, z - step)) / (2 * step);
    const n = 1 / Math.hypot(dx, 1, dz);
    out[0] = -dx * n;
    out[1] = n;
    out[2] = -dz * n;
    return out;
}

/**
 * The lowest ground under a footprint: what a broad thing must be seated on so that no part of
 * it hangs in the water on a slope.
 */
export function footprintFloor(x, z, radius) {
    let low = seabedHeight(x, z);
    for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * TAU;
        low = Math.min(low, seabedHeight(x + Math.cos(a) * radius, z + Math.sin(a) * radius));
    }
    return low;
}

/** How much of a stage point is reef rock rather than sand, 0..1. */
export function rockAt(x, z) {
    const rise = shoulderRise(x, z);
    const n = seabedNormal(x, z, [0, 1, 0], 0.35);
    const steep = smooth(0.12, 0.42, 1 - n[1]);
    let lumps = 0;
    for (let i = 0; i < MOUNDS.length; i += 1) {
        const m = MOUNDS[i];
        const dx = x - m[0];
        const dz = z - m[1];
        lumps += Math.exp(-(dx * dx + dz * dz) / (m[2] * m[2] * 0.8));
    }
    const patch = rollingNoise(x * 0.23 + 31, z * 0.23 + 7);
    return clamp01(Math.max(steep, smooth(0.25, 0.7, rise + lumps * 0.9 + (patch - 0.5) * 0.5)));
}

// ── What the board starts: slots and timings ────────────────────────────────────

/** Rings of light over the reef (a lock's light landing, a level's turn). */
export const RING_SLOTS = 10;
/** Metres a second a ring runs at first; it slows as it widens. */
export const RING_SPEED = 6.5;
export const RING_SLOW = 4.5;
/** Seconds a ring lives. */
export const RING_LIVE = 5;

/** A ring's radius at an age (metres). */
export function ringRadius(age, reach = 1) {
    if (!(age > 0)) return 0;
    return reach * RING_SPEED * RING_SLOW * (1 - Math.exp(-age / RING_SLOW)) * 0.42 + 0.25;
}

/** Colonies holding a piece's colour until a clear lets it go. */
export const STAIN_SLOTS = 14;
/** Metres round a stain within which the corals take its colour. */
export const STAIN_REACH = 2.5;
/** Seconds a stain takes to kindle, and to go out once it has been let go. */
export const STAIN_KINDLE = 0.7;
export const STAIN_FADE = 2.6;
/** "Not let go yet", as a time a clock never reaches. */
export const NEVER = 1e9;

/** How brightly a stain burns at `t`: kindling, holding with a slow breath, flaring as it is let go. */
export function stainLight(birth, release, t) {
    const age = t - birth;
    if (!(age > 0)) return 0;
    const up = smooth(0, STAIN_KINDLE, age) * (1 + 1.6 * Math.exp(-age / 0.35));
    if (t < release) return up;
    const gone = t - release;
    return up * (1 + 2.2 * Math.exp(-gone / 0.3)) * (1 - smooth(0, STAIN_FADE, gone));
}

/** Currents a clear sends across the canyon. */
export const SURGE_SLOTS = 4;
/** Metres a second its front crosses the picture, and where it starts (stage x, off the frame). */
export const SURGE_SPEED = 11;
export const SURGE_START = 30;
/** Metres either side of the front in which things lean. */
export const SURGE_WIDTH = 9;
export const SURGE_LIVE = 9;

/** Where a surge's front is at an age: stage x, travelling toward `dir` (±1). */
export const surgeFront = (age, dir) => dir * (age * SURGE_SPEED - SURGE_START);

/** When a surge born at `birth` reaches a stage x. */
export const surgePassTime = (birth, dir, x) => birth + (x * dir + SURGE_START) / SURGE_SPEED;

/** Startles: points the fish dart away from. */
export const SCARE_SLOTS = 6;
export const SCARE_LIVE = 3.2;
/** Metres a second a startle spreads through the fish. */
export const SCARE_SPREAD = 14;

/** How far out of its way a fish is at `age` seconds after a startle reached it: a dart, a held breath, a slow return. */
export function scareEnvelope(age) {
    if (!(age > 0)) return 0;
    return (1 - Math.exp(-age / 0.07)) * Math.exp(-Math.max(0, age - 0.35) / 0.8);
}

/** Songs: shells of light a whale sends through the water. */
export const SONG_SLOTS = 3;
export const SONG_SPEED = 13;
export const SONG_LIVE = 5;

/** A four-line clear holds the sea's breath this long before the light comes down. */
export const HUSH_HOLD = 0.32;
/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const SURGE_COOL = 3.8;
/** Seconds the school winds round the board after a four-line clear. */
export const VORTEX_HOLD = 6.5;
/** Seconds a level's turn of the hour takes. */
export const HOUR_TURN = 3.6;

/** 0..1: the reef's charge at a combo (rises quickly, never quite arrives). */
export function powerForCombo(combo) {
    const n = Math.max(0, Number(combo) || 0);
    return 1 - Math.exp(-n / 3.6);
}

/**
 * Which of the large animals a chain has called in. Each step of the chain past a threshold
 * sends one more on its way; they finish their pass whether or not the chain holds.
 */
export const CALLS = Object.freeze({
    turtle: 2, mantas: 3, whaleFar: 5, whale: 7,
});

/** How many mantas fly at a combo (0..3). */
export const mantasForCombo = (combo) => Math.max(0, Math.min(3, Math.round(combo) - CALLS.mantas + 1));

// ── The silver school ───────────────────────────────────────────────────────────

/** Radians of the loop the school is strung out over at rest. */
export const SCHOOL_SPAN = 0.95;
/** Radians a second the school runs its loop at rest. */
export const SCHOOL_PACE = 0.17;

/**
 * The school's resting shape: (how wide the loop is in x, its mean height, how far it swings in
 * y, the z it circles, how far it swings in z). A clear draws it out into a ribbon at the cleared
 * rows' height; the world eases between shapes and the shaders read them as one uniform row.
 */
export const SCHOOL_REST = Object.freeze({
    wide: 10.5, high: 6.6, swing: 1.5, back: -15, deep: 8,
});

/**
 * Where the school's middle is at a phase of its loop: a slow figure through the canyon's
 * mid-water. `shape` as SCHOOL_REST; `squeeze` draws it in with the stage.
 */
export function schoolLoop(phase, shape = SCHOOL_REST, squeeze = 1, out = [0, 0, 0]) {
    out[0] = Math.sin(phase) * shape.wide * squeeze;
    out[1] = shape.high + Math.sin(phase + 1.1) * shape.swing + Math.sin(phase * 2.3) * shape.swing * 0.35;
    out[2] = shape.back + Math.sin(phase * 2 + 0.6) * shape.deep + Math.cos(phase) * 5;
    return out;
}

/** The ring the school winds round the board after a four-line clear: (radius, the z of its middle). */
export const VORTEX = Object.freeze({
    radius: 5.6, z: 0.5, low: 0.8, tall: 9.5,
});

// ── The large animals ───────────────────────────────────────────────────────────

/**
 * Seconds a pass the board calls takes through the canyon. (The sea's own visitors keep their
 * own times and routes: ocean-visits.js.)
 */
export const PASS_SECONDS = Object.freeze({
    turtle: 30, manta: 26, whale: 34, whaleFar: 46,
});

/**
 * A pass: a slow arc across the canyon from one side of the frame to the other.
 * `k` = 0..1 through the pass; `lane` = { side (±1 where it comes from), z, y, bow, reach }.
 * Writes the place (x, y, z) and the heading (yaw about y, 0 = along −z; pitch) into `out`.
 */
export function passAt(k, lane, squeeze = 1, out = {}) {
    const s = clamp01(k);
    const sweep = (s - 0.5) * 2;
    const reach = lane.reach * Math.max(0.6, squeeze);
    const x = -lane.side * sweep * reach;
    // It comes in from behind the far shoulder, bows toward the viewer mid-way, and goes out deep.
    const z = lane.z + lane.bow - (lane.bow + 4) * sweep * sweep;
    const y = lane.y + Math.sin(s * Math.PI) * lane.lift + Math.sin(s * 9) * 0.25;
    const dx = -lane.side * 2 * reach;
    const dz = -4 * (lane.bow + 4) * sweep;
    const dy = Math.cos(s * Math.PI) * Math.PI * lane.lift + Math.cos(s * 9) * 2.25;
    out.x = x;
    out.y = y;
    out.z = z;
    // Heading: yaw 0 looks along −z, positive turns toward +x.
    out.yaw = Math.atan2(dx, -dz);
    out.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    out.bank = -lane.side * lane.bow * sweep * 0.02;
    return out;
}

/** The lanes the animals the board calls keep. */
export const LANES = Object.freeze({
    turtle: Object.freeze({
        side: -1, z: -4, y: 4.6, bow: 5, reach: 30, lift: 1.4,
    }),
    manta: Object.freeze({
        side: 1, z: -13, y: 10.2, bow: 6, reach: 38, lift: 1.2,
    }),
    whale: Object.freeze({
        side: -1, z: -15, y: 9.6, bow: 8.5, reach: 44, lift: 1.2,
    }),
    whaleFar: Object.freeze({
        side: 1, z: -30, y: 11.4, bow: 4, reach: 80, lift: 0.5,
    }),
});

// ── Colour ──────────────────────────────────────────────────────────────────────

/** sRGB hex (number or '#rrggbb') → scene-linear [r, g, b]. */
export function linRGB(hex) {
    const n = typeof hex === 'string' ? Number.parseInt(hex.replace('#', ''), 16) : hex;
    const lin = (c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

/**
 * A piece's colour as light: scene-linear, its brightest channel lifted to 1 and a little white
 * kept in it, so a dark blue piece still lights the reef. Anything that is not a colour gives
 * the fallback.
 */
export function pieceColor(value, fallback = 0x39d9e8) {
    let rgb = null;
    if (typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value)) rgb = linRGB(value);
    else if (Number.isFinite(value)) rgb = linRGB(Math.max(0, Math.min(0xffffff, Math.round(value))));
    else if (Array.isArray(value) && value.length >= 3 && value.every((c) => Number.isFinite(c))) {
        rgb = [Math.max(0, value[0]), Math.max(0, value[1]), Math.max(0, value[2])];
    }
    if (!rgb) rgb = linRGB(fallback);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    return rgb.map((c) => (c / peak) * 0.92 + 0.08);
}

// ── The floor the large animals keep over ───────────────────────────────────────

/** Where the floor grid lies (metres, world frame) and how fine it is. */
export const FLOOR_GRID = Object.freeze({
    x0: -105, x1: 105, z0: -140, z1: 20, step: 2.5,
});

/**
 * The sand's height on a grid over everything the large animals swim across, a little raised and
 * eased (each point the higher of its own height and its neighbours' mean, so a pinnacle's top is
 * kept while the creases between cells are softened). seabedHeight costs microseconds a call; the
 * routes ask hundreds of times a frame, so they read this instead (floorAt). Baked once per page
 * (in the bake worker on a first visit).
 * @returns {{ nx: number, nz: number, h: Float32Array }}
 */
export function bakeFloor() {
    return bakeOnce('ocean:floor', () => {
        const {
            x0, x1, z0, z1, step,
        } = FLOOR_GRID;
        const nx = Math.round((x1 - x0) / step) + 1;
        const nz = Math.round((z1 - z0) / step) + 1;
        const raw = new Float32Array(nx * nz);
        for (let j = 0; j < nz; j++) {
            for (let i = 0; i < nx; i++) raw[j * nx + i] = seabedHeight(x0 + i * step, z0 + j * step);
        }
        const h = new Float32Array(nx * nz);
        for (let j = 0; j < nz; j++) {
            for (let i = 0; i < nx; i++) {
                let sum = 0;
                let n = 0;
                for (let dj = -1; dj <= 1; dj++) {
                    for (let di = -1; di <= 1; di++) {
                        const a = i + di;
                        const b = j + dj;
                        if (a >= 0 && a < nx && b >= 0 && b < nz) {
                            sum += raw[b * nx + a];
                            n += 1;
                        }
                    }
                }
                h[j * nx + i] = Math.max(raw[j * nx + i], sum / n) + 0.6;
            }
        }
        return { nx, nz, h };
    });
}

/** The floor at (x, z): bilinear on the baked grid (out past its edge: its edge). */
export function floorAt(x, z) {
    const { nx, nz, h } = bakeFloor();
    const { x0, z0, step } = FLOOR_GRID;
    const fx = Math.max(0, Math.min(nx - 1.0001, (x - x0) / step));
    const fz = Math.max(0, Math.min(nz - 1.0001, (z - z0) / step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = h[j * nx + i];
    const b = h[j * nx + i + 1];
    const c = h[(j + 1) * nx + i];
    const d = h[(j + 1) * nx + i + 1];
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

// ── The seabed's sheet ────────────────────────────────────────────────────────────

/** The sheet's reach in stage space: x either way, z toward the viewer and out to sea. */
export const SEABED_SPAN = Object.freeze({ x: 54, near: 15, far: -118 });

/** The bake cache's key for a seabed sheet at a detail (share of the full 160 × 200 grid). */
export const seabedKey = (detail) => `ocean:seabed:${detail}`;

/**
 * The seabed's sheet as vertex data, a pure function of its detail (kept in the bake cache, and
 * baked in a worker on a first visit): positions on the ground, its normals, and per vertex the
 * rock (x) and how open the ground round it stands (y; a hollow is darker than a crown).
 * @param {number} [detail=1]
 * @returns {{ nx: number, nz: number, position: Float32Array, normal: Float32Array, ground: Float32Array, index: Uint32Array }}
 */
export function bakeSeabed(detail = 1) {
    return bakeOnce(seabedKey(detail), () => computeSeabed(detail));
}

function computeSeabed(detail) {
    const nx = Math.max(24, Math.round(160 * detail));
    const nz = Math.max(30, Math.round(200 * detail));
    const xs = new Float32Array(nx + 1);
    const zs = new Float32Array(nz + 1);
    for (let i = 0; i <= nx; i++) {
        const s = (i / nx) * 2 - 1;
        const a = Math.abs(s);
        xs[i] = SEABED_SPAN.x * Math.sign(s) * (0.35 * a + 0.65 * a ** 2.2);
    }
    for (let j = 0; j <= nz; j++) {
        const t = j / nz;
        zs[j] = SEABED_SPAN.near + (SEABED_SPAN.far - SEABED_SPAN.near) * (0.3 * t + 0.7 * t * t);
    }
    const count = (nx + 1) * (nz + 1);
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const ground = new Float32Array(count * 2);
    const n = [0, 1, 0];
    for (let j = 0; j <= nz; j++) {
        for (let i = 0; i <= nx; i++) {
            const o = j * (nx + 1) + i;
            const x = xs[i];
            const z = zs[j];
            const h = seabedHeight(x, z);
            position.set([x, h, z], o * 3);
            seabedNormal(x, z, n);
            normal.set(n, o * 3);
            // A hollow is darker than a crown: how far the ground round a point stands over it.
            const round = (seabedHeight(x + 1.4, z) + seabedHeight(x - 1.4, z)
                + seabedHeight(x, z + 1.4) + seabedHeight(x, z - 1.4)) / 4;
            ground[o * 2] = rockAt(x, z);
            ground[o * 2 + 1] = clamp01(1 - (round - h) * 0.7) * 0.55 + 0.45;
        }
    }
    const index = new Uint32Array(nx * nz * 6);
    let k = 0;
    for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
            const a = j * (nx + 1) + i;
            const b = a + 1;
            const c = a + nx + 1;
            const d = c + 1;
            // (z runs away from the viewer as j grows: wound so the faces look up.)
            index.set([a, b, c, b, d, c], k);
            k += 6;
        }
    }
    return {
        nx, nz, position, normal, ground, index,
    };
}
