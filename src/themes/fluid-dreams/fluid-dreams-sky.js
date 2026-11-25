/**
 * Fluid Dreams — the sky's life: the airs the dusk wears, the dream sun's slow arc, the liquid
 * forms far out on the sea, the bubbles adrift overhead, what happens by itself now and then, and
 * the sky's share of every event of play.
 *
 * Three-free and renderer-free. It owns ONE table the liquid material reads (`rows`: two rows per
 * far form, then two per bubble) and a handful of numbers the world copies into uniforms. Like
 * the choreography, everything is a function of the clock and the event history, stepped with the
 * frame's delta, so a seek and a replay reproduce a frame.
 *
 *   airs        five weathers on their own clock beside the five dusks (113 s against 100 s, so
 *               the pairings take over an hour to come round): how much ink the sky carries, the
 *               bars of cloud on the sea line, mist, how the sea runs, how many stars and bubbles
 *               are out, how high the sun stands. A level is two airs on.
 *   sun         it never leaves the sea line, but it rides up and down it and wanders a little.
 *   happenings  every half minute or so one thing happens that play did not ask for: a falling
 *               star, a train of bubbles rising out of the sea, a shoal of light passing under the
 *               surface, a far form sinking and coming up again, a fountain far out.
 *   events      a level's front of light opening from the sun, a four-line clear's pillar and the
 *               ring it drives through the ink, a twist's turning sky, a perfect clear's halo and
 *               clearing sky, a back-to-back's flare in the far forms.
 */
import { Swell } from '../shared/swell.js';
import { easeStep, moodDrift, wheelAt } from '../shared/mood-clock.js';
import {
    DEG, TAU, approach, clamp01, lerp, mulberry32, smooth,
} from './fluid-dreams-core.js';

// ── The airs ────────────────────────────────────────────────────────────────────

/** Seconds an air lasts when only the clock turns it, and the share of that it rests, pure. */
export const AIR_SECONDS = 113;
export const AIR_HOLD = 0.4;
/** A level moves the air this many steps on (and the dusk one: the pairing changes too). */
export const AIR_LEVEL_STEP = 2;

/**
 * cover    how much of the sky the ink takes (0..1)
 * strata   the bars of cloud lying along the sea line (0..1)
 * mist     mist on the sea line and in the air over the sea (0..1)
 * calm     the swell's size (1 = the sea as it was; 0.3 = nearly glass)
 * stars    the stars and the star river (1 = as it was)
 * bubbles  the share of the bubbles that are out (0..1)
 * motes    the mist of light rising off the sea (1 = as it was)
 * veins    the light running in the sea (1 = as it was)
 * lift     how high the sun rides (0 = half sunk, 1 = its highest)
 * wind     how fast the ink moves
 * halo     the ring round the sun
 */
export const AIRS = Object.freeze([
    Object.freeze({
        name: 'clear-dusk',
        cover: 0.5,
        strata: 0.35,
        mist: 0.06,
        calm: 1,
        stars: 1,
        bubbles: 0.45,
        motes: 1,
        veins: 1,
        lift: 0.45,
        wind: 1,
        halo: 0.22,
    }),
    Object.freeze({
        name: 'ink-tide',
        cover: 0.95,
        strata: 0.62,
        mist: 0.2,
        calm: 1.12,
        stars: 0.4,
        bubbles: 0.25,
        motes: 0.8,
        veins: 1.15,
        lift: 0.22,
        wind: 1.6,
        halo: 0.08,
    }),
    Object.freeze({
        name: 'glass-calm',
        cover: 0.12,
        strata: 0.2,
        mist: 0.4,
        calm: 0.22,
        stars: 1.7,
        bubbles: 0.6,
        motes: 0.6,
        veins: 0.8,
        lift: 0.04,
        wind: 0.5,
        halo: 0.9,
    }),
    Object.freeze({
        name: 'the-bloom',
        cover: 0.44,
        strata: 0.28,
        mist: 0.2,
        calm: 0.8,
        stars: 0.85,
        bubbles: 1,
        motes: 2.1,
        veins: 1.9,
        lift: 0.72,
        wind: 0.8,
        halo: 0.4,
    }),
    Object.freeze({
        name: 'long-swell',
        cover: 0.72,
        strata: 0.95,
        mist: 0.3,
        calm: 1.5,
        stars: 0.55,
        bubbles: 0.3,
        motes: 1.2,
        veins: 1.25,
        lift: 1,
        wind: 2.1,
        halo: 0.14,
    }),
]);

export const AIR_KEYS = Object.freeze([
    'cover', 'strata', 'mist', 'calm', 'stars', 'bubbles', 'motes', 'veins', 'lift', 'wind', 'halo',
]);

const AT = { a: 0, b: 0, melt: 0 };

/** How far the clock alone has turned the airs by `time` (whole part: airs passed; fraction: the melt). */
export const airDrift = (time) => moodDrift(time, AIR_SECONDS, AIR_HOLD);

/** The air at `phase` round the wheel, written into `out`: on a whole phase that air exactly. */
export function airAt(phase, out = {}) {
    wheelAt(phase, AIRS.length, AT);
    const a = AIRS[AT.a];
    const b = AIRS[AT.b];
    for (let i = 0; i < AIR_KEYS.length; i += 1) {
        const key = AIR_KEYS[i];
        out[key] = lerp(a[key], b[key], AT.melt);
    }
    return out;
}

/** The air a phase round the wheel stands nearest. */
export const airNear = (phase) => {
    const count = AIRS.length;
    return AIRS[((Math.round(phase) % count) + count) % count];
};

// ── The dream sun ───────────────────────────────────────────────────────────────

/**
 * The sun keeps to the sea line: the sine of its elevation runs from `low` (its disc half in the
 * sea) to `high`, part by the air and part by a slow wave of its own, and it wanders `sway` of the
 * frame's width either side of where the composition stands it.
 */
export const SUN = Object.freeze({
    low: 0.012, high: 0.1, period: 289, share: 0.35, swayPeriod: 367, sway: 0.016,
});

/** How high the sun rides at `time` in an air whose own lift is `airLift` (0..1). */
export function sunLift(time, airLift) {
    const wave = 0.5 - 0.5 * Math.cos((time * TAU) / SUN.period);
    return clamp01(airLift * (1 - SUN.share) + wave * SUN.share);
}

/** The sine of the sun's elevation for a lift. */
export const sunHeight = (lift) => lerp(SUN.low, SUN.high, clamp01(lift));

/** How far (fractions of the frame's width) the sun stands from its anchor at `time`. */
export const sunSway = (time) => Math.sin((time * TAU) / SUN.swayPeriod + 0.6) * SUN.sway;

// ── The far forms ───────────────────────────────────────────────────────────────

/**
 * Liquid forms far out on the sea, each a body of revolution on its own thread, as
 * (bearing °, elevation ° of its body's centre, radius °, how wide, how tall, a bead above it as
 * a share of its radius). Six stand where a 16:9 frame shows sea beside the solo card and the
 * stats bar (bearings −40°..−10° and 23°..40°; the card and the bar hide the rest), four more
 * for a wider frame; a few stand nearer than the rest, so the sea has a middle distance.
 */
export const FAR_FORMS = Object.freeze([
    [-52, 3.1, 0.95, 1, 1, 0],
    [-45, 4.6, 1.5, 0.94, 1.08, 0],
    [-36.5, 4.0, 1.3, 1, 1, 0.52],
    [-30.5, 2.3, 0.6, 0.8, 1.3, 0],
    [-19.5, 2.9, 0.85, 1.2, 0.8, 0],
    [-13.5, 2.1, 0.55, 1, 1, 0],
    [12.2, 2.2, 0.55, 1, 1, 0.55],
    [25.8, 3.6, 1.1, 1.14, 0.84, 0],
    [37.5, 2.6, 0.75, 0.82, 1.25, 0],
    [50, 3.8, 1.2, 1, 1, 0.5],
]);
export const FAR_COUNT = FAR_FORMS.length;

/** Nothing of a far form shows above this height in the sky (sine of its elevation). */
/** The bead a form wears when it comes up changed from a sink (it had none) and the most any form wears. */
export const SINK_BEAD = 0.5;
const BEAD_MOST = Math.max(SINK_BEAD, ...FAR_FORMS.map((form) => form[5]));
export const FAR_BAND = Math.max(
    // (every form may wear a bead: one that had none comes up from a sink with one)
    ...FAR_FORMS.map(([, elevation, size, , tall]) => Math.sin((elevation + size * (tall + BEAD_MOST * 2 + 0.4)) * DEG)),
);

// ── The bubbles ─────────────────────────────────────────────────────────────────

/** Bubble slots: the first `ambient` drift by themselves, the rest rise in trains. */
export const BUBBLE_SLOTS = 14;
export const BUBBLE_TRAIN = 4;
/** Where they live (metres; the eye is near the origin looking down −Z): behind every drop. */
export const BUBBLE_BOX = Object.freeze({
    halfWidth: 78, near: -46, far: -120, top: 34,
});
/** Seconds a train's bubble takes to rise out of sight. */
const TRAIN_LIFE = 34;

export const SKY_ROWS = (FAR_COUNT + BUBBLE_SLOTS) * 2;

// ── Happenings ──────────────────────────────────────────────────────────────────

/**
 * Things that happen by themselves: one slot every `period` seconds from `lead` on, starting up to
 * `jitter` seconds into its slot. Which one is a hash of the slot (falling stars come up twice as
 * often as the rest), so a seek lands on the same thing.
 */
export const HAPPENINGS = Object.freeze({
    period: 27,
    lead: 12,
    jitter: 9,
    kinds: Object.freeze(['star', 'bubbles', 'shoal', 'star', 'sink', 'fountain']),
});

/** The happening of slot `index`: { kind, at }. */
export function happeningOf(index, out = { kind: 'star', at: 0, seed: 1 }) {
    const rand = mulberry32(0x9e37 + index * 2654435);
    out.seed = Math.floor(rand() * 0x7fffffff) + 1;
    out.kind = HAPPENINGS.kinds[Math.floor(rand() * HAPPENINGS.kinds.length) % HAPPENINGS.kinds.length];
    out.at = HAPPENINGS.lead + index * HAPPENINGS.period + rand() * HAPPENINGS.jitter;
    return out;
}

function rows(count) {
    return Array.from({ length: count }, () => ({
        x: 0, y: 0, z: 0, w: 0,
    }));
}

/** Where a direction lies in the ink's own plane (the deck the clouds are drawn in). */
function deckOf(dx, dy, dz, out) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const lift = Math.abs(dy) / len + 0.3;
    out[0] = dx / len / lift;
    out[1] = dz / len / lift;
    return out;
}

export class FluidSky {
    /**
     * @param {object} [options]
     * @param {number} [options.bubbles] the most bubbles this tier draws (ambient and trains together)
     * @param {(burst: object) => void} [options.emit] spray sink: { kind, x, y, z, color, power }
     */
    constructor(options = {}) {
        this.bubbleCount = Math.max(0, Math.min(BUBBLE_SLOTS, Math.round(options.bubbles ?? BUBBLE_SLOTS)));
        this.trainCount = Math.min(BUBBLE_TRAIN, Math.floor(this.bubbleCount / 3));
        this.ambientCount = this.bubbleCount - this.trainCount;
        this.emit = options.emit || null;
        this.rows = rows(SKY_ROWS);
        this.reducedMotion = false;
        this.happeningsOn = true;
        /** Hold one air (captures, the playground): its index, or null to let the wheel turn. */
        this.airHold = null;
        this.level = 1;
        this.airStep = 0;
        this.air = {};
        airAt(0, this.air);
        this.airPhase = 0;

        // what the world copies into uniforms
        this.sun = { height: sunHeight(0.45), sway: 0 };
        this.skyClock = 0;
        this.front = { radius: 0, strength: 0, width: 0.12 };
        this.pillar = {
            x: 0, z: 0, strength: 0, width: 0.03,
        };
        this.shock = {
            x: 0, z: 0, radius: 0, strength: 0,
        };
        this.swirl = {
            x: 0, z: 0, angle: 0, radius: 0.55,
        };
        this.star = {
            head: [0, 1, 0], along: [1, 0, 0], strength: 0, length: 0.2,
        };
        this.shoal = {
            x: 0, z: 0, radius: 5, strength: 0,
        };
        this.halo = 0;
        this.halo2 = 0;
        /** Which side of the view the sun stands on (the sign of its bearing's x). */
        this.sunSide = 1;
        /** How many bubbles show this frame: the first rows of the bubbles' part of the table. */
        this.bubbleLive = 0;
        this.clearing = 0;
        this.starGain = 1;
        this.moteSurge = 0;

        // per-slot constants of the ambient bubbles (their cycles are closed-form in the clock)
        const rand = mulberry32(0xb0b1e);
        this._bubble = Array.from({ length: BUBBLE_SLOTS }, (_, i) => ({
            period: 44 + rand() * 30,
            offset: rand() * 80,
            seed: 1 + Math.floor(rand() * 1e6) + i * 7919,
            popped: -1,
            popAt: -1e9,
        }));
        this._deck = [0, 0];
        this._happening = { kind: 'star', at: 0, seed: 1 };
        this._race = new Swell({
            attack: 0.3, release: 2.4, ceiling: 6, knee: 4,
        });
        this._halo = new Swell({
            attack: 0.5, release: 3.2, ceiling: 1.4, knee: 1,
        });
        this._clear = new Swell({
            attack: 0.8, release: 4.5, ceiling: 1, knee: 0.8,
        });
        this._flare = new Swell({
            attack: 0.1, release: 1.6, ceiling: 1.6, knee: 1,
        });
        this.reset();
    }

    /**
     * Back to rest: no event of play in flight. What the sky does by itself is not play's: a new
     * run does not cut a falling star, a train of bubbles, a shoal or a sinking form short, and a
     * bubble that burst stays burst (only a seek starts those over).
     */
    reset() {
        this.time = 0;
        if (!this.train) this._resetHappenings();
        this.frontT0 = -1e9;
        this.pillarT0 = -1e9;
        this.pillarAt = [0, 0];
        this.shockT0 = -1e9;
        this.shockAt = [0, 0];
        this.shockBearing = [0, -1];
        this.twist = 0;
        this.twistAt = [0, 0, 0];
        Object.assign(this.front, { radius: 0, strength: 0, width: 0.12 });
        Object.assign(this.pillar, {
            x: 0, z: 0, strength: 0, width: 0.03,
        });
        Object.assign(this.shock, {
            x: 0, z: 0, radius: 0, strength: 0,
        });
        Object.assign(this.swirl, {
            x: 0, z: 0, angle: 0, radius: 0.55,
        });
        this._race.reset();
        this._halo.reset();
        this._clear.reset();
        this._flare.reset();
        this.front.strength = 0;
        this.pillar.strength = 0;
        this.shock.strength = 0;
        this.swirl.angle = 0;
    }

    /** The sky's own happenings back to nothing in flight (the constructor and a seek). */
    _resetHappenings() {
        this.lastSlot = null;
        this.starT0 = -1e9;
        this.starFrom = [0, 1, 0];
        this.shoalT0 = -1e9;
        this.shoalFrom = [0, 0];
        this.shoalTo = [0, 0];
        this.sink = { index: -1, t0: -1e9 };
        this.train = {
            t0: -1e9, x: 0, z: -70, seed: 1,
        };
        this.farBead = FAR_FORMS.map((form) => form[5]);
        this._bubble.forEach((b) => {
            b.popped = -1;
            b.popAt = -1e9;
        });
        this.star.head = [0, 1, 0];
        this.star.along = [1, 0, 0];
        this.star.strength = 0;
        this.star.length = 0.2;
        Object.assign(this.shoal, {
            x: 0, z: 0, radius: 5, strength: 0,
        });
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures). */
    seek(time) {
        this.reset();
        this._resetHappenings();
        this.time = Number.isFinite(time) ? Math.max(0, time) : 0;
        this.skyClock = this.time;
        // (level 1 and no step: the same air however many levels came before; the caller sets the level after)
        this.level = 1;
        this.airStep = 0;
        this._refreshAir();
    }

    /** The air and the sun for the clock as it stands (a seek, a level landed at once): no frame runs on the air before. */
    _refreshAir() {
        this.airPhase = this.airHold === null ? this.airStep + airDrift(this.time) : this.airHold;
        airAt(this.airPhase, this.air);
        this.placeSun(this.time);
    }

    /** The level's step round the airs (eased in update); `snap` lands it at once. */
    setLevel(level, snap = false) {
        // (a level that is no number, or has no end, is the first)
        const n = Number(level);
        this.level = Number.isFinite(n) ? Math.max(1, Math.min(1e6, Math.round(n))) : 1;
        if (snap) {
            this.airStep = easeStep(this.airStep, (this.level - 1) * AIR_LEVEL_STEP, 1, AIRS.length);
            this._refreshAir();
        }
    }

    // ── events ──────────────────────────────────────────────────────────────────

    /** A new level: a front of light opens from the sun and crosses the sky; the ink races. */
    levelUp() {
        this.frontT0 = this.time;
        this._race.hit(2.2, this.time);
        this._flare.hit(0.5, this.time + 0.4);
    }

    /**
     * The Great Drop meets the sea at (x, z): a pillar of light stands on the crater, a ring runs
     * out through the ink overhead, the far forms flare as it reaches them and the bubbles it
     * meets burst.
     */
    impact(x, z, boost = 0) {
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        this.pillarT0 = this.time;
        this.pillarAt[0] = x;
        this.pillarAt[1] = z;
        this.pillarPower = 1 + boost * 0.3;
        this.shockT0 = this.time;
        this.shockAt[0] = x;
        this.shockAt[1] = z;
        this._race.hit(1.6, this.time);
        this._flare.hit(1, this.time + 0.5);
    }

    /** A back-to-back: every far form answers the kin's fire. */
    answer(delay = 0) {
        this._flare.hit(0.8, this.time + delay);
    }

    /** A perfect clear from `at`: the ink draws back, the stars come out, the sun wears its halo. */
    perfect(at = this.time) {
        this._halo.hit(1, at);
        this._clear.hit(1, at);
        this._flare.hit(0.6, at + 0.3);
    }

    /** The twist's funnel, 0..1.5, over the world point it winds at: the ink overhead turns with it. */
    setTwist(env, x = 0, y = 0, z = 0) {
        this.twist = Number.isFinite(env) ? Math.max(0, Math.min(2, env)) : 0;
        // (a twist with no place keeps the place it had)
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            this.twistAt[0] = x;
            this.twistAt[1] = y;
            this.twistAt[2] = z;
        }
    }

    /** Fire one happening now (the scheduler's own call; captures and tests call it directly). */
    happen(kind, seed = 1) {
        const rand = mulberry32(seed);
        const { time } = this;
        if (kind === 'star') {
            // Beside the card, under the frame's top, falling shallow AWAY from the card toward the
            // frame's edge: one that started out wide and ran inward crossed behind the card, and one
            // that started at 20-40 degrees was above the frame (its top stands near 30 at the middle).
            // (seven in ten on the dark side of the sky, away from the sun's glow, where a star shows)
            const side = rand() < 0.7 === (this.sunSide >= 0) ? -1 : 1;
            const bearing = side * (15 + rand() * 22) * DEG;
            const elevation = (13 + rand() * 11) * DEG;
            const flat = Math.cos(elevation);
            this.starFrom = [Math.sin(bearing) * flat, Math.sin(elevation), -Math.cos(bearing) * flat];
            const travel = side * (0.45 + rand() * 0.35);
            const fall = -(0.3 + rand() * 0.25);
            const along = [Math.cos(bearing) * travel, fall, Math.sin(bearing) * travel];
            const len = Math.hypot(along[0], along[1], along[2]);
            this.star.along = along.map((v) => v / len);
            this.starT0 = time;
        } else if (kind === 'bubbles') {
            // (one train at a time: the next one, a little later, would cut this one's bubbles off)
            if (time - this.train.t0 < TRAIN_LIFE + BUBBLE_TRAIN * 1.7) return kind;
            this.train.t0 = time;
            this.train.x = (rand() * 2 - 1) * BUBBLE_BOX.halfWidth * 0.7;
            this.train.z = lerp(BUBBLE_BOX.near - 8, BUBBLE_BOX.far + 20, rand());
            this.train.seed = seed;
        } else if (kind === 'shoal') {
            const side = rand() < 0.5 ? -1 : 1;
            this.shoalFrom = [side * (20 + rand() * 8), -(7 + rand() * 6)];
            this.shoalTo = [-side * (20 + rand() * 8), -(8 + rand() * 10)];
            this.shoalT0 = time;
        } else if (kind === 'sink') {
            this.sink.index = Math.floor(rand() * FAR_COUNT) % FAR_COUNT;
            this.sink.t0 = time;
        } else if (kind === 'fountain') {
            // far out, on the side away from the sun's road
            const x = -(18 + rand() * 40);
            const z = -(58 + rand() * 30);
            for (let i = 0; i < 3; i += 1) {
                this.emit?.({
                    kind: 'fountain', x, y: 0.1, z, color: this.fountainTint || [0.7, 0.85, 1], power: 1 - i * 0.2, delay: i * 0.45,
                });
            }
        }
        return kind;
    }

    // ── per frame ───────────────────────────────────────────────────────────────

    /**
     * @param {number} time seconds
     * @param {number} delta seconds since the last update (0 while a capture holds a frame)
     * @param {object} frame
     * @param {number[]} frame.eye the camera, [x, y, z]
     * @param {number[]} frame.sunFlat unit bearing of the sun, [x, z]
     * @param {number} [frame.heat] the level of play, 0..1
     * @param {number} [frame.fever] 0..1
     * @param {boolean} [frame.busy] a four-line clear is playing: nothing else happens meanwhile
     */
    update(time, delta, {
        eye, sunFlat, heat = 0, fever = 0, busy = false,
    }) {
        // (a frame at no time is no frame; one of no length, or run backward, is a held one)
        if (!Number.isFinite(time)) return;
        const dt = Number.isFinite(delta) && delta > 0 ? delta : 0;
        this.time = time;
        const calm = this.reducedMotion ? 0.4 : 1;

        // ── the air: the clock's turn, the level's step eased in on top ──
        this.airStep = easeStep(this.airStep, (this.level - 1) * AIR_LEVEL_STEP, approach(0.5, dt), AIRS.length);
        this.airPhase = this.airHold === null ? this.airStep + airDrift(time) : this.airHold;
        const air = airAt(this.airPhase, this.air);

        this.placeSun(time);
        this.sunSide = sunFlat[0];

        // ── the ink's own clock: the wind of the air, quicker as play heats, racing on an event ──
        const race = this._race.valueAt(time);
        this.skyClock += dt * (air.wind + heat * 0.8 + fever * 0.8 + race * 2.4) * calm;

        // ── a perfect clear: the ink draws back, the stars come out, the sun wears its halo ──
        this.clearing = this._clear.valueAt(time);
        // the ring the sun wears in mist; a perfect clear lights it and opens a second, wider one
        const ring = this._halo.valueAt(time);
        this.halo = air.halo * 0.07 + ring * 0.34;
        this.halo2 = ring * 0.22;
        this.starGain = air.stars * (1 + this.clearing * 0.8) * (1 + fever * 0.35);
        this.moteSurge = this._clear.valueAt(time);
        this.cover = air.cover * (1 - this.clearing * 0.85);
        this.strata = air.strata * (1 - this.clearing * 0.5);

        // ── a level's front: a ring opening from the sun ──
        const fAge = time - this.frontT0;
        if (fAge >= 0 && fAge < 4.5) {
            this.front.radius = 0.08 + fAge * 0.62;
            this.front.width = 0.07 + fAge * 0.045;
            this.front.strength = 1.25 * Math.exp(-fAge / 1.5) * smooth(0, 0.14, fAge);
        } else {
            this.front.strength = 0;
        }

        // ── a four-line clear: the pillar on the crater and the ring through the ink ──
        const pAge = time - this.pillarT0;
        if (pAge >= 0 && pAge < 3.4) {
            const px = this.pillarAt[0] - eye[0];
            const pz = this.pillarAt[1] - eye[2];
            const len = Math.hypot(px, pz) || 1;
            this.pillar.x = px / len;
            this.pillar.z = pz / len;
            this.pillar.width = 0.017 + pAge * 0.011;
            this.pillar.strength = (this.pillarPower || 1) * smooth(0, 0.09, pAge) * Math.exp(-pAge / 0.95);
        } else {
            this.pillar.strength = 0;
        }
        const sAge = time - this.shockT0;
        if (sAge >= 0 && sAge < 5) {
            const d = deckOf(this.shockAt[0] - eye[0], 30 - eye[1], this.shockAt[1] - eye[2], this._deck);
            this.shock.x = d[0];
            this.shock.z = d[1];
            this.shock.radius = 0.15 + 2.6 * (1 - Math.exp(-sAge / 1.5));
            this.shock.strength = smooth(0, 0.12, sAge) * Math.exp(-sAge / 1.6);
            const bx = this.shockAt[0] - eye[0];
            const bz = this.shockAt[1] - eye[2];
            const len = Math.hypot(bx, bz) || 1;
            this.shockBearing[0] = bx / len;
            this.shockBearing[1] = bz / len;
        } else {
            this.shock.strength = 0;
        }

        // ── a twist: the ink over the funnel turns with it ──
        if (this.twist > 0.002) {
            const d = deckOf(this.twistAt[0] - eye[0], this.twistAt[1] + 22 - eye[1], this.twistAt[2] - eye[2], this._deck);
            this.swirl.x = d[0];
            this.swirl.z = d[1];
            this.swirl.angle = this.twist * 1.5 * calm;
        } else {
            this.swirl.angle = 0;
        }

        // ── happenings ──
        this._schedule(time, busy);
        this._updateStar(time);
        this._updateShoal(time);
        this._writeFar(time, air, sunFlat);
        this._writeBubbles(time, air, eye);
    }

    /** The sun at `time`, in the air as it stands (the world aims the shafts by it before the frame's update). */
    placeSun(time) {
        this.sun.height = sunHeight(sunLift(time, this.air.lift));
        this.sun.sway = sunSway(time) * (this.reducedMotion ? 0.4 : 1);
    }

    _schedule(time, busy) {
        const slot = Math.floor((time - HAPPENINGS.lead) / HAPPENINGS.period);
        if (this.lastSlot === null) {
            // the first frame after a seek or a reset: what already began is not replayed
            const now = slot >= 0 ? happeningOf(slot, this._happening) : null;
            this.lastSlot = now && time < now.at ? slot - 1 : slot;
            return;
        }
        if (slot <= this.lastSlot || slot < 0) return;
        const h = happeningOf(slot, this._happening);
        if (time < h.at) return;
        this.lastSlot = slot;
        // (never over a four-line clear, and never when they are switched off)
        if (!busy && this.happeningsOn) this.happen(h.kind, h.seed);
    }

    _updateStar(time) {
        const age = time - this.starT0;
        const { star } = this;
        if (age < 0 || age > 1.5) {
            star.strength = 0;
            return;
        }
        const run = age * 0.45;
        for (let i = 0; i < 3; i += 1) star.head[i] = this.starFrom[i] + star.along[i] * run;
        const len = Math.hypot(star.head[0], star.head[1], star.head[2]) || 1;
        for (let i = 0; i < 3; i += 1) star.head[i] /= len;
        star.length = 0.06 + Math.min(0.32, age * 0.7);
        star.strength = 2.6 * smooth(0, 0.12, age) * (1 - smooth(0.8, 1.5, age));
    }

    _updateShoal(time) {
        const age = time - this.shoalT0;
        const { shoal } = this;
        const life = 15;
        if (age < 0 || age > life) {
            shoal.strength = 0;
            return;
        }
        const k = age / life;
        shoal.x = lerp(this.shoalFrom[0], this.shoalTo[0], k) + Math.sin(age * 0.6) * 1.4;
        shoal.z = lerp(this.shoalFrom[1], this.shoalTo[1], k) + Math.cos(age * 0.45) * 1.1;
        shoal.radius = 4.2 + Math.sin(age * 0.9) * 0.7;
        shoal.strength = smooth(0, 2.5, age) * (1 - smooth(life - 3, life, age));
    }

    /** Two rows per far form: (unit direction of its body, radius), (wide, tall, bead, flare). */
    _writeFar(time, air, sunFlat) {
        const calm = this.reducedMotion ? 0.3 : 1;
        const flare = Math.max(0, this._flare.valueAt(time) - 0.012);
        // a front, a ring through the ink: each form lights as the light reaches its bearing
        const fAge = time - this.frontT0;
        const sAge = time - this.shockT0;
        for (let i = 0; i < FAR_COUNT; i += 1) {
            const form = FAR_FORMS[i];
            const b = form[0] * DEG;
            const size = form[2] * DEG;
            let scale = 1;
            let dip = 0;
            if (i === this.sink.index) {
                // it sinks into the sea, is gone a few seconds and comes up again (changed)
                const age = time - this.sink.t0;
                if (age >= 0 && age < 15) {
                    const down = smooth(0, 5, age) * (1 - smooth(9, 14, age));
                    scale = 1 - down * 0.94;
                    dip = down;
                    if (age > 6.5 && age < 8.5 && this.sink.swapped !== this.sink.t0) {
                        this.sink.swapped = this.sink.t0;
                        this.farBead[i] = this.farBead[i] > 0.1 ? 0 : SINK_BEAD;
                    }
                }
            }
            const bob = Math.sin(time * (0.17 + i * 0.013) + i * 1.7) * 0.1 * calm;
            const e = (form[1] * (1 - dip * 0.8) + form[2] * bob) * DEG;
            const flat = Math.cos(e);
            const sx = Math.sin(b);
            const sz = -Math.cos(b);
            const A = this.rows[i * 2];
            A.x = sx * flat;
            A.y = Math.sin(e);
            A.z = sz * flat;
            A.w = size * scale;
            // how far this form's bearing is from the sun's, as an angle
            const away = Math.acos(Math.max(-1, Math.min(1, sx * sunFlat[0] + sz * sunFlat[1])));
            let lit = flare * 0.55;
            if (fAge >= 0 && fAge < 4.5) {
                const x = (away - (0.08 + fAge * 0.62)) / 0.22;
                lit += 1.3 * Math.exp(-x * x) * Math.exp(-fAge / 2.2);
            }
            if (sAge >= 0 && sAge < 5) {
                // the ring from the crater reaches the forms nearest its bearing first
                const from = Math.acos(Math.max(-1, Math.min(1, sx * this.shockBearing[0] + sz * this.shockBearing[1])));
                const x = (from - sAge * 0.6) / 0.24;
                lit += 1.1 * Math.exp(-x * x) * Math.exp(-sAge / 2.6);
            }
            const B = this.rows[i * 2 + 1];
            // a breath in its shape: taller as it thins, like a drop hanging
            const breath = Math.sin(time * (0.23 + i * 0.017) + i * 2.3) * 0.05 * calm;
            B.x = form[3] * (1 - breath);
            B.y = form[4] * (1 + breath);
            B.z = this.farBead[i];
            B.w = Math.min(2.2, lit);
        }
    }

    /** Where bubble `i` is: fills `out` = { x, y, z, r, shown, hue, phase } (shown 0 = not drawn). */
    bubbleAt(i, time, air, out) {
        const b = this._bubble[i];
        const train = i >= this.ambientCount;
        let age;
        let life;
        let seed;
        let share = 1;
        if (train) {
            const j = i - this.ambientCount;
            age = time - this.train.t0 - j * 1.7;
            life = TRAIN_LIFE;
            seed = this.train.seed + j * 31;
            out.cycle = this.train.seed * 8 + j;
        } else {
            const t = time + b.offset;
            const cycle = Math.floor(t / b.period);
            age = t - cycle * b.period;
            life = b.period;
            seed = b.seed + cycle * 104729;
            // the air says how many are out: one comes or goes as its share crosses the slot
            share = smooth(i, i + 1, air.bubbles * this.ambientCount);
            out.cycle = cycle;
        }
        if (!(age >= 0) || age >= life || share <= 0.001) {
            out.shown = 0;
            return out;
        }
        const rand = mulberry32(seed);
        const box = BUBBLE_BOX;
        const x0 = train ? this.train.x + (rand() - 0.5) * 3 : (rand() * 2 - 1) * box.halfWidth;
        const z0 = train ? this.train.z + (rand() - 0.5) * 3 : lerp(box.near, box.far, rand() ** 0.8);
        const size = 1.3 + 2.6 * rand() ** 2;
        const rise = 0.55 + rand() * 0.5;
        const driftX = (rand() - 0.5) * 1.1;
        const driftZ = (rand() - 0.5) * 0.5;
        const phase = rand();
        const hue = rand();
        // an ambient one is met already adrift (it does not come up out of the sea each time)
        const startY = train ? 0.4 : 3 + rand() * 9;
        out.x = x0 + driftX * age + Math.sin(age * 0.29 + phase * TAU) * 1.6;
        out.y = startY + rise * age * (1 - (0.3 * age) / life);
        out.z = z0 + driftZ * age + Math.cos(age * 0.23 + phase * 9) * 1.2;
        const pop = smooth(life - 0.35, life, age);
        // it wobbles a little as it rises, like anything that thin
        out.r = size * smooth(0, train ? 2.2 : 5, age) * (1 + pop * 0.5) * (1 + 0.04 * Math.sin(age * 2.3 + phase * 20));
        out.shown = share * smooth(0, train ? 1.2 : 4, age) * (1 - pop);
        out.hue = hue;
        out.phase = phase;
        return out;
    }

    /**
     * Two rows per bubble: (unit direction from the eye, angular radius), (film phase, hue, light, -).
     * The ones that show are packed at the front and counted (`bubbleLive`): the shader's loop runs
     * over those alone, and every pixel of sky pays for it.
     */
    _writeBubbles(time, air, eye) {
        const base = FAR_COUNT * 2;
        const at = this._at || (this._at = {});
        const sAge = time - this.shockT0;
        let live = 0;
        for (let i = 0; i < this.bubbleCount; i += 1) {
            const state = this.bubbleAt(i, time, air, at);
            if (state.shown <= 0.001) continue;
            const A = this.rows[base + live * 2];
            const B = this.rows[base + live * 2 + 1];
            const slot = this._bubble[i];
            const dx = state.x - eye[0];
            const dy = state.y - eye[1];
            const dz = state.z - eye[2];
            const dist = Math.hypot(dx, dy, dz) || 1;
            let { shown } = state;
            // the ring a four-line clear drives out bursts the bubbles it reaches
            if (sAge >= 0 && sAge < 5 && slot.popped !== state.cycle) {
                const reach = Math.hypot(state.x - this.shockAt[0], state.z - this.shockAt[1]);
                if (reach < sAge * 46 && reach >= (sAge - 0.35) * 46) {
                    slot.popped = state.cycle;
                    slot.popAt = time;
                    this.emit?.({
                        kind: 'pop', x: state.x, y: state.y, z: state.z, color: [0.9, 0.95, 1], power: state.r,
                    });
                }
            }
            let grow = 1;
            if (slot.popped === state.cycle) {
                const since = time - slot.popAt;
                shown *= 1 - smooth(0, 0.22, since);
                grow = 1 + 0.6 * smooth(0, 0.22, since);
            }
            A.x = dx / dist;
            A.y = dy / dist;
            A.z = dz / dist;
            A.w = Math.max(1e-6, (state.r * grow) / dist);
            B.x = state.phase;
            B.y = state.hue;
            B.z = shown;
            B.w = 0;
            live += 1;
        }
        this.bubbleLive = live;
        for (let i = live; i < BUBBLE_SLOTS; i += 1) {
            const A = this.rows[base + i * 2];
            A.x = 0;
            A.y = -1;
            A.z = 0;
            A.w = 1e-4;
            // (the whole row: what a bubble left in it would make two replays of one frame differ)
            const B = this.rows[base + i * 2 + 1];
            B.x = 0;
            B.y = 0;
            B.z = 0;
            B.w = 0;
        }
    }

    getState() {
        return {
            air: airNear(this.airPhase).name,
            airPhase: this.airPhase,
            sun: this.sun.height,
            bubbles: this.bubbleLive,
        };
    }
}
