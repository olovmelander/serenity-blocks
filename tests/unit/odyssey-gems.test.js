import {
    describe, expect, it, vi,
} from 'vitest';
import {
    ODYSSEY_GEM_ABILITIES, ODYSSEY_GEM_CAP, ODYSSEY_STILL_AIR_MS, ODYSSEY_TIDE_ROWS,
    awardOdysseyGems, canUseOdysseyGem, capOdysseyAidedStars, createOdysseyGemRun, describeOdysseyGemRun,
    normalizeOdysseyGemWallet, spendOdysseyGem,
} from '../../src/core/odyssey/odyssey-gems.js';
import {
    activateOdysseyGem, applyOdysseyTide, beginOdysseyStillAir, reviveOdysseyWell, sweepLowestRows,
    tickOdysseyStillAir, tryOdysseySecondBreath,
} from '../../src/core/odyssey/odyssey-gem-effects.js';
import { GameState } from '../../src/core/game.js';
import { createBoardGrid, rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { VictoryConditionEvaluator } from '../../src/core/odyssey/VictoryConditionEvaluator.js';

const FLOOR = 23; // ROWS + HIDDEN_ROWS - 1
const piece = (shapeKey, shape, x, y) => ({
    shapeKey, shape, x, y, color: shapeKey, pieceId: `${shapeKey}-${x}-${y}`,
});
/** An O on the floor, a standing I beside it, a T resting on top of the I. */
function stack() {
    return [
        piece('O', [[1, 1], [1, 1]], 0, 22),
        piece('I', [[1], [1], [1], [1]], 4, 19),
        piece('T', [[1, 1, 1], [0, 1, 0]], 3, 17),
    ];
}
const cells = (grid) => grid.flat().filter(Boolean).length;

function createWell(pieces = stack()) {
    const gameState = new GameState();
    gameState.lockedPieces = pieces;
    gameState.boardGrid = rebuildBoardGridFromPieces(pieces, createBoardGrid());
    gameState.currentPiece = {
        shapeKey: 'L', shape: [[1, 0], [1, 0], [1, 1]], x: 4, y: 0,
    };
    return gameState;
}

function createSession(overrides = {}) {
    return {
        gems: createOdysseyGemRun(),
        gameState: createWell(),
        levelConfig: { victory: { primary: { type: 'lines', target: 20 }, failure: { type: 'top-out' } } },
        hybridEngine: { extendTimeLimit: vi.fn() },
        physicsCallbacks: { spawnPiece: vi.fn() },
        simulationClock: 'legacy',
        ...overrides,
    };
}

function createMode(session, gemCount = 3) {
    const hud = { updateGems: vi.fn(), extendTimeLimit: vi.fn() };
    const effects = { playLineClearImpact: vi.fn(), playPerfectClear: vi.fn() };
    const mode = {
        _activeLevelSession: session,
        _isLevelSessionActive: (candidate) => candidate === session,
        isPaused: false,
        levelCompleting: false,
        odysseyState: {
            gems: gemCount,
            getGemCount() { return this.gems; },
            spendGem: vi.fn(function spendGem() { this.gems -= 1; return true; }),
        },
        odysseyHUD: hud,
        deps: { soundManager: { sfxPlayer: { playLevelUp: vi.fn(), playPerfectClear: vi.fn() } } },
        _getBoardScene: () => ({ sharedEffects: effects }),
        _elapsedLevelMs: () => 5000,
    };
    return { mode, hud, effects };
}

describe('Odyssey gem wallet and run rules', () => {
    it('keeps the wallet whole, capped and honest about what was earned and spent', () => {
        expect(normalizeOdysseyGemWallet(null)).toEqual({ count: 0, earned: 0, spent: 0 });
        expect(normalizeOdysseyGemWallet({ count: 40, earned: -2, spent: 'x' }))
            .toEqual({ count: ODYSSEY_GEM_CAP, earned: 0, spent: 0 });
        const first = awardOdysseyGems({ count: 8, earned: 8, spent: 0 }, 3);
        expect(first).toEqual({ wallet: { count: 9, earned: 9, spent: 0 }, awarded: 1 });
        expect(awardOdysseyGems(first.wallet, 1).awarded).toBe(0);
        const spent = spendOdysseyGem(first.wallet);
        expect(spent).toEqual({ wallet: { count: 8, earned: 9, spent: 1 }, spent: true });
        expect(spendOdysseyGem({ count: 0 })).toEqual({ wallet: { count: 0, earned: 0, spent: 0 }, spent: false });
    });

    it('allows each ability once per attempt, only with a gem in hand', () => {
        const run = createOdysseyGemRun();
        expect(ODYSSEY_GEM_ABILITIES.map((ability) => ability.id)).toEqual(['tide', 'still-air', 'second-breath']);
        expect(canUseOdysseyGem(run, 'tide', 1)).toBe(true);
        expect(canUseOdysseyGem(run, 'tide', 0)).toBe(false);
        expect(canUseOdysseyGem(run, 'wings', 5)).toBe(false);
        run.used.add('tide');
        expect(canUseOdysseyGem(run, 'tide', 5)).toBe(false);
        expect(canUseOdysseyGem(run, 'still-air', 5)).toBe(true);
        expect(canUseOdysseyGem(null, 'still-air', 5)).toBe(false);
    });

    it('describes the tray and caps an aided clear at one star', () => {
        const run = createOdysseyGemRun();
        run.used.add('tide');
        run.spent = 1;
        run.secondBreathArmed = true;
        run.used.add('second-breath');
        run.stillAir = { kind: 'slow', until: 12000 };
        run.used.add('still-air');
        const view = describeOdysseyGemRun(run, 2, 4000);
        expect(view.count).toBe(2);
        expect(view.spent).toBe(1);
        expect(view.abilities.map((ability) => [ability.id, ability.state, ability.remainingMs])).toEqual([
            ['tide', 'used', 0], ['still-air', 'active', 8000], ['second-breath', 'armed', 0],
        ]);
        expect(describeOdysseyGemRun(createOdysseyGemRun(), 0).abilities.every((a) => a.state === 'empty')).toBe(true);
        expect(describeOdysseyGemRun(null, 4).abilities.every((a) => a.state === 'ready')).toBe(true);
        expect(capOdysseyAidedStars(3, run)).toBe(1);
        expect(capOdysseyAidedStars(0, run)).toBe(0);
        expect(capOdysseyAidedStars(3, createOdysseyGemRun())).toBe(3);
        expect(capOdysseyAidedStars(3, null)).toBe(3);
    });
});

describe('Tide', () => {
    it('sweeps the lowest rows and settles the rest by the same distance, leaving nothing afloat', () => {
        const { pieces, removed } = sweepLowestRows(stack(), ODYSSEY_TIDE_ROWS, FLOOR);
        // The O (4 cells) and three cells of the I vanish; the T and the I's top cell settle 4 rows.
        expect(removed).toBe(7);
        expect(pieces.map((p) => [p.shapeKey, p.y])).toEqual([['I', 23], ['T', 21]]);
        expect(pieces[0].shape).toEqual([[1], [0], [0], [0]]);
        expect(pieces[1].shape).toEqual([[1, 1, 1], [0, 1, 0]]);
        const grid = rebuildBoardGridFromPieces(pieces, createBoardGrid());
        expect(grid[23][4]).toBeTruthy();
        expect(grid[21].filter(Boolean)).toHaveLength(3);
        expect(cells(grid)).toBe(5);
        // The source pieces are untouched.
        expect(stack()[1].shape).toEqual([[1], [1], [1], [1]]);
    });

    it('rewrites a live well through the restore boundary and refuses when there is nothing to sweep', () => {
        const gameState = createWell();
        const before = gameState.boardVersion || 0;
        expect(cells(gameState.boardGrid)).toBe(12);
        expect(applyOdysseyTide(gameState)).toBe(true);
        expect(gameState.lockedPieces).toHaveLength(2);
        expect(cells(gameState.boardGrid)).toBe(5);
        expect(gameState.boardGrid[23][4]).toBeTruthy();
        expect(gameState.boardVersion).toBeGreaterThan(before);
        expect(gameState.currentPiece.shapeKey).toBe('L');

        const empty = createWell([]);
        expect(applyOdysseyTide(empty)).toBe(false);
        const busy = createWell();
        busy.isProcessingPhysics = true;
        expect(applyOdysseyTide(busy)).toBe(false);
        expect(busy.lockedPieces).toHaveLength(3);
    });
});

describe('Still Air', () => {
    it('slows the fall for twenty seconds, follows a new pace underneath, then gives the pace back', () => {
        const session = createSession();
        session.gameState.dropInterval = 500;
        const air = beginOdysseyStillAir(session, 1000);
        expect(air).toMatchObject({
            kind: 'slow', until: 1000 + ODYSSEY_STILL_AIR_MS, base: 500, slow: 1500,
        });
        expect(session.gameState.dropInterval).toBe(1500);
        expect(tickOdysseyStillAir(session, 6000)).toBe(ODYSSEY_STILL_AIR_MS - 5000);
        // A level-up quickens the pace underneath: Still Air slows that pace instead.
        session.gameState.dropInterval = 400;
        expect(tickOdysseyStillAir(session, 7000)).toBeGreaterThan(0);
        expect(session.gameState.dropInterval).toBe(1500);
        expect(tickOdysseyStillAir(session, 1000 + ODYSSEY_STILL_AIR_MS)).toBe(0);
        expect(session.gameState.dropInterval).toBe(400);
        expect(session.gems.stillAir).toBeNull();
        expect(tickOdysseyStillAir(session, 99999)).toBeNull();
    });

    it('buys thirty more seconds on a deadline orb, which the evaluator honours', () => {
        const evaluator = new VictoryConditionEvaluator();
        const victory = { primary: { type: 'lines', target: 30 }, failure: { type: 'time', value: 180 } };
        evaluator.updateTime(200);
        expect(evaluator.evaluateFailure({ isGameOver: false }, victory)).toBe(true);
        const session = createSession({
            levelConfig: { victory },
            hybridEngine: { extendTimeLimit: (seconds) => evaluator.extendTimeLimit(seconds) },
        });
        session.gameState.dropInterval = 500;
        expect(beginOdysseyStillAir(session, 0)).toMatchObject({ kind: 'extension', seconds: 30 });
        expect(session.gameState.dropInterval).toBe(500);
        expect(evaluator.evaluateFailure({ isGameOver: false }, victory)).toBe(false);
        evaluator.updateTime(211);
        expect(evaluator.evaluateFailure({ isGameOver: false }, victory)).toBe(true);
        evaluator.reset();
        expect(evaluator.timeLimitFor(victory.failure)).toBe(180);
    });
});

describe('Second Breath', () => {
    it('empties an armed well on top-out and lets play go on, once', () => {
        const session = createSession();
        session.gems.secondBreathArmed = true;
        session.gameState.isGameOver = true;
        expect(reviveOdysseyWell(session)).toBe(true);
        expect(session.gameState.isGameOver).toBe(false);
        expect(session.gameState.lockedPieces).toEqual([]);
        expect(cells(session.gameState.boardGrid)).toBe(0);
        expect(session.gameState.currentPiece.shapeKey).toBe('L');
        expect(session.gems).toMatchObject({ secondBreathArmed: false, secondBreathUsed: true });
        session.gems.secondBreathArmed = true;
        expect(reviveOdysseyWell(session)).toBe(false);
    });

    it('spawns a piece when the well had none, and does nothing unarmed', () => {
        const session = createSession();
        session.gems.secondBreathArmed = true;
        session.gameState.currentPiece = null;
        const spawn = vi.fn();
        expect(reviveOdysseyWell(session, { spawn })).toBe(true);
        expect(spawn).toHaveBeenCalledOnce();
        expect(reviveOdysseyWell(createSession())).toBe(false);
    });
});

describe('Spending a gem during an orb', () => {
    it('applies the ability, spends one gem, marks it used and refreshes the tray', () => {
        const session = createSession();
        const { mode, hud, effects } = createMode(session, 2);
        expect(activateOdysseyGem(mode, 'tide')).toBe(true);
        expect(session.gameState.lockedPieces).toHaveLength(2);
        expect(mode.odysseyState.spendGem).toHaveBeenCalledOnce();
        expect(effects.playLineClearImpact).toHaveBeenCalledWith(ODYSSEY_TIDE_ROWS, 1);
        expect(session.gems.spent).toBe(1);
        expect(hud.updateGems).toHaveBeenLastCalledWith(expect.objectContaining({ count: 1, spent: 1 }));
        // Once per attempt.
        expect(activateOdysseyGem(mode, 'tide')).toBe(false);
        expect(activateOdysseyGem(mode, 'second-breath')).toBe(true);
        expect(session.gems.secondBreathArmed).toBe(true);
        // No gems left.
        expect(activateOdysseyGem(mode, 'still-air')).toBe(false);
        expect(session.gems.spent).toBe(2);
    });

    it('never spends a gem on an ability that cannot act, nor while paused or finished', () => {
        const session = createSession({ gameState: createWell([]) });
        const { mode } = createMode(session, 3);
        expect(activateOdysseyGem(mode, 'tide')).toBe(false);
        expect(mode.odysseyState.spendGem).not.toHaveBeenCalled();
        mode.isPaused = true;
        expect(activateOdysseyGem(mode, 'second-breath')).toBe(false);
        mode.isPaused = false;
        session.gameState.victoryLapActive = true;
        expect(activateOdysseyGem(mode, 'second-breath')).toBe(false);
        session.gameState.victoryLapActive = false;
        mode.levelCompleting = true;
        expect(activateOdysseyGem(mode, 'second-breath')).toBe(false);
        expect(session.gems.spent).toBe(0);
    });

    it('extends the HUD clock with Still Air on a deadline orb', () => {
        const session = createSession({
            levelConfig: { victory: { primary: { type: 'lines', target: 30 }, failure: { type: 'time', value: 180 } } },
        });
        const { mode, hud } = createMode(session, 1);
        expect(activateOdysseyGem(mode, 'still-air')).toBe(true);
        expect(session.hybridEngine.extendTimeLimit).toHaveBeenCalledWith(30);
        expect(hud.extendTimeLimit).toHaveBeenCalledWith(30);
    });

    it('absorbs a top-out through the mode when Second Breath is armed', () => {
        const session = createSession();
        const { mode, effects } = createMode(session, 1);
        expect(tryOdysseySecondBreath(mode, session)).toBe(false);
        activateOdysseyGem(mode, 'second-breath');
        session.gameState.isGameOver = true;
        expect(tryOdysseySecondBreath(mode, session)).toBe(true);
        expect(session.gameState.isGameOver).toBe(false);
        expect(effects.playPerfectClear).toHaveBeenCalled();
        expect(tryOdysseySecondBreath(mode, session)).toBe(false);
    });
});
