/**
 * Stillwater — core (CPU only, three-free).
 *
 * The tarn's numbers: the rest camera, the moon, the slot counts and timings of everything the
 * board can start, the hours of the night with their palettes, and the small pure functions the
 * world, the shaders' CPU twins and the tests share. Nothing here touches the GPU.
 *
 * World frame: metres, y up, the water lies at y = 0, the viewer stands on the near shore and
 * looks along −z across the tarn.
 */

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

// ── The rest camera ─────────────────────────────────────────────────────────────

export const EYE = Object.freeze({
    x: 0,
    y: 1.65,
    z: 6,
    /** It looks a little below the horizontal: the far waterline lies about 42% down the frame. */
    pitch: -3 * DEG,
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 68,
    minFov: 30,
    maxFov: 60,
    near: 0.15,
    far: 1200,
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
 * The banks, the trees and the two figures stand at x · squeeze, so a tall phone frame still
 * holds the spirit on one side of the card and the troll on the other.
 */
export function squeezeFor(aspect) {
    // (A little wider than the frame strictly allows: the figures stand in the strips beside the card.)
    return Math.max(0.4, Math.min(1, (halfWidthTan(aspect) / Math.tan((EYE.hFov * DEG) / 2)) * 1.2));
}

/** A unit direction from an azimuth (0 = straight ahead, + to the right) and an elevation. */
export function skyDirection(azimuth, elevation, out = [0, 0, 0]) {
    const c = Math.cos(elevation);
    out[0] = Math.sin(azimuth) * c;
    out[1] = Math.sin(elevation);
    out[2] = -Math.cos(azimuth) * c;
    return out;
}

// ── The moon ────────────────────────────────────────────────────────────────────

/** Where the moon stands on a wide frame: left of the card, over the spirit's bank. */
export const MOON = Object.freeze({ azimuth: -19.5 * DEG, elevation: 10.5 * DEG, radius: 1.15 * DEG });

/**
 * The moon's place for a frame: on a narrow one it comes in with the stage and climbs into the
 * strip of sky above the card.
 */
export function moonFor(aspect, out = { azimuth: 0, elevation: 0 }) {
    const s = squeezeFor(aspect);
    const narrow = clamp01((1 - s) / 0.6);
    out.azimuth = Math.atan(Math.tan(MOON.azimuth) * s);
    out.elevation = lerp(MOON.elevation, 25 * DEG, narrow);
    return out;
}

// ── The stage: who stands where (stage space: before the squeeze) ────────────────

/** The spirit's stone on the left bank, and how far out over the water a chain draws her. */
export const SPIRIT = Object.freeze({
    home: Object.freeze([-6.45, 0.32, -10.2]),
    /** Her furthest step toward the board (still clear of the card on a wide frame). */
    reach: Object.freeze([-3.6, 0.03, -9.2]),
    height: 1.72,
});

/** The troll's seat by the right bank's great spruce, and the water's edge he comes down to. */
export const TROLL = Object.freeze({
    home: Object.freeze([8.75, 0.5, -11.6]),
    reach: Object.freeze([7.55, 0.13, -10.5]),
    /** Metres from sole to the top of his back. */
    height: 2.9,
    /**
     * Metres of ground one cycle of his walk covers at that height: a quarter of his height, as
     * the cycle was authored (short, heavy steps).
     */
    stride: 0.72,
});

/** The gold heart that lies on the tarn's bed, behind where the card stands. */
export const HEART = Object.freeze([0.4, -1.4, -15]);

// ── Slots and timings ───────────────────────────────────────────────────────────

/** Rings on the water (a lock, a footfall, a splash). */
export const RING_SLOTS = 16;
/** Metres a second a ring's front runs at first, and the time constant it slows with. */
export const RING_SPEED = 2.6;
export const RING_SLOW = 5.5;
/** A ring is drawn for this long (seconds), fading the whole way. */
export const RING_LIVE = 8;

/** A ring's radius `age` seconds after it began. */
export function ringRadius(age, reach = 1) {
    if (!(age > 0)) return 0;
    return RING_SPEED * RING_SLOW * (1 - Math.exp(-age / RING_SLOW)) * reach;
}

/** A clear's swells: fronts that cross the tarn outward from over its heart, behind the card. */
export const STROKE_SLOTS = 4;
export const STROKE_SPEED = 7.5;
export const STROKE_GAP = 1.9;
export const STROKE_LIVE = 6;

/** Seconds after its birth that a swell passes a point `distance` metres from the heart. */
export function strokePassTime(distance) {
    return Math.abs(distance) / STROKE_SPEED;
}

/** Will-o'-the-wisps a lock leaves over the water. */
export const WISP_SLOTS = 20;
/** Seconds a wisp keeps its light if nothing gathers it. */
export const WISP_HOLD = 46;
/** Seconds it takes to rise out of the splash and to fly home when gathered. */
export const WISP_RISE = 1.1;
export const WISP_HOME = 1.25;

/** The drops of light that fall from the card. */
export const DROP_SLOTS = 8;
export const DROP_FLIGHT = 0.42;

/** A four-line clear holds the night's breath this long before the tarn answers. */
export const HUSH_HOLD = 0.3;
export const SURGE_COOL = 3.6;

/** Pairs of eyes that can open in the far wood. */
export const EYE_PAIRS = 28;

/** Combo → how far the two figures have come toward the board (0..1). */
export const APPROACH_STEPS = Object.freeze([0, 0.3, 0.48, 0.62, 0.74, 0.84, 0.92, 0.97, 1]);

export function approachForCombo(combo) {
    const n = Math.max(0, Math.round(Number(combo) || 0));
    return APPROACH_STEPS[Math.min(n, APPROACH_STEPS.length - 1)];
}

/** Combo → the wood's charge (0..1): fireflies, lit caps, shafts, the heart. */
export function powerForCombo(combo) {
    const n = Math.max(0, Number(combo) || 0);
    return clamp01(1 - Math.exp(-n / 3.4));
}

/** Combo → how many of the wood's eyes are open (0..1 of them). */
export function eyesForCombo(combo) {
    const n = Math.max(0, Number(combo) || 0);
    return clamp01((n - 2) / 6);
}

/** Combo → how much of the heart's gold shows through the water (0..1). */
export function heartForCombo(combo) {
    const n = Math.max(0, Number(combo) || 0);
    return clamp01((n - 4) / 5);
}

// ── Colour ──────────────────────────────────────────────────────────────────────

/** sRGB hex → scene-linear [r, g, b]. */
export function linRGB(hex) {
    const f = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}

/**
 * A piece colour as light: its hue at full strength (a pale colour is pushed toward its own
 * hue, and every channel keeps a floor so a pure primary still reaches all three of the
 * bloom's channels).
 */
export function pieceColor(value, fallback = 0xf2d68a) {
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
        const pushed = (n - lo * 0.7) / (1 - lo * 0.7);
        // (Half-way: these are the muted colours of a folk tale, not neon.)
        return (pushed * 0.55 + n * 0.45) * 0.94 + 0.06;
    });
}

// ── The hours of the night ──────────────────────────────────────────────────────

const hex = (h) => linRGB(Number.parseInt(h.slice(1), 16));

/**
 * Seven hours on a wheel, in the order of their hue, so that any two neighbours blend through a
 * colour and never through grey. A level stands on one; the clock moves the night on to the
 * next. Colours are written as the eye should meet them (sRGB) and stored scene-linear.
 *
 *   zenith / horizon   the sky overhead and low down, away from the moon
 *   glow               the moon's halo in the mist; moon = the disc itself
 *   haze / hazeLit     the mist far from the moon and toward it (the colour distance takes)
 *   forest             the far wood's silhouette before the mist has it
 *   deep               what little comes back from under the water
 *   bark moss ground stone needle   what things are made of
 *   moonLight skyAmb groundAmb      the light that falls on them
 *   spirit lantern firefly eye heart crest lily   the lights that live here
 *   stars mist aurora dawn          scalars: how many stars, how thick the mist, the northern
 *                                   lights, the first light low behind the trees
 */
const HOUR_DEFS = [
    {
        name: 'blue hour',
        zenith: '#0a1f2c',
        horizon: '#1c4552',
        glow: '#8ccaca',
        moon: '#f2f7e8',
        haze: '#28545f',
        hazeLit: '#69a5a4',
        forest: '#0a1c22',
        deep: '#04141b',
        bark: '#2b2723',
        moss: '#30512f',
        ground: '#1e2c24',
        stone: '#3c4947',
        needle: '#12302a',
        moonLight: '#aadadb',
        skyAmb: '#27535f',
        groundAmb: '#0b1b1a',
        spirit: '#f6f1d6',
        lantern: '#ffa23c',
        firefly: '#d2ec78',
        eye: '#ffd98a',
        heart: '#ffc552',
        crest: '#c4f2ea',
        lily: '#f7f2e0',
        stars: 0.35,
        mist: 1.0,
        aurora: 0,
        dawn: 0,
    },
    {
        name: 'moonrise',
        zenith: '#091730',
        horizon: '#20385f',
        glow: '#a0bae6',
        moon: '#f6f8ff',
        haze: '#28436c',
        hazeLit: '#7894c4',
        forest: '#0a1528',
        deep: '#040f20',
        bark: '#272530',
        moss: '#2a4a40',
        ground: '#1b2630',
        stone: '#3d4558',
        needle: '#122838',
        moonLight: '#bcd0ff',
        skyAmb: '#2a4578',
        groundAmb: '#0a1424',
        spirit: '#f4f3ea',
        lantern: '#ffa846',
        firefly: '#bfe6a0',
        eye: '#ffdf9a',
        heart: '#ffcf66',
        crest: '#cfe0ff',
        lily: '#f4f5ff',
        stars: 0.7,
        mist: 0.8,
        aurora: 0,
        dawn: 0,
    },
    {
        name: 'midnight',
        zenith: '#0b0d2c',
        horizon: '#25245a',
        glow: '#9c96e0',
        moon: '#f1eeff',
        haze: '#2a2866',
        hazeLit: '#7670bc',
        forest: '#0c0c26',
        deep: '#07071f',
        bark: '#27222f',
        moss: '#2b4046',
        ground: '#1c1f30',
        stone: '#3f3d5a',
        needle: '#14203a',
        moonLight: '#c2bcff',
        skyAmb: '#322f7c',
        groundAmb: '#0c0b22',
        spirit: '#f5f0ee',
        lantern: '#ffac50',
        firefly: '#b6e0c0',
        eye: '#ffe2a6',
        heart: '#ffd070',
        crest: '#d6d0ff',
        lily: '#f3f0ff',
        stars: 1.0,
        mist: 0.62,
        aurora: 0.85,
        dawn: 0,
    },
    {
        name: 'elf dance',
        zenith: '#170d2e',
        horizon: '#3c2456',
        glow: '#cf9fda',
        moon: '#fff0fa',
        haze: '#3f2760',
        hazeLit: '#a074b0',
        forest: '#0e0c26',
        deep: '#08071c',
        bark: '#28222c',
        moss: '#343c40',
        ground: '#201d2c',
        stone: '#443d56',
        needle: '#161c34',
        moonLight: '#e2c0f0',
        skyAmb: '#2e2a66',
        groundAmb: '#0e0a1e',
        spirit: '#fff2ea',
        lantern: '#ffae58',
        firefly: '#f0d0f0',
        eye: '#ffe0b0',
        heart: '#ffcc7a',
        crest: '#f4ccf6',
        lily: '#fff0fa',
        stars: 0.55,
        mist: 1.45,
        aurora: 0.25,
        dawn: 0,
    },
    {
        name: 'first light',
        zenith: '#1d1230',
        horizon: '#4d2a42',
        glow: '#e2a6a0',
        moon: '#fff2e6',
        haze: '#46283e',
        hazeLit: '#a8747c',
        forest: '#130f24',
        deep: '#0b0818',
        bark: '#2c2224',
        moss: '#3e4034',
        ground: '#241d26',
        stone: '#4a3d4a',
        needle: '#1c1c2c',
        moonLight: '#f0c2b6',
        skyAmb: '#3e3058',
        groundAmb: '#120b16',
        spirit: '#fff4e2',
        lantern: '#ffb060',
        firefly: '#ffd8a8',
        eye: '#ffe4b8',
        heart: '#ffd080',
        crest: '#ffd4c4',
        lily: '#fff4ec',
        stars: 0.2,
        mist: 1.2,
        aurora: 0,
        dawn: 1,
    },
    {
        name: 'troll gold',
        zenith: '#191b10',
        horizon: '#443c20',
        glow: '#dcc282',
        moon: '#fff6d2',
        haze: '#3f3a22',
        hazeLit: '#a08a52',
        forest: '#0f1a16',
        deep: '#07120f',
        bark: '#2c261a',
        moss: '#3f4c26',
        ground: '#22261c',
        stone: '#48463a',
        needle: '#14261c',
        moonLight: '#e8d49c',
        skyAmb: '#3a4a3a',
        groundAmb: '#0e120c',
        spirit: '#fff6dc',
        lantern: '#ffa030',
        firefly: '#f4e878',
        eye: '#ffe890',
        heart: '#ffc840',
        crest: '#f6ecb0',
        lily: '#fffbe6',
        stars: 0.12,
        mist: 1.25,
        aurora: 0,
        dawn: 0.35,
    },
    {
        name: 'moss night',
        zenith: '#08201b',
        horizon: '#1a4a38',
        glow: '#8ccea4',
        moon: '#f0fae6',
        haze: '#225442',
        hazeLit: '#62a680',
        forest: '#0a1e16',
        deep: '#041610',
        bark: '#28291f',
        moss: '#2f5c2c',
        ground: '#1c2e20',
        stone: '#3a4c40',
        needle: '#113222',
        moonLight: '#b0e6c0',
        skyAmb: '#255a46',
        groundAmb: '#0a1c14',
        spirit: '#f4f6da',
        lantern: '#ffa23c',
        firefly: '#dcf26e',
        eye: '#ffdc8a',
        heart: '#ffc552',
        crest: '#c8f6d8',
        lily: '#f4f8e2',
        stars: 0.4,
        mist: 1.1,
        aurora: 0.3,
        dawn: 0,
    },
];

/** The colour keys of an hour, in a fixed order (uniforms, blends and tests walk this list). */
export const PALETTE_KEYS = Object.freeze([
    'zenith', 'horizon', 'glow', 'moon', 'haze', 'hazeLit', 'forest', 'deep', 'bark', 'moss', 'ground', 'stone',
    'needle', 'moonLight', 'skyAmb', 'groundAmb', 'spirit', 'lantern', 'firefly', 'eye', 'heart', 'crest', 'lily',
]);

/** The scalar keys of an hour. */
export const PALETTE_SCALARS = Object.freeze(['stars', 'mist', 'aurora', 'dawn']);

export const HOURS = Object.freeze(HOUR_DEFS.map((def) => {
    const hour = { name: def.name };
    PALETTE_KEYS.forEach((key) => {
        hour[key] = Object.freeze(hex(def[key]));
    });
    PALETTE_SCALARS.forEach((key) => {
        hour[key] = def[key];
    });
    return Object.freeze(hour);
}));

/** Seconds of the world clock that move the night on one hour, whatever the level. */
export const HOUR_SECONDS = 110;
/** Share of an hour, at each end, that the night rests on a palette before it moves on. */
export const HOUR_REST = 0.16;

/**
 * The hour of the night as a number. Whole numbers are the hours in order (they come round
 * again); the fraction is how far the night has moved on toward the next. A level moves it on
 * a whole hour; `time` (seconds on the world clock) moves it on slowly by itself.
 */
export function hourAt(level, time = 0, drifting = true) {
    const n = Number(level);
    const base = Number.isFinite(n) ? Math.max(1, Math.round(n)) - 1 : 0;
    const elapsed = drifting && Number.isFinite(time) ? Math.max(0, time) : 0;
    return base + elapsed / HOUR_SECONDS;
}

/** How far between two neighbouring hours the blend stands for a fraction of the way (rests at both ends). */
export function hourBlend(fraction) {
    return smooth(HOUR_REST, 1 - HOUR_REST, clamp01(fraction));
}

/**
 * The palette at an hour: the hour the night has left and the one it is moving to, blended.
 * Writes scene-linear colours and the scalars into `out` and returns it.
 */
export function paletteAt(hour, out = {}) {
    const n = HOURS.length;
    const h = Number.isFinite(hour) ? ((hour % n) + n) % n : 0;
    const from = Math.floor(h) % n;
    const w = hourBlend(h - Math.floor(h));
    const a = HOURS[from];
    const b = HOURS[(from + 1) % n];
    const target = out;
    for (let i = 0; i < PALETTE_KEYS.length; i++) {
        const key = PALETTE_KEYS[i];
        const mixed = target[key] || (target[key] = [0, 0, 0]);
        for (let c = 0; c < 3; c++) mixed[c] = a[key][c] + (b[key][c] - a[key][c]) * w;
    }
    for (let i = 0; i < PALETTE_SCALARS.length; i++) {
        const key = PALETTE_SCALARS[i];
        target[key] = a[key] + (b[key] - a[key]) * w;
    }
    return target;
}

/** The hour a number stands nearest to, the one it is moving toward, and the blend between them. */
export function hourNames(hour) {
    const n = HOURS.length;
    const h = Number.isFinite(hour) ? ((hour % n) + n) % n : 0;
    const from = Math.floor(h) % n;
    return { from: HOURS[from].name, to: HOURS[(from + 1) % n].name, mix: hourBlend(h - Math.floor(h)) };
}

/** The light a four-line clear and the heart burn with. */
export const TARNFIRE = Object.freeze([1.0, 0.8, 0.42]);
