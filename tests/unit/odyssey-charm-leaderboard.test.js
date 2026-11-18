import { describe, expect, it, vi } from 'vitest';
import { assessRecords, localOrbBest } from '../../src/core/progression/record-book.js';
import { DEMO_LEGACY_SIMULATION_CLOCK } from '../../src/core/demo/DemoRecorder.js';
import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class {} }));

describe('Odyssey completed-run publication', () => {
    it.each([[[], 90000], [['charm'], null]])('saves stars and admits only unassisted times', async (charms, time) => {
        const mode = Object.create(OdysseyMode.prototype);
        const saveCompletion = vi.fn();
        mode.deps = { highScoreManager: { saveCompletion } };
        mode.odysseyState = { getTotalStars: () => 12 };
        const session = { levelId: 7, simulationClock: DEMO_LEGACY_SIMULATION_CLOCK };
        const result = { time: 90, score: 4200, lines: 20, stars: 3, charms };
        await mode._syncSteamStats(result, session);
        await mode._syncSteamStats(result, session);
        const [[id, run], [second]] = saveCompletion.mock.calls;
        expect(second).toBe(id);
        expect(run.timeBoard).toBe(charms.length ? null : 'OdysseyLevelTime_v7_7');
        const { bests } = assessRecords({ runs: { [id]: run } });
        expect(bests.OdysseyTotalStars_v3.score).toBe(12);
        expect(bests.OdysseyLevelTime_v7_7?.score ?? null).toBe(time);
    });

    it('keeps older runs and their stars when the current time board starts fresh', () => {
        const prior = {
            mode: 'odyssey', owner: null, level: 7, duration: 20, timeMs: 20000, assisted: false, stars: 40,
        };
        const runs = {
            unversioned: prior,
            retired: { ...prior, timeBoard: 'OdysseyLevelTime_v6_7' },
            otherOrb: { ...prior, timeBoard: 'OdysseyLevelTime_v7_6' },
        };
        expect(localOrbBest({ runs }, 7)).toBeNull();
        expect(assessRecords({ runs }).bests).toHaveProperty('OdysseyTotalStars_v3.score', 40);
        expect(assessRecords({ runs }).bests).not.toHaveProperty('OdysseyLevelTime_v7_7');

        const current = { ...prior, duration: 30, timeMs: 30000, stars: 32, timeBoard: 'OdysseyLevelTime_v7_7' };
        const book = { runs: { ...runs, current } };
        expect(localOrbBest(book, 7)).toBe(30000);
        expect(localOrbBest(book, 7, 'current')).toBeNull();
        expect(assessRecords(book).bests).toMatchObject({
            OdysseyLevelTime_v7_7: { id: 'current', score: 30000 },
            OdysseyTotalStars_v3: { score: 40 },
        });
    });
});
