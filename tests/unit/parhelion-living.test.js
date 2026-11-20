import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

import {
    ARC_MODE,
    AVENUE_WAVE,
    GROUND_RING,
    LEVEL_SWEEP,
    LOWER_SUN_SPAN,
    LOWER_SUN_WALK,
    PARHELION_AMBIENT,
    PARHELION_CLOCK_RATES,
    PARHELION_OPTICS_IDLE,
    PARHELION_TIMING,
    ParhelionOpticsState,
    RAY_WHEEL,
    lowerSunDrift,
} from '../../src/themes/parhelion/sim/parhelion-optics-state.js';
import {
    CUE,
    PARHELION_REDUCED_MOTION_INTENSITY,
} from '../../src/themes/parhelion/sim/parhelion-reaction-director.js';
import {
    AIR_HOLD,
    AIR_NAMES,
    AIR_SECONDS,
    AIRS,
    HAPPENING_KINDS,
    HAPPENING_SECONDS,
    NIGHT_WALK,
    airAt,
    duskOf,
    happeningAt,
    nightOf,
} from '../../src/themes/parhelion/sim/parhelion-weather.js';
import { moodDrift, pingPong } from '../../src/themes/shared/mood-clock.js';
import { DEFAULT_LAYOUT, LOWER_SUN_LIGHT } from '../../src/playground/effects/parhelion-composition.js';
import { REDUCED_FLASH_SCALE } from '../../src/utils/photosensitivity.js';

/**
 * Parhelion's living pass in the optics state (2026-11): the night on the Lower Sun's walk, the
 * wheel of airs, the happenings, and the shape each event draws (rings on the plain, shafts of
 * light, a level's band, the avenue's answer). Driven with explicit times and read from the flat
 * `out` the shaders consume, like tests/unit/parhelion-optics-state.test.js.
 *
 * These are relations and invariants (bounds, monotony, continuity, a seek against a stepped run,
 * a used state against a fresh one), not copies of tuning numbers: constants come from the
 * modules. Each "Was FAULT" line marks a promise the first version of the pass broke: this file
 * found it (pinned with `it.fails`), the code was put right, and the test now holds it.
 */

const FRAME = 1 / 60;
const TWO_PI = Math.PI * 2;
const RING_LIFE = Math.log(GROUND_RING.reach / GROUND_RING.from) / GROUND_RING.rate;
const CLEAR = AIR_NAMES.indexOf('clear');
const NOON = 0;
/** A place on the walk where the night is half fallen: the afterglow at its fullest. */
const DUSK_WALK = (NIGHT_WALK.fall + NIGHT_WALK.deep) / 2;
/** The moon's place on the walk. */
const NIGHT_WALK_DEEP = (NIGHT_WALK.deep + NIGHT_WALK.lift) / 2;
const GOLDEN_SUN = 1;

function makeCue(overrides = {}) {
    return {
        kind: CUE.LOCK,
        player: 0,
        primary: true,
        sx: -1,
        sy: -1,
        rowV: 0.8,
        lockU: 0.3,
        lockV: 0.8,
        lines: 0,
        combo: 0,
        cascade: 1,
        depth: 0,
        strength: 1,
        reducedMotion: false,
        lockCount: 1,
        b2b: false,
        echoOf: CUE.NONE,
        ...overrides,
    };
}

const hardDrop = (overrides) => makeCue({ kind: CUE.STONEFALL, ...overrides });
const quad = (overrides) => makeCue({ kind: CUE.QUAD, lines: 4, ...overrides });
const perfect = (overrides) => makeCue({ kind: CUE.PERFECT, lines: 4, ...overrides });
const twist = (overrides) => makeCue({ kind: CUE.TWIST, lines: 2, ...overrides });
const apex = (overrides) => makeCue({
    kind: CUE.APEX, lines: 2, combo: 10, ...overrides,
});
const echo = (overrides) => makeCue({
    kind: CUE.ECHO, echoOf: CUE.QUAD, lines: 4, strength: 0.5, ...overrides,
});

function createState(tier = 'High') {
    const state = new ParhelionOpticsState(tier);
    const vp = DEFAULT_LAYOUT;
    state.setLayout({
        card: vp.card, board: vp.board, queue: vp.next, hud: vp.hud, aspect: vp.aspect,
    });
    return state;
}

/**
 * A state in which only what a test starts is moving: the clear air, the high sun, no happenings
 * (the captures' own pins). Any of the three is given back with `air: -1`, `walk: -1`,
 * `happenings: true`.
 */
function still(options = {}) {
    const state = createState();
    state.configure({
        air: CLEAR, walk: NOON, happenings: false, ...options,
    });
    return state;
}

/** Plain copy of `out` (dirty flags excluded: they record upload timing, not the frame). */
function snapshot(out) {
    const copy = {};
    for (const key of Object.keys(out)) {
        if (key.endsWith('Dirty')) continue;
        const value = out[key];
        if (ArrayBuffer.isView(value)) copy[key] = Array.from(value);
        else if (value && typeof value === 'object') copy[key] = { ...value };
        else copy[key] = value;
    }
    return copy;
}

/** Every number of a snapshot as `[name, value]`. */
function numbersOf(shot) {
    const list = [];
    for (const key of Object.keys(shot)) {
        const value = shot[key];
        if (Array.isArray(value)) value.forEach((v, i) => list.push([`${key}[${i}]`, v, key]));
        else if (value && typeof value === 'object') {
            Object.keys(value).forEach((inner) => list.push([`${key}.${inner}`, value[inner], key]));
        } else if (typeof value === 'number') list.push([key, value, key]);
    }
    return list;
}

/** The numbers two snapshots differ in by more than `eps` (names), leaving out the keys in `skip`. */
function differences(a, b, eps = 1e-6, skip = []) {
    const other = new Map(numbersOf(b).map(([name, value]) => [name, value]));
    return numbersOf(a)
        .filter(([name, value, key]) => !skip.includes(key) && !(Math.abs(value - other.get(name)) <= eps))
        .map(([name, value]) => `${name}: ${value} vs ${other.get(name)}`);
}

/** The top-level keys two snapshots differ in. */
function differingKeys(a, b, eps = 1e-6, skip = []) {
    const other = new Map(numbersOf(b).map(([name, value]) => [name, value]));
    const keys = new Set();
    numbersOf(a).forEach(([name, value, key]) => {
        if (!skip.includes(key) && !(Math.abs(value - other.get(name)) <= eps)) keys.add(key);
    });
    return [...keys].sort();
}

/** The names of every number in `out` that is not finite. */
function nonFinite(out) {
    return numbersOf(snapshot(out)).filter(([, value]) => !Number.isFinite(value)).map(([name]) => name);
}

/**
 * Steps update() over [from, to] at a fixed dt (the first frame at `from` with dt 0), handing
 * every frame to `each(out, t)`. Returns the last `out`.
 */
function run(state, from, to, each = null, dt = FRAME) {
    const steps = Math.round((to - from) / dt);
    let out = null;
    for (let i = 0; i <= steps; i++) {
        const t = from + i * dt;
        out = state.update(t, i === 0 ? 0 : dt);
        if (each) each(out, t);
    }
    return out;
}

/** The frame time a run of `dt` steps from `from` lands on nearest `t`. */
const frameAt = (from, t, dt = FRAME) => from + Math.round((t - from) / dt) * dt;

/** The live rings of `out.ground` as `{ radius, width, strength, tint }`, in table order. */
function ringsOf(out) {
    const rows = [];
    for (let i = 0; i < out.groundCount; i++) {
        const o = i * 4;
        rows.push({
            radius: out.ground[o], width: out.ground[o + 1], strength: out.ground[o + 2], tint: out.ground[o + 3],
        });
    }
    return rows;
}

/** The lit arcs of `out.arcs` as `{ phi, amp, width, mode }`. */
function arcsOf(out) {
    const rows = [];
    for (let i = 0; i < out.arcCount; i++) {
        const o = i * 4;
        if (out.arcs[o + 1] > 0) {
            rows.push({
                phi: out.arcs[o], amp: out.arcs[o + 1], width: out.arcs[o + 2], mode: out.arcs[o + 3],
            });
        }
    }
    return rows;
}

/** The first slot that holds a happening of `kind` (and, if asked, on `side`). */
function slotOf(kind, side = 0) {
    for (let slot = 1; slot < 400; slot++) {
        const h = happeningAt(slot * HAPPENING_SECONDS + 0.5);
        if (h.kind === kind && (side === 0 || h.side === side)) {
            return {
                slot, kind, at: h.at, length: h.length, side: h.side, start: slot * HAPPENING_SECONDS,
            };
        }
    }
    throw new Error(`no ${kind} happening in the first 400 slots`);
}

/** A state with the happenings playing in the clear air at noon, stepped from a slot's start to `t`. */
function steppedInto(start, t, dt = FRAME, options = {}) {
    const state = still({ happenings: true, ...options });
    state.seek(start);
    return snapshot(run(state, start, frameAt(start, t, dt), null, dt));
}

/** The same picture reached by one seek. */
function seekedInto(t, options = {}) {
    const state = still({ happenings: true, ...options });
    state.seek(t);
    return snapshot(state.update(t, 0));
}

afterEach(() => {
    vi.unstubAllGlobals();
});

function reduceFlashing(on) {
    vi.stubGlobal('window', { settings: { reduceFlashing: on } });
}

// ---------------------------------------------------------------------------------------
// The night
// ---------------------------------------------------------------------------------------

describe('Parhelion living pass: the night', () => {
    const { seconds, hold, stops } = LOWER_SUN_WALK;
    const walkSeconds = 2 * stops * seconds;

    it('follows the Lower Sun\'s walk, held on it or turned by the clock', () => {
        const state = still();
        for (let w = 0; w <= 2.0001; w += 0.025) {
            state.configure({ walk: w });
            const out = state.update(1, 0);
            expect(out.night, `walk ${w}`).toBeCloseTo(nightOf(w), 12);
            expect(out.dusk, `walk ${w}`).toBeCloseTo(duskOf(nightOf(w)), 12);
        }
        state.configure({ walk: -1 });
        let deepest = 0;
        for (let t = 0; t <= 2 * walkSeconds; t += 1.7) {
            const out = state.update(t, 0);
            expect(out.night, `at ${t} s`).toBeCloseTo(nightOf(lowerSunDrift(t) / LOWER_SUN_SPAN), 12);
            deepest = Math.max(deepest, out.night);
        }
        expect(deepest).toBe(1);
        // The theme opens by day; the moon has one stop of the walk, and rests there with it.
        expect(state.update(0, 0).night).toBe(0);
        const moonStop = Array.from({ length: 2 * stops + 1 }, (_, k) => k).find((k) => nightOf(k / stops) === 1);
        for (const share of [0, hold * 0.5, hold * 0.99]) {
            const out = state.update((moonStop + share) * seconds, 0);
            expect(out.night, `resting ${share}`).toBe(1);
            expect(out.dusk).toBe(0);
        }
    });

    it('falls and lifts by the clock without a jump', () => {
        const state = still({ walk: -1 });
        const dt = 0.25;
        const walkSpeed = 1.5 / (stops * seconds * (1 - hold));
        const shortestTurn = Math.min(NIGHT_WALK.deep - NIGHT_WALK.fall, NIGHT_WALK.day - NIGHT_WALK.lift);
        const nightStep = ((1.5 * walkSpeed) / shortestTurn) * dt;
        let last = snapshot(state.update(0, 0));
        let widest = { night: 0, dusk: 0, stars: 0 };
        for (let t = dt; t <= walkSeconds; t += dt) {
            const now = snapshot(state.update(t, dt));
            widest = {
                night: Math.max(widest.night, Math.abs(now.night - last.night)),
                dusk: Math.max(widest.dusk, Math.abs(now.dusk - last.dusk)),
                stars: Math.max(widest.stars, Math.abs(now.stars - last.stars)),
            };
            last = now;
        }
        expect(widest.night).toBeGreaterThan(0);
        expect(widest.night).toBeLessThanOrEqual(nightStep * 1.01);
        // The afterglow is 4·n·(1 − n): at most four times as steep as the night.
        expect(widest.dusk).toBeLessThanOrEqual(4 * nightStep * 1.01);
        expect(widest.stars).toBeLessThan(0.1);
    });

    it('is reached by level too: a level is a step along the same walk, eased', () => {
        let steps = 1;
        while (nightOf(steps / LOWER_SUN_SPAN) < 1) steps += 1;
        const state = still({ walk: -1 });
        state.setLevel(steps + 1, 0);
        let last = 0;
        let widest = 0;
        const out = run(state, 0, PARHELION_AMBIENT.warmthEase, (frame) => {
            widest = Math.max(widest, Math.abs(frame.night - last));
            last = frame.night;
        });
        expect(out.night).toBeCloseTo(1, 9);
        expect(widest).toBeLessThan(0.1);
        // Back to level 1: the light walks back to day.
        state.resetSession();
        expect(state.update(2 * PARHELION_AMBIENT.warmthEase, FRAME).night).toBeCloseTo(0, 9);
    });

    it('opens for a perfect clear through its hush and gives the day back by itself', () => {
        const state = still();
        const hourStars = still({ walk: NIGHT_WALK_DEEP }).update(1, 0).stars;
        const rest = state.update(1, 0).stoneStars;
        const t0 = 2;
        state.applyCue(perfect(), t0);
        const reveal = t0 + PARHELION_TIMING.reveal;
        let last = 0;
        run(state, t0, reveal, (out) => {
            expect(out.night).toBeGreaterThanOrEqual(last - 1e-12);
            // The afterglow is the hour's and a run's end's: a perfect clear has none.
            expect(out.dusk).toBe(0);
            last = out.night;
        });
        expect(last).toBeGreaterThan(0.8);
        expect(last).toBeLessThanOrEqual(1);
        let stars = 0;
        let stone = 0;
        run(state, reveal, reveal + 1, (out) => {
            expect(out.night).toBeGreaterThan(0.8);
            stars = Math.max(stars, out.stars);
            stone = Math.max(stone, out.stoneStars);
        });
        // The whole sky blazes: more stars than the hour's own deepest night, and in the stone.
        expect(stars).toBeGreaterThan(hourStars);
        expect(stone).toBeGreaterThan(rest + 0.5);
        const later = state.update(t0 + 16, FRAME);
        expect(later.night).toBeLessThan(1e-3);
        expect(later.stars).toBeLessThan(1e-3);
        expect(later.stoneStars).toBeCloseTo(rest, 3);
    });

    it('opens less for a weaker perfect clear and no further for a stronger one', () => {
        const nightOfStrength = (strength) => {
            const state = still();
            state.applyCue(perfect({ strength }), 2);
            return state.update(2 + PARHELION_TIMING.reveal + 0.3, FRAME).night;
        };
        expect(nightOfStrength(0.45)).toBeLessThan(nightOfStrength(1) * 0.6);
        expect(nightOfStrength(0.45)).toBeGreaterThan(0);
        expect(nightOfStrength(2)).toBeCloseTo(nightOfStrength(1), 12);
        expect(nightOfStrength(2)).toBeLessThanOrEqual(1);
    });

    it('holds a perfect clear\'s night back under Reduce flashing (it darkens the whole frame at once)', () => {
        const opened = (reduce) => {
            reduceFlashing(reduce);
            const state = still();
            state.applyCue(perfect(), 2);
            return state.update(2 + PARHELION_TIMING.reveal + 0.3, FRAME).night;
        };
        const full = opened(false);
        expect(full).toBeGreaterThan(0.8);
        expect(opened(true)).toBeCloseTo(full * REDUCED_FLASH_SCALE, 9);
    });

    it('adds the hour\'s night, a perfect clear\'s and a run\'s end as 1 - Π(1 - n)', () => {
        const t0 = 3;
        const build = (walk, withPerfect, withEnd) => {
            const state = still({ walk });
            if (withPerfect) state.applyCue(perfect(), t0);
            if (withEnd) state.gameOver(t0 - 1);
            return state;
        };
        const hour = build(DUSK_WALK, false, false);
        const open = build(NOON, true, false);
        const over = build(NOON, false, true);
        const all = build(DUSK_WALK, true, true);
        for (const t of [t0 + 0.2, t0 + 0.5, t0 + 1.2, t0 + 2.5, t0 + 6]) {
            const nh = hour.update(t, 0).night;
            const np = open.update(t, 0).night;
            const no = over.update(t, 0).night;
            const out = all.update(t, 0);
            expect(nh).toBeCloseTo(0.5, 9);
            expect(out.night, `night at ${t}`).toBeCloseTo(1 - (1 - nh) * (1 - np) * (1 - no), 12);
            expect(out.night).toBeGreaterThanOrEqual(Math.max(nh, np, no) - 1e-12);
            expect(out.night).toBeLessThanOrEqual(1);
            // The afterglow is cast by the hour and the run's end together, never by the perfect clear.
            expect(out.dusk, `dusk at ${t}`).toBeCloseTo(duskOf(1 - (1 - nh) * (1 - no)), 12);
        }
        expect(open.update(t0 + 0.5, 0).night).toBeGreaterThan(0.5);
        expect(over.update(t0 + 0.5, 0).night).toBeGreaterThan(0.1);
    });

    it('lights the stars with the night, keeps them in the stone by day, and silvers the hounds', () => {
        const fresh = new ParhelionOpticsState().out.stoneStars;
        expect(fresh).toBeGreaterThan(0);
        const state = still();
        state.setResonance(1); // the hounds as warm as a chain makes them
        const by = (walk) => {
            state.configure({ walk });
            return snapshot(state.update(1, 0));
        };
        for (const walk of [NOON, GOLDEN_SUN]) {
            const day = by(walk);
            expect(day.stars).toBe(0);
            expect(day.stoneStars).toBeCloseTo(fresh, 12);
            expect(day.dogTint).toBe(1);
        }
        let last = by(NIGHT_WALK.fall);
        for (let walk = NIGHT_WALK.fall; walk <= NIGHT_WALK.deep + 1e-9; walk += 0.01) {
            const now = by(walk);
            expect(now.stars, `stars at ${walk}`).toBeGreaterThanOrEqual(last.stars);
            expect(now.stoneStars, `stone at ${walk}`).toBeGreaterThanOrEqual(last.stoneStars);
            // A moon's hounds are silver: the night takes the warmth back out of them.
            expect(now.dogTint, `hounds at ${walk}`).toBeCloseTo(1 - nightOf(walk), 9);
            last = now;
        }
        const night = by(NIGHT_WALK_DEEP);
        expect(night.stars).toBeGreaterThan(0.9);
        expect(night.stoneStars).toBeGreaterThan(fresh);
        expect(night.dogTint).toBe(0);
    });

    it('leaves the Lower Sun\'s warmth walk exactly as it was', () => {
        const rest = PARHELION_OPTICS_IDLE.warmth;
        // The walk in its own words (the shared mood clock, there and back), a level a step on top.
        const walked = (t, level = 1) => rest + (LOWER_SUN_LIGHT.far - rest)
            * pingPong(moodDrift(t, seconds, hold) / stops + (level - 1) / LOWER_SUN_SPAN);
        const { warmthDepth, warmthPeriod } = PARHELION_AMBIENT;
        const breath = (t) => 1 + warmthDepth * Math.sin((TWO_PI * t) / warmthPeriod);
        // The whole living pass running: the airs turning, the happenings, the night.
        const living = createState();
        const pinned = AIR_NAMES.map((_, index) => {
            const state = createState();
            state.configure({ air: index, reducedMotion: index % 2 === 1 });
            return state;
        });
        for (let t = 0; t <= 2.2 * walkSeconds; t += 2.3) {
            const expected = walked(t) * breath(t);
            expect(living.update(t, 0).warmth, `at ${t} s`).toBeCloseTo(expected, 12);
            pinned.forEach((state, index) => {
                expect(state.update(t, 0).warmth, `${AIR_NAMES[index]} at ${t} s`).toBeCloseTo(expected, 12);
            });
        }
        const levelled = createState();
        levelled.setLevel(6, 0);
        for (let t = PARHELION_AMBIENT.warmthEase; t <= walkSeconds; t += 7.1) {
            expect(levelled.update(t, 0).warmth, `level 6 at ${t} s`).toBeCloseTo(walked(t, 6) * breath(t), 12);
        }
        // A held place on the walk is that place's light, whatever the level.
        const held = still({ walk: 0.5 });
        held.setLevel(9, 0);
        expect(held.update(10, 0).warmth).toBeCloseTo((rest + (LOWER_SUN_LIGHT.far - rest) * 0.5) * breath(10), 12);
    });
});

// ---------------------------------------------------------------------------------------
// The airs
// ---------------------------------------------------------------------------------------

describe('Parhelion living pass: the airs', () => {
    /** What the three clocks gain over one second of frames in a pinned air. */
    function clockSecond(options) {
        const state = still(options);
        state.seek(0);
        const { clocks } = run(state, 0, 1);
        return { dust: clocks.dustClock, veil: clocks.veilPhase, drift: clocks.driftPhase };
    }

    it('shows the display as designed in the clear air: nothing multiplied, nothing added', () => {
        const idle = PARHELION_OPTICS_IDLE;
        const state = still();
        state.seek(0);
        const out = run(state, 0, 1);
        expect(Array.from(out.air)).toEqual([1, 0, 1, 0]);
        expect(Array.from(out.grade)).toEqual([1, 1, 1, 1]);
        expect(out.rays[0]).toBe(0);
        expect(out.nacre).toBe(0);
        expect(out.density).toBeCloseTo(idle.density, 12);
        expect(out.dustGain).toBeCloseTo(idle.dustGain, 12);
        expect(out.k0[0]).toBeCloseTo(idle.k0[0], 6);
        expect(out.k1[1]).toBeCloseTo(idle.k1[1], 6);
        expect(out.clocks.dustClock).toBeCloseTo(PARHELION_CLOCK_RATES.dust, 9);
        expect(out.clocks.veilPhase).toBeCloseTo(PARHELION_CLOCK_RATES.veil, 9);
        expect(out.clocks.driftPhase).toBeCloseTo(PARHELION_CLOCK_RATES.drift, 9);
        expect(out.clocks.dustClockRate).toBeCloseTo(PARHELION_CLOCK_RATES.dust, 12);
    });

    it('opens on the clock in that same clear air, to the last number', () => {
        // Through the first air's rest and before the first happening the pins change nothing.
        const quietSeconds = Math.min(AIR_HOLD * AIR_SECONDS, HAPPENING_SECONDS) - 1;
        const onTheClock = createState();
        const held = createState();
        held.configure({ air: CLEAR, happenings: false });
        for (let t = 0; t <= quietSeconds; t += 0.5) {
            expect(snapshot(onTheClock.update(t, t === 0 ? 0 : 0.05)), `at ${t} s`)
                .toEqual(snapshot(held.update(t, t === 0 ? 0 : 0.05)));
        }
    });

    it('multiplies each air into what the hour already shows', () => {
        const idle = PARHELION_OPTICS_IDLE;
        const clear = snapshot(still().update(2, 0));
        AIR_NAMES.forEach((name, index) => {
            const row = AIRS[name];
            const out = snapshot(still({ air: index }).update(2, 0));
            const label = (what) => `${name}: ${what}`;
            [row.veil, row.fog, row.drift, row.glow].forEach((value, i) => {
                expect(out.air[i], label(`air[${i}]`)).toBeCloseTo(value, 6);
            });
            expect(out.density, label('density')).toBeCloseTo(idle.density + row.density, 9);
            expect(out.dustGain, label('dust')).toBeCloseTo(clear.dustGain * row.dust, 9);
            expect(out.k0[0], label('ring')).toBeCloseTo(clear.k0[0] * row.halo, 6);
            expect(out.k0[1], label('hounds')).toBeCloseTo(clear.k0[1] * row.halo, 6);
            expect(out.k1[1], label('sun pillar')).toBeCloseTo(clear.k1[1] + row.pillar, 6);
            expect(out.grade[3], label('saturation')).toBeCloseTo(row.sat, 6);
            // The shafts of light the air holds breathe with the display, a little either way.
            const { breathDepth } = PARHELION_AMBIENT;
            expect(out.rays[0], label('rays')).toBeGreaterThanOrEqual(row.rays * (1 - breathDepth) - 1e-6);
            expect(out.rays[0], label('rays')).toBeLessThanOrEqual(row.rays * (1 + breathDepth) + 1e-6);
            // Nothing else of the frame moves with the air.
            const own = ['air', 'density', 'dustGain', 'k0', 'k1', 'grade', 'rays', 'clocks'];
            expect(differingKeys(out, clear).filter((key) => !own.includes(key)), name).toEqual([]);
        });
    });

    it('keeps an air\'s own shafts of light through the night, quieter against the dark sky', () => {
        AIR_NAMES.forEach((name, index) => {
            const byDay = still({ air: index }).update(2, 0).rays[0];
            const byNight = still({ air: index, walk: NIGHT_WALK_DEEP }).update(2, 0).rays[0];
            if (AIRS[name].rays === 0) {
                expect([byDay, byNight], name).toEqual([0, 0]);
                return;
            }
            expect(byNight, name).toBeGreaterThan(0);
            expect(byNight, name).toBeLessThan(byDay);
            // It falls with the night, never in a step.
            let last = byDay;
            for (let walk = NIGHT_WALK.fall; walk <= NIGHT_WALK.deep + 1e-9; walk += 0.01) {
                const now = still({ air: index, walk }).update(2, 0).rays[0];
                expect(now, `${name} at ${walk}`).toBeLessThanOrEqual(last + 1e-6);
                expect(last - now, `${name} at ${walk}`).toBeLessThan(0.05);
                last = now;
            }
        });
    });

    it('leans the grade the way the air leans: gold, a blue-grey cold, or not at all', () => {
        AIR_NAMES.forEach((name, index) => {
            const [red, green, blue] = Array.from(still({ air: index }).update(2, 0).grade);
            const lean = AIRS[name].warm;
            if (lean > 0) {
                expect(red, name).toBeGreaterThan(1);
                expect(green, name).toBe(1);
                expect(blue, name).toBeLessThan(1);
            } else if (lean < 0) {
                expect(red, name).toBeLessThan(1);
                expect(green, name).toBeLessThan(1);
                expect(blue, name).toBeGreaterThan(1);
                expect(green, name).toBeGreaterThan(red);
            } else {
                expect([red, green, blue], name).toEqual([1, 1, 1]);
            }
            // A lean, never a recolour.
            for (const channel of [red, green, blue]) expect(Math.abs(channel - 1), name).toBeLessThan(0.2);
        });
    });

    it('turns the three clocks at the air\'s own rates, calmed under reduced motion', () => {
        const rates = PARHELION_CLOCK_RATES;
        AIR_NAMES.forEach((name, index) => {
            const row = AIRS[name];
            const full = clockSecond({ air: index });
            expect(full.dust, `${name} dust`).toBeCloseTo(rates.dust * row.dustRate, 9);
            expect(full.veil, `${name} veil`).toBeCloseTo(rates.veil * row.veilRate, 9);
            expect(full.drift, `${name} drift`).toBeCloseTo(rates.drift * row.driftRate, 9);
            const calm = clockSecond({ air: index, reducedMotion: true });
            const pairs = [
                [calm.dust / rates.dustReducedMotion, row.dustRate],
                [calm.veil / rates.veil, row.veilRate],
                [calm.drift / rates.drift, row.driftRate],
            ];
            pairs.forEach(([calmed, rate], i) => {
                // The same way as the air turns it, but less far from the resting rate.
                if (rate === 1) expect(calmed, `${name} clock ${i}`).toBeCloseTo(1, 9);
                else {
                    expect(Math.sign(calmed - 1), `${name} clock ${i}`).toBe(Math.sign(rate - 1));
                    expect(Math.abs(calmed - 1), `${name} clock ${i}`).toBeLessThan(Math.abs(rate - 1));
                }
            });
        });
    });

    // Was FAULT 6 (found by this test, fixed 2026-11-20; what follows is what the code did then): seek() sets the clocks to t · the RESTING rates, but update() now turns them at the
    // air's own rates (and a gust's). The optics state's header still says seek(t) "lands on the
    // clock a frame-stepped run reaches": one second of cirrus steps the veil 0.085 where a seek
    // says 0.025, and by the clock alone, 300 s in, the veil stands at 12.8 for a seek's 7.5.
    // No player sees it (one noise phase is as good as another); a `?t=` still shows other clouds
    // and other spindrift than the game has at that second.
    it('a seek lands on the clocks a stepped run reaches, whatever the air', () => {
        AIR_NAMES.forEach((name, index) => {
            const stepped = clockSecond({ air: index });
            const state = still({ air: index });
            state.seek(1);
            const { clocks } = state.update(1, 0);
            expect(clocks.dustClock, `${name} dust`).toBeCloseTo(stepped.dust, 6);
            expect(clocks.veilPhase, `${name} veil`).toBeCloseTo(stepped.veil, 6);
            expect(clocks.driftPhase, `${name} drift`).toBeCloseTo(stepped.drift, 6);
        });
    });

    it('holds a pinned air whatever the time, and gives the wheel back to the clock at -1', () => {
        AIR_NAMES.forEach((name, index) => {
            const state = still({ air: index });
            const first = Array.from(state.update(0, 0).air);
            for (const t of [AIR_SECONDS * 0.7, AIR_SECONDS * 3.3, 5000]) {
                expect(Array.from(state.update(t, 0).air), `${name} at ${t}`).toEqual(first);
            }
        });
        const state = still({ air: AIR_NAMES.length - 1 });
        state.update(0, 0);
        state.configure({ air: -1 });
        for (const t of [0, AIR_SECONDS * (AIR_HOLD + 0.3), AIR_SECONDS * 2.1, AIR_SECONDS * 4.9]) {
            const air = airAt(t);
            const out = state.update(t, 0);
            [air.veil, air.fog, air.drift, air.glow].forEach((value, i) => {
                expect(out.air[i], `air[${i}] at ${t}`).toBeCloseTo(value, 6);
            });
            expect(out.grade[3]).toBeCloseTo(air.sat, 6);
        }
        // A pin that is not a number is no pin.
        const odd = still({ air: Number.NaN });
        expect(Array.from(odd.update(AIR_SECONDS * 1.2, 0).air)).not.toEqual([1, 0, 1, 0]);
    });

    it('turns the wheel by the clock without a jump in anything the shaders read', () => {
        const state = still({ air: -1 });
        const dt = 0.25;
        const melt = AIR_SECONDS * (1 - AIR_HOLD);
        const widestOf = (key) => {
            let widest = 0;
            AIR_NAMES.forEach((name, i) => {
                const next = AIRS[AIR_NAMES[(i + 1) % AIR_NAMES.length]];
                widest = Math.max(widest, Math.abs(next[key] - AIRS[name][key]));
            });
            return (1.5 * widest * dt) / melt;
        };
        const shown = ['veil', 'fog', 'drift', 'glow'];
        const limit = shown.map(widestOf);
        let last = snapshot(state.update(0, 0));
        const seen = new Set();
        for (let t = dt; t <= AIR_NAMES.length * AIR_SECONDS + dt; t += dt) {
            const now = snapshot(state.update(t, dt));
            for (let i = 0; i < shown.length; i++) {
                expect(Math.abs(now.air[i] - last.air[i]), `air[${i}] at ${t} s`)
                    .toBeLessThanOrEqual(limit[i] * 1.01 + 1e-6);
            }
            expect(Math.abs(now.grade[3] - last.grade[3]), `saturation at ${t} s`)
                .toBeLessThanOrEqual(widestOf('sat') * 1.01 + 1e-6);
            expect(Math.abs(now.density - last.density), `density at ${t} s`)
                .toBeLessThanOrEqual(widestOf('density') * 1.01 + 1e-6);
            expect(Math.abs(now.dustGain - last.dustGain), `dust at ${t} s`)
                .toBeLessThanOrEqual(widestOf('dust') * PARHELION_OPTICS_IDLE.dustGain * 1.01 + 1e-6);
            for (let i = 0; i < 3; i++) {
                expect(Math.abs(now.grade[i] - last.grade[i]), `grade[${i}] at ${t} s`).toBeLessThan(0.01);
            }
            AIR_NAMES.forEach((name) => {
                if (shown.every((key, i) => Math.abs(now.air[i] - AIRS[name][key]) < 1e-6)) seen.add(name);
            });
            last = now;
        }
        // Every air had its rest.
        expect([...seen].sort()).toEqual([...AIR_NAMES].sort());
    });

    it('shows mother-of-pearl through the afterglow, as much as the air holds, and none in the deep night', () => {
        AIR_NAMES.forEach((name, index) => {
            const dusk = still({ air: index, walk: DUSK_WALK }).update(1, 0);
            expect(dusk.dusk).toBeCloseTo(1, 9);
            expect(dusk.nacre, `${name} at dusk`).toBeCloseTo(AIRS[name].nacre, 9);
            const night = still({ air: index, walk: NIGHT_WALK_DEEP }).update(1, 0);
            expect(night.nacre, `${name} at night`).toBe(0);
            const noon = still({ air: index, walk: NOON }).update(1, 0);
            expect(noon.nacre, `${name} at noon`).toBe(0);
            for (let walk = 0; walk <= 2; walk += 0.05) {
                const { nacre } = still({ air: index, walk }).update(1, 0);
                expect(nacre).toBeGreaterThanOrEqual(0);
                expect(nacre).toBeLessThanOrEqual(1);
            }
        });
    });

    // Was FAULT 5 (found by this test, fixed 2026-11-20; what follows is what the code did then): the clear air is not "the old look, exactly" once the sun is low. out.nacre is
    // air.nacre · max(dusk, 0.3 · lowSun · (1 − night)), so by DAY at the half-lowered sun the
    // clear air shows 0.06 of mother-of-pearl and 0.12 at the golden sun (the dome's branch runs
    // from 0.004), where the brief and the weather module's header say it shows through dusk only.
    // (If the low sun's pearl is meant, the header's "Phase 0 is the old look, exactly" is not.)
    it('adds no mother-of-pearl to the clear air by day, however low the sun', () => {
        for (const walk of [0.25, 0.5, 0.75, GOLDEN_SUN]) {
            const out = still({ walk }).update(1, 0);
            expect(out.dusk, `walk ${walk}`).toBe(0);
            expect(out.night, `walk ${walk}`).toBe(0);
            expect(out.nacre, `walk ${walk}`).toBe(0);
        }
    });
});

// ---------------------------------------------------------------------------------------
// Happenings
// ---------------------------------------------------------------------------------------

describe('Parhelion living pass: happenings', () => {
    /** What each kind draws with: the only keys of `out` it may move (the clocks aside). */
    const SIGN = {
        gust: ['air', 'dustGain'],
        glint: ['arcCount', 'arcs'],
        hound: ['dogFlare', 'dogTail'],
        shimmer: ['density', 'shower'],
        flush: ['sweep'],
    };

    it('has a sign of its own for every kind the schedule names', () => {
        expect(Object.keys(SIGN).sort()).toEqual([...HAPPENING_KINDS].sort());
    });

    it('opens at rest, and plays nothing at all with happenings off', () => {
        const on = still({ happenings: true });
        const off = still();
        // Nothing happens in the first slot.
        run(on, 0, HAPPENING_SECONDS, null, 0.05);
        expect(snapshot(on.out)).toEqual(snapshot(run(off, 0, HAPPENING_SECONDS, null, 0.05)));
        // With happenings off the plain stays as it rests, through every kind's slot.
        const rest = snapshot(still().update(0, 0));
        const through = (2 * HAPPENING_KINDS.length + 1) * HAPPENING_SECONDS;
        run(off, HAPPENING_SECONDS, through, (out, t) => {
            const now = snapshot(out);
            // (The breath, the hounds' twinkle and the horizon's slow warmth are ambient life of old.)
            expect(differingKeys(now, rest, 1e-6, ['time', 'clocks', 'breath', 'k0', 'warmth']), `at ${t}`).toEqual([]);
            expect(now.arcCount).toBe(0);
        }, 0.5);
    });

    it.each(HAPPENING_KINDS)('a %s draws its own sign on the plain and touches nothing else', (kind) => {
        const { at, length } = slotOf(kind);
        const t = at + length * 0.45;
        const on = seekedInto(t);
        const off = seekedInto(t, { happenings: false });
        expect(differingKeys(on, off, 1e-6, ['clocks'])).toEqual(SIGN[kind]);
    });

    it('a gust sets the spindrift racing and the dust glittering, and quickens their clocks', () => {
        const { at, length } = slotOf('gust');
        const t = at + length * 0.45;
        const on = seekedInto(t);
        const off = seekedInto(t, { happenings: false });
        expect(on.air[2]).toBeGreaterThan(off.air[2] * 1.5);
        expect(on.dustGain).toBeGreaterThan(off.dustGain);
        expect(on.clocks.dustClockRate).toBeGreaterThan(off.clocks.dustClockRate);
        // The veil's and the fog's numbers are the air's alone.
        expect([on.air[0], on.air[1], on.air[3]]).toEqual([off.air[0], off.air[1], off.air[3]]);
    });

    it('a glint runs once round the ring, one way or the other', () => {
        const turned = (side) => {
            const { at, start } = slotOf('glint', side);
            const state = still({ happenings: true });
            state.seek(start);
            let last = null;
            let total = 0;
            let peak = 0;
            let most = 0;
            run(state, start, at + 12, (out) => {
                const arcs = arcsOf(out);
                most = Math.max(most, arcs.length);
                if (arcs.length !== 1) {
                    last = null;
                    return;
                }
                const [arc] = arcs;
                expect(arc.mode).toBe(ARC_MODE.WHITE);
                peak = Math.max(peak, arc.amp);
                if (last !== null) total += arc.phi - last - TWO_PI * Math.round((arc.phi - last) / TWO_PI);
                last = arc.phi;
            });
            expect(most).toBe(1);
            expect(peak).toBeGreaterThan(0.1);
            return total;
        };
        const left = turned(-1);
        const right = turned(1);
        expect(Math.abs(left)).toBeCloseTo(TWO_PI, 3);
        expect(Math.abs(right)).toBeCloseTo(TWO_PI, 3);
        expect(Math.sign(left)).toBe(-Math.sign(right));
    });

    it('a hound flares on its own side and streams a longer tail', () => {
        for (const side of [-1, 1]) {
            const { at, length } = slotOf('hound', side);
            const on = seekedInto(at + length * 0.45);
            const mine = side < 0 ? 0 : 1;
            expect(on.dogFlare[mine], `side ${side}`).toBeGreaterThan(0.2);
            expect(on.dogFlare[1 - mine], `side ${side}`).toBe(0);
            expect(on.dogTail).toBeGreaterThan(PARHELION_OPTICS_IDLE.dogTail);
        }
    });

    it('a shimmer falls through the dust and a flush warms the far range', () => {
        const shimmer = slotOf('shimmer');
        const fell = seekedInto(shimmer.at + shimmer.length * 0.45);
        expect(fell.shower).toBeGreaterThan(0.2);
        expect(fell.density).toBeGreaterThan(PARHELION_OPTICS_IDLE.density);
        const flush = slotOf('flush');
        const warmed = seekedInto(flush.at + flush.length * 0.45);
        expect(warmed.sweep[3]).toBeGreaterThan(0.3);
        // The level's band itself stays where it rests.
        expect(warmed.sweep.slice(0, 3)).toEqual([LEVEL_SWEEP.from, Math.fround(LEVEL_SWEEP.width), 0]);
    });

    it('comes in and goes out without a jump', () => {
        for (const kind of HAPPENING_KINDS) {
            const { start } = slotOf(kind);
            const state = still({ happenings: true });
            state.seek(start);
            let last = null;
            let widest = 0;
            run(state, start, start + HAPPENING_SECONDS + 6, (out) => {
                const now = [
                    out.air[2], out.dustGain, out.dogFlare[0], out.dogFlare[1], out.dogTail, out.shower,
                    out.density, out.sweep[3], arcsOf(out).reduce((sum, arc) => sum + arc.amp, 0),
                ];
                if (last) now.forEach((value, i) => { widest = Math.max(widest, Math.abs(value - last[i])); });
                last = now;
            });
            // Something moved, and never more in a frame than an eased second's worth.
            expect(widest, kind).toBeGreaterThan(0);
            expect(widest, kind).toBeLessThan(0.05);
        }
    });

    it.each(HAPPENING_KINDS)('a seek into the middle of a %s lands where a stepped run stands', (kind) => {
        const { at, length, start } = slotOf(kind);
        for (const share of [0.02, 0.15, 0.5, 0.9]) {
            const t = frameAt(start, at + length * share);
            expect(happeningAt(t).live, `${kind} at ${share}`).toBe(true);
            const stepped = steppedInto(start, t);
            const seeked = seekedInto(t);
            expect(differences(stepped, seeked, 1e-6, ['clocks']), `${kind} at ${share}`).toEqual([]);
        }
    });

    it.each(HAPPENING_KINDS)('a %s looks the same at 30 fps as at 60, and after a frame that came late', (kind) => {
        const { at, length, start } = slotOf(kind);
        for (const share of [0.3, 0.9]) {
            const t = frameAt(start, at + length * share, 1 / 30);
            const smooth = steppedInto(start, t, 1 / 60);
            const coarse = steppedInto(start, t, 1 / 30);
            expect(differences(smooth, coarse, 1e-6, ['clocks']), `${kind} at ${share}`).toEqual([]);
            // The clocks are sums of frames: they agree to a frame's worth of a rate that is turning.
            for (const key of ['dustClock', 'veilPhase', 'driftPhase']) {
                expect(Math.abs(smooth.clocks[key] - coarse.clocks[key]), `${kind} ${key}`).toBeLessThan(0.02);
            }
            // One frame at the slot's start, the next in the middle of the happening (a hitch).
            const late = still({ happenings: true });
            late.seek(start);
            late.update(start, 0);
            expect(differences(smooth, snapshot(late.update(t, 0.1)), 1e-6, ['clocks']), `${kind} late`).toEqual([]);
        }
    });

    it('plays on with reactions off, and straight through a reset', () => {
        for (const kind of HAPPENING_KINDS) {
            const { at, length, start } = slotOf(kind);
            const t = frameAt(start, at + length * 0.5);
            const on = steppedInto(start, t);
            // Ambient life, not a reaction.
            expect(differences(on, steppedInto(start, t, FRAME, { intensity: 0 }), 1e-6), kind).toEqual([]);
            // A run's end in the middle of one (resetSession) does not touch it.
            const state = still({ happenings: true });
            state.seek(start);
            const before = snapshot(run(state, start, t));
            state.resetSession();
            expect(differences(before, snapshot(state.update(t, 0)), 1e-6), `${kind} through a reset`).toEqual([]);
        }
    });

    // Was FAULT 1 (found by this test, fixed 2026-11-20; what follows is what the code did then): seek() forgets that the slot's happening is already armed (hapSlot = −1) but leaves
    // its envelope in the pool, so the next update() arms it AGAIN beside the first. The
    // playground's `?t=` capture seeks every frame: a still inside a happening shows it stacked up
    // to the pool's four (a hound's flare 2.0 for 0.5, its tail 2.5 for 1.45, a shimmer 1.5 for
    // 0.4, five glints on the ring for one).
    it.each(HAPPENING_KINDS)('seeking the same moment of a %s again lands on the same picture', (kind) => {
        const { at, length } = slotOf(kind);
        const t = at + length * 0.5;
        const state = still({ happenings: true });
        state.seek(t);
        const once = snapshot(state.update(t, 0));
        for (let frame = 0; frame < 6; frame++) {
            state.seek(t);
            state.update(t, 0);
        }
        expect(differences(once, snapshot(state.out), 1e-6)).toEqual([]);
    });

    // Was FAULT 2a (found by this test, fixed 2026-11-20; what follows is what the code did then): a happening is armed only while `live` (its age under HAPPENING_LENGTH), but its
    // envelopes ring on for seconds after that: just past `length` a gust still drives the
    // spindrift 1.44 times the air's, a hound flares 0.14, a shimmer falls 0.11, a glint glows
    // 0.12, a flush warms 0.17. A seek past `length` finds none of it, where the run that was
    // stepped there still shows it.
    it.each(HAPPENING_KINDS)('a seek past the end of a %s still shows what a stepped run shows there', (kind) => {
        const { at, length, start } = slotOf(kind);
        for (const past of [0.05, 0.5, 1.5]) {
            const t = frameAt(start, at + length + past);
            expect(differences(steppedInto(start, t), seekedInto(t), 1e-3, ['clocks']), `${past} s past`).toEqual([]);
        }
    });

    // Was FAULT 2b (found by this test, fixed 2026-11-20; what follows is what the code did then): the same gap, as a player meets it. resetSession() (a run's end, modeStopped) and
    // configure() with reactions off wipe every envelope and re-arm the slot's happening only
    // while it is `live`: in its tail it is cut off in one frame (0.3 s past its length a gust's
    // spindrift drops from 1.40 to 1, a hound's flare from 0.13 to 0, a flush from 0.16 to 0).
    it.each(HAPPENING_KINDS)('a reset in the tail of a %s leaves the plain as it was', (kind) => {
        const { at, length, start } = slotOf(kind);
        const t = frameAt(start, at + length + 0.3);
        const state = still({ happenings: true });
        state.seek(start);
        const before = snapshot(run(state, start, t));
        state.resetSession();
        expect(differences(before, snapshot(state.update(t, 0)), 1e-3)).toEqual([]);
    });

    it('runs nothing round the ring by itself under reduced motion, and still lets the quiet ones come', () => {
        // Every game cue's orbit is a still brighten there (§7.6): a glint is all motion.
        const { at, start } = slotOf('glint');
        const state = still({ happenings: true, reducedMotion: true });
        state.seek(start);
        const places = new Set();
        run(state, start, at + 4, (out) => {
            arcsOf(out).forEach((arc) => places.add(arc.phi.toFixed(3)));
        });
        expect(places.size).toBeLessThanOrEqual(1);
        // The others are light and air, not travel: they keep their signs.
        for (const kind of HAPPENING_KINDS.filter((name) => name !== 'glint')) {
            const slot = slotOf(kind);
            const t = slot.at + slot.length * 0.45;
            const on = seekedInto(t, { reducedMotion: true });
            const off = seekedInto(t, { reducedMotion: true, happenings: false });
            expect(differingKeys(on, off, 1e-6, ['clocks']), kind).toEqual(SIGN[kind]);
        }
    });
});

// ---------------------------------------------------------------------------------------
// Rings on the plain
// ---------------------------------------------------------------------------------------

describe('Parhelion living pass: rings on the plain', () => {
    const fresh = () => Array.from(new ParhelionOpticsState().out.ground);

    it('a hard drop sends one ring from the stone\'s foot, growing by e-folds until it is spent', () => {
        const state = still();
        const t0 = 1;
        expect(state.update(t0 - FRAME, 0).groundCount).toBe(0);
        state.applyCue(hardDrop(), t0);
        let last = null;
        let peak = 0;
        let peakAt = 0;
        let frames = 0;
        let lastLive = null;
        run(state, t0, t0 + RING_LIFE + 0.5, (out, t) => {
            const rings = ringsOf(out);
            if (t - t0 >= RING_LIFE) {
                expect(rings, `spent at ${t - t0}`).toEqual([]);
                return;
            }
            expect(rings).toHaveLength(1);
            const [ring] = rings;
            frames += 1;
            expect(ring.radius).toBeCloseTo(GROUND_RING.from * Math.exp(GROUND_RING.rate * (t - t0)), 1);
            expect(ring.radius).toBeLessThan(GROUND_RING.reach);
            expect(ring.width).toBeGreaterThan(0);
            expect(ring.strength).toBeGreaterThanOrEqual(0);
            expect(ring.tint).toBe(0);
            if (last) {
                // The same share wider every frame: one pace on screen, near and far.
                expect(ring.radius / last.radius).toBeCloseTo(Math.exp(GROUND_RING.rate * FRAME), 5);
                expect(ring.width).toBeGreaterThan(last.width);
                expect(Math.abs(ring.strength - last.strength)).toBeLessThan(0.15);
            } else {
                expect(ring.radius).toBeCloseTo(GROUND_RING.from, 4);
                expect(ring.strength).toBe(0);
            }
            if (ring.strength > peak) {
                peak = ring.strength;
                peakAt = t - t0;
            }
            last = ring;
            lastLive = ring;
        });
        expect(frames).toBeGreaterThan(60);
        expect(peak).toBeGreaterThan(0.2);
        // It rises fast and has faded out by the time it is taken away.
        expect(peakAt).toBeLessThan(RING_LIFE / 2);
        expect(lastLive.strength).toBeLessThan(peak * 0.02);
        expect(lastLive.radius).toBeGreaterThan(GROUND_RING.reach * 0.9);
    });

    it('rests spent rows at zero, live rows first: a used table equals a fresh one', () => {
        const state = still();
        const births = [1, 1.5, 2.3, 2.9];
        births.forEach((t, i) => state.applyCue(hardDrop({ lockCount: i + 1 }), t));
        let most = 0;
        run(state, 1, 2.9 + RING_LIFE + 0.2, (out, t) => {
            const live = births.filter((birth) => t >= birth && t - birth < RING_LIFE).length;
            expect(out.groundCount, `at ${t}`).toBe(live);
            most = Math.max(most, live);
            ringsOf(out).forEach((ring) => {
                expect(ring.radius).toBeGreaterThanOrEqual(GROUND_RING.from * 0.999);
                expect(ring.width).toBeGreaterThan(0);
            });
            expect(Array.from(out.ground.slice(out.groundCount * 4)).every((v) => v === 0), `at ${t}`).toBe(true);
        });
        expect(most).toBeGreaterThanOrEqual(3);
        expect(state.out.groundCount).toBe(0);
        expect(Array.from(state.out.ground)).toEqual(fresh());
    });

    it.each([
        0.45, 0.3, 0.12,
    ])('hard drops every %s s never give NaN, a negative strength or more rows than slots', (pace) => {
        const state = still();
        let next = 1;
        let count = 0;
        let most = 0;
        const bad = [];
        run(state, 0, 20, (out, t) => {
            while (next <= t) {
                count += 1;
                state.applyCue(hardDrop({ lockCount: count, lockU: count % 2 ? 0.3 : 0.7 }), next);
                next += pace;
            }
            most = Math.max(most, out.groundCount);
            for (let i = 0; i < out.ground.length; i++) {
                const value = out.ground[i];
                if (!(Number.isFinite(value) && value >= 0)) bad.push(`ground[${i}] at ${t}: ${value}`);
            }
        });
        expect(bad).toEqual([]);
        expect(state.out.ground.length).toBe(GROUND_RING.slots * 4);
        // The table never holds more than its slots, and holds as many rings as are alive at
        // this pace until it is full (eight rows since the fix of fault 4: a drop every 0.45 s
        // keeps six alive, one every 0.12 s fills it).
        expect(most).toBeLessThanOrEqual(GROUND_RING.slots);
        expect(most).toBe(Math.min(GROUND_RING.slots, Math.ceil(RING_LIFE / pace)));
        // And the plain is bare again once the last ring is spent.
        const out = state.update(next + RING_LIFE, FRAME);
        expect(Array.from(out.ground)).toEqual(fresh());
    });

    // Was FAULT 4 (found by this test, fixed 2026-11-20; what follows is what the code did then): the table has four rows and a ring lives 2.28 s, so a fifth ring inside that time
    // takes the oldest's row while it still shows. At a hard drop every 0.45 s each ring vanishes
    // in one frame at 39 % of its peak light, a kilometre out; at every 0.35 s at 87 %; at every
    // 0.3 s at 99 %, 330 m out in the middle of the plain. (The code promises only that "a hard
    // drop a second never cuts a young ring short"; this is the pop a fast player sees.)
    it('never takes a ring away while it still shows', () => {
        const state = still();
        const pace = 0.45;
        let next = 1;
        let count = 0;
        let peak = 0;
        let cut = 0;
        let last = [];
        run(state, 0, 12, (out, t) => {
            while (next <= t) {
                count += 1;
                state.applyCue(hardDrop({ lockCount: count }), next);
                next += pace;
            }
            const rings = ringsOf(out);
            const grown = Math.exp(GROUND_RING.rate * FRAME);
            last.forEach((ring) => {
                const radius = ring.radius * grown;
                const kept = rings.some((now) => Math.abs(now.radius - radius) < radius * 0.005);
                if (!kept && radius < GROUND_RING.reach) cut = Math.max(cut, ring.strength);
            });
            rings.forEach((ring) => { peak = Math.max(peak, ring.strength); });
            last = rings;
        });
        expect(peak).toBeGreaterThan(0.2);
        expect(cut).toBeLessThan(peak * 0.1);
    });

    it('times each ring: a four-line clear at its meet, an apex at once, a perfect clear twice at its reveal', () => {
        const t0 = 1;
        // A four-line clear: as the beads meet.
        const closing = still();
        closing.applyCue(quad(), t0);
        const meet = t0 + PARHELION_TIMING.quadMeet;
        run(closing, t0, meet - 2 * FRAME, (out) => expect(out.groundCount).toBe(0));
        const met = ringsOf(closing.update(meet + 0.05, FRAME));
        expect(met).toHaveLength(1);
        expect(met[0].radius).toBeCloseTo(GROUND_RING.from * Math.exp(GROUND_RING.rate * 0.05), 1);
        expect(met[0].tint).toBe(0);

        // An apex: at once.
        const cross = still();
        cross.applyCue(apex(), t0);
        expect(ringsOf(cross.update(t0 + 0.05, FRAME))).toHaveLength(1);

        // A perfect clear: two rings in the prism's colours, at and just after the reveal.
        const clearSky = still();
        clearSky.applyCue(perfect(), t0);
        const reveal = t0 + PARHELION_TIMING.reveal;
        run(clearSky, t0, reveal - 2 * FRAME, (out) => expect(out.groundCount).toBe(0));
        const counts = [];
        run(clearSky, reveal, reveal + 1, (out) => {
            counts.push(out.groundCount);
            ringsOf(out).forEach((ring) => expect(ring.tint).toBe(1));
        });
        expect(counts[1]).toBe(1);
        expect(Math.max(...counts)).toBe(2);
        expect(counts.at(-1)).toBe(2);
        const [first, second] = ringsOf(clearSky.out).sort((a, b) => b.radius - a.radius);
        expect(first.radius).toBeGreaterThan(second.radius * 1.2);
        run(clearSky, reveal + 1, reveal + 1 + RING_LIFE);
        expect(Array.from(clearSky.out.ground)).toEqual(fresh());
    });

    it('rings for nothing else: a soft lock, a plain clear, a twist, an echo, a drop not the player\'s own', () => {
        const quiet = [
            makeCue({ kind: CUE.LOCK }),
            makeCue({ kind: CUE.CLEAR, lines: 2 }),
            twist(),
            echo(),
            hardDrop({ primary: false }),
            hardDrop({ reducedMotion: true, strength: PARHELION_REDUCED_MOTION_INTENSITY }),
        ];
        quiet.forEach((cue) => {
            const state = still();
            state.applyCue(cue, 1);
            run(state, 1, 2.5, (out) => expect(out.groundCount, `kind ${cue.kind}`).toBe(0));
        });
        const calm = still({ reducedMotion: true });
        calm.applyCue(hardDrop(), 1);
        expect(calm.update(1.3, FRAME).groundCount).toBe(0);
    });

    it('sends no ring at all under reduced motion: a ring is motion across the whole plain', () => {
        const events = [hardDrop, quad, apex, perfect];
        events.forEach((event) => {
            // The setting on the state, or the cue's own flag (the director's), either is enough.
            const calm = still({ reducedMotion: true });
            calm.applyCue(event(), 1);
            const flagged = still();
            flagged.applyCue(event({ reducedMotion: true, strength: PARHELION_REDUCED_MOTION_INTENSITY }), 1);
            for (const state of [calm, flagged]) {
                run(state, 1, 3, (out) => expect(out.groundCount).toBe(0));
            }
        });
        // A cue at full motion after a calmed one rings again.
        const state = still();
        state.applyCue(quad({ reducedMotion: true }), 1);
        state.applyCue(apex(), 1.2);
        expect(state.update(1.5, FRAME).groundCount).toBe(1);
    });

    it('keeps a hard drop\'s ring the faintest, and a ring still to come out of the hard drops\' reach', () => {
        const peakOf = (cue, from, seconds) => {
            const state = still();
            state.applyCue(cue, 1);
            let peak = 0;
            run(state, 1 + from, 1 + from + seconds, (out) => {
                ringsOf(out).forEach((ring) => { peak = Math.max(peak, ring.strength); });
            });
            return peak;
        };
        const drop = peakOf(hardDrop(), 0, 1);
        expect(drop).toBeGreaterThan(0);
        expect(peakOf(apex(), 0, 1)).toBeGreaterThan(drop);
        expect(peakOf(quad(), PARHELION_TIMING.quadMeet, 1)).toBeGreaterThan(drop);
        expect(peakOf(perfect(), PARHELION_TIMING.reveal, 1)).toBeGreaterThan(drop);
        expect(peakOf(hardDrop({ strength: 0.5 }), 0, 1)).toBeLessThan(drop);

        // The oldest ring goes: a four-line clear's, scheduled for its meet, is the youngest.
        const state = still();
        state.applyCue(quad(), 1);
        const meet = 1 + PARHELION_TIMING.quadMeet;
        for (let k = 1; k <= 5; k++) {
            state.applyCue(hardDrop({ lockCount: k }), 1 + (k * PARHELION_TIMING.quadMeet) / 6);
        }
        const after = ringsOf(state.update(meet + 0.4, FRAME));
        const expected = GROUND_RING.from * Math.exp(GROUND_RING.rate * 0.4);
        const kept = after.find((ring) => Math.abs(ring.radius - expected) < expected * 0.01);
        expect(kept, 'the four-line clear\'s ring').toBeDefined();
        expect(kept.strength).toBeGreaterThan(drop);
    });

    it('holds the rings back under Reduce flashing, but keeps them on the plain', () => {
        const ringAt = (reduce) => {
            reduceFlashing(reduce);
            const state = still();
            state.applyCue(quad(), 1);
            return ringsOf(state.update(1 + PARHELION_TIMING.quadMeet + 0.4, FRAME))[0];
        };
        const full = ringAt(false);
        const reduced = ringAt(true);
        expect(reduced.radius).toBe(full.radius);
        expect(reduced.width).toBe(full.width);
        expect(reduced.strength).toBeLessThan(full.strength * 0.6);
        expect(reduced.strength).toBeGreaterThan(full.strength * REDUCED_FLASH_SCALE);
    });

    it('forgets every ring on a reset, and makes none with reactions off', () => {
        const state = still();
        state.applyCue(perfect(), 1);
        state.applyCue(hardDrop(), 1.2);
        expect(state.update(1.6, FRAME).groundCount).toBeGreaterThan(0);
        state.resetSession();
        expect(state.update(1.6, 0).groundCount).toBe(0);
        expect(Array.from(state.out.ground)).toEqual(fresh());
        run(state, 1.6, 3, (out) => expect(out.groundCount).toBe(0));

        const off = still({ intensity: 0 });
        for (const cue of [hardDrop(), quad(), apex(), perfect()]) off.applyCue(cue, 1);
        run(off, 1, 3, (out) => expect(out.groundCount).toBe(0));
        const cut = still();
        cut.applyCue(quad(), 1);
        cut.configure({ intensity: 0 });
        run(cut, 1, 3, (out) => expect(out.groundCount).toBe(0));
    });
});

// ---------------------------------------------------------------------------------------
// Shafts of light round the stone
// ---------------------------------------------------------------------------------------

describe('Parhelion living pass: shafts of light', () => {
    const CRYSTAL = AIR_NAMES.indexOf('crystal');

    it('bursts as a four-line clear\'s halo closes, not before, and lets go', () => {
        const state = still();
        const t0 = 1;
        state.applyCue(quad(), t0);
        const meet = t0 + PARHELION_TIMING.quadMeet;
        run(state, t0, meet - FRAME, (out) => expect(out.rays[0]).toBe(0));
        let peak = 0;
        let last = 0;
        let widest = 0;
        run(state, meet, meet + 3, (out) => {
            peak = Math.max(peak, out.rays[0]);
            widest = Math.max(widest, Math.abs(out.rays[0] - last));
            last = out.rays[0];
            // A burst is neither the wheel nor the spectrum.
            expect(out.rays[2]).toBe(0);
            expect(out.rays[3]).toBe(0);
        });
        expect(peak).toBeGreaterThan(0.5);
        expect(widest).toBeLessThan(peak * 0.35);
        expect(state.update(meet + 12, FRAME).rays[0]).toBeLessThan(1e-3);
        // A weaker clear, a weaker burst.
        const weak = still();
        weak.applyCue(quad({ strength: 0.5 }), t0);
        expect(weak.update(meet + 0.3, FRAME).rays[0]).toBeLessThan(peak * 0.6);
    });

    it('never leaves 0..its ceiling however much is thrown at it', () => {
        const pile = (times) => {
            const state = still({ air: CRYSTAL });
            state.heat.level = 1;
            let peak = 0;
            for (let k = 0; k < times; k++) {
                state.applyCue(quad({ strength: 2 }), 1 + k * 0.05);
                state.applyCue(twist({ strength: 2 }), 1 + k * 0.05);
                state.applyCue(perfect({ strength: 2 }), 1 + k * 0.05);
                state.applyCue(apex({ strength: 2 }), 1 + k * 0.05);
            }
            run(state, 1, 5, (out) => {
                peak = Math.max(peak, out.rays[0]);
                expect(out.rays[0]).toBeGreaterThanOrEqual(0);
                for (const i of [2, 3]) {
                    expect(out.rays[i]).toBeGreaterThanOrEqual(0);
                    expect(out.rays[i]).toBeLessThanOrEqual(1);
                }
                expect(nonFinite(out)).toEqual([]);
            });
            return peak;
        };
        const some = pile(4);
        expect(some).toBeGreaterThan(1);
        expect(pile(12)).toBe(some);
    });

    it('holds the bursts back under Reduce flashing, never the air\'s own shafts', () => {
        const at = 1 + PARHELION_TIMING.quadMeet + 0.3;
        const gain = (reduce, withQuad) => {
            reduceFlashing(reduce);
            const state = still({ air: CRYSTAL });
            if (withQuad) state.applyCue(quad(), 1);
            return state.update(at, FRAME).rays[0];
        };
        const air = gain(false, false);
        expect(air).toBeGreaterThan(0);
        expect(gain(true, false)).toBe(air);
        const burst = gain(false, true) - air;
        expect(burst).toBeGreaterThan(0.3);
        expect(gain(true, true) - air).toBeCloseTo(burst * REDUCED_FLASH_SCALE, 5);
    });

    it.each([
        ['right', 0.8, 1],
        ['left', 0.2, -1],
    ])('a twist locked on the %s winds them into a wheel that turns once that way', (_, lockU, way) => {
        const state = still();
        const t0 = 1;
        const from = state.update(t0, 0).rays[1];
        expect(state.out.rays[2]).toBe(0);
        state.applyCue(twist({ lockU }), t0);
        let last = from;
        run(state, t0, t0 + RAY_WHEEL.turn, (out, t) => {
            expect((out.rays[1] - last) * way, `turning at ${t}`).toBeGreaterThanOrEqual(-1e-6);
            if (t > t0 + 0.15) expect(out.rays[2], `wheel at ${t}`).toBeGreaterThan(0.95);
            expect(out.rays[0]).toBeGreaterThanOrEqual(0);
            last = out.rays[1];
        });
        expect(state.out.rays[0]).toBeGreaterThan(0.2);
        expect(state.out.rays[1] - from).toBeCloseTo(way * TWO_PI, 4);
        // It stays where it stopped while the wheel lets go: no turning back.
        run(state, t0 + RAY_WHEEL.turn, t0 + RAY_WHEEL.turn + 5, (out) => {
            expect(out.rays[1] - from).toBeCloseTo(way * TWO_PI, 4);
        });
        expect(state.out.rays[2]).toBeLessThan(0.01);
        expect(state.out.rays[0]).toBeLessThan(0.01);
    });

    it('a second twist carries the wheel on from where it stands', () => {
        const state = still();
        const t0 = 1;
        const from = state.update(t0, 0).rays[1];
        state.applyCue(twist({ lockU: 0.8 }), t0);
        const t1 = frameAt(t0, t0 + RAY_WHEEL.turn * 0.4);
        const standing = run(state, t0, t1).rays[1];
        expect(standing - from).toBeGreaterThan(0.5);
        expect(standing - from).toBeLessThan(TWO_PI - 0.5);
        // The other way this time: from where it stands, never from the start again.
        state.applyCue(twist({ lockU: 0.2 }), t1);
        expect(state.update(t1, 0).rays[1]).toBeCloseTo(standing, 5);
        let last = standing;
        let widest = 0;
        run(state, t1, t1 + RAY_WHEEL.turn, (out) => {
            widest = Math.max(widest, Math.abs(out.rays[1] - last));
            expect(out.rays[1]).toBeLessThanOrEqual(last + 1e-6);
            expect(out.rays[2]).toBeLessThanOrEqual(1);
            last = out.rays[1];
        });
        expect(widest).toBeLessThan(0.4);
        expect(state.out.rays[1]).toBeCloseTo(standing - TWO_PI, 4);
    });

    it('starts no wheel under reduced motion', () => {
        const flagged = still();
        const before = flagged.update(1, 0).rays[1];
        flagged.applyCue(twist({ reducedMotion: true, strength: PARHELION_REDUCED_MOTION_INTENSITY }), 1);
        const calm = still({ reducedMotion: true });
        calm.applyCue(twist(), 1);
        for (const state of [flagged, calm]) {
            run(state, 1, 1 + RAY_WHEEL.turn + 1, (out) => {
                expect(out.rays[2]).toBe(0);
                expect(out.rays[1]).toBe(before);
            });
        }
    });

    it('a perfect clear splits them into the spectrum from its reveal', () => {
        const state = still();
        const t0 = 1;
        state.applyCue(perfect(), t0);
        const reveal = t0 + PARHELION_TIMING.reveal;
        run(state, t0, reveal - FRAME, (out) => {
            expect(out.rays[3]).toBe(0);
            expect(out.rays[0]).toBe(0);
        });
        const out = state.update(reveal + 0.4, FRAME);
        expect(out.rays[3]).toBeGreaterThan(0.95);
        expect(out.rays[0]).toBeGreaterThan(0.5);
        expect(out.rays[2]).toBe(0);
        const later = state.update(reveal + 14, FRAME);
        expect(later.rays[3]).toBeLessThan(1e-3);
        expect(later.rays[0]).toBeLessThan(1e-3);
    });

    it('stands with the Sun Cross and with a hot hand, with no event at all', () => {
        const cross = still();
        cross.applyCue(apex(), 1);
        expect(cross.update(1.6, FRAME).rays[0]).toBeGreaterThan(0.3);
        const hot = still();
        expect(hot.update(1, 0).rays[0]).toBe(0);
        hot.heat.level = 1;
        const warm = hot.update(1, 0).rays[0];
        expect(warm).toBeGreaterThan(0);
        hot.heat.fever = 1;
        expect(hot.update(1, 0).rays[0]).toBeGreaterThan(warm);
    });
});

// ---------------------------------------------------------------------------------------
// A level's band of light
// ---------------------------------------------------------------------------------------

describe('Parhelion living pass: a level\'s light', () => {
    const resting = [LEVEL_SWEEP.from, Math.fround(LEVEL_SWEEP.width), 0];

    it('sends a band of gold in from the horizon by e-folds while the far range flushes', () => {
        const state = still();
        expect(Array.from(state.update(1, 0).sweep)).toEqual([...resting, 0]);
        const t0 = 2;
        state.setLevel(2, t0);
        let last = null;
        let peak = 0;
        let flush = 0;
        let widest = 0;
        run(state, t0, t0 + LEVEL_SWEEP.life - FRAME, (out, t) => {
            const [distance, width, strength, range] = out.sweep;
            expect(width).toBe(Math.fround(LEVEL_SWEEP.width));
            expect(distance).toBeCloseTo(LEVEL_SWEEP.from * Math.exp(-LEVEL_SWEEP.rate * (t - t0)), 0);
            expect(strength).toBeGreaterThanOrEqual(0);
            expect(strength).toBeLessThanOrEqual(1);
            if (last) {
                expect(distance / last[0], `band at ${t}`).toBeCloseTo(Math.exp(-LEVEL_SWEEP.rate * FRAME), 5);
                widest = Math.max(widest, Math.abs(strength - last[2]));
                if (t - t0 < 1) expect(range, `flush at ${t}`).toBeGreaterThanOrEqual(last[3] - 1e-6);
            } else {
                expect(distance).toBeCloseTo(LEVEL_SWEEP.from, 2);
                expect(strength).toBe(0);
            }
            peak = Math.max(peak, strength);
            flush = Math.max(flush, range);
            last = [distance, width, strength, range];
        });
        expect(peak).toBeGreaterThan(0.9);
        expect(flush).toBeGreaterThan(0.5);
        expect(widest).toBeLessThan(0.15);
        // The band has crossed most of the plain and faded when it ends.
        expect(last[0]).toBeLessThan(LEVEL_SWEEP.from * 0.05);
        expect(last[2]).toBeLessThan(0.02);
        // Spent: the band rests at the horizon again, and the range gives its flush back.
        expect(Array.from(state.update(t0 + LEVEL_SWEEP.life + FRAME, FRAME).sweep.slice(0, 3))).toEqual(resting);
        expect(Array.from(state.update(t0 + 40, FRAME).sweep.slice(0, 3))).toEqual(resting);
        expect(state.out.sweep[3]).toBeLessThan(1e-3);
    });

    it('sends none for the reset back to level 1, a level that does not rise, or with reactions off', () => {
        const noBand = (state, from, label) => run(state, from, from + LEVEL_SWEEP.life + 0.5, (out) => {
            expect(Array.from(out.sweep.slice(0, 3)), label).toEqual(resting);
        });
        const state = still();
        state.setLevel(5, 0);
        run(state, 0, LEVEL_SWEEP.life + 30);
        // The same level again, a lower one, the reset.
        state.setLevel(5, 40);
        noBand(state, 40, 'the same level');
        state.setLevel(3, 50);
        noBand(state, 50, 'a lower level');
        state.resetSession();
        noBand(state, 60, 'the reset');
        expect(state.out.sweep[3]).toBeLessThan(1e-3);
        // A new run climbs again: the band is back.
        state.setLevel(2, 70);
        expect(state.update(71, FRAME).sweep[2]).toBeGreaterThan(0.5);

        const off = still({ intensity: 0 });
        off.setLevel(4, 1);
        noBand(off, 1, 'reactions off');
        expect(off.out.sweep[3]).toBe(0);
    });

    it('ends with the run: a reset takes the band and the flush away', () => {
        const state = still();
        state.setLevel(2, 1);
        expect(state.update(2, FRAME).sweep[2]).toBeGreaterThan(0.5);
        state.resetSession();
        const out = state.update(2, 0);
        expect(Array.from(out.sweep)).toEqual([...resting, 0]);
    });

    it('keeps the band home under reduced motion: the range still flushes, nothing crosses the plain', () => {
        const peakOf = (options) => {
            const state = still(options);
            state.setLevel(2, 1);
            const most = {
                band: 0, rays: 0, flush: 0, nearest: LEVEL_SWEEP.from,
            };
            run(state, 1, 1 + LEVEL_SWEEP.life, (out) => {
                most.band = Math.max(most.band, out.sweep[2]);
                most.rays = Math.max(most.rays, out.rays[0]);
                most.flush = Math.max(most.flush, out.sweep[3]);
                most.nearest = Math.min(most.nearest, out.sweep[0]);
            });
            return most;
        };
        const full = peakOf({});
        const calm = peakOf({ reducedMotion: true });
        expect(full.band).toBeGreaterThan(0.9);
        expect(full.rays).toBeGreaterThan(0.1);
        expect(calm.band).toBe(0);
        expect(calm.nearest).toBe(LEVEL_SWEEP.from);
        expect(calm.rays).toBe(0);
        // A level is still a moment: the far range warms, as much as reduced motion lets a reaction.
        expect(calm.flush).toBeGreaterThan(0.1);
        expect(calm.flush).toBeLessThanOrEqual(PARHELION_REDUCED_MOTION_INTENSITY + 1e-6);
        expect(calm.flush).toBeLessThan(full.flush);
    });

    it('gives the far range an alpenglow of its own (the low sun, the afterglow), none at noon or deep night', () => {
        const flushAt = (walk) => still({ walk }).update(1, 0).sweep[3];
        expect(flushAt(NOON)).toBe(0);
        expect(flushAt(NIGHT_WALK_DEEP)).toBe(0);
        expect(flushAt(GOLDEN_SUN)).toBeGreaterThan(0.2);
        expect(flushAt(0.5)).toBeGreaterThan(0);
        expect(flushAt(0.5)).toBeLessThan(flushAt(GOLDEN_SUN));
        expect(flushAt(DUSK_WALK)).toBeGreaterThan(flushAt(GOLDEN_SUN));
        // A level's flush rides on top of it and never takes it below.
        const state = still({ walk: GOLDEN_SUN });
        const base = state.update(1, 0).sweep[3];
        state.setLevel(2, 1);
        run(state, 1, 12, (out) => {
            expect(out.sweep[3]).toBeGreaterThanOrEqual(base - 1e-6);
            expect(out.sweep[3]).toBeLessThanOrEqual(1.5);
        });
        expect(state.update(2.5, FRAME).sweep[3]).toBeGreaterThan(base + 0.3);
    });
});

// ---------------------------------------------------------------------------------------
// The avenue's answer
// ---------------------------------------------------------------------------------------

describe('Parhelion living pass: the avenue\'s answer', () => {
    it('rests with no wave to show, then answers a back-to-back down the avenue', () => {
        const state = still();
        const rest = Array.from(state.update(1, 0).avenue);
        // A wave born long ago at no strength: nothing over any stone.
        expect(rest[0] + rest[3]).toBeLessThan(0);
        expect(rest[1]).toBe(0);
        expect(rest[2]).toBe(Math.fround(AVENUE_WAVE.gap));
        expect(rest[3]).toBe(Math.fround(AVENUE_WAVE.life));
        state.applyCue(echo(), 2.25);
        const out = state.update(2.25, FRAME);
        expect(out.avenue[0]).toBe(2.25);
        expect(out.avenue[1]).toBeGreaterThan(0);
        expect(out.avenue[2]).toBe(Math.fround(AVENUE_WAVE.gap));
        expect(out.avenue[3]).toBe(Math.fround(AVENUE_WAVE.life));
        expect(AVENUE_WAVE.gap).toBeGreaterThan(0);
        expect(AVENUE_WAVE.life).toBeGreaterThan(0);
    });

    it('answers louder each time in a run, never past 1.4', () => {
        const state = still();
        const heard = [];
        for (let k = 0; k < 6; k++) {
            state.applyCue(echo(), 1 + k);
            heard.push(state.update(1 + k, FRAME).avenue[1]);
            expect(state.out.avenue[0]).toBe(1 + k);
        }
        for (let k = 1; k < heard.length; k++) expect(heard[k]).toBeGreaterThanOrEqual(heard[k - 1]);
        expect(heard[2]).toBeGreaterThan(heard[0]);
        const loud = still();
        for (let k = 0; k < 6; k++) {
            loud.applyCue(echo({ strength: 2 }), 1 + k);
            expect(loud.update(1 + k, FRAME).avenue[1]).toBeLessThanOrEqual(1.4 + 1e-6);
        }
        expect(loud.out.avenue[1]).toBeCloseTo(1.4, 5);
    });

    it('lights the whole avenue at once under reduced motion', () => {
        const state = still();
        state.applyCue(echo({ reducedMotion: true }), 1);
        expect(state.update(1, FRAME).avenue[2]).toBe(0);
        expect(state.out.avenue[1]).toBeGreaterThan(0);
        // The next answer at full motion runs stone after stone again.
        state.applyCue(echo(), 12);
        expect(state.update(12, FRAME).avenue[2]).toBe(Math.fround(AVENUE_WAVE.gap));
        const calm = still({ reducedMotion: true });
        calm.applyCue(echo(), 1);
        expect(calm.update(1, FRAME).avenue[2]).toBe(0);
    });

    it('is the echo\'s alone, forgotten on a reset and never made with reactions off', () => {
        for (const cue of [hardDrop(), quad(), twist(), apex(), perfect(), makeCue({ kind: CUE.CLEAR, lines: 3 })]) {
            const state = still();
            state.applyCue(cue, 1);
            expect(run(state, 1, 2).avenue[1], `kind ${cue.kind}`).toBe(0);
        }
        const state = still();
        state.applyCue(echo(), 1);
        state.resetSession();
        const out = state.update(1.2, FRAME);
        expect(out.avenue[1]).toBe(0);
        expect(out.avenue[0] + out.avenue[3]).toBeLessThan(0);
        const off = still({ intensity: 0 });
        off.applyCue(echo(), 1);
        expect(off.update(1.2, FRAME).avenue[1]).toBe(0);
    });
});

// ---------------------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------------------

describe('Parhelion living pass: housekeeping', () => {
    /** What the living pass writes: the keys a used state must give back as a fresh one holds them. */
    const LIVING = ['night', 'dusk', 'stars', 'stoneStars', 'air', 'nacre', 'ground', 'groundCount', 'sweep', 'grade'];

    it('keeps out, its arrays and its scratch rows the same objects through everything', () => {
        const state = createState();
        const out = state.update(0, 0);
        const refs = {};
        for (const key of Object.keys(out)) {
            if (out[key] && typeof out[key] === 'object') refs[key] = out[key];
        }
        for (const key of ['air', 'rays', 'ground', 'sweep', 'avenue', 'grade']) {
            expect(refs[key], key).toBeInstanceOf(Float32Array);
        }
        expect(out.ground.length).toBe(GROUND_RING.slots * 4);
        const { air, hap } = state;
        const cues = [hardDrop(), quad(), twist(), apex(), perfect(), echo()];
        let t = 0;
        for (let frame = 0; frame < 60 * 100; frame++) {
            t += FRAME;
            if (frame % 41 === 0) state.applyCue(cues[(frame / 41) % cues.length], t);
            if (frame === 700) state.setLevel(2, t);
            if (frame === 1500) state.gameOver(t);
            if (frame === 1600) state.resetSession();
            if (frame === 2000) state.sessionStart(t);
            if (frame === 3000) state.seek(t);
            if (frame === 3500) state.configure({ air: 2, walk: 1.5, happenings: false });
            if (frame === 4000) state.configure({ air: -1, walk: -1, happenings: true });
            state.sampleHeat(t);
            expect(state.update(t, FRAME)).toBe(out);
        }
        for (const key of Object.keys(refs)) expect(out[key], key).toBe(refs[key]);
        expect(state.air).toBe(air);
        expect(state.hap).toBe(hap);
        expect(nonFinite(out)).toEqual([]);
    });

    it('answers odd times, steps and strengths with finite numbers', () => {
        const times = [-5, -1e-3, 0, 1e-9, 1e6, 1e9, Number.NaN, Infinity, -Infinity];
        for (const t of times) {
            for (const dt of [0, FRAME, 5, -1, Number.NaN, Infinity]) {
                expect(nonFinite(createState().update(t, dt)), `update(${t}, ${dt})`).toEqual([]);
            }
        }
        const kinds = [CUE.STONEFALL, CUE.QUAD, CUE.TWIST, CUE.APEX, CUE.PERFECT, CUE.ECHO];
        for (const kind of kinds) {
            for (const strength of [0, 1e-9, 2, 50, -1, Number.NaN, Infinity]) {
                const state = createState();
                state.applyCue(makeCue({
                    kind, strength, lines: 4, echoOf: CUE.QUAD,
                }), 1);
                for (const t of [1, 1.36, 1.86, 2.5, 9]) {
                    const out = state.update(t, FRAME);
                    expect(nonFinite(out), `kind ${kind}, strength ${strength}, at ${t}`).toEqual([]);
                    ringsOf(out).forEach((ring) => expect(ring.strength).toBeGreaterThanOrEqual(0));
                }
            }
            for (const now of [-3, Number.NaN, Infinity, -Infinity, 1e9]) {
                const state = createState();
                state.applyCue(makeCue({ kind, lines: 4, echoOf: CUE.QUAD }), now);
                expect(nonFinite(state.update(5, FRAME)), `kind ${kind} at ${now}`).toEqual([]);
            }
        }
        for (const air of [-1, 0, 2.9, AIR_NAMES.length + 2, -3, Number.NaN, Infinity, '2', null]) {
            for (const walk of [-1, 0, 1.5, 2, 2.0000001, 3.7, 1e9, Number.NaN, Infinity, -0.5]) {
                const state = createState();
                state.configure({ air, walk });
                const out = state.update(10, FRAME);
                expect(nonFinite(out), `air ${air}, walk ${walk}`).toEqual([]);
                expect(out.night).toBeGreaterThanOrEqual(0);
                expect(out.night).toBeLessThanOrEqual(1);
            }
        }
        for (const level of [0, -3, 1e9, Number.NaN, Infinity, 2.7]) {
            const state = createState();
            state.setLevel(level, 1);
            expect(nonFinite(state.update(2, FRAME)), `level ${level}`).toEqual([]);
            expect(nonFinite(state.update(400, FRAME)), `level ${level}, later`).toEqual([]);
        }
    });

    it('gives a used state back as a fresh one holds it, once everything has decayed', () => {
        const used = still();
        const fresh = still();
        const cues = [hardDrop(), quad(), twist({ lockU: 0.2 }), apex(), perfect(), echo(), twist({ lockU: 0.8 })];
        cues.forEach((cue, i) => used.applyCue(cue, 1 + i * 0.4));
        used.setLevel(3, 2);
        fresh.setLevel(3, 2);
        let t = 0;
        for (let frame = 0; frame <= 60 * 90; frame++) {
            t = frame * FRAME;
            used.sampleHeat(t);
            used.update(t, FRAME);
        }
        fresh.sampleHeat(t);
        const a = snapshot(used.out);
        const b = snapshot(fresh.update(t, FRAME));
        const others = Object.keys(a).filter((key) => !LIVING.includes(key));
        expect(differences(a, b, 1e-6, others)).toEqual([]);
        expect(Array.from(used.out.ground)).toEqual(Array.from(fresh.out.ground));
        for (const i of [0, 2, 3]) expect(a.rays[i], `rays[${i}]`).toBeCloseTo(b.rays[i], 5);
        // The wheel rests a whole number of turns from where a fresh one rests.
        expect(Math.cos(a.rays[1] - b.rays[1])).toBeCloseTo(1, 5);
        // The avenue's last answer is long over (birth + the last stone's wait + life).
        expect(a.avenue[0] + a.avenue[3] + 64 * a.avenue[2]).toBeLessThan(t);
    });

    it('clears what the pass draws the moment reactions go off, and draws none after', () => {
        const state = still();
        const base = snapshot(still().update(3, 0));
        for (const cue of [hardDrop(), quad(), twist(), apex(), perfect(), echo()]) state.applyCue(cue, 1);
        state.setLevel(2, 1);
        state.update(2.4, FRAME);
        state.configure({ intensity: 0 });
        for (const cue of [hardDrop(), quad(), twist(), apex(), perfect(), echo()]) state.applyCue(cue, 2.5);
        const out = snapshot(state.update(3, FRAME));
        for (const key of LIVING) expect(out[key], key).toEqual(base[key]);
        expect([out.rays[0], out.rays[2], out.rays[3]]).toEqual([0, 0, 0]);
        expect(out.avenue[1]).toBe(0);
    });
});
