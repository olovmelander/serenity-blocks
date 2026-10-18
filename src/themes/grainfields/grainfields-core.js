/**
 * Grainfields — renderer-free constants and maths (three-free, DOM-free).
 *
 * The world: grain country in the north, at harvest. The eye stands low in a field of ripe barley
 * (the ears round it fill the bottom of the frame, and the field rises to a crest a hundred metres
 * out whose ears stand at the eye's own height) and looks west over it to shelterbelts of larch,
 * spruce and birch, a stone fort's knoll, forested ridges and, filling the left of the sky,
 * Lapporten: the Lapland gate, two fells with a glacial U cut clean between them. A storm deck
 * hangs over everything and is breaking: the sun comes through its gaps (and through the gate) in
 * shafts that walk across the land. Metres; x right, y up, z toward the eye (the view looks down
 * −z); the vale's floor lies near y = 0.
 *
 * Gameplay is that light and the wind in the grain (grainfields-reactions.js): a lock tears a gap
 * in the deck and a sunbeam stands in the barley beside the card, a clear sends a lane of wind
 * running out across the field, a chain breaks the storm open, a T-spin wheels the wind in the
 * stand, four lines tear the sky open over the gate. This module owns the geometry everything
 * shares (eye, rig, landmarks), the piece codes the director deals in, timings and small maths.
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

/**
 * The eye stands in the barley, a man's height over the field (the ground under the eye is
 * `EYE.ground`): low, so the ears round it fill the bottom of the frame and the field rises to a
 * crest a hundred metres out whose ears stand at the eye's own height. Everything between the
 * crest and the far foothills lies below that line: the field is barley all the way to its
 * horizon, never a flat floor.
 */
export const EYE = Object.freeze({
    x: 0, y: 11.95, z: 0, ground: 10.5,
});

/**
 * The near field's crest (metres): its distance from the eye (swaying with the bearing by `sway`),
 * how far its ground rises over the eye's (`rise`; with the barley on it, its ears reach the
 * eye's height), and where the far land takes over behind it.
 */
export const CREST = Object.freeze({
    distance: 94, sway: 14, rise: 1.25, behind: 2.3,
});

/**
 * Rest rig (degrees). Landscape looks out level and a touch up, so the barley fills the bottom
 * of the frame up to the crest and the fells and the storm fill the sky. A wide screen narrows
 * the lens. Portrait looks up and turns left toward the gate, its lens shifted (`shift`,
 * screen heights × 2) so the summit and the sun's gap stand in the strip above the card.
 */
export const RIG = Object.freeze({
    landscape: Object.freeze({ fov: 44, yaw: -2, pitch: 1.4 }),
    wide: Object.freeze({ fov: 36, yaw: -2, pitch: 1.2 }),
    /** A near-square screen: a wider lens turned toward the gate, so its U stays in the frame. */
    square: Object.freeze({ fov: 54, yaw: -9, pitch: 2.4 }),
    portrait: Object.freeze({
        fov: 70, yaw: -12, pitch: 6, shift: 0.62,
    }),
    near: 0.2,
    far: 90000,
});

/** The lens for an aspect ratio. */
export function rigFor(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    if (a < 0.75) return RIG.portrait;
    if (a < 1.25) return RIG.square;
    if (a > 2.1) return RIG.wide;
    return RIG.landscape;
}

/** Bearing (degrees right of the view axis) and distance of a point from the eye. */
export function bearingOf(x, z) {
    const dx = x - EYE.x;
    const dz = z - EYE.z;
    return { bearing: Math.atan2(dx, -dz) / DEG, distance: Math.hypot(dx, dz) };
}

/** A point at a bearing (degrees right of the view axis) and distance from the eye, as [x, z]. */
export function pointAt(bearing, distance, out = [0, 0]) {
    out[0] = EYE.x + Math.sin(bearing * DEG) * distance;
    out[1] = EYE.z - Math.cos(bearing * DEG) * distance;
    return out;
}

/**
 * Landmarks (metres).
 *  - gate: Lapporten, the U-shaped gate through the fells: the middle of its floor at the gate's
 *    line (x, z); the fells' shape is grainfields-lapporten.js;
 *  - fort: the stone fort on its knoll in the vale (knoll height, radius);
 *  - herd: where the horses graze, right of the view below the score card;
 */
export const PLACES = Object.freeze({
    gate: Object.freeze({ x: -4300, z: -11203 }),
    fort: Object.freeze({
        x: -410, z: -1350, height: 46, radius: 120,
    }),
    herd: Object.freeze({ x: 20, z: -41, radius: 14 }),
});

/** The cloud deck's base (metres): the storm hangs over the fells' summits. */
export const DECK = Object.freeze({ base: 3300, top: 4800 });

// ── Pieces ────────────────────────────────────────────────────────────────────────

export const PIECE_CODE = Object.freeze({
    I: 0, T: 1, Z: 2, L: 3, S: 4, J: 5, O: 6, GARBAGE: 7,
});
export const PIECE_ORDER = Object.freeze(['I', 'T', 'Z', 'L', 'S', 'J', 'O', 'GARBAGE']);
/**
 * The board's piece colours by code: the seven mineral pigments of a gold-leaf folding screen of
 * autumn fields (grainfields-tetrominos.js carries the same table): I gold leaf, T malachite,
 * Z violet, L rose madder, S azurite, J shell white, O vermilion.
 */
export const PIECE_COLORS = Object.freeze(['#E9B53B', '#25A26B', '#9356D8', '#D7356E', '#3A6CE2', '#F2EDE1', '#E5482C', '#2E3238']);

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
    /**
     * The wheel's clock term: from one station of the day to the next per this many seconds of
     * theme clock (the light is on its way between them all the time; it never rests).
     */
    hour: 100,
    /** A level-up's turn of the wheel eases over this long. */
    levelTurn: 5,
    /** A lock's gap in the deck: it tears open over `open`, stands, and closes by `life`. */
    gapOpen: 1.1,
    gapLife: 34,
    /** A clear's trail of wind runs out across the field over this long. */
    trail: 5.5,
    /** The storm breaks with a chain over this long, and closes again over this long. */
    breakIn: 3,
    breakOut: 22,
    /** Four lines: the tear over the gate opens over `tearIn` and closes by `tearLife`. */
    tearIn: 1.6,
    tearLife: 18,
    /** Perfect clear: the sky stays clear this long, then the deck returns over the next. */
    clearHold: 14,
    clearReturn: 10,
    /** T-spin: the herd wheels for this long. */
    wheel: 9,
    /** Game over: the light falls over this long, and returns over this long. */
    dusk: 6,
    dawn: 4,
    /** Without play the chain is forgotten after this long. */
    idle: 90,
});
