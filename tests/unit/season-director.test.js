import { describe, expect, it } from 'vitest';

import { SeasonDirector } from '../../src/themes/summer/composition/season-director.js';

function directionSequence(director, count, poke = 'onHardDrop') {
    const out = [];
    for (let i = 0; i < count; i += 1) {
        director[poke]();
        out.push(director.breezeDir);
    }
    return out;
}

describe('SeasonDirector — deterministic gust direction', () => {
    it('produces an identical direction sequence for identical event streams', () => {
        const a = directionSequence(new SeasonDirector(), 24);
        const b = directionSequence(new SeasonDirector(), 24);
        expect(a).toEqual(b);
    });

    it('emits only ±1 and is not a constant', () => {
        const seq = directionSequence(new SeasonDirector(), 24);
        expect(seq.every((d) => d === 1 || d === -1)).toBe(true);
        expect(new Set(seq).size).toBe(2);
    });

    it('re-seeds on reset so the sequence reproduces', () => {
        const director = new SeasonDirector();
        const first = directionSequence(director, 8);
        director.reset();
        const second = directionSequence(director, 8);
        expect(second).toEqual(first);
    });
});

describe('SeasonDirector — allocation-free getState', () => {
    it('reuses one output buffer across calls', () => {
        const director = new SeasonDirector();
        const s1 = director.getState();
        const s2 = director.getState();
        expect(s1).toBe(s2);

        director.onCombo(4);
        director.update(0.1);
        const s3 = director.getState();
        expect(s3).toBe(s1);
        expect(s3.warmth).toBeGreaterThan(0);
    });

    it('writes into a caller-supplied object when given one', () => {
        const director = new SeasonDirector();
        director.onLineClear(4);
        director.update(0.05);
        const out = {};
        const result = director.getState(out);
        expect(result).toBe(out);
        expect(out.warmth).toBe(director.warmth);
        expect(out.breeze).toBe(director.breeze);
        expect(out.accent).toBe(director.accent);
        // The no-op bloom channel and the dead breezeDir bridge field are gone.
        expect('bloom' in out).toBe(false);
        expect('breezeDir' in out).toBe(false);
    });

    it('keeps the reused buffer pointed at the live accent after reset', () => {
        const director = new SeasonDirector();
        const s1 = director.getState();
        director.reset();
        const s2 = director.getState();
        expect(s2).toBe(s1);
        expect(s2.accent).toBe(director.accent);
    });
});

describe('SeasonDirector — reactive envelope sanity', () => {
    it('eases warmth upward on a combo bump', () => {
        const director = new SeasonDirector();
        const before = director.warmth;
        director.onCombo(4);
        director.update(0.1);
        expect(director.warmth).toBeGreaterThan(before);
    });

    it('zeroes transients when intensity is disabled', () => {
        const director = new SeasonDirector();
        director.onPerfectClear();
        director.setIntensity(0);
        expect(director.sparkle).toBe(0);
        expect(director.raise).toBe(0);
        expect(director.flare).toBe(0);
        expect(director.flowerBloom).toBe(0);
    });

    it('does not let a line clear double-count combo warmth (combo is onCombo’s job)', () => {
        const a = new SeasonDirector();
        a.onLineClear(2);
        const b = new SeasonDirector();
        b.onLineClear(2, 8); // any second arg is ignored now
        expect(b.target).toBe(a.target);
    });
});

describe('SeasonDirector — scene-symbiosis combo reactions', () => {
    it('maps combo counts to milestone tiers 2/4/7/10', () => {
        expect(SeasonDirector.comboTier(1)).toBe(0);
        expect(SeasonDirector.comboTier(2)).toBe(1);
        expect(SeasonDirector.comboTier(4)).toBe(2);
        expect(SeasonDirector.comboTier(7)).toBe(3);
        expect(SeasonDirector.comboTier(10)).toBe(4);
    });

    it('fires a sun-flare startle only when a NEW milestone is crossed', () => {
        const director = new SeasonDirector();
        director.onCombo(2);
        const afterFirst = director.flare;
        expect(afterFirst).toBeGreaterThan(0);
        // Same tier again → no fresh startle (flare does not grow).
        director.onCombo(3);
        expect(director.flare).toBeLessThanOrEqual(afterFirst + 1e-9);
        // Crossing into the next tier fires another startle.
        director.onCombo(4);
        expect(director.flare).toBeGreaterThan(afterFirst);
    });

    it('accumulates flowerBloom with a hold (never rewinds mid-chain)', () => {
        const director = new SeasonDirector();
        director.onCombo(7);
        const held = director.flowerBloom;
        expect(held).toBeGreaterThan(0);
        // A lower combo in the same read must not drop the bloom below the hold.
        director.onCombo(3);
        expect(director.flowerBloom).toBeGreaterThanOrEqual(held);
    });

    it('re-arms the milestone gate when the chain drops to zero', () => {
        const director = new SeasonDirector();
        director.onCombo(4);
        expect(director._comboTier).toBe(2);
        director.onCombo(0); // dropped chain
        expect(director._comboTier).toBe(0);
    });

    it('surfaces flare and flowerBloom through the reused state buffer', () => {
        const director = new SeasonDirector();
        director.onCombo(10);
        const s = director.getState();
        expect(s.flare).toBe(director.flare);
        expect(s.flowerBloom).toBe(director.flowerBloom);
    });
});
