import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

// A late joiner (drop-in mid-match) is isAlive:false just like an ELIMINATED player, but the
// UI must show them differently — a "waiting / next round" state, never the skull. The
// `awaitingSpawn` flag is what distinguishes the two. This guards its full lifecycle:
// set on a mid-match join, serialized in the snapshot, cleared when they actually spawn.
function makeHost(overrides = {}) {
    return Object.assign(Object.create(FFAGameStateP2P.prototype), {
        isHost: true,
        localPlayerId: 'HOST',
        players: new Map(),
        loopRunning: false,
        gamePhase: 'waiting',
        sharedSeed: 123,
        matchConfig: { mode: 'ffa', maxPlayers: 8 },
        roundGeneration: 1,
        hotPotatoState: null,
        winner: null,
        hostTick: 0,
        simTick: 0,
        snapshotSeq: 0,
        migrationEpoch: 0,
        network: { sendP2PMessage: vi.fn() },
        broadcastPlayerList: vi.fn(),
        syncUnifiedLoopPlayers: vi.fn(),
        queueResync: vi.fn(),
        ...overrides,
    });
}

describe('FFA late-joiner awaitingSpawn flag', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('a player joining while a match is playing is awaitingSpawn (not eliminated)', () => {
        const state = makeHost({ gamePhase: 'playing' });
        // Host is local and present from the start — never awaitingSpawn.
        state.addPlayer('HOST', 'Host', true);
        // Late joiner drops in mid-match.
        state.addPlayer('LATE', 'Latecomer', false);

        const host = state.players.get('HOST');
        const late = state.players.get('LATE');

        expect(host.awaitingSpawn).toBe(false);
        expect(host.isAlive).toBe(true);

        // isAlive:false (the unified loop skips them) but awaitingSpawn marks them as a
        // waiting drop-in, NOT an eliminated player.
        expect(late.isAlive).toBe(false);
        expect(late.awaitingSpawn).toBe(true);
    });

    it('a player joining before the match starts spawns normally (not awaitingSpawn)', () => {
        const state = makeHost({ gamePhase: 'waiting' });
        state.addPlayer('P2', 'Player Two', false);

        const p2 = state.players.get('P2');
        expect(p2.isAlive).toBe(true);
        expect(p2.awaitingSpawn).toBe(false);
    });

    it('serializes awaitingSpawn into the state snapshot for every player', () => {
        const state = makeHost({ gamePhase: 'playing' });
        state.addPlayer('HOST', 'Host', true);
        state.addPlayer('LATE', 'Latecomer', false);

        const snapshot = state.buildStateSnapshot();
        const byId = Object.fromEntries(snapshot.players.map((p) => [p.steamId, p]));

        expect(byId.HOST.awaitingSpawn).toBe(false);
        expect(byId.LATE.awaitingSpawn).toBe(true);
        // The eliminated/late distinction is independent of isAlive on the wire.
        expect(byId.LATE.isAlive).toBe(false);
    });

    it('renderAllPlayers copies awaitingSpawn into the RENDER_FRAME payload (the live host+peer feed)', () => {
        // This is the path that broke even the HOST: the player objects carry awaitingSpawn,
        // but renderAllPlayers built the per-frame payload WITHOUT it, so the opponent
        // mini-boards saw undefined → skull. Guard the copy.
        const state = makeHost({ gamePhase: 'playing' });
        state._renderPayload = { players: Array.from({ length: 8 }, () => ({})), playerCount: 0 };
        state.addPlayer('HOST', 'Host', true);
        state.addPlayer('LATE', 'Latecomer', false);

        state.renderAllPlayers();

        const payload = state._renderPayload.players.slice(0, state._renderPayload.playerCount);
        const byId = Object.fromEntries(payload.map((p) => [p.steamId, p]));
        expect(byId.HOST.awaitingSpawn).toBe(false);
        expect(byId.LATE.awaitingSpawn).toBe(true);
    });

    it('clears awaitingSpawn when the late joiner is initialized for a round', () => {
        const state = makeHost({ gamePhase: 'playing' });
        state.addPlayer('LATE', 'Latecomer', false);
        const late = state.players.get('LATE');
        expect(late.awaitingSpawn).toBe(true);

        // Next round restart re-inits every player with the shared seed — the joiner spawns.
        state.initializePlayerForMatch(late, state.sharedSeed);

        expect(late.awaitingSpawn).toBe(false);
        expect(late.isAlive).toBe(true);
    });
});
