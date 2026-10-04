import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    STELLAR_DRIFT_COMET_CONTACT,
    STELLAR_DRIFT_REACTION_LIMITS,
    StellarDriftReactions,
} from '../../src/themes/stellar-drift/stellar-drift-reactions.js';

const CHANNELS = ['rim', 'aurora', 'dust', 'stars', 'glow', 'impact'];

function seededRandom(seed = 187) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function create(quality = 'High') {
    return new StellarDriftReactions({ quality, rng: seededRandom() });
}

function advanceTo(reactions, target, hz) {
    while (reactions.time < target - 1e-12) {
        reactions.update(Math.min(1 / hz, target - reactions.time));
    }
}

function expectBounded(reactions) {
    const { frame } = reactions;
    for (const key of CHANNELS) {
        expect(Number.isFinite(frame[key])).toBe(true);
        expect(frame[key]).toBeGreaterThanOrEqual(0);
        expect(frame[key]).toBeLessThanOrEqual(1);
    }
    expect(frame.arcs.length).toBeLessThanOrEqual(reactions.maxArcs);
    expect(frame.comets.length).toBeLessThanOrEqual(reactions.maxComets);
    expect(reactions.pendingEvents.length).toBeLessThanOrEqual(reactions.maxQueuedEvents);
    for (const slot of [...frame.arcs, ...frame.comets]) {
        expect(slot.age).toBeGreaterThanOrEqual(0);
        expect(slot.age).toBeLessThan(slot.duration);
        expect(slot.progress).toBeGreaterThanOrEqual(0);
        expect(slot.progress).toBeLessThan(1);
        expect(slot.angle).toBeGreaterThanOrEqual(0);
        expect(slot.angle).toBeLessThan(Math.PI * 2);
        expect([1, -1]).toContain(slot.direction);
        expect(slot.seed).toBeGreaterThanOrEqual(0);
        expect(slot.seed).toBeLessThan(1);
    }
}

function expectSameFrame(actual, expected) {
    for (const channel of CHANNELS) expect(actual[channel]).toBeCloseTo(expected[channel], 10);
    for (const group of ['arcs', 'comets']) {
        expect(actual[group]).toHaveLength(expected[group].length);
        for (let index = 0; index < expected[group].length; index++) {
            const a = actual[group][index];
            const b = expected[group][index];
            for (const key of ['id', 'kind', 'direction', 'impacted']) expect(a[key]).toBe(b[key]);
            for (const key of ['angle', 'seed', 'duration', 'strength', 'progress', 'age']) {
                expect(a[key]).toBeCloseTo(b[key], 10);
            }
            if (group === 'comets') expect(a.impactAge).toBeCloseTo(b.impactAge, 10);
        }
    }
}

afterEach(() => vi.useRealTimers());

describe('Stellar Drift orbital reaction director', () => {
    it.each(Object.entries(STELLAR_DRIFT_REACTION_LIMITS))('bounds %s tier feedback', (quality, limits) => {
        const reactions = create(quality);
        reactions.onPieceLock();
        expect(reactions.arcSlots).toHaveLength(limits.arcs);
        expect(reactions.cometSlots).toHaveLength(limits.comets);
        expect(reactions.frame.arcs).toHaveLength(1);
        expect(reactions.frame.arcs[0].kind).toBe('lock');
        expect(reactions.frame.rim).toBeGreaterThan(0);
        expect(reactions.frame.dust).toBeGreaterThan(0);
        expect(reactions.frame.aurora).toBe(0);
        expect(reactions.frame.impact).toBe(0);
        expectBounded(reactions);
        reactions.onCombo(10);
        reactions.update(0.6);
        expect(reactions.frame.comets).toHaveLength(limits.comets === 4 ? 3 : limits.comets);
        expect(reactions.frame.aurora).toBeGreaterThan(0);
        expectBounded(reactions);
    });

    it('prioritizes the on-screen lock origin over scrolling-board coordinates', () => {
        const reactions = new StellarDriftReactions({ rng: () => 0.5 });
        reactions.onPieceLock({ detail: { piece: { x: 8, y: 900 }, viewportOrigin: { x: 0.1, y: 0.9 } } });
        reactions.onPieceLock({ piece: { x: 8, y: 900 } });
        const [left, right] = reactions.frame.arcs;
        expect(Math.cos(left.angle)).toBeLessThan(-0.8);
        expect(Math.cos(right.angle)).toBeGreaterThan(0.8);
    });

    it.each(['lineCount', 'lines', 'linesCleared', 'count'])('accepts %s clear aliases', (alias) => {
        const numeric = create();
        const wrapped = create();
        const origin = { viewportOrigin: { x: 0.2 } };
        numeric.onLineClear(4, origin);
        wrapped.onLineClear({ detail: { [alias]: '4', ...origin } });
        numeric.update(0.5);
        wrapped.update(0.5);
        expectSameFrame(wrapped.frame, numeric.frame);
    });

    it.each(['comboCount', 'combo', 'count'])('accepts numeric and wrapped %s combo payloads', (alias) => {
        const numeric = create();
        const wrapped = create();
        numeric.onCombo(7);
        wrapped.onCombo({ detail: { [alias]: 7 } });
        numeric.update(1.8);
        wrapped.update(1.8);
        expectSameFrame(wrapped.frame, numeric.frame);
    });

    it('ignores malformed counts without coercing arbitrary objects or booleans', () => {
        const reactions = create();
        const valueOf = vi.fn(() => 9);
        for (const count of [null, undefined, NaN, Infinity, -3, 0, '', 'bad', true, [], { valueOf }]) {
            expect(reactions.onLineClear({ lineCount: count })).toBe(false);
            expect(reactions.onCombo({ comboCount: count })).toBe(false);
        }
        expect(reactions.onCombo(1)).toBe(false);
        expect(valueOf).not.toHaveBeenCalled();
        expect(reactions.frame.arcs).toHaveLength(0);
        expect(reactions.frame.comets).toHaveLength(0);
        expect(CHANNELS.map((key) => reactions.frame[key])).toEqual(CHANNELS.map(() => 0));
        expect(reactions.onLineClear()).toBe(true);
    });

    it('gives a single clear an arc and Tetris an opposing pair with stronger illumination', () => {
        const single = create();
        const tetris = create();
        single.onLineClear(1);
        tetris.onLineClear(4);
        single.update(0.3);
        tetris.update(0.3);
        expect(single.frame.arcs).toHaveLength(1);
        expect(tetris.frame.arcs).toHaveLength(2);
        expect(tetris.frame.arcs.map((arc) => arc.direction)).toEqual([1, -1]);
        expect(tetris.frame.rim).toBeGreaterThan(single.frame.rim);
        expect(tetris.frame.dust).toBeGreaterThan(single.frame.dust);
        expect(tetris.frame.comets).toHaveLength(0);
    });

    it('scales aurora and comet strength continuously above combo seven', () => {
        const frames = [2, 7, 8, 14, 60].map((count) => {
            const reactions = create();
            reactions.onCombo(count);
            return reactions.frame;
        });
        for (let index = 1; index < frames.length; index++) {
            expect(frames[index].aurora).toBeGreaterThan(frames[index - 1].aurora);
            expect(frames[index].rim).toBeGreaterThan(frames[index - 1].rim);
            expect(frames[index].comets[0].strength).toBeGreaterThan(frames[index - 1].comets[0].strength);
        }
        expect(frames[0].comets).toHaveLength(1);
        expect(frames[0].impact).toBe(0);
    });

    it('pulses once when a comet reaches the planetary limb at 72% of its lifetime', () => {
        const reactions = create();
        reactions.onCombo(2);
        const comet = reactions.frame.comets[0];
        const contact = comet.duration * STELLAR_DRIFT_COMET_CONTACT;
        reactions.update(contact - 1e-6);
        expect(reactions.frame.impact).toBe(0);
        expect(reactions.frame.comets[0].impacted).toBe(false);
        reactions.update(1e-6);
        expect(reactions.frame.impact).toBeCloseTo(comet.strength * 0.7, 10);
        expect(reactions.frame.comets[0].impacted).toBe(true);
        expect(reactions.frame.comets[0].impactAge).toBeCloseTo(0, 10);
        reactions.update(0.2);
        expect(reactions.frame.impact).toBeCloseTo(comet.strength * 0.7 * Math.exp(-3.6 * 0.2), 10);
        expect(reactions.frame.comets[0].impactAge).toBeCloseTo(0.2, 10);
    });

    it('preserves launches, contacts, retirement and decay at 30, 60 and 144 Hz', () => {
        const snapshots = [30, 60, 144].map((hz) => {
            const reactions = create();
            reactions.onCombo(9);
            advanceTo(reactions, 0.65, hz);
            reactions.onLineClear({ lineCount: 4, viewportOrigin: { x: 0.1 } });
            advanceTo(reactions, 1.15, hz);
            reactions.onPieceLock({ piece: { x: 8 } });
            advanceTo(reactions, 1.8, hz);
            const firstContact = reactions.frame;
            advanceTo(reactions, 2.4, hz);
            const laterContact = reactions.frame;
            advanceTo(reactions, 8, hz);
            return [firstContact, laterContact, reactions.frame];
        });
        for (let phase = 0; phase < 3; phase++) {
            expectSameFrame(snapshots[1][phase], snapshots[0][phase]);
            expectSameFrame(snapshots[2][phase], snapshots[0][phase]);
        }
        expect(snapshots[0][0].impact).toBeGreaterThan(0);
        expect(snapshots[0][1].impact).toBeGreaterThan(0);
        expect(snapshots[0][2].arcs).toHaveLength(0);
        expect(snapshots[0][2].comets).toHaveLength(0);
    });

    it('handles a large elapsed-time step without missing staggered contact events', () => {
        const oneStep = create();
        const manySteps = create();
        oneStep.onCombo(12);
        manySteps.onCombo(12);
        oneStep.update(2.4);
        advanceTo(manySteps, 2.4, 144);
        expectSameFrame(oneStep.frame, manySteps.frame);
    });

    it('keeps a mixed event storm within every tier without replacing slot objects', () => {
        for (const quality of Object.keys(STELLAR_DRIFT_REACTION_LIMITS)) {
            const reactions = create(quality);
            const arcs = reactions.arcSlots.slice();
            const comets = reactions.cometSlots.slice();
            for (let index = 0; index < 200; index++) {
                reactions.onPieceLock();
                reactions.onLineClear((index % 4) + 1);
                reactions.onCombo((index % 20) + 2);
                reactions.update(1 / 144);
                expectBounded(reactions);
            }
            expect(reactions.arcSlots).toEqual(arcs);
            expect(reactions.cometSlots).toEqual(comets);
            for (let index = 0; index < arcs.length; index++) expect(reactions.arcSlots[index]).toBe(arcs[index]);
            for (let index = 0; index < comets.length; index++) expect(reactions.cometSlots[index]).toBe(comets[index]);
        }
    });

    it('cycles replacement across a full arc pool when lifetimes are tied', () => {
        const reactions = create('Minimal');
        for (let index = 0; index < reactions.maxArcs; index++) reactions.onPieceLock();
        const seeds = reactions.arcSlots.map((slot) => slot.seed);
        reactions.onPieceLock();
        expect(reactions.arcSlots[0].seed).not.toBe(seeds[0]);
        expect(reactions.arcSlots[1].seed).toBe(seeds[1]);
        reactions.onPieceLock();
        expect(reactions.arcSlots[1].seed).not.toBe(seeds[1]);
        expect(reactions.arcSlots[2].seed).toBe(seeds[2]);
    });

    it('freezes all delayed launches and contact pulses while its owner stops advancing', () => {
        vi.useFakeTimers();
        const reactions = create();
        reactions.onCombo(10);
        reactions.update(0.1);
        const paused = reactions.frame;
        const queue = reactions.pendingEvents.slice();
        vi.advanceTimersByTime(60 * 60 * 1000);
        for (const delta of [0, -1, NaN, Infinity, undefined, '1']) reactions.update(delta);
        expectSameFrame(reactions.frame, paused);
        expect(reactions.pendingEvents).toEqual(queue);
        expect(vi.getTimerCount()).toBe(0);
        reactions.update(0.5);
        expect(reactions.frame.comets).toHaveLength(3);
        expect(reactions.frame.impact).toBe(0);
    });

    it('sanitizes random seeds and reset retires contacts and queued events without changing pools', () => {
        const reactions = new StellarDriftReactions({ quality: 'low', rng: () => NaN });
        const arcs = reactions.arcSlots;
        const firstArc = arcs[0];
        const comets = reactions.cometSlots;
        reactions.onCombo(10);
        reactions.update(1.8);
        expect(reactions.frame.impact).toBeGreaterThan(0);
        expect(reactions.frame.comets[0].seed).toBe(0.5);
        reactions.reset();
        reactions.dispose();
        expect(reactions.time).toBe(0);
        expect(reactions.arcSlots).toBe(arcs);
        expect(reactions.arcSlots[0]).toBe(firstArc);
        expect(reactions.cometSlots).toBe(comets);
        expect(reactions.pendingEvents).toHaveLength(0);
        expect(reactions.frame.arcs).toHaveLength(0);
        expect(reactions.frame.comets).toHaveLength(0);
        expect(CHANNELS.map((key) => reactions.frame[key])).toEqual(CHANNELS.map(() => 0));
    });
});
