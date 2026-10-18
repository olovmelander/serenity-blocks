import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { OdysseyStateManager } from '../../src/core/odyssey/OdysseyStateManager.js';

describe('Odyssey save: onboarding marks', () => {
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
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('starts fresh and unwelcomed, remembers the welcome across loads, and starts over on reset', () => {
        const state = create();
        expect(state.isFreshJourney()).toBe(true);
        expect(state.hasSeenArrival()).toBe(false);
        expect(state.getSaveData().onboarding).toEqual({ arrivalSeen: false });

        state.markArrivalSeen();
        expect(state.hasSeenArrival()).toBe(true);
        // The mark rides on the next save rather than forcing one of its own.
        expect(store.size).toBe(0);
        state.save();
        expect(JSON.parse(store.get('serenityBlocksOdyssey') ?? [...store.values()][0]).onboarding)
            .toEqual({ arrivalSeen: true });
        const reloaded = create();
        expect(reloaded.hasSeenArrival()).toBe(true);
        expect(reloaded.isFreshJourney()).toBe(true);

        reloaded.reset();
        expect(reloaded.hasSeenArrival()).toBe(false);
        expect(reloaded.isFreshJourney()).toBe(true);
        expect(create().hasSeenArrival()).toBe(false);
    });

    it('stops being a fresh journey once an orb is attempted or cleared', () => {
        const attempted = create();
        attempted.recordAttempt(1);
        expect(attempted.isFreshJourney()).toBe(false);

        const cleared = create();
        cleared.reset();
        cleared.completeLevel(1, {
            stars: 1, score: 1200, lines: 20, time: 90, bonuses: [],
        });
        expect(cleared.isFreshJourney()).toBe(false);
    });

    it('treats an older save without the mark as unwelcomed only when nothing was played', () => {
        const veteran = create();
        veteran.completeLevel(3, {
            stars: 2, score: 5000, lines: 30, time: 100, bonuses: [],
        });
        const saved = JSON.parse([...store.values()][0]);
        delete saved.onboarding;
        store.set([...store.keys()][0], JSON.stringify(saved));
        const loaded = create();
        expect(loaded.hasSeenArrival()).toBe(false);
        expect(loaded.isFreshJourney()).toBe(false);
    });
});
