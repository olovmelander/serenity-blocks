/**
 * Every attack counts once, and garbage lands at a spawn.
 *
 * - A peer reports its own clears (game:attack:request), so when gravity locks the
 *   host's copy of a peer's board, that copy must not route the same clear again.
 * - Garbage waits for the victim's next spawn on the host too. Inserting at once
 *   whenever the victim had no piece also fired during its line-clear animation and
 *   corrupted the cascade on the host's copy.
 */
import { describe, expect, it, vi } from 'vitest';
import { FFAAttackRouter } from '../../src/core/multiplayer/ffa-attack-router.js';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { GarbageQueue } from '../../src/core/garbage.js';

describe('a clear is routed once', () => {
    it('registers the host\'s copy of a peer\'s board without attack routing', () => {
        const registered = new Map();
        const game = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: true,
            localPlayerId: 'HOST',
            _authoritativeAttacksEnabled: false,
            players: new Map([['HOST', { gameState: {} }], ['PEER', { gameState: {} }]]),
            attackRouter: { routeAttack: vi.fn() },
            _recordNetEvent: vi.fn(),
            unifiedLoop: {
                clearPlayers: vi.fn(),
                registerPlayer: (id, gameState, callbacks) => registered.set(id, callbacks),
            },
        });

        game.syncUnifiedLoopPlayers();
        registered.get('PEER').onGarbageReady({ depth: 2 });
        expect(game.attackRouter.routeAttack).not.toHaveBeenCalled();

        registered.get('HOST').onGarbageReady({ depth: 2 });
        expect(game.attackRouter.routeAttack).toHaveBeenCalledTimes(1);
        expect(game.attackRouter.routeAttack).toHaveBeenCalledWith('HOST', { depth: 2 });
    });
});

describe('garbage waits for a spawn', () => {
    it('never goes in while the victim is between pieces, mid-cascade', () => {
        const victim = {
            steamId: 'V',
            name: 'Victim',
            isAlive: true,
            _lockSeq: 3,
            garbageQueue: new GarbageQueue(),
            gameState: { currentPiece: null, isProcessingPhysics: true, isGameOver: false },
        };
        const attacker = { ...victim, steamId: 'A', name: 'Attacker', garbageQueue: new GarbageQueue() };
        const gameState = {
            isHost: true,
            debugGarbage: false,
            players: new Map([['A', attacker], ['V', victim]]),
            matchConfig: { boringRules: false, attackRules: {} },
            network: { broadcastToAll: vi.fn() },
            applyGarbageCounter: vi.fn(() => 0),
            insertPendingGarbage: vi.fn(),
            _recordNetEvent: vi.fn(),
            _createAttackMetadata: vi.fn(() => ({ attackId: 'r1-a1', attackSeq: 1, attackerId: 'A' })),
        };

        const row = (hole) => Array.from({ length: 10 }, (_, x) => x === hole);
        new FFAAttackRouter(gameState).routeAttack('A', { depth: 3, holeMask: [row(0), row(1)] });

        expect(gameState.insertPendingGarbage).not.toHaveBeenCalled();
        expect(victim.garbageQueue.getTotalLines()).toBe(2);
    });
});
