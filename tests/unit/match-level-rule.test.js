/**
 * The level rule of a multiplayer match (match-level-rule.js): every board starts at the
 * match's starting level and stays there unless levelling up is turned on. Pinned for the
 * rule itself, for local versus, and end to end for an online match (helpers/session-wire.js),
 * where the host and each peer's own simulation must apply the same rule from one config.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { LEVEL_SPEEDS } from '../../src/core/constants.js';
import { GameState } from '../../src/core/game.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import {
    MATCH_START_LEVEL_MAX,
    applyMatchLevelRule,
    describeMatchLevelRule,
    readMatchLevelRule,
} from '../../src/core/multiplayer/match-level-rule.js';
import { ROUND_OVER_BEAT_MS } from '../../src/core/multiplayer/ffa-round-policy.js';
import {
    buildSession, disposeSession, installSessionDom, step,
} from './helpers/session-wire.js';

describe('the match level rule', () => {
    it('is a fixed level 1 unless a config says otherwise', () => {
        expect(readMatchLevelRule(undefined)).toEqual({ startLevel: 1, levelProgression: false });
        expect(readMatchLevelRule({})).toEqual({ startLevel: 1, levelProgression: false });
        // Only a real `true` turns levelling up on.
        expect(readMatchLevelRule({ levelProgression: 'on' }).levelProgression).toBe(false);
        expect(readMatchLevelRule({ levelProgression: true }).levelProgression).toBe(true);
    });

    it('keeps the starting level inside the sheets\' range', () => {
        expect(readMatchLevelRule({ startLevel: 4 }).startLevel).toBe(4);
        expect(readMatchLevelRule({ startLevel: '6' }).startLevel).toBe(6);
        expect(readMatchLevelRule({ startLevel: 0 }).startLevel).toBe(1);
        expect(readMatchLevelRule({ startLevel: 99 }).startLevel).toBe(MATCH_START_LEVEL_MAX);
        expect(readMatchLevelRule({ startLevel: 'fast' }).startLevel).toBe(1);
    });

    it('puts a board on its level, at that level\'s speed, with levelling off', () => {
        const board = new GameState();
        expect(applyMatchLevelRule(board, { startLevel: 5 }, 8)).toBe(5); // a carried level is ignored
        expect(board.level).toBe(5);
        expect(board.dropInterval).toBe(LEVEL_SPEEDS[4]);
        expect(board.disableLevelProgression).toBe(true);
    });

    it('with levelling on, carries a higher level and never drops below the start', () => {
        const board = new GameState();
        const rising = { startLevel: 2, levelProgression: true };
        expect(applyMatchLevelRule(board, rising, 6)).toBe(6);
        expect(board.dropInterval).toBe(LEVEL_SPEEDS[5]);
        expect(board.disableLevelProgression).toBe(false);
        expect(applyMatchLevelRule(board, rising, 1)).toBe(2);
        expect(applyMatchLevelRule(board, rising)).toBe(2);
    });

    it('says what it is in a few words', () => {
        expect(describeMatchLevelRule({})).toBe('1, no level-ups');
        expect(describeMatchLevelRule({ startLevel: 3, levelProgression: true })).toBe('From 3, up every 15 lines');
    });
});

describe('local versus', () => {
    it('starts every player at a fixed level 1 by default', () => {
        const state = new MultiPlayerState(2);
        state.reset();
        state.players.forEach((board) => {
            expect(board.level).toBe(1);
            expect(board.dropInterval).toBe(LEVEL_SPEEDS[0]);
            expect(board.disableLevelProgression).toBe(true);
        });
    });

    it('takes the starting level and levelling up from the match config', () => {
        const state = new MultiPlayerState(2);
        state.setMatchConfig({ startLevel: 3, levelProgression: true });
        state.reset();
        state.players.forEach((board) => {
            expect(board.level).toBe(3);
            expect(board.dropInterval).toBe(LEVEL_SPEEDS[2]);
            expect(board.disableLevelProgression).toBe(false);
        });
    });
});

describe('online free-for-all', () => {
    let session = null;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        installSessionDom(vi);
    });

    afterEach(() => {
        if (session) disposeSession(session);
        session = null;
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    /** The host's boards and each peer's own board (the ones a client simulates). */
    const simulatedBoards = ({ host, peers }) => [
        ...[...host.players.values()].map((player) => player.gameState),
        ...peers.map((peer) => peer.players.get(peer.localPlayerId).gameState),
    ];

    const expectEvery = (boards, level, rising) => boards.forEach((board) => {
        expect(board.level).toBe(level);
        expect(board.dropInterval).toBe(LEVEL_SPEEDS[level - 1]);
        expect(board.disableLevelProgression).toBe(!rising);
    });

    /** End the round with the host the last one standing; the next one starts. */
    async function nextRound(vi2, { host, wire }) {
        host.matchConfig.endConditionValue = 99;
        host.players.forEach((player, id) => { if (id !== host.localPlayerId) player.isAlive = false; });
        host.fragTracker.checkMatchEnd();
        wire.drain();
        await step(vi2, wire, ROUND_OVER_BEAT_MS + 6000);
    }

    it('plays at a fixed level 1 when the host set nothing, on the host and on every peer', async () => {
        session = await buildSession(vi, { peerIds: ['P1', 'P2'] });
        session.host.startMatch();
        session.wire.drain();
        await step(vi, session.wire, 6000);
        expect(session.host.gamePhase).toBe('playing');
        expectEvery(simulatedBoards(session), 1, false);
    });

    it('gives every board the host\'s starting level, and keeps it fixed round after round', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host, peers: [peer] } = session;
        host.matchConfig = { ...host.matchConfig, startLevel: 5, levelProgression: false };
        host.startMatch();
        session.wire.drain();
        await step(vi, session.wire, 6000);
        expect(peer.matchConfig.startLevel).toBe(5);
        expectEvery(simulatedBoards(session), 5, false);

        // Whatever a board stood on at the end of a round, the next one is at the start level.
        host.players.forEach((player) => { player.gameState.level = 7; });
        peer.players.get('P1').gameState.level = 7;
        await nextRound(vi, session);
        expect(host.roundGeneration).toBeGreaterThan(1);
        expectEvery(simulatedBoards(session), 5, false);
    });

    it('with levelling on, carries each player\'s level into the next round at its speed', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host } = session;
        host.matchConfig = { ...host.matchConfig, startLevel: 2, levelProgression: true };
        host.startMatch();
        session.wire.drain();
        await step(vi, session.wire, 6000);
        expectEvery(simulatedBoards(session), 2, true);

        // Both players climbed to level 4 in round 1 (the host's count is the one carried).
        host.players.forEach((player) => { player.gameState.level = 4; });
        await nextRound(vi, session);
        expectEvery(simulatedBoards(session), 4, true);
    });
});
