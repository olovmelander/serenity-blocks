/**
 * Fluid Dreams — the sky's life (fluid-dreams-sky.js): the airs the dusk wears, the dream sun's
 * arc, the far forms, the bubbles, what happens by itself and the sky's share of play.
 *
 * Relations, not tuning numbers: what must stay true while the look is free to change. The module
 * is three-free, and so is this file. A test that says it was found pinned a contract the source
 * broke when it was written (2026-11-25): each was fixed in the source, none by loosening a test.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    AIRS, AIR_HOLD, AIR_KEYS, AIR_LEVEL_STEP, AIR_SECONDS, BUBBLE_SLOTS, FAR_BAND, FAR_COUNT, FAR_FORMS, FluidSky,
    HAPPENINGS, SKY_ROWS, SUN, airAt, airDrift, airNear, happeningOf, sunHeight, sunLift, sunSway,
} from '../../src/themes/fluid-dreams/fluid-dreams-sky.js';
import { DEG, DREAM_SECONDS } from '../../src/themes/fluid-dreams/fluid-dreams-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/fluid-dreams/fluid-dreams-quality.js';

const DT = 1 / 60;
/** About where the world's rest camera stands (fluid-dreams-world.js REST_RIG), looking down −Z. */
const EYE = Object.freeze([0, 2.3, 0]);
/** The sun's bearing as the world hands it over: a unit [x, z], right of straight ahead. */
const SUN_FLAT = Object.freeze([Math.sin(0.57), -Math.cos(0.57)]);
const FRAME = Object.freeze({ eye: EYE, sunFlat: SUN_FLAT });
/** Where the liquid seats a far form's bead: its top stands this many of its radii over the body's (fluid-dreams-sky-tsl.js). */
const BEAD_TOP = 1.78;

/** A sky at rest at `start`, and every burst of spray it asks for (with the time it asked). */
function make(options = {}, start = 10) {
    const bursts = [];
    const sky = new FluidSky({
        emit: (burst) => bursts.push({ ...burst, color: [...burst.color], at: sky.time }),
        ...options,
    });
    sky.seek(start);
    sky.update(start, 0, FRAME);
    return { sky, bursts };
}

/** Advance by `seconds` in equal frames of about 1/60 s; `each` runs after every frame. */
function run(sky, seconds, each, frame = FRAME) {
    const steps = Math.max(1, Math.round(seconds / DT));
    const t0 = sky.time;
    for (let i = 1; i <= steps; i++) {
        sky.update(t0 + (seconds * i) / steps, seconds / steps, frame);
        each?.(sky);
    }
}

const kinds = (bursts, kind) => bursts.filter((burst) => burst.kind === kind);
const finiteRow = (row) => Number.isFinite(row.x) && Number.isFinite(row.y) && Number.isFinite(row.z)
    && Number.isFinite(row.w);
const unit = (x, y, z) => Math.abs(Math.hypot(x, y, z) - 1) < 1e-9;

/** The far forms' rows as [place (unit direction, radius), shape (wide, tall, bead, flare)]. */
const farRows = (sky) => Array.from({ length: FAR_COUNT }, (_, i) => [sky.rows[i * 2], sky.rows[i * 2 + 1]]);
/** The bubbles' rows as [place (unit direction from the eye, angular radius), look (phase, hue, light, -)]. */
const bubbleRows = (sky) => Array.from(
    { length: BUBBLE_SLOTS },
    (_, i) => [sky.rows[(FAR_COUNT + i) * 2], sky.rows[(FAR_COUNT + i) * 2 + 1]],
);
/**
 * The bubbles that are drawn, by what stays the same of each for as long as it lives (its film's
 * phase and hue): the rows are packed, so a row is not a bubble from one frame to the next.
 */
const litBubbles = (sky) => {
    const out = new Map();
    for (const [place, look] of bubbleRows(sky)) {
        if (look.z > 0) out.set(`${look.x}/${look.y}`, { light: look.z, radius: place.w });
    }
    return out;
};
const lit = (sky) => litBubbles(sky).size;
/** The most any one bubble's light changed between two frames (one that came or went counts in full). */
const lightStep = (before, after) => {
    let step = 0;
    for (const [key, was] of before) step = Math.max(step, Math.abs((after.get(key)?.light ?? 0) - was.light));
    for (const [key, now] of after) if (!before.has(key)) step = Math.max(step, now.light);
    return step;
};
/** How high in the sky a far form reaches (the sine of the elevation of its top, bead and all). */
const farTop = ([place, shape]) => place.y + place.w * (shape.y + shape.z * BEAD_TOP);

/** Every number the world copies out of the sky for a frame, by name. */
const numbers = (sky) => ({
    'sun.height': sky.sun.height,
    'sun.sway': sky.sun.sway,
    skyClock: sky.skyClock,
    cover: sky.cover,
    strata: sky.strata,
    starGain: sky.starGain,
    moteSurge: sky.moteSurge,
    clearing: sky.clearing,
    halo: sky.halo,
    halo2: sky.halo2,
    ...Object.fromEntries(AIR_KEYS.map((key) => [`air.${key}`, sky.air[key]])),
    ...Object.fromEntries(['front', 'pillar', 'shock', 'swirl', 'shoal'].flatMap(
        (name) => Object.entries(sky[name]).map(([key, value]) => [`${name}.${key}`, value]),
    )),
    'star.strength': sky.star.strength,
    'star.length': sky.star.length,
    ...Object.fromEntries(sky.star.head.map((value, i) => [`star.head.${i}`, value])),
    ...Object.fromEntries(sky.star.along.map((value, i) => [`star.along.${i}`, value])),
});

/**
 * What the liquid relies on, every frame. Returns the first thing that is wrong, or null.
 * (One string per frame instead of thousands of expectations.)
 */
function problem(sky) {
    if (sky.rows.length !== SKY_ROWS) return 'the table changed size';
    const bad = sky.rows.findIndex((row) => !finiteRow(row));
    if (bad >= 0) return `rows[${bad}] is not finite: ${JSON.stringify(sky.rows[bad])}`;
    const far = farRows(sky);
    for (let i = 0; i < far.length; i++) {
        const [place, shape] = far[i];
        if (!unit(place.x, place.y, place.z)) return `far form ${i} has no unit direction`;
        if (!(place.w > 0)) return `far form ${i} has radius ${place.w}`;
        if (!(shape.x > 0 && shape.y > 0)) return `far form ${i} has no shape`;
        if (!(shape.z >= 0 && shape.w >= 0)) return `far form ${i} has a negative bead or flare`;
    }
    // The bubbles: the ones that show are packed at the front and counted; the rest are not drawn.
    const live = sky.bubbleLive;
    if (!(Number.isInteger(live) && live >= 0 && live <= sky.bubbleCount)) {
        return `${live} bubbles are counted of ${sky.bubbleCount}`;
    }
    const bubbles = bubbleRows(sky);
    for (let i = 0; i < bubbles.length; i++) {
        const [place, look] = bubbles[i];
        // (drawn or not, a row is a direction with a size: the shader divides by it)
        if (!unit(place.x, place.y, place.z)) return `bubble row ${i} has no unit direction`;
        if (!(place.w > 0)) return `bubble row ${i} has radius ${place.w}`;
        if (!(look.z >= 0)) return `bubble row ${i} has light ${look.z}`;
        if (i >= live && look.z !== 0) return `bubble row ${i} is lit past the ${live} that are counted`;
    }
    const all = numbers(sky);
    const broken = Object.keys(all).find((key) => !Number.isFinite(all[key]));
    return broken ? `${broken} is ${all[broken]}` : null;
}

/** Everything a frame of sky is drawn from. */
function look(sky) {
    return [...sky.rows.flatMap((row) => [row.x, row.y, row.z, row.w]), sky.bubbleLive, ...Object.values(numbers(sky))];
}

const indexOfMost = (key) => AIRS.reduce((best, air, i) => (air[key] > AIRS[best][key] ? i : best), 0);
const indexOfLeast = (key) => AIRS.reduce((best, air, i) => (air[key] < AIRS[best][key] ? i : best), 0);

describe('fluid dreams sky: the airs', () => {
    it('defines every air alike, each with a name of its own', () => {
        expect(AIRS.length).toBeGreaterThan(1);
        expect(new Set(AIRS.map((air) => air.name)).size).toBe(AIRS.length);
        for (const air of AIRS) {
            expect(typeof air.name, air.name).toBe('string');
            expect(Object.keys(air).sort(), air.name).toEqual(['name', ...AIR_KEYS].sort());
            for (const key of AIR_KEYS) {
                expect(Number.isFinite(air[key]), `${air.name}.${key}`).toBe(true);
                expect(air[key], `${air.name}.${key}`).toBeGreaterThanOrEqual(0);
            }
            // What is a share stays a share.
            for (const key of ['cover', 'strata', 'mist', 'bubbles', 'lift']) {
                expect(air[key], `${air.name}.${key}`).toBeLessThanOrEqual(1);
            }
        }
        // The airs are worth turning through: each key differs somewhere round the wheel.
        for (const key of AIR_KEYS) expect(new Set(AIRS.map((air) => air[key])).size, key).toBeGreaterThan(1);
    });

    it('is each air exactly on a whole phase, and between two lies between them for every key', () => {
        const count = AIRS.length;
        for (let k = -count; k <= count * 2; k++) {
            const air = AIRS[((k % count) + count) % count];
            const at = airAt(k);
            for (const key of AIR_KEYS) expect(at[key], `phase ${k}, ${key}`).toBe(air[key]);
            expect(airNear(k)).toBe(air);
            expect(airNear(k + 0.4)).toBe(air);
            expect(airNear(k - 0.4)).toBe(air);
            const next = AIRS[(((k + 1) % count) + count) % count];
            for (const melt of [0.01, 0.25, 0.5, 0.75, 0.99]) {
                const between = airAt(k + melt);
                for (const key of AIR_KEYS) {
                    const lo = Math.min(air[key], next[key]);
                    const hi = Math.max(air[key], next[key]);
                    expect(between[key], `phase ${k + melt}, ${key}`).toBeGreaterThanOrEqual(lo - 1e-12);
                    expect(between[key], `phase ${k + melt}, ${key}`).toBeLessThanOrEqual(hi + 1e-12);
                    // (and it is on its way: half way it is neither, where they differ)
                    if (melt === 0.5 && hi > lo) {
                        expect(between[key]).toBeGreaterThan(lo);
                        expect(between[key]).toBeLessThan(hi);
                    }
                }
            }
        }
        // It writes into what it is handed; a phase that is no number is the first air.
        const out = {};
        expect(airAt(1, out)).toBe(out);
        for (const key of AIR_KEYS) expect(airAt(NaN)[key], key).toBe(AIRS[0][key]);
    });

    it('turns the airs by the clock: never backward, never in a jump, resting on each', () => {
        const count = AIRS.length;
        const step = 0.5;
        // (the steepest a melt runs: a smoothstep over what is left of the air's time after its rest)
        const steepest = (1.5 * step) / ((1 - AIR_HOLD) * AIR_SECONDS);
        let previous = airDrift(0);
        expect(previous).toBe(0);
        for (let t = step; t <= AIR_SECONDS * count * 2; t += step) {
            const drift = airDrift(t);
            expect(drift, `t=${t}`).toBeGreaterThanOrEqual(previous);
            expect(drift - previous, `t=${t}`).toBeLessThanOrEqual(steepest + 1e-9);
            previous = drift;
        }
        expect(previous).toBeCloseTo(count * 2, 6);
        for (let k = 0; k <= count * 2; k++) {
            // On each air exactly, through its rest...
            expect(airDrift(k * AIR_SECONDS)).toBe(k);
            expect(airDrift((k + AIR_HOLD * 0.5) * AIR_SECONDS)).toBe(k);
            expect(airDrift((k + AIR_HOLD * 0.99) * AIR_SECONDS)).toBe(k);
            // ...then on its way to the next.
            const melting = airDrift((k + AIR_HOLD + (1 - AIR_HOLD) * 0.5) * AIR_SECONDS);
            expect(melting).toBeGreaterThan(k);
            expect(melting).toBeLessThan(k + 1);
        }
        // Before the start of time, and at no time at all, it is the start of time.
        expect(airDrift(-50)).toBe(0);
        expect(airDrift(NaN)).toBe(0);
        // The airs keep their own clock beside the dusks', so the pairings change.
        expect(AIR_SECONDS).not.toBe(DREAM_SECONDS);
        expect(AIR_HOLD).toBeGreaterThan(0);
        expect(AIR_HOLD).toBeLessThan(1);
    });

    it('wears the first air at the start of time, on the first level', () => {
        const sky = new FluidSky();
        sky.update(0, 0, FRAME);
        for (const key of AIR_KEYS) expect(sky.air[key], key).toBe(AIRS[0][key]);
        expect(sky.getState()).toMatchObject({ air: AIRS[0].name, airPhase: 0 });
        // What it hands on is that air, untouched: nothing is playing.
        expect(sky.cover).toBe(AIRS[0].cover);
        expect(sky.strata).toBe(AIRS[0].strata);
        expect(sky.starGain).toBe(AIRS[0].stars);
        expect([sky.halo2, sky.clearing, sky.moteSurge]).toEqual([0, 0, 0]);
        expect(problem(sky)).toBeNull();
        // And still, well into its rest.
        const { sky: later } = make({}, AIR_SECONDS * AIR_HOLD * 0.9);
        for (const key of AIR_KEYS) expect(later.air[key], key).toBe(AIRS[0][key]);
    });

    it('steps the air on for a level, eased, the short way round', () => {
        const count = AIRS.length;
        // (how far apart two airs ever stand, key by key: the measure of a jump)
        const span = Object.fromEntries(AIR_KEYS.map((key) => {
            const values = AIRS.map((air) => air[key]);
            return [key, Math.max(...values) - Math.min(...values)];
        }));
        expect(AIR_LEVEL_STEP % count).not.toBe(0); // a level does change the air
        for (let level = 1; level <= count * 2 + 1; level++) {
            // (early in the first air's rest, and done before it ends: the clock adds nothing here)
            const { sky } = make({}, 2);
            const from = sky.getState().airPhase;
            sky.setLevel(level);
            let previous = { ...sky.air };
            let farthest = 0;
            run(sky, 25, () => {
                for (const key of AIR_KEYS) {
                    expect(Math.abs(sky.air[key] - previous[key]), `level ${level}, ${key}`).toBeLessThan(span[key] * 0.05);
                }
                previous = { ...sky.air };
                farthest = Math.max(farthest, Math.abs(sky.getState().airPhase - from));
            });
            expect(sky.time).toBeLessThan(AIR_SECONDS * AIR_HOLD);
            const want = AIRS[((level - 1) * AIR_LEVEL_STEP) % count];
            expect(sky.getState().air, `level ${level}`).toBe(want.name);
            for (const key of AIR_KEYS) expect(sky.air[key], `level ${level}, ${key}`).toBeCloseTo(want[key], 6);
            // Never the long way round the wheel.
            expect(farthest, `level ${level}`).toBeLessThanOrEqual(count / 2);
        }
        // A capture lands on a level's air at once.
        const { sky } = make({}, 2);
        sky.setLevel(2, true);
        sky.update(2, 0, FRAME);
        for (const key of AIR_KEYS) expect(sky.air[key], key).toBe(AIRS[AIR_LEVEL_STEP % count][key]);
        // Nonsense is the first level.
        for (const junk of [NaN, -3, 0, 'x', undefined, null]) {
            sky.setLevel(junk, true);
            expect(sky.level, String(junk)).toBe(1);
        }
        sky.update(2, 0, FRAME);
        expect(sky.getState().air).toBe(AIRS[0].name);
    });

    it('holds one air when asked, whatever the clock and the level say', () => {
        const { sky } = make({}, AIR_SECONDS * (AIR_HOLD + (1 - AIR_HOLD) * 0.5)); // mid-melt
        sky.setLevel(3);
        AIRS.forEach((air, index) => {
            sky.airHold = index;
            run(sky, 0.5);
            for (const key of AIR_KEYS) expect(sky.air[key], `${air.name}.${key}`).toBe(air[key]);
            expect(sky.getState().air).toBe(air.name);
        });
        // A fraction shows two of them melting.
        sky.airHold = 0.5;
        run(sky, DT);
        const key = AIR_KEYS.find((name) => AIRS[0][name] !== AIRS[1][name]);
        expect(sky.air[key]).toBeCloseTo((AIRS[0][key] + AIRS[1][key]) / 2, 12);
        // Let go, the wheel turns again from where the clock and the level have it.
        sky.airHold = null;
        run(sky, 30);
        expect(sky.getState().air).toBe(airNear((3 - 1) * AIR_LEVEL_STEP + airDrift(sky.time)).name);
        expect(problem(sky)).toBeNull();
    });
});

describe('fluid dreams sky: the dream sun', () => {
    it('keeps the sun on the sea line whatever the hour and the air', () => {
        expect(SUN.low).toBeGreaterThan(0);
        expect(SUN.high).toBeGreaterThan(SUN.low);
        const lifts = [0, 0.25, 0.5, 1, ...AIRS.map((air) => air.lift), -3, 7];
        for (let t = 0; t <= 2000; t += 7.3) {
            for (const lift of lifts) {
                const height = sunHeight(sunLift(t, lift));
                expect(height, `t=${t}, lift ${lift}`).toBeGreaterThanOrEqual(SUN.low);
                expect(height, `t=${t}, lift ${lift}`).toBeLessThanOrEqual(SUN.high);
            }
            // An air that lifts it more never stands it lower.
            expect(sunLift(t, 1)).toBeGreaterThanOrEqual(sunLift(t, 0));
            // It wanders a little either side of where the composition stands it, no more.
            expect(Math.abs(sunSway(t))).toBeLessThanOrEqual(SUN.sway);
        }
        expect(sunHeight(0)).toBe(SUN.low);
        expect(sunHeight(1)).toBe(SUN.high);
        // It rides by itself too (the same air, another hour), and it does wander.
        const heights = [];
        const sways = [];
        for (let t = 0; t <= 2000; t += 7.3) {
            heights.push(sunHeight(sunLift(t, 0.5)));
            sways.push(sunSway(t));
        }
        expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0);
        expect(Math.max(...sways)).toBeGreaterThan(0);
        expect(Math.min(...sways)).toBeLessThan(0);
    });

    it('never jumps the sun between two frames, through the airs\' melts and a level', () => {
        const { sky } = make({}, 0);
        const range = SUN.high - SUN.low;
        let height = sky.sun.height;
        let sway = sky.sun.sway;
        let lowest = height;
        let highest = height;
        const frames = Math.round((AIR_SECONDS * 2.3) / DT);
        for (let i = 1; i <= frames; i++) {
            if (i === Math.round(frames * 0.3)) sky.setLevel(2);
            if (i === Math.round(frames * 0.7)) sky.setLevel(1);
            sky.update(i * DT, DT, FRAME);
            expect(Math.abs(sky.sun.height - height), `frame ${i}`).toBeLessThan(range * 0.01);
            expect(Math.abs(sky.sun.sway - sway), `frame ${i}`).toBeLessThan(SUN.sway * 0.01);
            ({ height, sway } = sky.sun);
            lowest = Math.min(lowest, height);
            highest = Math.max(highest, height);
        }
        expect(lowest).toBeGreaterThanOrEqual(SUN.low);
        expect(highest).toBeLessThanOrEqual(SUN.high);
        expect(highest - lowest).toBeGreaterThan(range * 0.1); // it does ride up and down the sea line
        expect(sky.getState().sun).toBe(sky.sun.height);
    });

    it('stands the sun for a frame before the frame is played, and holds it on a held clock', () => {
        const { sky } = make({}, 40);
        const { height, sway } = sky.sun;
        // (the world aims the shafts by it before the frame's update)
        sky.placeSun(40);
        expect(sky.sun).toEqual({ height, sway });
        for (let i = 0; i < 4; i++) {
            sky.placeSun(40);
            sky.update(40, 0, FRAME);
        }
        expect(sky.sun).toEqual({ height, sway });
        sky.placeSun(41);
        expect(sky.sun.height).toBe(sunHeight(sunLift(41, sky.air.lift)));
    });
});

describe('fluid dreams sky: the table', () => {
    it('is three-free', () => {
        const source = readFileSync(new URL('../../src/themes/fluid-dreams/fluid-dreams-sky.js', import.meta.url), 'utf8');
        expect(source).not.toMatch(/from 'three/);
    });

    it('writes one table of fixed rows: two for every far form, then two for every bubble', () => {
        expect(FAR_COUNT).toBe(FAR_FORMS.length);
        expect(SKY_ROWS).toBe((FAR_COUNT + BUBBLE_SLOTS) * 2);
        const { sky } = make();
        expect(sky.rows).toHaveLength(SKY_ROWS);
        const rows = sky.rows;
        const objects = rows.slice();
        sky.levelUp();
        sky.happen('bubbles', 3);
        sky.impact(-10, -23);
        run(sky, 3, () => expect(problem(sky)).toBeNull());
        sky.seek(200);
        sky.update(200, 0, FRAME);
        sky.reset();
        sky.update(200 + DT, DT, FRAME);
        // The very objects the liquid's uniform array was built on.
        expect(sky.rows).toBe(rows);
        expect(sky.rows.every((row, i) => row === objects[i])).toBe(true);
        expect(problem(sky)).toBeNull();
    });

    it('stands every far form where it is authored: a unit direction, low over the sea, inside its band', () => {
        const { sky } = make();
        // (a form that sinks is the sky's own happening, and has a test of its own)
        sky.happeningsOn = false;
        expect(FAR_BAND).toBeGreaterThan(0);
        expect(FAR_BAND).toBeLessThan(Math.sin(30 * DEG)); // far forms, not things overhead
        let highest = 0;
        run(sky, 90, () => {
            const wrong = problem(sky);
            if (wrong) throw new Error(`t=${sky.time.toFixed(3)}: ${wrong}`);
            farRows(sky).forEach(([place, shape], i) => {
                const [bearing, , size, , , bead] = FAR_FORMS[i];
                // On its own bearing, over the sea line, its own size.
                expect(Math.atan2(place.x, -place.z)).toBeCloseTo(bearing * DEG, 9);
                expect(place.y).toBeGreaterThan(0);
                expect(place.w).toBeCloseTo(size * DEG, 12);
                expect(shape.z).toBe(bead);
                // Bobbing and breathing as it does, nothing of it (bead and all) shows above the band.
                expect(farTop([place, shape]), `form ${i} at t=${sky.time.toFixed(2)}`).toBeLessThanOrEqual(FAR_BAND);
                highest = Math.max(highest, farTop([place, shape]));
            });
        });
        // (the band is a fit, not a ceiling far overhead)
        expect(highest).toBeGreaterThan(FAR_BAND * 0.5);
        // Every form keeps clear of the frame's middle, where the card stands.
        for (const [bearing, elevation, size] of FAR_FORMS) {
            expect(Math.abs(bearing)).toBeLessThan(90);
            expect(elevation).toBeGreaterThan(0);
            expect(size).toBeGreaterThan(0);
        }
    });

    // Found 2026-11-25: a form that had no bead comes up from a sink with one, and FAR_BAND was
    // fitted to the beads as authored, so the tallest bead-less form's new bead stood across the
    // band's edge, where the liquid's far-form gate (dir.y < FAR_BAND) cut it off level.
    it('keeps a far form inside its band when it comes up changed from a sink', () => {
        const sunk = new Map();
        for (let seed = 1; seed < 400 && sunk.size < FAR_COUNT; seed++) {
            const { sky } = make();
            const before = farRows(sky).map(([place]) => place.w);
            sky.happen('sink', seed);
            run(sky, 5);
            const index = farRows(sky).findIndex(([place], i) => place.w < before[i] * 0.5);
            if (index < 0 || sunk.has(index)) continue;
            let highest = 0;
            run(sky, 25, () => {
                highest = Math.max(highest, farTop(farRows(sky)[index]));
            });
            sunk.set(index, { seed, highest, bead: farRows(sky)[index][1].z });
        }
        // Every form takes its turn...
        expect(sunk.size).toBe(FAR_COUNT);
        // ...and comes up changed: with a bead if it had none, without if it had one.
        const over = [];
        for (const [index, { seed, highest, bead }] of sunk) {
            expect(bead > 0, `form ${index}`).toBe(!(FAR_FORMS[index][5] > 0));
            if (highest > FAR_BAND) over.push(`form ${index} (seed ${seed}) reaches ${highest.toFixed(4)}`);
        }
        expect(over, `above FAR_BAND = ${FAR_BAND.toFixed(4)}`).toEqual([]);
    });

    it('never writes a NaN: a long sweep in coarse steps, held frames, a huge step, play all the while', () => {
        const { sky, bursts } = make({}, 0);
        const check = (label) => {
            const wrong = problem(sky);
            if (wrong) throw new Error(`${label}, t=${sky.time}: ${wrong}`);
        };
        let n = 0;
        for (let t = 0; t <= 2000; t += 0.37) {
            n += 1;
            const frame = { ...FRAME, heat: (n % 50) / 50, fever: n % 300 < 30 ? 1 : 0 };
            if (n % 97 === 0) sky.levelUp();
            if (n % 131 === 0) sky.impact(-10 + (n % 7), -23 - (n % 5), (n % 3) * 0.5);
            if (n % 173 === 0) sky.perfect();
            if (n % 211 === 0) sky.answer(0.1);
            if (n % 59 === 0) sky.setLevel(1 + (n % 9));
            sky.setTwist(n % 40 < 6 ? 0.2 * (n % 40) : 0, -10, 9, -23);
            sky.update(t, n === 1 ? 0 : 0.37, frame);
            check('sweep');
            // A capture holding the frame (handed the same frame: the heat of play is the world's).
            if (n % 500 === 0) {
                const held = look(sky);
                for (let k = 0; k < 3; k++) sky.update(t, 0, frame);
                check('held');
                expect(look(sky)).toEqual(held);
            }
        }
        expect(sky.time).toBeGreaterThan(1990);
        // The happenings came by themselves meanwhile (the far fountains among them).
        expect(kinds(bursts, 'fountain').length).toBeGreaterThan(0);
        // A tab that slept for a day, then the next frame.
        sky.update(sky.time + 86400, 86400, FRAME);
        check('a huge step');
        sky.update(sky.time + DT, DT, FRAME);
        check('the frame after it');
        // An eye somewhere else, and one standing in the crater.
        sky.impact(3, -20);
        sky.update(sky.time + DT, DT, { eye: [3, 2.3, -20], sunFlat: SUN_FLAT });
        check('the eye over the crater');
        sky.update(sky.time + DT, DT, { eye: [-40, 30, 12], sunFlat: [-1, 0] });
        check('the eye elsewhere');
        for (const burst of bursts) {
            expect([burst.x, burst.y, burst.z, burst.power, ...burst.color].every(Number.isFinite), burst.kind).toBe(true);
        }
    });

    // The rows that say "found" failed when they were written (2026-11-25): the nonsense got into
    // the ink's clock, the air's step or a light's place and stayed there, or getState() threw.
    it.each([
        ['a seek before the start of time', (sky) => sky.seek(-5)],
        ['a seek to no time at all (found: the ink\'s clock was NaN for good)', (sky) => sky.seek(NaN)],
        ['a level that is no number', (sky) => sky.setLevel(NaN)],
        ['a level below the first', (sky) => sky.setLevel(-3, true)],
        ['a level in the millions', (sky) => sky.setLevel(4e6, true)],
        ['a level without end (found: the air\'s step was NaN for good, getState threw)', (sky) => sky.setLevel(Infinity)],
        ['an impact with no place (found: NaN in the pillar, the ring and the far forms\' flare)', (sky) => sky.impact()],
        ['an impact with a boost that is no number', (sky) => sky.impact(3, -20, NaN)],
        ['an answer at no time', (sky) => sky.answer(NaN)],
        ['an answer before now', (sky) => sky.answer(-4)],
        ['a perfect clear at no time', (sky) => sky.perfect(NaN)],
        ['a perfect clear long ago', (sky) => sky.perfect(-100)],
        ['a twist that is no number', (sky) => sky.setTwist(NaN, -10, 9, -23)],
        ['a twist below nothing', (sky) => sky.setTwist(-3, -10, 9, -23)],
        ['a twist wound past all sense', (sky) => sky.setTwist(1e9, -10, 9, -23)],
        ['a twist with no place (found: NaN in the swirl\'s place)', (sky) => sky.setTwist(1, NaN, NaN, NaN)],
        ['a happening it does not know', (sky) => sky.happen('nope', 3)],
        ['a happening with no seed', (sky) => ['star', 'bubbles', 'shoal', 'sink', 'fountain'].forEach((kind) => sky.happen(kind, NaN))],
        ['a happening with a negative seed', (sky) => ['star', 'bubbles', 'shoal', 'sink', 'fountain'].forEach((kind) => sky.happen(kind, -7))],
        ['a happening with a huge seed', (sky) => ['star', 'bubbles', 'shoal', 'sink', 'fountain'].forEach((kind) => sky.happen(kind, 1e12))],
        ['a frame at no time', (sky) => sky.update(NaN, DT, FRAME)],
        ['a frame before the start of time', (sky) => sky.update(-50, DT, FRAME)],
        ['a frame that ran backward', (sky) => sky.update(sky.time - 1, -1, FRAME)],
        ['a frame of no length (found: the ink\'s clock and the air\'s step were NaN for good)', (sky) => sky.update(sky.time, NaN, FRAME)],
    ])('takes %s and is whole again a frame later', (label, nonsense) => {
        const { sky } = make({}, 20);
        expect(() => nonsense(sky)).not.toThrow();
        // Two sane frames on: everything it hands the liquid is a number again, and it can say how it stands.
        expect(() => {
            sky.update(20 + DT, DT, FRAME);
            sky.update(20 + 2 * DT, DT, FRAME);
        }).not.toThrow();
        expect(problem(sky)).toBeNull();
        expect(() => sky.getState()).not.toThrow();
        expect(Number.isFinite(sky.getState().airPhase)).toBe(true);
    });
});

describe('fluid dreams sky: the bubbles', () => {
    it('shows no more bubbles than it is given, and none when it is given none', () => {
        const budgets = [...new Set([0, 1, ...QUALITY_NAMES.map((name) => QUALITY[name].bubbles), BUBBLE_SLOTS])];
        const most = {};
        for (const budget of budgets) {
            const sky = new FluidSky({ bubbles: budget });
            expect(sky.bubbleCount, `${budget}`).toBe(budget);
            sky.airHold = indexOfMost('bubbles');
            sky.seek(0);
            most[budget] = 0;
            for (let i = 0; i <= 1600; i++) {
                if (i % 200 === 40) sky.happen('bubbles', 1 + i);
                sky.update(i * 0.25, i ? 0.25 : 0, FRAME);
                const wrong = problem(sky);
                if (wrong) throw new Error(`${budget} bubbles, t=${sky.time}: ${wrong}`);
                expect(lit(sky), `${budget} bubbles`).toBeLessThanOrEqual(budget);
                expect(sky.getState().bubbles, `${budget} bubbles`).toBeLessThanOrEqual(budget);
                most[budget] = Math.max(most[budget], lit(sky));
            }
        }
        expect(most[0]).toBe(0);
        // What is paid for is seen: every budget shows bubbles, a bigger one more of them.
        for (const budget of budgets.filter((n) => n > 0)) expect(most[budget], `${budget}`).toBeGreaterThan(0);
        expect(most[BUBBLE_SLOTS]).toBeGreaterThan(most[1]);
        // A budget is a whole number of slots the table has rows for; none given is all of them.
        expect(new FluidSky({ bubbles: 99 }).bubbleCount).toBe(BUBBLE_SLOTS);
        expect(new FluidSky({ bubbles: -4 }).bubbleCount).toBe(0);
        expect(new FluidSky({ bubbles: 2.6 }).bubbleCount).toBe(3);
        expect(new FluidSky().bubbleCount).toBe(BUBBLE_SLOTS);
    });

    it('has more bubbles out in an air that asks for more', () => {
        const out = (index) => {
            const sky = new FluidSky();
            sky.happeningsOn = false;
            sky.airHold = index;
            sky.seek(0);
            let sum = 0;
            for (let i = 0; i <= 1200; i++) {
                sky.update(i * 0.5, i ? 0.5 : 0, FRAME);
                sum += lit(sky);
            }
            return sum / 1201;
        };
        const many = indexOfMost('bubbles');
        const few = indexOfLeast('bubbles');
        expect(AIRS[many].bubbles).toBeGreaterThan(AIRS[few].bubbles);
        expect(out(many)).toBeGreaterThan(out(few));
        expect(out(few)).toBeGreaterThanOrEqual(0);
    });

    it('draws one bubble where it is: the way from the eye, as large as it stands from there', () => {
        const sky = new FluidSky({ bubbles: 1 }); // one slot: its row is its own
        sky.happeningsOn = false;
        sky.airHold = indexOfMost('bubbles');
        sky.seek(0);
        const place = {};
        let seen = 0;
        for (let i = 0; i <= 800; i++) {
            const eye = [Math.sin(i * 0.1) * 0.6, 2.3 + Math.sin(i * 0.07) * 0.1, 0];
            sky.update(i * 0.25, i ? 0.25 : 0, { eye, sunFlat: SUN_FLAT });
            sky.bubbleAt(0, sky.time, sky.air, place);
            const [[row, film]] = bubbleRows(sky);
            if (!(place.shown > 0.001)) {
                expect(film.z).toBe(0);
                continue;
            }
            seen += 1;
            const away = Math.hypot(place.x - eye[0], place.y - eye[1], place.z - eye[2]);
            expect(row.x).toBeCloseTo((place.x - eye[0]) / away, 12);
            expect(row.y).toBeCloseTo((place.y - eye[1]) / away, 12);
            expect(row.z).toBeCloseTo((place.z - eye[2]) / away, 12);
            expect(row.w).toBeCloseTo(place.r / away, 12);
            expect(film.z).toBeCloseTo(place.shown, 12);
            // Over the sea, out in front, and it is a thing with a size.
            expect(place.y).toBeGreaterThan(0);
            expect(place.z).toBeLessThan(0);
            expect(place.r).toBeGreaterThan(0);
        }
        expect(seen).toBeGreaterThan(100);
    });

    it('lets a bubble come and go slowly: neither its light nor its size steps between two frames', () => {
        const { sky } = make({}, 0);
        sky.happeningsOn = false;
        let before = litBubbles(sky);
        let step = 0;
        let swell = 0;
        let seen = 0;
        const watch = () => {
            const now = litBubbles(sky);
            step = Math.max(step, lightStep(before, now));
            for (const [key, bubble] of now) {
                const was = before.get(key);
                // (once it is there to be seen: its size from one frame to the next)
                if (was && was.light > 0.3) swell = Math.max(swell, Math.abs(bubble.radius - was.radius) / was.radius);
            }
            seen = Math.max(seen, now.size);
            before = now;
        };
        // Through an air's rest, its melt into the next, and a level's step.
        const frames = Math.round((AIR_SECONDS * 1.6) / DT);
        for (let i = 1; i <= frames; i++) {
            if (i === Math.round(frames * 0.5)) sky.setLevel(2);
            sky.update(i * DT, DT, FRAME);
            watch();
        }
        expect(seen).toBeGreaterThan(1);
        // A bubble's fastest change is its own end, a third of a second long: never a frame's.
        expect(step).toBeLessThan(0.15);
        expect(swell).toBeLessThan(0.1);
        // A train's bubbles come up as slowly, and go as slowly when their time is up.
        const train = make({}, 5).sky;
        train.happeningsOn = false;
        before = litBubbles(train);
        const alone = lit(train);
        step = 0;
        let most = 0;
        train.happen('bubbles', 6);
        run(train, 60, () => {
            const now = litBubbles(train);
            step = Math.max(step, lightStep(before, now));
            most = Math.max(most, now.size);
            before = now;
        });
        expect(most).toBeGreaterThan(alone);
        expect(step).toBeLessThan(0.15);
    });

    // Found 2026-11-25: a train is one clock (`train.t0`). The next 'bubbles' happening restarted
    // it, and the bubbles of the one still rising were gone between two frames at full light. Two
    // happenings can fall `period - jitter` apart, and a train lives longer than that: the next
    // one now waits its turn.
    it('does not cut a rising train short when the next one starts', () => {
        const { sky } = make({}, 30);
        const twin = make({}, 30).sky;
        for (const s of [sky, twin]) s.happeningsOn = false;
        sky.happen('bubbles', 3);
        let before = litBubbles(sky);
        let step = 0;
        const watch = () => {
            const now = litBubbles(sky);
            step = Math.max(step, lightStep(before, now));
            before = now;
        };
        const gap = HAPPENINGS.period - HAPPENINGS.jitter;
        run(sky, gap, watch);
        run(twin, gap);
        // (the first train is still up there)
        expect(lit(sky)).toBeGreaterThan(lit(twin));
        sky.happen('bubbles', 9);
        run(sky, 3, watch);
        expect(step).toBeLessThan(0.15);
    });

    it('bursts the bubbles a four-line clear\'s ring reaches: each gone in a third of a second, with one pop', () => {
        const { sky, bursts } = make({}, 60);
        sky.happeningsOn = false;
        sky.airHold = indexOfMost('bubbles');
        sky.happen('bubbles', 4);
        run(sky, 12);
        const out = litBubbles(sky);
        expect(out.size).toBeGreaterThan(2);
        expect(kinds(bursts, 'pop')).toHaveLength(0);
        const t0 = sky.time;
        sky.impact(-10, -23);
        const lastWhole = new Map([...out.keys()].map((key) => [key, t0]));
        const goneAt = new Map();
        run(sky, 6, () => {
            const now = litBubbles(sky);
            for (const [key, was] of out) {
                const here = now.get(key);
                if (here && here.light >= was.light * 0.9 && !goneAt.has(key)) lastWhole.set(key, sky.time);
                if (!here && !goneAt.has(key)) goneAt.set(key, sky.time);
            }
            const wrong = problem(sky);
            if (wrong) throw new Error(`t=${sky.time}: ${wrong}`);
        });
        // Every one of them is gone, quickly once the ring is on it, the far ones later than the near.
        for (const key of out.keys()) {
            expect(goneAt.has(key), key).toBe(true);
            expect(goneAt.get(key) - lastWhole.get(key), key).toBeLessThan(0.35);
        }
        const times = [...goneAt.values()];
        expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(DT);
        // One burst of fine drops for each, where it was, as large as it was.
        const pops = kinds(bursts, 'pop');
        expect(pops.length).toBeGreaterThanOrEqual(out.size);
        expect(pops.length).toBeLessThanOrEqual(sky.bubbleCount);
        expect(new Set(pops.map((pop) => `${pop.x}/${pop.y}/${pop.z}`)).size).toBe(pops.length);
        for (const pop of pops) {
            expect([pop.x, pop.y, pop.z, ...pop.color].every(Number.isFinite)).toBe(true);
            expect(pop.power).toBeGreaterThan(0);
            expect(pop.y).toBeGreaterThan(0);
            expect(pop.at).toBeGreaterThan(t0);
        }
        // They do not come back while the ring is still running, and the next ones come in slowly.
        let before = litBubbles(sky);
        let step = 0;
        const popped = pops.length;
        run(sky, 30, () => {
            const now = litBubbles(sky);
            for (const key of out.keys()) expect(now.has(key)).toBe(false);
            step = Math.max(step, lightStep(before, now));
            before = now;
        });
        expect(step).toBeLessThan(0.15);
        expect(kinds(bursts, 'pop').length).toBe(popped); // the ring has passed: nothing more bursts
        // No ring, no burst: a level's front and a perfect clear leave them be.
        const calm = make({}, 60);
        calm.sky.levelUp();
        calm.sky.perfect();
        calm.sky.answer();
        run(calm.sky, 6);
        expect(kinds(calm.bursts, 'pop')).toHaveLength(0);
    });

    // Found 2026-11-25: reset() forgot which bubbles the ring burst (`popped`), so a new run (or
    // a run's end) a few seconds after a four-line clear put every one of them back between two
    // frames, at full size and light.
    it('does not bring burst bubbles back in one frame when a new run starts', () => {
        const { sky } = make({}, 60);
        sky.happeningsOn = false;
        sky.airHold = indexOfMost('bubbles');
        run(sky, 1);
        const was = litBubbles(sky);
        expect(was.size).toBeGreaterThan(2);
        sky.impact(-10, -23);
        run(sky, 6);
        // (every one the ring reached is gone; a new one may be coming in, slowly)
        for (const key of was.keys()) expect(litBubbles(sky).has(key), key).toBe(false);
        const before = litBubbles(sky);
        const { time } = sky;
        // (as the world does it: the session's reset, then the next frame on the same clock)
        sky.reset();
        sky.update(time + DT, DT, FRAME);
        expect(lightStep(before, litBubbles(sky))).toBeLessThan(0.15);
    });
});

describe('fluid dreams sky: what happens by itself', () => {
    /** Record every happening the sky fires, with the time it fired. */
    const record = (sky) => {
        const fired = [];
        const happen = sky.happen.bind(sky);
        sky.happen = (kind, seed) => {
            fired.push({ kind, seed, at: sky.time });
            return happen(kind, seed);
        };
        return fired;
    };

    it('names the happening of a slot by a hash: the same every time, inside its slot, every kind in turn', () => {
        expect(HAPPENINGS.jitter).toBeLessThan(HAPPENINGS.period);
        expect(HAPPENINGS.jitter).toBeGreaterThanOrEqual(0);
        const count = {};
        for (let i = 0; i < 400; i++) {
            const h = happeningOf(i);
            expect(happeningOf(i)).toEqual(h);
            expect(HAPPENINGS.kinds).toContain(h.kind);
            const start = HAPPENINGS.lead + i * HAPPENINGS.period;
            expect(h.at, `slot ${i}`).toBeGreaterThanOrEqual(start);
            expect(h.at, `slot ${i}`).toBeLessThan(start + HAPPENINGS.jitter + 1e-9);
            expect(Number.isInteger(h.seed) && h.seed > 0, `slot ${i}`).toBe(true);
            count[h.kind] = (count[h.kind] || 0) + 1;
        }
        // Every kind comes up, none crowds the rest out, and falling stars come up most.
        const kindsOf = [...new Set(HAPPENINGS.kinds)];
        for (const kind of kindsOf) expect(count[kind], kind).toBeGreaterThan(400 / kindsOf.length / 4);
        for (const kind of kindsOf.filter((name) => name !== 'star')) expect(count.star).toBeGreaterThan(count[kind]);
        // It does not run in a short loop: the first slots are not all alike.
        expect(new Set(Array.from({ length: 12 }, (_, i) => happeningOf(i).kind)).size).toBeGreaterThan(2);
        // It writes into what it is handed.
        const out = {};
        expect(happeningOf(3, out)).toBe(out);
        expect(out).toEqual(happeningOf(3));
    });

    it('fires each slot\'s happening once, as the clock passes it', () => {
        const { sky } = make({}, 0);
        const fired = record(sky);
        const slots = 8;
        run(sky, HAPPENINGS.lead + HAPPENINGS.period * slots);
        expect(fired).toHaveLength(slots);
        fired.forEach((happening, i) => {
            const want = happeningOf(i);
            expect(happening.kind, `slot ${i}`).toBe(want.kind);
            expect(happening.seed, `slot ${i}`).toBe(want.seed);
            // On the first frame at or after its time.
            expect(happening.at, `slot ${i}`).toBeGreaterThanOrEqual(want.at);
            expect(happening.at - want.at, `slot ${i}`).toBeLessThan(DT + 1e-9);
        });
        expect(problem(sky)).toBeNull();
        // In coarse frames too: once each, a frame late at most.
        const coarse = make({}, 0).sky;
        const few = record(coarse);
        for (let t = 0.5; t <= HAPPENINGS.lead + HAPPENINGS.period * slots; t += 0.5) coarse.update(t, 0.5, FRAME);
        expect(few.map((happening) => happening.kind)).toEqual(fired.map((happening) => happening.kind));
    });

    it('does not replay what began before a seek or a reset, and plays what comes after', () => {
        const slot = 3;
        const { at } = happeningOf(slot);
        const start = HAPPENINGS.lead + slot * HAPPENINGS.period;
        // Landing in a slot after its happening began: not on the frame it lands, not later.
        for (const time of [at + 0.01, at + 2, start + HAPPENINGS.period - 0.05]) {
            const sky = new FluidSky();
            const fired = record(sky);
            sky.seek(time);
            sky.update(time, 0, FRAME);
            expect(fired, `seek(${time})`).toHaveLength(0);
            run(sky, start + HAPPENINGS.period - time);
            expect(fired, `seek(${time})`).toHaveLength(0);
            // The next slot's comes when it is due.
            run(sky, HAPPENINGS.period);
            expect(fired.map((happening) => happening.kind), `seek(${time})`).toEqual([happeningOf(slot + 1).kind]);
        }
        // Landing in a slot before it began: it comes, once, when it is due.
        if (at - start > 0.2) {
            const sky = new FluidSky();
            const fired = record(sky);
            sky.seek(start + (at - start) * 0.5);
            sky.update(sky.time, 0, FRAME);
            expect(fired).toHaveLength(0);
            run(sky, HAPPENINGS.period - HAPPENINGS.jitter);
            expect(fired.map((happening) => happening.kind)).toEqual([happeningOf(slot).kind]);
        }
        // A new run on the same clock, just after one: it is not played a second time.
        const { sky } = make({}, at - 0.5);
        const fired = record(sky);
        run(sky, 1);
        expect(fired).toHaveLength(1);
        const { time } = sky;
        sky.reset();
        sky.update(time + DT, DT, FRAME);
        run(sky, 2);
        expect(fired).toHaveLength(1);
        // Before the first slot there is nothing to play, and the first comes when it is due.
        const early = make({}, 0).sky;
        const first = record(early);
        run(early, happeningOf(0).at - 0.1);
        expect(first).toHaveLength(0);
        run(early, 0.2);
        expect(first).toHaveLength(1);
    });

    it('holds its happenings back over a four-line clear, and when they are switched off', () => {
        const through = (prepare, frame = FRAME) => {
            const { sky, bursts } = make({}, happeningOf(0).at - 1);
            const fired = record(sky);
            prepare(sky);
            // across the first slot's time, and to the eve of the second's
            run(sky, 2, null, frame);
            return { sky, fired, bursts };
        };
        expect(through(() => {}).fired).toHaveLength(1);
        // A four-line clear is playing: nothing else happens meanwhile, and it is not made up for after.
        const busy = through(() => {}, { ...FRAME, busy: true });
        expect(busy.fired).toHaveLength(0);
        run(busy.sky, happeningOf(1).at - busy.sky.time - 0.5);
        expect(busy.fired).toHaveLength(0);
        run(busy.sky, 1);
        expect(busy.fired.map((happening) => happening.kind)).toEqual([happeningOf(1).kind]);
        // Switched off (a capture's still sky): none; switched on again, the next one comes.
        const off = through((sky) => {
            sky.happeningsOn = false;
        });
        expect(off.fired).toHaveLength(0);
        expect(off.bursts).toHaveLength(0);
        expect(off.sky.star.strength + off.sky.shoal.strength).toBe(0);
        off.sky.happeningsOn = true;
        run(off.sky, happeningOf(1).at - off.sky.time + 0.5);
        expect(off.fired.map((happening) => happening.kind)).toEqual([happeningOf(1).kind]);
    });

    it('lets a star fall: a unit head moving across the sky, lit for a moment and gone', () => {
        const { sky, bursts } = make();
        expect(sky.star.strength).toBe(0);
        expect(sky.happen('star', 7)).toBe('star');
        const heads = [];
        let lasted = 0;
        run(sky, 4, () => {
            if (!(sky.star.strength > 0)) return;
            lasted = sky.time - 10;
            expect(unit(...sky.star.head)).toBe(true);
            expect(unit(...sky.star.along)).toBe(true);
            expect(sky.star.length).toBeGreaterThan(0);
            heads.push([...sky.star.head]);
        });
        expect(heads.length).toBeGreaterThan(10);
        expect(lasted).toBeLessThan(3);
        expect(sky.star.strength).toBe(0);
        // It travels the way it says it does, and it falls.
        const first = heads[0];
        const last = heads[heads.length - 1];
        const moved = last.map((v, i) => v - first[i]);
        expect(Math.hypot(...moved)).toBeGreaterThan(0.05);
        expect(moved[0] * sky.star.along[0] + moved[1] * sky.star.along[1] + moved[2] * sky.star.along[2]).toBeGreaterThan(0);
        expect(last[1]).toBeLessThan(first[1]);
        expect(first[1]).toBeGreaterThan(0);
        expect(bursts).toHaveLength(0);
        // The same seed, the same star; another seed, another.
        const start = (seed) => {
            const again = make().sky;
            again.happen('star', seed);
            run(again, 0.3);
            return [...again.star.head];
        };
        expect(start(7)).toEqual(start(7));
        expect(start(7)).not.toEqual(start(8));
    });

    it('passes a shoal of light under the surface, from one side of the sea to the other', () => {
        const { sky } = make();
        sky.happen('shoal', 7);
        const path = [];
        let last = 0;
        let step = 0;
        run(sky, 25, () => {
            step = Math.max(step, Math.abs(sky.shoal.strength - last));
            last = sky.shoal.strength;
            if (sky.shoal.strength > 0) path.push({ ...sky.shoal });
        });
        expect(path.length).toBeGreaterThan(60);
        expect(Math.max(...path.map((p) => p.strength))).toBeGreaterThan(0.5);
        expect(step).toBeLessThan(0.05); // it swims in and out of sight
        expect(sky.shoal.strength).toBe(0);
        for (const p of path) {
            expect(p.radius).toBeGreaterThan(0);
            expect(p.z).toBeLessThan(0); // in the sea in front of the eye
        }
        // It crosses in front of the board.
        expect(Math.sign(path[0].x)).toBe(-Math.sign(path[path.length - 1].x));
    });

    it('sinks a far form into the sea and brings it up again, the others untouched', () => {
        const { sky } = make();
        const twin = make().sky;
        const own = farRows(sky).map(([place]) => place.w);
        sky.happen('sink', 7);
        const least = own.map(() => Infinity);
        let step = 0;
        let before = own.slice();
        run(sky, 30, () => {
            // (the twin on the very same clock: a clock summed frame by frame drifts in its last bits)
            twin.update(sky.time, DT, FRAME);
            farRows(sky).forEach(([place], i) => {
                least[i] = Math.min(least[i], place.w);
                step = Math.max(step, Math.abs(place.w - before[i]) / own[i]);
                before[i] = place.w;
            });
        });
        const sunk = least.map((w, i) => w < own[i] * 0.5);
        expect(sunk.filter(Boolean)).toHaveLength(1);
        const index = sunk.indexOf(true);
        // All but gone, never to nothing (the liquid divides by it), and never in a jump.
        expect(least[index]).toBeGreaterThan(0);
        expect(least[index]).toBeLessThan(own[index] * 0.2);
        expect(step).toBeLessThan(0.05);
        // It is back, as large as it was, where it stood; it went down as it shrank.
        const rows = farRows(sky);
        const twins = farRows(twin);
        expect(rows[index][0].w).toBeCloseTo(own[index], 12);
        expect(rows[index][0].y).toBeCloseTo(twins[index][0].y, 12);
        rows.forEach(([place, shape], i) => {
            if (i === index) return;
            expect(least[i]).toBe(own[i]);
            expect([place.x, place.y, place.z, place.w, shape.x, shape.y, shape.z]).toEqual(
                [twins[i][0].x, twins[i][0].y, twins[i][0].z, twins[i][0].w, twins[i][1].x, twins[i][1].y, twins[i][1].z],
            );
        });
        expect(problem(sky)).toBeNull();
    });

    it('throws a fountain far out on the sea, in the colour it is handed', () => {
        const { sky, bursts } = make();
        sky.fountainTint = [0.2, 0.9, 0.6];
        sky.happen('fountain', 7);
        const pulses = kinds(bursts, 'fountain');
        expect(pulses.length).toBeGreaterThan(0);
        pulses.forEach((pulse, i) => {
            expect(pulse.color).toEqual([0.2, 0.9, 0.6]);
            expect(pulse.power).toBeGreaterThan(0);
            // The same place, one pulse after another.
            expect([pulse.x, pulse.z]).toEqual([pulses[0].x, pulses[0].z]);
            if (i > 0) expect(pulse.delay).toBeGreaterThan(pulses[i - 1].delay || 0);
            // Far out, in front of the eye.
            expect(pulse.z).toBeLessThan(0);
            expect(Math.hypot(pulse.x, pulse.z)).toBeGreaterThan(40);
            expect(pulse.y).toBeGreaterThanOrEqual(0);
        });
        // With no colour handed over it still has one, and with nobody to throw it nothing breaks.
        const plain = make();
        plain.sky.happen('fountain', 7);
        expect(kinds(plain.bursts, 'fountain')[0].color.every(Number.isFinite)).toBe(true);
        const mute = new FluidSky();
        expect(() => mute.happen('fountain', 7)).not.toThrow();
        // Another seed, another place.
        const other = make();
        other.sky.happen('fountain', 8);
        expect([kinds(other.bursts, 'fountain')[0].x, kinds(other.bursts, 'fountain')[0].z]).not.toEqual([pulses[0].x, pulses[0].z]);
    });

    it('sends a train of bubbles up out of the sea, and they are gone in the end', () => {
        const { sky } = make({}, 5);
        const twin = make({}, 5).sky;
        for (const s of [sky, twin]) s.happeningsOn = false;
        sky.happen('bubbles', 7);
        let more = 0;
        let longest = 0;
        run(sky, 70, () => {
            twin.update(sky.time, DT, FRAME);
            const extra = lit(sky) - lit(twin);
            more = Math.max(more, extra);
            if (extra > 0) longest = sky.time - 5;
            expect(extra).toBeGreaterThanOrEqual(0);
        });
        expect(more).toBeGreaterThan(0);
        expect(more).toBeLessThanOrEqual(sky.bubbleCount);
        // They rise for a good while (longer than the shortest gap between two happenings)...
        expect(longest).toBeGreaterThan(HAPPENINGS.period - HAPPENINGS.jitter);
        // ...and then the sky is as it would have been.
        expect(longest).toBeLessThan(65);
        expect(look(sky)).toEqual(look(twin));
        // A tier with no bubbles has no train either.
        const none = make({ bubbles: 0 }).sky;
        none.happen('bubbles', 7);
        run(none, 5, () => expect(lit(none)).toBe(0));
        expect(problem(none)).toBeNull();
    });
});

describe('fluid dreams sky: its share of play', () => {
    const flare = (sky) => Math.max(...farRows(sky).map(([, shape]) => shape.w));

    it('opens a front of light from the sun on a new level, and lets the ink race', () => {
        const { sky } = make();
        const twin = make().sky;
        expect(sky.front.strength).toBe(0);
        sky.levelUp();
        let radius = 0;
        let peak = 0;
        let step = 0;
        let last = 0;
        let lit = 0;
        let lasted = 0;
        run(sky, 8, () => {
            run(twin, DT);
            step = Math.max(step, Math.abs(sky.front.strength - last));
            last = sky.front.strength;
            lit = Math.max(lit, flare(sky));
            if (!(sky.front.strength > 0)) return;
            lasted = sky.time - 10;
            // It only opens.
            expect(sky.front.radius).toBeGreaterThan(radius);
            expect(sky.front.width).toBeGreaterThan(0);
            radius = sky.front.radius;
            peak = Math.max(peak, sky.front.strength);
        });
        expect(peak).toBeGreaterThan(0);
        expect(step).toBeLessThan(peak * 0.25); // it opens fast, but it is not switched on
        expect(lasted).toBeGreaterThan(1);
        expect(lasted).toBeLessThan(8);
        expect(sky.front.strength).toBe(0);
        // The far forms light as it reaches them; the ink ran ahead of its own clock.
        expect(lit).toBeGreaterThan(0);
        expect(flare(sky)).toBe(0);
        expect(sky.skyClock).toBeGreaterThan(twin.skyClock);
        expect(problem(sky)).toBeNull();
    });

    it('stands a pillar of light on the crater of a four-line clear and drives a ring through the ink', () => {
        const eye = [0.4, 2.3, 0];
        const frame = { eye, sunFlat: SUN_FLAT };
        const play = (boost) => {
            const { sky } = make();
            sky.impact(12, -30, boost);
            const seen = {
                pillar: 0, shock: 0, flare: 0, lasted: 0, radius: 0,
            };
            run(sky, 8, () => {
                seen.flare = Math.max(seen.flare, flare(sky));
                if (sky.pillar.strength > 0) {
                    // Its bearing: the unit way from the eye to the crater, over the sea.
                    const away = Math.hypot(12 - eye[0], -30 - eye[2]);
                    expect(sky.pillar.x).toBeCloseTo((12 - eye[0]) / away, 12);
                    expect(sky.pillar.z).toBeCloseTo((-30 - eye[2]) / away, 12);
                    expect(sky.pillar.width).toBeGreaterThan(0);
                    seen.pillar = Math.max(seen.pillar, sky.pillar.strength);
                }
                if (sky.shock.strength > 0) {
                    // The ring only opens.
                    expect(sky.shock.radius).toBeGreaterThan(seen.radius);
                    seen.radius = sky.shock.radius;
                    seen.shock = Math.max(seen.shock, sky.shock.strength);
                    seen.lasted = sky.time - 10;
                }
            }, frame);
            expect(sky.pillar.strength).toBe(0);
            expect(sky.shock.strength).toBe(0);
            expect(flare(sky)).toBe(0);
            expect(problem(sky)).toBeNull();
            return seen;
        };
        const plain = play(0);
        const boosted = play(1);
        expect(plain.pillar).toBeGreaterThan(0);
        expect(plain.shock).toBeGreaterThan(0);
        expect(plain.flare).toBeGreaterThan(0);
        expect(plain.lasted).toBeGreaterThan(1);
        expect(plain.lasted).toBeLessThan(8);
        // A second four-line clear on its way down makes the pillar brighter.
        expect(boosted.pillar).toBeGreaterThan(plain.pillar);
    });

    it('lights every far form on a back-to-back, from the moment the kin answer', () => {
        const { sky } = make();
        sky.answer(0.5);
        let early = 0;
        run(sky, 0.4, () => {
            early = Math.max(early, flare(sky));
        });
        expect(early).toBe(0);
        run(sky, 0.6);
        farRows(sky).forEach(([, shape], i) => expect(shape.w, `form ${i}`).toBeGreaterThan(0));
        const lit = flare(sky);
        // A second one while they are lit adds to it.
        const twin = make().sky;
        twin.answer(0.5);
        run(twin, 1);
        sky.answer();
        for (let i = 0; i < 60; i++) {
            run(sky, DT);
            run(twin, DT);
            expect(flare(sky)).toBeGreaterThanOrEqual(flare(twin) - 1e-12);
        }
        expect(flare(sky)).toBeGreaterThan(flare(twin));
        expect(lit).toBeGreaterThan(0);
        run(sky, 30);
        expect(flare(sky)).toBe(0);
    });

    it('draws the ink back on a perfect clear: the stars come out, the sun wears two rings, and it passes', () => {
        const { sky } = make();
        sky.airHold = 0; // (the air stands still, so what moves is the perfect clear's)
        run(sky, DT);
        const rest = {
            halo: sky.halo, cover: sky.cover, strata: sky.strata, starGain: sky.starGain,
        };
        expect([sky.halo2, sky.clearing, sky.moteSurge]).toEqual([0, 0, 0]);
        // Told ahead (the sea turns to glass once the crown has gone up): nothing before its time.
        sky.perfect(sky.time + 1);
        run(sky, 0.9);
        expect([sky.halo, sky.halo2, sky.clearing, sky.cover]).toEqual([rest.halo, 0, 0, rest.cover]);
        const peak = { halo: 0, halo2: 0, clearing: 0, cover: Infinity };
        let step = 0;
        let last = 0;
        run(sky, 6, () => {
            peak.halo = Math.max(peak.halo, sky.halo);
            peak.halo2 = Math.max(peak.halo2, sky.halo2);
            peak.clearing = Math.max(peak.clearing, sky.clearing);
            peak.cover = Math.min(peak.cover, sky.cover);
            step = Math.max(step, Math.abs(sky.halo2 - last));
            last = sky.halo2;
            expect(sky.starGain).toBeGreaterThanOrEqual(rest.starGain);
            expect(sky.strata).toBeLessThanOrEqual(rest.strata);
            expect(sky.cover).toBeGreaterThanOrEqual(0);
        });
        expect(peak.halo).toBeGreaterThan(rest.halo);
        expect(peak.halo2).toBeGreaterThan(0);
        expect(peak.clearing).toBeGreaterThan(0);
        expect(peak.clearing).toBeLessThanOrEqual(1);
        expect(peak.cover).toBeLessThan(rest.cover);
        expect(step).toBeLessThan(peak.halo2 * 0.1); // the rings open, they are not switched on
        // A second one while the first is lit holds it up: it only adds.
        const twin = make().sky;
        twin.airHold = 0;
        run(twin, DT);
        twin.perfect(twin.time + 1);
        run(twin, 6.9);
        sky.perfect();
        for (let i = 0; i < 120; i++) {
            run(sky, DT);
            run(twin, DT);
            expect(sky.halo2).toBeGreaterThanOrEqual(twin.halo2 - 1e-12);
            expect(sky.cover).toBeLessThanOrEqual(twin.cover + 1e-12);
        }
        expect(sky.halo2).toBeGreaterThan(twin.halo2);
        // And it passes: the air's own sky again.
        run(sky, 80);
        expect([sky.halo2, sky.clearing, sky.moteSurge]).toEqual([0, 0, 0]);
        expect(sky.halo).toBe(rest.halo);
        expect(sky.cover).toBe(rest.cover);
        expect(sky.strata).toBe(rest.strata);
        expect(sky.starGain).toBe(rest.starGain);
    });

    it('turns the ink over a twist\'s funnel by as much as the funnel is wound', () => {
        const { sky } = make();
        expect(sky.swirl.angle).toBe(0);
        let previous = 0;
        for (const env of [0.1, 0.4, 0.8, 1.3]) {
            sky.setTwist(env, -10, 9, -23);
            run(sky, DT);
            expect(sky.swirl.angle, `wound ${env}`).toBeGreaterThan(previous);
            expect(sky.swirl.radius).toBeGreaterThan(0);
            expect([sky.swirl.x, sky.swirl.z].every(Number.isFinite)).toBe(true);
            previous = sky.swirl.angle;
        }
        // Over the funnel: on the side of the sky the funnel is on.
        expect(Math.sign(sky.swirl.x)).toBe(-1);
        expect(Math.sign(sky.swirl.z)).toBe(-1);
        const left = sky.swirl.x;
        sky.setTwist(1.3, 14, 9, -23);
        run(sky, DT);
        expect(sky.swirl.x).toBeGreaterThan(left);
        // Unwound, the ink lies still.
        sky.setTwist(0, -10, 9, -23);
        run(sky, DT);
        expect(sky.swirl.angle).toBe(0);
        expect(problem(sky)).toBeNull();
    });

    it('is calmer under reduced motion: the ink turns less and runs slower, the sun wanders less, the far forms bob less', () => {
        const lively = make().sky;
        const calm = make().sky;
        calm.setReducedMotion(true);
        const span = () => ({ lo: Infinity, hi: -Infinity });
        const bob = [span(), span()];
        const sway = [0, 0];
        [lively, calm].forEach((sky, k) => {
            sky.setTwist(1, -10, 9, -23);
            run(sky, 120, () => {
                const [[place]] = farRows(sky);
                bob[k].lo = Math.min(bob[k].lo, place.y);
                bob[k].hi = Math.max(bob[k].hi, place.y);
                sway[k] = Math.max(sway[k], Math.abs(sky.sun.sway));
            });
            expect(problem(sky)).toBeNull();
        });
        expect(calm.swirl.angle).toBeGreaterThan(0);
        expect(calm.swirl.angle).toBeLessThan(lively.swirl.angle);
        expect(calm.skyClock).toBeLessThan(lively.skyClock);
        expect(calm.skyClock).toBeGreaterThan(10); // slower, not stopped
        expect(sway[1]).toBeLessThan(sway[0]);
        expect(bob[1].hi - bob[1].lo).toBeLessThan(bob[0].hi - bob[0].lo);
        // The sun's height is the hour's and the air's: it does not depend on the setting.
        expect(calm.sun.height).toBe(lively.sun.height);
        // Only `true` asks for it.
        calm.setReducedMotion('yes');
        expect(calm.reducedMotion).toBe(false);
    });

    it('ends every event of play on a reset, lets what the sky does by itself play out, and keeps the clock\'s turns', () => {
        const { sky, bursts } = make({}, 30);
        // (only the happenings asked for below: one the clock brings would sink another form meanwhile)
        sky.happeningsOn = false;
        sky.setLevel(2);
        sky.levelUp();
        sky.impact(-10, -23, 1);
        sky.perfect();
        sky.answer();
        sky.setTwist(1, -10, 9, -23);
        for (const kind of new Set(HAPPENINGS.kinds)) sky.happen(kind, 5);
        run(sky, 0.6);
        expect(sky.front.strength).toBeGreaterThan(0);
        expect(sky.pillar.strength).toBeGreaterThan(0);
        expect(sky.shock.strength).toBeGreaterThan(0);
        expect(sky.star.strength).toBeGreaterThan(0);
        expect(sky.shoal.strength).toBeGreaterThan(0);
        expect(sky.swirl.angle).toBeGreaterThan(0);
        expect(sky.halo2).toBeGreaterThan(0);
        const { time, skyClock } = sky;
        const air = { ...sky.air };
        const height = sky.sun.height;
        bursts.length = 0;
        const sinking = farRows(sky).findIndex(([place], i) => place.w < FAR_FORMS[i][2] * DEG * 0.999);
        let star = sky.star.strength;
        let shoal = sky.shoal.strength;
        sky.reset();
        // What play started ends at once, for what is read before the next frame...
        expect([sky.front.strength, sky.pillar.strength, sky.shock.strength, sky.swirl.angle]).toEqual([0, 0, 0, 0]);
        // ...and on the next frame, and on every frame after it: nothing is left to replay. What the
        // sky does by itself (a falling star, a shoal, a sinking form) is not play's: a new run does
        // not cut it off between two frames; it plays out and ends by itself.
        let seen = 0;
        let jump = 0;
        sky.update(time + DT, DT, FRAME);
        run(sky, 16, () => {
            seen = Math.max(
                seen,
                sky.front.strength,
                sky.pillar.strength,
                sky.shock.strength,
                sky.swirl.angle,
                sky.halo2,
                sky.clearing,
                ...farRows(sky).map(([, shape]) => shape.w),
            );
            jump = Math.max(jump, Math.abs(sky.star.strength - star), Math.abs(sky.shoal.strength - shoal));
            star = sky.star.strength;
            shoal = sky.shoal.strength;
            farRows(sky).forEach(([place], i) => {
                if (i !== sinking) expect(place.w).toBeCloseTo(FAR_FORMS[i][2] * DEG, 12);
            });
        });
        expect(seen).toBe(0);
        expect(jump).toBeLessThan(0.25);
        expect([sky.star.strength, sky.shoal.strength]).toEqual([0, 0]);
        if (sinking >= 0) expect(farRows(sky)[sinking][0].w).toBeCloseTo(FAR_FORMS[sinking][2] * DEG, 12);
        expect(kinds(bursts, 'pop')).toHaveLength(0);
        expect(problem(sky)).toBeNull();
        // The clock's turns are not events: the ink's clock ran on, the air and the sun went on from where they were.
        expect(sky.skyClock).toBeGreaterThan(skyClock);
        expect(sky.level).toBe(2);
        const fresh = make({}, 30).sky;
        fresh.setLevel(2);
        run(fresh, 0.6);
        fresh.update(time + DT, DT, FRAME);
        run(fresh, 16);
        for (const key of AIR_KEYS) expect(sky.air[key], key).toBeCloseTo(fresh.air[key], 9);
        expect(Math.abs(sky.sun.height - height)).toBeLessThan((SUN.high - SUN.low) * 0.2);
        expect(Object.keys(air)).toEqual(Object.keys(sky.air));
    });

    it('replays a frame: seek, then the same events and steps, gives the same sky whatever came before', () => {
        const script = (sky) => {
            sky.levelUp();
            run(sky, 1.5);
            sky.impact(-10, -24, 0.5);
            sky.setTwist(0.7, -10, 9, -24);
            run(sky, 2);
            sky.perfect(sky.time + 0.4);
            sky.answer(0.2);
            sky.happen('bubbles', 5);
            sky.happen('sink', 8);
            sky.happen('star', 2);
            sky.setTwist(0, -10, 9, -24);
            run(sky, 9);
        };
        const a = make();
        const b = make();
        script(a.sky);
        script(b.sky);
        const first = look(a.sky);
        expect(first.length).toBeGreaterThan(SKY_ROWS * 4);
        expect(look(b.sky)).toEqual(first);
        expect(b.bursts).toEqual(a.bursts);
        expect(a.bursts.length).toBeGreaterThan(0);
        // Something else entirely in between...
        a.sky.setReducedMotion(true);
        a.sky.setLevel(4);
        a.sky.happen('shoal', 3);
        a.sky.impact(5, -40);
        run(a.sky, 40);
        a.sky.setReducedMotion(false);
        // ...then a capture's recipe: seek, the first level, the same events, the same steps.
        a.bursts.length = 0;
        a.sky.seek(10);
        a.sky.setLevel(1, true);
        a.sky.update(10, 0, FRAME);
        script(a.sky);
        expect(look(a.sky)).toEqual(first);
        expect(a.bursts).toEqual(b.bursts);
        // The same air, named the same (the phase may stand a whole turn of the wheel off).
        expect(a.sky.getState().air).toBe(b.sky.getState().air);
        expect((a.sky.getState().airPhase - b.sky.getState().airPhase) % AIRS.length).toBeCloseTo(0, 9);
        // A held frame is the same frame.
        for (let i = 0; i < 4; i++) a.sky.update(a.sky.time, 0, FRAME);
        expect(look(a.sky)).toEqual(first);
    });
});
