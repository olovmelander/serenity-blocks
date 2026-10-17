/**
 * WaystonesMode on a real GameState: the road is laid from the world on screen, a climate
 * takes hold and lets go, a stop completes on its goal and the road waits, banking keeps
 * the board and pays, releasing empties it, the next world switches, a top-out spends a
 * lantern, the charms pay, the Keeper ends it, and the state the HUD draws is published.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    GameState, hardDrop, move, restoreBoardState, rotate, softDrop, spawnPiece,
} from '../../src/core/game.js';
import { createBoardGrid, rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { bindLegacySessionRng } from '../../src/core/session-rng.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { climateById } from '../../src/core/waystones/climates.js';
import { scaledGoal } from '../../src/core/waystones/road.js';
import { nextOffers } from '../../src/core/waystones/run.js';
import { buildPuzzle } from '../../src/core/fault-lines/fault-lines-puzzle.js';
import { bankPuzzle } from '../../src/core/fault-lines/puzzle-bank.js';
import { createRun as createPuzzleRun, solutionPlacement } from '../../src/core/fault-lines/fault-lines-sim.js';
import { playPlacement, playUntil } from './helpers/waystones-bot.js';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
vi.mock('../../src/ui/next-queue-ui.js', () => ({ updateNextQueue: vi.fn() }));

const { WaystonesMode } = await import('../../src/core/game-modes/WaystonesMode.js');

const playLevelUp = vi.fn();
const sfxPlayer = new Proxy({ playLevelUp }, { get: (target, name) => target[name] || (() => {}) });
const themeManager = {
    activeThemeName: 'forest',
    getAvailableThemes: () => ['forest', 'halcyon-apex', 'thermal-bloom', 'painted-ages'],
    switchTheme: vi.fn(async (id) => {
        themeManager.activeThemeName = id;
        return id;
    }),
};

const modes = [];
const flush = async () => {
    await new Promise((resolve) => { setTimeout(resolve, 0); });
};

function startMode(seed = 'dawn') {
    const mode = new WaystonesMode({
        settingsManager: { get: () => ({}) },
        soundManager: { sfxPlayer },
        themeManager,
    });
    mode.isActive = true;
    mode.isRunning = true;
    mode.gameState = mode._createSessionGameState({ hitStopEnabled: false });
    mode.gameState.isSeeking = true; // physics skips its animation delays
    bindLegacySessionRng(mode.gameState, 7);
    mode._roadSeed = seed;
    mode._dealSessionPieces(); // fills the bag and lays the road, as Single Player's onStart does
    mode._deal();
    // onActivate subscribes the HUD's commands; the session here is built by hand.
    mode._stopCommands = eventBus.on(EVENTS.WAYSTONES_COMMAND, (command) => mode._onCommand(command));
    modes.push(mode);
    mode._publish();
    return mode;
}

const states = [];
const last = () => states.at(-1);
let stop;
beforeEach(() => {
    vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null });
    themeManager.activeThemeName = 'forest';
    themeManager.switchTheme.mockClear();
    states.length = 0;
    playLevelUp.mockClear();
    stop = eventBus.on(EVENTS.WAYSTONES_STATE, (state) => states.push(state));
});
afterEach(() => {
    stop();
    modes.splice(0).forEach((mode) => mode._stopCommands?.());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** Plays the mode's bot until the stop completes. */
async function finishStop(mode, target = 1) {
    mode._run.stop.goal = { ...mode._run.stop.goal, type: 'lines', target };
    const pieces = await playUntil(
        mode.gameState,
        () => mode._getPhysicsCallbacks(),
        () => mode._run.phase !== 'play',
        { maxPieces: 120 },
    );
    expect(mode._run.phase, `after ${pieces} pieces`).not.toBe('play');
}

describe('WaystonesMode', () => {
    it('lays a five-stop road from the world on screen and latches the rules', () => {
        const mode = startMode();
        expect(mode.gameState.disableLevelProgression).toBe(true);
        expect(mode.gameState.finiteSupply).toBe(false);
        expect(mode.gameState.gravityWaits).toBe(false);
        expect(mode._recordsDemos()).toBe(false);
        expect(mode._allowsFixedTick()).toBe(false);
        expect(mode._run.road.stops).toHaveLength(5);
        expect(mode._run.seed).toBe('dawn');
        expect(mode._run.stop.world).toEqual({ id: 'forest', name: 'Forest' });
        expect(mode.gameState.currentPiece).not.toBeNull();
        expect(last()).toMatchObject({
            active: true, phase: 'play', stopIndex: 0, stopCount: 5, lanterns: 3, score: 0,
        });
        expect(last().road.map((entry) => entry.state)).toEqual(['current', 'ahead', 'ahead', 'ahead', 'ahead']);
        expect(last().goal.text).toMatch(/^(Clear|Score|Set off)/);
    });

    it('applies a climate to the GameState, and the next stop never inherits it', () => {
        const mode = startMode();
        const { gameState } = mode;
        const climate = (id) => {
            mode._run.stop.climate = climateById(id);
            mode._applyClimate();
        };
        climate('still-air');
        expect(gameState.dropInterval).toBe(1152); // 720 × 1.6
        expect(gameState.lockDelay).toBe(900);
        climate('rising-wind');
        expect(gameState.dropInterval).toBeCloseTo(320 / 1.5, 5);
        expect(gameState.speedMultiplier).toBe(1.5);
        expect(gameState.lockDelay).toBe(500);
        climate('mirror-pool');
        expect(gameState.mirrorControls).toBe(true);
        const before = gameState.currentPiece.x;
        expect(mode._applyCommand({ type: 'move', value: 1 })).toBe(true);
        expect(gameState.currentPiece.x).toBe(before - 1); // right is left
        climate('mist');
        expect(gameState.mirrorControls).toBe(false);
        expect(mode._mist).toBe(true);
        climate('ember-wind');
        expect(gameState.comboMultiplierEnabled).toBe(true);
        expect(mode._mist).toBe(false);
        climate('clear-night');
        expect(gameState.comboMultiplierEnabled).toBe(false);
        expect(gameState.dropInterval).toBe(320);
        expect(gameState.speedMultiplier).toBeUndefined();
        mode._publish();
        expect(last()).toMatchObject({ mist: false, mirror: false });
        expect(last().climate.modifiers).toEqual([]);
    });

    it('completes a stop on its goal, chimes, and waits with the choices open', async () => {
        const mode = startMode();
        await finishStop(mode, 2);
        expect(mode.gameState.currentPiece).toBeNull();
        expect(playLevelUp).toHaveBeenCalledTimes(1);
        const state = last();
        expect(state.phase).toBe('between');
        expect(state.stopLines).toBeGreaterThanOrEqual(2);
        expect(state.between.settled).toBe(false);
        expect(state.between.draft).toHaveLength(3);
        expect(state.between.offers).toHaveLength(2);
        expect(state.between.offers[0].goalIfBanked.target)
            .toBeGreaterThanOrEqual(state.between.offers[0].goalIfReleased.target);
        expect(state.road[0].state).toBe('done');
        // Nothing moves while the road waits, and the next world cannot be chosen first.
        expect(mode._applyCommand({ type: 'move', value: 1 })).toBe(false);
        eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'choose', offer: 0 });
        expect(mode._run.phase).toBe('between');
        expect(themeManager.switchTheme).not.toHaveBeenCalled();
    });

    it('banks the stack for a toll and a bigger ask, then switches to the chosen world', async () => {
        const mode = startMode('bank');
        await finishStop(mode, 1);
        const { gameState } = mode;
        const rows = mode._stackRows();
        expect(rows).toBeGreaterThan(0);
        const lockedBefore = gameState.lockedPieces.length;
        const scoreBefore = gameState.score;
        eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'bank' });
        expect(gameState.score).toBe(scoreBefore + rows * 60);
        expect(last().between).toMatchObject({
            settled: true, banked: true, carriedRows: rows, toll: rows * 60,
        });
        const [, offer] = nextOffers(mode._run);
        eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'choose', offer: 1 });
        expect(last().switching).toBe(true);
        expect(themeManager.switchTheme).toHaveBeenCalledWith(offer.world.id);
        await flush();
        expect(mode._run.phase).toBe('play');
        expect(mode._run.stopIndex).toBe(1);
        expect(mode._run.stop.world).toEqual(offer.world);
        expect(mode._run.stop.goal).toEqual(scaledGoal(climateById(offer.climateId), { carriedRows: rows }));
        expect(gameState.lockedPieces).toHaveLength(lockedBefore); // the stack came along
        expect(gameState.currentPiece).not.toBeNull();
        expect(last()).toMatchObject({
            phase: 'play', switching: false, stopIndex: 1, carriedRows: rows,
        });
        expect(last().world.name).toBe(offer.world.name);
    });

    it('releases the stack: the well empties and the ask is the base', async () => {
        const mode = startMode('release');
        await finishStop(mode, 1);
        eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'release' });
        expect(mode.gameState.lockedPieces).toEqual([]);
        expect(mode.gameState.boardGrid.every((row) => row.every((cell) => !cell))).toBe(true);
        eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'bank' }); // settled once
        expect(last().between.banked).toBe(false);
        const [offer] = nextOffers(mode._run);
        eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'choose', offer: 0 });
        await flush();
        expect(mode._run.stop.goal).toEqual(scaledGoal(climateById(offer.climateId)));
        expect(mode._run.toll).toBe(0);
    });

    it('spends a lantern on a top-out, clears the well and deals again; the last ends the road', async () => {
        const mode = startMode('dark');
        const { gameState } = mode;
        // A column of I pieces across the spawn's columns, up to the roof: the next deal is blocked.
        const wall = [];
        for (let x = 3; x <= 6; x += 1) {
            for (let y = 0; y < 24; y += 4) {
                wall.push({
                    x, y, shape: [[1], [1], [1], [1]], pieceId: 900 + wall.length, shapeKey: 'I', type: 'I', color: '#0f0',
                });
            }
        }
        const raise = () => {
            restoreBoardState(gameState, {
                grid: rebuildBoardGridFromPieces(wall, createBoardGrid()), lockedPieces: wall,
            }, { adoptBoard: true });
            gameState.currentPiece = null;
            mode._deal();
        };
        raise();
        await Promise.resolve();
        expect(gameState.isGameOver).toBe(false);
        expect(mode._run.lanterns).toBe(2);
        expect(gameState.lockedPieces).toEqual([]);
        expect(gameState.currentPiece).not.toBeNull();
        expect(last()).toMatchObject({ phase: 'play', lanterns: 2, lastLantern: { stopIndex: 0, forgiven: false } });

        mode._run.charms.push('hearth');
        mode._run.stop.topOuts = 0;
        raise();
        await Promise.resolve();
        expect(mode._run.lanterns).toBe(2);
        expect(last().lastLantern).toEqual({ stopIndex: 0, forgiven: true });

        mode._run.lanterns = 1;
        raise();
        await Promise.resolve();
        expect(mode._run.phase).toBe('ended');
        expect(gameState.lockedPieces).toHaveLength(wall.length); // the dead stack stays
        expect(gameState.currentPiece).toBeNull();
        expect(last().ended).toMatchObject({
            won: false, reason: 'lanterns', stopsCleared: 0, lanternsLeft: 0,
        });
    });

    it('Ember pays half again on a cascade two waves deep', async () => {
        // Fault Lines' "Second wave" board: an upright I sets off a two-wave cascade.
        const puzzle = buildPuzzle(bankPuzzle('second-wave'));
        const placement = solutionPlacement(createPuzzleRun(puzzle), puzzle.solution[0]);
        const load = (gameState) => {
            restoreBoardState(gameState, {
                grid: rebuildBoardGridFromPieces(puzzle.lockedPieces, createBoardGrid()),
                lockedPieces: puzzle.lockedPieces.map((piece) => ({ ...piece, shape: piece.shape.map((row) => row.slice()) })),
            }, { adoptBoard: true });
            gameState._pieceIdCounter = puzzle.nextPieceId - 1;
            gameState.nextPieces = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
        };
        // The same drop on a plain GameState: the drop's own points land before the lock,
        // the clear's after it; Ember pays on the clear's.
        const plain = new GameState({ hitStopEnabled: false, disableLevelProgression: true });
        plain.isSeeking = true;
        load(plain);
        plain.currentPiece = null;
        spawnPiece(plain);
        let atLock = 0;
        const plainCallbacks = { onPieceLock: () => { atLock = plain.score; }, spawnPiece: () => {} };
        for (const action of placement.actions) {
            if (action.type === 'move') move(plain, action.dir);
            else if (action.type === 'rotate') rotate(plain, action.dir);
            else softDrop(plain, null, plainCallbacks);
        }
        hardDrop(plain, null, plainCallbacks);
        await plain.latestPhysicsPromise;
        const awarded = plain.score;
        const clearPoints = awarded - atLock;
        expect(clearPoints).toBeGreaterThan(0);

        const mode = startMode('ember');
        mode._run.charms.push('ember');
        mode._run.stop.goal = { type: 'lines', target: 50 };
        load(mode.gameState);
        mode.gameState.currentPiece = null;
        mode._deal();
        expect(mode.gameState.currentPiece.shapeKey).toBe('I');
        await playPlacement(mode.gameState, placement, mode._getPhysicsCallbacks());
        expect(mode._lockWaves).toBe(2);
        expect(mode._cascades).toBe(1);
        expect(mode.gameState.score).toBe(awarded + Math.round(clearPoints * 0.5));
        expect(last()).toMatchObject({ stopCascades: 1, score: awarded + Math.round(clearPoints * 0.5) });
    });

    it('ends in the light at the Keeper and sets out again on a new road', async () => {
        const mode = startMode('keeper');
        for (let index = 0; index < 4; index += 1) {
            // eslint-disable-next-line no-await-in-loop
            await finishStop(mode, 1);
            eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: index % 2 ? 'bank' : 'release' });
            const [charm] = mode._run.between.draft;
            eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'charm', charmId: charm });
            expect(mode._run.charms).toContain(charm);
            eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'choose', offer: index % 2 });
            // eslint-disable-next-line no-await-in-loop
            await flush();
            expect(mode._run.stopIndex).toBe(index + 1);
        }
        expect(last().keeper).toBe(true);
        await finishStop(mode, 1);
        expect(mode._run.phase).toBe('ended');
        expect(last().ended).toMatchObject({
            won: true, reason: 'keeper', stopsCleared: 5, stopCount: 5,
        });
        expect(last().ended.worlds).toHaveLength(5);
        expect(themeManager.switchTheme).toHaveBeenCalledTimes(4);
        const oldSeed = mode._run.seed;
        eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'again' });
        expect(mode._run.seed).not.toBe(oldSeed);
        expect(mode._run.phase).toBe('play');
        expect(mode.gameState.score).toBe(0);
        expect(mode.gameState.lockedPieces).toEqual([]);
        expect(mode.gameState.currentPiece).not.toBeNull();
        expect(mode._run.stop.world.id).toBe(themeManager.activeThemeName);
    });

    it('ignores choices out of turn and publishes a refresh on request', () => {
        const mode = startMode();
        const piece = mode.gameState.currentPiece;
        eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'bank' });
        eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'again' });
        expect(mode._run.phase).toBe('play');
        expect(mode.gameState.currentPiece).toBe(piece);
        const count = states.length;
        eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'refresh' });
        expect(states.length).toBe(count + 1);
        mode.isPaused = true;
        eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type: 'refresh' });
        expect(states.length).toBe(count + 1);
    });
});
