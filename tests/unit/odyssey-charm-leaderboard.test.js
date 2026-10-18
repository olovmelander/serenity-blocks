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

/** Audit 2026-10-18: a charm-eased run raced plain runs on the orb's time leaderboard. */
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

    it('posts a plain run to the star total and the orb time board', async () => {
        await syncFor([]);
        const boards = steamService.uploadScore.mock.calls.map(([board]) => board);
        expect(boards).toEqual([
            STEAM_LEADERBOARDS.ODYSSEY_TOTAL_STARS,
            `${STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX}7`,
        ]);
    });

    it('keeps a charm-eased run off the orb time board, and counts its stars', async () => {
        await syncFor(['keel']);
        const boards = steamService.uploadScore.mock.calls.map(([board]) => board);
        expect(boards).toEqual([STEAM_LEADERBOARDS.ODYSSEY_TOTAL_STARS]);
        expect(steamService.setStat).toHaveBeenCalledWith('odyssey_stars', 12);
    });
});
