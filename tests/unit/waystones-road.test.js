/**
 * The Waystones road and its climates: every climate names rules that exist and speaks in
 * the mode's own words, a seed always draws the same road, the first stop is gentle,
 * offers never repeat within a stop, the Keeper asks more, a banked stack raises the ask
 * (half as much under Ballast), Keel lowers it, and the draft never offers a charm held.
 */
import { describe, expect, it } from 'vitest';
import {
    CLIMATES, climateById, effectiveDropMs, goalText, isGentle, modifierInfo, paceWord, validateClimates,
} from '../../src/core/waystones/climates.js';
import { CHARMS, charmById } from '../../src/core/waystones/charms.js';
import {
    STOP_COUNT, OFFERS_PER_STOP, BANK_TOLL_PER_ROW, dailySeed, draftCharms, generateRoad, hashSeed, mulberry32,
    randomSeed, scaledGoal, seededRng, tollFor,
} from '../../src/core/waystones/road.js';

const WORLDS = [
    { id: 'forest', name: 'Forest' },
    { id: 'halcyon-apex', name: 'Halcyon Apex' },
    { id: 'thermal-bloom', name: 'Thermal Bloom' },
    { id: 'painted-ages', name: 'Painted Ages' },
    { id: 'neon-district', name: 'Neon District' },
];
const START = WORLDS[0];

describe('Waystones climates and charms', () => {
    it('name only rules that exist, with unique ids and a positive ask', () => {
        expect(validateClimates()).toEqual([]);
        expect(CLIMATES).toHaveLength(10);
        for (const climate of CLIMATES) {
            expect(climateById(climate.id)).toBe(climate);
            for (const id of climate.modifiers) expect(modifierInfo(id)?.name, id).toBeTruthy();
        }
        expect(validateClimates([{
            id: 'x', name: 'X', line: '', level: 1, modifiers: ['giant-pieces'], goal: { type: 'lines', base: 0 },
        }])).toEqual([
            "climate 'x' names unknown modifier 'giant-pieces'",
            "climate 'x' asks for nothing",
            'no climate is gentle enough for a first stop',
        ]);
        expect(modifierInfo('nope')).toBeNull();
    });

    it('speak of the rules in the road\'s own words, not Odyssey\'s level tooltips', () => {
        expect(modifierInfo('mirror')).toEqual({ id: 'mirror', name: 'Mirror', description: 'Left and right are swapped.' });
        expect(modifierInfo('speed-up')?.name).toBe('Fast fall');
        expect(modifierInfo('slow-start')?.name).toBe('Slow fall');
        expect(modifierInfo('combo-multiplier')?.name).toBe('Chain bonus');
        expect(modifierInfo('mist')?.name).toBe('Mist');
        expect(modifierInfo('long-breath')?.name).toBe('Long breath');
        for (const climate of CLIMATES) {
            expect(climate.line).not.toMatch(/quicken|hardest/i);
        }
    });

    it('tell their pace from the drop interval the mode will set', () => {
        expect(effectiveDropMs(climateById('clear-night'))).toBe(320);
        expect(effectiveDropMs(climateById('still-air'))).toBe(1152);
        expect(effectiveDropMs(climateById('rising-wind'))).toBeCloseTo(320 / 1.5, 5);
        expect(effectiveDropMs(climateById('slow-dusk'))).toBe(480);
        expect(effectiveDropMs(climateById('crosswind'))).toBe(512);
        expect(paceWord(climateById('still-air'))).toBe('slow');
        expect(paceWord(climateById('slow-dusk'))).toBe('unhurried');
        expect(paceWord(climateById('clear-night'))).toBe('steady');
        expect(paceWord(climateById('squall'))).toBe('brisk');
    });

    it('keep the first stop gentle: a lines ask with nothing bent but a long breath', () => {
        expect(CLIMATES.filter(isGentle).map((climate) => climate.id).sort()).toEqual(['clear-night', 'still-air']);
    });

    it('cover every goal type, and say each goal as a sentence the board\'s words match', () => {
        const types = new Set(CLIMATES.map((climate) => climate.goal.type));
        expect([...types].sort()).toEqual(['cascades', 'lines', 'score']);
        expect(goalText({ type: 'lines', target: 1 })).toBe('Clear 1 line');
        expect(goalText({ type: 'lines', target: 8 })).toBe('Clear 8 lines');
        expect(goalText({ type: 'score', target: 3500 })).toBe('Score 3,500 points');
        expect(goalText({ type: 'cascades', target: 2 })).toBe('Set off 2 cascades (a ×2 or deeper)');
    });

    it('hold seven charms whose names collide with no climate or resource', () => {
        expect(CHARMS).toHaveLength(7);
        expect(new Set(CHARMS.map((charm) => charm.id)).size).toBe(7);
        const climateWords = CLIMATES.flatMap((climate) => climate.name.toLowerCase().split(' '));
        for (const charm of CHARMS) {
            expect(climateWords, charm.name).not.toContain(charm.name.toLowerCase());
            expect(charm.name.toLowerCase()).not.toMatch(/lantern/);
        }
        expect(charmById('keel')?.kind).toBe('goal');
        expect(charmById('ballast')?.kind).toBe('goal');
        expect(charmById('nope')).toBeNull();
    });
});

describe('The road', () => {
    it('is the same road for the same seed, and another for another', () => {
        const a = generateRoad({ seed: 'dawn', startWorld: START, worlds: WORLDS });
        const b = generateRoad({ seed: 'dawn', startWorld: START, worlds: WORLDS });
        const c = generateRoad({ seed: 'dusk', startWorld: START, worlds: WORLDS });
        expect(b).toEqual(a);
        expect(c).not.toEqual(a);
        expect(a.seed).toBe('dawn');
        expect(hashSeed('dawn')).not.toBe(hashSeed('dusk'));
        const rng = mulberry32(1);
        const values = [rng(), rng(), rng()];
        expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
        expect(seededRng('s', 'road')()).toBe(seededRng('s', 'road')());
        expect(seededRng('s', 'road')()).not.toBe(seededRng('s', 'draft:1')());
    });

    it('begins where you stand, gently, and offers two different worlds under two different climates', () => {
        for (const seed of ['one', 'two', 'three', '2026-10-17', 'z9', 'mirror', 'q7']) {
            const road = generateRoad({ seed, startWorld: START, worlds: WORLDS });
            expect(road.stops).toHaveLength(STOP_COUNT);
            expect(road.stops[0].offers).toHaveLength(1);
            expect(road.stops[0].offers[0].world).toEqual(START);
            expect(isGentle(climateById(road.stops[0].offers[0].climateId)), seed).toBe(true);
            expect(road.stops.at(-1).keeper).toBe(true);
            expect(road.stops.slice(0, -1).every((stop) => !stop.keeper)).toBe(true);
            let previous = road.stops[0];
            for (const stop of road.stops.slice(1)) {
                expect(stop.offers).toHaveLength(OFFERS_PER_STOP);
                const worlds = stop.offers.map((offer) => offer.world.id);
                const climates = stop.offers.map((offer) => offer.climateId);
                expect(new Set(worlds).size, `${seed} stop ${stop.index} worlds`).toBe(OFFERS_PER_STOP);
                expect(new Set(climates).size, `${seed} stop ${stop.index} climates`).toBe(OFFERS_PER_STOP);
                for (const id of climates) {
                    expect(climateById(id), id).not.toBeNull();
                    expect(previous.offers.map((offer) => offer.climateId)).not.toContain(id);
                }
                for (const id of worlds) expect(previous.offers.map((offer) => offer.world.id)).not.toContain(id);
                previous = stop;
            }
        }
    });

    it('still walks with one world, or none beyond the one on screen', () => {
        const lone = generateRoad({ seed: 'lone', startWorld: START, worlds: [START] });
        expect(lone.stops[2].offers.map((offer) => offer.world)).toEqual([START, START]);
        expect(new Set(lone.stops[2].offers.map((offer) => offer.climateId)).size).toBe(2);
        const none = generateRoad({ seed: 'none', startWorld: START, worlds: [] });
        expect(none.stops[4].offers.every((offer) => offer.world.id === START.id)).toBe(true);
    });

    it('names a daily seed by the UTC date and a random one as a short string', () => {
        expect(dailySeed(new Date(Date.UTC(2026, 9, 17, 23, 59)))).toBe('2026-10-17');
        expect(randomSeed(() => 0.5)).toMatch(/^[0-9a-z]+$/);
        expect(randomSeed(() => 0.5)).toBe(randomSeed(() => 0.5));
    });
});

describe('What a stop asks', () => {
    const lines = climateById('clear-night');
    const score = climateById('ember-wind');
    const cascades = climateById('deep-current');

    it('is the base with an empty well, and rises with the rows carried in', () => {
        expect(scaledGoal(lines)).toEqual({ type: 'lines', target: 10 });
        expect(scaledGoal(lines, { carriedRows: 3 })).toEqual({ type: 'lines', target: 12 });
        expect(scaledGoal(lines, { carriedRows: 8 })).toEqual({ type: 'lines', target: 14 });
        expect(scaledGoal(score)).toEqual({ type: 'score', target: 3500 });
        expect(scaledGoal(score, { carriedRows: 5 }).target).toBe(4200);
        expect(scaledGoal(cascades, { carriedRows: 7 }).target).toBe(2);
        expect(scaledGoal(cascades, { carriedRows: 8 }).target).toBe(3);
        let last = 0;
        for (let rows = 0; rows <= 20; rows += 1) {
            const { target } = scaledGoal(score, { carriedRows: rows });
            expect(target).toBeGreaterThanOrEqual(last);
            last = target;
        }
    });

    it('is more at the Keeper, less with Keel (one cascade fewer), and half as weighted under Ballast', () => {
        expect(scaledGoal(lines, { keeper: true }).target).toBe(15);
        expect(scaledGoal(score, { keeper: true }).target).toBe(5300);
        expect(scaledGoal(cascades, { keeper: true }).target).toBe(3);
        expect(scaledGoal(lines, { keel: true }).target).toBe(9);
        expect(scaledGoal(score, { keel: true }).target).toBe(3000);
        expect(scaledGoal(cascades, { keel: true }).target).toBe(1);
        expect(scaledGoal(cascades, { keeper: true, keel: true }).target).toBe(2);
        expect(scaledGoal(lines, { keeper: true, keel: true }).target).toBe(13);
        expect(scaledGoal(lines, { carriedRows: 8, ballast: true }).target).toBe(12);
        expect(scaledGoal(cascades, { carriedRows: 8, ballast: true }).target).toBe(2);
        expect(scaledGoal(score, { carriedRows: 10, ballast: true }).target).toBe(4200);
    });

    it('pays a banked stack by the row, double under Tide', () => {
        expect(tollFor(11)).toBe(11 * BANK_TOLL_PER_ROW);
        expect(tollFor(11, { tide: true })).toBe(22 * BANK_TOLL_PER_ROW);
        expect(tollFor(0)).toBe(0);
        expect(tollFor(2.9)).toBe(2 * BANK_TOLL_PER_ROW);
    });
});

describe('The draft', () => {
    it('offers three charms you do not hold, the same for the seed and stop', () => {
        const first = draftCharms('dawn', 0, []);
        expect(first).toHaveLength(3);
        expect(draftCharms('dawn', 0, [])).toEqual(first);
        expect(draftCharms('dawn', 1, [])).not.toEqual(first);
        const held = ['kindle', 'tide', 'keel', 'hearth', 'ballast'];
        const late = draftCharms('dawn', 2, held);
        expect(late).toHaveLength(2);
        expect(late.every((id) => !held.includes(id))).toBe(true);
        expect(draftCharms('dawn', 3, CHARMS.map((charm) => charm.id))).toEqual([]);
    });
});
