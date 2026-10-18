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
    const ids = (draft) => draft.charms.map((charm) => charm.id);

    it('starts with an empty bag, offers Chapter 1’s charms, and keeps what is taken and carried across reloads', () => {
        const state = manager();
        expect(state.getCharmBag()).toEqual({ gathered: [], carried: [] });
        expect(state.getCarriedCharms()).toEqual([]);
        const draft = state.getChapterCharmDraft(1);
        expect(draft.key).toBe('chapter:1');
        expect(ids(draft)).toEqual(['kindle', 'keel', 'hearth']);
        expect(state.takeCharm(draft, 'not-offered')).toBeNull();
        expect(state.takeCharm(draft, 'keel')).toEqual({ setDown: null });
        expect(state.getCharmBag()).toEqual({ gathered: ['keel'], carried: ['keel'] });
        expect(state.getChapterCharmDraft(1)).toBeNull();

        const again = reload();
        expect(again.getCharmBag()).toEqual({ gathered: ['keel'], carried: ['keel'] });
        expect(again.getChapterCharmDraft(1)).toBeNull();
        // Chapter 3's offer leaves out the charm in the bag and tops up from the catalogue.
        expect(ids(again.getChapterCharmDraft(3))).toEqual(['long-breath', 'swell', 'kindle']);
        expect(again.passCharm(again.getChapterCharmDraft(3))).toBe(true);
        expect(reload().getChapterCharmDraft(3)).toBeNull();
        expect(reload().passCharm({ key: 'chapter:3', charms: [] })).toBe(false);
        expect(reload().getCarriedCharms()).toEqual(['keel']);
    });

    it('carries three at a time: a fourth sets the oldest down, and the map can set down and carry again', () => {
        const state = manager();
        const taken = [];
        for (let chapter = 1; chapter <= 4; chapter += 1) {
            const draft = state.getChapterCharmDraft(chapter);
            taken.push(state.takeCharm(draft, draft.charms[0].id));
        }
        expect(taken).toEqual([{ setDown: null }, { setDown: null }, { setDown: null }, { setDown: 'kindle' }]);
        expect(state.getCharmBag()).toEqual({
            gathered: ['kindle', 'low-tide', 'long-breath', 'still-air'],
            carried: ['low-tide', 'long-breath', 'still-air'],
        });
        expect(state.toggleCarriedCharm('kindle')).toEqual({ carried: false, refused: true });
        expect(state.toggleCarriedCharm('long-breath')).toEqual({ carried: false, refused: false });
        expect(state.toggleCarriedCharm('kindle')).toEqual({ carried: true, refused: false });
        expect(state.toggleCarriedCharm('hearth')).toEqual({ carried: false, refused: true });
        expect(reload().getCarriedCharms()).toEqual(['low-tide', 'still-air', 'kindle']);
        expect(reload().getCharmBag().gathered).toHaveLength(4);
    });

    it('remembers each fall and offers the orb’s own mercy on the third, but not for an orb already cleared', () => {
        const state = manager();
        expect(state.recordAttempt(15)).toEqual({ levelId: 15, falls: 1 });
        state.recordAttempt(15);
        expect(state.getMercyDraft(15)).toBeNull();
        expect(state.recordAttempt(15).falls).toBe(ODYSSEY_MERCY_FALLS);
        const mercy = state.getMercyDraft(15);
        expect(mercy.key).toBe('orb:15');
        expect(ids(mercy)).toEqual(['long-breath', 'keel', 'hearth']); // Orb 15 is timed and asks lines
        expect(reload().getMercyDraft(15)).toEqual(mercy);
        expect(state.getMercyDraft(16)).toBeNull();
        expect(state.takeCharm(mercy, 'long-breath')).toEqual({ setDown: null });
        expect(reload().getCharmBag()).toEqual({ gathered: ['long-breath'], carried: ['long-breath'] });
        expect(state.getMercyDraft(15)).toBeNull();
        // Falls on another orb count on their own; a cleared orb needs no mercy.
        state.recordAttempt(6);
        state.recordAttempt(6);
        state.recordAttempt(6);
        expect(ids(state.getMercyDraft(6))).toEqual(['low-tide', 'keel', 'hearth']);
        state.completeLevel(6, {
            stars: 1, score: 10, time: 10, bonuses: [],
        });
        expect(state.getMercyDraft(6)).toBeNull();
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
        expect(older.getCharmBag()).toEqual({ gathered: [], carried: [] });
        expect(older.getChapterCharmDraft(1).charms).toHaveLength(3);

        rewriteSave((data) => {
            data.charms = {
                owned: ['keel', 'bogus', 'hearth', 'swell', 'kindle'],
                drafts: { 'chapter:1': 'keel', 'chapter:2': 'bogus' },
                falls: { 15: '3' },
            };
        });
        const mended = reload();
        expect(mended.getCharmBag()).toEqual({
            gathered: ['keel', 'hearth', 'swell', 'kindle'], carried: ['hearth', 'swell', 'kindle'],
        });
        expect(mended.getChapterCharmDraft(1)).toBeNull();
        expect(ids(mended.getChapterCharmDraft(2))).toEqual(['low-tide', 'afterglow', 'long-breath']);
        expect(ids(mended.getMercyDraft(15))).toEqual(['long-breath', 'still-air']);
    });

    it('a new journey empties the bag and opens every chapter’s offer again', () => {
        const state = manager();
        const draft = state.getChapterCharmDraft(1);
        state.takeCharm(draft, 'keel');
        state.recordAttempt(2);
        state.recordAttempt(2);
        state.recordAttempt(2);
        expect(state.getMercyDraft(2)).not.toBeNull();
        state.reset();
        state.save();
        expect(state.getCharmBag()).toEqual({ gathered: [], carried: [] });
        expect(state.getMercyDraft(2)).toBeNull();
        expect(ids(state.getChapterCharmDraft(1))).toEqual(['kindle', 'keel', 'hearth']);
        expect(reload().getCharmBag()).toEqual({ gathered: [], carried: [] });
    });
});
