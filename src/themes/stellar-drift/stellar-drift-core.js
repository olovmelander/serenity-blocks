/**
 * Stellar Drift — constants and CPU maths shared by the choreography and the shaders.
 * Three-free: the director, the layout and their tests import only this.
 *
 * The scene is measured in radii of the giant. The world's frame IS the giant's: its centre is
 * the origin, its spin axis and the rings' normal are +Y, the rings lie in the XZ plane, and the
 * camera stands off toward +Z, a little above the rings. Longitude is measured from +X toward
 * +Z (atan2(z, x)), latitude from the ring plane.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** The giant. */
export const GIANT = Object.freeze({
    radius: 1,
    /** Seconds the cloud flow takes to run one cross-fade cycle (two reads half a cycle apart). */
    flowCycle: 150,
    /** Scale height of the limb's haze (radii). */
    hazeHeight: 0.011,
});

/**
 * The rings (radii from the giant's centre). The profile texture covers `from`..`to`; the names
 * are the ones a ringed giant's parts have had since Huygens: a thin inner ring (C), the broad
 * bright one (B), a division, the outer ring (A) with its two gaps, and a strand outside it (F).
 */
export const RINGS = Object.freeze({
    from: 1.2,
    to: 2.42,
    cInner: 1.24,
    bInner: 1.525,
    bOuter: 1.95,
    aInner: 2.025,
    aOuter: 2.27,
    strand: 2.33,
    /** The thin haze of ice the camera drifts in: where it is thickest, and how far it reaches. */
    hazeInner: 2.5,
    hazePeak: 3.6,
    hazeOuter: 7.5,
    hazeThickness: 0.16,
});

/** A ring particle's turn about the giant at radius r (radians per second), Kepler's r^-1.5. */
export const RING_RATE = 0.021;
export const ringOmega = (r) => RING_RATE * Math.max(0.5, r) ** -1.5;

// ── Event pools ─────────────────────────────────────────────────────────────────

/** Ripples a lock leaves in the rings, live at once. */
export const RIPPLE_SLOTS = 16;
/**
 * Seconds a ripple lives (its front is gone in three; the stain it leaves in the ice lingers),
 * how fast its front runs out (radii per second), and how much faster than the rings really
 * turn the shear winds it (the true rate would take minutes to show).
 */
export const RIPPLE_LIFE = 22;
export const RIPPLE_SPEED = 0.42;
export const RIPPLE_SHEAR = 30;
/** Chimes: a clear's light running out through the whole ring system (one front per line). */
export const CHIME_SLOTS = 4;
export const CHIME_TRAVEL = 1.5;
export const CHIME_FRONT_GAP = 0.17;
export const CHIME_LIVE = 7;
/** Jets: a cleared row written round the giant as a streak of light on its own latitude. */
export const JET_SLOTS = 8;
export const JET_SPEED = 2.4;
export const JET_LIFE = 5.5;
/**
 * Strikes on the cloud tops: a meteor's fireball, the shock it sends through the cloud, an ember,
 * and a scar with a crescent of ejecta that the band's own wind shears as it lingers.
 */
export const STRIKE_SLOTS = 8;
export const STRIKE_LIFE = 16;
/** A strike's size on the cloud (radians) for its strength. */
export const strikeSize = (strength) => 0.035 + strength * 0.03;
/** Lightning cells under the night side's cloud. */
export const BOLT_SLOTS = 10;
/** Meteors in flight at once, and motes of each one's tail. */
export const METEOR_SLOTS = 14;
/** Seconds a lock's mote takes from the card to the rings. */
export const MOTE_FLIGHT = 0.42;
/**
 * Seconds the train behind a meteor and behind a lock's mote glows on after the head has passed:
 * the ionised trail cools from white through the piece's colour into a fading, widening train.
 */
export const METEOR_TRAIN = 1.2;
export const MOTE_TRAIN = 0.5;

/**
 * The flourishes the larger rewards play on the giant itself (one of each at a time; a new one
 * takes the place of the last). Seconds each lives:
 *   cyclone   a T-spin winds a storm into the cloud bands, its arms lit in the piece's colour
 *   surge     a chain's milestone sends two arcs of its light racing both ways round the rings
 *   strand    a back-to-back clear sets the rings' outer strand ablaze, braided and knotted
 *   shock     four lines, a perfect clear or a new level throw a torn shell of light off the giant
 */
export const CYCLONE_LIFE = 8;
export const SURGE_LIFE = 3.4;
export const STRAND_LIFE = 4.2;
export const SHOCK_LIFE = 3.2;
/** A surge runs round the oval this fast (radians of longitude per second). */
export const SURGE_SPEED = 1.9;

/** Rows of the event table the world shader reads (vec4 each), by block. */
export const EVENT_ROWS = Object.freeze({
    ripple: 0, // 2 rows each
    chime: RIPPLE_SLOTS * 2, // 2 rows each
    jet: RIPPLE_SLOTS * 2 + CHIME_SLOTS * 2, // 2 rows each
    strike: RIPPLE_SLOTS * 2 + CHIME_SLOTS * 2 + JET_SLOTS * 2, // 2 rows each
    bolt: RIPPLE_SLOTS * 2 + CHIME_SLOTS * 2 + JET_SLOTS * 2 + STRIKE_SLOTS * 2, // 2 rows each
    total: RIPPLE_SLOTS * 2 + CHIME_SLOTS * 2 + JET_SLOTS * 2 + STRIKE_SLOTS * 2 + BOLT_SLOTS * 2,
});

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

/** A bell with compact support: (1 − x²)² inside |x| < 1, else 0. */
export function bell(x) {
    const k = 1 - x * x;
    return k > 0 ? k * k : 0;
}

// ── Colour ──────────────────────────────────────────────────────────────────────

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** An sRGB hex as scene-linear [r, g, b]. */
export function linRGB(hex) {
    return [
        srgbToLinear(((hex >> 16) & 255) / 255),
        srgbToLinear(((hex >> 8) & 255) / 255),
        srgbToLinear((hex & 255) / 255),
    ];
}

/** A scene-linear channel as an sRGB byte. */
export const srgbByte = (v) => Math.round(clamp01(linearToSrgb(clamp01(v))) * 255);

/**
 * A piece colour (CSS hex string or number) as a scene-linear, peak-normalised [r, g, b]: the
 * colour that piece's light has in the rings and on the cloud tops.
 */
export function pieceColor(value, fallback = 0x5ee7df) {
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
        const pushed = (n - lo * 0.55) / (1 - lo * 0.55);
        return pushed * 0.94 + 0.06;
    });
}

/** Saturation of a scene-linear colour (0 = grey, 1 = a pure hue). */
export function saturationOf(rgb) {
    const hi = Math.max(rgb[0], rgb[1], rgb[2]);
    const lo = Math.min(rgb[0], rgb[1], rgb[2]);
    return hi <= 1e-6 ? 0 : (hi - lo) / hi;
}

// ── The hours: six worlds on a wheel ────────────────────────────────────────────

const L = linRGB;

/**
 * The palettes, scene-linear, ON A WHEEL: each is a neighbour in hue of the one before and the
 * one after, and the last leads back to the first. Level 1 starts on `amber`; the clock alone
 * carries the picture one palette on every PALETTE_STEP seconds, and a level-up is one step.
 *
 *   zoneA / zoneB   the giant's bright cloud zones (two tones a band is mixed between)
 *   beltA / beltB   its dark belts
 *   polar           the mottled cloud of its poles
 *   storm           the great oval, and the small ones
 *   haze            the limb's haze, and the light of its twilight
 *   night           what the night side keeps (the sky's own light on the cloud)
 *   sun             the star's light
 *   ringIce / ringDust   the rings' bright ice and their darker dust
 *   gasA / gasB     the nebula's two gases
 *   deep            the sky's own colour
 *   starTint        the far stars
 *   bolt            lightning under the cloud
 *   moonIce / moonRust       the two moons
 */
export const PALETTES = Object.freeze([
    {
        name: 'amber',
        zoneA: L(0xf3e2c3),
        zoneB: L(0xe8c99a),
        beltA: L(0xb0633a),
        beltB: L(0x7a4630),
        polar: L(0x8d7a66),
        storm: L(0xcf4a2c),
        haze: L(0xffd9a6),
        night: L(0x1a2440),
        sun: [1.0, 0.93, 0.82],
        ringIce: L(0xf2e6d2),
        ringDust: L(0x9a7a5c),
        gasA: L(0x16c9c2),
        gasB: L(0x7a3cf0),
        deep: [0.0016, 0.0026, 0.0072],
        starTint: [0.84, 0.92, 1.0],
        bolt: L(0xbfd4ff),
        moonIce: L(0xdfeeff),
        moonRust: L(0xd98a4a),
    },
    {
        name: 'rose',
        zoneA: L(0xf7ddd4),
        zoneB: L(0xf0bfb2),
        beltA: L(0xb64a60),
        beltB: L(0x7a3050),
        polar: L(0x7c5a70),
        storm: L(0xffd070),
        haze: L(0xffc9c0),
        night: L(0x24183c),
        sun: [1.0, 0.9, 0.86],
        ringIce: L(0xf6e2de),
        ringDust: L(0xa06a70),
        gasA: L(0x2aa0ff),
        gasB: L(0xd43cc0),
        deep: [0.0026, 0.0018, 0.0068],
        starTint: [0.92, 0.88, 1.0],
        bolt: L(0xffd0f0),
        moonIce: L(0xf4e6f4),
        moonRust: L(0xd0705a),
    },
    {
        name: 'orchid',
        zoneA: L(0xe6d8f6),
        zoneB: L(0xcdb4ec),
        beltA: L(0x7e52b6),
        beltB: L(0x4a3a8e),
        polar: L(0x4c4680),
        storm: L(0xff8ac4),
        haze: L(0xe0c4ff),
        night: L(0x1c1640),
        sun: [0.95, 0.9, 1.0],
        ringIce: L(0xe8e0f6),
        ringDust: L(0x7a6a9c),
        gasA: L(0x3c6cff),
        gasB: L(0xff4f9a),
        deep: [0.0022, 0.0016, 0.0078],
        starTint: [0.88, 0.86, 1.0],
        bolt: L(0xe0c8ff),
        moonIce: L(0xe6e2ff),
        moonRust: L(0xb86a8a),
    },
    {
        name: 'azure',
        zoneA: L(0xc4e2ff),
        zoneB: L(0x8cbef2),
        beltA: L(0x3068cc),
        beltB: L(0x1f3f98),
        polar: L(0x1c3074),
        storm: L(0xf2faff),
        haze: L(0xa8d4ff),
        night: L(0x0e1c40),
        sun: [0.88, 0.94, 1.0],
        ringIce: L(0xdcecff),
        ringDust: L(0x60789c),
        gasA: L(0x5a48f0),
        gasB: L(0x20c4e8),
        deep: [0.0012, 0.0024, 0.0084],
        starTint: [0.8, 0.9, 1.0],
        bolt: L(0xc8e8ff),
        moonIce: L(0xd8ecff),
        moonRust: L(0x8a8ab0),
    },
    {
        name: 'jade',
        zoneA: L(0xccf4ea),
        zoneB: L(0x9fe2d0),
        beltA: L(0x2f9e8c),
        beltB: L(0x1f6c70),
        polar: L(0x1e5860),
        storm: L(0xfff0b4),
        haze: L(0xa8ffe4),
        night: L(0x0c2238),
        sun: [0.9, 1.0, 0.94],
        ringIce: L(0xdaf4ea),
        ringDust: L(0x5c8c80),
        gasA: L(0x20b8e0),
        gasB: L(0x30e08a),
        deep: [0.001, 0.003, 0.0066],
        starTint: [0.82, 1.0, 0.94],
        bolt: L(0xd0fff0),
        moonIce: L(0xdcfaf0),
        moonRust: L(0x9ab070),
    },
    {
        name: 'gold',
        zoneA: L(0xf6eebc),
        zoneB: L(0xe8d88e),
        beltA: L(0xbc9a3a),
        beltB: L(0x8a742c),
        polar: L(0x706c44),
        storm: L(0xff9a52),
        haze: L(0xfff0a8),
        night: L(0x1a2630),
        sun: [1.0, 0.97, 0.8],
        ringIce: L(0xf4eccc),
        ringDust: L(0x94844e),
        gasA: L(0x24cc98),
        gasB: L(0xa8c830),
        deep: [0.0014, 0.003, 0.0052],
        starTint: [0.94, 0.98, 0.9],
        bolt: L(0xfff2c0),
        moonIce: L(0xf2f2dc),
        moonRust: L(0xd0a040),
    },
]);

export const PALETTE_COUNT = PALETTES.length;

/** The colours the world mixes on the CPU and hands to the shaders as uniforms. */
export const PALETTE_KEYS = Object.freeze([
    'storm', 'haze', 'night', 'sun', 'ringIce', 'ringDust', 'gasA', 'gasB', 'deep', 'starTint',
    'bolt', 'moonIce', 'moonRust',
]);

/** The colours baked into the band texture, one row per palette. */
export const BAND_KEYS = Object.freeze(['zoneA', 'zoneB', 'beltA', 'beltB', 'polar']);

/** Seconds the clock alone takes to carry the picture one palette along. A level-up is one step. */
export const PALETTE_STEP = 90;
/** The share of a step, at each end, that the picture rests on a palette before moving on. */
export const PALETTE_REST = 0.15;

/**
 * Where the picture stands for a level's place and the clock: the two simply add. `levelPlace`
 * is level − 1 (eased by the world when a level changes).
 */
export const palettePlace = (levelPlace, time) => levelPlace + Math.max(0, time) / PALETTE_STEP;

/** A place on the wheel as (index, next, mix, turn): `turn` is the raw 0..1 way through the step. */
export function palettePhase(place) {
    const n = PALETTE_COUNT;
    const x = ((place % n) + n) % n;
    const index = Math.min(n - 1, Math.floor(x));
    const frac = x - index;
    return {
        index,
        next: (index + 1) % n,
        mix: smooth(PALETTE_REST, 1 - PALETTE_REST, frac),
        turn: clamp01((frac - PALETTE_REST) / (1 - 2 * PALETTE_REST)),
    };
}

/** The palette at a place: every uniform colour mixed between two neighbours. Fills `out`. */
export function paletteAt(place, out = {}) {
    const { index, next, mix } = palettePhase(place);
    const from = PALETTES[index];
    const to = PALETTES[next];
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
    return PALETTES[mix < 0.5 ? index : next].name;
}

/**
 * Where the giant's bands read their colours in the band texture: the row index plus the way
 * through the step. The bands do not blend together: each takes the next palette at its own
 * moment (the shader staggers them by latitude), so a turn of the hour crosses the giant like
 * weather.
 */
export function bandPlace(place) {
    const { index, turn } = palettePhase(place);
    return index + Math.min(0.9999, turn);
}

/**
 * The way to the sun for a place on the wheel (a unit vector, the world's frame; the camera
 * stands off toward +Z). The star keeps to the giant's left and swings from behind the camera
 * (an almost full disc) round toward the far side (a crescent, the rings lit from behind) and
 * back, once per turn of the wheel; it rides a little higher over the rings in between.
 */
export function sunDirection(place, out = [0, 0, 1]) {
    const turn = (place / PALETTE_COUNT) * TAU;
    const azimuth = (-86 + 26 * Math.cos(turn)) * DEG;
    const elevation = (25 + 4 * Math.sin(turn)) * DEG;
    out[0] = Math.cos(elevation) * Math.sin(azimuth);
    out[1] = Math.sin(elevation);
    out[2] = Math.cos(elevation) * Math.cos(azimuth);
    return out;
}

// ── The board on the giant ──────────────────────────────────────────────────────

/**
 * The latitude (radians) a board row is written on. The rings hide the giant's south from the
 * camera, so the board is laid over the hemisphere that shows: the floor on the equator's
 * bright zone, the top row far north.
 */
export function rowLatitude(row, rows = 20) {
    const up = rows - 1 - Math.max(0, Math.min(rows - 1, row));
    return (2 + up * 3.3) * DEG;
}

/** How strongly a chain of n clears warms the giant: its rings' hum, its lightning (0 at rest → 1). */
export function chainHeat(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.2) : 0;
}

// ── Composition ─────────────────────────────────────────────────────────────────

/**
 * Where the giant hangs for an aspect ratio: its centre (screen fractions, y down), its radius
 * (screen heights), how high the camera stands over the ring plane and how the system leans in
 * the frame; then the two moons, far off on the other side of the card. Landscape leaves the
 * centre to the board: the giant fills the left, the rings sweep behind the card. Upright
 * phones show sky above and below the card, so the giant rises there.
 */
export function giantAnchors(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const k = smooth(0.62, 0.95, a);
    const roomy = smooth(1.0, 1.6, a);
    const wide = smooth(1.5, 2.3, a);
    return {
        x: lerp(0.34, lerp(0.2, lerp(0.2, 0.225, wide), roomy), k),
        y: lerp(0.105, lerp(0.42, 0.47, roomy), k),
        radius: lerp(0.07, lerp(0.14, lerp(0.285, 0.3, wide), roomy), k),
        /** The camera's height over the ring plane, as an angle seen from the giant. */
        elevation: lerp(13, 11.5, k) * DEG,
        /** How far the giant's axis leans from the frame's upright (positive = its top to the left). */
        roll: lerp(10, 17, k) * DEG,
        moons: [
            {
                x: lerp(0.82, lerp(0.9, 0.875, wide), k),
                y: lerp(0.925, lerp(0.14, 0.2, roomy), k),
                radius: lerp(0.032, lerp(0.045, 0.072, roomy), k),
                depth: 0.5,
            },
            {
                x: lerp(0.12, lerp(0.86, 0.9, wide), k),
                y: lerp(0.955, lerp(0.88, 0.84, roomy), k),
                radius: lerp(0.012, lerp(0.016, 0.021, roomy), k),
                depth: 0.34,
            },
        ],
    };
}
