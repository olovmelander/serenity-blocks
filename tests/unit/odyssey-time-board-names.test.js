// @ts-check
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';
import { hasOdysseyTimeBoard } from '../../src/core/odyssey/odyssey-time-board.js';
import {
    BOARDS, ODYSSEY_TIME_BOARD_GENERATIONS, STEAM_LEADERBOARD_NAME_MAX_BYTES, createSteamCatalogue,
    isOdysseyTimeBoardName, odysseyTimeBoardName,
} from '../../src/core/steam/steam-catalogue.js';

const CATALOGUE = '../../src/core/steam/steam-catalogue.js';
const TIMED_ORBS = LEVEL_CONFIGS.filter(hasOdysseyTimeBoard).map((level) => level.id);
// The six boards that are not orb times, and the 58 names the partner manifest was approved with.
const OTHER_BOARDS = ['SinglePlayerHighScore_v1', 'SinglePlayerLines_v1', 'InfinityHighScore_v1',
    'InfinitySurvivalTime_v1', 'InfinityBestCascade_v1', 'OdysseyTotalStars_v3'];
const FIRST_GENERATION = TIMED_ORBS.map((orb) => `OdysseyLevelTime_v7_${orb}`);

describe('the name of an orb\'s time board', () => {
    it('is the approved partner-site name while every orb is on its first generation', () => {
        for (let orb = 1; orb <= 60; orb++) {
            expect(odysseyTimeBoardName(orb, {})).toBe(`OdysseyLevelTime_v7_${orb}`);
            expect(odysseyTimeBoardName(String(orb), {})).toBe(`OdysseyLevelTime_v7_${orb}`);
        }
        expect(TIMED_ORBS).toHaveLength(58);
        expect(Object.keys(createSteamCatalogue({}).BOARDS).sort()).toEqual([...OTHER_BOARDS, ...FIRST_GENERATION].sort());
    });

    it('gives a bumped orb a board of its own and leaves the other 57 where they were', () => {
        const before = createSteamCatalogue({});
        const after = createSteamCatalogue({ 26: 2 });
        expect(after.odysseyTimeBoardName(26)).toBe('OdysseyLevelTime_v7_26_g2');
        expect(odysseyTimeBoardName(26, { 26: 3 })).toBe('OdysseyLevelTime_v7_26_g3');

        expect(after.BOARDS).not.toHaveProperty('OdysseyLevelTime_v7_26');
        expect(after.BOARDS.OdysseyLevelTime_v7_26_g2).toEqual({
            ...before.BOARDS.OdysseyLevelTime_v7_26, name: 'OdysseyLevelTime_v7_26_g2',
        });
        const untouched = (/** @type {Record<string, unknown>} */ boards) => Object.fromEntries(
            Object.entries(boards).filter(([, board]) => /** @type {any} */ (board).orb !== 26),
        );
        expect(untouched(after.BOARDS)).toEqual(untouched(before.BOARDS));
        expect(Object.keys(untouched(after.BOARDS))).toHaveLength(63);
        for (const orb of TIMED_ORBS.filter((id) => id !== 26)) {
            expect(after.odysseyTimeBoardName(orb)).toBe(`OdysseyLevelTime_v7_${orb}`);
        }

        // The new board is a fastest-first board for orb 26, and the retired name is nothing at all.
        const details = [1, 12, 3, 26, 12345, 0, -123];
        expect(after.isEligibleScore('OdysseyLevelTime_v7_26_g2', 12345, details)).toBe(true);
        expect(after.isEligibleScore('OdysseyLevelTime_v7_26', 12345, details)).toBe(false);
        expect(after.betterScore('OdysseyLevelTime_v7_26_g2', 900, 1000)).toBe(true);
        expect(after.betterScore('OdysseyLevelTime_v7_26_g2', 1100, 1000)).toBe(false);
    });

    it('stays inside Valve\'s leaderboard name limit and its plain characters at any generation', () => {
        const names = [...Object.keys(BOARDS), odysseyTimeBoardName(60, { 60: 999999 })];
        for (const name of names) {
            expect(Buffer.byteLength(name, 'utf8')).toBeLessThan(STEAM_LEADERBOARD_NAME_MAX_BYTES);
            expect(name).toMatch(/^[A-Za-z0-9_]+$/);
        }
        expect(STEAM_LEADERBOARD_NAME_MAX_BYTES).toBe(128);
    });

    it('refuses a generation that is not a whole number from 1 up', () => {
        for (const generation of [0, -1, 1.5, '2', null, NaN]) {
            expect(() => odysseyTimeBoardName(7, /** @type {any} */ ({ 7: generation }))).toThrow(RangeError);
            expect(() => createSteamCatalogue(/** @type {any} */ ({ 7: generation }))).toThrow(RangeError);
        }
        // An id that happens to be a property of every object is not a table entry.
        expect(odysseyTimeBoardName('constructor', {})).toBe('OdysseyLevelTime_v7_constructor');
    });

    it('ships a table that names only timed orbs, each on generation 2 or later', () => {
        for (const [orb, generation] of Object.entries(ODYSSEY_TIME_BOARD_GENERATIONS)) {
            expect(TIMED_ORBS).toContain(Number(orb));
            expect(Number.isInteger(generation) && generation >= 2).toBe(true);
        }
        // One board per timed orb, under the name the single source gives it.
        const orbBoards = Object.values(BOARDS).filter((board) => board.orb);
        expect(orbBoards.map((board) => board.orb).sort((a, b) => a - b)).toEqual(TIMED_ORBS);
        for (const board of orbBoards) expect(board.name).toBe(odysseyTimeBoardName(board.orb));
        expect(Object.keys(BOARDS)).toHaveLength(64);
    });

    it('knows an orb time board of any campaign version and generation, current or retired', () => {
        for (const name of ['OdysseyLevelTime_v2_7', 'OdysseyLevelTime_v6_39', 'OdysseyLevelTime_v7_7',
            'OdysseyLevelTime_v7_26_g2', 'OdysseyLevelTime_v8_60_g12']) {
            expect(isOdysseyTimeBoardName(name)).toBe(true);
        }
        for (const name of ['OdysseyTotalStars_v3', 'InfinitySurvivalTime_v1', 'OdysseyLevelTime_v7_',
            'OdysseyLevelTime_v0_1', 'OdysseyLevelTime_v7_26_g0', 'OdysseyLevelTime_v7_26_g', 'OdysseyLevelTime_v7_26_g2x',
            'xOdysseyLevelTime_v7_26', 'Random', '', null, undefined, 7]) {
            expect(isOdysseyTimeBoardName(name)).toBe(false);
        }
    });
});

describe('a time set on an earlier generation of an orb\'s board', () => {
    afterEach(() => {
        vi.doUnmock(CATALOGUE);
        vi.resetModules();
    });

    it('stops racing when the orb moves to a new board, and keeps its stars and its place in history', async () => {
        // The record book as it would be built if orb 7 were bumped to generation 2.
        vi.resetModules();
        vi.doMock(CATALOGUE, async () => {
            const actual = /** @type {typeof import('../../src/core/steam/steam-catalogue.js')} */ (
                await vi.importActual(CATALOGUE));
            return { ...actual, ...actual.createSteamCatalogue({ 7: 2 }) };
        });
        const { assessRecords, localOrbBest } = await import('../../src/core/progression/record-book.js');

        const run = {
            mode: 'odyssey', owner: null, level: 7, lines: 20, assisted: false,
        };
        const earlier = { ...run, duration: 30, timeMs: 30000, stars: 30, timeBoard: 'OdysseyLevelTime_v7_7' };
        const current = { ...run, duration: 41, timeMs: 41000, stars: 31, timeBoard: 'OdysseyLevelTime_v7_7_g2' };
        const neighbour = { ...run, level: 6, duration: 20, timeMs: 20000, stars: 31, timeBoard: 'OdysseyLevelTime_v7_6' };

        // Alone, the earlier time claims no board, but the run still counts.
        expect(localOrbBest({ runs: { earlier } }, 7)).toBeNull();
        const alone = assessRecords({ runs: { earlier } });
        expect(Object.keys(alone.bests)).toEqual(['OdysseyTotalStars_v3']);
        expect(alone.bests.OdysseyTotalStars_v3).toMatchObject({ id: 'earlier', score: 30 });
        expect(alone.values).toMatchObject({ odyssey_stars: 30, total_lines_cleared: 20, playtime_minutes: 1 });
        expect(alone.awards).toContain('ACH_ODYSSEY_FIRST_ORB');

        // Beside a slower time on the new board, the faster earlier one does not win it.
        const book = { runs: { earlier, current, neighbour } };
        expect(localOrbBest(book, 7)).toBe(41000);
        expect(localOrbBest(book, 7, 'current')).toBeNull();
        const { bests } = assessRecords(book);
        expect(bests).not.toHaveProperty('OdysseyLevelTime_v7_7');
        expect(bests.OdysseyLevelTime_v7_7_g2).toMatchObject({ id: 'current', score: 41000 });
        // The orb next door never moved.
        expect(localOrbBest(book, 6)).toBe(20000);
        expect(bests.OdysseyLevelTime_v7_6).toMatchObject({ id: 'neighbour', score: 20000 });
    });
});
