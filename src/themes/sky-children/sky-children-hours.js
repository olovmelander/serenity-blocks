/**
 * Sky Children — Irisfall: the hours, the light the high country is seen in (CPU only,
 * three-free).
 *
 * The sun is always behind us. Five hours stand on a wheel in the order a day runs, which is
 * also the order of their signature hues (the accent's hue falls all the way round, 158° →
 * 37° → 349° → 220° → 192° → 158°, one whole turn):
 *
 *   jade     Jade Morning: a crisp bow, cobalt overhead, the strongest supernumeraries
 *   gilded   Gilded Afternoon: travertine and falls glowing gold
 *   rose     Rose Hour: a red bow, the Belt of Venus over the Earth's shadow, the children glow
 *   night    Moonbow Night: a silver moonbow, stars and the Milky Way, the grotto's warm heap
 *   pearl    Pearl Dawn: a pastel bow over the brightest fogbow, the mist at its brightest
 *
 * and round again to Jade Morning. There is no cobalt noon: that is Parhelion's.
 *
 * Where the light stands on the wheel is one number, the place:
 *
 *     place = levelPlace(level, eased over turnSeconds) + clock / HOUR_SECONDS
 *
 * so a new level turns it one whole hour and the clock turns it by itself, slowly, in every
 * mode (the ones that never level included, and under reduced motion too: a slow change of
 * colour is part of the theme). Within an hour the light rests on that hour's own colours for
 * HOUR_REST of the time at each end and is on its way to the next in between.
 *
 * The colours are authored as sRGB hex and handed out scene-linear. Two hours are mixed in
 * OKLCh along the short hue arc, so a crossing keeps its chroma (it never passes through grey:
 * warm-to-cool seams go through rose and lilac, never mud). Plain numbers mix linearly.
 */
import {
    clamp, fromOklchInGamut, hexToLinear, lerp, mixLch, smooth, toOklch,
} from './sky-children-core.js';

/** The hours in wheel order. Level 1 is Jade Morning. */
export const HOUR_NAMES = Object.freeze(['jade', 'gilded', 'rose', 'night', 'pearl']);
/** Seconds of the world's clock one hour lasts when no level turns it (550 s a whole day). */
export const HOUR_SECONDS = 110;
/** The share of an hour, at each end, the light rests on that hour's own colours. */
export const HOUR_REST = 0.15;
/** A new level turns the wheel one hour in this many seconds (a long way a little longer). */
export const TURN_SECONDS = 3.6;

const H = HOUR_NAMES.length;
const row = (...hexes) => Object.freeze(hexes);

/**
 * Every hour's colours (sRGB hex, in HOUR_NAMES order), one named row each:
 *   zenith, mid, horizon   the sky ahead of us, top to bottom (the horizon is the antisolar one)
 *   belt, earthShadow      the Belt of Venus and the shadow of the world under it
 *   key                    the light from behind us
 *   shadow                 what shade is tinted (never black)
 *   rim                    the key grazing an edge
 *   cloudLit, cloudShade   an altocumulus' lit face and its shade
 *   shower                 the slate under-body of the storm wall behind the bow's leg
 *   stone, rock            travertine's tint, and the iron-stone root
 *   water                  a pool's milky jade body
 *   mistLit, mistShade     the top of the Deep, and its shelves' shade (the wedges)
 *   deep                   the bottom of the abyss
 *   hearth                 the grotto's glow
 *   accent, accentB        the hour's signature (one line) and its warm second (two lines)
 *   cirrus                 the high streaks' light (they catch the hour first and last)
 */
export const HOUR_COLOURS = Object.freeze({
    zenith: row('#1f5aa0', '#173a7e', '#20235f', '#090c28', '#5b72b0'),
    mid: row('#4f97c9', '#5c84b6', '#5a4f93', '#17204f', '#a8b4da'),
    horizon: row('#c6e7e1', '#f2c98a', '#f2a3b5', '#2a3466', '#f1e6f0'),
    belt: row('#e3d6dc', '#f2d6bc', '#f4a6b8', '#3a3a6e', '#efc2cf'),
    earthShadow: row('#8ea6bc', '#9a97b6', '#46598f', '#141a3e', '#7b84b0'),
    key: row('#ffe7c2', '#ffc870', '#ff9a6a', '#bccaff', '#ffd9c0'),
    shadow: row('#3f6f8a', '#4a4a96', '#5a3f7a', '#141a3e', '#5b6b9a'),
    rim: row('#ffe3b0', '#ffc274', '#ffb08a', '#9fb2ff', '#ffd2b0'),
    cloudLit: row('#fff7ea', '#ffe8bc', '#ffc4a8', '#8a9ad0', '#ffe6dc'),
    cloudShade: row('#9bb6cc', '#8f98c0', '#5e5e9e', '#232a52', '#9a9cc8'),
    shower: row('#28324e', '#2c2c4e', '#272248', '#0c1026', '#5a6088'),
    stone: row('#f3efe6', '#f7e4c4', '#ffd8c4', '#9aa6c8', '#f6e8e2'),
    rock: row('#4a4a5e', '#55483f', '#4a3a50', '#191d38', '#525064'),
    water: row('#8fdcc8', '#7fd3c6', '#8ec6c4', '#3d6d86', '#9fd8d0'),
    mistLit: row('#e2f6ee', '#ffd59a', '#f0c4cc', '#5b6aa0', '#ecebf4'),
    mistShade: row('#5f86b5', '#6d78b0', '#4a5a9a', '#1d2550', '#8a90bc'),
    deep: row('#132746', '#26306a', '#171640', '#04061a', '#1f2856'),
    hearth: row('#ffcf8f', '#ffc98a', '#ffc480', '#ffc27a', '#ffcf98'),
    accent: row('#6fd6b0', '#ffbe55', '#ff6f8a', '#8fb4ff', '#9fd8e6'),
    accentB: row('#ffd27a', '#ff9a76', '#ffc070', '#ffc27a', '#ffb6c8'),
    cirrus: row('#f2f6fa', '#ffdc9a', '#ffaab4', '#b8c6ee', '#ffe2ea'),
});

/** The colour rows in the order of the uniform array the shaders read (one vec4 per row). */
export const COLOUR_ROWS = Object.freeze(Object.keys(HOUR_COLOURS));

/**
 * The post's split-tone per hour (multipliers, mixed linearly): the house grade is Parrish,
 * shadows leaning cobalt-violet and lights warm gold.
 */
export const HOUR_GRADES = Object.freeze({
    shadow: Object.freeze([
        [0.93, 0.98, 1.09], [0.92, 0.95, 1.1], [0.94, 0.9, 1.1], [0.9, 0.95, 1.12], [0.95, 0.95, 1.07],
    ].map((c) => Object.freeze(c))),
    light: Object.freeze([
        [1.05, 1.01, 0.94], [1.07, 1.0, 0.9], [1.08, 0.98, 0.93], [1.0, 1.0, 1.04], [1.05, 1.0, 0.96],
    ].map((c) => Object.freeze(c))),
});

/**
 * Every hour's plain numbers (in HOUR_NAMES order), mixed linearly:
 *   exposure     the lens
 *   keyGain      the key light's HDR strength on lit surfaces
 *   keyNudge     degrees added to the key's elevation (the solver clamps A on screen)
 *   twilight     the weight of the Belt of Venus and the Earth's shadow
 *   polar        how much the polarised band 90° from the sun darkens the zenith
 *   stars, milky the night sky
 *   bowGain      the bow's strength; bowSat its colour (1 the full spectrum, Night a pale moonbow)
 *   fogbow       the white ghost on the Deep
 *   hearth       the grotto's strength; gliderGlow the children's inner glow
 *   aloft        the share of children flying (the rest sleep in the grotto)
 *   cloud        altocumulus cover; shower the shower's cover and darkness; spray its density
 *   shadowDepth  how dark the isles' wedges lie on the mist
 *   albedoSat    how much colour the stone and the turf keep (moonlight leaves little: Purkinje)
 *   rays         the anticrepuscular rays' depth (the shadows of clouds behind us, converging on A)
 *   cirrus       the high streaks' cover
 */
export const HOUR_SCALARS = Object.freeze({
    exposure: row(1.0, 1.0, 1.05, 1.25, 1.15),
    keyGain: row(2.2, 2.6, 1.8, 0.85, 1.8),
    keyNudge: row(0, -0.3, -1.0, 0.5, -0.5),
    twilight: row(0, 0.15, 1.0, 0, 0.6),
    polar: row(0.42, 0.55, 0.26, 0.1, 0.3),
    stars: row(0, 0, 0.15, 1.0, 0),
    milky: row(0, 0, 0, 1.0, 0),
    bowGain: row(1.0, 1.0, 1.1, 0.6, 0.85),
    bowSat: row(1.0, 1.0, 1.0, 0.18, 0.75),
    fogbow: row(0.05, 0.05, 0.06, 0.04, 0.14),
    hearth: row(0, 0.05, 0.45, 1.0, 0.3),
    gliderGlow: row(0, 0.1, 0.6, 1.0, 0.5),
    aloft: row(1.0, 1.0, 0.8, 0.25, 0.7),
    cloud: row(0.35, 0.42, 0.48, 0.25, 0.3),
    shower: row(0.85, 0.8, 0.9, 0.6, 0.7),
    spray: row(1.0, 1.0, 1.0, 0.8, 1.1),
    shadowDepth: row(0.45, 0.5, 0.65, 0.3, 0.5),
    albedoSat: row(1.0, 1.0, 0.9, 0.35, 0.8),
    rays: row(0.22, 0.42, 0.5, 0.03, 0.06),
    cirrus: row(0.65, 0.85, 1.0, 0.5, 0.7),
});

const SCALAR_NAMES = Object.freeze(Object.keys(HOUR_SCALARS));

// Every colour once, scene-linear and in OKLCh, so a frame only mixes.
const LINEAR = COLOUR_ROWS.map((name) => HOUR_COLOURS[name].map((hex) => Object.freeze(hexToLinear(hex))));
const LCH = LINEAR.map((hours) => hours.map((rgb) => Object.freeze(toOklch(rgb))));

/**
 * The five hours resolved: name, index, every colour row (linear), every number, both grades.
 * The wheel's fixed points (what hourAt gives while the light rests on an hour).
 */
export const HOURS = Object.freeze(HOUR_NAMES.map((name, index) => Object.freeze({
    name,
    index,
    colour: Object.freeze(Object.fromEntries(COLOUR_ROWS.map((key, r) => [key, LINEAR[r][index]]))),
    scalar: Object.freeze(Object.fromEntries(SCALAR_NAMES.map((key) => [key, HOUR_SCALARS[key][index]]))),
    gradeShadow: HOUR_GRADES.shadow[index],
    gradeLight: HOUR_GRADES.light[index],
})));

const wrap = (place) => ((place % H) + H) % H;

/**
 * Which two hours the light stands between at a place, and how far it has crossed (0 while it
 * rests on the first, 1 while it rests on the second).
 * @param {number} place any real; the wheel wraps every HOUR_NAMES.length
 * @param {{from?: number, to?: number, mix?: number}} [out]
 */
export function hourMix(place, out = {}) {
    const p = wrap(Number.isFinite(place) ? place : 0);
    const from = Math.min(H - 1, Math.floor(p));
    out.from = from;
    out.to = (from + 1) % H;
    out.mix = smooth(HOUR_REST, 1 - HOUR_REST, p - from);
    return out;
}

const mixScratch = [0, 0, 0];

/**
 * The light at a place on the wheel, written into `out` (reused: nothing is allocated after the
 * first call with the same `out`):
 *   { place, from, to, mix, name, colour: { <row>: [r, g, b] linear }, scalar: { <name>: n },
 *     gradeShadow: [r, g, b], gradeLight: [r, g, b] }
 * `name` is the hour the light stands nearer to.
 * @param {number} place
 * @param {object} [out]
 */
export function hourAt(place, out = {}) {
    hourMix(place, out);
    const { from, to, mix } = out;
    out.place = Number.isFinite(place) ? place : 0;
    out.name = HOUR_NAMES[mix < 0.5 ? from : to];
    if (!out.colour) out.colour = {};
    if (!out.scalar) out.scalar = {};
    if (!out.gradeShadow) out.gradeShadow = [0, 0, 0];
    if (!out.gradeLight) out.gradeLight = [0, 0, 0];
    for (let r = 0; r < COLOUR_ROWS.length; r++) {
        const key = COLOUR_ROWS[r];
        if (!out.colour[key]) out.colour[key] = [0, 0, 0];
        const c = out.colour[key];
        if (mix <= 0 || mix >= 1) {
            const at = LINEAR[r][mix <= 0 ? from : to];
            c[0] = at[0];
            c[1] = at[1];
            c[2] = at[2];
        } else {
            fromOklchInGamut(mixLch(LCH[r][from], LCH[r][to], mix, mixScratch), c);
        }
    }
    for (let s = 0; s < SCALAR_NAMES.length; s++) {
        const key = SCALAR_NAMES[s];
        out.scalar[key] = lerp(HOUR_SCALARS[key][from], HOUR_SCALARS[key][to], mix);
    }
    const sa = HOUR_GRADES.shadow[from];
    const sb = HOUR_GRADES.shadow[to];
    const la = HOUR_GRADES.light[from];
    const lb = HOUR_GRADES.light[to];
    for (let i = 0; i < 3; i++) {
        out.gradeShadow[i] = lerp(sa[i], sb[i], mix);
        out.gradeLight[i] = lerp(la[i], lb[i], mix);
    }
    return out;
}

/** The place a level holds on the wheel (before the clock's drift): level 1 is Jade Morning. */
export function levelPlace(level) {
    return Number.isFinite(level) ? level - 1 : 0;
}

/** How far the clock alone has turned the wheel. */
export function clockPlace(clock) {
    return Number.isFinite(clock) ? clock / HOUR_SECONDS : 0;
}

/** How long a turn of `delta` hours takes: one hour in TURN_SECONDS, a long way a little longer. */
export function turnSeconds(delta) {
    return TURN_SECONDS * Math.max(1, Math.sqrt(Math.abs(Number(delta) || 0)));
}

/**
 * The next Jade Morning at or ahead of a place: the smallest place ≥ `place` that is a whole
 * number of days (≡ 0 mod 5). A place already exactly on one is its own target.
 */
export function forwardTarget(place) {
    const p = Number.isFinite(place) ? place : 0;
    return Math.ceil(p / H - 1e-12) * H + 0; // + 0: never −0
}

/**
 * The world's wheel: the eased level offset plus the clock's drift, deterministic in time
 * (every answer is a function of the time asked and the events so far, never of frame steps).
 *
 *   levelUp(level, time, {silent})  a new level turns the light forward one hour per level
 *                                   (silent: arrive at once, e.g. carrying a level over a
 *                                   rebuild); never backward, whatever level is reported
 *   newRun(time)                    runs FORWARD round the wheel to the next Jade Morning
 *   placeAt(clock)                  the place to light the world with
 *   pin(place | null)               hold the wheel still (the playground's ?hour=)
 *   reset(time)                     level 1 of the first run (a seek)
 *   snapshot() / restore(state)     carry the wheel over a rebuild (a function of the same clock)
 */
export class HourWheel {
    constructor() {
        /** @type {number|null} */
        this.pinned = null;
        this.reset(0);
    }

    /** Back to level 1 of the first run: the place is the clock's drift alone. */
    reset(time = 0) {
        this.level = 1;
        /** The offset at which level 1 of the current run sits. */
        this.base = 0;
        this.from = 0;
        this.to = 0;
        this.at = Number.isFinite(time) ? time : 0;
        this.seconds = TURN_SECONDS;
    }

    /** The eased level offset at `time` (the part of the place the levels and runs turned). */
    offsetAt(time) {
        const since = time - this.at;
        if (!(since > 0)) return this.from;
        return this.from + (this.to - this.from) * smooth(0, Math.max(0.01, this.seconds), since);
    }

    /** True while a level or a new run is still turning the wheel. */
    turning(time) {
        return this.to !== this.from && time - this.at < this.seconds;
    }

    /**
     * @param {number} level the level reached (1-based)
     * @param {number} time the world's clock
     * @param {{silent?: boolean}} [options]
     */
    levelUp(level, time, { silent = false } = {}) {
        const L = Math.max(1, Math.floor(Number(level)) || 1);
        const t = Number.isFinite(time) ? time : 0;
        const now = this.offsetAt(t);
        let target = this.base + levelPlace(L);
        if (target < now - 1e-9) {
            // A level reported lower than where the light stands: on round the wheel to it.
            const days = Math.ceil((now - target) / H - 1e-9) * H;
            target += days;
            this.base += days;
        }
        this.level = L;
        this.at = t;
        if (silent) {
            this.from = target;
            this.to = target;
            this.seconds = TURN_SECONDS;
            return;
        }
        this.from = now;
        this.to = target;
        this.seconds = turnSeconds(target - now);
    }

    /**
     * A new run: the light runs forward round the wheel to the next Jade Morning (it lands a
     * hair past it, inside the rest, so the clock's own drift during the turn never makes the
     * place step back).
     * @param {number} time
     */
    newRun(time) {
        const t = Number.isFinite(time) ? time : 0;
        const now = this.offsetAt(t);
        const place = now + clockPlace(t);
        // Already resting on a Jade Morning (inside its rest at the start of the hour): stay.
        const intoHour = ((place % H) + H) % H;
        const delta = intoHour <= HOUR_REST ? 0 : forwardTarget(place) - place;
        this.from = now;
        this.to = now + delta;
        this.at = t;
        this.seconds = turnSeconds(delta);
        this.base = this.to;
        this.level = 1;
    }

    /** The run's turn of the wheel (not the pin: that is the playground's, never a run's). */
    snapshot() {
        return {
            level: this.level, base: this.base, from: this.from, to: this.to, at: this.at, seconds: this.seconds,
        };
    }

    /** Take up a snapshot() again; anything missing or not finite leaves the wheel as it is. */
    restore(state) {
        const keys = ['level', 'base', 'from', 'to', 'at', 'seconds'];
        if (!state || !keys.every((k) => Number.isFinite(state[k]))) return false;
        keys.forEach((k) => { this[k] = state[k]; });
        return true;
    }

    /** The place on the wheel at the world's clock (the pin, if one is held). */
    placeAt(clock) {
        if (this.pinned !== null) return this.pinned;
        const t = Number.isFinite(clock) ? clock : 0;
        return this.offsetAt(t) + clockPlace(t);
    }

    /** Holds the wheel at a place (fractions show a crossing); null lets it turn again. */
    pin(place) {
        this.pinned = Number.isFinite(place) ? clamp(place, -1e6, 1e6) : null;
    }
}
