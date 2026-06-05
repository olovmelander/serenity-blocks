import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { findCompleteLines } from '../../src/core/board.js';
import { COLS, HIDDEN_ROWS } from '../../src/core/constants.js';
import { gameLoop } from '../../src/core/game.js';
import { BinaryDecoder, BinaryEncoder } from '../../src/core/network/binary-encoding.js';
import { HostMigration } from '../../src/core/network/host-migration.js';
import { VictoryConditionEvaluator } from '../../src/core/odyssey/VictoryConditionEvaluator.js';
import { detectFullLines } from '../../src/core/physics.js';
import { InputValidator } from '../../src/core/validation/input-validator.js';
import { escapeHtml, sanitizeCssColor } from '../../src/utils/dom-safety.js';
import { throttle } from '../../src/utils/performance-utils.js';

function createEmptyBinaryGrid() {
    return Array.from({ length: 24 }, () => Array(COLS).fill(null));
}

describe('repository review security and correctness fixes', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('sanitizes peer-controlled colors and escapes HTML text', () => {
        expect(sanitizeCssColor('#abc')).toBe('#abc');
        expect(sanitizeCssColor('#aabbcc')).toBe('#aabbcc');
        expect(sanitizeCssColor('#000;"></span><img src=x>')).toBe('#a78bfa');
        expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('does not report complete hidden rows as clearable lines', () => {
        const board = Array.from({ length: HIDDEN_ROWS + 20 }, () => Array(COLS).fill(null));
        board[0].fill({ type: 'I' });
        board[HIDDEN_ROWS].fill({ type: 'I' });

        expect(detectFullLines(board)).toEqual([HIDDEN_ROWS]);
        expect(findCompleteLines(board)).toEqual([HIDDEN_ROWS]);
    });

    it('round-trips valid binary snapshots and rejects oversized player counts', () => {
        const encoder = new BinaryEncoder();
        const decoder = new BinaryDecoder();
        const encoded = encoder.encodeSnapshot({
            gamePhase: 'playing',
            tick: 42,
            players: [{
                steamId: '1',
                name: 'Player 1',
                color: '#a78bfa',
                score: 100,
                lines: 2,
                level: 1,
                frags: 0,
                isAlive: true,
                garbagePending: 0,
                dropCounter: 0,
                dropInterval: 720,
                grid: createEmptyBinaryGrid(),
                currentPiece: null,
                nextPieces: ['I', 'O'],
                garbageEntries: [],
            }],
            winner: null,
        });

        expect(decoder.decodeSnapshot(encoded)).toMatchObject({
            gamePhase: 'playing',
            tick: 42,
            players: [{ steamId: '1', score: 100, lines: 2 }],
        });

        const malformed = new ArrayBuffer(12);
        const view = new DataView(malformed);
        view.setUint32(0, 0x5342_4E45, false);
        view.setUint8(4, 1);
        view.setUint8(5, 255);
        expect(() => decoder.decodeSnapshot(malformed)).toThrow(/player count/);
    });

    it('rejects forged host migration claims', () => {
        const gameState = {
            localPlayerId: '20',
            isHost: false,
            players: new Map([
                ['10', { steamId: '10', name: 'Winner' }],
                ['20', { steamId: '20', name: 'Local' }],
                ['30', { steamId: '30', name: 'Forger' }],
            ]),
            network: {
                hostSteamId: '99',
                isHost: false,
            },
        };
        const migration = new HostMigration(gameState);
        migration.isElectionInProgress = true;

        migration.handleClaim({ from: '30', data: { newHostId: '30' } });
        expect(gameState.network.hostSteamId).toBe('99');

        migration.handleClaim({ from: '10', data: { newHostId: '10' } });
        expect(gameState.network.hostSteamId).toBe('10');
    });

    it('uses live game score for Odyssey score star tiers', () => {
        const evaluator = new VictoryConditionEvaluator();

        expect(evaluator.calculateStars({
            one: { score: 1000 },
            two: { score: 2000 },
            three: { score: 3000 },
        }, { score: 2500 })).toBe(2);
    });

    it('rejects null input payloads without throwing', () => {
        const validator = new InputValidator();
        expect(validator.validateInput('peer', 'move', null)).toEqual({
            valid: false,
            reason: 'Invalid input payload',
        });
    });

    it('does not leak the game loop counter when update callbacks throw', () => {
        vi.stubGlobal('window', {});
        const requestAnimationFrame = vi.fn(() => 1);
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
        const gameState = {
            isGameOver: false,
            isPaused: false,
            forceDraw: false,
            lastTime: 0,
            currentPiece: null,
        };

        expect(() => gameLoop(0, gameState, null, () => { throw new Error('stats failed'); }, null, {}))
            .toThrow('stats failed');
        expect(() => gameLoop(16, gameState, null, () => { throw new Error('stats failed'); }, null, {}))
            .toThrow('stats failed');

        gameLoop(32, gameState, null, vi.fn(), null, {});
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('throttles with a trailing call and can cancel pending work', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const fn = vi.fn();
        const throttled = throttle(fn, 100);

        throttled('a');
        throttled('b');
        expect(fn).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenLastCalledWith('b');

        throttled('c');
        throttled.cancel();
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(2);
    });
});
