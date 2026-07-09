import { describe, it, expect } from 'vitest';
import {
    createBlindTimers,
    applyBlindEffect,
    applyFullBlindEffect,
    decrementBlindTimers,
    isBlindActive,
} from '../blind.js';

describe('blind effects', () => {
    const mk = () => ({ blindTimers: createBlindTimers() });

    it('createBlindTimers is zeroed', () => {
        expect(createBlindTimers()).toEqual({
            field: 0, fieldMax: 0, pending: 0, pendingMax: 0,
        });
    });

    it('applyBlindEffect sets pending + pendingMax (partial)', () => {
        const gs = mk();
        applyBlindEffect(gs, 4);
        expect(gs.blindTimers.pending).toBe(4);
        expect(gs.blindTimers.pendingMax).toBe(4);
        expect(gs.blindTimers.field).toBe(0);
        expect(isBlindActive(gs)).toBe(true);
    });

    it('applyFullBlindEffect sets field + fieldMax (full)', () => {
        const gs = mk();
        applyFullBlindEffect(gs, 6);
        expect(gs.blindTimers.field).toBe(6);
        expect(gs.blindTimers.fieldMax).toBe(6);
    });

    it('stacking extends but never shortens', () => {
        const gs = mk();
        applyBlindEffect(gs, 3);
        applyBlindEffect(gs, 5);
        expect(gs.blindTimers.pending).toBe(5);
        applyBlindEffect(gs, 2);
        expect(gs.blindTimers.pending).toBe(5);
    });

    it('ignores non-positive / missing durations', () => {
        const gs = mk();
        applyBlindEffect(gs, 0);
        applyBlindEffect(gs, undefined);
        applyFullBlindEffect(gs, -1);
        expect(isBlindActive(gs)).toBe(false);
    });

    it('decrement drains over real seconds and clears max at 0', () => {
        const gs = mk();
        applyFullBlindEffect(gs, 1);
        applyBlindEffect(gs, 1);
        decrementBlindTimers(gs, 0.4);
        expect(gs.blindTimers.field).toBeCloseTo(0.6, 5);
        expect(gs.blindTimers.pending).toBeCloseTo(0.6, 5);
        decrementBlindTimers(gs, 1); // overshoot clamps to 0
        expect(gs.blindTimers.field).toBe(0);
        expect(gs.blindTimers.pending).toBe(0);
        expect(gs.blindTimers.fieldMax).toBe(0);
        expect(gs.blindTimers.pendingMax).toBe(0);
        expect(isBlindActive(gs)).toBe(false);
    });

    it('backfills the legacy 2-field timer shape', () => {
        const gs = { blindTimers: { field: 0, pending: 0 } };
        applyBlindEffect(gs, 3);
        expect(gs.blindTimers.pendingMax).toBe(3);
    });
});
