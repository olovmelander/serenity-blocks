/**
 * One writer for each opponent's board. The render frame shows an opponent's grid and
 * falling piece from the same interpolated moment; the 30 Hz snapshot handler passes
 * only metadata. A raw grid written between render frames, newer than the interpolated
 * one, flicked every opponent board between two states on each lock.
 */
import { describe, expect, it, vi } from 'vitest';
import { OnlineMultiplayerMode } from '../../src/core/game-modes/OnlineMultiplayerMode.js';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));

function makeMode() {
    const updateFromState = vi.fn();
    const mode = Object.assign(Object.create(OnlineMultiplayerMode.prototype), {
        steamNetworking: { steamId: 'ME' },
        snapshotInterpolator: { addSnapshot: vi.fn() },
        _updateInterpolationNetworkStats: vi.fn(),
        opponentWatchManager: { updateFromState },
        _standingsFinal: true,
    });
    return { mode, updateFromState };
}

describe('online versus: who draws an opponent\'s board', () => {
    it('hands the watch manager an opponent\'s metadata, never its grid or piece', () => {
        const { mode, updateFromState } = makeMode();
        mode._handleStateUpdate({
            players: [
                { steamId: 'ME', grid: [[1]], score: 1 },
                {
                    steamId: 'OPP', name: 'Opp', grid: [[1]], currentPiece: { x: 3 }, score: 50, isAlive: true,
                },
            ],
        });

        const [opponents] = updateFromState.mock.calls[0];
        expect(opponents).toEqual([expect.objectContaining({
            id: 'OPP', name: 'Opp', score: 50, isAlive: true,
        })]);
        expect(opponents[0]).not.toHaveProperty('grid');
        expect(opponents[0]).not.toHaveProperty('currentPiece');
    });
});
