import { describe, expect, it } from 'vitest';
import {
    VERDANT_HILLS_STILL_MOTION, createVerdantHillsWorn, wearVerdantHillsFrame,
} from '../../src/themes/verdant-hills/verdant-hills-surge.js';
import { VerdantHillsReactions } from '../../src/themes/verdant-hills/verdant-hills-reactions.js';

const LIGHT = ['warmth', 'glow', 'shimmer', 'shafts'];
const LIVING = ['flock', 'flutter', 'height', 'whirl', 'heat', 'streamers'];
const MOVING = ['wind', 'gust', 'flock', 'flutter'];

function seededRandom(seed = 41) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** A reactions frame with these envelopes and this much heat. */
function frameOf(values = {}, surge = {}, still = 0) {
    return {
        epoch: 1,
        settled: false,
        wind: 0.2,
        gust: 0.1,
        warmth: 0.1,
        glow: 0.1,
        shimmer: 0.1,
        shafts: 0.1,
        flock: 0.1,
        flutter: 0.1,
        height: 0.1,
        whirl: 0,
        heat: 0,
        streamers: 0,
        festival: 0,
        aloft: 2,
        streak: 1,
        front: null,
        fronts: [],
        sunbreak: null,
        kites: new Float32Array(7),
        kiteTug: new Float32Array(7),
        waves: [],
        streaks: [],
        emitters: [],
        ...values,
        surge: {
            level: 0, fever: 0, stage: 0, punch: 0, ...surge,
        },
        still,
    };
}

describe('Verdant Hills: the day builds with play', () => {
    it('leaves calm and casual play exactly as the reactions asked', () => {
        for (const level of [0, 0.1, 0.18]) {
            const frame = frameOf({}, { level });
            const worn = wearVerdantHillsFrame(frame);
            for (const key of [...LIGHT, ...LIVING, 'wind']) expect(worn[key], `${key} @${level}`).toBe(frame[key]);
            expect(worn.gust).toBeCloseTo(frame.gust, 12);
            expect(worn).toMatchObject({
                gale: 0, iris: 0, saturation: 0, coverShift: 0, feed: 1, motion: 1,
            });
            // What it carries through is the frame's own.
            for (const key of ['kites', 'kiteTug', 'waves', 'streaks', 'emitters', 'fronts']) {
                expect(worn[key], key).toBe(frame[key]);
            }
        }
    });

    it('never lowers what the reactions asked for, however hot play runs', () => {
        const random = seededRandom(7);
        for (let trial = 0; trial < 200; trial++) {
            const values = Object.fromEntries([...LIGHT, ...LIVING, 'gust'].map((key) => [key, random()]));
            const frame = frameOf(values, { level: random(), fever: random(), punch: random() });
            const worn = wearVerdantHillsFrame(frame);
            for (const key of [...LIGHT, ...LIVING, 'gust']) {
                expect(worn[key], key).toBeGreaterThanOrEqual(frame[key] - 1e-12);
                expect(worn[key], key).toBeLessThanOrEqual(1);
            }
        }
    });

    it('builds act by act: warm, then hot, then the fever, each further than the last', () => {
        const acts = [
            { level: 0.1, fever: 0 },
            { level: 0.4, fever: 0 },
            { level: 0.75, fever: 0 },
            { level: 0.95, fever: 0.9 },
        ].map((surge) => ({ ...wearVerdantHillsFrame(frameOf({}, surge)) }));
        for (let act = 1; act < acts.length; act++) {
            for (const key of ['warmth', 'shimmer', 'flutter', 'height', 'iris']) {
                expect(acts[act][key], `${key} act ${act}`).toBeGreaterThan(acts[act - 1][key]);
            }
        }
        // The whirl keeps turning between clears once play is hot, and stands tall in a fever.
        expect(acts[1].whirl).toBe(0);
        expect(acts[2].whirl).toBeGreaterThan(0.1);
        expect(acts[3].whirl).toBeGreaterThan(0.75);
        expect(acts[3].streamers).toBe(1);
        expect(acts[3].heat).toBeGreaterThan(0.5);
        // The fever's own: a gale past the dial, the seed fed thicker, the cumulus thinned, the grade richer.
        expect(acts[2].gale).toBeLessThan(acts[3].gale);
        expect(acts[3].feed).toBeGreaterThan(1.5);
        expect(acts[3].coverShift).toBeLessThan(-0.05);
        expect(acts[3].saturation).toBeGreaterThan(acts[2].saturation);
        // The iris closes as the light builds, a little.
        expect(acts[3].iris).toBeLessThan(0.12);
    });

    it('calms what moves under Reduce motion, and leaves the light to build', () => {
        const values = {
            wind: 0.8, gust: 0.6, flock: 0.7, flutter: 0.5,
        };
        const surge = { level: 0.9, fever: 0.8 };
        const moving = { ...wearVerdantHillsFrame(frameOf(values, surge, 0)) };
        const still = { ...wearVerdantHillsFrame(frameOf(values, surge, 1)) };
        expect(still.motion).toBe(VERDANT_HILLS_STILL_MOTION);
        for (const key of [...MOVING, 'gale']) {
            expect(still[key], key).toBeCloseTo(moving[key] * VERDANT_HILLS_STILL_MOTION, 12);
        }
        for (const key of [...LIGHT, 'height', 'iris', 'saturation']) expect(still[key], key).toBe(moving[key]);
        // Half way there, half the calm.
        const halfway = wearVerdantHillsFrame(frameOf(values, surge, 0.5)).motion;
        expect(halfway).toBeCloseTo(1 - (1 - VERDANT_HILLS_STILL_MOTION) / 2, 12);
    });

    it('fills one object frame after frame, and takes junk as rest', () => {
        const worn = createVerdantHillsWorn();
        expect(wearVerdantHillsFrame(frameOf(), worn)).toBe(worn);
        expect(wearVerdantHillsFrame(frameOf({}, { level: 0.9, fever: 1 }), worn)).toBe(worn);
        const junks = [undefined, null, {}, { surge: null }, { surge: { level: NaN, fever: 'hot' }, still: Infinity }];
        for (const junk of junks) {
            const out = wearVerdantHillsFrame(junk, createVerdantHillsWorn());
            for (const [key, value] of Object.entries(out)) {
                if (typeof value === 'number') expect(Number.isFinite(value), key).toBe(true);
            }
            expect(out).toMatchObject({ gale: 0, feed: 1, settled: false });
        }
    });

    it('reads a real chain hotter than its first clear, and lets the day breathe back afterwards', () => {
        const reactions = new VerdantHillsReactions({ rng: seededRandom(3) });
        const worn = createVerdantHillsWorn();
        const read = () => ({ ...wearVerdantHillsFrame(reactions.getFrame(), worn) });
        const step = (seconds) => {
            for (let frame = 0; frame < Math.round(seconds * 60); frame++) reactions.update(1 / 60);
        };
        const chain = [];
        for (let clear = 0; clear < 12; clear++) {
            reactions.onHardDrop({ distance: 16 });
            reactions.onPieceLock({
                piece: {
                    x: 4, y: 20, shape: [[1]], shapeKey: 'TJLOSZI'[clear % 7],
                },
            });
            reactions.onLineClear(1 + (clear % 3), { clearedRows: [22] });
            step(0.64);
            chain.push(read());
        }
        const [first, last] = [chain[0], chain.at(-1)];
        for (const key of ['warmth', 'shimmer', 'whirl', 'height', 'gale', 'iris']) {
            expect(last[key], key).toBeGreaterThan(first[key]);
        }
        step(15);
        const rested = read();
        expect(rested.gale).toBeLessThan(0.01);
        expect(rested.iris).toBeLessThan(0.01);
        expect(rested.whirl).toBe(0);
    });
});
