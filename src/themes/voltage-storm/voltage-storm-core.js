/**
 * Voltage Storm — three-free constants and maths shared by the choreography, the shaders and the
 * tests: the storm's geometry in metres, the collector towers' layout for an aspect, how a
 * lightning stroke's light runs in time, how a tower's held charge is carried, the palettes.
 *
 * The world is in metres, y up, the camera a few metres over a flooded plain looking down −z.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Smoothstep on the CPU with forward edges. */
export function smooth(lo, hi, x) {
    const t = clamp01((x - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** Frame-rate independent approach factor: `rate` per second over `dt` seconds. */
export function approach(rate, dt) {
    return 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
}

/** Small seeded generator (deterministic plans and events). */
export function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A float in [0, 1) from an integer pair (events that must not depend on call order). */
export function hash2(a, b = 0) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ── The storm's geometry (metres) ───────────────────────────────────────────────

export const STORM = Object.freeze({
    /** The camera's height over the water. */
    eye: 7,
    /** The cloud's ragged underside hangs between base − sag and base; the march runs to base + depth. */
    cloudBase: 300,
    cloudSag: 70,
    cloudDepth: 210,
    /** Horizontal distance at which the cell ends and the clear twilight strip begins. */
    edge: 2500,
    /** One tile of the cloud's 3D noise, and of the slow field that varies its cover. */
    cloudTile: 820,
    coverTile: 5600,
    /** The brightest part of the horizon strip: azimuth (radians, 0 = straight ahead, + = right). */
    glowAzimuth: -0.3,
    /** The cloud's own drift (m/s) at rest. */
    drift: [7.5, 0, 3.2],
    /** The rain: its box round the camera, fall speed (m/s), and how far a streak smears. */
    rainBox: [150, 64, 170],
    rainFall: 17,
    rainStreak: 0.085,
    /**
     * The vault. The cell's underside is not one ceiling: it steps down in tiers from a high vault
     * over a point behind the lens out to the cell's edge, each tier a ring `tierRadius` wide whose
     * inner wall hangs `tierHeight` lower than the last, so from under it the storm stands as
     * terraces one behind another, each with its own lit fringe. `cloudBase − cloudSag` is the
     * LOWEST tier's base. The whole vault turns slowly about its centre (a mesocyclone).
     */
    vaultCentre: [260, 420],
    tiers: 3,
    tierRadius: 640,
    /** The share of a tier's width its inner wall takes to come down (the rest is flat). */
    tierRiser: 0.84,
    /** A tier's height when the storm is at its heaviest, and at its lightest (metres). */
    tierHeight: 80,
    tierHeightCalm: 42,
    /** How far the tiers' walls wander from their circles (metres). */
    tierWobble: 120,
    /** The whole underside lifts this far (metres) as the storm eases to its lull. */
    liftCalm: 95,
    /** Radians a second the vault turns at rest. */
    spin: 0.0046,
    /** The scud: ragged fragments racing under the lowest tier (metres under it, m/s). */
    scudUnder: 62,
    scudDrift: [31, 0, 9],
});

/**
 * The height (metres) of the cloud's underside over a point of the plain: the vault's tiers. CPU
 * twin of the sky's shader (a bolt leaves the cloud where the cloud is). `tierHeight` and `lift`
 * are the weather's (see `stormWeather`).
 */
export function vaultBase(x, z, tierHeight = STORM.tierHeight, lift = 0) {
    const wobble = STORM.tierWobble * (
        Math.sin(x / 260 + 1.3) * Math.sin(z / 310 + 0.4) + 0.5 * Math.sin(x / 97 + z / 131)
    );
    const r = Math.hypot(x - STORM.vaultCentre[0], z - STORM.vaultCentre[1]) + wobble;
    const s = Math.max(0, Math.min(STORM.tiers, r / STORM.tierRadius));
    const whole = Math.floor(s);
    const stair = Math.min(STORM.tiers, whole + smooth(STORM.tierRiser, 1, s - whole));
    return STORM.cloudBase - STORM.cloudSag + lift + tierHeight * (STORM.tiers - stair);
}

// ── The storm's own weather ─────────────────────────────────────────────────────

/** Seconds one turn of the storm takes: it gathers, breaks, eases and lulls. */
export const STORM_CYCLE = 176;
/** Where in its turn the storm stands when the clock starts (gathering: the first minute builds). */
export const STORM_CYCLE_START = 0.2;

/** Smooth value noise on a line, 0..1 (the squalls). */
export function squall(x) {
    const i = Math.floor(x);
    const f = x - i;
    const a = hash2(i, 811);
    const b = hash2(i + 1, 811);
    return a + (b - a) * f * f * (3 - 2 * f);
}

/**
 * The storm's weather at `time`, by its own clock alone (play pushes it harder on top, see the
 * world). A turn has four acts:
 *   lull     the vault lifts and thins, the strip of clear sky stands wide, drizzle;
 *   gather   the tiers come down, scud races in under them, the rain thickens;
 *   break    the storm at its heaviest: squalls of rain, the cloud alight from inside;
 *   ease     the rain thins, lightning crawls long across the underside, the strip reopens.
 * No two turns are alike: each has its own depth of lull and height of break.
 * @returns {{ phase:number, turn:number, heavy:number, act:string, squall:number }}
 */
export function stormWeather(time, out = {}) {
    const o = out;
    const t = Number.isFinite(time) ? Math.max(0, time) : 0;
    const at = t / STORM_CYCLE + STORM_CYCLE_START;
    const turn = Math.floor(at);
    const phase = at - turn;
    // Each turn's own lull and break (and the one before it, to join them without a step).
    const lullOf = (n) => 0.05 + 0.2 * hash2(n, 401);
    const peakOf = (n) => 0.8 + 0.2 * hash2(n, 409);
    const lull = lullOf(turn);
    const peak = peakOf(turn);
    let heavy;
    if (phase < 0.16) heavy = lull;
    else if (phase < 0.46) heavy = lerp(lull, peak, smooth(0.16, 0.46, phase));
    else if (phase < 0.66) heavy = peak;
    else heavy = lerp(peak, lullOf(turn + 1), smooth(0.66, 1, phase));
    o.phase = phase;
    o.turn = turn;
    o.heavy = clamp01(heavy);
    let act = 'ease';
    if (phase < 0.16) act = 'lull';
    else if (phase < 0.46) act = 'gather';
    else if (phase < 0.66) act = 'break';
    o.act = act;
    // Squalls: the rain comes in bursts a quarter of a minute apart, hardest when the storm is.
    o.squall = squall(t / 13.7) * 0.65 + squall(t / 4.9 + 31) * 0.35;
    return o;
}

/** The most an 8-bit sky target can hold (scene-linear); it stores the square root of light / peak. */
export const SKY_CODE_PEAK = 4;

// ── Slots ───────────────────────────────────────────────────────────────────────

/** Lightning slots, by kind (the rows of a slot: see BOLT_ROWS). */
export const BOLT_KIND = Object.freeze({
    /** Cloud to ground: a leader steps down, then return strokes run up the channel. */
    strike: 0,
    /** A short arc between two fixed points (the card's edge and a tower, a row's discharge). */
    arc: 1,
    /** An arc that stands between two tower tops while a chain holds, re-drawn many times a second. */
    chain: 2,
    /** Lightning crawling along the cloud's underside. */
    crawler: 3,
});
export const BOLT_RANGES = Object.freeze({
    // Strikes from the cloud, and the upward lightning the towers send back into it.
    strike: [0, 12],
    // The widest pool: a hard drop throws a heavy arc, a second, and a web of arcs over the water.
    arc: [12, 28],
    chain: [28, 34],
    // Two four-line clears in a row and a long chain raise crawlers fastest.
    crawler: [34, 48],
});
export const BOLT_SLOTS = 48;
/**
 * A slot is seven rows of the bolt table:
 *   A = (start xyz, shape seed)      B = (end xyz, sideways reach as a fraction of the length)
 *   C = (rgb, core width in px)      D = (leader progress, channel light, branch light, afterglow)
 *   E = (pinned at both ends 0/1, the share of its limbs that show 0..1, the height in metres above
 *        which it is inside the cloud and only a glow (0: never), how far its core keeps its colour)
 *   F = (roughness: how much of the fine kinks it carries, bow as a share of its length (+ = up),
 *        a pinned arc's slide along its own wander or an unpinned bolt's sideways shift in px,
 *        the share of the channel's light a branch carries)
 *   G = (helix radius in metres, helix turns, a limb's turn from the channel in radians, a gain on
 *        the limbs' length)
 */
export const BOLT_ROWS = 7;

/**
 * How a bolt is built: the look of each kind of electricity. Lightning is not one thing here.
 *   rough       0 a smooth thread of plasma … 1 the jagged channel of a strike (more: frantic)
 *   bow         it arches by this share of its length (hot plasma rises)
 *   limbRank    the share of the channel's light a branch carries (a twig, less than half of that)
 *   limbTurn    how far a limb turns from the channel (radians; the spread is added to it)
 *   limbLength  gain on the limbs' length
 *   limbs       the share of its limbs that show (each bolt draws its own lot)
 *   coreTint    0: a white-hot core in a halo of its colour … 1: its colour through and through
 */
export const BOLT_STYLE = Object.freeze({
    /** A forked strike: the classic. */
    fork: Object.freeze({
        rough: 1, bow: 0, limbRank: 0.16, limbTurn: 0.55, limbLength: 1, limbs: 0.75, coreTint: 0,
    }),
    /** A giant: one thick trunk, hardly a fork on it. */
    giant: Object.freeze({
        rough: 0.72, bow: 0, limbRank: 0.1, limbTurn: 0.42, limbLength: 0.7, limbs: 0.3, coreTint: 0,
    }),
    /** A far strike in the strip: a hairline, restless, forked low. */
    hair: Object.freeze({
        rough: 1.25, bow: 0, limbRank: 0.3, limbTurn: 0.5, limbLength: 1.2, limbs: 0.6, coreTint: 0.15,
    }),
    /** Spider lightning: a wide tree crawling along the cloud's underside, every limb alight. */
    spider: Object.freeze({
        rough: 0.9, bow: 0, limbRank: 0.6, limbTurn: 0.8, limbLength: 1.7, limbs: 1, coreTint: 0.1,
    }),
    /** Upward lightning: a trunk off a tower's finial that forks like a tree into the cloud. */
    tree: Object.freeze({
        rough: 1.1, bow: 0, limbRank: 0.55, limbTurn: 0.5, limbLength: 1.25, limbs: 0.9, coreTint: 0.1,
    }),
    /** A lock's charge: a smooth thread of plasma in the piece's colour, arching as it leaps. */
    filament: Object.freeze({
        rough: 0.22, bow: 0.1, limbRank: 0.22, limbTurn: 0.7, limbLength: 0.5, limbs: 0.35, coreTint: 0.6,
    }),
    /** A hard drop's charge: the same thread driven hard, kinked and forked. */
    lash: Object.freeze({
        rough: 0.7, bow: 0.06, limbRank: 0.3, limbTurn: 0.6, limbLength: 1.1, limbs: 0.8, coreTint: 0.3,
    }),
    /** A standing arc between tower tops: slow, writhing, rising like a Jacob's ladder. */
    plasma: Object.freeze({
        rough: 0.36, bow: 0.085, limbRank: 0.3, limbTurn: 0.9, limbLength: 0.45, limbs: 0.4, coreTint: 0.72,
    }),
    /** Arcs skittering over the water from a struck foot: frantic, flat, forked wide. */
    skitter: Object.freeze({
        rough: 1.2, bow: 0.12, limbRank: 0.5, limbTurn: 0.95, limbLength: 1.3, limbs: 0.9, coreTint: 0.35,
    }),
    /** A twist's arc: a helix wound round a mast. */
    helix: Object.freeze({
        rough: 0.3, bow: 0, limbRank: 0.3, limbTurn: 1.1, limbLength: 0.5, limbs: 0.5, coreTint: 0.45,
    }),
    /** A streamer: the brush of fire a finial sends up to meet a leader coming down. */
    streamer: Object.freeze({
        rough: 0.6, bow: 0, limbRank: 0.7, limbTurn: 0.6, limbLength: 2.2, limbs: 1, coreTint: 0.85,
    }),
});

/** Lights the cloud, the water, the towers and the rain read (the brightest strokes of the frame). */
export const FLASH_SLOTS = 10;
/** Rings across the water (every lock, a strike's shock). */
export const SHOCK_SLOTS = 10;
/** A ring's strength falls by this rate (per second): the water's shader and the slot choice agree. */
export const SHOCK_FADE = 0.55;
/** Collector towers, and the capacitor rings each one carries. */
export const TOWER_MAX = 10;
export const TOWER_RINGS = 6;
/** Standing arcs a chain can raise. */
export const MAX_CHAIN_ARCS = 5;

// ── Timings ─────────────────────────────────────────────────────────────────────

/** Seconds the storm holds its breath before a four-line clear's superbolt. */
export const HUSH_HOLD = 0.22;
/** Seconds a tower's held charge takes to fade to 1/e. */
export const HELD_TAU = 28;
/** The most a tower can hold (in locks' worth of charge). */
export const HELD_MAX = 2.4;
/** Seconds between the row arcs of a clear and the sky's answer, and between its bolts. */
export const ANSWER_DELAY = 0.14;
export const ANSWER_GAP = 0.085;
/** Speed of a shock ring across the water (m/s) and of the sheet lightning through the cloud. */
export const SHOCK_SPEED = 150;
export const SHEET_SPEED = 1500;
/** Thunder: metres a second its shell of pressure runs out through the rain. */
export const BOOM_SPEED = 340;
/** Seconds the screen ripple of a superbolt lasts. */
export const RIPPLE_SPEED = 0.9;

/** The chain's charge for a combo count: 0 at rest, about 0.63 at four, saturating. */
export function powerForCombo(combo) {
    const n = Math.max(0, combo);
    return n <= 0 ? 0 : 1 - Math.exp(-n / 4);
}

// ── Held charge ─────────────────────────────────────────────────────────────────

/**
 * A tower's charge is one number: the moment it would have held exactly 1. Its charge at `time`
 * is e^((epoch − time) / HELD_TAU), so nothing is written per frame.
 */
export function heldAt(epoch, time) {
    if (!(epoch > -1e8)) return 0;
    return Math.min(HELD_MAX, Math.exp((epoch - time) / HELD_TAU));
}

/** The epoch after `amount` more charge arrives at `time`. */
export function addHeld(epoch, time, amount) {
    const now = heldAt(epoch, time);
    const next = Math.min(HELD_MAX, now + Math.max(0, amount));
    return next <= 1e-6 ? -1e9 : time + HELD_TAU * Math.log(next);
}

// ── A stroke's light in time ────────────────────────────────────────────────────

/** Seconds a return stroke takes to fade to 1/e, and the afterglow of the cooling channel. */
export const STROKE_DECAY = 0.055;
export const BRANCH_DECAY = 0.04;
export const AFTERGLOW = 0.32;
/**
 * The light a bolt throws on the storm (the cloud, the rain, the water, the lens) rises and falls
 * slowly beside the channel that makes it: seconds to rise to 1/e of its way, and to fall.
 */
export const GLOW_RISE = 0.07;
export const GLOW_FALL = 0.3;
/** The share of that light a later return stroke adds on top of the first one's swell. */
export const GLOW_RESTRIKE = 0.3;

/**
 * The plan of one bolt: when its leader connects and when each return stroke fires. Seeded, so a
 * bolt is the same on every replay.
 * @param {number} seed
 * @param {object} [options]
 * @param {number} [options.leader=0.11]   seconds the leader takes to reach the ground
 * @param {number} [options.strokes=3]     return strokes (the first is the brightest)
 * @param {number} [options.power=1]       gain on every stroke
 * @param {number} [options.gap=0.045]     the least time between two strokes (seconds)
 * @param {number} [options.spread=0.075]  how much longer than that a gap may be
 * @param {number} [options.hold=0]        seconds of continuing current after the first stroke: the
 *                                         channel stays alight instead of flickering out
 */
export function strokePlan(seed, {
    leader = 0.11, strokes = 3, power = 1, gap = 0.045, spread = 0.075, hold = 0,
} = {}) {
    const rand = mulberry32(0x9e37 + Math.floor(seed * 7919));
    const times = [leader];
    const gains = [power];
    for (let i = 1; i < strokes; i++) {
        times.push(times[i - 1] + gap + rand() * spread);
        gains.push(power * (0.38 + rand() * 0.42) * (1 - 0.1 * i));
    }
    const held = Math.max(0, hold);
    return {
        leader, times, gains, hold: held, last: Math.max(times[times.length - 1], leader + held),
    };
}

/**
 * The bolt's light `age` seconds after it began: how far the leader has come (0..1), the light of
 * the main channel, of the branches (they only flash on the first stroke), the afterglow, and the
 * number of the stroke that is alight (−1 before the first).
 */
export function strokeLight(plan, age, out = {}) {
    const o = out;
    o.grow = 0;
    o.main = 0;
    o.branch = 0;
    o.after = 0;
    o.stroke = -1;
    if (!(age >= 0)) return o;
    // The leader steps down in jumps: fast, held, fast.
    const g = clamp01(age / plan.leader);
    o.grow = g < 1 ? Math.min(1, (Math.floor(g * 7) + smooth(0, 0.35, (g * 7) % 1)) / 7) : 1;
    let main = 0;
    for (let i = 0; i < plan.times.length; i++) {
        const since = age - plan.times[i];
        if (since >= 0) {
            main += plan.gains[i] * Math.exp(-since / STROKE_DECAY);
            o.stroke = i;
        }
    }
    const first = age - plan.times[0];
    // A continuing current: the channel burns on at a steady, lower light, then lets go.
    if (plan.hold > 0 && first >= 0) {
        const left = first < plan.hold ? 1 : Math.exp(-(first - plan.hold) / 0.09);
        main = Math.max(main, plan.gains[0] * 0.34 * left);
    }
    o.main = main;
    o.branch = first >= 0 ? plan.gains[0] * Math.exp(-first / BRANCH_DECAY) : 0;
    const cooled = age - plan.last;
    o.after = cooled >= 0 ? Math.exp(-cooled / AFTERGLOW) * plan.gains[0] : 0;
    return o;
}

/** One swell of light: 0 at its start, 1 at its height, falling away slowly. */
function swell(since) {
    if (!(since > 0)) return 0;
    return (1 - Math.exp(-since / GLOW_RISE)) * Math.exp(-since / GLOW_FALL) * 1.64;
}

/**
 * The light a bolt throws on the storm round it `age` seconds after it began: ONE slow swell from
 * its first return stroke, each later stroke adding a little on top. The channel itself flickers
 * with every stroke (it is a thread across the picture); what it lights across the whole frame
 * rises and falls instead, so a storm of strokes never strobes the cloud, the rain or the lens.
 */
export function strokeGlow(plan, age) {
    if (!(age >= 0)) return 0;
    let glow = plan.gains[0] * swell(age - plan.times[0]);
    for (let i = 1; i < plan.times.length; i++) glow += GLOW_RESTRIKE * plan.gains[i] * swell(age - plan.times[i]);
    if (plan.hold > 0) glow += 0.35 * plan.gains[0] * smooth(0, plan.hold * 0.5, age - plan.times[0]) * (age - plan.times[0] < plan.hold ? 1 : Math.exp(-(age - plan.times[0] - plan.hold) / GLOW_FALL));
    return glow;
}

/** Seconds after which a bolt with this plan has nothing left to show. */
export function strokeLife(plan) {
    return plan.last + AFTERGLOW * 5;
}

// ── Colour ──────────────────────────────────────────────────────────────────────

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * A piece's colour as scene-linear rgb, lifted so no channel is dead (a pure red arc would
 * vanish in a blue storm) and normalised to a peak of 1.
 */
export function pieceColor(color, fallback = [0.45, 0.72, 1.0]) {
    let hex = null;
    if (typeof color === 'string' && /^#?[0-9a-f]{6}$/i.test(color.trim())) hex = color.trim().replace('#', '');
    else if (Number.isFinite(color)) hex = (color >>> 0).toString(16).padStart(6, '0').slice(-6);
    if (!hex) return [...fallback];
    const rgb = [0, 2, 4].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    return rgb.map((c) => (c / peak) * 0.94 + 0.06);
}

/** White-hot: the colour of a return stroke's core and of a superbolt. */
export const WHITE_HOT = Object.freeze([1.0, 0.97, 1.0]);

export const PALETTE_KEYS = Object.freeze([
    'horizon', 'gap', 'cloud', 'rim', 'haze', 'bolt', 'flash', 'water', 'corona', 'chain', 'steel',
]);

/**
 * Six storms (scene-linear), in the order of the colour wheel (teal, violet, red, amber, gold,
 * green, and round to teal), so the light can drift from each to the next through clean colours
 * (gold stands between amber and green: without it that stretch passed through khaki). A level
 * steps one on; the clock carries the storm slowly round by itself (see `palettePhase`):
 *   horizon  the clear strip at the horizon        gap     the sky above it, under the cloud's edge
 *   cloud    the cloud's own dark                  rim     the strip's light on the cloud's lobes
 *   haze     rain and distance                     bolt    a channel's halo
 *   flash    a stroke's light in cloud and rain    water   the plain's own colour
 *   corona   St Elmo's fire on the electrodes      chain   the standing arcs of a combo
 *   steel    the towers' metal
 */
export const VOLTAGE_STORM_PALETTES = Object.freeze([
    Object.freeze({
        name: 'tempest',
        horizon: [0.34, 0.6, 0.66],
        gap: [0.035, 0.11, 0.21],
        cloud: [0.011, 0.014, 0.03],
        rim: [0.085, 0.165, 0.23],
        haze: [0.028, 0.048, 0.076],
        bolt: [0.5, 0.58, 1.0],
        flash: [0.48, 0.58, 1.0],
        water: [0.004, 0.008, 0.016],
        corona: [0.32, 0.55, 1.0],
        chain: [0.72, 0.46, 1.0],
        steel: [0.03, 0.035, 0.046],
    }),
    Object.freeze({
        name: 'ultraviolet',
        horizon: [0.5, 0.36, 0.86],
        gap: [0.09, 0.05, 0.26],
        cloud: [0.014, 0.01, 0.034],
        rim: [0.15, 0.1, 0.3],
        haze: [0.04, 0.034, 0.09],
        bolt: [0.76, 0.52, 1.0],
        flash: [0.82, 0.7, 1.0],
        water: [0.007, 0.005, 0.018],
        corona: [0.66, 0.4, 1.0],
        chain: [0.4, 0.8, 1.0],
        steel: [0.034, 0.03, 0.05],
    }),
    Object.freeze({
        name: 'red sprite',
        horizon: [0.7, 0.16, 0.2],
        gap: [0.16, 0.03, 0.1],
        cloud: [0.02, 0.008, 0.02],
        rim: [0.24, 0.06, 0.12],
        haze: [0.066, 0.022, 0.044],
        bolt: [1.0, 0.44, 0.86],
        flash: [1.0, 0.62, 0.9],
        water: [0.012, 0.004, 0.01],
        corona: [1.0, 0.3, 0.55],
        chain: [1.0, 0.3, 0.3],
        steel: [0.04, 0.028, 0.036],
    }),
    Object.freeze({
        name: 'ember dusk',
        horizon: [0.78, 0.36, 0.13],
        gap: [0.2, 0.07, 0.11],
        cloud: [0.02, 0.012, 0.028],
        rim: [0.26, 0.11, 0.1],
        haze: [0.07, 0.036, 0.05],
        bolt: [1.0, 0.56, 0.72],
        flash: [1.0, 0.7, 0.78],
        water: [0.012, 0.006, 0.012],
        corona: [1.0, 0.5, 0.3],
        chain: [1.0, 0.36, 0.5],
        steel: [0.04, 0.03, 0.036],
    }),
    Object.freeze({
        name: 'golden squall',
        horizon: [0.84, 0.62, 0.17],
        gap: [0.17, 0.11, 0.045],
        cloud: [0.021, 0.016, 0.014],
        rim: [0.26, 0.19, 0.075],
        haze: [0.066, 0.052, 0.032],
        bolt: [1.0, 0.84, 0.48],
        flash: [1.0, 0.9, 0.62],
        water: [0.012, 0.009, 0.005],
        corona: [1.0, 0.78, 0.28],
        chain: [1.0, 0.6, 0.2],
        steel: [0.04, 0.036, 0.03],
    }),
    Object.freeze({
        name: 'hail green',
        horizon: [0.42, 0.7, 0.36],
        gap: [0.035, 0.17, 0.12],
        cloud: [0.008, 0.02, 0.018],
        rim: [0.1, 0.22, 0.14],
        haze: [0.026, 0.06, 0.05],
        bolt: [0.5, 1.0, 0.86],
        flash: [0.66, 1.0, 0.9],
        water: [0.004, 0.012, 0.011],
        corona: [0.3, 1.0, 0.72],
        chain: [0.55, 1.0, 0.4],
        steel: [0.028, 0.04, 0.038],
    }),
]);

/** Seconds the storm's light takes to drift from one palette to the next by itself. */
export const PALETTE_DRIFT = 80;
/** The shares of a drift step spent resting on a palette before leaving it and after reaching the next. */
export const PALETTE_REST = 0.15;

/**
 * Where the storm's light stands on the wheel of palettes: the level's place (a new level is one
 * step on) plus how far the clock has carried it, one step every PALETTE_DRIFT seconds.
 */
export function palettePhase(level, time) {
    const step = Number.isFinite(level) ? Math.max(0, Math.round(level) - 1) : 0;
    const drift = Number.isFinite(time) ? Math.max(0, time) / PALETTE_DRIFT : 0;
    return step + drift;
}

/**
 * The two palettes a phase lies between and how far it has gone from the first to the second
 * (0..1). The light rests on each palette for a while before it moves on.
 */
export function paletteMix(phase, out = {}) {
    const o = out;
    const n = VOLTAGE_STORM_PALETTES.length;
    const p = Number.isFinite(phase) ? Math.max(0, phase) : 0;
    const whole = Math.floor(p);
    o.from = whole % n;
    o.to = (whole + 1) % n;
    o.mix = smooth(PALETTE_REST, 1 - PALETTE_REST, p - whole);
    return o;
}

/** The storm's light at a phase: every colour of the palette, mixed, written into `out`. */
export function paletteAt(phase, out = {}) {
    const o = out;
    const { from, to, mix } = paletteMix(phase, paletteAt.scratch);
    const a = VOLTAGE_STORM_PALETTES[from];
    const b = VOLTAGE_STORM_PALETTES[to];
    for (let i = 0; i < PALETTE_KEYS.length; i++) {
        const key = PALETTE_KEYS[i];
        const colour = o[key] || (o[key] = [0, 0, 0]);
        for (let c = 0; c < 3; c++) colour[c] = a[key][c] + (b[key][c] - a[key][c]) * mix;
    }
    return o;
}
paletteAt.scratch = {};

// ── Composition ─────────────────────────────────────────────────────────────────

/**
 * How the storm is framed for an aspect ratio (width / height).
 *   hFov      the horizontal field of view the rig holds (degrees; the vertical one is clamped)
 *   horizon   the horizon's height in the frame, as a fraction from the bottom
 *   towers    the collectors: where each stands on screen at rest (`sx`, a fraction across), how
 *             far away (metres) and how tall. Two rows recede either side of the card; index 0
 *             is the hero. On an upright phone the card covers the middle of a narrow view, so
 *             the two rows stand in the margins either side of it and close ranks behind it.
 */
export function stormAnchors(aspect) {
    const a = Math.max(0.3, Math.min(3.2, Number.isFinite(aspect) ? aspect : 16 / 9));
    const wide = smooth(0.8, 1.45, a);
    const horizon = lerp(0.2, 0.28, wide);
    const reach = lerp(0.86, 1, wide);
    const tall = 1;
    const edge = lerp(0.085, 0.205, wide);
    const left = [
        { sx: edge, dist: 235, height: 66 },
        { sx: lerp(0.15, 0.305, wide), dist: 480, height: 70 },
        { sx: lerp(0.2, 0.352, wide), dist: 760, height: 72 },
        { sx: lerp(0.24, 0.378, wide), dist: 1120, height: 74 },
        { sx: lerp(0.27, 0.396, wide), dist: 1600, height: 76 },
    ];
    const right = [
        { sx: 1 - lerp(0.075, 0.127, wide), dist: 320, height: 66 },
        { sx: 1 - lerp(0.13, 0.2, wide), dist: 610, height: 70 },
        { sx: 1 - lerp(0.18, 0.238, wide), dist: 960, height: 72 },
        { sx: 1 - lerp(0.22, 0.262, wide), dist: 1380, height: 74 },
        { sx: 1 - lerp(0.25, 0.278, wide), dist: 1900, height: 76 },
    ];
    const towers = [];
    for (let i = 0; i < 5; i++) {
        towers.push({ ...left[i], side: -1, row: i });
        towers.push({ ...right[i], side: 1, row: i });
    }
    towers.forEach((t) => {
        t.dist *= reach;
        t.height *= tall;
    });
    return {
        aspect: a, hFov: 62, horizon, towers,
    };
}

/** Heights along a tower, as fractions of its height. */
export const TOWER = Object.freeze({
    /** The lattice mast's top. */
    mast: 0.8,
    /** The capacitor rings stand between these heights. */
    ringLo: 0.5,
    ringHi: 0.76,
    /** The toroid electrode. */
    toroid: 0.85,
    toroidRadius: 0.115,
    toroidTube: 0.034,
    /** The finial: where lightning strikes. */
    tip: 1.0,
    /** Half the lattice's width at the foot and under the electrode. */
    footHalf: 0.085,
    neckHalf: 0.022,
});
