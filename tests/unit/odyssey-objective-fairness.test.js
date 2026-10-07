import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { MechanicsMixer } from '../../src/core/odyssey/MechanicsMixer.js';
import { VictoryConditionEvaluator } from '../../src/core/odyssey/VictoryConditionEvaluator.js';
import { processPhysics } from '../../src/core/physics.js';

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function levelConfig(victory = {}) {
    return {
        id: 1,
        name: 'Objective test',
        mechanics: {
            baseMode: 'standard',
            board: { rows: 20, columns: 10, startingRows: 0 },
            speed: { startLevel: 1, levelProgression: true },
        },
        modifiers: { active: [] },
        victory: {
            primary: { type: 'lines', target: 4 },
            failure: { type: 'time', value: 60 },
            bonuses: [{ type: 'no-singles' }, { type: 'time', target: 30 }],
            ...victory,
        },
        stars: {
            one: { lines: 4 },
            two: { lines: 4, bonuses: 1 },
            three: { lines: 4, bonuses: 2 },
        },
    };
}

describe('Odyssey objective fairness', () => {
    it('fails a timed attempt immediately on top-out instead of waiting for the timer', () => {
        const evaluator = new VictoryConditionEvaluator();
        const victory = levelConfig().victory;
        evaluator.updateTime(10);
        expect(evaluator.evaluateFailure({ isGameOver: false }, victory)).toBe(false);
        expect(evaluator.evaluateFailure({ isGameOver: true }, victory)).toBe(true);
        expect(evaluator.evaluateFailure({ isGameOver: true }, {
            ...victory, failure: { type: 'none' },
        })).toBe(false);
    });

    it('accepts a goal exactly at the deadline and rejects a later clear', () => {
        const evaluator = new VictoryConditionEvaluator();
        const victory = levelConfig().victory;
        evaluator.onLineClear(4);
        evaluator.updateTime(60);
        expect(evaluator.evaluate({}, victory)).toBe(true);
        evaluator.updateTime(60.001);
        expect(evaluator.evaluate({}, victory)).toBe(false);
        expect(evaluator.evaluateFailure({}, victory)).toBe(true);
    });

    it('awards bonus-gated stars only for the actual completed bonus objectives', () => {
        const engine = new GameplayHybridEngine();
        engine.configure(levelConfig());
        engine.createGameState();
        const callbacks = engine.buildPhysicsCallbacks({});
        callbacks.onLineClear(1); // Break no-singles.
        callbacks.onLineClear(3);
        engine.updateTime(45); // Miss the bonus time target.
        expect(engine.evaluateBonuses()).toEqual([false, false]);
        expect(engine.calculateStars()).toBe(1);
        engine.updateTime(25);
        expect(engine.evaluateBonuses()).toEqual([false, true]);
        expect(engine.calculateStars()).toBe(2);
        engine.configure(levelConfig());
        engine.createGameState();
        engine.buildPhysicsCallbacks({}).onLineClear(4);
        engine.updateTime(25);
        expect(engine.evaluateBonuses()).toEqual([true, true]);
        expect(engine.calculateStars()).toBe(3);
    });

    it('uses the live score for stars even when a tracked score is older and nonzero', () => {
        const evaluator = new VictoryConditionEvaluator();
        evaluator.updateScore(100);
        expect(evaluator.calculateStars({ one: { score: 500 } }, { score: 500 })).toBe(1);
    });

    it('does not award no-top-out after a death or a victory-lap top-out', () => {
        const evaluator = new VictoryConditionEvaluator();
        const bonuses = [{ type: 'no-top-out' }];
        expect(evaluator.evaluateBonuses(bonuses, { isGameOver: false })).toEqual([true]);
        expect(evaluator.evaluateBonuses(bonuses, { isGameOver: true })).toEqual([false]);
        evaluator.updateDuel({ deaths: 1 });
        expect(evaluator.evaluateBonuses(bonuses, { isGameOver: false })).toEqual([false]);
    });
});

describe('Odyssey Beat the Bot objectives', () => {
    const victory = {
        primary: { type: 'frags', target: 7 },
        failure: { type: 'opponent-frags', value: 7 },
    };

    it('keeps individual top-outs in the match and evaluates the cumulative first-to-seven result', () => {
        const engine = new GameplayHybridEngine();
        engine.configure(levelConfig(victory));
        engine.createGameState().isGameOver = true;
        engine.updateDuel({ frags: 6, deaths: 6, opponentFrags: 6 });
        expect(engine.checkFailure()).toBe(false);
        expect(engine.checkVictory()).toBe(false);
        engine.gameState.isGameOver = false;
        engine.updateDuel({ frags: 7, deaths: 6, opponentFrags: 6 });
        expect(engine.checkVictory()).toBe(true);
        expect(engine.checkFailure()).toBe(false);
        expect(engine.getMetrics()).toMatchObject({ frags: 7, deaths: 6, opponentFrags: 6 });
    });

    it('does not award victory when both frag counters reach the limit in the same death batch', () => {
        const evaluator = new VictoryConditionEvaluator();
        evaluator.updateDuel({ frags: 7, deaths: 7, opponentFrags: 7 });
        expect(evaluator.evaluate({}, victory)).toBe(false);
        expect(evaluator.evaluateFailure({}, victory)).toBe(true);
    });

    it('treats maxDeaths as an upper bound and resets match metrics for the next attempt', () => {
        const evaluator = new VictoryConditionEvaluator();
        const stars = {
            one: { frags: 7 }, two: { frags: 7, maxDeaths: 4 }, three: { frags: 7, maxDeaths: 0 },
        };
        evaluator.updateDuel({ frags: 7, deaths: 3, opponentFrags: 3 });
        expect(evaluator.calculateStars(stars, {})).toBe(2);
        evaluator.updateDuel({ deaths: 0 });
        expect(evaluator.calculateStars(stars, {})).toBe(3);
        evaluator.updateDuel({ deaths: 5 });
        expect(evaluator.calculateStars(stars, {})).toBe(1);
        evaluator.reset();
        expect(evaluator.getMetrics()).toMatchObject({ frags: 0, deaths: 0, opponentFrags: 0 });
        expect(evaluator.calculateStars(stars, {})).toBe(0);
    });
});

describe('Odyssey authored base mechanics', () => {
    it.each(['standard', 'infinity', 'hybrid'])('declares the shared cascading physics for %s', (baseMode) => {
        const mixer = new MechanicsMixer();
        mixer.configureFromLevel({ mechanics: { baseMode, speed: {} } });
        expect(mixer.hasCascadingGravity()).toBe(true);
        expect(mixer.hasCascades()).toBe(true);
    });

    it('honors an explicit Infinity progression override and leaves omitted progression at the base default', () => {
        const engine = new GameplayHybridEngine();
        const level = levelConfig();
        level.mechanics.baseMode = 'infinity';
        engine.configure(level);
        expect(engine.createGameState().disableLevelProgression).toBe(false);
        delete level.mechanics.speed.levelProgression;
        engine.configure(level);
        expect(engine.createGameState().disableLevelProgression).toBe(true);
        level.mechanics.baseMode = 'standard';
        engine.configure(level);
        expect(engine.createGameState().disableLevelProgression).toBe(false);
    });

    it.each(['standard', 'infinity', 'hybrid'])('tracks one real cascade sequence under %s rules', async (baseMode) => {
        const engine = new GameplayHybridEngine();
        const config = levelConfig({ primary: { type: 'cascade', target: 1 } });
        config.mechanics.baseMode = baseMode;
        engine.configure(config);
        const state = engine.createGameState();
        const bottom = state.boardGrid.length - 1;
        state.isSeeking = true;
        state.lockedPieces = [
            { pieceId: 1, shapeKey: 'I', color: 'I', x: 0, y: bottom, shape: [Array(10).fill(1)] },
            { pieceId: 2, shapeKey: 'I', color: 'I', x: 0, y: bottom - 3, shape: [[1]] },
            { pieceId: 3, shapeKey: 'I', color: 'I', x: 1, y: bottom - 1, shape: [Array(9).fill(1)] },
        ];

        await processPhysics(state, engine.buildPhysicsCallbacks({}));

        expect(engine.getMetrics()).toMatchObject({ lines: 2, cascades: 1, maxCascadeDepth: 2, maxCombo: 2 });
        expect(state.lines).toBe(2);
        expect(state.lockedPieces).toEqual([]);
        expect(engine.checkVictory()).toBe(true);
    });
});
