import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { OdysseyStateManager } from '../../src/core/odyssey/OdysseyStateManager.js';
import { ODYSSEY_GEM_CAP } from '../../src/core/odyssey/odyssey-gems.js';

const clear = (stars = 2) => ({
    stars, score: 4000, lines: 25, time: 120, bonuses: [],
});

describe('Odyssey gem wallet in the save', () => {
    let store;
    const registry = new LevelRegistry();
    const create = () => new OdysseyStateManager({ levelRegistry: registry });

    beforeEach(() => {
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (key) => store.get(key) ?? null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: (key) => store.delete(key),
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('earns a gem for a clear and for a fall, caps the wallet, and survives a reload', () => {
        const state = create();
        expect(state.getGemCount()).toBe(0);
        const completion = state.completeLevel(1, clear());
        expect(completion.gemsEarned).toBe(1);
        expect(Object.keys(completion)).not.toContain('gemsEarned');
        expect(state.recordAttempt(2)).toEqual({ levelId: 2, gemsEarned: 1 });
        expect(state.getGemCount()).toBe(2);
        for (let i = 0; i < 12; i++) state.recordAttempt(2);
        expect(state.getGemCount()).toBe(ODYSSEY_GEM_CAP);
        expect(state.recordAttempt(2).gemsEarned).toBe(0);
        expect(state.getSaveData().gems).toEqual({ count: ODYSSEY_GEM_CAP, earned: ODYSSEY_GEM_CAP, spent: 0 });
        expect(create().getGemCount()).toBe(ODYSSEY_GEM_CAP);
    });

    it('spends one gem at a time and starts over on a new journey', () => {
        const state = create();
        state.completeLevel(1, clear());
        expect(state.spendGem()).toBe(true);
        expect(state.getGemCount()).toBe(0);
        expect(state.spendGem()).toBe(false);
        expect(create().getSaveData().gems).toEqual({ count: 0, earned: 1, spent: 1 });
        state.awardGems(2);
        expect(state.getGemCount()).toBe(2);
        state.reset();
        expect(state.getGemCount()).toBe(0);
        expect(state.getSaveData().gems).toEqual({ count: 0, earned: 0, spent: 0 });
    });

    it('marks an aided clear until the orb is cleared unaided, and keeps the best stars', () => {
        const state = create();
        const aided = state.completeLevel(3, clear(1), { aided: true });
        expect(aided.aided).toBe(true);
        expect(aided.stars).toBe(1);
        expect(state.isLevelUnlocked(4)).toBe(true);
        const again = state.completeLevel(3, clear(1), { aided: true });
        expect(again.aided).toBe(true);
        const unaided = state.completeLevel(3, clear(2));
        expect(unaided.aided).toBeUndefined();
        expect(unaided.stars).toBe(2);
        const aidedAfter = state.completeLevel(3, clear(1), { aided: true });
        expect(aidedAfter.aided).toBeUndefined();
        expect(aidedAfter.stars).toBe(2);
        expect(create().getLevelCompletion(3).aided).toBeUndefined();
        const fresh = create();
        fresh.reset();
        fresh.completeLevel(5, clear(1), { aided: true });
        expect(create().getLevelCompletion(5).aided).toBe(true);
    });
});
