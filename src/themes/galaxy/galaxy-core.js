/**
 * Galaxy — constants and CPU maths shared by the plan, the choreography and the shaders.
 * Three-free: the plan, the director and their tests import only this.
 *
 * The galaxy has its own frame (light-units): the disc lies in the local XZ plane, the axis the
 * jets run along is local Y, and the frame turns with the spiral pattern, so an arm, a star
 * nursery or a ripple keeps its coordinates while the stars of the old disc stream through.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** The galaxy's own geometry. */
export const GALAXY = Object.freeze({
    /** Where the arms end. */
    radius: 100,
    /** Half-width and half-height of the slab the gas is marched through. */
    bound: 114,
    halfHeight: 9,
    /** The exponential disc's scale length. */
    scaleLength: 27,
    /** The bulge: core radius and how flat it is along the axis. */
    bulge: 6.2,
    bulgeFlat: 0.74,
    /** Arms, and how tightly they wind: an arm's angle grows by `winding` per e-fold of radius. */
    arms: 2,
    winding: 2.4,
    /** The radius the arms leave the bar at. */
    armStart: 8.5,
});

/** Gameplay pulse slots evaluated by the materials. */
export const LOCK_SLOTS = 6;
export const CLEAR_SLOTS = 2;
/** Seeds in flight at once (a lock throws one, a hard drop three). */
export const SEED_SLOTS = 8;
/** Motes in one seed's tail. */
export const SEED_TAIL = 32;
/** Seconds a seed takes from the board to its nursery (scaled by the distance). */
export const SEED_FLIGHT = 0.44;

/** Lock ripple in the disc: radius R·(1 − e^(−age/τ)), fading at RIPPLE_FADE /s. */
export const RIPPLE_REACH = 30;
export const RIPPLE_TAU = 0.55;
export const RIPPLE_FADE = 1.3;

/**
 * Clear wave: leaves the nucleus and runs out through the disc, slowing a little as it goes:
 * radius = WAVE_REACH · (age / WAVE_TRAVEL)^WAVE_SHAPE. One front per cleared line.
 */
export const WAVE_REACH = 122;
export const WAVE_TRAVEL = 1.75;
export const WAVE_SHAPE = 0.86;
export const WAVE_FRONT_GAP = 0.14;
export const WAVE_FRONT_WIDTH = 0.06;
export const WAVE_AFTERGLOW = 1.25;

/** Seconds the light a lock leaves in a nursery takes to fall to 1/e. */
export const STORE_HOLD = 30;
/** The most light one nursery holds (in lock units). */
export const STORE_MAX = 2.6;
/** A nursery's ignition flash falls to 1/e in this many seconds; a nova's shell lives NOVA_LIFE. */
export const PULSE_FADE = 0.5;
export const NOVA_LIFE = 1.5;

/** Seconds a four-line clear holds the galaxy's breath before the nucleus erupts. */
export const HUSH_HOLD = 0.22;
/** The longest the jets reach (light-units along the axis). */
export const JET_REACH = 150;
/** The most combo rings the nucleus wears. */
export const MAX_RINGS = 6;

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

// ── The spiral ──────────────────────────────────────────────────────────────────

/** The angle an arm's ridge stands at for a radius (the frame turns with the pattern). */
export function armAngle(radius, winding = GALAXY.winding) {
    return winding * Math.log(Math.max(radius, GALAXY.armStart * 0.5) / GALAXY.armStart);
}

/**
 * How deep in an arm a point of the disc is: 1 on a ridge, 0 between arms.
 * `sharp` narrows the ridge. CPU twin of gxArm in galaxy-tsl.js.
 */
export function armStrength(radius, angle, sharp = 3, winding = GALAXY.winding) {
    const phase = GALAXY.arms * (angle - armAngle(radius, winding));
    return (0.5 + 0.5 * Math.cos(phase)) ** sharp;
}

/** The disc's radial light: an exponential with a soft hole at the bar and a soft rim. */
export function discProfile(radius) {
    return Math.exp(-radius / GALAXY.scaleLength) * (1 - smooth(GALAXY.radius * 0.82, GALAXY.radius * 1.06, radius));
}

/** Radius of a lock ripple `age` seconds after it starts. */
export function rippleRadius(age) {
    return age <= 0 ? 0 : RIPPLE_REACH * (1 - Math.exp(-age / RIPPLE_TAU));
}

/** How far a clear wave's first front has run `age` seconds after the clear. */
export function waveRadius(age) {
    return age <= 0 ? 0 : WAVE_REACH * Math.min(1, age / WAVE_TRAVEL) ** WAVE_SHAPE;
}

/** Seconds after the clear at which its first front passes a radius. */
export function wavePassTime(radius) {
    return WAVE_TRAVEL * clamp01(radius / WAVE_REACH) ** (1 / WAVE_SHAPE);
}

/** The nucleus's charge for a combo of n (0 at rest, → 1). */
export function powerForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.2) : 0;
}

/**
 * The light a nursery holds is carried as ONE number, the moment it would have been lit at full
 * strength: held(t) = e^(−(t − epoch)/STORE_HOLD). No per-frame decay to write, no overflow.
 */
export function heldAt(epoch, time) {
    return Math.min(STORE_MAX, Math.exp(-(time - epoch) / STORE_HOLD));
}

/** The epoch that holds `amount` at `time`. */
export function epochFor(amount, time) {
    return amount > 1e-4 ? time + STORE_HOLD * Math.log(Math.min(STORE_MAX, amount)) : -1e5;
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
export function pieceColor(value, fallback = 0xd050ff) {
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
        const pushed = (n - lo * 0.7) / (1 - lo * 0.7);
        return pushed * 0.95 + 0.05;
    });
}

/**
 * Galaxy palettes, one per level (cycled), all scene-linear:
 *   core              the bulge's old light; `nucleus` is the point at its heart
 *   armInner / armOuter  the young light of the arms, near the bar and at the rim
 *   nursery           the star-forming knots along the arms (their own glow, at rest)
 *   dust              what the dust lanes leave of the light behind them (a tint, not a light)
 *   jet               the beams a charged nucleus fires
 *   nebulaA / nebulaB the lit clouds of the deep sky
 *   void              the sky's own colour
 */
export const GALAXY_PALETTES = Object.freeze([
    {
        name: 'andromeda',
        core: [1.0, 0.78, 0.58],
        nucleus: [1.0, 0.9, 0.95],
        armInner: [0.56, 0.17, 1.0],
        armOuter: [0.1, 0.32, 1.0],
        nursery: [1.0, 0.22, 0.6],
        dust: [0.5, 0.2, 0.16],
        jet: [0.42, 0.72, 1.0],
        nebulaA: [0.62, 0.14, 0.78],
        nebulaB: [0.1, 0.3, 0.95],
        void: [0.0028, 0.0016, 0.0085],
    },
    {
        name: 'whirlpool',
        core: [1.0, 0.86, 0.6],
        nucleus: [1.0, 0.95, 0.85],
        armInner: [0.3, 0.72, 1.0],
        armOuter: [0.1, 0.9, 0.86],
        nursery: [1.0, 0.3, 0.5],
        dust: [0.46, 0.22, 0.12],
        jet: [0.5, 1.0, 0.9],
        nebulaA: [0.1, 0.5, 0.9],
        nebulaB: [0.6, 0.16, 0.6],
        void: [0.0014, 0.0028, 0.008],
    },
    {
        name: 'sombrero',
        core: [1.0, 0.72, 0.4],
        nucleus: [1.0, 0.9, 0.7],
        armInner: [1.0, 0.5, 0.2],
        armOuter: [0.95, 0.2, 0.36],
        nursery: [1.0, 0.7, 0.26],
        dust: [0.42, 0.14, 0.08],
        jet: [1.0, 0.75, 0.4],
        nebulaA: [0.9, 0.24, 0.16],
        nebulaB: [0.55, 0.16, 0.7],
        void: [0.0048, 0.0018, 0.005],
    },
    {
        name: 'emerald',
        core: [0.92, 0.95, 0.7],
        nucleus: [0.9, 1.0, 0.92],
        armInner: [0.16, 0.95, 0.6],
        armOuter: [0.14, 0.5, 1.0],
        nursery: [0.5, 1.0, 0.4],
        dust: [0.3, 0.26, 0.1],
        jet: [0.6, 1.0, 0.7],
        nebulaA: [0.08, 0.62, 0.5],
        nebulaB: [0.16, 0.24, 0.9],
        void: [0.0012, 0.0034, 0.0062],
    },
    {
        name: 'ultraviolet',
        core: [0.84, 0.8, 1.0],
        nucleus: [0.9, 0.9, 1.0],
        armInner: [0.56, 0.26, 1.0],
        armOuter: [0.16, 0.24, 1.0],
        nursery: [0.2, 0.9, 1.0],
        dust: [0.36, 0.16, 0.4],
        jet: [0.75, 0.5, 1.0],
        nebulaA: [0.36, 0.12, 0.95],
        nebulaB: [0.06, 0.5, 0.9],
        void: [0.0022, 0.0012, 0.011],
    },
]);

export const PALETTE_KEYS = Object.freeze([
    'core', 'nucleus', 'armInner', 'armOuter', 'nursery', 'dust', 'jet', 'nebulaA', 'nebulaB', 'void',
]);

/** The colour a four-line clear fires in. */
export const STARFIRE = Object.freeze([1.0, 0.9, 0.72]);

/**
 * Where the galaxy sits on screen for an aspect ratio: its nucleus (fractions, y down), the
 * radius of its arms (in screen heights), how far it leans back and which way its long axis
 * runs. Landscape leaves the centre to the board: the nucleus burns left of the card and the arms
 * sweep behind it. Upright phones show sky above and below the card, so the galaxy climbs there.
 */
export function galaxyAnchors(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const k = smooth(0.75, 1.4, a);
    const wide = smooth(1.5, 2.3, a);
    return {
        x: lerp(0.5, lerp(0.29, 0.31, wide), k),
        y: lerp(0.185, 0.48, k),
        radius: lerp(0.3, lerp(0.92, 1.0, wide), k),
        inclination: lerp(63, 57, k) * DEG,
        lean: lerp(9, 22, k) * DEG,
        /** The companion galaxy, far off on the other side. */
        companion: { x: lerp(0.82, 0.865, k), y: lerp(0.07, 0.2, k), radius: lerp(0.03, 0.062, k) },
    };
}
