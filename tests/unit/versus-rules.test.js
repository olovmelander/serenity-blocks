/**
 * The versus rules every multiplayer board plays by (src/core/multiplayer/versus-rules.js):
 * garbage never kills on arrival, only a blocked spawn does; cells lifted past the top are
 * lost; rows a garbage settle completes count as the player's own clear; at most twenty rows
 * wait; and the frag goes to the attacker whose recent attacks weigh most.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    COLS, HIDDEN_ROWS, PIECE_KEYS, ROWS,
} from '../../src/core/constants.js';
import {
    applyGarbage, fillBag, GameState, move, processAutoDrop, softDrop, spawnPiece,
} from '../../src/core/game.js';
import { GarbageQueue, maskArrayToBits, columnsToMask } from '../../src/core/garbage.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import {
    AttackCredit, CREDIT_MAX, VERSUS_GARBAGE_OPTIONS, VERSUS_MAX_PENDING_LINES,
    applyVersusFeel, createVersusGarbageQueue, forgetsSpentCredit, readVersusGameType,
    respawnVersusBoard, stepCrowdStamps, takeCrowdCut,
} from '../../src/core/multiplayer/versus-rules.js';

afterEach(() => vi.restoreAllMocks());

const BOTTOM = ROWS + HIDDEN_ROWS - 1;

const garbageRow = (attackId, holes = [5], extra = {}) => ({
    type: 'line',
    attackId,
    holeMask: maskArrayToBits(columnsToMask(holes)),
    isLastInBurst: true,
    ...extra,
});
const rows = (count, holes) => Array.from({ length: count }, (_, i) => garbageRow(`g${i}`, holes));

/** A solid block of `width` columns from `top` to the floor. */
const block = (id, x, width, top) => ({
    pieceId: id,
    shapeKey: 'I',
    color: '#ffffff',
    x,
    y: top,
    shape: Array.from({ length: BOTTOM - top + 1 }, () => Array(width).fill(1)),
});

function board(pieces) {
    const gameState = new GameState();
    gameState.lockedPieces = pieces;
    return gameState;
}

const filledInColumn = (gameState, x) => gameState.boardGrid.filter((row) => row[x]).length;

describe('garbage never tops a versus player out', () => {
    it('the old rule refused a burst that lifts the side of the stack past the top', () => {
        const gameState = board([block('side', 0, 1, HIDDEN_ROWS)]);
        expect(applyGarbage(gameState, rows(3)).topOut).toBe(true);
    });

    it('lifts the side of the stack into the hidden rows and the player plays on', () => {
        const gameState = board([block('side', 0, 1, HIDDEN_ROWS)]);

        const result = applyGarbage(gameState, rows(3), VERSUS_GARBAGE_OPTIONS);

        expect(result.topOut).toBe(false);
        expect(gameState.boardGrid[HIDDEN_ROWS - 3][0]).not.toBeNull();
        gameState.nextPieces = ['I'];
        expect(spawnPiece(gameState)).not.toBeNull();
        expect(gameState.isGameOver).toBe(false);
    });

    it('loses the cells lifted past the board\'s top row', () => {
        const gameState = board([block('side', 0, 1, HIDDEN_ROWS)]);

        const result = applyGarbage(gameState, rows(6), VERSUS_GARBAGE_OPTIONS);

        expect(result.overflowCells).toBe(2);
        expect(filledInColumn(gameState, 0)).toBe(ROWS + HIDDEN_ROWS); // the whole column, no more
    });

    it('ends the player only when the next piece cannot spawn', () => {
        const gameState = board([block('middle', 3, 4, HIDDEN_ROWS + 1)]);

        const result = applyGarbage(gameState, rows(2, [0]), VERSUS_GARBAGE_OPTIONS);
        expect(result.topOut).toBe(false);

        const onGameOver = vi.fn();
        gameState.nextPieces = ['I'];
        spawnPiece(gameState, null, onGameOver);
        expect(gameState.isGameOver).toBe(true);
        expect(onGameOver).toHaveBeenCalledTimes(1);
    });
});

describe('rows a garbage settle completes', () => {
    /** One loose cell over the column where the incoming row has its hole. */
    function looseCellOverHole() {
        const rest = {
            pieceId: 'rest', shapeKey: 'I', color: '#fff', x: 0, y: BOTTOM,
            shape: [Array.from({ length: COLS }, (_, x) => (x === 5 ? 0 : 1))],
        };
        const loose = { pieceId: 'loose', shapeKey: 'O', color: '#fff', x: 5, y: BOTTOM, shape: [[1]] };
        return board([rest, loose]);
    }

    it('count as the player\'s own clear under versus rules', () => {
        const gameState = looseCellOverHole();
        const { lines, score } = gameState;

        const result = applyGarbage(gameState, [garbageRow('g', [5])], VERSUS_GARBAGE_OPTIONS);

        expect(result.settleClearedRows).toEqual([BOTTOM]);
        expect(gameState.lines).toBe(lines + 1);
        expect(gameState.score).toBeGreaterThan(score);
        expect(result.settleSummary).toMatchObject({
            depth: 1, complexity: 1, sendForPerfectClear: false, source: 'garbage-settle',
        });
        expect(result.settleSummary.holeMask).toEqual([columnsToMask([5])]);
    });

    it('award nothing without the versus credit (Odyssey)', () => {
        const gameState = looseCellOverHole();

        const result = applyGarbage(gameState, [garbageRow('g', [5])]);

        expect(result.settleClearedRows).toEqual([BOTTOM]);
        expect(gameState.lines).toBe(0);
        expect(result.settleSummary).toBeNull();
    });
});

describe('waiting garbage', () => {
    it('holds at most twenty rows and ends a cut burst at its last row', () => {
        const queue = createVersusGarbageQueue();
        queue.enqueue(Array.from({ length: 15 }, (_, i) => garbageRow('first', [0], { isLastInBurst: i === 14 })));
        queue.enqueue(Array.from({ length: 10 }, (_, i) => garbageRow('second', [0], {
            isLastInBurst: i === 9, connectBelow: i < 9,
        })));

        expect(queue.getTotalLines()).toBe(VERSUS_MAX_PENDING_LINES);
        const last = queue.entries.at(-1);
        expect(last.attackId).toBe('second');
        expect(last.isLastInBurst).toBe(true);
        expect(last.connectBelow).toBe(false);
    });

    it('still queues effects that are not rows once full', () => {
        const queue = createVersusGarbageQueue();
        queue.enqueue(rows(25, [0]));
        queue.enqueue({ type: 'blind', attackId: 'b', duration: 3 });
        expect(queue.getTotalLines()).toBe(20);
        expect(queue.entries.at(-1).type).toBe('blind');
    });

    it('a plain queue has no limit', () => {
        const queue = new GarbageQueue();
        queue.enqueue(rows(25, [0]));
        expect(queue.getTotalLines()).toBe(25);
    });

    it('a local versus match caps every player; an Odyssey duel\'s state does not', () => {
        const versus = new MultiPlayerState(2, { maxPendingLines: VERSUS_MAX_PENDING_LINES });
        const duel = new MultiPlayerState(2);
        versus.garbageQueues[1].enqueue(rows(25, [0]));
        duel.garbageQueues[1].enqueue(rows(25, [0]));
        expect(versus.garbageQueues[1].getTotalLines()).toBe(20);
        expect(duel.garbageQueues[1].getTotalLines()).toBe(25);
    });
});

describe('crowd stamps', () => {
    it('are earned only past four living players, up to three per extra player', () => {
        expect(stepCrowdStamps(0, 4)).toBe(0);
        expect(stepCrowdStamps(0, 5)).toBe(1);
        expect(stepCrowdStamps(3, 5)).toBe(3);
        expect(stepCrowdStamps(5, 6)).toBe(6);
        expect(stepCrowdStamps(6, 5)).toBe(3);
    });

    it('cut one row per three stamps, except a clean move or boring rules', () => {
        expect(takeCrowdCut(4, 7)).toEqual({ lines: 2, stamps: 1 });
        expect(takeCrowdCut(1, 9)).toEqual({ lines: 0, stamps: 6 });
        expect(takeCrowdCut(4, 9, { clean: true })).toEqual({ lines: 4, stamps: 9 });
        expect(takeCrowdCut(4, 9, { boringRules: true })).toEqual({ lines: 4, stamps: 9 });
    });
});

describe('frag credit', () => {
    it('goes to the attacker whose attacks weigh most when one arrives', () => {
        const credit = new AttackCredit();
        credit.noteAttack('A', 4); // A: 8
        credit.noteAttack('B', 1); // B: 2 < 8
        expect(credit.killer).toBe('A');
        credit.noteAttack('B', 3); // B: 8 >= 8
        expect(credit.killer).toBe('B');
    });

    it('fades by one per placed piece; a round match keeps its last holder', () => {
        const credit = new AttackCredit();
        credit.noteAttack('A', 2); // 4
        for (let i = 0; i < 4; i += 1) credit.notePiecePlaced();
        expect(credit.killer).toBe('A');
        credit.noteAttack('B', 1); // B: 2 >= A's spent 0
        expect(credit.killer).toBe('B');
    });

    it('a respawning match forgets a holder whose credit ran out', () => {
        const credit = new AttackCredit();
        credit.noteAttack('A', 1);
        credit.notePiecePlaced({ forgetSpent: true });
        expect(credit.killer).toBe('A');
        credit.notePiecePlaced({ forgetSpent: true });
        expect(credit.killer).toBeNull();
    });

    it('caps one attacker\'s weight', () => {
        const credit = new AttackCredit();
        credit.noteAttack('A', 500);
        expect(credit.weights.get('A')).toBe(CREDIT_MAX);
    });

    it('a local match credits the heavier attacker, not the latest', () => {
        const state = new MultiPlayerState(3);
        state.players.forEach((player) => { player.isAlive = true; });
        const clear = (depth) => ({
            depth, complexity: 1, manualColumns: [0],
            holeMask: Array.from({ length: depth }, () => columnsToMask([0])),
        });

        state.handleGarbageSummary(0, clear(5), null); // player 1 sends 4 rows to player 3
        state.handleGarbageSummary(1, clear(2), null); // player 2 sends 1 row to player 3

        expect(state.lastAttackerIds[2]).toBe(0);
        expect(state.attackCredit[2].weights.get(0)).toBe(8);
    });
});

describe('versus feel', () => {
    function restingO() {
        const gameState = new GameState();
        applyVersusFeel(gameState);
        gameState.nextPieces = ['O'];
        spawnPiece(gameState);
        gameState.currentPiece.y = BOTTOM - 1; // resting on the floor
        gameState.dropInterval = 1000;
        gameState.dropCounter = 0;
        return gameState;
    }

    it('draws every piece on its own instead of from a bag of seven', () => {
        const always = () => 0;
        const random = [];
        fillBag(random, always, 'random');
        expect(random).toEqual(Array(10).fill(PIECE_KEYS[0]));

        const bag = [];
        fillBag(bag, always);
        expect(new Set(bag.slice(0, 7)).size).toBe(7);
    });

    it('locks a resting piece at the next gravity step, not after a lock delay', () => {
        const gameState = restingO();

        processAutoDrop(gameState, 600, null, {});
        expect(gameState.currentPiece).not.toBeNull();

        move(gameState, -1); // sliding along the floor buys no time
        processAutoDrop(gameState, 400, null, {});
        expect(gameState.currentPiece).toBeNull();
    });

    it('a soft drop on a resting piece locks it at once', () => {
        const gameState = restingO();
        softDrop(gameState, null, {});
        expect(gameState.currentPiece).toBeNull();
    });

    it('every online board plays with it', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const game = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: false, players: new Map(), network: {}, matchConfig: {},
        });
        game.addPlayer('76561198000000001', 'One');
        const { gameState } = game.players.get('76561198000000001');
        expect(gameState.pieceRandomizer).toBe('random');
        expect(gameState.lockStyle).toBe('gravity');
    });
});

describe('free-for-all respawn', () => {
    it('is the default game type; survivor must be asked for', () => {
        expect(readVersusGameType(undefined)).toBe('ffa');
        expect(readVersusGameType({ gameType: 'nonsense' })).toBe('ffa');
        expect(readVersusGameType({ gameType: 'survivor' })).toBe('survivor');
        expect(forgetsSpentCredit({})).toBe(true);
        expect(forgetsSpentCredit({ gameType: 'survivor' })).toBe(false);
    });

    it('gives a dead player an empty well and keeps their totals and piece stream', () => {
        const gameState = board([block('stack', 0, 10, HIDDEN_ROWS + 2)]);
        applyVersusFeel(gameState);
        Object.assign(gameState, {
            score: 4321, lines: 37, piecesPlaced: 90, handicap: 4, garbageAttackSequence: 12,
            simFrame: 5000, level: 7, isGameOver: true, isAlive: false,
        });
        gameState.pieceCounts.T = 9;
        const rng = () => 0.5;
        gameState.randomGenerator = rng;
        gameState.nextPieces = ['S', 'Z'];

        respawnVersusBoard(gameState, { startLevel: 2, levelProgression: false });

        expect(gameState.lockedPieces).toEqual([]);
        expect(gameState.boardGrid.every((row) => row.every((cell) => cell === null))).toBe(true);
        expect(gameState).toMatchObject({
            score: 4321, lines: 37, piecesPlaced: 90, handicap: 4, garbageAttackSequence: 12,
            simFrame: 5000, level: 2, isGameOver: false, isAlive: true, lockStyle: 'gravity',
        });
        expect(gameState.pieceCounts.T).toBe(9);
        expect(gameState.randomGenerator).toBe(rng);
        expect(gameState.nextPieces.slice(0, 2)).toEqual(['S', 'Z']);
        expect(gameState.nextPieces.length).toBeGreaterThanOrEqual(10);
    });
});

describe('online host', () => {
    function host(gameState) {
        const player = {
            steamId: 'P1', name: 'P1', isAlive: true, gameState,
            garbageQueue: createVersusGarbageQueue(), lastAttackerId: null, crowdStamps: 0,
        };
        const game = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: true,
            localPlayerId: 'P1',
            players: new Map([['P1', player]]),
            _garbageDrainAll: true,
            fragTracker: { recordDeath: vi.fn() },
            attackRouter: { routeAttack: vi.fn() },
        });
        return { game, player };
    }

    it('lets garbage lift a tall side into the hidden rows without a death', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { game, player } = host(board([block('side', 0, 1, HIDDEN_ROWS)]));
        player.garbageQueue.enqueue(rows(3).map((entry) => ({ ...entry, attackerId: 'P2' })));

        game.insertPendingGarbage('P1');

        expect(player.isAlive).toBe(true);
        expect(player.gameState.isGameOver).toBe(false);
        expect(game.fragTracker.recordDeath).not.toHaveBeenCalled();
    });

    it('routes the attack of rows its own garbage settle completed', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const rest = {
            pieceId: 'rest', shapeKey: 'I', color: '#fff', x: 0, y: BOTTOM,
            shape: [Array.from({ length: COLS }, (_, x) => (x === 5 ? 0 : 1))],
        };
        const loose = { pieceId: 'loose', shapeKey: 'O', color: '#fff', x: 5, y: BOTTOM, shape: [[1]] };
        const { game, player } = host(board([rest, loose]));
        player.garbageQueue.enqueue([garbageRow('g', [5], { attackerId: 'P2' })]);

        game.insertPendingGarbage('P1');

        expect(game.attackRouter.routeAttack).toHaveBeenCalledWith('P1', expect.objectContaining({
            depth: 1, source: 'garbage-settle',
        }));
    });
});
