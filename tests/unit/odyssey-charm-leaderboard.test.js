import { describe, expect, it, vi } from 'vitest';
import { assessRecords } from '../../src/core/progression/record-book.js';
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
        const { bests } = assessRecords({ runs: { [id]: run } });
        expect(bests.OdysseyTotalStars_v3.score).toBe(12);
        expect(bests.OdysseyLevelTime_v6_7?.score ?? null).toBe(time);
    });
});
