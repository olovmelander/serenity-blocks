/**
 * WaystonesMode on a real GameState: the road is laid from the world on screen and held
 * there, a climate takes hold and lets go, a stop completes on its goal and the road
 * waits, banking keeps the board and pays on arrival, releasing empties it, the next world
 * switches under the mode's own permission, a top-out spends a lantern and drops the
 * carried ask, the charms pay, points relight a lantern, the Keeper ends it, and the state
 * the HUD draws is published.
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
import { CLIMATES, climateById, effectiveDropMs } from '../../src/core/waystones/climates.js';
import { scaledGoal } from '../../src/core/waystones/road.js';
import { RELIGHT_COST, nextOffers, recordStop } from '../../src/core/waystones/run.js';
import { buildPuzzle } from '../../src/core/fault-lines/fault-lines-puzzle.js';
import { bankPuzzle } from '../../src/core/fault-lines/puzzle-bank.js';
import { createRun as createPuzzleRun, solutionPlacement } from '../../src/core/fault-lines/fault-lines-sim.js';
import { playPlacement, playUntil } from './helpers/waystones-bot.js';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
vi.mock('../../src/ui/next-queue-ui.js', () => ({ updateNextQueue: vi.fn() }));

const { WaystonesMode } = await import('../../src/core/game-modes/WaystonesMode.js');
const { SinglePlayerMode } = await import('../../src/core/game-modes/SinglePlayerMode.js');

const playLevelUp = vi.fn();
const sfxPlayer = new Proxy({ playLevelUp }, { get: (target, name) => target[name] || (() => {}) });
const themeManager = {
    activeThemeName: 'forest',
    getAvailableThemes: () => ['forest', 'halcyon-apex', 'thermal-bloom', 'painted-ages'],
    beginOdysseyThemeScope: vi.fn((themeId, options) => ({ themeId, options })),
    endOdysseyThemeScope: vi.fn(async () => {
        themeManager.activeThemeName = 'forest';
        return 'forest';
    }),
    switchTheme: vi.fn(async (id) => {
        themeManager.activeThemeName = id;
        return id;
    }),
};
const settings = { backgroundMode: 'Level', backgroundTheme: 'forest' };

const modes = [];
const flush = async () => {
    await new Promise((resolve) => { setTimeout(resolve, 0); });
};

function startMode(seed = 'dawn') {
    const mode = new WaystonesMode({
        settingsManager: { get: () => settings },
        soundManager: { sfxPlayer },
        themeManager,
    });
    mode.isActive = true;
    mode.isRunning = true;
    mode._homeTheme = 'forest';
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
const send = (command) => eventBus.emit(EVENTS.WAYSTONES_COMMAND, command);
let stop;
beforeEach(() => {
    vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null });
    themeManager.activeThemeName = 'forest';
    themeManager.switchTheme.mockClear();
    themeManager.beginOdysseyThemeScope.mockClear();
    themeManager.endOdysseyThemeScope.mockClear();
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

/** A column of I pieces across the spawn's columns, up to the roof: the next deal is blocked. */
function wallToTheRoof() {
    const wall = [];
    for (let x = 3; x <= 6; x += 1) {
        for (let y = 0; y < 24; y += 4) {
            wall.push({
                x, y, shape: [[1], [1], [1], [1]], pieceId: 900 + wall.length, shapeKey: 'I', type: 'I', color: '#0f0',
            });
        }
    }
    return wall;
}

function raise(mode, wall) {
    restoreBoardState(mode.gameState, {
        grid: rebuildBoardGridFromPieces(wall, createBoardGrid()), lockedPieces: wall,
    }, { adoptBoard: true });
    mode.gameState.currentPiece = null;
    mode._deal();
}

describe('WaystonesMode', () => {
    it('lays a five-stop road from the world on screen, latches the rules, and holds the world', () => {
        const mode = startMode();
        expect(mode.gameState.disableLevelProgression).toBe(true);
        expect(mode.gameState.finiteSupply).toBe(false);
        expect(mode._recordsDemos()).toBe(false);
        expect(mode._allowsFixedTick()).toBe(false);
        expect(mode._run.road.stops).toHaveLength(5);
        expect(mode._run.seed).toBe('dawn');
        expect(mode._run.stop.world).toEqual({ id: 'forest', name: 'Forest' });
        expect(mode.gameState.currentPiece).not.toBeNull();
        // The road holds its world with a scoped permission, so Single Player's own theme
        // changes (the level journey, the Random timer) cannot move it.
        expect(themeManager.beginOdysseyThemeScope).toHaveBeenCalledTimes(1);
        const [worldId, options] = themeManager.beginOdysseyThemeScope.mock.calls[0];
        expect(worldId).toBe('forest');
        expect(options.restoreTheme).toBe('forest');
        expect(options.isCurrent()).toBe(true);
        expect(mode._themeHold).toEqual(themeManager.beginOdysseyThemeScope.mock.results[0].value);
        expect(last()).toMatchObject({
            active: true, phase: 'play', stopIndex: 0, stopCount: 5, lanterns: 3, score: 0, switching: false,
        });
        expect(last().road.map((entry) => entry.state)).toEqual(['current', 'ahead', 'ahead', 'ahead', 'ahead']);
        expect(last().goal.text).toMatch(/^Clear \d+ lines$/); // the first stop is gentle
        expect(last().climate.pace).toMatch(/^(slow|steady)$/);
    });

    it('gives the player\'s theme back when the mode is left', async () => {
        const mode = startMode();
        const token = mode._themeHold;
        vi.spyOn(SinglePlayerMode.prototype, 'onDeactivate').mockResolvedValue(undefined);
        await mode.onDeactivate();
        expect(themeManager.endOdysseyThemeScope).toHaveBeenCalledWith(token);
        expect(mode._themeHold).toBeNull();
        expect(mode._run).toBeNull();
        expect(last()).toEqual({ active: false });
    });

    it('applies every climate as its card promises, and the next stop never inherits it', () => {
        const mode = startMode();
        const { gameState } = mode;
        const climate = (id) => {
            mode._run.stop.climate = climateById(id);
            mode._applyClimate();
        };
        for (const entry of CLIMATES) {
            climate(entry.id);
            expect(gameState.dropInterval, entry.id).toBeCloseTo(effectiveDropMs(entry), 5);
            expect(gameState.mirrorControls, entry.id).toBe(entry.modifiers.includes('mirror'));
            expect(mode._mist, entry.id).toBe(entry.modifiers.includes('mist'));
            expect(gameState.comboMultiplierEnabled, entry.id).toBe(entry.modifiers.includes('combo-multiplier'));
            expect(gameState.lockDelay, entry.id).toBe(entry.modifiers.includes('long-breath') ? 900 : 500);
        }
        climate('mirror-pool');
        const before = gameState.currentPiece.x;
        expect(mode._applyCommand({ type: 'move', value: 1 })).toBe(true);
        expect(gameState.currentPiece.x).toBe(before - 1); // right is left
        climate('clear-night');
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
        expect(state.between).toMatchObject({
            settled: false, autoReleased: false, canBank: true, tooTall: false, charmSettled: false,
        });
        expect(state.between.draft).toHaveLength(3);
        expect(state.between.offers).toHaveLength(2);
        expect(state.between.offers[0].climate.pace).toBeTruthy();
        expect(state.between.offers[0].goalIfBanked.target)
            .toBeGreaterThanOrEqual(state.between.offers[0].goalIfReleased.target);
        expect(state.between.relight).toMatchObject({ cost: RELIGHT_COST, can: false, why: 'full' });
        expect(state.road[0].state).toBe('done');
        // Nothing moves while the road waits, and the next world cannot be chosen first.
        expect(mode._applyCommand({ type: 'move', value: 1 })).toBe(false);
        send({ type: 'choose', offer: 0 });
        expect(mode._run.phase).toBe('between');
        expect(themeManager.switchTheme).not.toHaveBeenCalled();
    });

    it('banks the stack: nothing is paid yet, the next ask rises, the world switches under the hold', async () => {
        const mode = startMode('bank');
        await finishStop(mode, 1);
        const { gameState } = mode;
        const rows = mode._stackMaterial();
        expect(rows).toBeGreaterThan(0);
        const lockedBefore = gameState.lockedPieces.length;
        const scoreBefore = gameState.score;
        send({ type: 'bank' });
        expect(gameState.score).toBe(scoreBefore); // paid once the next stop is cleared
        expect(last().between).toMatchObject({
            settled: true, banked: true, carriedRows: rows, toll: rows * 60,
        });
        const [, offer] = nextOffers(mode._run);
        send({ type: 'charm', charmId: last().between.draft[0].id });
        send({ type: 'choose', offer: 1 });
        expect(last().switching).toBe(true);
        expect(themeManager.beginOdysseyThemeScope).toHaveBeenLastCalledWith(offer.world.id, expect.any(Object));
        const token = themeManager.beginOdysseyThemeScope.mock.results.at(-1).value;
        expect(themeManager.switchTheme).toHaveBeenCalledWith(offer.world.id, false, token);
        await flush();
        expect(mode._run.phase).toBe('play');
        expect(mode._run.stopIndex).toBe(1);
        expect(mode._run.stop.world).toEqual(offer.world);
        expect(mode._run.stop.carriedToll).toBe(rows * 60);
        expect(mode._run.stop.goal).toEqual(scaledGoal(climateById(offer.climateId), {
            carriedRows: rows, ballast: mode._run.charms.includes('ballast'), keel: mode._run.charms.includes('keel'),
        }));
        expect(gameState.lockedPieces).toHaveLength(lockedBefore); // the stack came along
        expect(gameState.currentPiece).not.toBeNull();
        expect(last()).toMatchObject({
            phase: 'play', switching: false, stopIndex: 1, carriedRows: rows, carriedToll: rows * 60,
        });
        // Clearing that stop pays the bank.
        await finishStop(mode, 1);
        expect(gameState.score).toBeGreaterThanOrEqual(scoreBefore + rows * 60);
        expect(last()).toMatchObject({ phase: 'between', lastPayout: rows * 60 });
    });

    it('releases the stack: the well empties and the ask is the base', async () => {
        const mode = startMode('release');
        await finishStop(mode, 1);
        send({ type: 'release' });
        expect(mode.gameState.lockedPieces).toEqual([]);
        expect(mode.gameState.boardGrid.every((row) => row.every((cell) => !cell))).toBe(true);
        send({ type: 'bank' }); // settled once
        expect(last().between.banked).toBe(false);
        const [offer] = nextOffers(mode._run);
        send({ type: 'skip-charm' });
        send({ type: 'choose', offer: 0 });
        await flush();
        expect(mode._run.stop.goal).toEqual(scaledGoal(climateById(offer.climateId)));
        expect(mode._run.stop.carriedToll).toBe(0);
    });

    it('refuses to bank a stack that reaches the roof, and an empty well settles itself', async () => {
        const mode = startMode('tall');
        mode._run.stop.goal = { type: 'lines', target: 1 };
        recordStop(mode._run, { lines: 1, score: 0, cascades: 0 });
        const wall = wallToTheRoof();
        restoreBoardState(mode.gameState, {
            grid: rebuildBoardGridFromPieces(wall, createBoardGrid()), lockedPieces: wall,
        }, { adoptBoard: true });
        mode._completeStop();
        expect(last().between).toMatchObject({ tooTall: true, canBank: false, settled: false });
        send({ type: 'bank' });
        expect(mode._run.between.banked).toBeNull();
        send({ type: 'release' });
        expect(mode._run.between.banked).toBe(false);

        const empty = startMode('empty');
        empty._run.stop.goal = { type: 'lines', target: 1 };
        recordStop(empty._run, { lines: 1, score: 0, cascades: 0 });
        empty._clearBoard();
        empty._completeStop();
        expect(last().between).toMatchObject({
            settled: true, banked: false, autoReleased: true, stackRows: 0,
        });
    });

    it('spends a lantern on a top-out, drops the carried ask, clears the well and deals again; the last ends the road', async () => {
        const mode = startMode('dark');
        const { gameState } = mode;
        const wall = wallToTheRoof();
        mode._run.stop.carriedRows = 10;
        mode._run.stop.carriedToll = 600;
        const base = scaledGoal(mode._run.stop.climate);
        mode._run.stop.goal = { ...base, target: base.target + 5 };
        raise(mode, wall);
        await flush();
        expect(gameState.isGameOver).toBe(false);
        expect(mode._run.lanterns).toBe(2);
        expect(mode._run.stop.goal).toEqual(base); // the banked stack is gone, so is its ask
        expect(mode._run.stop.carriedToll).toBe(0);
        expect(gameState.lockedPieces).toEqual([]);
        expect(gameState.currentPiece).not.toBeNull();
        expect(last()).toMatchObject({ phase: 'play', lanterns: 2, lastLantern: { stopIndex: 0, forgiven: false } });

        mode._run.charms.push('hearth');
        raise(mode, wall);
        await flush();
        expect(mode._run.lanterns).toBe(2);
        expect(last().lastLantern).toEqual({ stopIndex: 0, forgiven: true });
        raise(mode, wall); // Hearth forgives once a road
        await flush();
        expect(mode._run.lanterns).toBe(1);

        raise(mode, wall);
        await flush();
        expect(mode._run.phase).toBe('ended');
        expect(gameState.lockedPieces).toHaveLength(wall.length); // the dead stack stays
        expect(gameState.currentPiece).toBeNull();
        expect(last().ended).toMatchObject({
            won: false, reason: 'lanterns', stopsCleared: 0, lanternsLeft: 0,
        });
    });

    it('completes the stop at once when a top-out\'s smaller ask is already met', async () => {
        const mode = startMode('met');
        mode._run.stop.climate = climateById('clear-night');
        const base = scaledGoal(mode._run.stop.climate);
        mode._run.stop.carriedRows = 10;
        mode._run.stop.goal = { type: 'lines', target: base.target + 5 };
        recordStop(mode._run, { lines: base.target + 2, score: 0, cascades: 0 });
        raise(mode, wallToTheRoof());
        await flush();
        expect(mode._run.lanterns).toBe(2);
        expect(mode._run.phase).toBe('between');
        expect(last().between.autoReleased).toBe(true);
    });

    it('Kindle pays half again on a cascade two waves deep', async () => {
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
        // the clear's after it; Kindle pays on the clear's.
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

        const mode = startMode('kindle');
        mode._run.charms.push('kindle');
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

    it('relights a lantern for points, once between stops', async () => {
        const mode = startMode('relight');
        raise(mode, wallToTheRoof());
        await flush();
        expect(mode._run.lanterns).toBe(2);
        await finishStop(mode, 1);
        mode.gameState.score = RELIGHT_COST + 100;
        mode._publish();
        expect(last().between.relight).toMatchObject({ can: true, why: null });
        send({ type: 'relight' });
        expect(mode._run.lanterns).toBe(3);
        expect(mode.gameState.score).toBe(100);
        expect(last().between.relight).toMatchObject({ can: false, why: 'done' });
        send({ type: 'relight' });
        expect(mode._run.lanterns).toBe(3);
        expect(mode.gameState.score).toBe(100);
    });

    it('names the world it arrived in when the switch landed elsewhere', async () => {
        const mode = startMode('elsewhere');
        await finishStop(mode, 1);
        send({ type: 'release' });
        send({ type: 'skip-charm' });
        themeManager.switchTheme.mockImplementationOnce(async () => 'forest');
        const [offer] = nextOffers(mode._run);
        expect(offer.world.id).not.toBe('forest');
        send({ type: 'choose', offer: 0 });
        await flush();
        expect(mode._run.phase).toBe('play');
        expect(mode._run.stop.world.id).toBe('forest');
        expect(last().world.name).toBe('Forest');
    });

    it('ties a world switch to its run: a new road is not stuck behind an old switch', async () => {
        const mode = startMode('stuck');
        await finishStop(mode, 1);
        send({ type: 'release' });
        send({ type: 'skip-charm' });
        themeManager.switchTheme.mockImplementationOnce(() => new Promise(() => {})); // never lands
        send({ type: 'choose', offer: 0 });
        expect(mode._switching).toBe(mode._run);
        expect(last().switching).toBe(true);
        mode._beginRoad('fresh');
        mode._deal();
        mode._publish();
        expect(mode._switching).toBeNull();
        expect(last()).toMatchObject({ switching: false, phase: 'play', stopIndex: 0 });
        expect(mode._applyCommand({ type: 'move', value: 1 })).toBe(true);
    });

    it('ends in the light at the Keeper, then walks a new road or the same one again', async () => {
        const mode = startMode('keeper');
        for (let index = 0; index < 4; index += 1) {
            // eslint-disable-next-line no-await-in-loop
            await finishStop(mode, 1);
            send({ type: index % 2 ? 'bank' : 'release' });
            const [charm] = mode._run.between.draft;
            send({ type: 'charm', charmId: charm });
            expect(mode._run.charms).toContain(charm);
            send({ type: 'choose', offer: index % 2 });
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
        send({ type: 'again', seed: oldSeed });
        expect(mode._run.seed).toBe(oldSeed); // the same road again
        expect(mode._run.phase).toBe('play');
        expect(mode.gameState.score).toBe(0);
        expect(mode.gameState.lockedPieces).toEqual([]);
        expect(mode.gameState.currentPiece).not.toBeNull();
        expect(mode._run.stop.world.id).toBe(themeManager.activeThemeName);
        mode._run.phase = 'ended';
        mode._run.ended = { won: true, reason: 'keeper' };
        send({ type: 'again' });
        expect(mode._run.seed).not.toBe(oldSeed); // a fresh one
    });

    it('ignores choices out of turn and publishes a refresh on request', () => {
        const mode = startMode();
        const piece = mode.gameState.currentPiece;
        send({ type: 'bank' });
        send({ type: 'relight' });
        send({ type: 'again' });
        expect(mode._run.phase).toBe('play');
        expect(mode.gameState.currentPiece).toBe(piece);
        const count = states.length;
        send({ type: 'refresh' });
        expect(states.length).toBe(count + 1);
        mode.isPaused = true;
        send({ type: 'refresh' });
        expect(states.length).toBe(count + 1);
    });
});
