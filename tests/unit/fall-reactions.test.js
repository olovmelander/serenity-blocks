import { describe, expect, it } from 'vitest';
import { FALL_REACTION_LIMITS, FallReactions } from '../../src/themes/fall/fall-reactions.js';

function seededRandom(seed = 187) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function create(quality = 'High') {
    return new FallReactions({ quality, rng: seededRandom() });
}

function expectBounded(frame) {
    for (const key of ['gust', 'warmth', 'shafts', 'glow', 'vortex']) {
        expect(Number.isFinite(frame[key])).toBe(true);
        expect(frame[key]).toBeGreaterThanOrEqual(0);
        expect(frame[key]).toBeLessThanOrEqual(1);
    }
    for (const burst of frame.bursts) {
        expect(burst.active).toBe(true);
        expect(burst.age).toBeGreaterThanOrEqual(0);
        expect(burst.age).toBeLessThan(burst.duration);
        expect(burst.progress).toBeGreaterThanOrEqual(0);
        expect(burst.progress).toBeLessThan(1);
        expect(burst.strength).toBeGreaterThan(0);
        expect(burst.strength).toBeLessThanOrEqual(1);
        expect(burst.seed).toBeGreaterThanOrEqual(0);
        expect(burst.seed).toBeLessThan(1);
        expect([-1, 1]).toContain(burst.side);
        expect(burst.originX).toBeGreaterThanOrEqual(0);
        expect(burst.originX).toBeLessThanOrEqual(1);
    }
}

describe('Fall reaction director', () => {
    it('uses the required fixed slot budget for every quality tier', () => {
        expect(FALL_REACTION_LIMITS).toEqual({
            Minimal: 4, Low: 6, Medium: 8, High: 12, Ultra: 14, Extreme: 16,
        });
        for (const [quality, capacity] of Object.entries(FALL_REACTION_LIMITS)) {
            const reactions = create(quality);
            reactions.onPieceLock();
            expect(reactions.maxBursts).toBe(capacity);
            expect(reactions.burstSlots).toHaveLength(capacity);
            expect(reactions.frame.bursts).toHaveLength(1);
            expectBounded(reactions.frame);
        }
        expect(create('low').quality).toBe('Low');
        expect(create('Med').quality).toBe('Medium');
        expect(create('invalid').quality).toBe('High');
    });

    it('keeps locks gentle and reserves shafts and spirals for achievements', () => {
        const reactions = create();
        reactions.onPieceLock();
        expect(reactions.frame.bursts[0]).toMatchObject({ kind: 'lock', strength: 0.24, age: 0 });
        expect(reactions.frame.gust).toBeGreaterThan(0);
        expect(reactions.frame.gust).toBeLessThan(0.2);
        expect(reactions.frame.shafts).toBe(0);
        expect(reactions.frame.vortex).toBe(0);
    });

    it('uses viewport origin before piece coordinates and clamps malformed origins safely', () => {
        const reactions = create();
        reactions.onPieceLock({ viewportOrigin: { x: 0.1 }, piece: { x: 8 } });
        reactions.onPieceLock({ piece: { x: 8 } });
        reactions.onPieceLock({ detail: { viewportOrigin: { x: 5 } } });
        reactions.onPieceLock({ piece: { x: -100 } });
        expect(reactions.frame.bursts.map((burst) => burst.side)).toEqual([-1, 1, 1, -1]);
        expect(reactions.frame.bursts.map((burst) => burst.originX)).toEqual([0.1, 0.85, 1, 0]);
        reactions.onPieceLock({ viewportOrigin: { x: NaN }, piece: { x: Infinity } });
        expectBounded(reactions.frame);
    });

    it('makes a bilateral golden clear wave and scales all lighting from one line to Tetris', () => {
        const single = create();
        const tetris = create();
        single.onLineClear(1);
        tetris.onLineClear(4);
        expect(single.frame.bursts.map((burst) => burst.side)).toEqual([-1, 1]);
        expect(tetris.frame.bursts.map((burst) => burst.side)).toEqual([-1, 1, -1, 1]);
        expect(tetris.frame.bursts.every((burst) => burst.kind === 'clear')).toBe(true);
        for (const key of ['gust', 'warmth', 'shafts', 'glow']) {
            expect(tetris.frame[key]).toBeGreaterThan(single.frame[key]);
        }
        expect(tetris.frame.bursts[0].strength).toBeGreaterThan(single.frame.bursts[0].strength);
        single.update(0.5);
        expect(single.frame.bursts[0].progress).toBeGreaterThan(0);
        expectBounded(single.frame);
    });

    it('makes combo two distinct and grows bilateral cascades beyond combo seven', () => {
        const frames = [2, 3, 7, 8, 14, 60].map((count) => {
            const reactions = create();
            reactions.onCombo(count);
            return reactions.frame;
        });
        expect(frames[0].vortex).toBeGreaterThan(0.24);
        expect(frames[0].bursts.map((burst) => burst.side)).toEqual([-1, 1]);
        for (let index = 1; index < frames.length; index++) {
            for (const key of ['gust', 'warmth', 'shafts', 'glow', 'vortex']) {
                expect(frames[index][key]).toBeGreaterThan(frames[index - 1][key]);
            }
        }
        for (const frame of frames) {
            expect(frame.bursts.filter((burst) => burst.side === -1)).toHaveLength(frame.bursts.length / 2);
            expect(frame.bursts.every((burst) => burst.kind === 'combo')).toBe(true);
            expectBounded(frame);
        }
    });

    it('ignores zero and single combos without disturbing an existing clear response', () => {
        const reactions = create();
        reactions.onLineClear(2);
        const before = reactions.frame;
        for (const count of [0, 1, '0', '1', 1.99]) expect(reactions.onCombo(count)).toBe(false);
        expect(reactions.frame).toEqual(before);
    });

    it('rejects malformed counts without throwing or exciting envelopes', () => {
        const reactions = create();
        for (const count of [NaN, Infinity, -Infinity, -5, 0, 0.8, '', ' ', 'garbage', null,
            false, true, [], [4], {}, { lineCount: [] }, Symbol('count'), 4n]) {
            expect(reactions.onLineClear(count)).toBe(false);
            expect(reactions.onCombo(count)).toBe(false);
        }
        expect(reactions.frame).toEqual({
            gust: 0, warmth: 0, shafts: 0, glow: 0, vortex: 0, bursts: [],
        });
    });

    it('accepts wrapped bus payloads and numeric strings while capping oversized counts', () => {
        const fromPayload = create();
        const fromCount = create();
        fromPayload.onLineClear({ detail: { lineCount: '999', viewportOrigin: { x: 0.2 } } });
        fromPayload.onCombo({ detail: { comboCount: '999', viewportOrigin: { x: 0.2 } } });
        fromCount.onLineClear(4, { viewportOrigin: { x: 0.2 } });
        fromCount.onCombo(60, { viewportOrigin: { x: 0.2 } });
        expect(fromPayload.frame).toEqual(fromCount.frame);
        expectBounded(fromPayload.frame);
    });

    it('advances envelopes and burst ages identically at 30, 60 and 144 Hz', () => {
        const frames = [30, 60, 144].map((fps) => {
            const reactions = create();
            reactions.onPieceLock();
            reactions.onLineClear(4);
            for (let frame = 0; frame < fps / 2; frame++) reactions.update(1 / fps);
            reactions.onCombo(8);
            for (let frame = 0; frame < fps; frame++) reactions.update(1 / fps);
            return reactions.frame;
        });
        const reference = frames[0];
        for (const frame of frames.slice(1)) {
            for (const key of ['gust', 'warmth', 'shafts', 'glow', 'vortex']) {
                expect(frame[key]).toBeCloseTo(reference[key], 10);
            }
            expect(frame.bursts.map((burst) => burst.id)).toEqual(reference.bursts.map((burst) => burst.id));
            frame.bursts.forEach((burst, index) => {
                expect(burst.age).toBeCloseTo(reference.bursts[index].age, 10);
                expect(burst.progress).toBeCloseTo(reference.bursts[index].progress, 10);
                expect(burst.seed).toBe(reference.bursts[index].seed);
            });
        }
    });

    it('keeps event storms bounded and reuses every preallocated slot', () => {
        for (const quality of Object.keys(FALL_REACTION_LIMITS)) {
            const reactions = create(quality);
            const storage = reactions.burstSlots;
            const slots = [...storage];
            for (let event = 0; event < 100; event++) {
                reactions.onPieceLock();
                reactions.onLineClear(4);
                reactions.onCombo(60);
                if (event % 5 === 0) reactions.update(0.016);
                expect(reactions.frame.bursts.length).toBeLessThanOrEqual(reactions.maxBursts);
                expectBounded(reactions.frame);
            }
            expect(reactions.burstSlots).toBe(storage);
            slots.forEach((slot, index) => expect(reactions.burstSlots[index]).toBe(slot));
            reactions.update(30);
            expect(reactions.frame.bursts).toHaveLength(0);
            expect(reactions.frame).toMatchObject({
                gust: 0, warmth: 0, shafts: 0, glow: 0, vortex: 0,
            });
        }
    });

    it('reclaims the oldest burst before a fresher one when the pool is full', () => {
        const reactions = create('Minimal');
        reactions.onPieceLock();
        reactions.update(0.3);
        for (let index = 0; index < 3; index++) reactions.onPieceLock();
        const freshSeeds = reactions.frame.bursts.slice(1).map((burst) => burst.seed);
        reactions.onPieceLock();
        expect(reactions.frame.bursts[0].age).toBe(0);
        expect(reactions.frame.bursts.slice(1).map((burst) => burst.seed)).toEqual(freshSeeds);
    });

    it('ignores invalid or negative timesteps and only advances on explicit simulation updates', () => {
        const reactions = create();
        reactions.onCombo(10);
        const before = reactions.frame;
        for (const dt of [NaN, Infinity, -1, 0, null, '0.5', Symbol('dt')]) reactions.update(dt);
        expect(reactions.time).toBe(0);
        expect(reactions.frame).toEqual(before);
        reactions.update(5);
        expect(reactions.time).toBe(5);
        expect(reactions.frame.bursts).toHaveLength(0);
    });

    it('protects internal state from returned snapshot mutations', () => {
        const reactions = create();
        reactions.onLineClear(4);
        const expected = reactions.frame;
        const snapshot = reactions.update(0);
        snapshot.gust = 100;
        snapshot.bursts[0].strength = 100;
        snapshot.bursts[0].side = 0;
        snapshot.bursts.length = 0;
        expect(reactions.getFrame()).toEqual(expected);
    });

    it('resets in place and leaves disposed directors inert until explicitly reset', () => {
        const reactions = create();
        const storage = reactions.burstSlots;
        const { envelopes } = reactions;
        reactions.onLineClear(4);
        reactions.onCombo(8);
        reactions.update(0.3);
        reactions.reset();
        expect(reactions.burstSlots).toBe(storage);
        expect(reactions.envelopes).toBe(envelopes);
        expect(reactions.time).toBe(0);
        expect(reactions.frame).toEqual({
            gust: 0, warmth: 0, shafts: 0, glow: 0, vortex: 0, bursts: [],
        });
        reactions.onCombo(8);
        reactions.dispose();
        expect(reactions.onPieceLock()).toBe(false);
        expect(reactions.onLineClear(4)).toBe(false);
        expect(reactions.onCombo(8)).toBe(false);
        reactions.update(1);
        expect(reactions.time).toBe(0);
        expect(reactions.frame.bursts).toHaveLength(0);
        reactions.reset();
        expect(reactions.onPieceLock()).toBe(true);
    });

    it('keeps malformed RNG values bounded and reproduces the same seeded choreography', () => {
        for (const value of [NaN, Infinity, -1, 2, 'bad', Symbol('seed')]) {
            const reactions = new FallReactions({ rng: () => value });
            reactions.onCombo(60);
            expectBounded(reactions.frame);
        }
        const a = create();
        const b = create();
        for (const reactions of [a, b]) {
            reactions.onPieceLock();
            reactions.onLineClear(4);
            reactions.update(0.1);
            reactions.onCombo(8);
            reactions.update(0.25);
        }
        expect(a.frame).toEqual(b.frame);
    });
});
