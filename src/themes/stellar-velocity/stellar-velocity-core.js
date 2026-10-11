/**
 * Stellar Velocity — constants and CPU maths shared by the choreography and the shaders.
 * Three-free: the director, the layout and their tests import only this.
 *
 * The scene is a flight down a canyon of cloud toward one far sun. It is measured in canyon
 * units (the open channel round the course is about one unit in radius). The course is the
 * world's −Z axis and the sun stands at its far end; the camera rides on it and looks a little
 * aside, so the sun (the point everything flies out of) hangs beside the board, not behind it.
 * Depth below means "distance ahead of the camera along the course".
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** The canyon the course runs down (canyon units). */
export const CANYON = Object.freeze({
    /** Radius of the open channel round the course, and where the walls are at their thickest. */
    clear: 0.95,
    wall: 3.2,
    /** Past here there is no cloud at all: the canyon stands in open space. */
    outer: 8.5,
    /** How far ahead the cloud is walked, and where the first step lands. */
    reach: 52,
    near: 0.45,
    /** One tile of the baked noise, in canyon units, and how far it is drawn out along the course. */
    tile: 7.5,
    stretch: 2.2,
});

// ── Velocity ────────────────────────────────────────────────────────────────────

/** Canyon units per second at rest: a glide. */
export const CRUISE = 0.2;
/** How many times cruise the longest chains reach. Only a jump goes past it. */
export const GEAR_CHAIN = 15;
/** How many times cruise the canyon passes at in a jump (what the eye is shown, not the tunnel). */
export const GEAR_JUMP = 60;

/** The gear a chain of n clears holds (1 at rest → GEAR_CHAIN). */
export function gearForCombo(combo) {
    return combo > 0 ? 1 + (GEAR_CHAIN - 1) * (1 - Math.exp(-combo / 3.8)) : 1;
}

/** The most of light's speed a chain reaches: past it only a jump goes. */
export const WARP_CHAIN = 0.9;
/** What a jump's spool pulls the field to. */
export const WARP_JUMP = 0.985;

/**
 * How much of light's speed a chain of n clears is shown at (0 at rest → WARP_CHAIN). This is
 * what bunches the starfield forward and splits it into the starbow; one clear barely shows it.
 */
export function warpForCombo(combo) {
    return combo > 0 ? WARP_CHAIN * (1 - Math.exp(-Math.max(0, combo - 0.35) / 3.1)) : 0;
}

/** cos of a star's angle off the course as seen at speed β, from its true one. */
export function aberrate(cosTheta, beta) {
    return (cosTheta + beta) / (1 + beta * cosTheta);
}

/** The Doppler factor of light seen at angle cos θ′ off the course at speed β (> 1 = bluer). */
export function doppler(cosSeen, beta) {
    return Math.sqrt(Math.max(0, 1 - beta * beta)) / Math.max(1e-4, 1 - beta * cosSeen);
}

// ── The course: hoops the board lays, fronts of light that come down the canyon ──

/** Hoops of light held on the course at once (one per lock; the dimmest is replaced). */
export const HOOP_SLOTS = 12;
/** A hoop's place ahead: the nearest, and the gap to the next. */
export const HOOP_NEAR = 2.8;
export const HOOP_GAP = 0.82;
/** A hoop's radius at its place (the nearest; the far ones are a little wider). */
export const HOOP_RADIUS = 0.56;
/** Seconds a hoop takes to open, how long its light takes to fall to 1/e, and its whole life. */
export const HOOP_OPEN = 0.5;
export const HOOP_HOLD = 34;
export const HOOP_LIFE = 90;
/** Seconds a fired hoop takes from its place to the camera (the nearest; far ones a little more). */
export const HOOP_RUN = 0.34;
/** Seconds between two hoops of one clear leaving. */
export const HOOP_STAGGER = 0.07;
/** Segments round a hoop's ribbon. */
export const HOOP_SEGMENTS = 96;
/** Hoops whose light the cloud is marched with (the nearest lit ones). */
export const HOOP_LIGHTS = 4;

/** What is left of a hoop's light `age` seconds after its lock. */
export function hoopHeld(age) {
    if (age < 0 || age > HOOP_LIFE) return 0;
    const t = Math.min(1, age / HOOP_OPEN);
    return t * t * (3 - 2 * t) * Math.exp(-age / HOOP_HOLD) * (1 - smooth(HOOP_LIFE - 10, HOOP_LIFE, age));
}

/** Where slot k's hoop stands (depth ahead) and how wide it is. */
export const hoopDepth = (slot) => HOOP_NEAR + slot * HOOP_GAP;
export const hoopRadius = (slot) => HOOP_RADIUS * (1 + slot * 0.035);

/**
 * A fired hoop's depth `since` seconds after it left its place at `depth`: it comes at us ever
 * faster, passes the camera at `hoopRun(depth)` and is gone behind.
 */
export const hoopRun = (depth) => HOOP_RUN * (0.8 + depth / 14);
export function hoopFiredDepth(depth, since) {
    if (since <= 0) return depth;
    const k = since / hoopRun(depth);
    return depth * (1 - k * k) - Math.max(0, k - 1) * 3;
}

/** Fronts of light in the canyon at once (a lock's pulse, a clear's fronts, a level's). */
export const FRONT_SLOTS = 8;
/** Where a front starts (depth ahead) and where it is done with (behind the camera). */
export const FRONT_START = 24;
export const FRONT_END = -3;
/** Speeds (canyon units per second): a lock's pulse, a clear's front, a level's slow front. */
export const FRONT_SPEED = Object.freeze({ lock: 46, clear: 34, level: 9 });

/** A front's depth ahead `age` seconds after it left the sun's end of the canyon. */
export const frontDepth = (age, speed) => FRONT_START - Math.max(0, age) * speed;

/** Bolts in flight at once (a lock throws one, a hard drop three), and motes per bolt's tail. */
export const BOLT_SLOTS = 10;
export const BOLT_TAIL = 26;
/** Seconds a bolt takes from the card to its place on the course. */
export const BOLT_FLIGHT = 0.36;

/** Row jets a clear fires from the card (one per cleared row), and how long one lives. */
export const JET_SLOTS = 8;
export const JET_LIFE = 0.75;

// ── The jump ────────────────────────────────────────────────────────────────────

/** Seconds a four-line clear holds the drive's breath before it jumps. */
export const HUSH_HOLD = 0.26;
/** Seconds in the tunnel (four lines; a perfect clear stays longer), and to drop out of it. */
export const JUMP_TUNNEL = 2.3;
export const JUMP_TUNNEL_PERFECT = 3.3;
export const JUMP_EXIT = 0.9;
/** Seconds the afterglow of a jump takes to fade to 1/e. */
export const JUMP_AFTERGLOW = 4.2;

/**
 * The jump as one number, 0..1, `since` seconds after the tunnel opened and for a tunnel of
 * `length` seconds: how much of the frame is the tunnel (it opens in a tenth of a second and
 * closes over JUMP_EXIT).
 */
export function jumpPhase(since, length = JUMP_TUNNEL) {
    if (since <= 0 || since >= length + JUMP_EXIT) return 0;
    if (since < length) return smooth(0, 0.12, since);
    return 1 - smooth(0, JUMP_EXIT, since - length);
}

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
 * colour its hoop burns in.
 */
export function pieceColor(value, fallback = 0x35d6ff) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    // Pale piece colours wash out as light: push them toward their own hue, and keep a floor in
    // every channel so a pure primary still reaches all three of the bloom's channels.
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.6) / (1 - lo * 0.6);
        return pushed * 0.95 + 0.05;
    });
}

/**
 * The starbow: the colour starlight is shifted to by a Doppler factor (1 = as it left). Stops
 * are [log2 of the factor, r, g, b], scene-linear, peak 1: deep red far off the course, through
 * amber, a white band where the shift is nothing, then cyan and blue to violet dead ahead.
 * CPU twin of svStarbow.
 */
export const STARBOW = Object.freeze([
    [-1.5, 0.7, 0.03, 0.02],
    [-1.0, 1.0, 0.14, 0.03],
    [-0.55, 1.0, 0.5, 0.06],
    [-0.15, 1.0, 0.9, 0.6],
    [0.15, 0.8, 0.97, 1.0],
    [0.5, 0.3, 0.72, 1.0],
    [0.9, 0.24, 0.4, 1.0],
    [1.4, 0.55, 0.3, 1.0],
]);

export function starbowColor(shift, out = [0, 0, 0]) {
    const s = Math.max(STARBOW[0][0], Math.min(STARBOW[STARBOW.length - 1][0], shift));
    let i = 0;
    while (i < STARBOW.length - 2 && s > STARBOW[i + 1][0]) i += 1;
    const a = STARBOW[i];
    const b = STARBOW[i + 1];
    const t = smooth(a[0], b[0], s);
    for (let c = 0; c < 3; c++) out[c] = lerp(a[c + 1], b[c + 1], t);
    return out;
}

/**
 * The nebula's palettes, all scene-linear, IN HUE ORDER: neighbours in this list are neighbours
 * in hue, so the canyon can drift from one to the next without passing through grey. In every
 * palette the two glows belong to different colour families, and they are staggered so that a
 * place half-way between two palettes is never one hue:
 *   glow    gas the sun's light reaches (the sunward faces, the thin veils)
 *   deep    gas in the cloud's own shade
 *   accent  the light that grazes the dust's rims and the gas nearest the sun: the third colour
 *   dust    what the dark lanes let through (a tint, not a light)
 *   sun     the far sun's own colour
 *   sky     the deep sky behind the canyon
 *   star    the far stars' tint
 */
export const NEBULA_PALETTES = Object.freeze([
    {
        name: 'aurora',
        glow: [0.05, 0.62, 0.34],
        deep: [0.02, 0.2, 0.42],
        accent: [0.85, 0.2, 0.62],
        dust: [0.16, 0.5, 0.38],
        sun: [0.82, 1.0, 0.9],
        sky: [0.001, 0.0045, 0.0052],
        star: [0.82, 1.0, 0.94],
    },
    {
        name: 'ion',
        glow: [0.03, 0.5, 0.66],
        deep: [0.1, 0.08, 0.52],
        accent: [0.95, 0.5, 0.2],
        dust: [0.14, 0.4, 0.55],
        sun: [0.78, 0.93, 1.0],
        sky: [0.0011, 0.003, 0.0075],
        star: [0.76, 0.93, 1.0],
    },
    {
        name: 'azure',
        glow: [0.05, 0.24, 0.8],
        deep: [0.26, 0.05, 0.5],
        accent: [0.95, 0.36, 0.3],
        dust: [0.2, 0.28, 0.62],
        sun: [0.8, 0.88, 1.0],
        sky: [0.0016, 0.0018, 0.0082],
        star: [0.8, 0.87, 1.0],
    },
    {
        name: 'violet',
        glow: [0.34, 0.09, 0.78],
        deep: [0.5, 0.03, 0.3],
        accent: [0.95, 0.42, 0.5],
        dust: [0.38, 0.22, 0.6],
        sun: [0.92, 0.86, 1.0],
        sky: [0.0028, 0.0012, 0.0075],
        star: [0.9, 0.84, 1.0],
    },
    {
        name: 'rose',
        glow: [0.72, 0.06, 0.4],
        deep: [0.5, 0.1, 0.05],
        accent: [0.2, 0.6, 0.95],
        dust: [0.56, 0.2, 0.36],
        sun: [1.0, 0.88, 0.9],
        sky: [0.0042, 0.001, 0.0044],
        star: [1.0, 0.86, 0.9],
    },
    {
        name: 'solar',
        glow: [0.8, 0.3, 0.04],
        deep: [0.4, 0.04, 0.42],
        accent: [0.1, 0.7, 0.66],
        dust: [0.6, 0.36, 0.16],
        sun: [1.0, 0.93, 0.78],
        sky: [0.0046, 0.0014, 0.002],
        star: [1.0, 0.9, 0.78],
    },
]);

export const PALETTE_KEYS = Object.freeze(['glow', 'deep', 'accent', 'dust', 'sun', 'sky', 'star']);

/** The palette level 1 starts on (ion), as an index into NEBULA_PALETTES. */
export const PALETTE_HOME = 1;
/** Seconds the clock alone takes to carry the canyon one palette along. A level-up is one step. */
export const PALETTE_STEP = 85;
/** The share of a step, at each end, that the canyon rests on a palette before moving on. */
export const PALETTE_REST = 0.15;

/**
 * Where the canyon stands for a level's place and the clock: the two simply add. `levelPlace` is
 * level − 1 (eased by the world when a level changes).
 */
export const palettePlace = (levelPlace, time) => levelPlace + Math.max(0, time) / PALETTE_STEP;

/**
 * A place on the palettes' line as (index, next, mix). The line is walked there and back
 * (…ion, azure, violet, rose, solar, rose, violet, azure, ion, aurora, ion…), so every step is
 * between hue neighbours; there is no wrap from one end to the other.
 */
export function palettePhase(place) {
    const last = NEBULA_PALETTES.length - 1;
    const period = last * 2;
    let x = (((place + PALETTE_HOME) % period) + period) % period;
    if (x > last) x = period - x;
    const index = Math.min(last - 1, Math.floor(x));
    return { index, next: index + 1, mix: smooth(PALETTE_REST, 1 - PALETTE_REST, x - index) };
}

/** The palette at a place: every colour mixed between two neighbours. Fills and returns `out`. */
export function paletteAt(place, out = {}) {
    const { index, next, mix } = palettePhase(place);
    const from = NEBULA_PALETTES[index];
    const to = NEBULA_PALETTES[next];
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
    return NEBULA_PALETTES[mix < 0.5 ? index : next].name;
}

/** The colour a clear's fronts and a jump's flash come in. */
export const DRIVEFIRE = Object.freeze([0.86, 0.95, 1.0]);

/**
 * Where the sun (the point the course runs to) hangs for an aspect ratio, as screen fractions,
 * y down. Landscape leaves the centre to the board: the sun stands left of the card and the
 * canyon sweeps past behind it. Upright phones show sky above and below the card, so the sun
 * rises there. `hFov` is the horizontal field of view the rig holds at rest (degrees).
 */
export function courseAnchors(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const k = smooth(0.62, 0.95, a);
    const roomy = smooth(1.0, 1.6, a);
    const wide = smooth(1.5, 2.3, a);
    return {
        x: lerp(0.4, lerp(0.2, lerp(0.225, 0.25, wide), roomy), k),
        y: lerp(0.105, lerp(0.42, 0.455, roomy), k),
        hFov: lerp(58, lerp(74, lerp(86, 92, wide), roomy), k),
    };
}
