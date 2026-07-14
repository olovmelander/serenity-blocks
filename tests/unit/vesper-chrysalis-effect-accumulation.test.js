import { describe, expect, it } from 'vitest';

import {
    waveSlotsForTier,
    resolveComboProgress,
    accumulateComboBoost,
    comboMilestonesCrossed,
    pickExpiringSlotIndex,
} from '../../src/playground/effects/vesper-chrysalis-director.js';

// Renderer-free accumulation semantics for the Vesper Chrysalis metamorphosis director —
// the Vesper analogue of the Wolfhour effect-accumulation suite. The effect closure needs a
// live WebGPU renderer; every rule below is exercised through the pure helper module instead.

describe('Vesper Chrysalis effect accumulation', () => {
    describe('waveSlotsForTier — galaxy-style shockwave budget (2–6 by tier)', () => {
        it.each([
            [0, 2], // Minimal
            [1, 2], // Low
            [2, 4], // Medium
            [3, 4], // High
            [4, 6], // Ultra
            [5, 6], // Extreme
        ])('tier %i → %i concurrent shockwave slots', (tier, expected) => {
            expect(waveSlotsForTier(tier)).toBe(expected);
        });
    });

    describe('resolveComboProgress — per-player chain-break gating', () => {
        it('keeps the stored progress when the chain grows', () => {
            expect(resolveComboProgress(3, 5)).toEqual({ prev: 3, count: 5 });
        });

        it('restarts the milestone gate at 0 when the count drops (fresh chain)', () => {
            expect(resolveComboProgress(7, 1)).toEqual({ prev: 0, count: 1 });
        });

        it('sanitizes non-integer / negative / missing counts', () => {
            expect(resolveComboProgress(0, 4.9)).toEqual({ prev: 0, count: 4 });
            expect(resolveComboProgress(0, -3)).toEqual({ prev: 0, count: 0 });
            expect(resolveComboProgress(2, undefined)).toEqual({ prev: 0, count: 0 });
        });
    });

    describe('accumulateComboBoost — energy holds/accumulates, never rewinds', () => {
        it('holds a decaying boost when a fresh chain restarts small', () => {
            // sCombo mid-decay at 0.30; a new chain at count=1 (0.06) must NOT rewind it.
            expect(accumulateComboBoost(0.3, 1, 0.06, 0.55)).toBeCloseTo(0.3);
        });

        it('grows monotonically as the live chain climbs', () => {
            expect(accumulateComboBoost(0.3, 6, 0.06, 0.55)).toBeCloseTo(0.36);
        });

        it('clamps at the safe cap', () => {
            expect(accumulateComboBoost(0.5, 40, 0.06, 0.55)).toBe(0.55);
        });
    });

    describe('comboMilestonesCrossed — milestone-gated, spike-capped bursts', () => {
        it('emits one milestone per newly-crossed multiple of three', () => {
            expect(comboMilestonesCrossed(0, 3)).toEqual([3]);
            expect(comboMilestonesCrossed(3, 6)).toEqual([6]);
            expect(comboMilestonesCrossed(2, 7)).toEqual([3, 6]);
        });

        it('re-crosses nothing when the same count repeats (dedup guard)', () => {
            expect(comboMilestonesCrossed(6, 6)).toEqual([]);
            expect(comboMilestonesCrossed(4, 4)).toEqual([]);
        });

        it('caps emissions per event so a huge jump cannot spawn a burst storm', () => {
            // 3,6,9,12,…,30 would be 10 bursts; the cap holds it to 3.
            expect(comboMilestonesCrossed(0, 30)).toEqual([3, 6, 9]);
        });
    });

    describe('pickExpiringSlotIndex — a fresh effect stacks, never clobbers a livelier slot', () => {
        it('reuses a long-dead slot before touching a live one', () => {
            const states = [
                { t0: 0, life: 2, amp: 1 }, // still alive at t=1 (1s remaining)
                { t0: -100, life: 2, amp: 0 }, // long dead
            ];
            expect(pickExpiringSlotIndex(states, 1)).toBe(1);
        });

        it('picks the slot nearest natural death when every slot is live', () => {
            const states = [
                { t0: 0, life: 10, amp: 1 }, // 9s remaining
                { t0: 0, life: 4, amp: 1 }, // 3s remaining ← closest to expiry
                { t0: 0, life: 8, amp: 1 }, // 7s remaining
            ];
            expect(pickExpiringSlotIndex(states, 1)).toBe(1);
        });

        it('breaks ties toward the weaker slot when ampWeight is set', () => {
            const states = [
                { t0: 0, life: 2, amp: 0.9 }, // equal remaining, stronger
                { t0: 0, life: 2, amp: 0.1 }, // equal remaining, weaker ← preferred
            ];
            expect(pickExpiringSlotIndex(states, 0, 0.35)).toBe(1);
        });

        it('NEVER clobbers a live ring while a dead slot with high residual amp sits free', () => {
            // Regression guard: amp must be a tie-break ONLY, never fold into the primary score.
            // Dead slot 0 (remaining 0) still holds a big amp uniform; live slot 1 is in its tail.
            const states = [
                { t0: 0, life: 1, amp: 0.95 }, // dead at t=2 (remaining 0), residual amp 0.95
                { t0: 0.8, life: 1.3, amp: 0.45 }, // still LIVE at t=2 (0.1s remaining)
            ];
            expect(pickExpiringSlotIndex(states, 2, 0.35)).toBe(0); // the dead slot, not the live one
        });
    });

    describe('integration — a fresh chain cannot inherit the previous chain state', () => {
        it('gates milestones + holds boost across a chain break', () => {
            const progress = new Map();
            const applyCombo = (player, rawCount, liveBoost) => {
                const key = String(player ?? 'local');
                const { prev, count } = resolveComboProgress(progress.get(key) || 0, rawCount);
                progress.set(key, count);
                const milestones = count <= prev ? [] : comboMilestonesCrossed(prev, count);
                const boost = count <= prev
                    ? liveBoost
                    : accumulateComboBoost(liveBoost, count, 0.06, 0.55);
                return { milestones, boost };
            };

            // Player A builds a chain to 6 → milestones 3 and 6 fire across the two events.
            expect(applyCombo('A', 3, 0).milestones).toEqual([3]);
            expect(applyCombo('A', 6, 0.18).milestones).toEqual([6]);
            // Player B is fully independent.
            expect(applyCombo('B', 4, 0.36).milestones).toEqual([3]);
            // Player A's chain breaks (drops to 1): gate resets, no re-fire, boost is HELD not rewound.
            const broken = applyCombo('A', 1, 0.30);
            expect(broken.milestones).toEqual([]);
            expect(broken.boost).toBeCloseTo(0.3);
            expect(progress.get('A')).toBe(1);
            expect(progress.get('B')).toBe(4);
        });
    });
});
