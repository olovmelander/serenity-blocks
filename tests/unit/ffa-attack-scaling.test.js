/**
 * @fileoverview Pins the online attack size rule: the versus crowd cut (versus-rules.js).
 * Every opponent receives the whole attack; the only cut is one row per three crowd stamps
 * the attacker holds, never on a move that empties the board or under boring rules.
 */

import { describe, it, expect, vi } from 'vitest';
import { FFAAttackRouter } from '../../src/core/multiplayer/ffa-attack-router.js';
import { GarbageAttack, GarbageQueue } from '../../src/core/garbage.js';

function makeRouter(matchConfig = {}) {
    return new FFAAttackRouter({ isHost: true, debugGarbage: false, matchConfig });
}

const attackOf = (normal, clean = 0, extra = {}) => new GarbageAttack({
    id: 'a',
    holeMasks: Array.from({ length: normal }, (_, i) => i + 1),
    cleanMasks: Array.from({ length: clean }, (_, i) => 100 + i),
    ...extra,
});

describe('FFAAttackRouter.applyCrowdCut', () => {
    it('keeps the attack whole without stamps', () => {
        const attacker = { crowdStamps: 0 };
        const attack = attackOf(4);
        expect(makeRouter().applyCrowdCut(attacker, attack)).toBe(attack);
    });

    it('takes one normal row per three stamps and spends them', () => {
        const attacker = { crowdStamps: 7 };
        const cut = makeRouter().applyCrowdCut(attacker, attackOf(4, 2));
        expect(cut.holeMasks).toEqual([1, 2]);
        expect(cut.cleanMasks).toEqual([100, 101]);
        expect(cut.id).toBe('a');
        expect(attacker.crowdStamps).toBe(1);
    });

    it('never cuts below zero rows', () => {
        const attacker = { crowdStamps: 30 };
        const cut = makeRouter().applyCrowdCut(attacker, attackOf(2));
        expect(cut.holeMasks).toEqual([]);
        expect(attacker.crowdStamps).toBe(24);
    });

    it('never cuts a move that empties the board', () => {
        const attacker = { crowdStamps: 9 };
        const attack = attackOf(4, 3, { sendForPerfectClear: true });
        expect(makeRouter().applyCrowdCut(attacker, attack)).toBe(attack);
        expect(attacker.crowdStamps).toBe(9);
    });

    it('never cuts under boring rules', () => {
        const attacker = { crowdStamps: 9 };
        const attack = attackOf(4);
        expect(makeRouter({ boringRules: true }).applyCrowdCut(attacker, attack)).toBe(attack);
    });
});

describe('FFAAttackRouter authoritative garbage metadata', () => {
    function makePlayer(steamId, name, color = '#808080') {
        return {
            steamId,
            name,
            color,
            isAlive: true,
            _lockSeq: steamId === 'A' ? 9 : 4,
            garbageQueue: new GarbageQueue(),
            gameState: {
                currentPiece: { type: 'I' },
                isGameOver: false,
            },
        };
    }

    it('stamps every queued garbage line with stable attack provenance and target order metadata', () => {
        const attacker = makePlayer('A', 'Alpha', '#f00');
        const opponents = Array.from({ length: 7 }, (_, index) => makePlayer(`P${index + 1}`, `Peer ${index + 1}`));
        const players = new Map([[attacker.steamId, attacker], ...opponents.map((p) => [p.steamId, p])]);
        const network = { broadcastToAll: vi.fn() };
        const gameState = {
            isHost: true,
            debugGarbage: false,
            players,
            matchConfig: { boringRules: false, attackRules: {} },
            network,
            applyGarbageCounter: vi.fn(() => 0),
            insertPendingGarbage: vi.fn(),
            _recordNetEvent: vi.fn(),
            _createAttackMetadata: vi.fn(() => ({
                attackId: 'r2-a17',
                attackSeq: 17,
                attackerId: 'A',
                sourceSimTick: 120,
                createdSimTick: 120,
                sourceLockSeq: 9,
                clearSummary: { depth: 5 },
                rulesHash: 'rules',
            })),
        };
        const router = new FFAAttackRouter(gameState);
        attacker.crowdStamps = 6; // two rows of crowd cut

        router.routeAttack('A', {
            depth: 5, // depth - 1 -> 4 raw lines, cut to 2 by six crowd stamps.
            holeMask: [
                [true, false, false, false, false, false, false, false, false, false],
                [false, true, false, false, false, false, false, false, false, false],
                [false, false, true, false, false, false, false, false, false, false],
                [false, false, false, true, false, false, false, false, false, false],
            ],
        });

        const entries = opponents[0].garbageQueue.entries;
        expect(entries).toHaveLength(2);
        expect(entries.map((entry) => entry.lineIndex)).toEqual([0, 1]);
        expect(entries.map((entry) => entry.isLastInBurst)).toEqual([false, true]);
        expect(entries[0]).toMatchObject({
            attackId: 'r2-a17',
            attackSeq: 17,
            attackerId: 'A',
            attackerName: 'Alpha',
            targetId: 'P1',
            sourceSimTick: 120,
            createdSimTick: 120,
            sourceLockSeq: 9,
            applyAfterLockSeq: 4,
            rulesHash: 'rules',
        });
        expect(network.broadcastToAll).toHaveBeenCalledWith('game:garbage:sent', expect.objectContaining({
            attackId: 'r2-a17',
            attackSeq: 17,
            rawLines: 4,
            cancelledLines: 0,
            totalLines: 2,
            targetCount: 7,
            sourceSimTick: 120,
            sourceLockSeq: 9,
        }));
        expect(gameState._recordNetEvent).toHaveBeenCalledWith('attack_routed', expect.objectContaining({
            attackId: 'r2-a17',
            totalLines: 2,
            rulesHash: 'rules',
        }));
    });
});
