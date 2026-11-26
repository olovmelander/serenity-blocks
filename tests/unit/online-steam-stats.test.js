/**
 * Lifetime Steam stats from an online match, fed by the real frag tracker. A free-for-all has
 * no rounds and a knocked-out player comes straight back, so its knock-outs are bounded by the
 * frags goal or by the time played. Bounding them by opponents x rounds (the Survivor rule)
 * recorded a ten-frag win as one kill.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { FragTracker } from '../../src/core/multiplayer/frag-tracker.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import {
    FFA_KNOCKOUT_PACE_MS, MAX_FRAGS_GOAL, MAX_MATCH_MINUTES, matchStatsForSteam, maxMatchKills,
    syncFfaSteamStats,
} from '../../src/core/game-modes/online-steam-stats.js';
import { assessRecords } from '../../src/core/progression/record-book.js';

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/**
 * A host's match played to its end on the real frag tracker: the first player knocks the
 * others out in turn, and in a free-for-all each victim is back before the next knock-out.
 * @param {{ gameType: 'ffa' | 'survivor', players: number, goal: number }} match
 */
function playToTheGoal({ gameType, players: playerCount, goal }) {
    /** @type {Array<[string, any]>} */
    const sent = [];
    const players = new Map();
    for (let i = 0; i < playerCount; i += 1) {
        const steamId = `7656119800000000${i}`;
        players.set(steamId, {
            steamId,
            name: `P${i}`,
            frags: 0,
            isAlive: true,
            isDisconnected: false,
            gameState: { score: 1000 * (playerCount - i), lines: 60, piecesPlaced: 300 },
            garbageQueue: { clear() {} },
        });
    }
    const game = {
        isHost: true,
        players,
        gamePhase: 'playing',
        matchConfig: { gameType, endCondition: 'frags', endConditionValue: goal },
        matchStartTime: Date.now() - 9 * 60_000,
        network: {
            matchId: '109775240917120077',
            matchNonce: 'a1b2c3d4e5f60718',
            broadcastToAll: (/** @type {string} */ type, /** @type {any} */ data) => sent.push([type, data]),
        },
        stopStateSyncLoop() {},
        stopGameLoop() {},
        getAttackStats: () => [],
        _advertiseLobbyState() {},
        roundGeneration: 1,
        restartMatch() {},
        _disposed: false,
    };
    const tracker = new FragTracker(/** @type {any} */ (game));
    /** @type {any} */ (game).fragTracker = tracker;

    const ids = [...players.keys()];
    const winner = ids[0];
    let knockOuts = 0;
    while (game.gamePhase === 'playing' && knockOuts < 500) {
        const victim = ids[1 + (knockOuts % (playerCount - 1))];
        if (gameType === 'ffa') players.get(victim).isAlive = true; // back at a key
        else if (!players.get(victim).isAlive) break; // Survivor: one life a round
        tracker.recordDeath(victim, winner);
        knockOuts += 1;
    }
    const result = sent.find(([type]) => type === MessageTypes.GAME_MATCH_END)?.[1];
    return {
        result, winner, knockOuts, matchConfig: game.matchConfig,
    };
}

/** A record book that keeps what a match saves. */
function recordBook() {
    /** @type {Record<string, any>} */
    const runs = {};
    return {
        runs,
        saveCompletion: async (/** @type {string} */ id, /** @type {any} */ receipt) => {
            if (!runs[id]) runs[id] = receipt; // a match's record is written once
        },
    };
}

describe('a free-for-all match in lifetime Steam stats', () => {
    it.each([2, 4, 8])('counts every knock-out of a ten-frag win with %i players', async (players) => {
        const {
            result, winner, knockOuts, matchConfig,
        } = playToTheGoal({ gameType: 'ffa', players, goal: 10 });
        expect(knockOuts).toBe(10);
        expect(result.isGameOver).toBe(true);
        expect(result.finalStats[0]).toMatchObject({ steamId: winner, frags: 10, placement: 1 });

        const records = recordBook();
        // The round counter never rises in a free-for-all (no round restarts).
        const local = {
            records, localSteamId: winner, rounds: 1, localLines: 60, matchConfig,
        };
        await syncFfaSteamStats(result, local);

        const [receipt] = Object.values(records.runs);
        expect(receipt).toMatchObject({ mode: 'ffa', kills: 10, win: true });
        const stats = assessRecords({ runs: records.runs }, receipt.owner).values;
        expect(stats).toMatchObject({ ffa_matches: 1, ffa_wins: 1, ffa_kills: 10 });

        // The same result delivered again adds nothing.
        await syncFfaSteamStats(result, local);
        expect(Object.keys(records.runs)).toHaveLength(1);
    });

    it('bounds a frags match by its goal, whatever the host reports', () => {
        const toTen = { gameType: 'ffa', endCondition: 'frags', endConditionValue: 10 };
        expect(matchStatsForSteam({ frags: 999, placement: 1 }, { players: 2, matchConfig: toTen }).kills).toBe(10);
        expect(maxMatchKills({ players: 8, matchConfig: { ...toTen, endConditionValue: 100 } })).toBe(100);
        // The create sheet stops at MAX_FRAGS_GOAL; a host's larger goal bounds no more than that.
        expect(maxMatchKills({ players: 8, matchConfig: { ...toTen, endConditionValue: 5000 } })).toBe(MAX_FRAGS_GOAL);
        expect(maxMatchKills({ players: 2, matchConfig: { ...toTen, endConditionValue: 'many' } })).toBe(1);
    });

    it('keeps the goal as the bound when the others have left by the end', () => {
        const toTen = { gameType: 'ffa', endCondition: 'frags', endConditionValue: 10 };
        // The last opponent's seat was let go, so the roster holds one player.
        expect(matchStatsForSteam({ frags: 4, placement: 1 }, { players: 1, matchConfig: toTen }).kills).toBe(4);
    });

    it('bounds a match without a frags goal by the time played', () => {
        const timed = { gameType: 'ffa', endCondition: 'time', endConditionValue: 5 };
        const fiveMinutes = 5 * 60_000;
        expect(maxMatchKills({ players: 4, durationMs: fiveMinutes, matchConfig: timed }))
            .toBe(fiveMinutes / FFA_KNOCKOUT_PACE_MS);
        // A match over in seconds still allows one knock-out per opponent.
        expect(maxMatchKills({ players: 4, durationMs: 4000, matchConfig: timed })).toBe(3);
        // A host's duration counts no further than the minutes cap.
        const endless = { gameType: 'ffa', endCondition: 'never' };
        expect(maxMatchKills({ players: 2, durationMs: Number.MAX_SAFE_INTEGER, matchConfig: endless }))
            .toBe((MAX_MATCH_MINUTES * 60_000) / FFA_KNOCKOUT_PACE_MS);
        expect(maxMatchKills({ players: 2, durationMs: -5, matchConfig: endless })).toBe(1);
    });
});

describe('a Survivor match in lifetime Steam stats', () => {
    it('still counts one knock-out per opponent per round', async () => {
        const survivor = { gameType: 'survivor', endCondition: 'frags', endConditionValue: 10 };
        expect(maxMatchKills({ players: 4, rounds: 3, matchConfig: survivor })).toBe(9);
        expect(maxMatchKills({ players: 2, rounds: 1, matchConfig: survivor })).toBe(1);

        const {
            result, winner, matchConfig,
        } = playToTheGoal({ gameType: 'survivor', players: 4, goal: 3 });
        const records = recordBook();
        await syncFfaSteamStats(result, {
            records, localSteamId: winner, rounds: 1, localLines: 60, matchConfig,
        });
        expect(Object.values(records.runs)[0]).toMatchObject({ kills: 3, win: true });
    });
});

describe('match rules this client could not read', () => {
    it('get whichever bound allows more, so a real result is never cut', async () => {
        // No game type: the Survivor bound (6) and the timed free-for-all bound (30).
        expect(maxMatchKills({ players: 4, rounds: 2 })).toBe(6);
        expect(maxMatchKills({ players: 4, rounds: 2, durationMs: 5 * 60_000 })).toBe(30);

        // The host's result names the goal even when the local rules are gone.
        const { result, winner } = playToTheGoal({ gameType: 'ffa', players: 2, goal: 10 });
        const records = recordBook();
        await syncFfaSteamStats(result, { records, localSteamId: winner, rounds: 1, localLines: 60 });
        expect(Object.values(records.runs)[0]).toMatchObject({ kills: 10 });
    });
});
