/* eslint-disable no-await-in-loop -- Each lock needs settled physics; replay paired games sequentially. */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { findConnectedComponents } from '../../src/core/cascade-helpers.js';
import { restoreBoardState } from '../../src/core/game.js';
import { GarbageQueue, calculateGarbage } from '../../src/core/garbage.js';
import { deal, replay, spawn } from '../bot-ai-audit-2026-11/solo.mjs';
import { prepareVersusBoard, rowsEndPlayer, takeGarbage, versusRules } from './shipped-versus.mjs';
import { GravityBotController } from '../../src/core/ai/gravity-bot-controller.js';

export const receivingFloor = ['....KKKK..', '.BCDEFGHIJ', '.BCDEFGHIJ'];
export const shaft = ['....AAAA..', ...Array(4).fill('.BCDEFGHIJ')];
const queue = ['I', 'I', 'J', 'L'];
const nearRelease = { rows: ['A.........', 'MMMMKKKK..', ...receivingFloor.slice(1)], pieces: ['J', 'I', 'I', 'L'] };

export const examples = {
    build: { rows: receivingFloor, pieces: queue, locks: 3 },
    alternatePreview: { rows: receivingFloor, pieces: ['I', 'I', 'J', 'J'], locks: 3 },
    mirror: {
        rows: receivingFloor, pieces: ['I', 'I', 'L', 'J'], locks: 3, mirror: true,
    },
    recover: {
        rows: receivingFloor, pieces: queue, locks: 2, pending: 18,
    },
    finish: {
        rows: receivingFloor, pieces: queue, locks: 1, ceilingOpponent: true,
    },
    fourDeep: { rows: shaft, pieces: ['I', 'I', 'O', 'L'], locks: 3 },
    parkedSquare: {
        rows: ['....KKKK..', '..CDEFGHIJ', '..CDEFGHIJ'], pieces: ['I', 'O', 'J', 'L'], locks: 3,
    },
    parkedElbow: {
        rows: ['....KKKK..', '..CDEFGHIJ', 'A.CDEFGHIJ', 'A.CDEFGHIJ'], pieces: ['I', 'L', 'O', 'L'], locks: 3,
    },
    extend: { ...nearRelease, locks: 3 },
    triggerUnderPressure: { ...nearRelease, locks: 1, pending: 17 },
};

export function position(rows, pieces, mirror = false, rules = versusRules()) {
    const state = deal(7481, (board) => prepareVersusBoard(board, rules));
    rows.forEach((source, i) => {
        const row = [...source];
        if (mirror) row.reverse();
        state.boardGrid[state.boardGrid.length - rows.length + i] = row.map((id) => (
            id === '.' ? null : { id, type: 'I', color: 'I' }
        ));
    });
    const board = { grid: state.boardGrid, lockedPieces: findConnectedComponents(state.boardGrid) };
    restoreBoardState(state, board, { adoptBoard: true });
    state.nextPieces = [...pieces, ...state.nextPieces];
    spawn(state);
    return state;
}

export function boardRows(state) {
    const rows = state.boardGrid.map((row) => row.map((c) => (c ? '#' : '.')).join(''));
    const first = rows.findIndex((row) => row.includes('#'));
    return first < 0 ? [] : rows.slice(first);
}

function describeMove({
    shapeKey, rotation, x, y, waves,
}) {
    return {
        shapeKey, rotation, x, y, predicted: [...waves],
    };
}

export async function playPosition({
    rows, pieces, locks, pending = 0, holeMask = 1, mirror, ceilingOpponent,
    Controller = GravityBotController, options = {}, rules = versusRules(),
}) {
    const state = position(rows, pieces, mirror, rules);
    const incoming = Array.from({ length: pending }, () => ({ type: 'line', holeMask }));
    // Five vertical straight pieces against the wall leave no room for the next rise.
    const opponent = ceilingOpponent && position([...'ABCDE'].flatMap((id) => Array(4).fill(`${id}.........`)), queue, false, rules);
    const bot = new Controller({
        playerState: state,
        difficulty: 10,
        rng: () => 0.5,
        actions: {},
        pendingRows: () => incoming.length,
        finishingRoom: opponent ? () => 0 : undefined,
        ...options,
    });
    const steps = [];
    try {
        for (let i = 0; i < locks && !state.isGameOver; i++) {
            const plan = bot.plan();
            const forecast = [];
            for (let future = plan.candidate.futurePlan; future; future = future.child) {
                forecast.push(describeMove(future.candidate));
            }
            const step = {
                ...describeMove(plan.candidate),
                forecast,
                preview: state.nextPieces.slice(0, 3),
                pending: incoming.length,
                inputs: plan.actions,
                projectedAttack: plan.candidate.projectedAttack,
                actual: [],
                clearedFloorRows: [],
                attack: 0,
            };
            const before = state.score;
            const outgoing = [];
            await replay(state, plan.actions, {
                onLineClear: (n, _holes, _masks, clearedRows) => {
                    step.actual.push(n);
                    step.clearedFloorRows.push(clearedRows.map((y) => state.boardGrid.length - y));
                },
                onGarbageReady: (summary) => {
                    const attack = calculateGarbage(summary);
                    step.attack += attack.getTotalLines();
                    if (opponent) outgoing.push(...attack.expandEntries());
                },
                spawnPiece: () => {
                    const waiting = new GarbageQueue();
                    waiting.enqueue(incoming.splice(0));
                    if (takeGarbage(state, waiting, { rules }).topOut) {
                        state.isGameOver = true;
                        return;
                    }
                    spawn(state);
                },
            });
            if (opponent) step.receiverTopOut = rowsEndPlayer(opponent, outgoing, rules);
            steps.push({
                ...step, score: state.score - before, board: boardRows(state), lost: Boolean(state.isGameOver),
            });
        }
        return steps;
    } finally {
        state.reset();
        if (opponent) opponent.reset();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const Previous = process.argv[2] && (await import(pathToFileURL(resolve(
        process.argv[2],
        'src/core/ai/gravity-bot-controller.js',
    )))).GravityBotController;
    for (const [name, example] of Object.entries(examples)) {
        const previous = Previous && await playPosition({ ...example, Controller: Previous });
        const candidate = await playPosition(example);
        console.log(JSON.stringify({ name, previous, candidate }));
    }
}
