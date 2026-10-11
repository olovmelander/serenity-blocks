/**
 * Serenity Warp — constants and CPU maths shared by the choreography and the shaders.
 * Three-free: the director, the layout and their tests import only this.
 *
 * The scene: a wormhole hangs far ahead, and the space round it runs into it like water into a
 * drain. Through its throat another sky shows, in the next palette's colours. Pieces of glass in
 * the shapes of the game drift on the current and spiral into it. Units are "warp units"; the
 * camera stands at the origin, the gate's axis is the world's −Z and the gate itself stands
 * GATE.distance along it. The camera looks a little aside, so the gate hangs beside the board.
 *
 * A glass piece's place is written in the gate's own frame: its angle off the gate's axis as
 * seen from the camera (θ), its turn round that axis (φ, 0 = screen right, up is positive), and
 * its depth along the axis. Its whole run to the gate is one number, `s` (0 → 1).
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

// ── The gate ────────────────────────────────────────────────────────────────────

export const GATE = Object.freeze({
    /** How far down the axis the throat stands (warp units). */
    distance: 100,
    /** Where a piece's run ends, just short of the throat (it then falls in). */
    depth: 92,
    /** The throat's angular radius at rest, landscape and upright (degrees). */
    radius: 6.4,
    radiusPortrait: 4.8,
    /**
     * Inside the throat the other sky is drawn with γ = π · (θ / α)^p: its whole sphere folded
     * into the disc, the far side of it round the rim.
     */
    fold: 1.35,
    /** How wide the throat opens in a jump (degrees): wider than any frame, so we are in it. */
    jumpRadius: 118,
});

// ── The current ─────────────────────────────────────────────────────────────────

/** Seconds a piece takes from the card (or the frame's edge) to the throat at rest. */
export const JOURNEY = 72;
/** How many times faster the current runs at the longest chains, and in a jump. */
export const CURRENT_CHAIN = 7;
export const CURRENT_JUMP = 18;
/** Turns a piece makes round the gate on its way in (×its own spin, ±). */
export const SWIRL_TURNS = 1.05;

/** The most a chain warps the sky (0..1): the stars' trails, the vortex's wind, the lens. */
export const WARP_CHAIN = 0.9;

/** How much warp a chain of n clears holds (0 at rest → WARP_CHAIN). One clear barely shows. */
export function warpForCombo(combo) {
    return combo > 0 ? WARP_CHAIN * (1 - Math.exp(-Math.max(0, combo - 0.4) / 3.4)) : 0;
}

/** The current's speed (× rest) for a warp. */
export const currentFor = (warp) => 1 + (CURRENT_CHAIN - 1) * Math.min(1, warp / WARP_CHAIN);

/** How late a piece's run goes deep: a drifting piece lingers near the lens, a lock's dives. */
export const DIVE_DRIFT = 2.2;
export const DIVE_LOCK = 1.05;

/**
 * A piece's place `s` of the way in (0..1), given where it started: θ0 (radians off the axis),
 * φ0, depth0, its spin (±1) and how late it dives (`dive`, default DIVE_DRIFT). The angle
 * closes roughly evenly, the depth grows geometrically (so its size on screen falls smoothly),
 * and the turn quickens toward the throat. Fills and returns `out` ({ theta, phi, depth }).
 */
export function pathAt(start, s, out = { theta: 0, phi: 0, depth: 0 }) {
    const k = Math.max(0, Math.min(1, s));
    out.theta = start.theta0 * (1 - k) ** 0.9;
    out.depth = start.depth0 * (GATE.depth / start.depth0) ** (k ** (start.dive ?? DIVE_DRIFT));
    out.phi = start.phi0 + start.spin * SWIRL_TURNS * TAU * ((k + 0.6 * k * k * k) / 1.6);
    return out;
}

/** The world point of a place in the gate's frame (camera at the origin, axis −Z). */
export function placeToWorld(theta, phi, depth, out = [0, 0, 0]) {
    const r = depth * Math.tan(Math.min(theta, 1.45));
    out[0] = r * Math.cos(phi);
    out[1] = r * Math.sin(phi);
    out[2] = -depth;
    return out;
}

/** The place in the gate's frame of a world point (inverse of placeToWorld). */
export function worldToPlace(x, y, z, out = { theta: 0, phi: 0, depth: 0 }) {
    const depth = Math.max(1e-3, -z);
    out.depth = depth;
    out.theta = Math.atan2(Math.hypot(x, y), depth);
    out.phi = Math.atan2(y, x);
    return out;
}

// ── Glass pieces ────────────────────────────────────────────────────────────────

/** Pieces of glass held at once (the tier may hold fewer), and how many drift there with no play. */
export const PIECE_SLOTS = 24;
/** One cell's edge (warp units). */
export const CELL = 0.42;
/** Where a lock's piece settles after it has left the card (depth, warp units). */
export const BIRTH_DEPTH = 8.5;
/** Seconds a lock's piece takes from the board to its place outside the card. */
export const BIRTH_FLIGHT = 0.5;
/** Seconds it takes a newborn piece to cool from white-hot to its colour (1/e). */
export const BIRTH_COOL = 0.85;
/** A lock's piece is this many times the board's own cell on screen (within CELL·0.55…CELL). */
export const BIRTH_SIZE = 1.7;
/** A lock's piece is launched along its run: this much faster at first, easing over LAUNCH_EASE s. */
export const LAUNCH_BOOST = 2.5;
export const LAUNCH_EASE = 2.5;
/** Seconds a piece takes to fall into the throat at the end of its run, and when a clear pulls it. */
export const FALL_NATURAL = 1.3;
export const FALL_PULLED = 0.9;
/** The run's share at which a piece falls in by itself. */
export const FALL_AT = 0.975;
/** Seconds an ambient piece takes to come in from the frame's edge (it is born outside). */
export const AMBIENT_FADE = 2.5;

/**
 * The seven shapes in their spawn orientation (row 0 is the top row of the matrix). A lock's
 * piece keeps the orientation it locked in; these are for the pieces that drift by themselves.
 */
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
 * The occupied cells of a shape matrix as offsets from their own centre, x right and y UP
 * (matrix rows run down), at most four. Returns a flat [x0, y0, x1, y1, …] of 8 numbers (a
 * missing cell repeats the first, so the union is unchanged), or null if nothing is occupied.
 * Offsets are multiples of 0.5.
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
    // Centre on the bounding box (offsets stay on the half grid; the box's middle is the turn's pivot).
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

/**
 * One cell offset (multiples of 0.5 in −3.5..3.5) as an exactly representable integer code:
 * (2x + 8) · 32 + (2y + 8). The shader decodes it with floor/mod (an interpolated attribute
 * comes back with last-bit noise; it is rounded first).
 */
export const packCell = (x, y) => (Math.round(x * 2) + 8) * 32 + (Math.round(y * 2) + 8);
export function unpackCell(code, out = [0, 0]) {
    const c = Math.round(code);
    out[0] = (Math.floor(c / 32) - 8) / 2;
    out[1] = ((c % 32) - 8) / 2;
    return out;
}

/** A shape's eight offsets as four codes (the instance attribute's vec4). */
export function packCells(cells, out = [0, 0, 0, 0]) {
    for (let i = 0; i < 4; i++) out[i] = packCell(cells[i * 2], cells[i * 2 + 1]);
    return out;
}

/**
 * CPU twin of the glass shader's trace (tests): a ray that starts INSIDE the union of four unit
 * cells (each the box [x ± 0.5] × [y ± 0.5] × [±0.5]) leaves it after how long, and through which
 * face? Returns { t, normal: [x, y, z] } with the outward normal of the face it leaves through.
 * The shader runs the same sweep: four passes over the four boxes, each extending the exit while
 * the ray is still inside some box.
 */
export function unionExit(cells, origin, dir) {
    let t = 0;
    let face = [0, 0, 1];
    const slab = (o, d, lo, hi) => {
        const safe = d < 0 ? -1e-9 : 1e-9;
        const inv = 1 / (Math.abs(d) > 1e-9 ? d : safe);
        const a = (lo - o) * inv;
        const b = (hi - o) * inv;
        return [Math.min(a, b), Math.max(a, b)];
    };
    for (let pass = 0; pass < 4; pass++) {
        for (let i = 0; i < 4; i++) {
            const cx = cells[i * 2];
            const cy = cells[i * 2 + 1];
            const sx = slab(origin[0], dir[0], cx - 0.5, cx + 0.5);
            const sy = slab(origin[1], dir[1], cy - 0.5, cy + 0.5);
            const sz = slab(origin[2], dir[2], -0.5, 0.5);
            const near = Math.max(sx[0], sy[0], sz[0]);
            const far = Math.min(sx[1], sy[1], sz[1]);
            if (near <= t + 1e-4 && far > t) {
                t = far;
                if (far === sx[1]) face = [Math.sign(dir[0]), 0, 0];
                else if (far === sy[1]) face = [0, Math.sign(dir[1]), 0];
                else face = [0, 0, Math.sign(dir[2])];
            }
        }
    }
    return { t, normal: face };
}

// ── Waves, ripples, streams ─────────────────────────────────────────────────────

/** Rings of light that leave the throat (a clear's, a chain's, a level's) held at once. */
export const WAVE_SLOTS = 8;
/** How fast a wave crosses the sky (radians per second, at its start) and how long it lives. */
export const WAVE_SPEED = 1.15;
export const WAVE_LIFE = 2.2;
/** The angle off the gate's axis a wave stands at, `age` seconds after it left the rim `alpha`. */
export function waveAngle(age, alpha) {
    if (age <= 0) return alpha;
    // Fast off the rim, easing as it spreads (a ring on water).
    return alpha + (WAVE_SPEED / 0.9) * (1 - Math.exp(-age * 0.9)) + age * 0.08;
}
/** A wave's light `age` seconds after it left (0 before and after its life). */
export function waveLight(age) {
    if (age < 0 || age > WAVE_LIFE) return 0;
    const rise = Math.min(1, age / 0.06);
    return rise * Math.exp(-age / 0.85) * (1 - smooth(WAVE_LIFE - 0.4, WAVE_LIFE, age));
}

/** Ripples in space round a newborn piece (a lock's), held at once, and how long one lives. */
export const RIPPLE_SLOTS = 6;
export const RIPPLE_LIFE = 1.6;

/** Light streams a clear sends from the card to the throat, and how long one lives. */
export const STREAM_SLOTS = 8;
export const STREAM_LIFE = 1.1;

// ── The jump ────────────────────────────────────────────────────────────────────

/** Seconds a four-line clear holds its breath before the throat swallows us. */
export const HUSH_HOLD = 0.28;
/** Seconds in the throat (four lines; a perfect clear stays longer), and to come out of it. */
export const JUMP_TUNNEL = 2.4;
export const JUMP_TUNNEL_PERFECT = 3.3;
export const JUMP_EXIT = 1.0;
/** Seconds the throat takes to open round us. */
export const JUMP_OPEN = 0.8;
/** Seconds the afterglow of a jump takes to fade to 1/e. */
export const JUMP_AFTERGLOW = 4.2;

/**
 * The jump as one number, 0..1, `since` seconds after the throat began to open, for a tunnel of
 * `length` seconds: how much of the frame is the throat's inside.
 */
export function jumpPhase(since, length = JUMP_TUNNEL) {
    if (since <= 0 || since >= length + JUMP_EXIT) return 0;
    if (since < length) return smooth(JUMP_OPEN * 0.45, JUMP_OPEN, since);
    return 1 - smooth(0, JUMP_EXIT, since - length);
}

/** The throat's angular radius (radians) `since` seconds into a jump, from its rest radius. */
export function jumpRadius(since, rest, length = JUMP_TUNNEL) {
    if (since <= 0 || since >= length) return rest;
    const k = smooth(0, JUMP_OPEN, since);
    return rest + (GATE.jumpRadius * DEG - rest) * k * k;
}

// ── Small maths ─────────────────────────────────────────────────────────────────

/** mulberry32: a tiny seeded [0, 1) generator. */
export function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Frame-rate independent exponential approach: fraction of the gap closed in `dt`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two edges. */
export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** Hamilton product a·b of quaternions [x, y, z, w]. */
export function quatMul(a, b, out = [0, 0, 0, 1]) {
    const x = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
    const y = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0];
    const z = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3];
    const w = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
}

/** The quaternion of a turn of `angle` round a unit axis. */
export function quatAxis(ax, ay, az, angle, out = [0, 0, 0, 1]) {
    const h = angle * 0.5;
    const s = Math.sin(h);
    out[0] = ax * s;
    out[1] = ay * s;
    out[2] = az * s;
    out[3] = Math.cos(h);
    return out;
}

/** v rotated by the unit quaternion q. */
export function quatRotate(q, v, out = [0, 0, 0]) {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    out[0] = v[0] + w * tx + (y * tz - z * ty);
    out[1] = v[1] + w * ty + (z * tx - x * tz);
    out[2] = v[2] + w * tz + (x * ty - y * tx);
    return out;
}

// ── Colour ──────────────────────────────────────────────────────────────────────

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** An sRGB hex as scene-linear [r, g, b]. */
export function linRGB(hex) {
    return [
        srgbToLinear(((hex >> 16) & 255) / 255),
        srgbToLinear(((hex >> 8) & 255) / 255),
        srgbToLinear((hex & 255) / 255),
    ];
}

/**
 * A piece colour (CSS hex string or number) as a scene-linear, peak-normalised [r, g, b]: the
 * colour its glass is stained and its light burns in. Pale colours are pushed toward their own
 * hue (they would read as clear glass), and every channel keeps a floor.
 */
export function pieceColor(value, fallback = 0x35e6ef) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.6) / (1 - lo * 0.6);
        return pushed * 0.95 + 0.05;
    });
}

/**
 * The sky's palettes, scene-linear, IN HUE ORDER (neighbours are neighbours in hue, so the sky
 * drifts from one to the next without passing through grey). The two glows of each palette
 * belong to different colour families, staggered so a place half-way between two palettes is
 * never one hue:
 *   glow    the gas the gate lights (the vortex's arms)
 *   deep    the gas in its own shade, far from the gate
 *   accent  the threads and rims of the gas: the third colour
 *   dust    what the dark lanes let through (a tint, not a light)
 *   gate    the throat's light: its rim, its halo, the glints on the glass
 *   sky     the deep sky behind everything
 *   star    the stars' tint
 */
export const SKY_PALETTES = Object.freeze([
    {
        name: 'verdant',
        glow: [0.05, 0.6, 0.3],
        deep: [0.02, 0.17, 0.32],
        accent: [0.72, 0.3, 0.86],
        dust: [0.14, 0.44, 0.3],
        gate: [0.78, 1.0, 0.86],
        sky: [0.001, 0.0038, 0.004],
        star: [0.86, 1.0, 0.92],
    },
    {
        name: 'lagoon',
        glow: [0.03, 0.5, 0.62],
        deep: [0.07, 0.09, 0.5],
        accent: [0.95, 0.36, 0.5],
        dust: [0.12, 0.38, 0.52],
        gate: [0.74, 0.98, 1.0],
        sky: [0.001, 0.003, 0.0068],
        star: [0.78, 0.95, 1.0],
    },
    {
        name: 'serenity',
        glow: [0.09, 0.24, 0.92],
        deep: [0.3, 0.06, 0.56],
        accent: [0.92, 0.26, 0.74],
        dust: [0.2, 0.26, 0.64],
        gate: [0.8, 0.9, 1.0],
        sky: [0.0016, 0.0018, 0.0085],
        star: [0.82, 0.88, 1.0],
    },
    {
        name: 'amethyst',
        glow: [0.42, 0.1, 0.88],
        deep: [0.5, 0.03, 0.3],
        accent: [1.0, 0.25, 0.3],
        dust: [0.36, 0.22, 0.6],
        gate: [0.93, 0.86, 1.0],
        sky: [0.0028, 0.0012, 0.0075],
        star: [0.92, 0.86, 1.0],
    },
    {
        name: 'rose',
        glow: [0.8, 0.08, 0.42],
        deep: [0.4, 0.06, 0.5],
        accent: [1.0, 0.62, 0.15],
        dust: [0.55, 0.2, 0.36],
        gate: [1.0, 0.88, 0.93],
        sky: [0.004, 0.001, 0.0042],
        star: [1.0, 0.86, 0.92],
    },
    {
        name: 'ember',
        glow: [0.92, 0.36, 0.05],
        deep: [0.45, 0.05, 0.22],
        accent: [0.1, 0.8, 0.5],
        dust: [0.6, 0.34, 0.16],
        gate: [1.0, 0.92, 0.78],
        sky: [0.0045, 0.0016, 0.0018],
        star: [1.0, 0.9, 0.8],
    },
]);

export const PALETTE_KEYS = Object.freeze(['glow', 'deep', 'accent', 'dust', 'gate', 'sky', 'star']);

/** The palette level 1 starts on (serenity), as an index into SKY_PALETTES. */
export const PALETTE_HOME = 2;
/** Seconds the clock alone takes to carry the sky one palette along. A level-up is one step. */
export const PALETTE_STEP = 90;
/** The share of a step, at each end, that the sky rests on a palette before moving on. */
export const PALETTE_REST = 0.15;

/**
 * Where the sky stands for a level's place and the clock: the two simply add. `levelPlace` is
 * level − 1 (eased by the world when a level changes).
 */
export const palettePlace = (levelPlace, time) => levelPlace + Math.max(0, time) / PALETTE_STEP;

/**
 * A place on the palettes' line as (index, next, mix). The line is walked there and back
 * (…serenity, amethyst, rose, ember, rose, amethyst, serenity, lagoon, verdant, lagoon…), so
 * every step is between hue neighbours; there is no wrap from one end to the other.
 */
export function palettePhase(place) {
    const last = SKY_PALETTES.length - 1;
    const period = last * 2;
    let x = (((place + PALETTE_HOME) % period) + period) % period;
    if (x > last) x = period - x;
    const index = Math.min(last - 1, Math.floor(x));
    return { index, next: index + 1, mix: smooth(PALETTE_REST, 1 - PALETTE_REST, x - index) };
}

/** The palette at a place: every colour mixed between two neighbours. Fills and returns `out`. */
export function paletteAt(place, out = {}) {
    const { index, next, mix } = palettePhase(place);
    const from = SKY_PALETTES[index];
    const to = SKY_PALETTES[next];
    for (let i = 0; i < PALETTE_KEYS.length; i++) {
        const key = PALETTE_KEYS[i];
        const target = out[key] || (out[key] = [0, 0, 0]);
        for (let c = 0; c < 3; c++) target[c] = lerp(from[key][c], to[key][c], mix);
    }
    return out;
}

/** The name of the palette a place stands nearest to. */
export function paletteName(place) {
    const { index, next, mix } = palettePhase(place);
    return SKY_PALETTES[mix < 0.5 ? index : next].name;
}

/**
 * How far along the line the sky seen THROUGH the throat stands: one palette ahead of ours, so
 * the gate always shows where the drift is going.
 */
export const THERE_AHEAD = 1;

/** The colour a clear's waves and streams come in (the gate's own light is added to it). */
export const WARPLIGHT = Object.freeze([0.84, 0.94, 1.0]);

/**
 * Where the gate hangs for an aspect ratio, as screen fractions, y down, and the horizontal
 * field of view the rig holds at rest (degrees). Landscape leaves the centre to the board: the
 * gate stands in the free space left of the card. Upright phones show sky above and below the
 * card, so the gate rises above it.
 */
export function gateAnchors(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const k = smooth(0.62, 0.95, a);
    const roomy = smooth(1.0, 1.6, a);
    const wide = smooth(1.5, 2.3, a);
    return {
        x: lerp(0.5, lerp(0.21, lerp(0.215, 0.24, wide), roomy), k),
        y: lerp(0.085, lerp(0.42, 0.44, roomy), k),
        hFov: lerp(62, lerp(72, lerp(80, 88, wide), roomy), k),
        radius: lerp(GATE.radiusPortrait, GATE.radius, k) * DEG,
    };
}
