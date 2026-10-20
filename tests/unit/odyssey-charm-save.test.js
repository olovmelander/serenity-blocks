import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { OdysseyStateManager } from '../../src/core/odyssey/OdysseyStateManager.js';
import { ODYSSEY_CHARM_CAP } from '../../src/core/odyssey/odyssey-charm-bag.js';

const clear = (stars = 2) => ({
    stars, score: 4000, lines: 25, time: 120, bonuses: [],
});

describe('Odyssey charms in the save', () => {
    let registry;
    let saved;
    beforeEach(() => {
        registry = new LevelRegistry();
        saved = new Map();
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key) => saved.get(key) ?? null),
            setItem: vi.fn((key, value) => saved.set(key, String(value))),
            removeItem: vi.fn((key) => saved.delete(key)),
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
    const manager = () => new OdysseyStateManager({ levelRegistry: registry });
    const reload = () => {
        const next = manager();
        next.load();
        return next;
    };
    const rewriteSave = (edit) => {
        saved.forEach((value, key) => {
            const data = JSON.parse(value);
            edit(data);
            saved.set(key, JSON.stringify(data));
        });
    };

    it('leaves a charm on a clear, two for three stars, picked for the road ahead, and keeps the bag across reloads', () => {
        const state = manager();
        expect(state.getCharmBag()).toEqual([]);
        expect(state.getCharmBagTotal()).toBe(0);
        expect(state.getCharmStats()).toEqual({ found: 0, used: 0 });
        const first = state.completeLevel(1, clear(2));
        expect(first.charmsFound).toHaveLength(1);
        expect(Object.keys(first)).not.toContain('charmsFound');
        // Orb 2, the road ahead, has no clock: Long Breath never drops for it.
        expect(['tide', 'still-air', 'hearth']).toContain(first.charmsFound[0]);
        expect(state.getCharmStats()).toEqual({ found: 1, used: 0 });
        const triple = state.completeLevel(2, clear(3));
        expect(triple.charmsFound).toHaveLength(2);
        expect(state.getCharmBagTotal()).toBe(3);
        expect(state.getCharmBag().reduce((sum, entry) => sum + entry.count, 0)).toBe(3);
        const again = reload();
        expect(again.getCharmBagTotal()).toBe(3);
        expect(again.getCharmCounts()).toEqual(state.getCharmCounts());
        expect(again.getSaveData().charms).toEqual({
            bag: state.getCharmCounts(), found: 3, used: 0, streak: { levelId: null, falls: 0 },
        });
    });

    it('restocks on a replayed orb up to three of each, and spends one on use, saved at once', () => {
        const state = manager();
        for (let replay = 0; replay < 10; replay += 1) state.completeLevel(1, clear(3));
        expect(state.getCharmCounts()).toEqual({
            tide: ODYSSEY_CHARM_CAP, 'still-air': ODYSSEY_CHARM_CAP, 'long-breath': 0, hearth: ODYSSEY_CHARM_CAP,
        });
        expect(state.completeLevel(1, clear(3)).charmsFound).toEqual([]);
        expect(state.getCharmStats().found).toBe(9);
        expect(state.spendCharm('tide')).toBe(true);
        expect(state.getCharmCount('tide')).toBe(2);
        expect(state.spendCharm('long-breath')).toBe(false);
        expect(state.spendCharm('keel')).toBe(false);
        expect(reload().getCharmCount('tide')).toBe(2);
        expect(reload().getCharmStats()).toEqual({ found: 9, used: 1 });
    });

    it('remembers falls in a row on one orb and leaves the orb’s own charm on the third; a clear anywhere ends the streak', () => {
        const state = manager();
        expect(state.recordAttempt(15)).toEqual({ levelId: 15, falls: 1, pity: null });
        state.recordAttempt(15);
        expect(state.recordAttempt(15)).toEqual({ levelId: 15, falls: 3, pity: 'long-breath' }); // Orb 15 is timed
        expect(state.getCharmCount('long-breath')).toBe(1);
        expect(reload().getSaveData().charms.streak).toEqual({ levelId: 15, falls: 3 });
        expect(state.recordAttempt(6).falls).toBe(1); // another orb starts its own count
        state.completeLevel(6, clear(1));
        expect(reload().getSaveData().charms.streak).toEqual({ levelId: null, falls: 0 });
        expect(state.recordAttempt(5).falls).toBe(1);
        expect(reload().statistics.totalAttempts).toBe(6);
    });

    it('loads a save from before charms, converts the older gathered bag, and mends a damaged record', () => {
        const state = manager();
        state.completeLevel(1, clear(2));
        rewriteSave((data) => { delete data.charms; });
        const older = reload();
        expect(older.isLevelCompleted(1)).toBe(true);
        expect(older.getCharmBag()).toEqual([]);
        expect(older.getCharmStats()).toEqual({ found: 0, used: 0 });

        rewriteSave((data) => {
            data.charms = {
                gathered: ['keel', 'hearth', 'kindle'], carried: ['keel'], drafts: { 'chapter:1': 'keel' }, falls: { 15: 3 },
            };
        });
        const converted = reload();
        expect(converted.getCharmCounts()).toEqual({
            tide: 1, 'still-air': 1, 'long-breath': 0, hearth: 1,
        });
        expect(converted.getCharmStats()).toEqual({ found: 3, used: 0 });
        expect(converted.getSaveData().charms.streak).toEqual({ levelId: null, falls: 0 });

        rewriteSave((data) => {
            data.charms = {
                bag: { tide: 9, bogus: 2 }, found: -1, used: 'x', streak: { levelId: 15, falls: 2 },
            };
        });
        const mended = reload();
        expect(mended.getCharmCounts()).toEqual({
            tide: ODYSSEY_CHARM_CAP, 'still-air': 0, 'long-breath': 0, hearth: 0,
        });
        expect(mended.getCharmStats()).toEqual({ found: 0, used: 0 });
        expect(mended.recordAttempt(15).pity).toBe('long-breath'); // the third fall in a row on orb 15
    });

    it('a new journey empties the bag and forgets the streak', () => {
        const state = manager();
        state.completeLevel(1, clear(3));
        state.recordAttempt(2);
        state.recordAttempt(2);
        state.reset();
        state.save();
        expect(state.getCharmBag()).toEqual([]);
        expect(state.getCharmStats()).toEqual({ found: 0, used: 0 });
        expect(state.recordAttempt(2).falls).toBe(1);
        expect(reload().getSaveData().charms).toEqual({
            bag: {
                tide: 0, 'still-air': 0, 'long-breath': 0, hearth: 0,
            },
            found: 0,
            used: 0,
            streak: { levelId: 2, falls: 1 },
        });
    });
});
