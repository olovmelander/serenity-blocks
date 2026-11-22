/**
 * Online free-for-all (versus-rules.js, the default game type): a knock-out ends no round;
 * the player presses a key and plays on, on an empty well, and the host decides
 * (multiplayer/ffa/respawn.js). Survivor keeps its rounds.
 *
 * Real FFAGameStateP2P nodes over the loopback wire (helpers/session-wire.js).
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { MULTIPLAYER_EVENTS, onMultiplayerEvent } from '../../src/events/multiplayer-events.js';
import {
    RESPAWN_AFTER_MS, ensureAttackCredit, resetVersusCredit,
} from '../../src/core/multiplayer/versus-rules.js';
import {
    capturePieceStream, handleFfaPlayerRespawn, handleFfaRespawnRequest, predatesRespawn,
    respawnRefusal,
} from '../../src/core/multiplayer/ffa/respawn.js';
import { ROUND_OVER_BEAT_MS } from '../../src/core/multiplayer/ffa-round-policy.js';
import { HOST_GONE_MS } from '../../src/core/network/host-migration.js';
import { markBoardDirty, rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { HIDDEN_ROWS, ROWS } from '../../src/core/constants.js';
import {
    buildSession, disposeSession, installSessionDom, joinSession, startSessionMatch, step,
} from './helpers/session-wire.js';

let session = null;
const unsubscribes = [];

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installSessionDom(vi);
});

afterEach(() => {
    while (unsubscribes.length) unsubscribes.pop()();
    if (session) disposeSession(session);
    session = null;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** A stack to the top in every column but the last, so the next piece cannot appear. */
function stackToTheTop(gameState) {
    gameState.lockedPieces = [{
        type: 'GARBAGE',
        shapeKey: 'GARBAGE',
        color: '#808080',
        pieceId: 9000,
        x: 0,
        y: 2,
        shape: Array.from({ length: ROWS + HIDDEN_ROWS - 2 }, () => [1, 1, 1, 1, 1, 1, 1, 1, 1, 0]),
    }];
    rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
    markBoardDirty(gameState);
    gameState.currentPiece = null;
}

const occupied = (gameState) => gameState.boardGrid.flat().filter(Boolean).length;

/**
 * Knock a peer out the way play does: its next piece cannot appear, on the host's copy and
 * on its own board alike (each deals that piece). The frag goes to `killerId`.
 */
function knockOut({ host, wire }, peer, killerId = null) {
    const id = peer.localPlayerId;
    const hostCopy = host.players.get(id);
    if (killerId) hostCopy.lastAttackerId = killerId;
    stackToTheTop(hostCopy.gameState);
    host._spawnNextPieceForPlayer(id);
    const own = peer.players.get(id).gameState;
    stackToTheTop(own);
    peer.buildLocalPredictionCallbacks(id).spawnPiece();
    host.broadcastGameState();
    wire.drain();
}

/** The host's own player knocked out by a blocked spawn. */
function knockOutHost({ host, wire }) {
    const own = host.players.get(host.localPlayerId).gameState;
    stackToTheTop(own);
    host._spawnNextPieceForPlayer(host.localPlayerId);
    host.broadcastGameState();
    wire.drain();
}

/** Messages of one type the host sent, with their payloads. */
function sent(network, type) {
    return network.broadcastToAll.mock.calls.filter(([messageType]) => messageType === type).map(([, data]) => data);
}

/** A peer presses one of its keys (its window hooks ask the game state first). */
function pressKey(peer) {
    return peer.pressToRespawn();
}

/**
 * Hard-drop the local piece on a peer, `shift` columns over, and let both sides lock it
 * and deal the next.
 */
async function hardDrop({ wire }, peer, shift = 0) {
    for (let i = 0; i < Math.abs(shift); i += 1) peer.sendInput('move', { direction: Math.sign(shift) });
    peer.sendInput('drop', { type: 'hard' });
    peer.flushInputBatch();
    wire.drain();
    await vi.advanceTimersByTimeAsync(400);
    wire.drain();
}

/** The parts of a board both sides must agree on. */
function boardView(gameState) {
    return {
        piece: gameState.currentPiece?.type ?? null,
        next: gameState.nextPieces.slice(),
        rng: gameState.randomGenerator?.getState?.(),
        cells: occupied(gameState),
        score: gameState.score,
        lines: gameState.lines,
    };
}

describe('online free-for-all: a knock-out', () => {
    it('is the default game type, and every peer is told it with the match', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        expect(session.host.matchConfig.gameType).toBe('ffa');
        await startSessionMatch(vi, session);
        expect(session.peers[0].matchConfig.gameType).toBe('ffa');
    });

    it('ends no round: the frag counts, the board waits, and everyone else plays on', async () => {
        session = await buildSession(vi, { peerIds: ['P1', 'P2'] });
        const { host, wire, peers: [p1, p2] } = session;
        await startSessionMatch(vi, session);
        const broadcast = vi.spyOn(host.network, 'broadcastToAll');
        const rounds = [];
        unsubscribes.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_OVER, (d) => rounds.push(d)));
        host.players.get('P1').garbageQueue.enqueue({ type: 'line', attackerId: 'H0', holeMask: 1 });

        knockOut(session, p1, 'H0');

        expect(host.gamePhase).toBe('playing');
        expect(host._roundRestartTimer ?? null).toBeNull();
        expect(rounds).toEqual([]);
        expect(sent(host.network, MessageTypes.GAME_MATCH_END)).toEqual([]);
        expect(host.players.get('P1')).toMatchObject({ isAlive: false });
        expect(host.players.get('P1').garbageQueue.getTotalLines()).toBe(0); // its waiting rows go
        expect(host.players.get('H0').frags).toBe(1);
        expect(host.players.get('H0').isAlive).toBe(true);
        expect(host.players.get('P2').isAlive).toBe(true);
        expect(broadcast).toHaveBeenCalledWith(
            MessageTypes.GAME_PLAYER_DIED,
            expect.objectContaining({ player: 'P1', killer: 'H0' }),
        );
        // The peers see it, and keep playing.
        expect(p1.players.get('P1').isAlive).toBe(false);
        expect(p1.waitsToRespawn()).toBe(true);
        expect(p2.players.get('P1').isAlive).toBe(false);
        expect(p2.gamePhase).toBe('playing');
        expect(p2.waitsToRespawn()).toBe(false);

        // No restart comes later either.
        await step(vi, wire, ROUND_OVER_BEAT_MS + 1000);
        expect(host.gamePhase).toBe('playing');
        expect(host.players.get('P1').isAlive).toBe(false); // still waiting for its key
    });

    it('ends the match when it brings the frags to the goal', async () => {
        session = await buildSession(vi, { peerIds: ['P1', 'P2'] });
        const { host, peers: [p1, p2] } = session;
        host.matchConfig.endConditionValue = 2;
        await startSessionMatch(vi, session);
        const results = [];
        unsubscribes.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.GAME_OVER, (d) => results.push(d)));

        knockOut(session, p1, 'H0');
        expect(host.gamePhase).toBe('playing');
        knockOut(session, p2, 'H0');

        expect(host.gamePhase).toBe('finished');
        expect(host.winner?.steamId).toBe('H0');
        // The results, on each of the three clients (one bus in this process): a match over.
        expect(results).toHaveLength(3);
        results.forEach((result) => expect(result).toMatchObject({ isGameOver: true }));
        expect(host._roundRestartTimer ?? null).toBeNull();
        expect(p1.lastMatchResults?.isGameOver).toBe(true);
    });

    it('goes uncredited once the attacker\'s credit has faded; survivor keeps the last holder', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host } = session;
        await startSessionMatch(vi, session);
        const victim = host.players.get('P1');
        const lock = () => host.buildPhysicsCallbacks('P1').onPieceLock({});
        /** One row from the host reaches P1, as the attack router credits it. */
        const attack = () => {
            ensureAttackCredit(victim).noteAttack('H0', 1);
            victim.lastAttackerId = victim.fragCredit.killer;
        };

        host.matchConfig.gameType = 'survivor';
        attack();
        for (let i = 0; i < 4; i += 1) lock(); // two pieces spend one row's credit
        expect(victim.lastAttackerId).toBe('H0'); // survivor: the last holder keeps it

        host.matchConfig.gameType = 'ffa';
        resetVersusCredit(victim);
        attack();
        lock();
        expect(victim.lastAttackerId).toBe('H0'); // still some credit left
        lock();
        expect(victim.lastAttackerId).toBeNull(); // free-for-all: spent credit is forgotten
    });
});

describe('survivor', () => {
    it('still ends the round on the last one standing and restarts after the beat', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host, wire, peers: [p1] } = session;
        host.matchConfig.gameType = 'survivor';
        host.matchConfig.endConditionValue = 99;
        await startSessionMatch(vi, session);
        const generation = host.roundGeneration;

        knockOut(session, p1, 'H0');
        expect(host.gamePhase).toBe('finished');
        expect(host._roundRestartTimer).not.toBeNull();
        expect(p1.waitsToRespawn()).toBe(false);
        expect(pressKey(p1)).toBe(false); // keys play nothing until the next round
        wire.drain();
        expect(wire.count(MessageTypes.GAME_RESPAWN_REQUEST)).toBe(0);

        await step(vi, wire, ROUND_OVER_BEAT_MS + 500);
        expect(host.roundGeneration).toBe(generation + 1);
        expect(host.players.get('P1').isAlive).toBe(true);
        expect(p1.players.get('P1').isAlive).toBe(true);
    });
});

describe('asking to play again', () => {
    it('is a key a second after the knock-out, sent once, for the peer\'s own player', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host, wire, peers: [p1] } = session;
        await startSessionMatch(vi, session);
        knockOut(session, p1, 'H0');

        expect(pressKey(p1)).toBe(true); // the key is the prompt's...
        wire.drain();
        expect(wire.count(MessageTypes.GAME_RESPAWN_REQUEST)).toBe(0); // ...but too soon to ask
        expect(host.players.get('P1').isAlive).toBe(false);

        await step(vi, wire, RESPAWN_AFTER_MS);
        expect(pressKey(p1)).toBe(true);
        expect(pressKey(p1)).toBe(true); // a second key at once asks nothing more
        wire.drain();
        expect(wire.count(MessageTypes.GAME_RESPAWN_REQUEST, (m) => m.from === 'P1')).toBe(1);
        expect(host.players.get('P1').isAlive).toBe(true);
        expect(p1.players.get('P1').isAlive).toBe(true);
        expect(p1.waitsToRespawn()).toBe(false);
        expect(pressKey(p1)).toBe(false); // in play: keys play again
    });

    it('is refused for another player, a player in play, another round, too soon, or a resync on the way', async () => {
        session = await buildSession(vi, { peerIds: ['P1', 'P2'] });
        const { host, wire, peers: [p1] } = session;
        await startSessionMatch(vi, session);
        knockOut(session, p1, 'H0');
        const ask = (from, data = {}) => handleFfaRespawnRequest(host, {
            from,
            data: {
                playerSteamId: 'P1', roundGeneration: host.roundGeneration, afterRespawnSeq: 0, ...data,
            },
        });

        // P2 cannot bring P1 back, nor ask for the host's own player.
        const spoofs = host._spoofDrops || 0;
        expect(ask('P2')).toBe(false);
        expect(ask('P2', { playerSteamId: 'H0' })).toBe(false);
        expect(host._spoofDrops).toBe(spoofs + 2);
        expect(respawnRefusal(host, 'P2', { roundGeneration: host.roundGeneration })).toBe('in_play');
        expect(ask('P1')).toBe(false); // the knock-out was just now
        expect(respawnRefusal(host, 'P1', { roundGeneration: host.roundGeneration })).toBe('too_soon');

        vi.advanceTimersByTime(RESPAWN_AFTER_MS);
        expect(ask('P1', { roundGeneration: host.roundGeneration - 1 })).toBe(false);
        expect(respawnRefusal(host, 'P1', { roundGeneration: host.roundGeneration - 1 })).toBe('stale_round');
        expect(respawnRefusal(host, 'P1', { roundGeneration: host.roundGeneration, afterRespawnSeq: -1 }))
            .toBeNull();

        host.resyncTransfers.set('r-test', { steamId: 'P1' });
        expect(respawnRefusal(host, 'P1', { roundGeneration: host.roundGeneration })).toBe('resync_on_the_way');
        host.resyncTransfers.delete('r-test');

        host.matchConfig.gameType = 'survivor';
        expect(respawnRefusal(host, 'P1', { roundGeneration: host.roundGeneration })).toBe('not_free_for_all');
        host.matchConfig.gameType = 'ffa';

        expect(host.players.get('P1').isAlive).toBe(false);
        expect(ask('P1')).toBe(true);
        expect(host.players.get('P1').isAlive).toBe(true);
        // Asked again from before that respawn: the player is in play anyway.
        expect(respawnRefusal(host, 'P1', { roundGeneration: host.roundGeneration, afterRespawnSeq: 0 }))
            .toBe('in_play');
        wire.drain();

        // Out again: a request from before the last respawn is not a request for this one.
        knockOut(session, p1, 'H0');
        vi.advanceTimersByTime(RESPAWN_AFTER_MS);
        expect(respawnRefusal(host, 'P1', { roundGeneration: host.roundGeneration, afterRespawnSeq: 0 }))
            .toBe('already_respawned');
        expect(respawnRefusal(host, 'P1', { roundGeneration: host.roundGeneration, afterRespawnSeq: 1 }))
            .toBeNull();
    });
});

describe('the respawn', () => {
    it('resets the host\'s copy, tells everyone, and every board comes back the same', async () => {
        session = await buildSession(vi, { peerIds: ['P1', 'P2'] });
        const { host, wire, peers: [p1, p2] } = session;
        await startSessionMatch(vi, session);
        const hostCopy = host.players.get('P1');
        hostCopy.gameState.score = 4321;
        hostCopy.gameState.lines = 12;
        p1.players.get('P1').gameState.score = 4321;
        p1.players.get('P1').gameState.lines = 12;
        knockOut(session, p1, 'H0');
        await step(vi, wire, RESPAWN_AFTER_MS);
        hostCopy.gameState.handicaps = { H0: 3 };
        const broadcast = vi.spyOn(host.network, 'broadcastToAll');
        const snapshots = vi.spyOn(host.network, 'broadcastSnapshot');
        const respawned = [];
        unsubscribes.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_RESPAWNED, (d) => respawned.push(d.steamId)));

        pressKey(p1);
        wire.drain();

        // The host's copy: an empty well with its first piece, score and lines kept.
        expect(hostCopy).toMatchObject({
            isAlive: true, awaitingSpawn: false, lastAttackerId: null, crowdStamps: 0,
        });
        expect(hostCopy.gameState).toMatchObject({
            isGameOver: false, score: 4321, lines: 12, handicaps: {},
        });
        expect(occupied(hostCopy.gameState)).toBe(0);
        expect(hostCopy.gameState.currentPiece).toBeTruthy();
        expect(hostCopy.garbageQueue.getTotalLines()).toBe(0);

        // One respawn event, round-fenced and numbered, then the boards as usual.
        const events = sent(host.network, MessageTypes.GAME_PLAYER_RESPAWN);
        expect(events).toEqual([expect.objectContaining({
            playerSteamId: 'P1', respawnSeq: 1, roundGeneration: host.roundGeneration,
        })]);
        const eventCall = broadcast.mock.calls.findIndex(([type]) => type === MessageTypes.GAME_PLAYER_RESPAWN);
        expect(snapshots).toHaveBeenCalled();
        expect(snapshots.mock.invocationCallOrder[0]).toBeGreaterThan(broadcast.mock.invocationCallOrder[eventCall]);
        expect(respawned).toContain('P1');

        // The peer's own board and every opponent tile come back the same way.
        const own = p1.players.get('P1');
        expect(own).toMatchObject({ isAlive: true, _respawnSeq: 1 });
        expect(own.gameState).toMatchObject({ isGameOver: false, score: 4321, lines: 12 });
        expect(occupied(own.gameState)).toBe(0);
        expect(boardView(own.gameState)).toEqual(boardView(hostCopy.gameState));
        const seenByP2 = p2.players.get('P1');
        expect(seenByP2.isAlive).toBe(true);
        expect(occupied(seenByP2.gameState)).toBe(0);
        expect(seenByP2.gameState.currentPiece?.type).toBe(hostCopy.gameState.currentPiece.type);
    });

    it('keeps host and peer dealing the same pieces: no correction needed, and none after', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host, wire, peers: [p1] } = session;
        await startSessionMatch(vi, session);
        const hostCopy = host.players.get('P1').gameState;
        const own = p1.players.get('P1').gameState;
        expect(boardView(own)).toEqual(boardView(hostCopy));

        knockOut(session, p1, 'H0');
        await step(vi, wire, RESPAWN_AFTER_MS);
        // Each side dealt the piece that could not appear: their streams agree by themselves.
        const peerStream = capturePieceStream(own);
        expect(peerStream).toEqual(capturePieceStream(hostCopy));
        pressKey(p1);
        wire.drain();
        expect(own.isGameOver).toBe(false);
        expect(boardView(own)).toEqual(boardView(hostCopy));

        // Play on through the real input path: every piece the same on both sides.
        for (let i = 0; i < 9; i += 1) {
            await hardDrop(session, p1, [-4, 0, 3][i % 3]); // eslint-disable-line no-await-in-loop
            expect(own.isGameOver).toBe(false);
            expect(boardView(own)).toEqual(boardView(hostCopy));
        }
        expect(host.players.get('P1').lastInputSeq).toBe(p1.inputSequence);
    });

    it('brings the host\'s own player back at a key, with no request on the wire', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host, wire, peers: [p1] } = session;
        await startSessionMatch(vi, session);
        knockOutHost(session);
        expect(host.waitsToRespawn()).toBe(true);
        expect(p1.players.get('H0').isAlive).toBe(false);
        expect(host.pressToRespawn()).toBe(true);
        expect(host.players.get('H0').isAlive).toBe(false); // too soon

        await step(vi, wire, RESPAWN_AFTER_MS);
        expect(host.pressToRespawn()).toBe(true);
        wire.drain();
        expect(wire.count(MessageTypes.GAME_RESPAWN_REQUEST)).toBe(0);
        expect(host.players.get('H0').isAlive).toBe(true);
        expect(occupied(host.players.get('H0').gameState)).toBe(0);
        const seen = p1.players.get('H0');
        expect(seen.isAlive).toBe(true);
        expect(boardView(seen.gameState)).toEqual(boardView(host.players.get('H0').gameState));
    });

    it('is not undone by a frame from before it, and a frame that overtakes it wakes nothing early', async () => {
        session = await buildSession(vi, { peerIds: ['P1', 'P2'] });
        const { host, wire, peers: [p1, p2] } = session;
        await startSessionMatch(vi, session);
        knockOut(session, p1, 'H0');
        await step(vi, wire, RESPAWN_AFTER_MS);
        const stale = host.buildStateSnapshot(); // a frame still on the wire

        // A frame from after the respawn overtakes the reliable event at the knocked-out peer.
        host.players.get('P1').isAlive = true;
        const overtaking = host.buildStateSnapshot();
        overtaking.snapshotSeq = stale.snapshotSeq + 1;
        host.players.get('P1').isAlive = false;
        p1.syncFromHost(overtaking);
        expect(p1.players.get('P1').isAlive).toBe(false); // only the event brings it back
        expect(p1.players.get('P1').gameState.isGameOver).toBe(true);

        pressKey(p1);
        wire.drain();
        expect(p1.players.get('P1').isAlive).toBe(true);
        expect(predatesRespawn(p1.players.get('P1'), stale)).toBe(true);

        // The stale frame (P1 still out, the old stack) lands late on both peers.
        p1.syncFromHost(stale);
        p2.syncFromHost(stale);
        expect(p1.players.get('P1').isAlive).toBe(true);
        expect(p1.players.get('P1').gameState.isGameOver).toBe(false);
        expect(p2.players.get('P1').isAlive).toBe(true);
        expect(occupied(p2.players.get('P1').gameState)).toBe(0);

        // A frame from after the respawn applies as usual.
        host.broadcastGameState();
        wire.drain();
        expect(p2.players.get('P1').isAlive).toBe(true);
        expect(predatesRespawn(p2.players.get('P1'), host.buildStateSnapshot())).toBe(false);
    });

    it('applies once: a repeat changes nothing, and another round\'s is dropped', async () => {
        session = await buildSession(vi, { peerIds: ['P1', 'P2'] });
        const { host, wire, peers: [p1, p2] } = session;
        await startSessionMatch(vi, session);
        knockOut(session, p1, 'H0');
        await step(vi, wire, RESPAWN_AFTER_MS);
        const broadcast = vi.spyOn(host.network, 'broadcastToAll');
        pressKey(p1);
        wire.drain();
        const [event] = sent(host.network, MessageTypes.GAME_PLAYER_RESPAWN);
        broadcast.mockRestore();

        // P2 sees P1 play a piece, then the same event again: nothing happens.
        const seen = p2.players.get('P1').gameState;
        seen.score = 77;
        expect(handleFfaPlayerRespawn(p2, { from: 'H0', data: { ...event } })).toBe(false);
        expect(seen.score).toBe(77);
        // From a peer, or another round: dropped.
        p2.players.get('P1').isAlive = false;
        expect(handleFfaPlayerRespawn(p2, { from: 'P1', data: { ...event, respawnSeq: 2 } })).toBe(false);
        expect(handleFfaPlayerRespawn(p2, {
            from: 'H0', data: { ...event, respawnSeq: 2, roundGeneration: event.roundGeneration + 1 },
        })).toBe(false);
        expect(handleFfaPlayerRespawn(p2, { from: 'H0', data: { ...event, respawnSeq: 'x' } })).toBe(false);
        expect(p2.players.get('P1').isAlive).toBe(false);
        // A new host after a migration may count one short; a player out here still comes back.
        expect(handleFfaPlayerRespawn(p2, { from: 'H0', data: { ...event } })).toBe(true);
        expect(p2.players.get('P1').isAlive).toBe(true);
    });

    it('lets a player who joined during the match join in at a key, dealing the host copy\'s pieces', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host, wire } = session;
        await startSessionMatch(vi, session);
        const late = joinSession(vi, session, 'P2');
        await step(vi, wire, 2000);
        expect(host.players.get('P2')).toMatchObject({ isAlive: false, awaitingSpawn: true });
        expect(late.waitsToRespawn()).toBe(true);

        expect(pressKey(late)).toBe(true); // no knock-out to wait out
        wire.drain();
        expect(host.players.get('P2')).toMatchObject({ isAlive: true, awaitingSpawn: false });
        const own = late.players.get('P2');
        expect(own).toMatchObject({ isAlive: true, awaitingSpawn: false });
        expect(boardView(own.gameState)).toEqual(boardView(host.players.get('P2').gameState));
        for (let i = 0; i < 6; i += 1) {
            await hardDrop(session, late, [-4, 3][i % 2]); // eslint-disable-line no-await-in-loop
            expect(boardView(own.gameState)).toEqual(boardView(host.players.get('P2').gameState));
        }
    });

    it('comes from a new host after a migration while the player is out', async () => {
        session = await buildSession(vi, { peerIds: ['P1', 'P2'] });
        const { host, wire, peers: [p1, p2] } = session;
        await startSessionMatch(vi, session);
        knockOut(session, p2, 'P1');
        await step(vi, wire, RESPAWN_AFTER_MS);
        expect(p1.players.get('P2').isAlive).toBe(false);

        // The host crashes; the first-ranked survivor takes over and P2 follows.
        wire.cut(host.localPlayerId);
        host.cleanup();
        await step(vi, wire, HOST_GONE_MS + 6000, 250);
        expect(p1.isHost).toBe(true);
        expect(p2.network.hostSteamId).toBe('P1');
        expect(p1.players.get('P2').isAlive).toBe(false);
        expect(p2.waitsToRespawn()).toBe(true);

        expect(pressKey(p2)).toBe(true);
        wire.drain();
        expect(p1.players.get('P2').isAlive).toBe(true);
        expect(p2.players.get('P2').isAlive).toBe(true);
        expect(boardView(p2.players.get('P2').gameState)).toEqual(boardView(p1.players.get('P2').gameState));
    });
});
