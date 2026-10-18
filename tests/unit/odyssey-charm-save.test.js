import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { OdysseyStateManager } from '../../src/core/odyssey/OdysseyStateManager.js';
import { ODYSSEY_MERCY_FALLS } from '../../src/core/odyssey/odyssey-charms.js';

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

    it('starts with a seed and no charms, offers Chapter 1’s draft, and keeps what is taken across reloads', () => {
        const state = manager();
        expect(state.getCharms()).toEqual([]);
        const draft = state.getCharmDraft('chapter:1');
        expect(draft.key).toBe('chapter:1');
        expect(draft.charms).toHaveLength(3);
        const [pick] = draft.charms;
        expect(state.takeCharm('chapter:1', 'not-offered')).toBe(false);
        expect(state.takeCharm('chapter:1', pick.id)).toBe(true);
        expect(state.getCharms()).toEqual([pick.id]);
        expect(state.getCharmDraft('chapter:1')).toBeNull();

        const again = reload();
        expect(again.getCharms()).toEqual([pick.id]);
        expect(again.getCharmDraft('chapter:1')).toBeNull();
        // The same journey offers the same Chapter 2 draft before and after a reload, never the charm held.
        expect(again.getCharmDraft('chapter:2')).toEqual(state.getCharmDraft('chapter:2'));
        expect(again.getCharmDraft('chapter:2').charms.map((charm) => charm.id)).not.toContain(pick.id);
        expect(again.passCharm('chapter:2')).toBe(true);
        expect(reload().getCharmDraft('chapter:2')).toBeNull();
        expect(reload().passCharm('chapter:2')).toBe(false);
        expect(reload().getCharms()).toEqual([pick.id]);
    });

    it('remembers each fall and opens the road’s mercy on the third, but not for an orb already cleared', () => {
        const state = manager();
        expect(state.recordAttempt(3)).toEqual({ levelId: 3, falls: 1 });
        state.recordAttempt(3);
        expect(state.getMercyDraft(3)).toBeNull();
        expect(state.recordAttempt(3).falls).toBe(ODYSSEY_MERCY_FALLS);
        const mercy = state.getMercyDraft(3);
        expect(mercy.key).toBe('orb:3');
        expect(mercy.charms).toHaveLength(3);
        expect(reload().getMercyDraft(3)).toEqual(mercy);
        expect(state.getMercyDraft(4)).toBeNull();
        expect(state.takeCharm(mercy.key, mercy.charms[1].id)).toBe(true);
        expect(reload().getCharms()).toEqual([mercy.charms[1].id]);
        expect(state.getMercyDraft(3)).toBeNull();
        // Falls on another orb count on their own; a cleared orb needs no mercy.
        state.recordAttempt(4);
        state.recordAttempt(4);
        state.recordAttempt(4);
        state.completeLevel(4, {
            stars: 1, score: 10, time: 10, bonuses: [],
        });
        expect(state.getMercyDraft(4)).toBeNull();
        expect(reload().statistics.totalAttempts).toBe(7);
    });

    it('loads a save from before charms, or with a damaged charm record, into a whole state', () => {
        const state = manager();
        state.completeLevel(1, {
            stars: 2, score: 100, time: 30, bonuses: [],
        });
        rewriteSave((data) => { delete data.charms; });
        const older = reload();
        expect(older.isLevelCompleted(1)).toBe(true);
        expect(older.getCharms()).toEqual([]);
        expect(older.charms.seed).toMatch(/\S/);
        expect(older.getCharmDraft('chapter:1').charms).toHaveLength(3);

        rewriteSave((data) => {
            data.charms = {
                seed: 'kept',
                owned: ['keel', 'bogus'],
                drafts: { 'chapter:1': 'keel', 'chapter:2': 'bogus' },
                falls: { 2: '3' },
            };
        });
        const mended = reload();
        expect(mended.charms.seed).toBe('kept');
        expect(mended.getCharms()).toEqual(['keel']);
        expect(mended.getCharmDraft('chapter:1')).toBeNull();
        expect(mended.getCharmDraft('chapter:2').charms.map((charm) => charm.id)).not.toContain('keel');
        expect(mended.getMercyDraft(2)).not.toBeNull();
    });

    it('a new journey forgets its charms and draws a new seed, so its drafts are its own', () => {
        const state = manager();
        const { seed } = state.charms;
        const draft = state.getCharmDraft('chapter:1');
        state.takeCharm('chapter:1', draft.charms[0].id);
        state.recordAttempt(2);
        state.recordAttempt(2);
        state.recordAttempt(2);
        expect(state.getMercyDraft(2)).not.toBeNull();
        state.reset();
        state.save();
        expect(state.getCharms()).toEqual([]);
        expect(state.getMercyDraft(2)).toBeNull();
        expect(state.charms.seed).not.toBe(seed);
        expect(state.getCharmDraft('chapter:1').charms).toHaveLength(3);
        const fresh = reload();
        expect(fresh.getCharms()).toEqual([]);
        expect(fresh.charms.seed).toBe(state.charms.seed);
    });
});
