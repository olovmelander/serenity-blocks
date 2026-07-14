import { describe, expect, it } from 'vitest';

import {
    REACTION_EVENT_DOMINANCE,
    SerenityWarpReactionDirector,
    accumulateComboBoost,
    decayScalar,
    easeToward,
    isComboChainBreak,
    pickDominantEvent,
} from '../../src/themes/serenity-warp/serenity-warp-reaction-director.js';

const FRAME = 1 / 60;

function advance(director, seconds) {
    const steps = Math.round(seconds / FRAME);
    for (let i = 0; i < steps; i += 1) director.update(FRAME);
    return director.getReactionState();
}

describe('reaction director pure helpers', () => {
    it('decays toward zero, frame-rate independent', () => {
        expect(decayScalar(1, 1, 1)).toBeCloseTo(Math.exp(-1), 5);
        expect(decayScalar(1, 0, 1)).toBe(1);
        // Two half-steps ≈ one full step (continuous decay).
        const oneStep = decayScalar(1, 0.2, 2);
        const twoHalf = decayScalar(decayScalar(1, 0.1, 2), 0.1, 2);
        expect(twoHalf).toBeCloseTo(oneStep, 6);
    });

    it('eases toward a target without overshoot', () => {
        expect(easeToward(0, 1, FRAME, 3.2)).toBeGreaterThan(0);
        expect(easeToward(0, 1, FRAME, 3.2)).toBeLessThan(1);
        expect(easeToward(0.5, 0.5, FRAME, 3.2)).toBe(0.5);
    });

    it('accumulate-and-holds combo energy (max, capped)', () => {
        expect(accumulateComboBoost(0.3, 5, 0.075, 0.62)).toBeCloseTo(0.375, 5);
        // A smaller live count cannot yank a higher held value down.
        expect(accumulateComboBoost(0.4, 2, 0.075, 0.62)).toBeCloseTo(0.4, 5);
        // Capped.
        expect(accumulateComboBoost(0, 100, 0.075, 0.62)).toBe(0.62);
    });

    it('detects a combo chain break (non-monotonic count)', () => {
        expect(isComboChainBreak(6, 2)).toBe(true);
        expect(isComboChainBreak(2, 6)).toBe(false);
        expect(isComboChainBreak(3, 3)).toBe(false);
    });

    it('picks the dominant event by the fixed ladder', () => {
        const picked = pickDominantEvent([
            { kind: 'combo' }, { kind: 'lineClear' }, { kind: 'pieceLock' },
        ]);
        expect(picked.kind).toBe('lineClear');
        expect(REACTION_EVENT_DOMINANCE.perfectClear).toBeGreaterThan(REACTION_EVENT_DOMINANCE.tspin);
        expect(pickDominantEvent([])).toBeNull();
    });
});

describe('SerenityWarpReactionDirector', () => {
    it('is fully identity (zero reaction) with no events', () => {
        const d = new SerenityWarpReactionDirector();
        const r = advance(d, 1);
        expect(r.surge).toBe(0);
        expect(r.bloom).toBe(0);
        expect(r.chroma).toBe(0);
    });

    it('produces a small surge on a lock, larger on a Tetris', () => {
        const lock = new SerenityWarpReactionDirector();
        lock.pulse('pieceLock');
        const lockR = { ...lock.update(FRAME) };

        const tetris = new SerenityWarpReactionDirector();
        tetris.pulse('lineClear', { lineCount: 4 });
        const tetrisR = { ...tetris.update(FRAME) };

        expect(lockR.surge).toBeGreaterThan(0);
        expect(tetrisR.surge).toBeGreaterThan(lockR.surge);
        expect(tetrisR.bloom).toBeGreaterThan(lockR.bloom);
    });

    it('accumulates and HOLDS combo energy — a repeated count re-raises after decay', () => {
        const d = new SerenityWarpReactionDirector();
        d.pulse('combo', { comboCount: 5 });
        d.update(FRAME);
        const peak = d.sCombo;
        expect(peak).toBeGreaterThan(0.3);

        advance(d, 0.5); // let it decay
        expect(d.sCombo).toBeLessThan(peak);

        d.pulse('combo', { comboCount: 5 }); // same live chain re-asserts
        d.update(FRAME);
        expect(d.sCombo).toBeGreaterThanOrEqual(peak - 1e-6);
    });

    it('resets combo energy on a chain break', () => {
        const d = new SerenityWarpReactionDirector();
        d.pulse('combo', { comboCount: 6 });
        d.update(FRAME);
        expect(d.sCombo).toBeGreaterThan(0.4);
        d.pulse('combo', { comboCount: 1 }); // 1 < 6 → new chain
        d.update(FRAME);
        expect(d.sCombo).toBeLessThan(0.2);
    });

    it('collapses simultaneous same-frame events to one dominant flare (no summing)', () => {
        const both = new SerenityWarpReactionDirector();
        both.pulse('lineClear', { lineCount: 1 });
        both.pulse('combo', { comboCount: 3 });
        both.update(FRAME);

        const clearOnly = new SerenityWarpReactionDirector();
        clearOnly.pulse('lineClear', { lineCount: 1 });
        clearOnly.update(FRAME);

        // The line-clear flare is not stacked on top of a second event's flare.
        expect(both.sFlare).toBeCloseTo(clearOnly.sFlare, 6);
    });

    it('perfect clear raises a persistent baseline that outlasts a plain clear', () => {
        const pc = new SerenityWarpReactionDirector();
        pc.pulse('perfectClear');
        advance(pc, 2); // flare (fast) is gone; baseline holds

        const plain = new SerenityWarpReactionDirector();
        plain.pulse('lineClear', { lineCount: 4 });
        advance(plain, 2);

        expect(pc.getReactionState().energy).toBeGreaterThan(plain.getReactionState().energy);
        expect(pc.getReactionState().energy).toBeGreaterThan(0.1);
    });

    it('decays back to rest after a burst of events', () => {
        const d = new SerenityWarpReactionDirector();
        d.pulse('lineClear', { lineCount: 4 });
        d.pulse('combo', { comboCount: 8 });
        advance(d, 0.2);
        expect(d.getReactionState().surge).toBeGreaterThan(0.05);
        advance(d, 8);
        expect(d.getReactionState().surge).toBeLessThan(0.02);
    });

    it('scales surge/chroma down under reduced motion but keeps bloom', () => {
        const normal = new SerenityWarpReactionDirector({ reducedMotion: false });
        normal.pulse('lineClear', { lineCount: 4 });
        const nR = { ...normal.update(FRAME) };

        const reduced = new SerenityWarpReactionDirector({ reducedMotion: true });
        reduced.pulse('lineClear', { lineCount: 4 });
        const rR = { ...reduced.update(FRAME) };

        expect(rR.surge).toBeLessThan(nR.surge);
        expect(rR.chroma).toBeLessThan(nR.chroma);
        expect(rR.bloom).toBeCloseTo(nR.bloom, 6);
    });

    it('kicks the camera only on big beats — never on locks or under reduced motion', () => {
        const lock = new SerenityWarpReactionDirector();
        lock.pulse('pieceLock');
        expect(lock.update(FRAME).cameraKick).toBe(0);

        const tetris = new SerenityWarpReactionDirector();
        tetris.pulse('lineClear', { lineCount: 4 });
        expect(tetris.update(FRAME).cameraKick).toBeGreaterThan(0);

        const reduced = new SerenityWarpReactionDirector({ reducedMotion: true });
        reduced.pulse('lineClear', { lineCount: 4 });
        expect(reduced.update(FRAME).cameraKick).toBe(0);
    });

    it('crosses combo milestone tiers [4,7,10] once per chain, vertigo at 7+, apex at 10', () => {
        const d = new SerenityWarpReactionDirector();

        d.pulse('combo', { comboCount: 4 });
        d.update(FRAME);
        expect(d.drainBeats().map((b) => b.tier)).toEqual([4]);
        expect(d.getReactionState().vertigo).toBe(0); // tier 4 < 7

        d.pulse('combo', { comboCount: 7 });
        d.update(FRAME);
        expect(d.drainBeats().map((b) => b.tier)).toEqual([7]);
        expect(d.getReactionState().vertigo).toBeGreaterThan(0); // dolly-zoom armed

        d.pulse('combo', { comboCount: 10 });
        d.update(FRAME);
        const apexBeats = d.drainBeats();
        expect(apexBeats[0].tier).toBe(10);
        expect(apexBeats[0].apex).toBe(true);

        // Same chain climbing further → no re-fire.
        d.pulse('combo', { comboCount: 12 });
        d.update(FRAME);
        expect(d.drainBeats()).toEqual([]);
    });

    it('re-arms combo tiers after a chain break', () => {
        const d = new SerenityWarpReactionDirector();
        d.pulse('combo', { comboCount: 5 });
        d.update(FRAME);
        expect(d.drainBeats().map((b) => b.tier)).toEqual([4]);
        d.pulse('combo', { comboCount: 1 }); // chain break
        d.update(FRAME);
        d.pulse('combo', { comboCount: 4 });
        d.update(FRAME);
        expect(d.drainBeats().map((b) => b.tier)).toEqual([4]);
    });

    it('gates the combo-10 apex behind a cooldown across chains', () => {
        const d = new SerenityWarpReactionDirector();
        d.pulse('combo', { comboCount: 10 });
        d.update(FRAME);
        expect(d.drainBeats().some((b) => b.apex)).toBe(true);

        // New 10-chain immediately (within cooldown) → tiers re-cross but NO apex.
        d.pulse('combo', { comboCount: 1 });
        d.update(FRAME);
        d.pulse('combo', { comboCount: 10 });
        d.update(FRAME);
        expect(d.drainBeats().some((b) => b.apex)).toBe(false);

        advance(d, 6); // wait out the ~5s cooldown
        d.pulse('combo', { comboCount: 1 });
        d.update(FRAME);
        d.pulse('combo', { comboCount: 10 });
        d.update(FRAME);
        expect(d.drainBeats().some((b) => b.apex)).toBe(true);
    });

    it('flings the field (warp scatter) on the apex + perfect clear, returns to rest, off under reduced motion', () => {
        const d = new SerenityWarpReactionDirector();
        d.pulse('combo', { comboCount: 4 });
        d.update(FRAME);
        expect(d.getReactionState().scatter).toBe(0); // small combo does not fling

        d.pulse('combo', { comboCount: 10 });
        d.update(FRAME);
        expect(d.getReactionState().scatter).toBeGreaterThan(0); // apex flings the field
        advance(d, 1.4); // bell completes
        expect(d.getReactionState().scatter).toBeLessThan(0.05); // reforms

        const pc = new SerenityWarpReactionDirector();
        pc.pulse('perfectClear');
        pc.update(FRAME);
        expect(pc.getReactionState().scatter).toBeGreaterThan(0);

        const reduced = new SerenityWarpReactionDirector({ reducedMotion: true });
        reduced.pulse('perfectClear');
        reduced.update(FRAME);
        expect(reduced.getReactionState().scatter).toBe(0);
    });

    it('spins the field on big beats, disabled under reduced motion', () => {
        const normal = new SerenityWarpReactionDirector();
        normal.pulse('lineClear', { lineCount: 4 });
        expect(normal.update(FRAME).spin).toBeGreaterThan(0);
        const reduced = new SerenityWarpReactionDirector({ reducedMotion: true });
        reduced.pulse('lineClear', { lineCount: 4 });
        expect(reduced.update(FRAME).spin).toBe(0);
    });

    it('intensity 0 mutes the whole reaction', () => {
        const d = new SerenityWarpReactionDirector({ intensity: 0 });
        d.pulse('perfectClear');
        const r = advance(d, 0.3);
        expect(r.surge).toBe(0);
        expect(r.bloom).toBe(0);
        expect(r.chroma).toBe(0);
    });

    it('reset returns to a clean identity state', () => {
        const d = new SerenityWarpReactionDirector();
        d.pulse('perfectClear');
        advance(d, 0.5);
        d.reset();
        const r = d.update(FRAME);
        expect(r.surge).toBe(0);
        expect(r.energy).toBe(0);
    });
});
