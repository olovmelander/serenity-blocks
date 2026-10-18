import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    createOdysseyCharmRun, describeOdysseyCharmRun, payOdysseyScoreCharms, reviveOdysseyWell, tryOdysseyHearth,
    wrapOdysseyCharmCallbacks,
} from '../../src/core/odyssey/odyssey-charm-effects.js';
import { AFTERGLOW_BONUS } from '../../src/core/odyssey/odyssey-charms.js';
import { createBoardGrid, rebuildBoardGridFromPieces } from '../../src/core/board.js';

/** physics.js: onLineClear(lineCount, holeColumns, waveHoleMasks, fullLines, cascadeCount). */
const clear = (callbacks, lines, wave) => callbacks.onLineClear(lines, [], [], [], wave);

function attempt(charms, { duel = null, score = 0 } = {}) {
    const base = {
        onPieceLock: vi.fn(), onLineClear: vi.fn(), onPerfectClear: vi.fn(), spawnPiece: vi.fn(() => 'dealt'),
    };
    const gameState = { score };
    return {
        base, gameState, session: { charmRun: createOdysseyCharmRun(charms), gameState, duel },
    };
}

describe('Odyssey charm effects: the score charms', () => {
    it('leaves an attempt without a score charm, a duel, or no session exactly as it was', () => {
        const plain = attempt(['keel', 'hearth']);
        expect(wrapOdysseyCharmCallbacks(plain.session, plain.base)).toBe(plain.base);
        const duel = attempt(['kindle'], { duel: {} });
        expect(wrapOdysseyCharmCallbacks(duel.session, duel.base)).toBe(duel.base);
        expect(wrapOdysseyCharmCallbacks(null, plain.base)).toBe(plain.base);
        expect(wrapOdysseyCharmCallbacks({ gameState: {} }, plain.base)).toBe(plain.base);
    });

    it('Kindle pays half again on a lock whose cascade ran two waves deep, once the cascade has settled', () => {
        const { base, gameState, session } = attempt(['kindle'], { score: 1000 });
        const callbacks = wrapOdysseyCharmCallbacks(session, base);
        expect(callbacks).not.toBe(base);
        callbacks.onPieceLock({ id: 'piece' }, 'extra');
        expect(base.onPieceLock).toHaveBeenCalledWith({ id: 'piece' }, 'extra');
        gameState.score += 300;
        clear(callbacks, 1, 1);
        gameState.score += 500;
        clear(callbacks, 2, 2);
        expect(base.onLineClear).toHaveBeenCalledTimes(2);
        expect(base.onLineClear).toHaveBeenLastCalledWith(2, [], [], [], 2);
        // Nothing until the next piece is dealt: the cascade may still be running.
        expect(gameState.score).toBe(1800);
        expect(callbacks.spawnPiece('arg')).toBe('dealt');
        expect(base.spawnPiece).toHaveBeenCalledWith('arg');
        expect(gameState.score).toBe(1800 + 400);
        expect(session.charmRun.paid).toBe(400);
        // One wave pays nothing; a lock that clears nothing pays nothing.
        callbacks.onPieceLock({});
        gameState.score += 200;
        clear(callbacks, 1, 1);
        callbacks.spawnPiece();
        expect(gameState.score).toBe(2400);
        callbacks.onPieceLock({});
        callbacks.spawnPiece();
        expect(gameState.score).toBe(2400);
        expect(session.charmRun.paid).toBe(400);
    });

    it('Swell pays 40% more for a triple or a quad; Kindle and Swell together pay both shares', () => {
        const swell = attempt(['swell']);
        const callbacks = wrapOdysseyCharmCallbacks(swell.session, swell.base);
        callbacks.onPieceLock({});
        swell.gameState.score += 1000;
        clear(callbacks, 3, 1);
        callbacks.spawnPiece();
        expect(swell.gameState.score).toBe(1400);
        callbacks.onPieceLock({});
        swell.gameState.score += 1000;
        clear(callbacks, 2, 1);
        callbacks.spawnPiece();
        expect(swell.gameState.score).toBe(2400);

        const both = attempt(['kindle', 'swell']);
        const paired = wrapOdysseyCharmCallbacks(both.session, both.base);
        paired.onPieceLock({});
        both.gameState.score += 1000;
        clear(paired, 4, 1);
        clear(paired, 1, 2);
        paired.spawnPiece();
        expect(both.gameState.score).toBe(1900);
        expect(both.session.charmRun.paid).toBe(900);
    });

    it('Afterglow pays 1,500 on a perfect clear and still passes the clear on; other charms do not', () => {
        const { base, gameState, session } = attempt(['afterglow'], { score: 50 });
        const callbacks = wrapOdysseyCharmCallbacks(session, base);
        callbacks.onPerfectClear(4, 2000, 'rest');
        expect(gameState.score).toBe(50 + AFTERGLOW_BONUS);
        expect(base.onPerfectClear).toHaveBeenCalledWith(4, 2000, 'rest');
        expect(session.charmRun.paid).toBe(AFTERGLOW_BONUS);
        const kindle = attempt(['kindle']);
        wrapOdysseyCharmCallbacks(kindle.session, kindle.base).onPerfectClear(4, 2000);
        expect(kindle.gameState.score).toBe(0);
        expect(kindle.base.onPerfectClear).toHaveBeenCalledWith(4, 2000);
    });

    it('pays nothing when the score did not rise, and nothing without a run or a well', () => {
        const run = createOdysseyCharmRun(['kindle']);
        run.lock = { waves: 3, maxLines: 4, scoreAtLock: 500 };
        expect(payOdysseyScoreCharms({ score: 400 }, run)).toBe(0);
        expect(payOdysseyScoreCharms(null, run)).toBe(0);
        expect(payOdysseyScoreCharms({ score: 900 }, null)).toBe(0);
        expect(payOdysseyScoreCharms({ score: 900 }, run)).toBe(200);
        expect(run.paid).toBe(200);
    });
});

describe('Odyssey charm effects: Hearth', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const wall = () => [{
        x: 4, y: 0, shape: [[1], [1], [1], [1]], pieceId: 1, shapeKey: 'I', type: 'I', color: '#fff',
    }];
    function well() {
        const lockedPieces = wall();
        const grid = rebuildBoardGridFromPieces(lockedPieces, createBoardGrid());
        return {
            boardGrid: grid, grid, lockedPieces, currentPiece: null, isGameOver: true, isAlive: false, dropCounter: 900,
        };
    }

    it('empties the well, keeps the piece in hand or deals one, and lets play go on', () => {
        const gameState = well();
        expect(gameState.boardGrid.some((row) => row.some(Boolean))).toBe(true);
        const spawn = vi.fn();
        expect(reviveOdysseyWell(gameState, { spawn })).toBe(true);
        expect(gameState.boardGrid.every((row) => row.every((cell) => cell === null))).toBe(true);
        expect(gameState.grid).toBe(gameState.boardGrid);
        expect(gameState.lockedPieces).toEqual([]);
        expect(gameState.isGameOver).toBe(false);
        expect(gameState.isAlive).toBe(true);
        expect(gameState.dropCounter).toBe(0);
        expect(gameState.boardCacheDirty).toBe(true);
        expect(spawn).toHaveBeenCalledOnce();

        const held = { ...well(), currentPiece: { shapeKey: 'T' } };
        const dealt = vi.fn();
        reviveOdysseyWell(held, { spawn: dealt });
        expect(held.currentPiece).toEqual({ shapeKey: 'T' });
        expect(dealt).not.toHaveBeenCalled();
        expect(reviveOdysseyWell({ boardGrid: [] })).toBe(false);
        expect(reviveOdysseyWell(null)).toBe(false);
    });

    it('absorbs one top-out an orb for a Hearth holder, never during a showcase lap, and tells the HUD', () => {
        const gameState = well();
        const spawn = vi.fn();
        const session = {
            charmRun: createOdysseyCharmRun(['hearth', 'keel']), gameState, physicsCallbacks: { spawnPiece: spawn },
        };
        const flare = vi.fn();
        const chime = vi.fn();
        const hud = vi.fn();
        const mode = {
            _isLevelSessionActive: (candidate) => candidate === session,
            _getBoardScene: () => ({ sharedEffects: { playPerfectClear: flare } }),
            deps: { soundManager: { sfxPlayer: { playPerfectClear: chime } } },
            odysseyHUD: { updateCharms: hud },
        };
        expect(tryOdysseyHearth(mode, session)).toBe(true);
        expect(session.charmRun.hearthUsed).toBe(true);
        expect(gameState.isGameOver).toBe(false);
        expect(spawn).toHaveBeenCalledOnce();
        expect(flare).toHaveBeenCalledWith(0);
        expect(chime).toHaveBeenCalledOnce();
        expect(hud).toHaveBeenCalledWith({
            charms: [
                expect.objectContaining({ id: 'hearth', spent: true }),
                expect.objectContaining({ id: 'keel', spent: false }),
            ],
        });
        // Once an orb.
        gameState.isGameOver = true;
        expect(tryOdysseyHearth(mode, session)).toBe(false);
        expect(gameState.isGameOver).toBe(true);
        // Without the charm, on a retired session, during the lap, or without a session: no.
        expect(tryOdysseyHearth(mode, { charmRun: createOdysseyCharmRun(['keel']), gameState: well() })).toBe(false);
        expect(tryOdysseyHearth(mode, { charmRun: createOdysseyCharmRun(['hearth']), gameState: well() })).toBe(false);
        const live = { ...mode, _isLevelSessionActive: () => true };
        const lap = { charmRun: createOdysseyCharmRun(['hearth']), gameState: { ...well(), victoryLapActive: true } };
        expect(tryOdysseyHearth(live, lap)).toBe(false);
        expect(lap.charmRun.hearthUsed).toBe(false);
        expect(tryOdysseyHearth(live, null)).toBe(false);
    });

    it('describes a run for the HUD: every charm held, Hearth marked spent once used', () => {
        const run = createOdysseyCharmRun(['swell', 'hearth']);
        expect(describeOdysseyCharmRun(run).charms.map((charm) => [charm.id, charm.spent]))
            .toEqual([['swell', false], ['hearth', false]]);
        run.hearthUsed = true;
        expect(describeOdysseyCharmRun(run).charms.map((charm) => charm.spent)).toEqual([false, true]);
        expect(describeOdysseyCharmRun(run).charms[1]).toMatchObject({ name: 'Hearth', kind: 'safety' });
        expect(describeOdysseyCharmRun(null)).toEqual({ charms: [] });
        expect(createOdysseyCharmRun()).toEqual({
            charms: [], hearthUsed: false, lock: { waves: 0, maxLines: 0, scoreAtLock: 0 }, paid: 0,
        });
    });
});
