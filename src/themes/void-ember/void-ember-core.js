/**
 * Void Ember — constants and CPU maths shared by the choreography and the shaders.
 * Three-free: the director, the layout and their tests import only this.
 *
 * The scene is measured in star radii. The ember (a dying star) has its own frame: its axis is
 * local Y and the frame turns with the star, so a flare site keeps its coordinates while the
 * star carries it round. Everything else (the cinder belt, the cinder world, the comets a lock
 * throws) hangs off the star's centre.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** The ember and what orbits it (world units). */
export const EMBER = Object.freeze({
    radius: 10,
    /** The cinder belt: where its rocks ride (star radii), and how thick it is. */
    beltInner: 2.15,
    beltOuter: 3.9,
    beltPeak: 3.0,
    beltThickness: 0.2,
    /** The corona's billboard reaches this many radii. */
    coronaReach: 3.8,
    /** Seconds for one turn of the star at rest. */
    spinPeriod: 380,
});

/** Flare loops the star can hold at once: the board's (one per lock) and its own. */
export const LOCK_LOOPS = 18;
export const AMBIENT_LOOPS = 8;
export const LOOP_SLOTS = LOCK_LOOPS + AMBIENT_LOOPS;
/** Segments along one loop's ribbon. */
export const LOOP_SEGMENTS = 40;
/** Seconds a lock's loop stands before it sinks back (its light falls to 1/e in LOOP_HOLD). */
export const LOOP_HOLD = 26;
export const LOOP_LIFE = 70;
/** Seconds a loop takes to rise, and an erupting one to leave. */
export const LOOP_RISE = 0.55;
export const ERUPT_LIFE = 1.9;

/** Impact sites on the photosphere evaluated by the star's material. */
export const IMPACT_SLOTS = 8;
/** Clear waves (coronal mass ejections) in flight at once. */
export const WAVE_SLOTS = 4;
/** Comets in flight at once (a lock throws one, a hard drop three), and motes per comet. */
export const COMET_SLOTS = 12;
export const COMET_TAIL = 28;
/** Seconds a comet takes from the card to the star (scaled by the distance). */
export const COMET_FLIGHT = 0.4;

/** An impact's ripple over the photosphere: radians of arc per second, and its fade. */
export const IMPACT_SPEED = 1.5;
export const IMPACT_FADE = 2.4;

/**
 * A clear wave leaves the star and runs out through everything round it, slowing a little:
 * radius (star radii) = 1 + WAVE_REACH · (age / WAVE_TRAVEL)^WAVE_SHAPE.
 */
export const WAVE_REACH = 9;
export const WAVE_TRAVEL = 2.1;
export const WAVE_SHAPE = 0.82;
/** Seconds between two fronts of one wave (one front per cleared line), and a front's width. */
export const WAVE_FRONT_GAP = 0.16;
export const WAVE_FRONT_WIDTH = 0.085;
export const WAVE_AFTERGLOW = 2.6;
export const WAVE_LIVE = 9;

/** Seconds a four-line clear holds the ember's breath before it flares. */
export const HUSH_HOLD = 0.24;
/** Seconds the nova's shell takes to cross the frame, and its remnant to fade to 1/e. */
export const NOVA_TRAVEL = 1.9;
export const NOVA_REMNANT = 9;

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

// ── Heat ────────────────────────────────────────────────────────────────────────

/** The ember's heat at rest: a banked coal, mostly crust. */
export const REST_HEAT = 0.2;

/** The heat the longest chains reach: gold. Only a four-line clear takes the star past it. */
export const HEAT_CHAIN = 0.88;

/** The heat a chain of n clears blows the ember up to (REST_HEAT at rest, → HEAT_CHAIN). */
export function heatForCombo(combo) {
    return combo > 0 ? REST_HEAT + (HEAT_CHAIN - REST_HEAT) * (1 - Math.exp(-combo / 3.6)) : REST_HEAT;
}

/** Stops of the heat ramp: [heat, r, g, b], scene-linear, peak 1. CPU twin of veBlackbody. */
export const HEAT_RAMP = Object.freeze([
    [0.0, 0.6, 0.03, 0.004],
    [0.2, 1.0, 0.085, 0.01],
    [0.4, 1.0, 0.2, 0.018],
    [0.6, 1.0, 0.36, 0.045],
    [0.8, 1.0, 0.56, 0.13],
    [1.0, 1.0, 0.74, 0.34],
    [1.15, 1.0, 0.89, 0.66],
    [1.3, 1.0, 0.96, 0.9],
]);

/** The colour of something at `heat` (0 = a dying coal, 0.8 = gold, 1.3 = white). */
export function emberColor(heat, out = [0, 0, 0]) {
    const h = Math.max(0, Math.min(1.3, heat));
    let i = 0;
    while (i < HEAT_RAMP.length - 2 && h > HEAT_RAMP[i + 1][0]) i += 1;
    const a = HEAT_RAMP[i];
    const b = HEAT_RAMP[i + 1];
    const t = smooth(a[0], b[0], h);
    for (let c = 0; c < 3; c++) out[c] = lerp(a[c + 1], b[c + 1], t);
    return out;
}

/** How much light a surface at `heat` gives off (steep: the hot cells are what bloom). */
export function emberGlow(heat) {
    const h = Math.max(0, heat);
    return 0.035 + 2.6 * h ** 2.3;
}

// ── The clear wave ──────────────────────────────────────────────────────────────

/** How far (star radii from the centre) a wave's front has run `age` seconds after it left. */
export function waveRadius(age) {
    return age <= 0 ? 1 : 1 + WAVE_REACH * Math.min(1.6, age / WAVE_TRAVEL) ** WAVE_SHAPE;
}

/** Seconds after it leaves at which a wave's front passes a distance (star radii). */
export function wavePassTime(radii) {
    return WAVE_TRAVEL * (Math.max(0, radii - 1) / WAVE_REACH) ** (1 / WAVE_SHAPE);
}

// ── A loop's held light ─────────────────────────────────────────────────────────

/** What is left of a loop's light `age` seconds after its lock. */
export function loopHeld(age) {
    if (age < 0 || age > LOOP_LIFE) return 0;
    return Math.exp(-age / LOOP_HOLD) * (1 - smooth(LOOP_LIFE - 8, LOOP_LIFE, age));
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
 * colour that element burns in when it is thrown on the ember.
 */
export function pieceColor(value, fallback = 0xff5a2e) {
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
 * The void's palettes, all scene-linear, IN HUE ORDER: neighbours in this list are neighbours
 * in hue, so the void can drift from one to the next without passing through grey. The ember
 * keeps its own heat spectrum throughout; what changes is the dark it burns in:
 *   void              the sky's own colour
 *   dustA / dustB     the cold dust of the deep sky (lit by far starlight)
 *   rock              the cinder belt's stone (an albedo)
 *   fill              what little light reaches a rock's night side
 *   star              the far stars' tint
 */
export const VOID_PALETTES = Object.freeze([
    {
        name: 'verdigris',
        void: [0.0012, 0.0036, 0.0044],
        dustA: [0.03, 0.29, 0.21],
        dustB: [0.035, 0.13, 0.36],
        rock: [0.074, 0.08, 0.07],
        fill: [0.003, 0.012, 0.012],
        star: [0.8, 1.0, 0.92],
    },
    {
        name: 'abyss',
        void: [0.001, 0.003, 0.0062],
        dustA: [0.035, 0.22, 0.36],
        dustB: [0.06, 0.1, 0.4],
        rock: [0.07, 0.076, 0.08],
        fill: [0.003, 0.011, 0.018],
        star: [0.74, 0.94, 1.0],
    },
    {
        name: 'indigo',
        void: [0.0016, 0.0013, 0.0052],
        dustA: [0.05, 0.075, 0.3],
        dustB: [0.2, 0.05, 0.3],
        rock: [0.085, 0.07, 0.066],
        fill: [0.005, 0.007, 0.02],
        star: [0.78, 0.86, 1.0],
    },
    {
        name: 'violet',
        void: [0.0026, 0.001, 0.0052],
        dustA: [0.2, 0.045, 0.32],
        dustB: [0.07, 0.05, 0.34],
        rock: [0.086, 0.066, 0.078],
        fill: [0.009, 0.004, 0.02],
        star: [0.9, 0.82, 1.0],
    },
    {
        name: 'garnet',
        void: [0.0034, 0.0009, 0.0026],
        dustA: [0.26, 0.04, 0.12],
        dustB: [0.1, 0.04, 0.3],
        rock: [0.09, 0.066, 0.062],
        fill: [0.012, 0.004, 0.012],
        star: [1.0, 0.84, 0.86],
    },
]);

export const PALETTE_KEYS = Object.freeze(['void', 'dustA', 'dustB', 'rock', 'fill', 'star']);

/** The palette level 1 starts on (indigo), as an index into VOID_PALETTES. */
export const PALETTE_HOME = 2;
/** Seconds the clock alone takes to carry the void one palette along. A level-up is one step. */
export const PALETTE_STEP = 80;
/** The share of a step, at each end, that the void rests on a palette before moving on. */
export const PALETTE_REST = 0.15;

/**
 * Where the void stands for a level's place and the clock: the two simply add. `levelPlace` is
 * level − 1 (eased by the world when a level changes).
 */
export const palettePlace = (levelPlace, time) => levelPlace + Math.max(0, time) / PALETTE_STEP;

/**
 * A place on the palettes' line as (index, next, mix). The line is walked there and back
 * (…indigo, violet, garnet, violet, indigo, abyss, verdigris, abyss, indigo…), so every step is
 * between hue neighbours; there is no wrap from one end to the other.
 */
export function palettePhase(place) {
    const last = VOID_PALETTES.length - 1;
    const period = last * 2;
    let x = (((place + PALETTE_HOME) % period) + period) % period;
    if (x > last) x = period - x;
    const index = Math.min(last - 1, Math.floor(x));
    return { index, next: index + 1, mix: smooth(PALETTE_REST, 1 - PALETTE_REST, x - index) };
}

/** The palette at a place: every colour mixed between two neighbours. Fills and returns `out`. */
export function paletteAt(place, out = {}) {
    const { index, next, mix } = palettePhase(place);
    const from = VOID_PALETTES[index];
    const to = VOID_PALETTES[next];
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
    return VOID_PALETTES[mix < 0.5 ? index : next].name;
}

/** The colour a four-line clear flares in. */
export const NOVAFIRE = Object.freeze([1.0, 0.58, 0.16]);

/**
 * Where the ember hangs for an aspect ratio: its centre (screen fractions, y down), its radius
 * (screen heights), and the cinder world far off on the other side of the card. Landscape leaves
 * the centre to the board: the ember burns left of the card and the belt sweeps behind it.
 * Upright phones show sky above and below the card, so the ember rises there.
 */
export function emberAnchors(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const k = smooth(0.62, 0.95, a);
    const roomy = smooth(1.0, 1.6, a);
    const wide = smooth(1.5, 2.3, a);
    return {
        x: lerp(0.3, lerp(0.17, lerp(0.205, 0.235, wide), roomy), k),
        y: lerp(0.115, 0.5, k),
        radius: lerp(0.088, lerp(0.15, lerp(0.285, 0.3, wide), roomy), k),
        /** The belt's plane: how far it leans back from edge-on, and which way its long axis runs. */
        beltTilt: lerp(15, 12.5, k) * DEG,
        beltLean: lerp(10, 14, k) * DEG,
        /** The cinder world. */
        world: {
            x: lerp(0.8, lerp(0.905, 0.87, wide), k),
            y: lerp(0.9, lerp(0.115, 0.19, roomy), k),
            radius: lerp(0.036, lerp(0.05, 0.066, roomy), k),
        },
    };
}
