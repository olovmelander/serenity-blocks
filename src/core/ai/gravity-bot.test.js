import {
    describe, expect, it, vi,
} from 'vitest';
import { COLS, HIDDEN_ROWS } from '../constants.js';
import { rebuildBoardGridFromPieces } from '../board.js';
import { resolveCascade } from '../cascade-resolver.js';
import { calculateGarbage } from '../garbage.js';
import { FIXED_TICK_HZ } from '../fixed-tick-clock.js';
import { INPUT_DISPOSITIONS } from '../simulation-tick.js';
import { OdysseyBotMatch } from '../odyssey/OdysseyBotMatch.js';
import { getLevelById } from '../odyssey/data/levels.js';
import { restoreBoardState } from '../game.js';
import { findConnectedComponents } from '../cascade-helpers.js';
import { settleLabelledBoard } from '../stillfall/stillfall-cascade.js';
import { seededRandom } from '../../utils/helpers.js';
import { GravityBotController, gravityPlanningRate } from './gravity-bot-controller.js';
import { LocalBotManager, localBotRoundSeed } from './local-bot-manager.js';
import { findReachablePlacements } from './reachability-pathfinder.js';
import {
    gravityBoardKey, gravityReward, reachableTrigger, readGravityBoard,
} from './gravity-search.js';
import { deal, replay, spawn } from '../../../reports/bot-ai-audit-2026-11/solo.mjs';
import { recordedSeat } from '../../../reports/gravity-bot-rebuild/recorded-seat.mjs';

function controller(state, rows = () => 0) {
    return new GravityBotController({
        playerState: state, difficulty: 10, actions: {}, rng: seededRandom(71), pendingRows: rows,
    });
}

function restorePieces(state, lockedPieces, targetGrid) {
    const grid = rebuildBoardGridFromPieces(lockedPieces, targetGrid);
    restoreBoardState(state, { grid, lockedPieces }, { adoptBoard: true });
}

describe('live gravity policy', () => {
    it('applies at least 150 expert hard drops in one minute of local play', () => {
        const seat = recordedSeat(10, 21420200);
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        let drops = 0;
        try {
            for (let tick = 0; tick < 60 * FIXED_TICK_HZ; tick++) {
                const { input } = seat.step();
                for (const { command, disposition } of input) {
                    if (command.action === 'hardDrop' && disposition === INPUT_DISPOSITIONS.APPLIED) drops++;
                }
            }
            expect(seat.state.isGameOver).toBe(false);
            expect(drops).toBeGreaterThanOrEqual(150);
        } finally {
            debug.mockRestore();
            seat.close();
        }
    });

    it('uses the authored pace when the same game runs an Odyssey rival', () => {
        const levelConfig = getLevelById(56);
        const duel = new OdysseyBotMatch({ gameState: deal(1006), levelConfig }, { seed: 1006 });
        try {
            expect(duel.bot.config).toMatchObject(levelConfig.mechanics.versus.botOverrides);
        } finally {
            duel.stop();
            duel.players.forEach((state) => state.reset());
        }
    });

    it('keeps each local seat’s pace across round resets, including series seed zero', () => {
        const players = [deal(0), deal(0), deal(0)];
        const match = { numPlayers: players.length, sharedPieceSeed: 0, players };
        const manager = new LocalBotManager({ multiplayerState: match, actionFactory: () => ({}) });
        const slots = [4, 4, 10].map((difficulty) => ({ kind: 'bot', difficulty }));
        const styles = () => [...manager.controllers.values()].map((bot) => [bot.config.tier, bot.localPace?.scale]);
        manager.configure(slots, 0);
        const opening = styles();
        expect(opening[0][1]).toBeGreaterThan(0);
        expect(opening[0][1]).not.toBe(opening[1][1]);
        expect(opening[2]).toEqual([10, undefined]);
        match.sharedPieceSeed = localBotRoundSeed(0, 2);
        manager.configure(slots, 0);
        expect(styles()).toEqual(opening);
        manager.configure(slots, match.sharedPieceSeed);
        expect(styles()[0][1]).not.toBe(opening[0][1]);
        players[1].isInfinityMode = true;
        players[2].isInfinityMode = true;
        manager.configure(slots, 0);
        expect(styles()[1]).toEqual([4, undefined]);
        expect(manager.controllers.get(2).config).toMatchObject({ maxApm: 1050, reactionMs: [170, 250] });
        manager.destroy();
        players.forEach((state) => state.reset());
    });

    it('budgets only the seats occupying the local match', () => {
        const player = deal(1006);
        const manager = new LocalBotManager({
            multiplayerState: { numPlayers: 2, sharedPieceSeed: 1006, players: [null, player] },
            actionFactory: () => ({}),
        });
        const expert = { kind: 'bot', difficulty: 10 };
        manager.configure([{ kind: 'human' }, expert, expert, expert]);
        expect([...manager.controllers.keys()]).toEqual([1]);
        expect(manager.controllers.get(1).planUnitsPerMs).toBe(gravityPlanningRate(1));
        manager.destroy();
        player.reset();
    });

    it('lets a deliberate local seat line up, then wait once before dropping', () => {
        const state = deal(1006);
        const inputs = [];
        const bot = new GravityBotController({
            playerState: state,
            difficulty: 4,
            localPace: { nominalTier: 2, apm: 120, scale: 2 },
            rng: () => 0.5,
            actions: {
                moveRight: () => { inputs.push('move'); return true; },
                hardDrop: () => { inputs.push('drop'); return true; },
            },
        });
        const ordinary = new GravityBotController({ playerState: state, difficulty: 4, actions: {} });
        const novice = new GravityBotController({
            playerState: state, difficulty: 2, actions: {}, rng: () => 0.5,
        });
        bot.setSpawnTiming(50);
        novice.setSpawnTiming(50);
        expect(bot.searchConfig).toEqual(ordinary.searchConfig);
        expect(bot.readyAtMs).toBe(novice.readyAtMs);
        expect(bot.config.actionIntervalMs).toBe(ordinary.config.actionIntervalMs);
        bot.scheduler.canLock = () => true;
        bot.lastPlan = { actions: [{ type: 'move', dir: 1 }, { type: 'hardDrop' }] };
        bot.scheduler.setActions(bot.lastPlan.actions);
        bot.advanceInput(1, bot.readyAtMs);
        expect(inputs).toEqual(['move']);
        const movementCooldown = bot.scheduler.cooldownMs;
        bot.advanceInput(0, bot.readyAtMs);
        const dropCooldown = bot.scheduler.cooldownMs;
        expect(dropCooldown).toBeGreaterThan(movementCooldown);
        expect(dropCooldown - movementCooldown).toBeLessThanOrEqual(1800);
        bot.advanceInput(0, bot.readyAtMs);
        expect(bot.scheduler.cooldownMs).toBe(dropCooldown);
        bot.advanceInput(dropCooldown + 1, bot.readyAtMs + dropCooldown + 1);
        expect(inputs).toEqual(['move', 'drop']);
        state.reset();
    });

    it('respects every cell a vertical trigger adds to the sparsest column', () => {
        const state = deal(1001);
        const weights = { triggerWaves: 1, triggerLines: 10, unseen: 0 };
        const rows = state.boardGrid.slice(-4).reverse();
        for (const [index, row] of rows.entries()) {
            for (let x = 0; x < COLS - 1; x++) row[x] = { id: x + 1, type: 'I' };
            const strength = reachableTrigger(readGravityBoard(state.boardGrid), ['I'], weights, false);
            expect(strength).toBe(1 + 10 * (index + 1));
        }
        state.reset();
    });

    it('replays the predicted waves, gross attack and per-wave score through the controls', async () => {
        const state = deal(1003);
        const bot = controller(state);
        const actual = [];
        for (let i = 0; i < 16; i++) {
            const before = state.score;
            const plan = bot.plan();
            const waves = [];
            let sent = 0;
            // Each observed spawn depends on the previous live lock and its physics.
            // eslint-disable-next-line no-await-in-loop
            await replay(state, plan.actions, {
                spawnPiece: () => spawn(state),
                onLineClear: (n) => waves.push(n),
                onGarbageReady: (s) => { sent += calculateGarbage(s).getTotalLines(); },
            });
            expect(plan.candidate.waves).toEqual(waves);
            expect(plan.candidate.projectedAttack).toBe(sent);
            expect(plan.candidate.score).toBe(state.score - before - 50);
            actual.push(waves.length);
        }
        expect(Math.max(...actual)).toBeGreaterThanOrEqual(2);
        state.reset();
    });

    it('has identical decisions under a permutation of the hidden bag tail', () => {
        const a = deal(1011);
        const b = deal(1011);
        b.nextPieces.splice(3, Infinity, ...b.nextPieces.slice(3).reverse());
        const first = controller(a).plan();
        const second = controller(b).plan();
        expect(first.actions).toEqual(second.actions);
        expect(first.candidate.futurePlan).toEqual(second.candidate.futurePlan);
        expect(controller(a).nextShapeKeys({ nextPieces: ['I', null, 'T', 'O'] })).toEqual(['I', 'T']);
        a.reset(); b.reset();
    });

    it('selects the same public route when its search is sliced across ticks', () => {
        const a = deal(1013);
        const b = deal(1013);
        const whole = controller(a).plan();
        const sliced = controller(b);
        for (let tick = 1; tick <= 90 && !sliced.lastPlan; tick++) sliced.update(1000 / 60, tick * (1000 / 60));
        expect(sliced.lastPlan.actions).toEqual(whole.actions);
        expect(sliced.lastPlan.candidate.futurePlan).toEqual(whole.candidate.futurePlan);
        a.reset();
        b.reset();
    });

    it('prepares a shared search only through the following tick and discards a stale observation', () => {
        const players = [deal(1006), deal(1006)];
        players.forEach((state) => { state.useFixedCascade = true; });
        let pending = 0;
        const match = {
            players,
            numPlayers: 2,
            sharedPieceSeed: 1006,
            playerPaused: [],
            getGarbageQueue: () => ({ getTotalLines: () => pending }),
            attackOutlook: (index) => ({ route: 'attack', targets: [1 - index] }),
            sendsRows: () => true,
        };
        const manager = new LocalBotManager({ multiplayerState: match, actionFactory: () => ({}) });
        manager.configure([0, 1].map(() => ({ kind: 'bot', difficulty: 10 })));
        const bots = [...manager.controllers.values()];
        const tickMs = 1000 / 60;
        const tick = (index, time) => manager.advanceFixedInput(index, { tick: time, tickMs, emit: () => true });
        tick(0, 1);
        tick(1, 1);
        const search = bots[0].activeSearch;
        expect(search).toBeTruthy();
        expect(bots[1].activeSearch).toBe(search);
        const cursors = bots.map((bot) => bot.nextSearchUnit);
        expect(manager.precomputeFixedSearch(1000, tickMs)).toBeGreaterThan(0);
        expect(manager.precomputeFixedSearch(1000, tickMs)).toBe(0);
        expect(search.units).toBeLessThanOrEqual(cursors[0] + Math.ceil(bots[0].sliceRate * tickMs));
        expect(bots.map((bot) => bot.nextSearchUnit)).toEqual(cursors);
        expect(bots.every((bot) => !bot.lastPlan)).toBe(true);
        pending = 6;
        tick(0, 2);
        expect(bots[0].activeSearch).not.toBe(search);
        bots[0].reset();
        match.playerPaused[1] = true;
        expect(manager.precomputeFixedSearch(1000, tickMs)).toBe(0);
        manager.destroy();
        players.forEach((state) => state.reset());
    });

    it.each([1, 2, 3, 5, 6, 10])('preserves tier %i judgment draws with synchronous and sliced input', (tier) => {
        const states = [deal(1011), deal(1011)];
        const decisions = states.map((state, index) => {
            const bot = new GravityBotController({
                playerState: state,
                difficulty: tier,
                actions: {},
                rng: seededRandom(71),
                planUnitsPerMs: index ? gravityPlanningRate() : 0,
            });
            const tick = 1000 / 60;
            for (let n = 1; n <= 120 && !bot.lastPlan; n++) bot.update(tick, n * tick);
            expect(bot.lastPlan).toBeTruthy();
            return [bot.lastPlan.actions, bot.lastPlan.candidate.futurePlan, bot.readyAtMs];
        });
        states.forEach((state) => state.reset());
        expect(decisions[0]).toEqual(decisions[1]);
    });

    it('keeps playing through blind attacks: hidden cells are solid, and it plans on them', () => {
        const state = deal(1006);
        const bot = controller(state);
        bot.update(1, 1);
        const seen = bot.plan()?.actions;
        state.reset();
        const blinded = deal(1006);
        const blindedBot = controller(blinded);
        blindedBot.update(1, 1);
        blinded.lockedPieces.forEach((piece) => { piece.blindTicks = 40; });
        blinded.boardGrid.forEach((row) => row.forEach((cell) => { if (cell) cell.blind = 40; }));
        blinded.blind.pieceTicks = 30;

        expect(blindedBot.plan()?.actions).toEqual(seen);
        blinded.reset();
    });

    it('only reads visible opponent height for an applicable local duel attack', () => {
        const players = [deal(1), deal(1)];
        const match = { numPlayers: 2, players, matchConfig: {} };
        const manager = new LocalBotManager({ multiplayerState: match, actionFactory: () => ({}) });
        manager.configure([{ kind: 'bot', difficulty: 10 }, { kind: 'human' }]);
        const observed = manager.controllers.get(0).finishingRoom;
        players[1].boardGrid[HIDDEN_ROWS + 1][0] = { id: 1 };
        expect(observed()).toBe(1);
        match.matchConfig.attackRules = { forceAttackType: 'blind' }; // no rows to finish with
        expect(observed()).toBe(Infinity);
        match.matchConfig.attackRules = null;
        players[1].handicap++;
        expect(observed()).toBe(Infinity);
        players[1].handicap--;
        match.matchConfig.attackRules = { disableAttacks: true };
        expect(observed()).toBe(Infinity);
        manager.configure([{ kind: 'bot', difficulty: 10 }, { kind: 'human' }]);
        expect(manager.controllers.get(0).versus).toBe(false);
        manager.destroy();
        players.forEach((state) => state.reset());
    });

    it('invalidates a proved route as soon as a real incoming burst changes', () => {
        const state = deal(1001);
        let pending = 0;
        const bot = controller(state, () => pending);
        bot.update(1, 1);
        bot.proof = [{ before: 'old', move: { shapeKey: 'I' } }];
        pending = 6;
        bot.update(1, 2);
        expect(bot.proof).toEqual([]);
        expect(bot.getPendingGarbage()).toBe(6);
        state.reset();
    });

    it('pays a proved fire before the incoming rows enter at the next spawn', async () => {
        const state = deal(1011);
        let incoming = 0;
        const bot = new GravityBotController({
            playerState: state,
            actions: {},
            difficulty: 10,
            rng: seededRandom((1011 ^ 0x85ebca6b) >>> 0),
            pendingRows: () => incoming,
        });
        for (let i = 0; i < 12; i++) {
            // eslint-disable-next-line no-await-in-loop
            await replay(state, bot.plan().actions, { spawnPiece: () => spawn(state) });
        }
        expect(bot.proof[0].move.waves).toEqual([1, 1, 1, 1]);
        incoming = 6;
        const shot = bot.plan();
        expect(shot.tactics.fireBeforeGarbage).toBe(true);
        const actual = [];
        await replay(state, shot.actions, { spawnPiece: () => spawn(state), onLineClear: (n) => actual.push(n) });
        expect(actual).toEqual([1, 1, 1, 1]);
        expect(bot.proof).toEqual([]);
        state.reset();
    });

    it('revalidates a restored grid even if its version number is reused', () => {
        const state = deal(1006);
        state.useFixedCascade = true;
        state.boardVersion = 7;
        const bot = controller(state);
        const tick = 1000 / 60;
        for (let i = 1; i <= 60 && !bot.lastPlan; i++) bot.update(tick, i * tick);
        expect(bot.refreshRoute(bot.lastPlan)).toBe(true);
        restorePieces(state, [{
            x: 2, y: state.boardGrid.length - 1, shape: [[1]], shapeKey: 'T', pieceId: 7,
        }]);
        expect(state.boardVersion).toBe(7);
        expect(bot.refreshRoute(bot.lastPlan)).toBe(false);
        state.reset();
    });

    it('keeps garbage and body connectivity in the key and the compact gravity resolver', () => {
        const state = deal(42);
        const grid = state.boardGrid;
        const last = grid.length - 1;
        for (let x = 0; x < COLS; x++) grid[last][x] = { id: 'row', type: 'GARBAGE' };
        grid[last - 2][0] = { id: 'left', type: 'T' };
        grid[last - 2][1] = { id: 'left', type: 'T' };
        const before = readGravityBoard(grid);
        const key = gravityBoardKey(before.cells);
        grid[last - 2][1] = { id: 'other', type: 'T' };
        expect(gravityBoardKey(readGravityBoard(grid).cells)).not.toBe(key);
        const board = readGravityBoard(grid);
        const ref = resolveCascade(findConnectedComponents(grid), { disableLevelProgression: true });
        const allRows = board.cells.slice();
        const waves = settleLabelledBoard(board.cells, HIDDEN_ROWS, board.top);
        expect(waves).toEqual(settleLabelledBoard(allRows, HIDDEN_ROWS));
        expect(board.cells).toEqual(allRows);
        expect(waves).toEqual(ref.waves.map((w) => w.fullLines.length));
        expect(gravityBoardKey(board.cells)).toBe(gravityBoardKey(readGravityBoard(ref.boardAfter).cells));
        expect(gravityReward([1, 2, 1], false, { level: 1, disableLevelProgression: true }).attack).toBe(3);
        state.reset();
    });

    it('shares a bounded aggregate amount of planning among local slots', () => {
        expect(gravityPlanningRate(2, 9)).toBe(gravityPlanningRate(2, 10));
        expect(gravityPlanningRate(2, 9)).toBeGreaterThan(gravityPlanningRate(2, 7));
        expect(gravityPlanningRate(3, 9)).toBe(gravityPlanningRate(3, 7));
        expect(gravityPlanningRate(4) * 4).toBeLessThanOrEqual(gravityPlanningRate(1));
        expect(gravityPlanningRate(3) * 3).toBeCloseTo(gravityPlanningRate(4) * 4);
    });

    it.each([[true, 2.5], [false, 2.5], [true, 0.5]])(
        'matches level, perfect-clear and combo rewards with level progression disabled %s and multiplier %s',
        (disableLevelProgression, comboMultiplier) => {
            const state = deal(42);
            const grid = state.boardGrid;
            const floor = grid.length - 1;
            for (let x = 0; x < COLS; x++) {
                grid[floor][x] = { id: x + 1, type: 'I' };
                grid[floor - 2 - (x % 2)][x] = { id: x + 11, type: 'O' };
            }
            const context = {
                level: 4,
                linesUntilNextLevel: 1,
                comboMultiplierEnabled: true,
                disableLevelProgression,
                comboMultiplier,
            };
            const actual = resolveCascade(findConnectedComponents(grid), context);
            const waves = actual.waves.map((wave) => wave.fullLines.length);
            expect(waves).toEqual([1, 1]);
            expect(actual.perfectClear).toBeTruthy();
            const reward = gravityReward(waves, true, context);
            expect(reward.score).toBe(actual.scoreDelta);
            expect(reward.attack).toBe(calculateGarbage(actual.garbageSummary).getTotalLines());
            expect(reward.levelAfter).toBe(actual.levelAfter);
            expect(reward.remainingAfter).toBe(actual.linesUntilNextLevelAfter);
            state.reset();
        },
    );

    it('copies identical search work between seats without advancing either decision tick', () => {
        const cache = new Map();
        const states = Array.from({ length: 4 }, () => deal(1006));
        const make = (state, shared) => new GravityBotController({
            playerState: state,
            difficulty: 10,
            actions: {},
            rng: seededRandom(71),
            sharedSearch: shared,
            planUnitsPerMs: gravityPlanningRate(3),
        });
        const original = make(states[0], cache).planSteps();
        original.next();
        // The first seat leaves after its first batch. A second identical seat can
        // finish its job from the captured pieces and original scoring context.
        states[0].level = 12;
        states[0].nextPieces.splice(0, 3, 'O', 'O', 'O');
        original.return();
        const second = make(states[1], cache).planSteps();
        const separate = make(states[2], null).planSteps();
        let expected;
        do {
            expected = separate.next();
            expect(second.next()).toEqual(expected);
        } while (!expected.done);
        expect(cache.size).toBe(1);
        const hit = make(states[1], cache).planSteps();
        const uncached = make(states[2], null).planSteps();
        do {
            expected = uncached.next();
            expect(hit.next()).toEqual(expected);
        } while (!expected.done);
        states[3].level = 3;
        make(states[3], cache).plan();
        expect(cache.size).toBe(2);
        const bottom = states[3].boardGrid.at(-1);
        bottom[0] = { id: 7, type: 'I' };
        bottom[1] = { id: 7, type: 'I' };
        make(states[3], cache).plan();
        bottom[1] = { id: 8, type: 'I' };
        make(states[3], cache).plan();
        expect(cache.size).toBe(4);
        states.forEach((state) => state.reset());
    });

    it('has a legal escape before the reaction deadline on a clean, high stack', async () => {
        const state = deal(1006);
        const top = HIDDEN_ROWS + 2;
        restorePieces(state, [{
            x: 1,
            y: top,
            shapeKey: 'I',
            pieceId: 'left',
            shape: Array.from({ length: state.boardGrid.length - top }, () => [1]),
        }]);
        const immediate = new GravityBotController({
            playerState: state, difficulty: 10, actions: {}, rng: seededRandom(71), planUnitsPerMs: 0,
        }).plan();
        const bot = controller(state);
        const tick = 1000 / 60;
        let elapsed = 0;
        while (!bot.lastPlan && elapsed < 400) {
            elapsed += tick;
            bot.update(tick, elapsed);
        }
        expect(elapsed).toBeLessThanOrEqual(bot.readyAtMs + tick);
        expect(bot.lastPlan.tactics.protectSpawn).toBe(true);
        const plan = bot.lastPlan;
        expect(plan.actions).toEqual(immediate.actions);
        expect(immediate.tactics.protectSpawn).toBe(true);
        const waves = [];
        await replay(state, plan.actions, { spawnPiece: () => spawn(state), onLineClear: (n) => waves.push(n) });
        expect(waves).toEqual(plan.candidate.waves);
        expect(state.isGameOver).toBe(false);
        state.reset();
    });

    it('preserves reachable poses and input paths on an expanded Infinity well', () => {
        const state = deal(1006);
        state.isInfinityMode = true;
        const grid = Array.from({ length: 112 }, () => Array(COLS).fill(null));
        restorePieces(state, [{
            x: 2, y: 104, shapeKey: 'I', pieceId: 7, shape: Array.from({ length: 8 }, () => [1]),
        }], grid);
        state.currentPiece.y = 89;
        const poses = (list) => list.map(({
            x, y, rotation, actions,
        }) => [x, y, rotation, actions]);
        expect(poses(controller(state).reachablePlacements(state))).toEqual(poses(findReachablePlacements(state)));
        state.reset();
    });
});
