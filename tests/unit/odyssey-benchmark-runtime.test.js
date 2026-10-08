import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { runAttempt } from '../../scripts/odyssey-benchmark/runtime.mjs';
import { applyGarbage, GameState } from '../../src/core/game.js';
import { piecePool } from '../../src/utils/object-pool.js';
import { LEVEL_SPEEDS } from '../../src/core/constants.js';
import { OdysseyBotMatch } from '../../src/core/odyssey/OdysseyBotMatch.js';
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { BenchmarkBot } from '../../scripts/odyssey-benchmark/profiles.mjs';
import { markBoardDirty, rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import * as physicsCallbackFactory from '../../src/core/game-modes/odyssey-physics-callbacks.js';

const fixture = vi.hoisted(() => ({
    factory: null, level: null, state: null, getMetrics: null,
}));
vi.mock('../../scripts/odyssey-benchmark/profiles.mjs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        createBenchmarkBot: (deps) => (fixture.factory ? fixture.factory(deps) : actual.createBenchmarkBot(deps)),
    };
});
vi.mock('../../src/core/odyssey/data/levels.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getLevelById: (id) => (fixture.level?.id === id ? fixture.level : actual.getLevelById(id)),
    };
});

function quadBot({ gameState, actions, getMetrics }) {
    fixture.state = gameState;
    fixture.getMetrics = getMetrics;
    let dropped = false;
    return {
        reset() {},
        update() {
            if (dropped) return;
            dropped = true;
            // Seed 42 starts with I; the controlled stack exercises real quad physics.
            expect(gameState.currentPiece.shapeKey).toBe('I');
            applyGarbage(gameState, Array.from({ length: 4 }, () => ({ type: 'line', holeMask: 32 })));
            actions.rotateRight();
            const targetX = 4 - gameState.currentPiece.shape[0].findIndex(Boolean);
            while (gameState.currentPiece.x > targetX) actions.moveLeft();
            while (gameState.currentPiece.x < targetX) actions.moveRight();
            actions.hardDrop();
        },
    };
}

beforeEach(() => {
    fixture.factory = null;
    fixture.state = null;
    fixture.getMetrics = null;
    fixture.level = {
        ...structuredClone(getLevelById(1)),
        id: 9001,
        victory: {
            primary: { type: 'lines', target: 4 },
            failure: { type: 'top-out' },
            bonuses: [{ type: 'no-singles' }],
        },
        stars: {
            one: { lines: 4 },
            two: { lines: 4, time: 60 },
            three: { lines: 4, tetrises: 1, bonuses: 1 },
        },
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('Odyssey benchmark real gameplay runtime', () => {
    it('reproduces real seeded placements and separates censorship from gameplay failure', async () => {
        const options = {
            levelId: 1, seed: 42, profile: 'stacker', maxSimSeconds: 10, maxPieces: 10, trace: true,
        };
        const first = await runAttempt(options);
        const second = await runAttempt(options);
        const { wallMs: firstWall, ...a } = first;
        const { wallMs: secondWall, ...b } = second;
        expect(a).toEqual(b);
        expect(firstWall).toBeGreaterThan(0);
        expect(secondWall).toBeGreaterThan(0);
        expect(first).toMatchObject({
            outcome: 'censored',
            reason: 'piece-budget',
            pieces: 10,
            goalReached: false,
            humanPlanningPreviewLimit: 3,
            opponentKnowledgePolicy: 'not-applicable',
            opponentVisiblePreviewCount: null,
            opponentPlanningPreviewLimit: null,
        });
        expect(first.metrics.piecesPlaced).toBe(10);
        expect(first.elapsedSeconds).toBeGreaterThan(1);
        const drops = first.trace.filter((command) => command.action === 'hardDrop');
        expect(drops.every((command) => command.shapeKey)).toBe(true);
    });

    it('evaluates a winning quad at the piece limit after timed physics and canonical bonuses', async () => {
        fixture.factory = quadBot;
        const result = await runAttempt({
            levelId: 9001, seed: 42, maxPieces: 1, maxSimSeconds: 5,
        });
        expect(result).toMatchObject({
            outcome: 'win', reason: 'primary-goal', pieces: 1, stars: 3, bonusResults: [true],
        });
        expect(result.metrics).toMatchObject({ lines: 4, tetrises: 1, piecesPlaced: 1 });
        expect(result.metrics.score).toBeGreaterThan(0);
        expect(result.elapsedSeconds).toBeGreaterThan(0.2);
        expect(fixture.state.isSeeking).toBe(false);
        expect(result.goalReachedAtSeconds).toBe(result.elapsedSeconds);
    });

    it('rejects a goal whose actual cascade settles after the deadline', async () => {
        fixture.factory = quadBot;
        fixture.level.victory.failure = { type: 'time', value: 0.1 };
        const result = await runAttempt({ levelId: 9001, seed: 42, maxSimSeconds: 5 });
        expect(result).toMatchObject({
            outcome: 'loss', reason: 'deadline', goalReached: false, stars: 0,
        });
        expect(result.metrics.lines).toBe(4);
        expect(result.elapsedSeconds).toBeGreaterThan(0.1);
    });

    it('records valid showcase success separately from a censored optional star lap', async () => {
        fixture.factory = quadBot;
        fixture.level.victoryLapPolicy = 'showcase';
        fixture.level.stars.three = { lines: 4, score: 1000000 };
        const result = await runAttempt({ levelId: 9001, seed: 42, maxSimSeconds: 1 });
        expect(result).toMatchObject({
            outcome: 'win',
            goalReached: true,
            stars: 2,
            goalStars: 2,
            lapEndReason: 'simulation-budget',
            lapCensored: true,
        });
        expect(result.elapsedSeconds).toBe(1);
        expect(result.goalReachedAtSeconds).toBeLessThan(1);
        expect(result).toMatchObject({
            primaryCensored: false,
            qualityCensored: true,
            showcaseFinishPolicy: { mode: 'harness-budget', maxLapSeconds: null },
        });
    });

    it('uses the full authored showcase deadline by default and honors an explicit 60-second cap', async () => {
        fixture.factory = quadBot;
        fixture.level.victoryLapPolicy = 'showcase';
        fixture.level.victory.failure = { type: 'time', value: 70 };
        fixture.level.stars.three = { lines: 4, score: 1000000 };
        fixture.level.mechanics.speed = { startLevel: 1, levelProgression: false, fixedDropInterval: 1000000 };
        const full = await runAttempt({ levelId: 9001, seed: 42, maxSimSeconds: 80 });
        expect(full).toMatchObject({
            outcome: 'win',
            lapEndReason: 'deadline',
            lapCensored: false,
            qualityCensored: false,
            showcaseFinishPolicy: { mode: 'authored-deadline', maxLapSeconds: null },
        });
        expect(full.elapsedSeconds).toBeGreaterThanOrEqual(70);
        expect(full.elapsedSeconds).toBeLessThan(70.02);
        const capped = await runAttempt({
            levelId: 9001, seed: 42, maxSimSeconds: 80, lapWindowSeconds: 60,
        });
        expect(capped).toMatchObject({
            outcome: 'win',
            lapEndReason: 'lap-time-limit',
            lapCensored: true,
            primaryCensored: false,
            qualityCensored: true,
            showcaseFinishPolicy: { mode: 'explicit-lap-window', maxLapSeconds: 60 },
        });
        expect(capped.elapsedSeconds - capped.goalReachedAtSeconds).toBeGreaterThanOrEqual(60);
        expect(capped.elapsedSeconds).toBeLessThan(full.elapsedSeconds);
        expect(fixture.level.victory.failure.value).toBe(70);
    });

    it('reports actual wall collisions, grounded soft-drop stops and automatic versus input locks', async () => {
        let groundedFirst = false;
        let droppedSecond = false;
        fixture.factory = ({ gameState, actions }) => ({
            reset() {},
            update() {
                if (!groundedFirst) {
                    groundedFirst = true;
                    while (actions.moveLeft()) { /* Reach the actual wall. */ }
                    while (actions.softDrop()) { /* Reach the actual floor with lock delay. */ }
                } else if (!droppedSecond && gameState.piecesPlaced === 2 && !gameState.isProcessingPhysics) {
                    droppedSecond = true;
                    gameState.lockDelay = 0;
                    while (actions.softDrop()) { /* A grounded soft drop legally locks this piece. */ }
                }
            },
        });
        const result = await runAttempt({
            levelId: 9001, seed: 42, maxPieces: 2, maxSimSeconds: 2, trace: true,
        });
        expect(result).toMatchObject({
            outcome: 'censored',
            pieces: 2,
            telemetry: { failedActions: 1, legalSoftDropStops: 2, locks: { automatic: 1, input: 1, softDrop: 1 } },
        });
        expect(result.actions.rejected).toBe(3);
        expect(result.actions.byAction.softDrop).toMatchObject({
            rejected: 2, failed: 0, legalStops: 2, locks: 1,
        });
        const collision = result.trace.find((command) => command.action === 'moveLeft' && !command.accepted);
        expect(collision).toMatchObject({
            kind: 'input', outcome: 'rejected', before: { piece: { x: 0 }, processingPhysics: false },
        });
        expect(collision.after.piece).toEqual(collision.before.piece);
        expect(collision.before.dropIntervalMs).toBeGreaterThan(0);
        expect(result.trace.filter((event) => event.kind === 'lock').map((event) => event.source))
            .toEqual(['automatic', 'softDrop']);
        const automatic = result.trace.find((event) => event.kind === 'lock');
        expect(automatic.pose.lockTimerMs).toBeGreaterThanOrEqual(500);
        const softDropLock = result.trace.find((command) => (
            command.action === 'softDrop' && command.outcome === 'locked'
        ));
        expect(softDropLock.accepted).toBe(false);
    });

    it('keeps orb 51 scoring and scaled fall after a real 15-line level boundary', async () => {
        const states = [];
        const originalReset = GameState.prototype.reset;
        vi.spyOn(GameState.prototype, 'reset').mockImplementation(function captureProgression() {
            states.push({
                lines: this.lines, level: this.level, dropInterval: this.dropInterval, score: this.score,
            });
            return originalReset.call(this);
        });
        fixture.factory = (deps) => {
            // Begin eleven lines into the authored level, then resolve a real four-line clear.
            deps.gameState.lines = 11;
            deps.gameState.linesUntilNextLevel = 4;
            return quadBot(deps);
        };
        const attempts = [];
        for (const scenarioId of ['baseline', 'orb51-fall75', 'orb51-fall100']) {
            // Each virtual-clock owner must finish before the next attempt starts.
            // eslint-disable-next-line no-await-in-loop
            attempts.push(await runAttempt({
                levelId: 51, seed: 42, scenarioId, maxPieces: 1, maxSimSeconds: 5,
            }));
        }
        expect(attempts.every((attempt) => attempt.outcome === 'censored')).toBe(true);
        expect(states.map((state) => [state.lines, state.level])).toEqual([[15, 14], [15, 14], [15, 14]]);
        const base = attempts[0].effectiveConfig.physicsPolicy.authoredInitialIntervalMs;
        expect(base).toBe(LEVEL_SPEEDS[12]);
        const initialIntervals = attempts.slice(1).map((attempt) => (
            attempt.effectiveConfig.physicsPolicy.initialIntervalMs
        ));
        expect(initialIntervals).toEqual([75, 100]);
        expect(states[1].dropInterval).toBeCloseTo(LEVEL_SPEEDS[13] * (75 / base));
        expect(states[2].dropInterval).toBeCloseTo(LEVEL_SPEEDS[13] * (100 / base));
        expect(states[1].score).toBe(states[0].score);
        expect(states[2].score).toBe(states[0].score);
        expect(getLevelById(51).mechanics.speed).toEqual(attempts[0].effectiveConfig.speed);
    });

    it('retires and drains real in-flight physics without changing the censored metric snapshot', async () => {
        fixture.factory = quadBot;
        let retiredCallbacks;
        const originalFactory = physicsCallbackFactory.createOdysseyPhysicsCallbacks;
        vi.spyOn(physicsCallbackFactory, 'createOdysseyPhysicsCallbacks').mockImplementation((...args) => {
            retiredCallbacks = originalFactory(...args);
            return retiredCallbacks;
        });
        let beforeReset;
        const originalReset = GameState.prototype.reset;
        vi.spyOn(GameState.prototype, 'reset').mockImplementation(function captureDrainedState() {
            beforeReset = {
                lines: this.lines,
                score: this.score,
                isStopped: this.isStopped,
                isProcessingPhysics: this.isProcessingPhysics,
                latestPhysicsPromise: this.latestPhysicsPromise,
            };
            return originalReset.call(this);
        });
        const NativeDate = Date;
        const realPerformance = performance;
        const result = await runAttempt({ levelId: 9001, seed: 42, maxSimSeconds: 0.05 });
        expect(result).toMatchObject({ outcome: 'censored', reason: 'simulation-budget', elapsedSeconds: 0.05 });
        expect(result.metrics.lines).toBe(4); // The first wave commits before its visual hold.
        expect(beforeReset.lines).toBe(4); // Board physics drained before releasing the state.
        expect(beforeReset.score).toBeGreaterThan(result.metrics.score); // Later perfect-clear bonus drained.
        retiredCallbacks.onLineClear(99);
        expect(fixture.getMetrics().lines).toBe(4); // Retired callbacks cannot award progress.
        expect(beforeReset).toMatchObject({
            isStopped: true, isProcessingPhysics: false, latestPhysicsPromise: null,
        });
        expect(fixture.state.currentPiece).toBeNull();
        expect(Date).toBe(NativeDate);
        expect(performance).toBe(realPerformance);
    });

    it('releases both wells across repeated real worker jobs while preserving unrelated pooled pieces', async () => {
        const unrelatedPiece = piecePool.acquire();
        const baseline = piecePool.active.size;
        try {
            for (const levelId of [1, 4, 2, 4]) {
                // A worker's virtual attempts and their cleanup run sequentially.
                // eslint-disable-next-line no-await-in-loop
                const result = await runAttempt({
                    levelId, seed: 42, profile: 'stacker', maxSimSeconds: 1,
                });
                expect(result.outcome).not.toBe('error');
                expect(piecePool.active.size).toBe(baseline);
                expect(piecePool.active.has(unrelatedPiece)).toBe(true);
            }
        } finally { piecePool.release(unrelatedPiece); }
    });

    it('uses the actual duel death barrier, 900ms break and seeded round reset', async () => {
        let prepared = false;
        fixture.factory = ({ gameState, actions }) => ({
            reset() {},
            update() {
                if (prepared) return;
                prepared = true;
                // A supported column blocks the next T spawn while this I can lock to its left.
                while (gameState.currentPiece.x > 0) actions.moveLeft();
                gameState.lockedPieces.push({
                    pieceId: 9999,
                    shapeKey: 'GARBAGE',
                    color: '#808080',
                    x: 4,
                    y: 2,
                    shape: Array.from({ length: gameState.boardGrid.length - 2 }, () => [1]),
                });
                markBoardDirty(gameState);
                rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
                actions.hardDrop();
            },
        });
        const result = await runAttempt({ levelId: 4, seed: 42, maxSimSeconds: 2 });
        expect(result).toMatchObject({
            outcome: 'censored',
            reason: 'simulation-budget',
            opponentPreviewCount: null,
            opponentVisiblePreviewCount: 3,
            opponentPlanningPreviewLimit: null,
            opponentKnowledgePolicy: 'production-full-real-bag',
            humanPlanningPreviewLimit: 3,
            duel: {
                round: 2, deaths: 1, playerFrags: 0, botFrags: 0, botName: 'Cinder',
            },
        });
        expect(result.metrics.deaths).toBe(1);
        expect(result.elapsedSeconds).toBe(2);
        const { telemetry } = result.duel;
        expect(telemetry.players[0]).toMatchObject({ deaths: 1, creditedDeaths: 0, uncreditedDeaths: 1 });
        expect(telemetry.rounds).toHaveLength(2);
        expect(telemetry.rounds[0]).toMatchObject({
            round: 1,
            completed: true,
            deathEvents: [{ victimIndex: 0, attackerIndex: null, credited: false }],
        });
        expect(telemetry.rounds[0].intermissionSeconds).toBeGreaterThanOrEqual(0.9);
        expect(telemetry.rounds[1]).toMatchObject({ round: 2, completed: false, deathEvents: [] });
        expect(telemetry.activeSeconds + telemetry.resolutionSeconds + telemetry.intermissionSeconds).toBeCloseTo(2);
    });

    it.each([4, 9, 16, 25, 32, 44, 53, 59])('preserves real opponent knowledge and three player previews through a round reset on orb %i', async (levelId) => {
        const originalPrepare = OdysseyBotMatch.prototype.prepareBot;
        const originalUpdate = OdysseyBotMatch.prototype.update;
        const originalOpponentPlan = PuzzleBotController.prototype.plan;
        const originalHumanPlan = BenchmarkBot.prototype.plan;
        const opponentRounds = new Set();
        const humanRounds = new Set();
        let match;
        vi.spyOn(OdysseyBotMatch.prototype, 'prepareBot').mockImplementation(function prepare(...args) {
            match = this;
            // The instance must use the production method directly, with no planning-view wrapper.
            expect(this.bot.plan).toBe(PuzzleBotController.prototype.plan);
            return originalPrepare.apply(this, args);
        });
        vi.spyOn(PuzzleBotController.prototype, 'plan').mockImplementation(function plan(...args) {
            const actualState = match.players[1];
            const actualBag = actualState.nextPieces;
            expect(this.playerState).toBe(actualState);
            expect(this.playerState.nextPieces).toBe(actualBag);
            expect(actualBag.length).toBeGreaterThan(3);
            opponentRounds.add(match.round);
            const result = originalOpponentPlan.apply(this, args);
            expect(this.playerState).toBe(actualState);
            expect(this.playerState.nextPieces).toBe(actualBag);
            return result;
        });
        vi.spyOn(BenchmarkBot.prototype, 'plan').mockImplementation(function plan(...args) {
            const actualState = match.players[0];
            const actualBag = actualState.nextPieces;
            expect(this.playerState).not.toBe(actualState);
            expect(this.playerState.nextPieces).toEqual(actualBag.slice(0, 3));
            expect(this.playerState.nextPieces).toHaveLength(3);
            expect(actualBag.length).toBeGreaterThan(3);
            humanRounds.add(match.round);
            const result = originalHumanPlan.apply(this, args);
            expect(actualState.nextPieces).toBe(actualBag);
            return result;
        });
        vi.spyOn(OdysseyBotMatch.prototype, 'update').mockImplementation(function update(...args) {
            const result = originalUpdate.apply(this, args);
            if (this.round === 1 && !this.pendingDeaths.size && this.roundActive
                && humanRounds.has(1) && opponentRounds.has(1)) {
                this.markTopOut(0);
            }
            return result;
        });
        const result = await runAttempt({
            levelId, seed: 42, profile: 'stacker', maxSimSeconds: 3,
        });
        expect(result).toMatchObject({
            outcome: 'censored',
            opponentKnowledgePolicy: 'production-full-real-bag',
            opponentPlanningPreviewLimit: null,
            opponentVisiblePreviewCount: 3,
            humanPlanningPreviewLimit: 3,
            duel: { round: 2, deaths: 1 },
        });
        expect([...opponentRounds]).toEqual([1, 2]);
        expect([...humanRounds]).toEqual([1, 2]);
    });

    it('preserves real duel quad and perfect-clear attack counters across the round barrier', async () => {
        let columnPrepared = false;
        let match;
        const originalPrepareBot = OdysseyBotMatch.prototype.prepareBot;
        vi.spyOn(OdysseyBotMatch.prototype, 'prepareBot').mockImplementation(function captureMatch() {
            match = this;
            return originalPrepareBot.call(this);
        });
        fixture.factory = (deps) => {
            const firstQuad = quadBot(deps);
            const {
                gameState, getPendingGarbage, cadenceId,
            } = deps;
            expect(cadenceId).toBe('steady');
            expect(getPendingGarbage()).toBe(0);
            return {
                reset() {},
                update() {
                    firstQuad.update();
                    if (columnPrepared || gameState.isProcessingPhysics || gameState.piecesPlaced !== 2) return;
                    const botState = match.players[1];
                    if (!botState.currentPiece || botState.isProcessingPhysics) return;
                    columnPrepared = true;
                    // The real quad attack already credited the human as last attacker.
                    expect(match.multiplayer.lastAttackerIds[1]).toBe(0);
                    while (botState.currentPiece.x > 0) match.bot.actions.moveLeft();
                    botState.lockedPieces.push({
                        pieceId: 9999,
                        shapeKey: 'GARBAGE',
                        color: '#808080',
                        x: 4,
                        y: 2,
                        shape: Array.from({ length: botState.boardGrid.length - 2 }, () => [1]),
                    });
                    markBoardDirty(botState);
                    rebuildBoardGridFromPieces(botState.lockedPieces, botState.boardGrid);
                    match.bot.actions.hardDrop();
                },
            };
        };
        const result = await runAttempt({
            levelId: 4, seed: 42, cadenceId: 'steady', scenarioId: 'duel-fall850', maxSimSeconds: 3,
        });
        expect(result).toMatchObject({
            scenarioId: 'duel-fall850',
            cadenceId: 'steady',
            outcome: 'censored',
            duel: { round: 2 },
            effectiveConfig: { physicsPolicy: { initialIntervalMs: 850, levelProgression: false } },
        });
        const { players, rounds } = result.duel.telemetry;
        expect(players[0].attacksSent).toBe(1);
        expect(players[0].attackLinesSent).toBeGreaterThan(0);
        expect(players[0].cleanLinesSent).toBeGreaterThan(0);
        expect(players[1].attacksReceived).toBe(players[0].attacksSent);
        expect(players[1].attackLinesReceived).toBe(players[0].attackLinesSent);
        expect(players[1].cleanLinesReceived).toBe(players[0].cleanLinesSent);
        expect(rounds[0].players[0].attackLinesSent).toBe(players[0].attackLinesSent);
        expect(rounds[1].players[0].attackLinesSent).toBe(0);
        expect(rounds[0].players[0].frags).toBe(1);
        expect(rounds[0].players[1]).toMatchObject({ creditedDeaths: 1, uncreditedDeaths: 0 });
        expect(rounds[0].deathEvents).toEqual([{ victimIndex: 1, attackerIndex: 0, credited: true }]);
    });

    it('returns implementation errors separately and restores globals before the next attempt', async () => {
        const NativeDate = Date;
        fixture.factory = () => ({ reset() {}, update() { throw new Error('planner failed'); } });
        const result = await runAttempt({ levelId: 9001, seed: 42, maxSimSeconds: 2 });
        expect(result).toMatchObject({ outcome: 'error', reason: 'planner failed' });
        expect(Date).toBe(NativeDate);
        fixture.factory = () => ({ reset() {}, update() {} });
        const next = await runAttempt({ levelId: 9001, seed: 42, maxSimSeconds: 0.1 });
        expect(next).toMatchObject({ outcome: 'censored', reason: 'simulation-budget' });
    });

    it('rejects invalid seeds, budgets and unknown levels without claiming a content loss', async () => {
        expect(await runAttempt({ levelId: 9999, seed: 42 })).toMatchObject({ outcome: 'error' });
        expect(await runAttempt({ levelId: 1, seed: -1 })).toMatchObject({ outcome: 'error' });
        expect(await runAttempt({ levelId: 1, seed: 42, maxPieces: 0 })).toMatchObject({ outcome: 'error' });
        expect(await runAttempt({ levelId: 1, seed: 42, lapWindowSeconds: 0 })).toMatchObject({ outcome: 'error' });
        const unsupported = await runAttempt({ levelId: 1, seed: 42, scenarioId: 'duel-fall700' });
        expect(unsupported).toMatchObject({ outcome: 'error' });
    });
});
