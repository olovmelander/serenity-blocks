import {
    describe, expect, it, vi,
} from 'vitest';
import {
    ODYSSEY_CHARMS, ODYSSEY_CHARM_CAP, ODYSSEY_CHARM_IDS, ODYSSEY_LONG_BREATH_SECONDS, ODYSSEY_PITY_FALLS,
    ODYSSEY_PITY_HOLD, ODYSSEY_STILL_AIR_MS, ODYSSEY_TIDE_ROWS,
    addOdysseyCharm, claimOdysseyPity, clearOdysseyCharmStreak, createOdysseyCharmState, describeOdysseyCharms,
    dropOdysseyCharms, migrateOdysseyGatheredCharms, normalizeOdysseyCharmState, odysseyCharmBagEntries,
    odysseyCharmBagTotal, odysseyCharmById, odysseyCharmCount, odysseyCharmDropCount, odysseyCharmHelps,
    odysseyCharmTitle, odysseyCharmsThatHelp, odysseyLevelHasClock, odysseyPityCharm, pickOdysseyCharmDrop,
    recordOdysseyCharmFall, serializeOdysseyCharmState, spendOdysseyCharm,
} from '../../src/core/odyssey/odyssey-charm-bag.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';

const emptyBag = () => ({
    tide: 0, 'still-air': 0, 'long-breath': 0, hearth: 0,
});

describe('Odyssey charms: the catalogue', () => {
    it('offers four charms on keys 1 to 4, each with its rule said plainly and as a press line', () => {
        expect(ODYSSEY_CHARM_IDS).toEqual(['tide', 'still-air', 'long-breath', 'hearth']);
        expect(ODYSSEY_CHARMS.map((charm) => charm.key)).toEqual(['1', '2', '3', '4']);
        ODYSSEY_CHARMS.forEach((charm) => {
            expect(charm.line.endsWith('.')).toBe(true);
            expect(charm.press.startsWith(`Press ${charm.key}`)).toBe(true);
        });
        expect(odysseyCharmTitle(odysseyCharmById('tide'))).toBe('Tide · clears the bottom 4 rows. Once an attempt.');
        expect(odysseyCharmTitle(odysseyCharmById('still-air'))).toBe('Still Air · slows the fall for 20 seconds.');
        expect(odysseyCharmTitle(odysseyCharmById('long-breath'))).toBe('Long Breath · adds 30 seconds to the clock.');
        expect(odysseyCharmTitle(odysseyCharmById('hearth')))
            .toBe('Hearth · arm it, and your next top-out clears the well instead of ending the orb.');
        expect(odysseyCharmById('long-breath').press).toBe('Press 3 for 30 more seconds.');
        expect(odysseyCharmTitle(null)).toBe('');
        expect(odysseyCharmById('keel')).toBeNull();
        expect(describeOdysseyCharms(['hearth', 'keel', 'tide']).map((charm) => charm.id)).toEqual(['hearth', 'tide']);
        expect(describeOdysseyCharms(undefined)).toEqual([]);
        expect([ODYSSEY_TIDE_ROWS, ODYSSEY_STILL_AIR_MS, ODYSSEY_LONG_BREATH_SECONDS, ODYSSEY_CHARM_CAP])
            .toEqual([4, 20000, 30, 3]);
    });

    it('knows which charms do something on an orb: Long Breath needs a clock, the others always help', () => {
        expect(odysseyLevelHasClock(getLevelById(15))).toBe(true); // a 4:30 deadline
        expect(odysseyLevelHasClock(getLevelById(1))).toBe(false);
        expect(odysseyLevelHasClock(undefined)).toBe(false);
        expect(odysseyCharmsThatHelp(getLevelById(15))).toEqual(['tide', 'still-air', 'long-breath', 'hearth']);
        expect(odysseyCharmsThatHelp(getLevelById(1))).toEqual(['tide', 'still-air', 'hearth']);
        expect(odysseyCharmsThatHelp(getLevelById(5))).toEqual(['tide', 'still-air', 'hearth']); // a duel has no clock
        expect(odysseyCharmsThatHelp(undefined)).toEqual([...ODYSSEY_CHARM_IDS]);
        expect(odysseyCharmHelps(getLevelById(15), 'long-breath')).toBe(true);
        expect(odysseyCharmHelps(getLevelById(1), 'long-breath')).toBe(false);
        expect(odysseyCharmHelps(getLevelById(1), 'keel')).toBe(false);
    });

    it('names the charm the road leaves after three falls: clock, rubble or height, rival, else the pace', () => {
        expect(odysseyPityCharm(getLevelById(15))).toBe('long-breath'); // timed
        expect(odysseyPityCharm(getLevelById(33))).toBe('long-breath'); // timed and rubble: the clock first
        expect(odysseyPityCharm(getLevelById(6))).toBe('tide'); // five rows of rubble
        expect(odysseyPityCharm(getLevelById(2))).toBe('tide'); // a 24-row well
        expect(odysseyPityCharm(getLevelById(5))).toBe('hearth'); // a duel
        expect(odysseyPityCharm(getLevelById(1))).toBe('still-air');
        expect(odysseyPityCharm(undefined)).toBe('still-air');
    });
});

describe('Odyssey charms: the bag', () => {
    it('starts empty, holds up to three of each, spends one at a time, and counts what was found and used', () => {
        const state = createOdysseyCharmState();
        expect(state).toEqual({
            bag: emptyBag(), found: 0, used: 0, streak: { levelId: null, falls: 0 },
        });
        expect(addOdysseyCharm(state, 'tide')).toBe(true);
        expect(addOdysseyCharm(state, 'tide')).toBe(true);
        expect(addOdysseyCharm(state, 'tide')).toBe(true);
        expect(addOdysseyCharm(state, 'tide')).toBe(false); // the cap
        expect(addOdysseyCharm(state, 'keel')).toBe(false);
        expect(addOdysseyCharm(null, 'tide')).toBe(false);
        expect(odysseyCharmCount(state, 'tide')).toBe(3);
        expect(state.found).toBe(3);
        expect(spendOdysseyCharm(state, 'tide')).toBe(true);
        expect(spendOdysseyCharm(state, 'hearth')).toBe(false);
        expect(spendOdysseyCharm(null, 'tide')).toBe(false);
        expect(state.bag.tide).toBe(2);
        expect(state.used).toBe(1);
        addOdysseyCharm(state, 'hearth');
        expect(odysseyCharmBagTotal(state)).toBe(3);
        expect(odysseyCharmBagEntries(state).map((entry) => [entry.id, entry.count]))
            .toEqual([['tide', 2], ['hearth', 1]]);
        expect(odysseyCharmBagEntries(state)[0]).toMatchObject({ name: 'Tide', key: '1' });
        expect(odysseyCharmBagEntries(null)).toEqual([]);
        expect(odysseyCharmBagTotal(undefined)).toBe(0);
        expect(odysseyCharmCount(undefined, 'tide')).toBe(0);
    });

    it('makes a saved bag whole: unknown charms dropped, counts whole and capped, the streak on one orb', () => {
        expect(normalizeOdysseyCharmState({
            bag: {
                tide: 7, 'still-air': 1.9, hearth: -2, keel: 3,
            },
            found: '4',
            used: 2.5,
            streak: { levelId: 15, falls: 2 },
        })).toEqual({
            bag: {
                tide: 3, 'still-air': 1, 'long-breath': 0, hearth: 0,
            },
            found: 4,
            used: 2,
            streak: { levelId: 15, falls: 2 },
        });
        expect(normalizeOdysseyCharmState({ bag: {}, streak: { levelId: 'x', falls: 3 } }))
            .toEqual(createOdysseyCharmState());
        expect(normalizeOdysseyCharmState({ bag: {}, streak: { levelId: 4, falls: 0 } }).streak)
            .toEqual({ levelId: null, falls: 0 });
        expect(normalizeOdysseyCharmState(undefined)).toEqual(createOdysseyCharmState());
        expect(normalizeOdysseyCharmState('nope')).toEqual(createOdysseyCharmState());
        expect(normalizeOdysseyCharmState({})).toEqual(createOdysseyCharmState());
        const state = createOdysseyCharmState();
        addOdysseyCharm(state, 'hearth');
        recordOdysseyCharmFall(state, 9);
        const saved = serializeOdysseyCharmState(state);
        expect(saved).toEqual({
            bag: { ...emptyBag(), hearth: 1 }, found: 1, used: 0, streak: { levelId: 9, falls: 1 },
        });
        expect(saved.bag).not.toBe(state.bag);
        expect(normalizeOdysseyCharmState(JSON.parse(JSON.stringify(saved)))).toEqual(state);
    });

    it('converts the older gathered bag: a charm that still exists keeps its name, the rest take turns', () => {
        // The 2026-10-18 shape: eight passives gathered for the journey, three carried, drafts settled per chapter.
        const older = {
            gathered: ['keel', 'hearth', 'kindle', 'still-air', 'swell', 'afterglow', 'low-tide'],
            carried: ['keel', 'hearth', 'kindle'],
            drafts: { 'chapter:1': 'keel', 'chapter:2': null },
            falls: { 15: 3 },
        };
        const state = normalizeOdysseyCharmState(older);
        expect(state.found).toBe(7);
        expect(odysseyCharmBagTotal(state)).toBe(7);
        // keel → Tide, Hearth kept, kindle → Still Air, Still Air kept, swell → Long Breath, afterglow → Hearth, low-tide → Tide.
        expect(state.bag).toEqual({
            tide: 2, 'still-air': 2, 'long-breath': 1, hearth: 2,
        });
        expect(state.used).toBe(0);
        expect(state.streak).toEqual({ levelId: null, falls: 0 });
        // The oldest shape named the bag `owned`; junk entries are skipped.
        expect(normalizeOdysseyCharmState({ owned: ['keel', 7, null, 'keel', 'keel', 'keel', 'keel'] }).bag).toEqual({
            tide: 2, 'still-air': 1, 'long-breath': 1, hearth: 1,
        });
        expect(migrateOdysseyGatheredCharms([])).toEqual(createOdysseyCharmState());
        // The cap holds through the conversion.
        const full = migrateOdysseyGatheredCharms(Array(20).fill('keel'));
        expect(odysseyCharmBagTotal(full)).toBe(ODYSSEY_CHARM_IDS.length * ODYSSEY_CHARM_CAP);
        expect(full.found).toBe(12);
    });
});

describe('Odyssey charms: what a clear leaves', () => {
    const draws = (...values) => {
        let index = 0;
        return () => values[index++ % values.length];
    };

    it('drops one charm, two for three stars, picked among what helps on the next orb and is under its cap', () => {
        expect(odysseyCharmDropCount(3)).toBe(2);
        expect(odysseyCharmDropCount(2)).toBe(1);
        expect(odysseyCharmDropCount(0)).toBe(1);
        expect(odysseyCharmDropCount(undefined)).toBe(1);
        const state = createOdysseyCharmState();
        // Orb 1 has no clock: Long Breath is never picked for it.
        expect(pickOdysseyCharmDrop(state, getLevelById(1), () => 0)).toBe('tide');
        expect(pickOdysseyCharmDrop(state, getLevelById(1), () => 0.5)).toBe('still-air');
        expect(pickOdysseyCharmDrop(state, getLevelById(1), () => 0.99)).toBe('hearth');
        // Orb 15 has a clock: Long Breath joins the draw.
        expect(pickOdysseyCharmDrop(state, getLevelById(15), () => 0.6)).toBe('long-breath');
        // A charm at its cap is skipped.
        state.bag.tide = ODYSSEY_CHARM_CAP;
        expect(pickOdysseyCharmDrop(state, getLevelById(1), () => 0)).toBe('still-air');
        // An odd draw still lands on a charm.
        expect(pickOdysseyCharmDrop(state, getLevelById(1), () => 1)).toBe('hearth');
        expect(pickOdysseyCharmDrop(state, getLevelById(1), () => NaN)).toBe('still-air');
        // A full bag drops nothing.
        ODYSSEY_CHARM_IDS.forEach((id) => { state.bag[id] = ODYSSEY_CHARM_CAP; });
        expect(pickOdysseyCharmDrop(state, getLevelById(15), () => 0)).toBeNull();
    });

    it('adds the drops to the bag, two on three stars, and ends the streak of falls', () => {
        const state = createOdysseyCharmState();
        recordOdysseyCharmFall(state, 3);
        recordOdysseyCharmFall(state, 3);
        expect(dropOdysseyCharms(state, getLevelById(15), 3, draws(0.7, 0.1))).toEqual(['long-breath', 'tide']);
        expect(state.bag).toEqual({ ...emptyBag(), tide: 1, 'long-breath': 1 });
        expect(state.found).toBe(2);
        expect(state.streak).toEqual({ levelId: null, falls: 0 });
        expect(dropOdysseyCharms(state, getLevelById(1), 2, () => 0.4)).toEqual(['still-air']);
        // The road's end: with no next orb, every charm may drop.
        expect(dropOdysseyCharms(state, undefined, 1, () => 0.6)).toEqual(['long-breath']);
        // Nothing under the cap: the clear leaves nothing, honestly.
        ODYSSEY_CHARM_IDS.forEach((id) => { state.bag[id] = ODYSSEY_CHARM_CAP; });
        expect(dropOdysseyCharms(state, getLevelById(1), 3, () => 0)).toEqual([]);
        // Without a draw of its own the pick still lands on a charm that helps, with or without Web Crypto.
        const fresh = createOdysseyCharmState();
        expect(['tide', 'still-air', 'hearth']).toContain(pickOdysseyCharmDrop(fresh, getLevelById(1)));
        expect(dropOdysseyCharms(fresh, getLevelById(1), 1)).toHaveLength(1);
        try {
            vi.stubGlobal('crypto', {});
            expect(['tide', 'still-air', 'hearth']).toContain(pickOdysseyCharmDrop(fresh, getLevelById(1)));
            vi.stubGlobal('crypto', undefined);
            expect(['tide', 'still-air', 'hearth']).toContain(pickOdysseyCharmDrop(fresh, getLevelById(1)));
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('Odyssey charms: the road’s mercy', () => {
    it('counts falls in a row on one orb, starts over on another orb, and ends with a clear', () => {
        const state = createOdysseyCharmState();
        expect(recordOdysseyCharmFall(state, 15)).toEqual({ levelId: 15, falls: 1 });
        expect(recordOdysseyCharmFall(state, '15')).toEqual({ levelId: 15, falls: 2 });
        expect(recordOdysseyCharmFall(state, 16)).toEqual({ levelId: 16, falls: 1 });
        expect(state.streak).toEqual({ levelId: 16, falls: 1 });
        clearOdysseyCharmStreak(state);
        expect(state.streak).toEqual({ levelId: null, falls: 0 });
        expect(recordOdysseyCharmFall(null, 1)).toEqual({ levelId: 1, falls: 0 });
        expect(() => clearOdysseyCharmStreak(null)).not.toThrow();
    });

    it('leaves the orb’s own charm on the third fall in a row, once per three, while fewer than two are held', () => {
        const state = createOdysseyCharmState();
        const level = getLevelById(15);
        recordOdysseyCharmFall(state, 15);
        recordOdysseyCharmFall(state, 15);
        expect(claimOdysseyPity(state, level)).toBeNull();
        recordOdysseyCharmFall(state, 15);
        expect(claimOdysseyPity(state, level)).toBe('long-breath');
        expect(state.bag['long-breath']).toBe(1);
        expect(state.found).toBe(1);
        // The fourth and fifth falls owe nothing; the sixth does.
        recordOdysseyCharmFall(state, 15);
        expect(claimOdysseyPity(state, level)).toBeNull();
        recordOdysseyCharmFall(state, 15);
        expect(claimOdysseyPity(state, level)).toBeNull();
        recordOdysseyCharmFall(state, 15);
        expect(claimOdysseyPity(state, level)).toBe('long-breath');
        expect(state.bag['long-breath']).toBe(ODYSSEY_PITY_HOLD);
        // Two held: the ninth fall leaves nothing more.
        for (let fall = 0; fall < ODYSSEY_PITY_FALLS; fall += 1) recordOdysseyCharmFall(state, 15);
        expect(state.streak.falls).toBe(9);
        expect(claimOdysseyPity(state, level)).toBeNull();
        expect(state.bag['long-breath']).toBe(ODYSSEY_PITY_HOLD);
        // Another orb starts its own count; an id serves when no orb is at hand.
        for (let fall = 0; fall < ODYSSEY_PITY_FALLS; fall += 1) recordOdysseyCharmFall(state, 5);
        expect(claimOdysseyPity(state, getLevelById(5))).toBe('hearth');
        const blind = createOdysseyCharmState();
        for (let fall = 0; fall < ODYSSEY_PITY_FALLS; fall += 1) recordOdysseyCharmFall(blind, 42);
        expect(claimOdysseyPity(blind, undefined, 42)).toBe('still-air');
        expect(claimOdysseyPity(blind, undefined, 43)).toBeNull();
        expect(claimOdysseyPity(null, level)).toBeNull();
    });
});
