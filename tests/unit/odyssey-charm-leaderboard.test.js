/* eslint-disable import/first */
import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));
vi.mock('../../src/core/steam/steam-service.js', () => ({
    default: {
        uploadScore: vi.fn(async () => {}),
        setStat: vi.fn(async () => {}),
        incrementStat: vi.fn(async () => {}),
    },
}));

import steamService from '../../src/core/steam/steam-service.js';
import { STEAM_LEADERBOARDS } from '../../src/core/steam/steam-config.js';
import { DEMO_LEGACY_SIMULATION_CLOCK } from '../../src/core/demo/DemoRecorder.js';
import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';

/**
 * Audit 2026-10-18: a charm-eased run raced plain runs on the orb's time leaderboard. Charms v3
 * (docs/ODYSSEY_CHARMS_AUDIT_2026-10.md §5.5): a run that used a charm stays off the orb's time
 * board, silently; its stars count in full, and the details name the charms used.
 */
describe('Odyssey leaderboards and charms', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function syncFor(charms) {
        const mode = Object.create(OdysseyMode.prototype);
        mode.odysseyState = { getTotalStars: () => 12 };
        return mode._syncSteamStats(
            {
                time: 90, score: 4200, lines: 20, stars: 3, charms,
            },
            { levelId: 7, simulationClock: DEMO_LEGACY_SIMULATION_CLOCK },
        );
    }
    const details = (call) => steamService.uploadScore.mock.calls[call][2];

    it('posts a plain run to the star total and the orb time board, with no charms in the details', async () => {
        await syncFor([]);
        const boards = steamService.uploadScore.mock.calls.map(([board]) => board);
        expect(boards).toEqual([
            STEAM_LEADERBOARDS.ODYSSEY_TOTAL_STARS,
            `${STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX}7`,
        ]);
        expect(details(1)).toMatchObject({ charms: [], stars: 3, timeMs: 90000 });
    });

    it('keeps a run that used a charm off the orb time board, counts its stars, and names the charms used', async () => {
        await syncFor(['tide', 'hearth']);
        const boards = steamService.uploadScore.mock.calls.map(([board]) => board);
        expect(boards).toEqual([STEAM_LEADERBOARDS.ODYSSEY_TOTAL_STARS]);
        expect(details(0)).toMatchObject({ charms: ['tide', 'hearth'], stars: 3, totalStars: 12 });
        expect(steamService.setStat).toHaveBeenCalledWith('odyssey_stars', 12);
    });
});
