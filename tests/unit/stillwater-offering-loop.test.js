import { describe, it, expect } from 'vitest';
import {
    createStillwaterOfferingLoop,
    STILLWATER_BEAT,
    STILLWATER_FEATURE,
    STILLWATER_RESPONSE,
    MIN_SEPARATION,
    MAX_INTIMACY,
    DAWN_CAP,
} from '../../src/themes/stillwater/sim/stillwater-offering-loop.js';

/** Deterministic RNG so beat jitter and deck shuffles are reproducible. */
function seededRandom(seed = 1) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function run(loop, seconds, step = 1 / 60, onFrame = null) {
    let last = null;
    for (let t = 0; t < seconds; t += step) {
        last = loop.update(step);
        if (onFrame) onFrame(last, t);
    }
    return last;
}

describe('Stillwater offering loop', () => {
    it('opens on a long REST so the first movement registers as an event', () => {
        const loop = createStillwaterOfferingLoop({ random: seededRandom(7) });
        const early = loop.update(1 / 60);
        expect(early.beat).toBe(STILLWATER_BEAT.REST);
        expect(early.beatDuration).toBeGreaterThanOrEqual(90);

        const stillResting = run(loop, 85);
        expect(stillResting.beat).toBe(STILLWATER_BEAT.REST);
    });

    it('walks the five beats in order', () => {
        const loop = createStillwaterOfferingLoop({ random: seededRandom(11) });
        const seen = [];
        run(loop, 260, 1 / 30, (state) => {
            if (seen[seen.length - 1] !== state.beat) seen.push(state.beat);
        });
        expect(seen.slice(0, 5)).toEqual([
            STILLWATER_BEAT.REST,
            STILLWATER_BEAT.NOTICE,
            STILLWATER_BEAT.APPROACH,
            STILLWATER_BEAT.OFFER,
            STILLWATER_BEAT.RETURN,
        ]);
    });

    it('never lets the two characters touch, and never over-commits intimacy', () => {
        const loop = createStillwaterOfferingLoop({ random: seededRandom(3) });
        let minSeparation = Infinity;
        let maxIntimacy = 0;
        run(loop, 900, 1 / 20, (state) => {
            minSeparation = Math.min(minSeparation, state.separation);
            maxIntimacy = Math.max(maxIntimacy, state.intimacy);
        });
        expect(minSeparation).toBeGreaterThanOrEqual(MIN_SEPARATION);
        expect(maxIntimacy).toBeLessThanOrEqual(MAX_INTIMACY + 1e-6);
    });

    it('withdraws more slowly than it reaches — the characterisation', () => {
        const loop = createStillwaterOfferingLoop({ random: seededRandom(5) });
        const samples = [];
        run(loop, 260, 1 / 60, (state) => {
            if (state.beat === STILLWATER_BEAT.OFFER) {
                samples.push({ age: state.beatAge, reach: state.reach });
            }
        });
        const peak = samples.find((s) => s.reach >= 0.999);
        expect(peak).toBeDefined();

        const rising = samples.filter((s) => s.age < peak.age && s.reach > 0.01 && s.reach < 0.99);
        const falling = samples.filter((s) => s.age > peak.age && s.reach > 0.01 && s.reach < 0.99);
        const riseSpan = rising[rising.length - 1].age - rising[0].age;
        const fallSpan = falling[falling.length - 1].age - falling[0].age;
        expect(fallSpan).toBeGreaterThan(riseSpan);
    });

    it('has her answer only after he has already given up', () => {
        const loop = createStillwaterOfferingLoop({ random: seededRandom(9) });
        let reachEnded = null;
        let answerBegan = null;
        run(loop, 260, 1 / 60, (state) => {
            if (state.beat !== STILLWATER_BEAT.OFFER) return;
            if (reachEnded === null && state.reach >= 0.999) reachEnded = false;
            if (reachEnded === false && state.reach <= 0.001) reachEnded = state.beatAge;
            if (answerBegan === null && state.spiritAnswer > 0.01) answerBegan = state.beatAge;
        });
        expect(reachEnded).toBeGreaterThan(0);
        expect(answerBegan).toBeGreaterThan(reachEnded);
    });

    it('features exactly one character at a time', () => {
        const loop = createStillwaterOfferingLoop({ random: seededRandom(13) });
        const tokens = new Set();
        run(loop, 300, 1 / 30, (state) => tokens.add(state.featureToken));
        for (const token of tokens) {
            expect([
                STILLWATER_FEATURE.NONE,
                STILLWATER_FEATURE.TROLL,
                STILLWATER_FEATURE.SPIRIT,
            ]).toContain(token);
        }
    });

    it('does not fire a response per line clear — it accumulates', () => {
        const loop = createStillwaterOfferingLoop({ random: seededRandom(17) });
        loop.update(1 / 60);
        for (let i = 0; i < 5; i += 1) loop.notifyGameplay('lineClear');
        expect(loop.isResponseArmed()).toBe(false);
    });

    it('holds a 45s refractory under adversarial input', () => {
        const loop = createStillwaterOfferingLoop({ random: seededRandom(23) });
        let fires = 0;
        let previous = null;
        run(loop, 40, 1 / 60, (state) => {
            loop.notifyGameplay('tetris');
            if (state.response && state.response !== previous) fires += 1;
            previous = state.response;
        });
        expect(fires).toBeLessThanOrEqual(1);
    });

    it('draws responses without replacement so none repeats back to back', () => {
        const loop = createStillwaterOfferingLoop({ random: seededRandom(29) });
        const fired = [];
        let previous = null;
        run(loop, 1200, 1 / 30, (state) => {
            loop.notifyGameplay('tetris');
            if (state.response && state.response !== previous) fired.push(state.response);
            previous = state.response;
        });
        expect(fired.length).toBeGreaterThan(2);
        for (let i = 1; i < fired.length; i += 1) {
            expect(fired[i]).not.toBe(fired[i - 1]);
        }
        for (const response of fired) expect(STILLWATER_RESPONSE).toContain(response);
    });

    it('advances a one-way dawn that never actually arrives', () => {
        const loop = createStillwaterOfferingLoop({ random: seededRandom(31) });
        const early = run(loop, 60, 1 / 10);
        const late = run(loop, 1800, 1 / 10);
        expect(late.dawn).toBeGreaterThan(early.dawn);
        expect(late.dawn).toBeLessThanOrEqual(DAWN_CAP);
        expect(late.dawn).toBeLessThan(1);
    });

    it('takes the approach away from him late in the session, then petrifies him', () => {
        const loop = createStillwaterOfferingLoop({ random: seededRandom(37) });
        run(loop, 1400, 1 / 10);
        const beatsAfterDawn = new Set();
        let petrifiedSeen = false;
        run(loop, 600, 1 / 10, (state) => {
            beatsAfterDawn.add(state.beat);
            if (state.petrified) petrifiedSeen = true;
        });
        expect(beatsAfterDawn.has(STILLWATER_BEAT.APPROACH)).toBe(false);
        expect(petrifiedSeen).toBe(true);
    });

    it('resets cleanly for a fresh session', () => {
        const loop = createStillwaterOfferingLoop({ random: seededRandom(41) });
        run(loop, 400, 1 / 20);
        loop.reset();
        const state = loop.update(1 / 60);
        expect(state.beat).toBe(STILLWATER_BEAT.REST);
        expect(state.dawn).toBeLessThan(0.01);
        expect(state.response).toBeNull();
    });
});
