/**
 * Kaleidosonic — renderer-free constants and maths (three-free, DOM-free).
 *
 * The world is the shape of a sound: a temple of folded light ray-marched from a net of pearls
 * strung on threads, its stone veined with the glowing nodal lines of standing waves (cymatics).
 * Every piece that locks strikes a note: a spherical wavefront rings out from the place the piece
 * maps to, lighting the stone it crosses in the piece's colour and leaving ripples at the note's
 * own wavelength. A line clear sounds a harmonic (the temple's nodal lines light at a mode set by
 * the lines cleared) and the architecture refolds; a chain deepens the trance (the net grows
 * finer and the lens folds into a kaleidoscope); four lines dive one period down the net's own
 * lattice.
 *
 * This module owns what the director, the world, the playground and the tests share: maths, the
 * piece codes and notes, the mood wheel's colours, and the event timings. Units are the net's own
 * (its knots stand two units apart).
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

/** Saturation (max − min over max) of a linear colour: the tests keep every mix colourful. */
export function chroma(rgb) {
    const hi = Math.max(rgb[0], rgb[1], rgb[2]);
    const lo = Math.min(rgb[0], rgb[1], rgb[2]);
    return hi > 0 ? (hi - lo) / hi : 0;
}

/** Hue in degrees (0..360) of a colour, or -1 for a grey. */
export function hueOf(rgb) {
    const [r, g, b] = rgb;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mx - mn < 1e-6) return -1;
    const d = mx - mn;
    let h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60 + 360) % 360;
}

// ── Pieces ────────────────────────────────────────────────────────────────────────

export const PIECE_CODE = Object.freeze({
    I: 0, T: 1, Z: 2, L: 3, S: 4, J: 5, O: 6, GARBAGE: 7,
});
export const PIECE_ORDER = Object.freeze(['I', 'T', 'Z', 'L', 'S', 'J', 'O', 'GARBAGE']);
/** The board's piece colours by code (kaleidosonic-tetrominos.js carries the same table). */
export const PIECE_COLORS = Object.freeze([
    '#FF8A45', '#15A05A', '#2EE6D0', '#5AB0FF', '#E8329E', '#FFD23F', '#7B4DFF', '#2E2440',
]);

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

/**
 * Each piece is a note: the wavelength of the ripples its strike leaves on the stone (the net's
 * units; the long I rings highest, the square O lowest) and the pitch's own speed of sound.
 * Indexed by piece code.
 */
export const NOTES = Object.freeze([
    { piece: 'I', wavelength: 0.034, speed: 1.15 },
    { piece: 'T', wavelength: 0.041, speed: 1.1 },
    { piece: 'Z', wavelength: 0.047, speed: 1.06 },
    { piece: 'L', wavelength: 0.053, speed: 1.02 },
    { piece: 'S', wavelength: 0.059, speed: 0.98 },
    { piece: 'J', wavelength: 0.066, speed: 0.95 },
    { piece: 'O', wavelength: 0.078, speed: 0.9 },
    { piece: 'GARBAGE', wavelength: 0.09, speed: 0.85 },
]);

// ── The temple ────────────────────────────────────────────────────────────────────

/**
 * The temple is the strung net (Indra's net): pearls strung on threads, and the whole net seen
 * again, bent, round every knot.
 *
 * The net itself is plain: a knot pearl at every lattice point (PERIOD apart on every axis) and a
 * straight thread along every lattice line between them. A point's place in it is found by
 * folding: each coordinate becomes its distance to the nearest lattice plane (a mirror in every
 * face of the cell), which lands the point in one corner cell with its knot at the origin.
 *
 * Then the net is drawn into itself. An inversion in the sphere of radius sqrt(s) round the knot
 * turns the cell inside out: what lies near the knot is thrown far out across the lattice, so the
 * space near every knot holds a small bent image of the whole net beyond it (pearls stay round,
 * straight threads become arcs through the knot). Folding the thrown point finds its place in
 * the net again, and the next inversion draws the net into that image in turn. The temple is
 * every point whose path of folds and inversions ever touches a pearl or a thread: the net,
 * its image round each knot, the images' images. `s` is the inversion's strength (its radius
 * squared): the clears refold the temple by moving it, which slides the strung pearls along
 * their threads and swells or tightens the arcs.
 */
export const TEMPLE = Object.freeze({
    period: 2,
    /** The inversion's strength at rest and its bounds (the refolds walk between them). */
    s: 1.15,
    sMin: 1.04,
    sMax: 1.36,
    /** Inversions the net is drawn through at rest / at the deepest trance (fractional counts blend). */
    detailRest: 3,
    detailDeep: 5,
});

/**
 * The net's own measures, in the cell's units (a knot to the middle of its thread is 1).
 *
 *   pearl   a knot pearl's radius. Large enough that every fine image crowding a knot is inside
 *           the pearl (what shows beyond its surface is at least pearl^2 / s the size of what
 *           made it: nothing under a pixel two images down), small enough that its own image
 *           never turns inside out over the hall (pearl < sMin / sqrt(3)).
 *   thread  a thread's radius.
 *   ease    how the reach to the net is eased before it is scaled back to the hall (see
 *           templeDistance): 1 / (1 + ease * reach).
 */
export const NET = Object.freeze({
    pearl: 0.45,
    thread: 0.03,
    ease: 2.5,
});
/** A pearl's colour gives way to its thread's over this much of their reaches' difference. */
export const NET_JOIN = 0.02;

/** A fold weight this close to 0 or 1 is taken as whole (the surface moves far less than a pixel). */
export const FOLD_SNAP = 0.004;

/**
 * A fractional fold count as the shader runs it: [whole folds, the next fold's weight]. Near-whole
 * counts snap, so the field never runs a fold it would weigh by (almost) nothing: the trance's
 * exponential release otherwise leaves a weight of 1e-5 that costs a whole fold per evaluation.
 */
export function foldSplit(folds, out = [0, 0]) {
    let whole = Math.floor(folds);
    let weight = folds - whole;
    if (weight < FOLD_SNAP) {
        weight = 0;
    } else if (weight > 1 - FOLD_SNAP) {
        whole += 1;
        weight = 0;
    }
    out[0] = whole;
    out[1] = weight;
    return out;
}

/**
 * The gem's facets: the six axes of the icosahedron (both ends: twelve facets), tilted a little so
 * no beam runs straight along the lattice's threads. Each facet throws its light out as
 * a narrow beam (kaleidosonic-light.js); the gem turns about the vertical, so the beams sweep the
 * halls.
 */
const PHI = (1 + Math.sqrt(5)) / 2;
const BEAM_TILT = 0.31;
export const BEAM_AXES = Object.freeze([[0, 1, PHI], [0, 1, -PHI], [1, PHI, 0], [1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1]]
    .map((a) => {
        const l = Math.hypot(a[0], a[1], a[2]);
        const [x, y, z] = [a[0] / l, a[1] / l, a[2] / l];
        // tilted about the x axis
        const c = Math.cos(BEAM_TILT);
        const s = Math.sin(BEAM_TILT);
        return Object.freeze([x, y * c - z * s, y * s + z * c]);
    }));
/** A beam's sharpness: its light halves about 8° off its axis. */
export const BEAM_K = 70;

/**
 * The refolds a clear walks through, in order: each clear springs `s` to the next value (a chain
 * walks further). A weak inversion keeps the strung pearls small and close to their knots, the
 * threads between them bare; a strong one slides them out along the threads and swells the arcs
 * into lace round every knot. Chosen so neighbours differ enough to read as a new hall, never
 * enough to close the eye's corridor.
 */
export const REFOLDS = Object.freeze([1.15, 1.25, 1.09, 1.31, 1.12, 1.21, 1.06, 1.28]);

/**
 * The eye: in the open middle of a hall, level with the middle of the upright threads (y = 1,
 * halfway between two rows of knots), looking diagonally across the lattice along (−1, 0, −1), so
 * the hall is a grid of strung pillars receding at every depth, not a nave. Everything the net
 * draws stays within s / 2 of a lattice line, and the eye is a whole unit from the nearest. The
 * line x − z = EYE.lane is free of stone for a whole period: the four-line dive flies down it by
 * exactly one diagonal period and lands on the same view.
 */
export const EYE = Object.freeze({
    x: 1.3,
    y: 1.0,
    z: 0.7,
    /** The diagonal the eye looks down and the dive flies along (unit). */
    dir: Object.freeze([-Math.SQRT1_2, 0, -Math.SQRT1_2]),
    lane: 0.6,
});

/** One diagonal period: the dive's whole flight (the lattice repeats exactly after it). */
export const DIVE_LENGTH = TEMPLE.period * Math.SQRT2;

/**
 * The lens. `fov` is the vertical field of view in degrees for a 16:9 frame; a phone (portrait)
 * widens it so the strung pillars still frame the card; `yaw`/`pitch` turn the eye off the diagonal
 * (degrees; positive yaw looks right, positive pitch looks up).
 */
export const RIG = Object.freeze({
    near: 0.01,
    far: 60,
    fov: 58,
    yaw: 21,
    pitch: 7,
});

/** The rig for a frame aspect (width / height): wider lenses for tall frames. Fills `out` when given. */
export function rigFor(aspect, out = {}) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const tall = clamp01((1.2 - a) / 0.75);
    out.fov = lerp(RIG.fov, 84, tall);
    out.yaw = lerp(RIG.yaw, 0, tall);
    out.pitch = lerp(RIG.pitch, 9, tall);
    return out;
}

/** One coordinate folded into the net's cell: its distance to the nearest lattice plane (0..1). */
const cellFold = (v) => Math.abs(v - 2 * Math.floor(0.5 * v + 0.5));

const SPLIT = [0, 0];

/**
 * The strung net on the CPU, the same arithmetic as the shader's (kaleidosonic-tsl.js): a distance
 * to the stone from a point that is never more than the true one (and negative inside the stone),
 * for the march, event placement and the corridor tests.
 *
 * The point walks the net: fold into the cell, read the reach to the knot's pearl and its three
 * threads, invert in the knot's sphere, fold again, read again... Folds keep lengths and an
 * inversion scales them by s / r^2 round a point at radius r, so each level's reach, times every
 * shrink (r^2 / s) on the way there, is the distance to that level's stone to first order. The
 * nearest level wins.
 *
 * First order is too generous far from the stone, because an inversion shrinks what lies farther
 * from its centre more: a ball of radius D round a point that lands at radius R comes from a ball
 * of radius D * shrink / (1 + D / R), not D * shrink. So the reach is eased before it is scaled,
 * reach / (1 + ease * |reach|): exact where it matters (slope 1 at the stone, so the march
 * converges on it and the normals are true), and held back in the open (at most 1 / ease times
 * the shrink). With NET.ease the field's slope is nowhere above 1 for every s and fold count the
 * world uses, and a field that is negative in the stone and never steeper than 1 cannot overstep.
 * Through one inversion that is arithmetic: a level's slope is at most 1 / (1 + ease D)^2 +
 * D / (1 + ease D) * 2 / R, which stays under 1 while 2 / R <= ease (2 + ease D) / (1 + ease D);
 * where R >= 0.8 that holds for any D, and where R < 0.8 the point has landed beside a knot
 * whose pearl is at most R - pearl away, which keeps it true down to R = 0.52 (the walk never
 * lands nearer than sMin / sqrt(3)). The deeper levels add the earlier inversions' share and are
 * measured: tests/unit/kaleidosonic-core.test.js samples the slope and brute-forces the true
 * distance; docs/KALEIDOSONIC_VISUAL_OVERHAUL_2026-10.md has the figures.
 *
 * `folds` may be fractional: the whole inversions are drawn, and the next level's stone grows
 * out of them by the fraction (foldSplit), so the net gains detail without a pop.
 */
export function templeDistance(x, y, z, s = TEMPLE.s, folds = TEMPLE.detailRest) {
    const [whole, weight] = foldSplit(Math.max(0, folds), SPLIT);
    const last = weight > 0 ? whole + 1 : whole;
    const unS = 1 / s;
    let px = x;
    let py = y;
    let pz = z;
    let shrink = 1;
    let d = 1000;
    for (let level = 0; level <= last; level++) {
        px = cellFold(px);
        py = cellFold(py);
        pz = cellFold(pz);
        const qx = px * px;
        const qy = py * py;
        const qz = pz * pz;
        const r2 = qx + qy + qz;
        // a thread runs along each axis (the squared distance to the nearest is the least sum of
        // two of the squares); the pearl sits on the knot
        const reach = Math.min(
            Math.sqrt(Math.min(qx + qy, qy + qz, qz + qx)) - NET.thread,
            Math.sqrt(r2) - NET.pearl,
        );
        const term = (reach * shrink) / (Math.abs(reach) * NET.ease + 1);
        d = level > whole ? d + (Math.min(d, term) - d) * weight : Math.min(d, term);
        if (level === last) break;
        const r2c = Math.max(r2, 1e-6);
        const k = s / r2c;
        px *= k;
        py *= k;
        pz *= k;
        shrink *= r2c * unS;
    }
    return d;
}

/**
 * What of the net a point of the stone belongs to (the shader's colour signal, same arithmetic):
 * the level whose pearl or thread is nearest decides, and the point's place on it is read in
 * that level's own cell. Into `out`:
 *
 *   [0] part   1 on a pearl, 0 on a thread, easing across the join over NET_JOIN
 *   [1] depth  how many inversions down the piece is (0: the net itself)
 *   [2] along  the place along the string, from its knot (0) to the middle of the thread (1);
 *              on a pearl, pearl * the cosine of the angle from the nearest string's hole
 *   [3] turn   the angle round the string (0..pi/2: the cell's mirrors repeat it)
 *
 * The level still growing in (a fractional `folds`) takes a point over by its weight: the four
 * numbers ease from the stone it swells out of to its own, so nothing changes colour at once.
 */
export function templeTrap(x, y, z, s = TEMPLE.s, folds = TEMPLE.detailRest, out = [0, 0, 0, 0]) {
    const [whole, weight] = foldSplit(Math.max(0, folds), SPLIT);
    const last = weight > 0 ? whole + 1 : whole;
    const unS = 1 / s;
    let px = x;
    let py = y;
    let pz = z;
    let shrink = 1;
    let best = 1000;
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    for (let level = 0; level <= last; level++) {
        px = cellFold(px);
        py = cellFold(py);
        pz = cellFold(pz);
        const qx = px * px;
        const qy = py * py;
        const qz = pz * pz;
        const r2 = qx + qy + qz;
        const thread = Math.sqrt(Math.min(qx + qy, qy + qz, qz + qx)) - NET.thread;
        const pearl = Math.sqrt(r2) - NET.pearl;
        const reach = Math.min(thread, pearl);
        const term = (reach * shrink) / (Math.abs(reach) * NET.ease + 1);
        if (term < best) {
            best = term;
            // the two coordinates that turn round the string (the largest runs along it)
            const onX = px >= Math.max(py, pz);
            const onY = py >= pz;
            let b = px;
            let c = py;
            if (onX) {
                b = py;
                c = pz;
            } else if (onY) {
                b = pz;
                c = px;
            }
            const taking = level > whole ? weight : 1;
            const kept = 1 - taking;
            out[0] = out[0] * kept + clamp01((thread - pearl) / (2 * NET_JOIN) + 0.5) * taking;
            out[1] = out[1] * kept + level * taking;
            out[2] = out[2] * kept + Math.max(px, py, pz) * taking;
            out[3] = out[3] * kept + Math.atan2(b, c + 1e-7) * taking;
        }
        const r2c = Math.max(r2, 1e-6);
        const k = s / r2c;
        px *= k;
        py *= k;
        pz *= k;
        shrink *= r2c * unS;
    }
    return out;
}

/**
 * March a ray through the CPU field: the first hit (or null), never nearer than `near`.
 * o and d are [x, y, z]; d unit.
 */
export function marchTemple(o, d, {
    s = TEMPLE.s, folds = TEMPLE.detailRest, near = 0.05, far = 8, steps = 140, out = null,
} = {}) {
    let t = near;
    for (let i = 0; i < steps && t < far; i++) {
        const x = o[0] + d[0] * t;
        const y = o[1] + d[1] * t;
        const z = o[2] + d[2] * t;
        const h = templeDistance(x, y, z, s, folds);
        if (h < 0.0008 * t + 0.0004) {
            const hit = out || {};
            hit.x = x;
            hit.y = y;
            hit.z = z;
            hit.t = t;
            return hit;
        }
        t += h * 0.9;
    }
    return null;
}

// ── Moods: the palette wheel ─────────────────────────────────────────────────────

/**
 * Linear colours, lit as under black light: `stoneA`/`stoneB` the two poles of a near-black
 * pearl; `neonA`/`neonB`/`neonC` the three fluorescent colours its veins and edges glow in (one
 * per level of the net, chosen to vibrate against each other and the core);
 * `heart` the resonant core and its light; `haze` the dark air; `glow` the jewels' aura and the
 * pearl's sheen. Hue-ordered by the heart (rose, violet, azure, teal, jade, amber, back to rose)
 * so a step to a neighbour never passes through grey; the shader stages the neon change region by
 * region (never a straight mix of two complements).
 */
export const MOODS = Object.freeze([
    Object.freeze({
        name: 'rose mandala',
        stoneA: [0.022, 0.006, 0.032],
        stoneB: [0.006, 0.012, 0.03],
        neonA: [1.45, 0.82, 0.08],
        neonB: [0.42, 1.35, 0.14],
        neonC: [0.08, 0.85, 1.45],
        heart: [2.6, 0.42, 1.3],
        haze: [0.012, 0.003, 0.014],
        glow: [0.6, 0.12, 0.45],
        exposure: 1.0,
    }),
    Object.freeze({
        name: 'violet hum',
        stoneA: [0.012, 0.006, 0.036],
        stoneB: [0.004, 0.016, 0.022],
        neonA: [0.62, 1.4, 0.1],
        neonB: [1.5, 0.48, 0.05],
        neonC: [0.1, 1.3, 1.0],
        heart: [1.3, 0.5, 2.8],
        haze: [0.006, 0.004, 0.022],
        glow: [0.35, 0.15, 0.7],
        exposure: 1.05,
    }),
    Object.freeze({
        name: 'azure bell',
        stoneA: [0.004, 0.012, 0.036],
        stoneB: [0.022, 0.005, 0.026],
        neonA: [1.5, 0.55, 0.05],
        neonB: [1.4, 0.14, 0.9],
        neonC: [1.3, 1.0, 0.14],
        heart: [0.45, 1.2, 2.8],
        haze: [0.002, 0.006, 0.022],
        glow: [0.15, 0.35, 0.75],
        exposure: 1.04,
    }),
    Object.freeze({
        name: 'teal chime',
        stoneA: [0.003, 0.022, 0.026],
        stoneB: [0.016, 0.004, 0.028],
        neonA: [1.5, 0.2, 0.85],
        neonB: [0.7, 0.3, 1.5],
        neonC: [1.4, 0.9, 0.1],
        heart: [0.25, 2.4, 1.9],
        haze: [0.001, 0.012, 0.014],
        glow: [0.1, 0.55, 0.5],
        exposure: 0.98,
    }),
    Object.freeze({
        name: 'jade drone',
        stoneA: [0.01, 0.024, 0.004],
        stoneB: [0.004, 0.012, 0.028],
        neonA: [0.8, 0.35, 1.6],
        neonB: [1.4, 0.2, 0.8],
        neonC: [0.15, 1.0, 1.4],
        heart: [1.2, 2.5, 0.35],
        haze: [0.003, 0.012, 0.004],
        glow: [0.35, 0.6, 0.12],
        exposure: 0.98,
    }),
    Object.freeze({
        name: 'amber gong',
        stoneA: [0.03, 0.01, 0.004],
        stoneB: [0.014, 0.004, 0.028],
        neonA: [0.2, 1.1, 1.5],
        neonB: [0.75, 0.35, 1.5],
        neonC: [0.6, 1.4, 0.15],
        heart: [2.8, 1.3, 0.25],
        haze: [0.014, 0.006, 0.002],
        glow: [0.65, 0.3, 0.06],
        exposure: 0.96,
    }),
]);

export const MOOD_COUNT = MOODS.length;
export const MOOD_COLOURS = Object.freeze(['stoneA', 'stoneB', 'neonA', 'neonB', 'neonC', 'heart', 'haze', 'glow']);

// ── Timings (seconds) ─────────────────────────────────────────────────────────────

export const TIMING = Object.freeze({
    /** One mood per this many seconds of theme clock (the wheel's clock term). */
    mood: 100,
    /** Share of a mood step the light rests on the mood's own palette, at each end. */
    moodRest: 0.15,
    /** A level-up's turn of the wheel eases over this long. */
    levelTurn: 5,
    /** A strike's wavefront lives this long (its ripples fade on the way). */
    strike: 3.2,
    /** A harmonic (a clear's chord) rings this long. */
    harmonic: 3.6,
    /** A refold springs to its new shape over about this long (critically damped). */
    refold: 1.4,
    /** The four-line dive: one diagonal period in this long. */
    dive: 2.8,
    /** Twist: the eye rolls a full turn in this long. */
    roll: 2.2,
    /** Perfect clear: every fold aligns this long, then lets go over the next. */
    mandalaHold: 5,
    mandalaRelease: 3,
    /** A chain's folds ease in over this long per fold; a broken chain lets them go over this long. */
    foldIn: 1.1,
    foldOut: 3.2,
    /** Game over: the light sinks over this long, and returns over this long. */
    sink: 5,
    rise: 3,
    /** Without play the chain is forgotten after this long. */
    idle: 90,
});

/** The chain at which each of the kaleidoscope's stages opens: a mirror, six sectors, twelve. */
export const FOLD_AT = Object.freeze([2, 5, 8]);

/** The polar stages after the mirror: (stage index, sectors per half turn). */
const LENS_STAGES = [[1, 3], [2, 6]];

/**
 * The kaleidoscope on the CPU (the shader's ksLensFold, each stage applied once it is more than half
 * open): a point in the lens's tangent plane (x right, y up) folded into the wedge the core is in.
 * The mirror's line runs through the axis square to the core's bearing; the core's half is kept.
 */
export function foldLens(x, y, bearing, stages) {
    let px = x;
    let py = y;
    if (stages[0] > 0.5) {
        const nx = Math.cos(bearing);
        const ny = Math.sin(bearing);
        const d = px * nx + py * ny;
        if (d < 0) {
            px -= 2 * d * nx;
            py -= 2 * d * ny;
        }
    }
    for (const [k, n] of LENS_STAGES) {
        if (stages[k] <= 0.5) continue;
        const r = Math.hypot(px, py);
        const wedge = Math.PI / n;
        const local = Math.atan2(py, px) - bearing;
        const m = local + wedge - Math.floor((local + wedge) / (2 * wedge)) * 2 * wedge - wedge;
        const a = bearing + Math.abs(m);
        px = Math.cos(a) * r;
        py = Math.sin(a) * r;
    }
    return [px, py];
}

/** The trance a chain asks for (0..1): it deepens fast at first and saturates near ten. */
export function tranceFor(combo) {
    const n = Math.max(0, Number(combo) || 0);
    return 1 - Math.exp(-n / 4.2);
}

/** The wheel's place for a level (1-based) and the clock: moods from the rose mandala. */
export function moodPlace(level, time) {
    const t = Number.isFinite(time) ? Math.max(0, time) : 0;
    return Math.max(0, (Number(level) || 1) - 1) + t / TIMING.mood;
}

/** Mood index (0..5) and the eased mix toward the next one for a wheel place. Fills `out` when given. */
export function moodMix(place, out = {}) {
    const p = Number.isFinite(place) ? place : 0;
    const whole = Math.floor(p);
    const from = ((whole % MOOD_COUNT) + MOOD_COUNT) % MOOD_COUNT;
    out.from = from;
    out.to = (from + 1) % MOOD_COUNT;
    out.mix = smooth(TIMING.moodRest, 1 - TIMING.moodRest, p - whole);
    return out;
}

/**
 * The wheel the world turns. `place()` is the moods' position: the clock's share plus the level's
 * eased steps. A level-up steps FORWARD by the levels gained from wherever the last turn was
 * heading; a new run (level 1 again) keeps the moods where they are.
 */
export class MoodWheel {
    constructor() {
        this.reset();
    }

    reset() {
        this.turnFrom = 0;
        this.turnTo = 0;
        this.turnAt = -1e6;
        this.level = 1;
    }

    /** The level's share of the place at time t (eased). */
    levelShare(t) {
        const k = smooth(0, TIMING.levelTurn, t - this.turnAt);
        return lerp(this.turnFrom, this.turnTo, k);
    }

    place(t) {
        return this.levelShare(t) + Math.max(0, t) / TIMING.mood;
    }

    /** A level-up at time t to `level`: step forward by the levels gained (silent = at once). */
    levelUp(level, t, silent = false) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n <= this.level) {
            this.level = n;
            return;
        }
        const gained = n - this.level;
        const current = this.levelShare(t);
        this.turnFrom = current;
        this.turnTo = Math.max(this.turnTo, current) + gained;
        this.turnAt = silent ? t - TIMING.levelTurn : t;
        this.level = n;
    }

    /** A new run (level 1 again): the moods stay where they are; later level-ups step on from them. */
    newRun() {
        this.level = 1;
    }

    exportState() {
        return {
            turnFrom: this.turnFrom, turnTo: this.turnTo, turnAt: this.turnAt, level: this.level,
        };
    }

    importState(state) {
        if (!state) return;
        this.turnFrom = Number(state.turnFrom) || 0;
        this.turnTo = Number(state.turnTo) || 0;
        this.turnAt = Number.isFinite(state.turnAt) ? state.turnAt : -1e6;
        this.level = Math.max(1, Math.round(Number(state.level) || 1));
    }
}

/** A critically damped spring step toward a target (sub-stepped at 1/120 s for determinism). */
export function springStep(state, target, dt, omega) {
    let remaining = Math.max(0, dt);
    while (remaining > 1e-9) {
        const h = Math.min(1 / 120, remaining);
        const accel = omega * omega * (target - state.x) - 2 * omega * state.v;
        state.v += accel * h;
        state.x += state.v * h;
        remaining -= h;
    }
    return state;
}

/** Ease in and out (a smootherstep), for the dive's flight and the roll. */
export function smoother(t) {
    const x = clamp01(t);
    return x * x * x * (x * (x * 6 - 15) + 10);
}
