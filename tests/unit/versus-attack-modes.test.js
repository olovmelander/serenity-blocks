/**
 * The versus attack styles and the smallest attacking clear, local and online:
 * - minAttackLines: clears below it send no normal rows; a cleared board still attacks.
 * - Blind: each row hides one of the target's next placed pieces for 30 blind ticks (4.8 s);
 *   a cleared board adds a full blind. Hidden cells stay solid.
 * - Full blind: every attack hides the target's whole board for rows × combo × 12 blind
 *   ticks, added onto blind time already there, at most 255.
 * - Blind time belongs to each cell: it survives cascades and garbage lifts, and leaves with
 *   a cleared cell. Online, the host and the predicting peer hide the same cells.
 * - Hot potato: teams take it in turn; the holding team's rows count toward its target, and
 *   everyone else attacks only the holder.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { COLS } from '../../src/core/constants.js';
import {
    GameState, applyGarbage, canPlacePiece, lockPiece, spawnPiece,
} from '../../src/core/game.js';
import {
    ATTACK_TYPES, GarbageQueue, calculateGarbage, columnsToMask, maskArrayToBits, readMinAttackLines,
    versusAttackRules,
} from '../../src/core/garbage.js';
import {
    BLIND_MAX_TICKS, BLIND_PIECE_TICKS, BLIND_TICK_MS, advanceBlindClock, applyFullBlind,
    captureBlindSnapshot, takeSpawnBlinds,
} from '../../src/core/blind.js';
import { resolveCascade } from '../../src/core/cascade-resolver.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { FFAAttackRouter } from '../../src/core/multiplayer/ffa-attack-router.js';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { VERSUS_GARBAGE_OPTIONS, VERSUS_MAX_PENDING_LINES } from '../../src/core/multiplayer/versus-rules.js';
import {
    POTATO_FIRST_TARGET, POTATO_HANDOFF_MS, countHolderRows, createHotPotatoState, potatoRoute,
    stepHotPotato,
} from '../../src/core/multiplayer/hot-potato.js';
import { buildStateSnapshot } from '../../src/core/multiplayer/ffa/snapshot-codec.js';
import { getBinaryDecoder, getBinaryEncoder } from '../../src/core/network/binary-encoding.js';
import { hydrateBinarySnapshot } from '../../src/core/network/snapshot-contract.js';
import { MessageTypes } from '../../src/core/network/message-types.js';

afterEach(() => vi.restoreAllMocks());

const col0 = () => Array.from({ length: COLS }, (_, x) => x === 0);
/** The cascade summary of a clear of `depth` lines. */
const clear = (depth, { complexity = 1, clean = false } = {}) => ({
    depth,
    complexity,
    holeMask: Array.from({ length: depth }, col0),
    manualColumns: [0],
    sendForPerfectClear: clean,
});

const BLIND_STYLE = { attackStyle: 'blind', attackRules: { forceAttackType: ATTACK_TYPES.BLIND } };
const FULL_BLIND_STYLE = { attackStyle: 'full_blind', attackRules: { forceAttackType: ATTACK_TYPES.FULL_BLIND } };
const POTATO_STYLE = { attackStyle: 'hot_potato', hotPotato: true, attackRules: null };

function localMatch(players, config = {}) {
    const match = new MultiPlayerState(players, { maxPendingLines: VERSUS_MAX_PENDING_LINES });
    match.players.forEach((player) => { player.isAlive = true; });
    match.setMatchConfig(config);
    return match;
}

/**
 * One spawn and lock of an O piece at column `x`, as a versus board takes it: the blind
 * entries at the head of its queue first (the spawn callback), then the piece drops and locks.
 */
function placeO(gameState, queue, x) {
    if (queue) takeSpawnBlinds(gameState, queue);
    gameState.nextPieces = ['O', 'O', 'O'];
    spawnPiece(gameState);
    const piece = gameState.currentPiece;
    piece.x = x;
    while (canPlacePiece(gameState, piece, piece.x, piece.y + 1)) piece.y += 1;
    lockPiece(gameState, null, null);
    return gameState.lockedPieces.at(-1);
}

const garbageRow = (attackId, holes = [5]) => ({
    type: 'line', attackId, holeMask: maskArrayToBits(columnsToMask(holes)), isLastInBurst: true,
});

describe('the smallest attacking clear', () => {
    it('reads 2 to 5 and defaults to 2', () => {
        expect(readMinAttackLines(undefined)).toBe(2);
        expect(readMinAttackLines('4')).toBe(4);
        expect(readMinAttackLines(6)).toBe(2);
        expect(readMinAttackLines(1)).toBe(2);
        expect(versusAttackRules({ attackRules: { forceAttackType: 'blind' }, minAttackLines: 3 }))
            .toEqual({ forceAttackType: 'blind', minAttackLines: 3 });
    });

    it('a clear below it sends no normal rows; at it and above, lines − 1', () => {
        const rules = { minAttackLines: 3 };
        expect(calculateGarbage(clear(2), rules).getTotalLines()).toBe(0);
        expect(calculateGarbage(clear(3), rules).getTotalLines()).toBe(2);
        expect(calculateGarbage(clear(2)).getTotalLines()).toBe(1); // the default, 2
    });

    it('a cleared board still sends its clean rows', () => {
        const attack = calculateGarbage(clear(2, { clean: true }), { minAttackLines: 4 });
        expect(attack.holeMasks).toHaveLength(0);
        expect(attack.cleanMasks).toHaveLength(1); // (1 + 2) / 2
    });

    it('applies to a local match, in every attack style', () => {
        const rows = localMatch(2, { minAttackLines: 3 });
        rows.handleGarbageSummary(0, clear(2), null);
        expect(rows.garbageQueues[1].entries).toEqual([]);
        rows.handleGarbageSummary(0, clear(3), null);
        expect(rows.garbageQueues[1].getTotalLines()).toBe(2);

        const blind = localMatch(2, { ...BLIND_STYLE, minAttackLines: 4 });
        blind.handleGarbageSummary(0, clear(3), null);
        expect(blind.garbageQueues[1].entries).toEqual([]);
        blind.handleGarbageSummary(0, clear(4), null);
        expect(blind.garbageQueues[1].getBlindPieceCount()).toBe(3);
    });

    it('applies online, on the host\'s router', () => {
        const players = ['A', 'B'].map((steamId) => ({
            steamId, name: steamId, isAlive: true, garbageQueue: new GarbageQueue(), gameState: new GameState(),
        }));
        const router = new FFAAttackRouter({
            isHost: true,
            players: new Map(players.map((player) => [player.steamId, player])),
            matchConfig: { minAttackLines: 4, attackRules: null },
            network: { broadcastToAll: vi.fn() },
            applyGarbageCounter: () => 0,
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});

        router.routeAttack('A', clear(3));
        expect(players[1].garbageQueue.entries).toEqual([]);
        router.routeAttack('A', clear(4));
        expect(players[1].garbageQueue.getTotalLines()).toBe(3);
    });
});

describe('blind pieces', () => {
    it('an attack of N rows sends N blind pieces and no rows', () => {
        const match = localMatch(2, BLIND_STYLE);
        match.handleGarbageSummary(0, clear(3), null);
        const { entries } = match.garbageQueues[1];
        expect(entries.map((entry) => entry.type)).toEqual(['blind', 'blind']);
        expect(entries.every((entry) => entry.ticks === BLIND_PIECE_TICKS)).toBe(true);
        expect(match.garbageQueues[1].getTotalLines()).toBe(0);
        expect(match.attackCredit[1].weights.get(0)).toBe(4); // two rows of frag credit
    });

    it('hides each of the target\'s next N placed pieces; the piece after shows', () => {
        const match = localMatch(2, BLIND_STYLE);
        match.handleGarbageSummary(0, clear(3), null);
        const target = match.players[1];
        const queue = match.garbageQueues[1];

        const first = placeO(target, queue, 0);
        const second = placeO(target, queue, 2);
        const third = placeO(target, queue, 4);

        expect(first.blindTicks).toBe(BLIND_PIECE_TICKS);
        expect(second.blindTicks).toBe(BLIND_PIECE_TICKS);
        expect(third.blindTicks).toBeUndefined();
        expect(target.boardGrid[23][0].blind).toBe(BLIND_PIECE_TICKS);
        expect(target.boardGrid[23][4].blind).toBeUndefined();
        expect(queue.entries).toEqual([]);
    });

    it('is invisible for exactly 30 blind ticks (4.8 s) from the moment it is placed', () => {
        const gameState = new GameState();
        const queue = new GarbageQueue();
        queue.enqueue({ type: 'blind', ticks: BLIND_PIECE_TICKS });
        const piece = placeO(gameState, queue, 0);

        advanceBlindClock(gameState, BLIND_PIECE_TICKS * BLIND_TICK_MS - 1);
        expect(piece.blindTicks).toBe(1);
        expect(gameState.boardGrid[23][0].blind).toBe(1);
        advanceBlindClock(gameState, 1);
        expect(piece.blindTicks).toBeUndefined();
        expect(gameState.boardGrid[23][0].blind).toBeUndefined();
    });

    it('stays solid: pieces land on it and rows with hidden cells clear', () => {
        const gameState = new GameState();
        const queue = new GarbageQueue();
        queue.enqueue([{ type: 'blind', ticks: 30 }, { type: 'blind', ticks: 30 }]);
        placeO(gameState, queue, 0);
        const onTop = placeO(gameState, queue, 0);
        expect(onTop.y).toBe(20); // on the hidden O, not through it
        expect(onTop.blindTicks).toBe(30);

        [2, 4, 6, 8].forEach((x) => placeO(gameState, queue, x));
        const result = resolveCascade(gameState.lockedPieces, {});
        expect(result.linesClearedThisTurn).toBe(2); // the hidden cells fill their rows
        expect(result.lockedPiecesAfter.every((piece) => piece.blindTicks === 30)).toBe(true);
    });

    it('waits in the garbage queue: counts toward the 20 entries, never holds rows back', () => {
        const match = localMatch(2, BLIND_STYLE);
        for (let i = 0; i < 6; i += 1) match.handleGarbageSummary(0, clear(5), null); // 4 each
        expect(match.garbageQueues[1].getBlindPieceCount()).toBe(VERSUS_MAX_PENDING_LINES);

        const queue = new GarbageQueue();
        queue.enqueue([{ type: 'blind', ticks: 30 }, { type: 'blind', ticks: 30 }, garbageRow('rows')]);
        const gameState = new GameState();
        takeSpawnBlinds(gameState, queue);
        const rows = queue.dequeueLineBurst();
        expect(rows.map((entry) => entry.type)).toEqual(['line']); // goes in now
        expect(queue.entries.map((entry) => entry.type)).toEqual(['blind']); // waits for the next piece
        expect(gameState.blind.pieceTicks).toBe(30);
    });

    it('a cleared board adds a full blind of cleanRows × combo × 12', () => {
        const match = localMatch(2, BLIND_STYLE);
        match.handleGarbageSummary(0, clear(4, { complexity: 2, clean: true }), null);
        const { entries } = match.garbageQueues[1];
        expect(entries.filter((entry) => entry.type === 'blind')).toHaveLength(3);
        expect(entries.at(-1)).toMatchObject({ type: 'full_blind', ticks: 2 * 2 * 12 });
    });
});

describe('full blind', () => {
    it('hides every cell on the board for rows × combo × 12 blind ticks; later pieces show', () => {
        const match = localMatch(2, FULL_BLIND_STYLE);
        const target = match.players[1];
        const queue = match.garbageQueues[1];
        placeO(target, queue, 0);
        placeO(target, queue, 4);

        match.handleGarbageSummary(0, clear(3, { complexity: 2 }), null);
        expect(queue.entries).toEqual([expect.objectContaining({ type: 'full_blind', ticks: 2 * 2 * 12 })]);
        expect(queue.getTotalLines()).toBe(0);
        const later = placeO(target, queue, 8); // its spawn takes the full blind first

        expect(target.lockedPieces.slice(0, 2).map((piece) => piece.blindTicks)).toEqual([48, 48]);
        expect(later.blindTicks).toBeUndefined();
    });

    it('adds onto blind time a cell already has, at most 255 ticks', () => {
        const gameState = new GameState();
        const queue = new GarbageQueue();
        placeO(gameState, queue, 0);
        queue.enqueue([{ type: 'full_blind', ticks: 120 }]);
        takeSpawnBlinds(gameState, queue);
        advanceBlindClock(gameState, 10 * BLIND_TICK_MS);
        expect(gameState.lockedPieces[0].blindTicks).toBe(110);

        queue.enqueue([{ type: 'full_blind', ticks: 100 }]);
        takeSpawnBlinds(gameState, queue);
        expect(gameState.lockedPieces[0].blindTicks).toBe(210);
        queue.enqueue([{ type: 'full_blind', ticks: 100 }]);
        takeSpawnBlinds(gameState, queue);
        expect(gameState.lockedPieces[0].blindTicks).toBe(BLIND_MAX_TICKS);
    });
});

describe('blind time travels with its cells', () => {
    const piece = (pieceId, x, y, shape, extra = {}) => ({
        pieceId, shapeKey: 'T', color: '#fff', x, y, shape, ...extra,
    });

    it('a clear removes the hidden cells in its rows; what is left keeps its time and falls with it', () => {
        const floor = piece('g', 0, 23, [Array(8).fill(1)], { shapeKey: 'GARBAGE' });
        const riding = piece('h', 0, 21, [[1], [1]], { blindTicks: 50 }); // sits on the floor row
        const spanning = piece('k', 8, 22, [[1], [1]], { blindTicks: 40 }); // one cell in the row
        const placed = piece('p', 9, 22, [[1], [1]]);

        const result = resolveCascade([floor, riding, spanning, placed], {});

        expect(result.linesClearedThisTurn).toBe(1);
        const after = new Map(result.lockedPiecesAfter.map((p) => [p.pieceId, p]));
        expect(after.get('h')).toMatchObject({ y: 22, blindTicks: 50 }); // fell a row, still hidden
        expect(after.get('k')).toMatchObject({ y: 23, blindTicks: 40, shape: [[1]] });
        expect(after.get('p').blindTicks).toBeUndefined();
        const hidden = captureBlindSnapshot({ lockedPieces: result.lockedPiecesAfter }).cells;
        expect(hidden).toEqual([[22 * COLS, 50], [23 * COLS, 50], [23 * COLS + 8, 40]]);
    });

    it('garbage lifts hidden cells with their time', () => {
        const gameState = new GameState();
        gameState.lockedPieces = [piece('h', 0, 23, [[1]], { blindTicks: 20 })];

        applyGarbage(gameState, [garbageRow('g', [5])], VERSUS_GARBAGE_OPTIONS);

        expect(gameState.lockedPieces[0]).toMatchObject({ y: 22, blindTicks: 20 });
        expect(gameState.boardGrid[22][0].blind).toBe(20);
        expect(gameState.boardGrid[23][0].blind).toBeUndefined(); // the new row shows
    });
});

describe('hot potato rules', () => {
    const teams = (...keys) => keys.map((key) => ({ key, alive: true }));
    /** A seeded random in [0, 1). */
    function seeded(seed) {
        let value = seed >>> 0;
        return () => {
            value = (value * 1664525 + 1013904223) >>> 0;
            return value / 2 ** 32;
        };
    }
    /** Take the potato: wait out the hand-off, then the next team holds it. */
    const take = (state, list, random) => stepHotPotato(state, POTATO_HANDOFF_MS, list, random);

    it('nobody holds it for the first two seconds; then a team does, with a target of 2', () => {
        const state = createHotPotatoState(true);
        const list = teams('a', 'b');
        expect(stepHotPotato(state, POTATO_HANDOFF_MS - 1, list)).toBeNull();
        expect(state.holder).toBeNull();
        const event = stepHotPotato(state, 1, list);
        expect(event).toMatchObject({ type: 'take', target: POTATO_FIRST_TARGET });
        expect(state.holder).toBe(event.team);
    });

    it('goes round a shuffled order, never to the same team twice in a row, and reshuffles', () => {
        const list = teams('a', 'b', 'c', 'd');
        for (const seed of [1, 2, 3, 99]) {
            const state = createHotPotatoState(true);
            const random = seeded(seed);
            const holders = [];
            for (let turn = 0; turn < 20; turn += 1) {
                take(state, list, random);
                holders.push(state.holder);
                countHolderRows(state, state.holder, 99);
            }
            holders.slice(1).forEach((holder, index) => expect(holder).not.toBe(holders[index]));
            expect(new Set(holders.slice(0, 4)).size).toBe(4); // every team once per shuffle
        }
    });

    it('a team\'s target grows by one each time it gets rid of it, back to 2 with nobody left', () => {
        const state = createHotPotatoState(true);
        const list = teams('a', 'b');
        const random = () => 0;
        const targets = [];
        for (let turn = 0; turn < 4; turn += 1) {
            take(state, list, random);
            targets.push([state.holder, state.target]);
            countHolderRows(state, state.holder, state.target);
        }
        expect(targets).toEqual([['b', 2], ['a', 2], ['b', 3], ['a', 3]]);

        take(state, list, random); // b holds it, target 4
        expect(state.target).toBe(4);
        const event = stepHotPotato(state, 16, [{ key: 'a', alive: true }, { key: 'b', alive: false }]);
        expect(event).toMatchObject({ type: 'pass', team: 'b', reason: 'eliminated' });
        expect(state.targets.b).toBe(POTATO_FIRST_TARGET);
        stepHotPotato(state, 16, [{ key: 'a', alive: false }, { key: 'b', alive: true }]);
        expect(state.targets.a).toBeUndefined(); // no players left: back to the first target
    });

    it('routes attacks: nothing while nobody holds it, the holder counts, everyone else hits the holder', () => {
        const state = createHotPotatoState(true);
        expect(potatoRoute(state, 'a')).toEqual({ route: 'none', holder: null });
        state.holder = 'a';
        state.target = 3;
        expect(potatoRoute(state, 'a')).toEqual({ route: 'count', holder: 'a' });
        expect(potatoRoute(state, 'b')).toEqual({ route: 'holder', holder: 'a' });

        expect(countHolderRows(state, 'b', 5)).toBeNull(); // not the holder
        expect(countHolderRows(state, 'a', 2)).toBeNull();
        expect(state.sent).toBe(2);
        expect(countHolderRows(state, 'a', 1)).toMatchObject({ type: 'pass', team: 'a', reason: 'target' });
        expect(state.holder).toBeNull();
    });
});

describe('hot potato in a local match', () => {
    function potatoMatch(players, config = {}) {
        const match = localMatch(players, { ...POTATO_STYLE, ...config });
        match.potatoRandom = () => 0;
        match.updateHotPotato(POTATO_HANDOFF_MS);
        return match;
    }

    it('the holding team\'s members add up their rows toward its target and deal nothing', () => {
        const match = potatoMatch(4, { isTeamMode: true, playerTeams: [0, 0, 1, 1] });
        const holders = match.getHotPotatoState().holderIndices;
        expect(holders).toHaveLength(2);
        const [first, second] = holders;

        match.handleGarbageSummary(first, clear(2), null); // one row
        expect(match.getHotPotatoState()).toMatchObject({ sent: 1, target: 2 });
        match.handleGarbageSummary(second, clear(2), null); // one more: target reached
        expect(match.getHotPotatoState().holderTeam).toBeNull();
        expect(match.garbageQueues.every((queue) => queue.isEmpty())).toBe(true);
        expect(match.getPlayerMetrics(second).potatoPasses).toBe(1);
        expect(match.hotPotato.targets[match.potatoTeamOf(first)]).toBe(3);
    });

    it('everyone else attacks only the holding team, never each other', () => {
        const match = potatoMatch(3);
        const [holder] = match.getHotPotatoState().holderIndices;
        const [other, third] = [0, 1, 2].filter((index) => index !== holder);

        match.handleGarbageSummary(other, clear(3), null);

        expect(match.garbageQueues[holder].getTotalLines()).toBe(2);
        expect(match.garbageQueues[third].isEmpty()).toBe(true);
        expect(match.lastAttackerIds[holder]).toBe(other);
    });

    it('while nobody holds it, attacks deal nothing', () => {
        const match = localMatch(3, POTATO_STYLE);
        match.handleGarbageSummary(0, clear(4), null);
        expect(match.garbageQueues.every((queue) => queue.isEmpty())).toBe(true);
    });

    it('a team that gets rid of it drops its waiting garbage and shows its hidden cells', () => {
        const match = potatoMatch(2);
        const [holder] = match.getHotPotatoState().holderIndices;
        const other = 1 - holder;
        match.handleGarbageSummary(other, clear(4), null); // three rows wait for the holder
        const board = match.players[holder];
        placeO(board, null, 0);
        applyFullBlind(board, 40);
        board.blind.pieceTicks = 30;
        const events = [];
        match.onPotatoEvent = (event) => events.push(event.type);

        match.handleGarbageSummary(holder, clear(3), null); // two rows: its target

        expect(match.garbageQueues[holder].isEmpty()).toBe(true);
        expect(board.lockedPieces[0].blindTicks).toBeUndefined();
        expect(board.blind.pieceTicks).toBe(0);
        expect(events).toEqual(['pass']);
    });

    it('passes on when nobody on the holding team is alive, and its next holder is another team', () => {
        const match = potatoMatch(3);
        const [holder] = match.getHotPotatoState().holderIndices;
        match.players[holder].isAlive = false;

        expect(match.updateHotPotato(16)).toMatchObject({ type: 'pass', reason: 'eliminated' });
        match.players[holder].isAlive = true; // a free-for-all respawn
        match.updateHotPotato(POTATO_HANDOFF_MS);
        expect(match.getHotPotatoState().holderIndices).not.toContain(holder);
    });

    it('starts fresh each round', () => {
        const match = potatoMatch(2);
        match.reset();
        match.players.forEach((player) => { player.isAlive = true; });
        expect(match.getHotPotatoState()).toMatchObject({ enabled: true, holderTeam: null });
        expect(match.hotPotato.waitMs).toBe(POTATO_HANDOFF_MS);
    });
});

describe('hot potato online (host)', () => {
    function hostRouter(ids) {
        const players = new Map(ids.map((steamId) => [steamId, {
            steamId, name: steamId, color: '#fff', isAlive: true, garbageQueue: new GarbageQueue(), gameState: new GameState(),
        }]));
        const network = { broadcastToAll: vi.fn() };
        const router = new FFAAttackRouter({
            isHost: true,
            players,
            network,
            matchConfig: { ...POTATO_STYLE },
            applyGarbageCounter: () => 0,
            roundGeneration: 4,
        });
        router.resetHotPotato(0);
        router.updateHotPotato(POTATO_HANDOFF_MS);
        return { router, players, network };
    }

    it('routes everyone else\'s attacks to the holder only, and tells peers the holder, target and rows', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { router, players, network } = hostRouter(['A', 'B', 'C']);
        const { holder } = router.gameState.hotPotatoState;
        const [other, third] = ['A', 'B', 'C'].filter((id) => id !== holder);

        router.routeAttack(other, clear(3));
        expect(players.get(holder).garbageQueue.getTotalLines()).toBe(2);
        expect(players.get(third).garbageQueue.isEmpty()).toBe(true);

        router.routeAttack(holder, clear(2)); // one row toward its target of two
        const update = network.broadcastToAll.mock.calls
            .filter(([type]) => type === MessageTypes.GAME_POTATO_UPDATE).at(-1)[1];
        expect(update).toMatchObject({ state: { holder, sent: 1, target: 2 }, roundGeneration: 4 });
        expect(players.get(other).garbageQueue.getTotalLines()).toBe(0);
    });

    it('a holder that sends its target passes it on, losing its waiting garbage', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { router, players, network } = hostRouter(['A', 'B']);
        const { holder } = router.gameState.hotPotatoState;
        const other = holder === 'A' ? 'B' : 'A';
        router.routeAttack(other, clear(3));
        expect(players.get(holder).garbageQueue.getTotalLines()).toBe(2);

        router.routeAttack(holder, clear(3));

        expect(players.get(holder).garbageQueue.isEmpty()).toBe(true);
        expect(players.get(other).garbageQueue.isEmpty()).toBe(true);
        expect(router.gameState.hotPotatoState).toMatchObject({ holder: null, lastHolder: holder });
        expect(router.gameState.hotPotatoState.targets[holder]).toBe(3);
        const last = network.broadcastToAll.mock.calls.at(-1);
        expect(last[1].event).toMatchObject({ type: 'pass', team: holder, reason: 'target' });
    });

    it('a peer takes the host\'s potato and shows its own hidden cells when it passes it on', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const handlers = new Map();
        const peer = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: false,
            localPlayerId: 'B',
            roundGeneration: 4,
            players: new Map(),
            network: {
                hostSteamId: 'HOST', on: (type, handler) => { handlers.set(type, handler); }, off() {},
            },
            matchConfig: { ...POTATO_STYLE },
        });
        peer.addPlayer('B', 'B', true);
        peer.setupNetworkHandlers();
        const board = peer.players.get('B').gameState;
        placeO(board, null, 0);
        applyFullBlind(board, 30);
        const update = handlers.get(MessageTypes.GAME_POTATO_UPDATE);

        update({ from: 'MALLORY', data: { state: { enabled: true, holder: 'B', sent: 0, target: 2 } } });
        expect(peer.hotPotatoState).toBeFalsy(); // only the host decides
        update({
            from: 'HOST',
            data: {
                state: { enabled: true, holder: null, sent: 0, target: 0, targets: { B: 3 }, lastHolder: 'B' },
                event: { type: 'pass', team: 'B', reason: 'target' },
                roundGeneration: 4,
            },
        });
        expect(peer.hotPotatoState).toMatchObject({ holder: null, lastHolder: 'B', targets: { B: 3 } });
        expect(board.lockedPieces[0].blindTicks).toBeUndefined();
    });
});

describe('blind online: the host and the predicting peer hide the same cells', () => {
    function onlineGame(isHost, localId) {
        const game = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: false,
            localPlayerId: localId,
            players: new Map(),
            network: { broadcastToAll: vi.fn(), sendP2PMessage: vi.fn() },
            matchConfig: { ...BLIND_STYLE, minAttackLines: 2, garbageCancellation: 'disabled' },
            roundGeneration: 0,
            gamePhase: 'playing',
            winner: null,
            hotPotatoState: null,
            _garbageDrainAll: true,
            _garbageIdempotentEnabled: true,
            _peerConsumedBursts: new Set(),
            renderAllPlayers: () => {},
        });
        game.addPlayer('A', 'A', localId === 'A');
        game.addPlayer('B', 'B', localId === 'B');
        game.isHost = isHost;
        if (isHost) game.attackRouter = new FFAAttackRouter(game);
        return game;
    }

    /** The host's snapshot of every board, through the binary wire, as the peer receives it. */
    function overTheWire(host) {
        const encoded = getBinaryEncoder().encodeSnapshot(buildStateSnapshot(host));
        return hydrateBinarySnapshot(getBinaryDecoder().decodeSnapshot(encoded));
    }

    function adopt(peer, state) {
        Object.assign(peer, {
            _localBoardHoldRoundGen: 0,
            _localBoardHoldEnabled: true,
            _localBoardHoldCount: 0,
            _LOCAL_BOARD_HOLD_MAX_FRAMES: 30,
            _LOCAL_BOARD_HOLD_MAX_PHYSICS_FRAMES: 90,
            _holdStatsEnabled: true,
            _lastLocalLockTime: 0,
            _RECENT_LOCK_MS: 250,
            inputSequence: 0,
            _peerLocalSimEnabled: true,
            _netDiagEnabled: false,
            _lockEventsEnabled: false,
        });
        FFAGameStateP2P.prototype._applySnapshotState.call(peer, state, { forceLocal: false, reconcileLocal: true });
    }

    it('blind pieces reach the peer through its queue and both copies of its board agree', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const host = onlineGame(true, 'A');
        const peer = onlineGame(false, 'B');

        host.attackRouter.routeAttack('A', clear(3)); // two blind pieces for B
        const hostQueue = host.players.get('B').garbageQueue;
        expect(hostQueue.entries.map((entry) => [entry.type, entry.ticks, entry.lineIndex]))
            .toEqual([['blind', 30, 0], ['blind', 30, 1]]);

        adopt(peer, overTheWire(host));
        const peerQueue = peer.players.get('B').garbageQueue;
        expect(peerQueue.entries.map((entry) => [entry.type, entry.ticks])).toEqual([['blind', 30], ['blind', 30]]);

        const hostBoard = host.players.get('B').gameState;
        const peerBoard = peer.players.get('B').gameState;
        // Both copies place the same pieces: the host at its spawn, the peer at its predicted one.
        [0, 2, 4].forEach((x, turn) => {
            peer._insertLocalGarbagePrediction('B');
            if (turn === 0) {
                // The host has not taken it yet and still lists both; adopting that adds nothing back.
                expect(hostQueue.entries).toHaveLength(2);
                adopt(peer, overTheWire(host));
                expect(peerQueue.entries).toHaveLength(1);
            }
            host.insertPendingGarbage('B');
            placeO(hostBoard, null, x);
            placeO(peerBoard, null, x);
            advanceBlindClock(hostBoard, 700);
            advanceBlindClock(peerBoard, 700);
            expect(captureBlindSnapshot(peerBoard)).toEqual(captureBlindSnapshot(hostBoard));
        });
        expect(hostBoard.lockedPieces.map((piece) => Boolean(piece.blindTicks))).toEqual([true, true, false]);
        expect(hostQueue.entries).toEqual([]);
        expect(peerQueue.entries).toEqual([]);
    });

    it('a full blind lands on both copies at the next spawn, and a watcher sees the same hidden cells', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const host = onlineGame(true, 'A');
        host.matchConfig = { ...FULL_BLIND_STYLE, garbageCancellation: 'disabled' };
        const peer = onlineGame(false, 'B');
        const hostBoard = host.players.get('B').gameState;
        const peerBoard = peer.players.get('B').gameState;
        [0, 4].forEach((x) => { placeO(hostBoard, null, x); placeO(peerBoard, null, x); });

        host.attackRouter.routeAttack('A', clear(4, { complexity: 2 })); // 3 rows × 2 × 12
        adopt(peer, overTheWire(host));
        host.insertPendingGarbage('B');
        peer._insertLocalGarbagePrediction('B');

        expect(hostBoard.lockedPieces.map((piece) => piece.blindTicks)).toEqual([72, 72]);
        expect(captureBlindSnapshot(peerBoard)).toEqual(captureBlindSnapshot(hostBoard));

        // A's peer watches B: B's board comes over the wire with its hidden cells.
        const watched = overTheWire(host).players.find((player) => player.steamId === 'B');
        expect(watched.blind.cells).toEqual(captureBlindSnapshot(hostBoard).cells);
        const watcher = onlineGame(false, 'A');
        adopt(watcher, overTheWire(host));
        const seen = watcher.players.get('B').gameState;
        expect(captureBlindSnapshot(seen).cells).toEqual(captureBlindSnapshot(hostBoard).cells);
        expect(seen.boardGrid[23][0].blind).toBe(72);
    });
});
