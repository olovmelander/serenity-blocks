/**
 * A match that ends because every other player fell silent is a win, and it is also what a
 * player sees whose own connection broke: both sides of a cut link used to win, with the same
 * match ID. The side whose own connection to Steam is down is told so and records no win; when
 * both are still connected, both keep their result (online-departure-win.js).
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import {
    OWN_CONNECTION_CHECK_MS, OWN_CONNECTION_LOST, ownConnectionLost, settleMatchResult, wonBecauseEveryoneLeft,
} from '../../src/core/game-modes/online-departure-win.js';

const ME = '76561198000000001';
const OTHER = '76561198000000002';

/** @param {Record<string, { isDisconnected?: boolean }>} roster */
const players = (roster) => new Map(Object.entries(roster));
/** @param {string | null} status Steam's relay network status, as steam:getNetworkTransport names it */
const network = (status) => ({ relayNetworkStatus: vi.fn(async () => status) });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('a win because everyone else left', () => {
    it('is a win with no other present player in the match', () => {
        const won = { winner: { steamId: ME } };
        expect(wonBecauseEveryoneLeft(won, { localSteamId: ME, players: players({ [ME]: {} }) })).toBe(true);
        expect(wonBecauseEveryoneLeft(won, {
            localSteamId: ME, players: players({ [ME]: {}, [OTHER]: { isDisconnected: true } }),
        })).toBe(true);
        // The winner as a bare ID, as the match-end message carries it.
        expect(wonBecauseEveryoneLeft({ winner: ME }, { localSteamId: ME, players: players({ [ME]: {} }) })).toBe(true);
    });

    it('is not a goal reached with the others still there, a loss, or a draw', () => {
        const both = players({ [ME]: {}, [OTHER]: {} });
        expect(wonBecauseEveryoneLeft({ winner: { steamId: ME } }, { localSteamId: ME, players: both })).toBe(false);
        expect(wonBecauseEveryoneLeft({ winner: { steamId: OTHER } }, {
            localSteamId: ME, players: players({ [ME]: {} }),
        })).toBe(false);
        expect(wonBecauseEveryoneLeft({ winner: null }, { localSteamId: ME, players: players({ [ME]: {} }) })).toBe(false);
        expect(wonBecauseEveryoneLeft({ winner: { steamId: ME } }, { localSteamId: ME })).toBe(false);
    });
});

describe('whether this computer\'s own connection is down', () => {
    it('is yes when the operating system reports no network', async () => {
        const steam = network('current');
        expect(await ownConnectionLost(steam, { online: false })).toBe(true);
        expect(steam.relayNetworkStatus).not.toHaveBeenCalled();
    });

    it.each(['cannot-try', 'failed', 'previously', 'retrying'])(
        'is yes when Steam\'s relay network reads "%s"',
        async (status) => {
            expect(await ownConnectionLost(network(status), { online: true })).toBe(true);
        },
    );

    it('is no when the relay network is reachable, unknown or cannot be asked', async () => {
        expect(await ownConnectionLost(network('current'), { online: true })).toBe(false);
        expect(await ownConnectionLost(network(null), { online: true })).toBe(false);
        expect(await ownConnectionLost(null, { online: true })).toBe(false);
        const broken = { relayNetworkStatus: vi.fn(async () => { throw new Error('no ipc'); }) };
        expect(await ownConnectionLost(broken, { online: true })).toBe(false);
    });

    it('never holds the results longer than its limit: no answer counts as connected', async () => {
        const silent = { relayNetworkStatus: vi.fn(() => new Promise(() => {})) };
        const answer = ownConnectionLost(silent, { online: true });
        await vi.advanceTimersByTimeAsync(OWN_CONNECTION_CHECK_MS);
        expect(await answer).toBe(false);
    });
});

describe('settling a finished match', () => {
    /** The online mode as the settlement uses it. */
    function mode({ relay = 'current', roster = { [ME]: {} } } = {}) {
        return {
            steamNetworking: { steamId: ME, ...network(relay) },
            ffaGameState: {
                players: players(roster),
                matchConfig: { gameType: 'ffa', endCondition: 'frags', endConditionValue: 10 },
                getLocalPlayer: () => ({ gameState: { lines: 30 } }),
            },
            deps: { highScoreManager: { saveCompletion: vi.fn(async () => {}) } },
            roundNumber: 1,
            _recordAndShowResults: vi.fn(),
            _handleKicked: vi.fn(),
            _ownConnectionCheck: null,
        };
    }
    const won = { winner: { steamId: ME }, isGameOver: true };
    const settled = () => vi.advanceTimersByTimeAsync(0);

    beforeEach(() => vi.stubGlobal('navigator', { onLine: true }));
    afterEach(() => vi.unstubAllGlobals());

    it('records and shows an ordinary result at once', () => {
        const game = mode({ roster: { [ME]: {}, [OTHER]: {} } });
        settleMatchResult(game, won);
        expect(game._recordAndShowResults).toHaveBeenCalledWith(won);
        expect(game.steamNetworking.relayNetworkStatus).not.toHaveBeenCalled();
    });

    it('keeps a win by departure when this computer is still connected', async () => {
        const game = mode();
        settleMatchResult(game, won);
        expect(game._recordAndShowResults).not.toHaveBeenCalled();
        await settled();
        expect(game._recordAndShowResults).toHaveBeenCalledWith(won);
        expect(game._handleKicked).not.toHaveBeenCalled();
        expect(game._ownConnectionCheck).toBe(null);
    });

    it('records no win when it was this computer that dropped, and says so', async () => {
        const game = mode({ relay: 'previously' });
        settleMatchResult(game, won);
        await settled();
        expect(game._recordAndShowResults).not.toHaveBeenCalled();
        expect(game._handleKicked).toHaveBeenCalledWith({ reason: OWN_CONNECTION_LOST });
    });

    it('settles a result once when it is delivered again during the check', async () => {
        const game = mode();
        settleMatchResult(game, won);
        settleMatchResult(game, won);
        await settled();
        expect(game._recordAndShowResults).toHaveBeenCalledTimes(1);
        expect(game.steamNetworking.relayNetworkStatus).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the session closed during the check and the connection was lost', async () => {
        const game = mode({ relay: 'failed' });
        settleMatchResult(game, won);
        game._ownConnectionCheck = null; // the mode's cleanup
        await settled();
        expect(game._recordAndShowResults).not.toHaveBeenCalled();
        expect(game._handleKicked).not.toHaveBeenCalled();
        expect(game.deps.highScoreManager.saveCompletion).not.toHaveBeenCalled();
    });

    it('still records a real win when the player closes the session during the check', async () => {
        const game = mode();
        const result = {
            ...won,
            recordId: 'lobby-1:nonce-1',
            duration: 90_000,
            finalStats: [{ steamId: ME, frags: 4, lines: 30, placement: 1 }],
        };
        settleMatchResult(game, result);
        // The last opponent quit and the winner leaves at once: the mode lets everything go.
        game._ownConnectionCheck = null;
        game.ffaGameState = null;
        await settled();
        await settled();

        expect(game._recordAndShowResults).not.toHaveBeenCalled(); // no results sheet over a closed session
        expect(game.deps.highScoreManager.saveCompletion).toHaveBeenCalledTimes(1);
        expect(game.deps.highScoreManager.saveCompletion).toHaveBeenCalledWith(
            `ffa:lobby-1:nonce-1:${ME}`,
            expect.objectContaining({ mode: 'ffa', win: true, kills: 4 }),
        );
    });
});
