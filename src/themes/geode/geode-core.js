/**
 * Geode — constants and CPU maths shared by the plan, the choreography and the shaders.
 * Three-free: the layout, the director and their tests import only this.
 *
 * The cavity (arbitrary units, "spans"): an egg-shaped hollow, a surface of revolution about the
 * view axis. The camera floats near the origin looking down −Z at the far pole, where the wall
 * is thin and lit from behind: the heart. Every point of the wall has a coordinate
 *
 *   w    the angle (radians) from the heart, measured at the cavity's centre: 0 at the far pole,
 *        about 2.2 level with the camera;
 *   phi  the angle round the axis (0 = to the right, π/2 = up).
 *
 * Seen from the camera, lines of equal w are rings round the heart, so everything that travels
 * along the wall (a lock's ring, a clear's wave) reads as a ring that opens toward the viewer.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** The cavity: semi-axes (a across, c along the view), its centre on the axis, and its zones. */
export const CAVITY = Object.freeze({
    a: 34,
    c: 72,
    zc: -40,
    /** The wall is built out to here (the camera sits at about w = 2.16 and never looks back). */
    wMax: 2.34,
    /** The heart's window ends here; the agate bands run from here… */
    wHeart: 0.42,
    /** …to here, where the druzy takes over (the edge itself is ragged). */
    wBands: 1.3,
});

/**
 * How far (radians of w, peak to peak) the edge between the agate and the lining wanders: the
 * lining overgrows the agate in tongues and leaves bays of it bare.
 */
export const BAND_EDGE_WANDER = 0.7;

/** Gameplay slots evaluated by the materials. */
export const PULSE_SLOTS = 6;
export const STRIKE_SLOTS = 6;
export const CLEAR_SLOTS = 2;
/** Sparks in flight at once (a lock throws one, a hard drop three). */
export const WISP_SLOTS = 8;
/** Motes in one spark's tail. */
export const WISP_TAIL = 28;

/** A lock's ring leaves the heart: w = reach · PULSE_REACH · (1 − e^(−age/τ)), fading at PULSE_FADE /s. */
export const PULSE_REACH = 1.9;
export const PULSE_TAU = 0.62;
export const PULSE_FADE = 1.25;
export const PULSE_WIDTH = 0.05;

/** Where a spark lands a ripple runs over the wall: radius R · (1 − e^(−age/τ)) spans. */
export const STRIKE_REACH = 20;
export const STRIKE_TAU = 0.5;
export const STRIKE_FADE = 1.5;

/** Seconds a spark takes from the board to its crystal. */
export const WISP_FLIGHT = 0.4;

/**
 * Clear wave: leaves the heart and runs down the wall toward the viewer, gathering speed:
 * w = CLEAR_REACH · (age / CLEAR_TRAVEL)^CLEAR_SHAPE. One front per cleared line.
 */
export const CLEAR_REACH = 2.4;
export const CLEAR_TRAVEL = 1.9;
export const CLEAR_SHAPE = 1.3;
export const CLEAR_FRONT_GAP = 0.16;
export const CLEAR_FRONT_WIDTH = 0.026;
export const CLEAR_AFTERGLOW = 1.1;

/** Seconds the light a lock leaves in a crystal takes to fall to 1/e. */
export const STORE_HOLD = 26;
/** The most light one crystal holds (in lock units). */
export const STORE_MAX = 2.4;
/** A crystal's strike / release flash falls to 1/e in this many seconds. */
export const FLASH_FADE = 0.55;

/** Seconds a four-line clear holds the geode's breath before everything fires. */
export const HUSH_HOLD = 0.22;
/** Seconds the prismatic beams of a four-line clear stand. */
export const BEAM_LIFE = 2.6;
/** Seconds the fracture of a four-line clear takes to cross the wall, and to heal. */
export const FRACTURE_TRAVEL = 0.7;
export const FRACTURE_HEAL = 2.6;

/** Rings of crystals a chain of clears can grow round the heart. */
export const CROWN_RINGS = 8;
/** The crown's rings stand between these wall coordinates. */
export const CROWN_W0 = 1.2;
export const CROWN_W1 = 1.86;

/** Minerals the hero clusters are cut from (indices into a palette's `minerals`). */
export const MINERALS = 6;

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

// ── The wall ────────────────────────────────────────────────────────────────────

/** The smooth wall's point at (w, phi). */
export function wallPoint(w, phi, out = [0, 0, 0]) {
    const s = Math.sin(w);
    out[0] = CAVITY.a * s * Math.cos(phi);
    out[1] = CAVITY.a * s * Math.sin(phi);
    out[2] = CAVITY.zc - CAVITY.c * Math.cos(w);
    return out;
}

/** The unit normal of the smooth wall at (w, phi), pointing into the cavity. */
export function wallNormal(w, phi, out = [0, 0, 0]) {
    const s = Math.sin(w);
    const nx = (s * Math.cos(phi)) / CAVITY.a;
    const ny = (s * Math.sin(phi)) / CAVITY.a;
    const nz = -Math.cos(w) / CAVITY.c;
    const inv = -1 / Math.max(1e-9, Math.hypot(nx, ny, nz));
    out[0] = nx * inv;
    out[1] = ny * inv;
    out[2] = nz * inv;
    return out;
}

/** The wall coordinate w of any point in the cavity (the ring it stands on). */
export function wallW(x, y, z) {
    return Math.atan2(Math.hypot(x, y) / CAVITY.a, (CAVITY.zc - z) / CAVITY.c);
}

// ── Waves ───────────────────────────────────────────────────────────────────────

/** Where a lock's ring stands `age` seconds after the lock (wall coordinate). */
export function pulseFront(age, reach = 1) {
    return age <= 0 ? 0 : reach * PULSE_REACH * (1 - Math.exp(-age / PULSE_TAU));
}

/** How far a clear wave's first front has run `age` seconds after the clear (wall coordinate). */
export function clearFront(age) {
    return age <= 0 ? 0 : CLEAR_REACH * Math.min(1, age / CLEAR_TRAVEL) ** CLEAR_SHAPE;
}

/** Seconds after the clear at which its first front passes wall coordinate `w`. */
export function clearPassTime(w) {
    return CLEAR_TRAVEL * clamp01(w / CLEAR_REACH) ** (1 / CLEAR_SHAPE);
}

/** The geode's charge for a combo of n (0 at rest, → 1). */
export function powerForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.2) : 0;
}

/** Rings of the crown a combo of n has grown: one for every step of the chain past the first. */
export function crownForCombo(combo) {
    return Math.max(0, Math.min(CROWN_RINGS, Math.round(combo) - 1));
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

/** A piece colour (CSS hex string or number) as a scene-linear, peak-normalised [r, g, b]. */
export function pieceColor(value, fallback = 0xffd060) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    // Push a pale colour toward its own hue, and keep a floor in every channel so a pure primary
    // still reaches all three of the bloom's channels.
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.72) / (1 - lo * 0.72);
        return pushed * 0.95 + 0.05;
    });
}

/** A saturated spectral colour for a hue in turns (0 = red, 1/3 = green, 2/3 = blue), scene-linear. */
export function spectrum(h) {
    const k = (o) => {
        const s = 0.5 + 0.5 * Math.cos(TAU * (h - o));
        return s * s * 1.3 + 0.02;
    };
    return [k(0), k(1 / 3), k(2 / 3)];
}

/** The colour each ring of the crown burns in: the chain climbs the spectrum from gold. */
export const CROWN_COLORS = Object.freeze(
    [0.1, 0.045, 0.97, 0.88, 0.76, 0.62, 0.5, 0.36].map((h) => Object.freeze(spectrum(h))),
);

const pal = (name, c) => Object.freeze({
    name,
    heart: linRGB(c.heart),
    fill: linRGB(c.fill),
    rock: linRGB(c.rock),
    druzy: linRGB(c.druzy),
    band0: linRGB(c.bands[0]),
    band1: linRGB(c.bands[1]),
    band2: linRGB(c.bands[2]),
    band3: linRGB(c.bands[3]),
    m0: linRGB(c.minerals[0]),
    m1: linRGB(c.minerals[1]),
    m2: linRGB(c.minerals[2]),
    m3: linRGB(c.minerals[3]),
    m4: linRGB(c.minerals[4]),
    m5: linRGB(c.minerals[5]),
});

/**
 * One mineral per level (cycled), authored in sRGB, held scene-linear:
 *   heart     the light that comes through the far wall
 *   fill      the cool light on the faces turned to the viewer
 *   rock      the matrix between the crystals
 *   druzy     the hue the lining leans to
 *   band0..3  the agate's bands, in the order they repeat
 *   m0..m5    the minerals the hero clusters are cut from
 */
export const GEODE_PALETTES = Object.freeze([
    pal('amethyst', {
        heart: 0xffc27a,
        fill: 0x8a78ff,
        rock: 0x1a1026,
        druzy: 0x8a4dff,
        bands: [0xf2a23a, 0xfff0d2, 0xb5452a, 0xc77ad6],
        minerals: [0x9a4dff, 0xffb42a, 0xff5a9a, 0x35d4ff, 0xff3a3a, 0x3dff8a],
    }),
    pal('citrine', {
        heart: 0xffe2a8,
        fill: 0xffb070,
        rock: 0x1c1208,
        druzy: 0xffa530,
        bands: [0xffd27a, 0xfff6e0, 0xd9731a, 0x8a4a1a],
        minerals: [0xffb42a, 0xff7a2a, 0xfff0b0, 0x9a4dff, 0xff5a9a, 0x35d4ff],
    }),
    pal('rhodochrosite', {
        heart: 0xffd0c0,
        fill: 0xff8ac8,
        rock: 0x200c18,
        druzy: 0xff5aa8,
        bands: [0xff8fb0, 0xffe8ec, 0xc2305a, 0xf2a070],
        minerals: [0xff5a9a, 0xffa0c8, 0xb04dff, 0xffb42a, 0x35d4ff, 0xff3a3a],
    }),
    pal('celestine', {
        heart: 0xd8ecff,
        fill: 0x70a8ff,
        rock: 0x0a1424,
        druzy: 0x4da8ff,
        bands: [0x8ac4ff, 0xf0f8ff, 0x3a6ab0, 0x7ae0e0],
        minerals: [0x35a0ff, 0x7af0ff, 0x8a6dff, 0xe8f4ff, 0x3dff8a, 0xff5a9a],
    }),
    pal('malachite', {
        heart: 0xe8ffb0,
        fill: 0x40e0a0,
        rock: 0x061a12,
        druzy: 0x25e07a,
        bands: [0x2ad47a, 0xc8ffd8, 0x0a6a40, 0x40d8c8],
        minerals: [0x3dff8a, 0x35d4ff, 0xc8ff4a, 0x9a4dff, 0xffb42a, 0xff5a9a],
    }),
    pal('fire-opal', {
        heart: 0xffb070,
        fill: 0xff6a50,
        rock: 0x1c0a06,
        druzy: 0xff5a2a,
        bands: [0xff7a2a, 0xffe0a0, 0xc21a1a, 0xffb42a],
        minerals: [0xff3a3a, 0xff8a2a, 0xffd04a, 0xff5a9a, 0x9a4dff, 0x35d4ff],
    }),
]);

export const PALETTE_KEYS = Object.freeze([
    'heart', 'fill', 'rock', 'druzy', 'band0', 'band1', 'band2', 'band3',
    'm0', 'm1', 'm2', 'm3', 'm4', 'm5',
]);

/** The colour a four-line clear fires in. */
export const GEODEFIRE = Object.freeze([1.0, 0.9, 0.72]);
