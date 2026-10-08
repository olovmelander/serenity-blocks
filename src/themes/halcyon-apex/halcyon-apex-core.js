/**
 * Halcyon Apex — constants and CPU maths shared by the plan, the choreography and the shaders.
 * Three-free: the plan, the director and their tests import only this.
 *
 * The sanctuary (metres): a clear lagoon at y = 0. The camera stands in it at the origin, a
 * little above the water, looking down −Z. To its left a causeway runs out to the terraced
 * pyramid and the Apex crystal that floats over it; to its right the sun rises behind the
 * Halcyon, a great diamond that hangs over a ring of standing stones and draws the lagoon up
 * into itself.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Gameplay pulse slots evaluated by the materials. */
export const LOCK_SLOTS = 6;
export const CLEAR_SLOTS = 2;
/** Pulses of light running up a ley line at once (a lock sends one, a hard drop two). */
export const PULSE_SLOTS = 6;
/** Wisps in flight at once, and the motes in one wisp's tail. */
export const WISP_SLOTS = 8;
export const WISP_TAIL = 24;

/** Lock ring on the water: radius R·(1 − e^(−age/τ)), fading at RING_FADE /s. */
export const RING_REACH = 46;
export const RING_TAU = 0.62;
export const RING_FADE = 1.25;

/** Seconds a wisp takes from the board to the head of its ley line. */
export const WISP_FLIGHT = 0.36;

/** A ley pulse: metres a second along the line, and the length of the lit packet. */
export const PULSE_SPEED = 230;
export const PULSE_WIDTH = 16;
/** Seconds the stone and the crystals behind a pulse stay warm. */
export const PULSE_AFTERGLOW = 0.9;

/**
 * Clear wave: leaves the foot of the board and runs out through the sanctuary, accelerating:
 * radius = CLEAR_REACH · (age / CLEAR_TRAVEL)^CLEAR_SHAPE. One front per cleared line.
 */
export const CLEAR_REACH = 460;
export const CLEAR_TRAVEL = 1.7;
export const CLEAR_SHAPE = 1.6;
export const CLEAR_FRONT_GAP = 0.12;
export const CLEAR_FRONT_WIDTH = 0.075;
export const CLEAR_AFTERGLOW = 1.2;

/** Seconds the light a lock leaves in a hero crystal takes to fall to 1/e, and the most it holds. */
export const HOLD_FADE = 24;
export const HOLD_MAX = 6;

/** Seconds a four-line clear holds the sanctuary's breath before everything fires. */
export const HUSH_HOLD = 0.22;
/** Seconds the beacons of a four-line clear stand. */
export const BEACON_LIFE = 3.4;

/** The chain a combo can lift the sanctuary to (steps beyond it add nothing new). */
export const LIFT_MAX = 10;

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

/** Radius of a lock ring `age` seconds after the lock. */
export function ringRadius(age) {
    return age <= 0 ? 0 : RING_REACH * (1 - Math.exp(-age / RING_TAU));
}

/** How far a clear wave's first front has run `age` seconds after the clear. */
export function clearRadius(age) {
    return age <= 0 ? 0 : CLEAR_REACH * Math.min(1, age / CLEAR_TRAVEL) ** CLEAR_SHAPE;
}

/** Seconds after the clear at which its first front passes a point `dist` metres from the heart. */
export function clearPassTime(dist) {
    return CLEAR_TRAVEL * clamp01(dist / CLEAR_REACH) ** (1 / CLEAR_SHAPE);
}

/** The sanctuary's charge for a combo of n (0 at rest, → 1). */
export function powerForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.4) : 0;
}

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
export function pieceColor(value, fallback = 0x8ff5ee) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    // Pastel piece colours wash out as light: push them toward their own hue, and keep a floor
    // in every channel so a pure primary still reaches all three of the bloom's channels.
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.72) / (1 - lo * 0.72);
        return pushed * 0.94 + 0.06;
    });
}

// ── The site ────────────────────────────────────────────────────────────────────

/**
 * The pyramid's own frame. `front` is the unit vector (x, z) its stair faces along, toward the
 * viewer; `right` is the viewer's right when facing the stair. The causeway is the line x′ = 0.
 * The camera stands at (CAMERA_OFFSET, CAMERA_REACH) in this frame, so the causeway passes it on
 * the left and the pyramid stands at about a quarter of the way across the picture.
 */
export const SITE_YAW = 23 * DEG;
export const CAMERA_OFFSET = 8.5;
export const CAMERA_REACH = 250;
const FRONT = [Math.sin(SITE_YAW), Math.cos(SITE_YAW)];
const RIGHT = [Math.cos(SITE_YAW), -Math.sin(SITE_YAW)];

export const SITE = Object.freeze({
    front: Object.freeze(FRONT),
    right: Object.freeze(RIGHT),
    /** The terraced pyramid: world position of its centre, and its build. */
    pyramid: Object.freeze({
        x: -(CAMERA_OFFSET * RIGHT[0] + CAMERA_REACH * FRONT[0]),
        z: -(CAMERA_OFFSET * RIGHT[1] + CAMERA_REACH * FRONT[1]),
        /** Half the base's width, and half the top platform's. */
        half: 66,
        topHalf: 11,
        tiers: 8,
        tierHeight: 10.5,
        /** How far each tier's wall leans in over its own height (the batter). */
        batter: 1.3,
        /** The plinth the first tier stands on, washed by the lagoon. */
        plinth: 1.4,
        stairHalf: 6.2,
        /** The heart gate: a doorway of light in the stair's line, cut into these tiers. */
        gateTier: 2,
    }),
    /** The causeway: a deck on piers along x′ = 0 from the stair to behind the viewer. */
    causeway: Object.freeze({
        half: 4.6,
        deck: 1.35,
        /** z′ of the pyramid end and of the end behind the viewer. */
        near: 84,
        far: 268,
        /** z′ between pairs of ley shards (and the piers under them). */
        pitch: 13,
        /** How far out from the axis a ley shard stands. */
        shardAt: 5.6,
    }),
    /** The Apex crystal: floats this far over the top platform; half its height and its girth. */
    apex: Object.freeze({ hover: 18.5, half: 14, girth: 5.6 }),
    /** The Halcyon: the diamond that hangs before the sun. */
    halcyon: Object.freeze({
        /** Metres from the viewer along the sun's bearing (a little to its left). */
        distance: 152,
        bearing: -4.4 * DEG,
        /** Height of its centre over the water, half its height and its girth. */
        height: 31,
        half: 21,
        girth: 9.5,
    }),
    /** The ring of standing stones under the Halcyon. */
    dial: Object.freeze({ radius: 27, stones: 9, stoneHeight: 7.5 }),
});

/** A point of the pyramid's frame (x′ right, z′ out along the causeway) in world (x, z). */
export function siteToWorld(xs, zs, out = [0, 0]) {
    out[0] = SITE.pyramid.x + xs * RIGHT[0] + zs * FRONT[0];
    out[1] = SITE.pyramid.z + xs * RIGHT[1] + zs * FRONT[1];
    return out;
}

/** A world (x, z) in the pyramid's frame. */
export function worldToSite(x, z, out = [0, 0]) {
    const dx = x - SITE.pyramid.x;
    const dz = z - SITE.pyramid.z;
    out[0] = dx * RIGHT[0] + dz * RIGHT[1];
    out[1] = dx * FRONT[0] + dz * FRONT[1];
    return out;
}

/** Total height of the pyramid's top platform over the water. */
export const PYRAMID_TOP = SITE.pyramid.plinth + SITE.pyramid.tiers * SITE.pyramid.tierHeight;
/** Height of the Apex crystal's centre over the water. */
export const APEX_Y = PYRAMID_TOP + SITE.apex.hover;

/** Half-width of tier `i`'s foot (0 = the lowest) and of its top edge. */
export function tierHalf(i) {
    const p = SITE.pyramid;
    const step = (p.half - p.topHalf - p.batter) / (p.tiers - 1);
    const foot = p.half - step * i;
    return { foot, top: foot - p.batter };
}

/** The stair's line: `t` 0 at its foot on the landing … 1 at the top platform. */
export const STAIR = (() => {
    const p = SITE.pyramid;
    const zTop = tierHalf(p.tiers - 1).top;
    const slope = p.tierHeight / ((p.half - p.topHalf - p.batter) / (p.tiers - 1));
    const rise = PYRAMID_TOP - p.plinth;
    const run = rise / slope;
    return Object.freeze({
        zTop, zFoot: zTop + run, run, rise, slope, length: Math.hypot(run, rise),
    });
})();

/** A point of the stair's line in the pyramid's frame: [z′, y]. */
export function stairPoint(t) {
    return [STAIR.zFoot - t * STAIR.run, SITE.pyramid.plinth + t * STAIR.rise];
}

/**
 * Ley line A, the causeway: arc length (metres) from the first pair of shards beside the viewer,
 * along the deck to the stair's foot, up the stair and into the Apex.
 */
export const LEY_A = (() => {
    const head = SITE.causeway.far - 22;
    const foot = head - STAIR.zFoot;
    return Object.freeze({
        /** z′ where the line starts; arc length at the stair's foot; the stair's own length. */
        head, foot, stair: STAIR.length, length: foot + STAIR.length + SITE.apex.hover,
    });
})();

/** Arc length along ley line A at a point of the causeway (z′ in the pyramid's frame). */
export function leyAAtDeck(zs) {
    return LEY_A.head - zs;
}

/**
 * Ley line B, the dial: from the stone nearest the viewer both ways round the ring to the far
 * stones, then up the rising water into the Halcyon.
 */
export const LEY_B = (() => {
    const d = SITE.dial;
    const arc = (TAU * d.radius) / d.stones;
    const ring = arc * Math.floor(d.stones / 2);
    const rise = SITE.halcyon.height - SITE.halcyon.half;
    return Object.freeze({
        arc, ring, rise, length: ring + rise + 6,
    });
})();

/** Arc length along ley line B at dial stone `k` (0 = nearest the viewer). */
export function leyBAtStone(k) {
    const n = SITE.dial.stones;
    const j = ((k % n) + n) % n;
    return Math.min(j, n - j) * LEY_B.arc;
}

/** Seconds after it is sent that a pulse reaches arc length `s`. */
export function pulseArrival(s) {
    return Math.max(0, s) / PULSE_SPEED;
}

// ── Light ───────────────────────────────────────────────────────────────────────

/**
 * Sanctuary palettes, one per level (cycled), all scene-linear:
 *   sun               the sun's own light (colour × strength)
 *   zenith / horizon  the sky's ends; `glow` is the scatter round the sun, `rose` the band that
 *                     lies opposite it
 *   cloud / cloudShade  the lit and the shaded side of a cloud
 *   shallow / deep    the lagoon over sand and over depth
 *   crystal           the hue the crystals lean to; `ley` the light in the lines
 *   stone             the sandstone's own colour
 */
export const HALCYON_PALETTES = Object.freeze([
    {
        name: 'golden-dawn',
        sun: [4.6, 3.3, 2.0],
        zenith: [0.065, 0.19, 0.46],
        horizon: [0.8, 0.49, 0.27],
        glow: [1.0, 0.62, 0.28],
        rose: [0.5, 0.32, 0.5],
        cloud: [1.0, 0.8, 0.6],
        cloudShade: [0.3, 0.3, 0.46],
        shallow: [0.1, 0.72, 0.62],
        deep: [0.0, 0.16, 0.24],
        crystal: [0.2, 0.92, 0.88],
        ley: [0.26, 1.0, 0.9],
        stone: [0.62, 0.5, 0.36],
    },
    {
        name: 'rose-hour',
        sun: [4.4, 2.6, 2.2],
        zenith: [0.14, 0.2, 0.5],
        horizon: [0.95, 0.5, 0.5],
        glow: [1.0, 0.45, 0.42],
        rose: [0.62, 0.3, 0.62],
        cloud: [1.0, 0.68, 0.7],
        cloudShade: [0.34, 0.26, 0.5],
        shallow: [0.14, 0.66, 0.7],
        deep: [0.02, 0.12, 0.28],
        crystal: [0.95, 0.42, 0.72],
        ley: [1.0, 0.5, 0.8],
        stone: [0.64, 0.48, 0.4],
    },
    {
        name: 'clear-morning',
        sun: [4.8, 4.2, 3.4],
        zenith: [0.07, 0.26, 0.66],
        horizon: [0.66, 0.8, 0.9],
        glow: [1.0, 0.9, 0.7],
        rose: [0.5, 0.6, 0.8],
        cloud: [1.0, 0.97, 0.9],
        cloudShade: [0.4, 0.48, 0.62],
        shallow: [0.08, 0.8, 0.74],
        deep: [0.0, 0.2, 0.36],
        crystal: [0.3, 0.75, 1.0],
        ley: [0.4, 0.86, 1.0],
        stone: [0.66, 0.58, 0.46],
    },
    {
        name: 'amber-haze',
        sun: [5.0, 3.0, 1.3],
        zenith: [0.2, 0.24, 0.36],
        horizon: [1.0, 0.56, 0.2],
        glow: [1.0, 0.5, 0.12],
        rose: [0.7, 0.36, 0.3],
        cloud: [1.0, 0.7, 0.36],
        cloudShade: [0.36, 0.26, 0.3],
        shallow: [0.16, 0.66, 0.5],
        deep: [0.02, 0.14, 0.18],
        crystal: [1.0, 0.72, 0.26],
        ley: [1.0, 0.78, 0.3],
        stone: [0.66, 0.5, 0.32],
    },
    {
        name: 'blue-hour',
        sun: [3.4, 2.4, 2.6],
        zenith: [0.03, 0.07, 0.3],
        horizon: [0.56, 0.4, 0.66],
        glow: [0.9, 0.5, 0.6],
        rose: [0.36, 0.26, 0.6],
        cloud: [0.86, 0.62, 0.8],
        cloudShade: [0.16, 0.16, 0.4],
        shallow: [0.1, 0.5, 0.72],
        deep: [0.0, 0.07, 0.24],
        crystal: [0.5, 0.42, 1.0],
        ley: [0.6, 0.56, 1.0],
        stone: [0.5, 0.46, 0.46],
    },
]);

export const PALETTE_KEYS = Object.freeze([
    'sun', 'zenith', 'horizon', 'glow', 'rose', 'cloud', 'cloudShade', 'shallow', 'deep', 'crystal', 'ley', 'stone',
]);

/** The colour a four-line clear fires in. */
export const SUNFIRE = Object.freeze([1.0, 0.84, 0.52]);

/**
 * Where the picture's anchors sit on screen (fractions, y down) for an aspect ratio, and how far
 * the rig turns toward the pyramid. Landscape leaves the middle to the board: the pyramid stands
 * to its left, the sun to its right. An upright screen is too narrow for both, and its card
 * covers the middle: the rig turns to the pyramid and tips down, so the Apex and the top tiers
 * stand over the card and the lagoon's bed lies under it, and the sun is hung beside the Apex.
 */
export function compositionFor(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const wide = smooth(0.8, 1.45, a);
    return {
        sun: { x: lerp(0.8, 0.866, wide), y: lerp(0.085, 0.35, wide) },
        /** Radians the rig turns left of −Z, and how far it tips (up in a wide frame, down in an upright one). */
        yaw: lerp(24.5 * DEG, 0, wide),
        pitch: lerp(-13 * DEG, 5 * DEG, wide),
        wide,
    };
}
