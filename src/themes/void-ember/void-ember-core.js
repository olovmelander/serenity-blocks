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

// ── The crust's plates, baked ──────────────────────────────────────────────────

/**
 * The plates of the star's crust: cellular noise on the unit sphere, at two scales (the plates and
 * the finer crackle inside them). Baked once on the CPU into six faces of a cube laid out 3 × 2,
 * so the photosphere reads it with one fetch instead of searching 27 cells per pixel twice (that
 * search cost a third of the scene pass on an integrated GPU). The pattern lives in the star's own
 * frame; the photosphere's warp moves it.
 */
export const PLATES = Object.freeze({
    /** Cells per unit of the sphere's radius: the plates, and the crackle. */
    scale: 4.3,
    chips: 10.5,
    /** Texels per cube face, and the gutter round each face (continued pattern, for filtering). */
    face: 320,
    gutter: 3,
    /** The distances stored, 0..1 of the channel. */
    range: 0.5,
});

/** The atlas's size in texels: 3 tiles across, 2 down. */
export function plateAtlasSize(face = PLATES.face, gutter = PLATES.gutter) {
    const tile = face + gutter * 2;
    return { width: tile * 3, height: tile * 2, tile };
}

/**
 * The cube face a direction falls on and where on it (u, v in −1..1). Faces 0..5 are +x, −x, +y,
 * −y, +z, −z. TSL twin: the lookup in void-ember-star.js. Writes into `out` = [face, u, v].
 */
export function cubeFace(x, y, z, out = [0, 0, 0]) {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    if (ax >= ay && ax >= az) {
        out[0] = x >= 0 ? 0 : 1; out[1] = y / ax; out[2] = z / ax;
    } else if (ay >= az) {
        out[0] = y >= 0 ? 2 : 3; out[1] = z / ay; out[2] = x / ay;
    } else {
        out[0] = z >= 0 ? 4 : 5; out[1] = x / az; out[2] = y / az;
    }
    return out;
}

/** The direction at (u, v) of cube face `face` (not normalised). The inverse of cubeFace. */
function faceDirection(face, u, v, out) {
    const s = face % 2 === 0 ? 1 : -1;
    if (face < 2) { out[0] = s; out[1] = u; out[2] = v; } else if (face < 4) {
        out[0] = v; out[1] = s; out[2] = u;
    } else { out[0] = u; out[1] = v; out[2] = s; }
    return out;
}

/** A cell lattice's feature points (xyz in the cell, jittered) and numbers, for cells in −n..n. */
function featurePoints(n, seed) {
    const side = n * 2 + 1;
    const rand = mulberry32(seed);
    const pts = new Float32Array(side * side * side * 4);
    for (let i = 0; i < pts.length; i += 4) {
        pts[i] = 0.07 + rand() * 0.86;
        pts[i + 1] = 0.07 + rand() * 0.86;
        pts[i + 2] = 0.07 + rand() * 0.86;
        pts[i + 3] = rand();
    }
    return { pts, n, side };
}

/** (F2 − F1, the nearest cell's number) at point (x, y, z) of a feature-point lattice. */
function cellsAt(lattice, x, y, z, out) {
    const { pts, n, side } = lattice;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const cz = Math.floor(z);
    let f1 = 64;
    let f2 = 64;
    let id = 0;
    for (let dz = -1; dz <= 1; dz++) {
        const kz = cz + dz;
        const iz = (kz + n) * side * side;
        for (let dy = -1; dy <= 1; dy++) {
            const ky = cy + dy;
            const iy = iz + (ky + n) * side;
            for (let dx = -1; dx <= 1; dx++) {
                const kx = cx + dx;
                const j = (iy + kx + n) * 4;
                const ex = kx + pts[j] - x;
                const ey = ky + pts[j + 1] - y;
                const ez = kz + pts[j + 2] - z;
                const d = ex * ex + ey * ey + ez * ez;
                if (d < f1) {
                    f2 = f1;
                    f1 = d;
                    id = pts[j + 3];
                } else if (d < f2) f2 = d;
            }
        }
    }
    out[0] = Math.sqrt(f2) - Math.sqrt(f1);
    out[1] = id;
    return out;
}

/**
 * Bake the plates: RGBA8, R = the plates' F2 − F1 (0 on a crack) over PLATES.range, G = the plate's
 * own number, B = the crackle's F2 − F1, A = the crackle's cell number.
 * @returns {{ data: Uint8Array, width: number, height: number }}
 */
export function bakePlates(seed = 5179, face = PLATES.face, gutter = PLATES.gutter) {
    const { width, height, tile } = plateAtlasSize(face, gutter);
    const plates = featurePoints(Math.ceil(PLATES.scale) + 2, seed);
    const chips = featurePoints(Math.ceil(PLATES.chips) + 2, seed + 1);
    const data = new Uint8Array(width * height * 4);
    const dir = [0, 0, 0];
    const a = [0, 0];
    const b = [0, 0];
    const k = 255 / PLATES.range;
    for (let f = 0; f < 6; f++) {
        const ox = (f % 3) * tile;
        const oy = Math.floor(f / 3) * tile;
        for (let j = 0; j < tile; j++) {
            const v = ((j + 0.5 - gutter) / face) * 2 - 1;
            for (let i = 0; i < tile; i++) {
                const u = ((i + 0.5 - gutter) / face) * 2 - 1;
                faceDirection(f, u, v, dir);
                const inv = 1 / Math.hypot(dir[0], dir[1], dir[2]);
                const x = dir[0] * inv;
                const y = dir[1] * inv;
                const z = dir[2] * inv;
                cellsAt(plates, x * PLATES.scale, y * PLATES.scale, z * PLATES.scale, a);
                cellsAt(chips, x * PLATES.chips, y * PLATES.chips, z * PLATES.chips, b);
                const o = ((oy + j) * width + ox + i) * 4;
                data[o] = Math.min(255, Math.round(a[0] * k));
                data[o + 1] = Math.round(a[1] * 255);
                data[o + 2] = Math.min(255, Math.round(b[0] * k));
                data[o + 3] = Math.round(b[1] * 255);
            }
        }
    }
    return { data, width, height };
}
