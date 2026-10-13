/**
 * High Coast — renderer-free constants and maths (three-free, DOM-free).
 *
 * The world: an eye on a bare granite summit of Sweden's High Coast (Höga Kusten), looking out
 * over a fjord-like bay to an archipelago of pine islands, a sheer rapakivi cliff on the left,
 * a fishing hamlet on the right shore, the open Bothnian Sea toward the low sun. Metres; x right,
 * y up, z toward the eye (the view looks down −z); the sea stands at y = 0 at rest.
 *
 * The coast is the world's highest: since the ice left it 9,600 years ago the land has risen
 * some 286 m out of the sea, and it still rises. Gameplay is that rebound, sped up: every line
 * cleared lifts the land (the sea draws back, wet rock and skerries come up out of it), a chain
 * compounds the lift, and between bursts the sea slowly returns. This module owns the geometry
 * everything shares (eye, fields, rig, landmarks), the lift's arithmetic, the piece codes the
 * director deals in, and small maths.
 */

// ── Maths ─────────────────────────────────────────────────────────────────────────

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
export const clamp01 = (v) => clamp(v, 0, 1);
export const clampInt = (v, lo, hi) => Math.round(clamp(v, lo, hi));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Fraction of the way to a target after dt at an exponential rate. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Hermite step between two edges (a step at lo when the edges are equal). */
export function smooth(lo, hi, v) {
    if (hi === lo) return v < lo ? 0 : 1;
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** Small, fast, deterministic PRNG (returns a function giving floats in [0, 1)). */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const srgbChannelToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** An sRGB hex ('#RRGGBB') as linear RGB in 0..1 (black for anything else). */
export function hexToLinear(hex, out = [0, 0, 0]) {
    const m = typeof hex === 'string' ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
    if (!m) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        return out;
    }
    const n = parseInt(m[1], 16);
    out[0] = srgbChannelToLinear(((n >> 16) & 255) / 255);
    out[1] = srgbChannelToLinear(((n >> 8) & 255) / 255);
    out[2] = srgbChannelToLinear((n & 255) / 255);
    return out;
}

// ── The view ──────────────────────────────────────────────────────────────────────

/** The eye stands on the granite summit, its rock a few metres below (y = 0 is the sea at rest). */
export const EYE = Object.freeze({ x: 0, y: 152, z: 0 });

/**
 * Rest rig (degrees). Landscape looks down across the bay with the horizon in the upper third;
 * a wide screen narrows the lens. Portrait looks level and turned toward the sun with the lens
 * shifted (`shift`, in screen heights × 2) so the horizon sits just above the card: the sun and its
 * sky in the strip above it, sea and islands in the margins, the summit's rock below.
 */
export const RIG = Object.freeze({
    landscape: Object.freeze({ fov: 40, yaw: 0, pitch: -8.5 }),
    wide: Object.freeze({ fov: 34, yaw: 0, pitch: -8 }),
    portrait: Object.freeze({
        fov: 66, yaw: 14, pitch: 0, shift: 0.76, clearPine: true,
    }),
    near: 1.2,
    far: 70000,
});

/** The lens for an aspect ratio. */
export function rigFor(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    if (a < 0.75) return RIG.portrait;
    if (a > 2.1) return RIG.wide;
    return RIG.landscape;
}

/**
 * The three baked heightfields, nested (metres). Each is a square grid of `size` posts over
 * [x0, x0 + span] × [z0, z0 + span]; a point is read from the finest field that holds it.
 * `lo`/`hi` bound its heights (the textures store (h − lo) / (hi − lo)). The sea floor is part
 * of the land: the bay's shelves and skerries are what the rising land brings up.
 */
export const FIELDS = Object.freeze({
    near: Object.freeze({
        name: 'near', x0: -1250, z0: -2400, span: 2500, size: 1024, lo: -70, hi: 270,
    }),
    mid: Object.freeze({
        name: 'mid', x0: -4800, z0: -8600, span: 10000, size: 1024, lo: -90, hi: 380,
    }),
    far: Object.freeze({
        name: 'far', x0: -26000, z0: -46000, span: 52000, size: 512, lo: -330, hi: 620,
    }),
});
export const FIELD_ORDER = Object.freeze(['near', 'mid', 'far']);

/** Width (metres) of the band at a field's edge where it hands over to the next one out. */
export const FIELD_BLEND = Object.freeze({ near: 140, mid: 600, far: 0 });

/** Earth's curvature drops a far point by d² / 2R (with the usual refraction allowance). */
export const EARTH_DROP = 1 / (2 * 6371000 * 1.15);

/**
 * Landmarks (metres). The old pine and the trail sign stand on the summit knoll left of the eye;
 * the cliff is the headland's sheer east face; the hamlet's red cottages and boathouses sit on a
 * low point of the right shore; the lighthouse crowns a steep far island.
 */
export const PLACES = Object.freeze({
    pine: Object.freeze({ x: -8.5, z: -19 }),
    sign: Object.freeze({ x: -4.2, z: -12.6 }),
    cliff: Object.freeze({ x: -470, z: -980 }),
    hamlet: Object.freeze({ x: 178, z: -512, radius: 62 }),
    lighthouse: Object.freeze({ x: 1880, z: -5350 }),
});

/** Bearing (degrees right of the view axis) and distance of a point from the eye. */
export function bearingOf(x, z) {
    const dx = x - EYE.x;
    const dz = z - EYE.z;
    return { bearing: Math.atan2(dx, -dz) / DEG, distance: Math.hypot(dx, dz) };
}

/**
 * The old pine in the frame (bearings in degrees, + = right): its trunk, and the right-hand reach
 * of its crown (the rebuilt crown reaches +2.9°; high-coast-pine.test.js keeps it inside this). `margin` covers the lens's breath and the
 * pointer's parallax with room to spare.
 */
export const PINE_FRAME = Object.freeze({ trunk: bearingOf(PLACES.pine.x, PLACES.pine.z).bearing, crown: 3.5, margin: 2.5 });

/**
 * The rest yaw for a lens at an aspect: never one whose left edge cuts the old pine's crown off
 * its trunk. A lens too narrow to hold the trunk turns left just far enough to bring it in; a
 * rig that faces the sun (`clearPine`) turns right instead until the crown is out of frame.
 */
export function frameYaw(rig, aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const half = Math.atan(Math.tan((rig.fov * DEG) / 2) * a) / DEG;
    const edge = rig.yaw - half;
    const hold = PINE_FRAME.trunk - PINE_FRAME.margin;
    const clear = PINE_FRAME.crown + PINE_FRAME.margin;
    if (edge <= hold || edge >= clear) return rig.yaw;
    return (rig.clearPine ? clear : hold) + half;
}

// ── The rising land ───────────────────────────────────────────────────────────────

/**
 * The rebound's arithmetic. `ask` is how far the sea has been asked to draw back (metres below
 * rest); the shown lift eases toward it. A clear adds a step that grows with the chain and shrinks
 * as the lift nears its ceiling; between clears the sea slowly returns.
 */
export const UPLIFT = Object.freeze({
    /** Metres per cleared line. */
    perLine: 2.4,
    /** Each link of a chain adds this share to a clear's step (up to `chainCap` links). */
    perLink: 0.3,
    chainCap: 6,
    /** Four lines add this on top: the great rebound. */
    quadBonus: 6,
    /** The lift approaches this ceiling (each step shrinks with what is left below it). */
    ceiling: 30,
    /** The sea returns with this time constant (seconds) at rest… */
    relax: 48,
    /** …and this one while a released chain's swell runs in. */
    release: 7,
    /** The shown lift follows the asked one over about this long (seconds). */
    ease: 0.55,
});

/** A clear's step: lines (1..4) at chain length `chain` (1 = no chain). */
export function upliftStep(lines, chain = 1) {
    const n = clampInt(lines, 1, 4);
    const links = clamp(Math.round(chain) - 1, 0, UPLIFT.chainCap);
    return n * UPLIFT.perLine * (1 + UPLIFT.perLink * links) + (n === 4 ? UPLIFT.quadBonus : 0);
}

/** The asked lift after a step: approaches the ceiling, never passes it. */
export function liftAfter(ask, step) {
    const a = clamp(ask, 0, UPLIFT.ceiling);
    return Math.min(UPLIFT.ceiling, a + Math.max(0, step) * (1 - a / UPLIFT.ceiling));
}

/** The asked lift after dt seconds of the sea returning with time constant tau. */
export function relaxLift(ask, dt, tau = UPLIFT.relax) {
    return Math.max(0, ask) * Math.exp(-Math.max(0, dt) / Math.max(0.1, tau));
}

// ── Pieces ────────────────────────────────────────────────────────────────────────

export const PIECE_CODE = Object.freeze({
    I: 0, T: 1, Z: 2, L: 3, S: 4, J: 5, O: 6, GARBAGE: 7,
});
export const PIECE_ORDER = Object.freeze(['I', 'T', 'Z', 'L', 'S', 'J', 'O', 'GARBAGE']);
/** The board's piece colours by code (high-coast-tetrominos.js carries the same table). */
export const PIECE_COLORS = Object.freeze(['#3B78E0', '#F59A2E', '#D7EA6A', '#1E8C6E', '#C44AA0', '#F2B4A2', '#B5322A', '#363C45']);

export function pieceCode(shape) {
    if (typeof shape !== 'string') return PIECE_CODE.GARBAGE;
    const key = shape.trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(PIECE_CODE, key) ? PIECE_CODE[key] : PIECE_CODE.GARBAGE;
}

/**
 * A piece matrix as 4 cell offsets (8 numbers, x right, y up), centred on its bounding box.
 * Returns null for anything that is not a matrix with at least one filled cell.
 */
export function cellsFromMatrix(matrix) {
    if (!Array.isArray(matrix)) return null;
    const cells = [];
    for (let r = 0; r < matrix.length && r < 8; r++) {
        const row = matrix[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length && c < 8; c++) {
            if (Number(row[c]) > 0 && cells.length < 8) cells.push(c, -r);
        }
    }
    if (!cells.length) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < cells.length; i += 2) {
        minX = Math.min(minX, cells[i]);
        maxX = Math.max(maxX, cells[i]);
        minY = Math.min(minY, cells[i + 1]);
        maxY = Math.max(maxY, cells[i + 1]);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const out = new Array(8);
    for (let i = 0; i < 8; i += 2) {
        const j = i < cells.length ? i : 0;
        out[i] = cells[j] - cx;
        out[i + 1] = cells[j + 1] - cy;
    }
    return out;
}

/** The pieces in their spawn orientation (the game's own matrices). */
export const SHAPES = Object.freeze({
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]],
});
export const SHAPE_KEYS = Object.freeze(Object.keys(SHAPES));

// ── Timings (seconds) ─────────────────────────────────────────────────────────────

export const TIMING = Object.freeze({
    /** One hour of light per this many seconds of theme clock (the wheel's clock term). */
    hour: 100,
    /** Share of an hour step the light rests on the hour's own palette, at each end. */
    hourRest: 0.15,
    /** A level-up's turn of the wheel eases over this long. */
    levelTurn: 5,
    /** Newly risen rock stays wet this long (time constant of the drying line). */
    dry: 16,
    /** The sea runs off the risen rock in streams for this long after a lift. */
    drain: 4.5,
    /** A lock's gust runs across the water for this long. */
    gust: 3.2,
    /** A spinnaker stays set this long after its lock, then is doused. */
    spinnaker: 24,
    /** T-spin: the fleet comes about over this long. */
    tack: 3.4,
    /** Perfect clear: the sea lies glass-calm this long, then the breeze returns over the next. */
    calmHold: 8,
    calmReturn: 5,
    /** A released chain's swell runs in for this long. */
    swell: 9,
    /** Game over: the light falls to dusk over this long, and returns over this long. */
    dusk: 6,
    dawn: 4,
    /** Without play the chain is forgotten after this long. */
    idle: 90,
});
