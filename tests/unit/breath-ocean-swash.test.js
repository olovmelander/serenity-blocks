import { describe, expect, it } from 'vitest';
import { resolveBreath } from '../../src/ui/effects/breathing/breath-clock.js';
import { NATURAL_PATTERN } from '../../src/ui/effects/breathwork-session-manager.js';
import { createSwash } from '../../src/ui/effects/breathing/worlds/ocean.js';

const FPS = 60;
const KEYS = ['bore', 'lace', 'out', 'incoming'];

/**
 * Ocean Tide's swash stepped at 60 Hz through `cycles` breaths of `pattern`, one record per frame.
 * The first breath is left out: by then the swash runs as it does in a practice.
 */
function swashThrough(pattern, cycles = 3) {
    const swash = createSwash();
    const cycle = pattern.reduce((sum, seconds) => sum + seconds, 0);
    const frames = [];
    for (let i = 0; i <= cycles * cycle * FPS; i++) {
        const { phase, progress } = resolveBreath(pattern, i / FPS);
        swash.update(1 / FPS, phase, progress);
        if (i >= cycle * FPS) {
            frames.push({
                phase, progress, bore: swash.bore, lace: swash.lace, out: swash.out, incoming: swash.incoming,
            });
        }
    }
    return frames;
}

/** Does the out-breath begin at frame `i`? (The spent bore moves out to the break there, unseen.) */
const outBreathBegins = (frames, i) => frames[i].phase === 2 && frames[i - 1].phase !== 2;

// The technique's own pattern, the Hale Tide's long ebb, and the natural pace of its rest stages
// (a pause at both ends).
describe.each([[[4, 0, 4, 0]], [[4, 0, 6, 0]], [[...NATURAL_PATTERN]]])('Ocean Tide swash, breathing %j', (pattern) => {
    const frames = swashThrough(pattern);

    it('never jumps from one frame to the next, nor kicks into motion, at a turn of the breath', () => {
        for (const key of KEYS) {
            for (let i = 2; i < frames.length; i++) {
                if (key === 'incoming' && (outBreathBegins(frames, i) || outBreathBegins(frames, i - 1))) continue;
                const step = frames[i][key] - frames[i - 1][key];
                const before = frames[i - 1][key] - frames[i - 2][key];
                // A step past 0.05 in a 60 Hz frame reads as a jump; a change of pace past 0.015 as a
                // kick (a follower that sets off at full speed when its target steps lands near 0.05).
                expect(Math.abs(step), `${key} at frame ${i}`).toBeLessThan(0.05);
                expect(Math.abs(step - before), `${key} at frame ${i}`).toBeLessThan(0.015);
            }
        }
    });

    it('moves the bore out to the break only once its white water is spent', () => {
        let jumps = 0;
        for (let i = 1; i < frames.length; i++) {
            if (!outBreathBegins(frames, i)) continue;
            jumps += 1;
            expect(frames[i].incoming).toBe(1);
            expect(frames[i].bore).toBeLessThan(0.025);
        }
        expect(jumps).toBe(2);
    });

    it('lets the wave that rolled in give way with the uprush, not on the turn', () => {
        // Out-breath look: whole at the turn, gone by the middle of the in-breath, and changing far
        // more slowly in the in-breath's first tenth (the water still turning) than at its fastest.
        const inhale = frames.filter((frame) => frame.phase === 0);
        const first = inhale.find((frame) => frame.progress > 0);
        expect(first.out).toBeGreaterThan(0.99);
        expect(inhale.find((frame) => frame.progress >= 0.5).out).toBeLessThan(0.1);
        const pace = (lo, hi) => {
            let fastest = 0;
            for (let i = 1; i < frames.length; i++) {
                const { phase, progress } = frames[i];
                if (phase === 0 && frames[i - 1].phase === 0 && progress > lo && progress <= hi) {
                    fastest = Math.max(fastest, Math.abs(frames[i].out - frames[i - 1].out));
                }
            }
            return fastest;
        };
        expect(pace(0, 0.1)).toBeLessThan(pace(0, 1) / 2);
    });
});

describe('Ocean Tide swash, a fresh world', () => {
    it('starts where the breath is, as a pinned frame does: nothing glides in', () => {
        for (const [phase, progress] of [[0, 0], [0, 0.4], [1, 0.5], [2, 0.3], [3, 0.6]]) {
            const live = createSwash();
            live.update(1 / FPS, phase, progress);
            const pinned = createSwash();
            pinned.update(0, phase, progress);
            for (const key of KEYS) expect(live[key], `${key} at phase ${phase}`).toBe(pinned[key]);
        }
    });
});
