import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    ODYSSEY_CHARM_REFUSALS, activateOdysseyCharm, applyOdysseyLongBreath, applyOdysseyTide, beginOdysseyStillAir,
    createOdysseyCharmRun, describeOdysseyCharmRun, odysseyCharmRefusal, odysseyCharmsAllowed, odysseyCharmsUsed,
    odysseyLevelNowMs, odysseyTideRows, reviveOdysseyWell, sweepLowestRows, syncOdysseyCharmHud, tickOdysseyCharms,
    tickOdysseyStillAir, tryOdysseyHearth,
} from '../../src/core/odyssey/odyssey-charm-use.js';
import {
    ODYSSEY_LONG_BREATH_SECONDS, ODYSSEY_STILL_AIR_MS, ODYSSEY_TIDE_ROWS,
} from '../../src/core/odyssey/odyssey-charm-bag.js';
import { GameState } from '../../src/core/game.js';
import { createBoardGrid, rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { VictoryConditionEvaluator } from '../../src/core/odyssey/VictoryConditionEvaluator.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { DEMO_FIXED_SIMULATION_CLOCK, DEMO_LEGACY_SIMULATION_CLOCK } from '../../src/core/demo/DemoRecorder.js';

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

const TIMED = { victory: { primary: { type: 'lines', target: 30 }, failure: { type: 'time', value: 180 } } };
const UNTIMED = { victory: { primary: { type: 'lines', target: 20 }, failure: { type: 'top-out' } } };

function createSession(overrides = {}) {
    return {
        charms: createOdysseyCharmRun(),
        gameState: createWell(),
        levelConfig: UNTIMED,
        hybridEngine: { extendTimeLimit: vi.fn() },
        physicsCallbacks: { spawnPiece: vi.fn() },
        simulationClock: DEMO_LEGACY_SIMULATION_CLOCK,
        ...overrides,
    };
}

function createMode(session, counts = {
    tide: 1, 'still-air': 1, 'long-breath': 1, hearth: 1,
}) {
    const hud = { updateCharms: vi.fn(), extendTimeLimit: vi.fn() };
    const effects = {
        scene: { cols: 10, rows: 20, blockSize: 30 },
        playLineClearImpact: vi.fn(),
        triggerLineClearFlash: vi.fn(),
        spawnLineClearParticles: vi.fn(),
        createShockwaveRing: vi.fn(),
        playPerfectClear: vi.fn(),
    };
    const sfx = {
        playLineClear: vi.fn(), playLevelUp: vi.fn(), playCascadeChime: vi.fn(), playPerfectClear: vi.fn(),
    };
    const bag = { ...counts };
    const mode = {
        _activeLevelSession: session,
        _isLevelSessionActive: (candidate) => candidate === session,
        levelRunStarted: true,
        isPaused: false,
        levelCompleting: false,
        isInExplorationMode: false,
        odysseyState: {
            getCharmCount: (id) => bag[id] || 0,
            getCharmCounts: () => ({ ...bag }),
            spendCharm: vi.fn((id) => { bag[id] -= 1; return true; }),
        },
        odysseyHUD: hud,
        deps: { soundManager: { sfxPlayer: sfx } },
        _getBoardScene: () => ({ sharedEffects: effects }),
        _elapsedLevelMs: () => 5000,
    };
    return {
        mode, hud, effects, sfx, bag,
    };
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
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
        expect(sweepLowestRows(undefined, 4, FLOOR)).toEqual({ pieces: [], removed: 0 });
    });

    it('refuses when the falling piece would sit inside the stack it settles', () => {
        // The T settles four rows, onto row 21 at columns 3-5. An O tucked under its arm, at
        // columns 2-3 of rows 20-21, would be inside it: Tide used to leave the two overlapping.
        const session = createSession();
        session.gameState.currentPiece = {
            shapeKey: 'O', shape: [[1, 1], [1, 1]], x: 2, y: 20,
        };
        const { mode } = createMode(session);
        const before = session.gameState.lockedPieces;

        expect(odysseyCharmRefusal(mode, session, 'tide', 1)).toBe('piece-in-way');
        expect(ODYSSEY_CHARM_REFUSALS['piece-in-way']).toBe('piece in the way');
        expect(applyOdysseyTide(session.gameState)).toBe(false);
        expect(session.gameState.lockedPieces).toBe(before);

        // One column over, the O is clear of the settled T and Tide goes ahead.
        session.gameState.currentPiece.x = 6;
        expect(odysseyCharmRefusal(mode, session, 'tide', 1)).toBeNull();
        expect(applyOdysseyTide(session.gameState)).toBe(true);
    });

    it('rewrites a live well through the restore boundary and refuses when there is nothing to sweep', () => {
        const gameState = createWell();
        const before = gameState.boardVersion || 0;
        expect(cells(gameState.boardGrid)).toBe(12);
        expect(odysseyTideRows(gameState)).toEqual([23, 22, 21, 20]);
        expect(applyOdysseyTide(gameState)).toBe(true);
        expect(gameState.lockedPieces).toHaveLength(2);
        expect(cells(gameState.boardGrid)).toBe(5);
        expect(gameState.boardGrid[23][4]).toBeTruthy();
        expect(gameState.boardVersion).toBeGreaterThan(before);
        expect(gameState.currentPiece.shapeKey).toBe('L');
        expect(gameState.boardCacheDirty).toBe(true);

        const empty = createWell([]);
        expect(applyOdysseyTide(empty)).toBe(false);
        const busy = createWell();
        busy.isProcessingPhysics = true;
        expect(applyOdysseyTide(busy)).toBe(false);
        expect(busy.lockedPieces).toHaveLength(3);
        const over = createWell();
        over.isGameOver = true;
        expect(applyOdysseyTide(over)).toBe(false);
        expect(applyOdysseyTide(null)).toBe(false);
        expect(odysseyTideRows({ boardGrid: [] })).toEqual([]);
        expect(odysseyTideRows({ boardGrid: [[], []] })).toEqual([1, 0]);
    });
});

describe('Still Air', () => {
    it('slows the fall for twenty seconds, follows a new pace underneath, then gives the pace back', () => {
        const session = createSession();
        session.gameState.dropInterval = 500;
        const air = beginOdysseyStillAir(session, 1000);
        expect(air).toEqual({ until: 1000 + ODYSSEY_STILL_AIR_MS, base: 500, slow: 1500 });
        expect(session.gameState.dropInterval).toBe(1500);
        expect(tickOdysseyStillAir(session, 6000)).toBe(ODYSSEY_STILL_AIR_MS - 5000);
        // A level-up quickens the pace underneath: Still Air slows that pace instead.
        session.gameState.dropInterval = 400;
        expect(tickOdysseyStillAir(session, 7000)).toBeGreaterThan(0);
        expect(session.gameState.dropInterval).toBe(1500);
        expect(tickOdysseyStillAir(session, 1000 + ODYSSEY_STILL_AIR_MS)).toBe(0);
        expect(session.gameState.dropInterval).toBe(400);
        expect(session.charms.stillAir).toBeNull();
        expect(tickOdysseyStillAir(session, 99999)).toBeNull();
        // A pace already slower than the gentlest fall is left as it is.
        session.gameState.dropInterval = 2000;
        expect(beginOdysseyStillAir(session, 0)).toMatchObject({ base: 2000, slow: 2000 });
        expect(beginOdysseyStillAir(null, 0)).toBeNull();
        expect(beginOdysseyStillAir({ charms: createOdysseyCharmRun() }, 0)).toBeNull();
    });

    it('never adds seconds to a clock: that is Long Breath', () => {
        const session = createSession({ levelConfig: TIMED });
        session.gameState.dropInterval = 500;
        beginOdysseyStillAir(session, 0);
        expect(session.hybridEngine.extendTimeLimit).not.toHaveBeenCalled();
        expect(session.gameState.dropInterval).toBe(1500);
    });
});

describe('Long Breath', () => {
    it('buys thirty more seconds on a deadline orb, which the evaluator honours from the authored limit', () => {
        const evaluator = new VictoryConditionEvaluator();
        const { victory } = TIMED;
        evaluator.updateTime(200);
        expect(evaluator.evaluateFailure({ isGameOver: false }, victory)).toBe(true);
        expect(evaluator.evaluate({ isGameOver: false }, victory)).toBe(false);
        const engine = Object.create(GameplayHybridEngine.prototype);
        engine.victoryEvaluator = evaluator;
        const session = createSession({ levelConfig: TIMED, hybridEngine: engine });
        expect(applyOdysseyLongBreath(session)).toBe(ODYSSEY_LONG_BREATH_SECONDS);
        expect(evaluator.timeLimitBonus).toBe(30);
        expect(evaluator.timeLimitFor(victory.failure)).toBe(210);
        expect(evaluator.evaluateFailure({ isGameOver: false }, victory)).toBe(false);
        evaluator.updateTime(211);
        expect(evaluator.evaluateFailure({ isGameOver: false }, victory)).toBe(true);
        // A goal reached inside the bought time still counts.
        evaluator.updateTime(205);
        evaluator.updateLines?.(30);
        evaluator.trackedMetrics.lines = 30;
        expect(evaluator.evaluate({ isGameOver: false }, victory)).toBe(true);
        expect(engine.extendTimeLimit(-5)).toBe(30);
        expect(engine.extendTimeLimit('x')).toBe(30);
        evaluator.reset();
        expect(evaluator.timeLimitFor(victory.failure)).toBe(180);
        expect(evaluator.timeLimitFor(undefined)).toBe(0);
    });

    it('does nothing on an orb without a clock, or without an engine to lengthen it', () => {
        const untimed = createSession();
        expect(applyOdysseyLongBreath(untimed)).toBe(0);
        expect(untimed.hybridEngine.extendTimeLimit).not.toHaveBeenCalled();
        expect(applyOdysseyLongBreath(createSession({ levelConfig: TIMED, hybridEngine: null }))).toBe(0);
        expect(applyOdysseyLongBreath(null)).toBe(0);
    });
});

describe('Hearth', () => {
    it('empties the well, keeps the piece in hand or deals one, and lets play go on', () => {
        const gameState = createWell();
        gameState.isGameOver = true;
        gameState.isAlive = false;
        gameState.dropCounter = 900;
        const spawn = vi.fn();
        expect(reviveOdysseyWell(gameState, { spawn })).toBe(true);
        expect(gameState.boardGrid.every((row) => row.every((cell) => cell === null))).toBe(true);
        expect(gameState.lockedPieces).toEqual([]);
        expect(gameState.isGameOver).toBe(false);
        expect(gameState.isAlive).toBe(true);
        expect(gameState.dropCounter).toBe(0);
        expect(gameState.currentPiece.shapeKey).toBe('L');
        expect(spawn).not.toHaveBeenCalled();

        const bare = createWell();
        bare.currentPiece = null;
        const dealt = vi.fn();
        expect(reviveOdysseyWell(bare, { spawn: dealt })).toBe(true);
        expect(dealt).toHaveBeenCalledOnce();
        expect(reviveOdysseyWell({ boardGrid: [] })).toBe(false);
        expect(reviveOdysseyWell(null)).toBe(false);
    });

    it('absorbs one top-out an orb once armed, never unarmed, during a showcase lap or on a retired session', () => {
        const session = createSession();
        const {
            mode, effects, sfx, hud,
        } = createMode(session);
        session.gameState.isGameOver = true;
        expect(tryOdysseyHearth(mode, session)).toBe(false);
        expect(session.gameState.isGameOver).toBe(true);
        session.charms.hearthArmed = true;
        expect(tryOdysseyHearth(mode, session)).toBe(true);
        expect(session.charms).toMatchObject({ hearthArmed: false, hearthUsed: true });
        expect(session.gameState.isGameOver).toBe(false);
        expect(session.gameState.lockedPieces).toEqual([]);
        expect(effects.playPerfectClear).toHaveBeenCalledWith(0);
        expect(sfx.playPerfectClear).toHaveBeenCalledOnce();
        expect(hud.updateCharms).toHaveBeenCalledOnce();
        // Once an orb: arming again changes nothing.
        session.charms.hearthArmed = true;
        session.gameState.isGameOver = true;
        expect(tryOdysseyHearth(mode, session)).toBe(false);
        expect(session.gameState.isGameOver).toBe(true);
        // A showcase lap's top-out is a completion, not a fall; a retired session is nobody's.
        const lap = createSession();
        lap.charms.hearthArmed = true;
        lap.gameState.victoryLapActive = true;
        expect(tryOdysseyHearth({ ...mode, _isLevelSessionActive: () => true }, lap)).toBe(false);
        expect(lap.charms.hearthArmed).toBe(true);
        const retired = createSession();
        retired.charms.hearthArmed = true;
        expect(tryOdysseyHearth(mode, retired)).toBe(false);
        expect(tryOdysseyHearth(mode, null)).toBe(false);
    });
});

describe('Using a charm during an orb', () => {
    it('Tide clears the floor now, is spent from the bag, marked used, shown on the tray, and felt on the well', () => {
        const session = createSession();
        const {
            mode, hud, effects, sfx, bag,
        } = createMode(session, { tide: 2 });
        expect(activateOdysseyCharm(mode, 'tide')).toEqual({ ok: true, charmId: 'tide' });
        expect(session.gameState.lockedPieces).toHaveLength(2);
        expect(mode.odysseyState.spendCharm).toHaveBeenCalledWith('tide');
        expect(bag.tide).toBe(1);
        expect(session.charms.used).toEqual(['tide']);
        expect(odysseyCharmsUsed(session)).toEqual(['tide']);
        // Three, not four: the four-line impact calls out a "Quad", and nothing Tide clears counts.
        expect(effects.playLineClearImpact).toHaveBeenCalledWith(3, 1);
        expect(effects.triggerLineClearFlash).toHaveBeenCalledWith([23, 22, 21, 20]);
        expect(effects.spawnLineClearParticles).toHaveBeenCalledWith([23, 22, 21, 20]);
        expect(sfx.playLineClear).toHaveBeenCalledOnce();
        expect(hud.updateCharms).toHaveBeenLastCalledWith(expect.objectContaining({
            hidden: false,
            charms: [expect.objectContaining({ id: 'tide', count: 1, state: 'used' })],
        }));
        // Once an attempt, however many are held.
        expect(activateOdysseyCharm(mode, 'tide')).toEqual({ ok: false, charmId: 'tide', reason: 'used' });
        expect(bag.tide).toBe(1);
        expect(ODYSSEY_CHARM_REFUSALS.used).toBe('used');
    });

    it('Still Air slows the fall and Long Breath lengthens the clock, the evaluator and the HUD together', () => {
        const timed = createSession({ levelConfig: TIMED });
        timed.gameState.dropInterval = 400;
        const { mode, hud, sfx } = createMode(timed);
        expect(activateOdysseyCharm(mode, 'still-air').ok).toBe(true);
        expect(timed.gameState.dropInterval).toBe(1500);
        expect(timed.charms.stillAir).toMatchObject({ until: 5000 + ODYSSEY_STILL_AIR_MS });
        expect(sfx.playLevelUp).toHaveBeenCalledOnce();
        expect(activateOdysseyCharm(mode, 'long-breath').ok).toBe(true);
        expect(timed.hybridEngine.extendTimeLimit).toHaveBeenCalledWith(ODYSSEY_LONG_BREATH_SECONDS);
        expect(hud.extendTimeLimit).toHaveBeenCalledWith(ODYSSEY_LONG_BREATH_SECONDS);
        expect(sfx.playCascadeChime).toHaveBeenCalled();
        expect(timed.charms.used).toEqual(['still-air', 'long-breath']);
    });

    it('Hearth arms the well with a ring, and the armed well absorbs the next top-out through the mode', () => {
        const session = createSession();
        const { mode, effects, sfx } = createMode(session);
        expect(activateOdysseyCharm(mode, 'hearth')).toEqual({ ok: true, charmId: 'hearth' });
        expect(session.charms.hearthArmed).toBe(true);
        expect(effects.createShockwaveRing).toHaveBeenCalledWith(150, 372, expect.any(Number), 1);
        expect(sfx.playLevelUp).toHaveBeenCalledOnce();
        session.gameState.isGameOver = true;
        expect(tryOdysseyHearth(mode, session)).toBe(true);
        expect(session.gameState.isGameOver).toBe(false);
        expect(activateOdysseyCharm(mode, 'hearth')).toMatchObject({ ok: false, reason: 'used' });
        // A scene without a well geometry draws no ring but still arms.
        const bare = createSession();
        const plain = createMode(bare);
        plain.mode._getBoardScene = () => null;
        expect(activateOdysseyCharm(plain.mode, 'hearth').ok).toBe(true);
    });

    it('refuses, and costs nothing, when the orb is not being played or the charm cannot act', () => {
        const session = createSession();
        const { mode, bag } = createMode(session);
        const refusal = (charmId) => activateOdysseyCharm(mode, charmId).reason;
        mode.levelRunStarted = false;
        expect(refusal('tide')).toBe('countdown');
        mode.levelRunStarted = true;
        mode.isPaused = true;
        expect(refusal('tide')).toBe('paused');
        mode.isPaused = false;
        session.gameState.isPaused = true;
        expect(refusal('hearth')).toBe('paused');
        session.gameState.isPaused = false;
        mode.levelCompleting = true;
        expect(refusal('hearth')).toBe('completing');
        mode.levelCompleting = false;
        session.gameState.victoryLapActive = true;
        expect(refusal('still-air')).toBe('lap');
        session.gameState.victoryLapActive = false;
        session.gameState.isGameOver = true;
        expect(refusal('still-air')).toBe('over');
        session.gameState.isGameOver = false;
        mode.isInExplorationMode = true;
        expect(refusal('tide')).toBe('look');
        mode.isInExplorationMode = false;
        session.gameState.isProcessingPhysics = true;
        expect(refusal('tide')).toBe('cascade');
        session.gameState.isProcessingPhysics = false;
        expect(refusal('long-breath')).toBe('no-clock');
        expect(refusal('keel')).toBe('unknown');
        bag.hearth = 0;
        expect(refusal('hearth')).toBe('none');
        expect(session.charms.used).toEqual([]);
        expect(mode.odysseyState.spendCharm).not.toHaveBeenCalled();
        Object.keys(ODYSSEY_CHARM_REFUSALS).forEach((code) => expect(ODYSSEY_CHARM_REFUSALS[code]).toBeTruthy());

        const floor = createSession({ gameState: createWell([]) });
        const bare = createMode(floor);
        expect(bare.mode.odysseyState.getCharmCount('tide')).toBe(1);
        expect(activateOdysseyCharm(bare.mode, 'tide').reason).toBe('empty-floor');
        expect(odysseyCharmRefusal(bare.mode, null, 'tide', 1)).toBe('no-session');
        expect(odysseyCharmRefusal(bare.mode, { ...floor, charms: null }, 'tide', 1)).toBe('no-session');
    });

    it('never acts on the fixed-tick clock, and hides the tray there', () => {
        const session = createSession({ simulationClock: DEMO_FIXED_SIMULATION_CLOCK });
        const { mode } = createMode(session);
        expect(odysseyCharmsAllowed(session)).toBe(false);
        expect(odysseyCharmsAllowed(createSession())).toBe(true);
        expect(odysseyCharmsAllowed(null)).toBe(false);
        expect(activateOdysseyCharm(mode, 'tide')).toEqual({ ok: false, charmId: 'tide', reason: 'fixed-clock' });
        expect(describeOdysseyCharmRun(session, { tide: 2 }).hidden).toBe(true);
        session.gameState.simTimeMs = 4200;
        expect(odysseyLevelNowMs(mode, session)).toBe(4200);
        expect(odysseyLevelNowMs(mode, createSession())).toBe(5000);
        expect(odysseyLevelNowMs(mode, null)).toBe(0);
    });
});

describe('The tray and the tick', () => {
    it('describes a chip for every charm held or used, with its state, countdown and standing refusal', () => {
        const session = createSession();
        expect(describeOdysseyCharmRun(session, {})).toEqual({
            hidden: true, paused: false, stillAir: false, charms: [],
        });
        expect(describeOdysseyCharmRun(null, { tide: 1 }).hidden).toBe(true);
        session.charms.used.push('tide', 'still-air', 'hearth');
        session.charms.stillAir = { until: 30000, base: 500, slow: 1500 };
        session.charms.hearthArmed = true;
        const view = describeOdysseyCharmRun(session, { tide: 0, 'long-breath': 2 }, 17500, { paused: true });
        expect(view.hidden).toBe(false);
        expect(view.paused).toBe(true);
        expect(view.stillAir).toBe(true);
        expect(view.charms.map((chip) => [chip.id, chip.state, chip.count, chip.remainingMs, chip.reason])).toEqual([
            ['tide', 'used', 0, 0, null],
            ['still-air', 'active', 0, 12500, null],
            ['long-breath', 'ready', 2, 0, 'no-clock'],
            ['hearth', 'armed', 0, 0, null],
        ]);
        expect(view.charms[0]).toMatchObject({
            name: 'Tide', key: '1', title: 'Tide · clears the bottom 4 rows. Once an attempt.',
        });
        // Still Air over, Hearth fired: both read used; a timed orb lifts Long Breath's standing refusal.
        session.charms.stillAir = null;
        session.charms.hearthArmed = false;
        session.charms.hearthUsed = true;
        session.levelConfig = TIMED;
        const later = describeOdysseyCharmRun(session, { 'long-breath': 1 }, 40000);
        expect(later.stillAir).toBe(false);
        expect(later.charms.map((chip) => [chip.id, chip.state, chip.reason])).toEqual([
            ['tide', 'used', null], ['still-air', 'used', null],
            ['long-breath', 'ready', null], ['hearth', 'used', null],
        ]);
        // Held but untouched: ready; empty and untouched: no chip.
        expect(describeOdysseyCharmRun(createSession(), { hearth: 3 }).charms).toEqual([
            expect.objectContaining({ id: 'hearth', state: 'ready', count: 3 }),
        ]);
    });

    it('syncs the tray with the bag and the pause, and ends Still Air from the gameplay tick, exactly on time', () => {
        const session = createSession();
        const { mode, hud } = createMode(session, { 'still-air': 1, tide: 1 });
        syncOdysseyCharmHud(mode, session);
        expect(hud.updateCharms).toHaveBeenLastCalledWith(expect.objectContaining({
            paused: false,
            charms: [expect.objectContaining({ id: 'tide' }), expect.objectContaining({ id: 'still-air' })],
        }));
        mode.isPaused = true;
        syncOdysseyCharmHud(mode, session);
        expect(hud.updateCharms).toHaveBeenLastCalledWith(expect.objectContaining({ paused: true }));
        mode.isPaused = false;
        // Nothing to tick: no HUD call.
        hud.updateCharms.mockClear();
        tickOdysseyCharms(mode, session);
        expect(hud.updateCharms).not.toHaveBeenCalled();
        session.gameState.dropInterval = 300;
        expect(activateOdysseyCharm(mode, 'still-air').ok).toBe(true);
        hud.updateCharms.mockClear();
        // Running: the pace holds, the tray is left to its own refresh.
        mode._elapsedLevelMs = () => 5000 + ODYSSEY_STILL_AIR_MS - 1;
        tickOdysseyCharms(mode, session);
        expect(session.gameState.dropInterval).toBe(1500);
        expect(hud.updateCharms).not.toHaveBeenCalled();
        // The moment it ends: the pace comes back and the tray is told once.
        mode._elapsedLevelMs = () => 5000 + ODYSSEY_STILL_AIR_MS;
        tickOdysseyCharms(mode, session);
        expect(session.gameState.dropInterval).toBe(300);
        expect(session.charms.stillAir).toBeNull();
        expect(hud.updateCharms).toHaveBeenCalledOnce();
        expect(hud.updateCharms.mock.calls[0][0].charms.find((chip) => chip.id === 'still-air').state).toBe('used');
        tickOdysseyCharms(mode, session);
        expect(hud.updateCharms).toHaveBeenCalledOnce();
        // A retired session is not ticked; a HUD without a tray is not called.
        const other = createSession();
        other.charms.stillAir = { until: 1, base: 1, slow: 1 };
        expect(() => tickOdysseyCharms(mode, other)).not.toThrow();
        expect(other.charms.stillAir).not.toBeNull();
        expect(() => syncOdysseyCharmHud({ odysseyHUD: null }, session)).not.toThrow();
        expect(() => tickOdysseyCharms(null, null)).not.toThrow();
    });
});
