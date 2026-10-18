// @ts-check

/**
 * Every landing the real controls can reach, for the Fault Lines solver. It is the same
 * breadth-first search as ai/reachability-pathfinder.js (findReachablePlacements): the same
 * start, the same transitions in the same order (move left, move right, rotate left, rotate
 * right, flip, soft drop), the same kick tables, the same state cap, and the same choice
 * between two paths to one landing (the cheaper after trailing soft drops are trimmed, the
 * first found on a tie). It differs only in bookkeeping: states are numbers, paths are
 * parent links and kick lists are looked up once, so a three-piece puzzle solves several
 * times faster.
 *
 * tests/unit/fault-lines-reach.test.js holds it to findReachablePlacements, landing for
 * landing and action for action, on every bank puzzle's openings and on random boards with
 * caves and overhangs where tucks and spins matter.
 */

import { COLS } from '../constants.js';
import {
    I_KICKS, JLSTZ_KICKS, LEGACY_WALL_KICKS, ROTATION_NAMES, rotateShapeMatrix,
} from '../game.js';

/** findReachablePlacements' default state cap. */
const MAX_STATES = 4096;

const MOVE_LEFT = 0;
const MOVE_RIGHT = 1;
const ROTATE_LEFT = 2;
const ROTATE_RIGHT = 3;
const FLIP = 4;
const SOFT_DROP = 5;
const ACTIONS = [
    { type: 'move', dir: -1 },
    { type: 'move', dir: 1 },
    { type: 'rotate', dir: 'left' },
    { type: 'rotate', dir: 'right' },
    { type: 'rotate', dir: 'flip' },
    { type: 'softDrop' },
];
/** The pathfinder's path cost: a soft drop step costs four, every other input one. */
const ACTION_COST = [1, 1, 1, 1, 1, 4];

/**
 * The kicks a turn tries, in order, as [dx, dy] board offsets: the SRS table's (y up, so
 * negated) for a left or right turn, then the legacy wall kicks; a flip tries only the
 * legacy ones. Indexed [from * 4 + to].
 * @param {Record<string, number[][]>} table
 */
function turnKicks(table) {
    /** @type {number[][][]} */
    const byTurn = [];
    for (let from = 0; from < 4; from += 1) {
        for (let to = 0; to < 4; to += 1) {
            const srs = (to - from + 4) % 4 === 2
                ? []
                : (table[`${ROTATION_NAMES[from]}>${ROTATION_NAMES[to]}`] || [[0, 0]]).map(([dx, dy]) => [dx, -dy]);
            byTurn[from * 4 + to] = [...srs, ...LEGACY_WALL_KICKS.map(([dx, dy]) => [dx, dy])];
        }
    }
    return byTurn;
}
const I_TURN_KICKS = turnKicks(I_KICKS);
const JLSTZ_TURN_KICKS = turnKicks(JLSTZ_KICKS);

/**
 * @typedef {Object} ReachedLanding
 * @property {number[][]} shape
 * @property {number} rotation
 * @property {number} x
 * @property {number} y
 * @property {Array<{type: string, dir?: number|string}>} actions from the start, trailing soft drops trimmed
 * @property {number} pathCost
 */

/**
 * @param {Array<Array<unknown>>} boardGrid
 * @param {{ shapeKey: string, shape: number[][], rotation?: number, x: number, y: number }} piece
 * @returns {ReachedLanding[]} one per landing (x, y, rotation), in the order the search first lands there
 */
export function reachableLandings(boardGrid, piece) {
    const height = boardGrid.length;
    const startRotation = piece.rotation ?? 0;
    // A shape is fixed by its rotation: right turns from the start shape (left = three rights).
    /** @type {number[][][]} */
    const shapes = [];
    /** @type {number[][]} filled cells per rotation, flattened as dx, dy, dx, dy, … */
    const cells = [];
    let shape = piece.shape.map((row) => row.slice());
    for (let turn = 0; turn < 4; turn += 1) {
        const rotation = (startRotation + turn) % 4;
        shapes[rotation] = shape;
        /** @type {number[]} */
        const filled = [];
        shape.forEach((row, dy) => row.forEach((cell, dx) => { if (cell > 0) filled.push(dx, dy); }));
        cells[rotation] = filled;
        shape = rotateShapeMatrix(shape, 'right');
    }

    const fits = (/** @type {number} */ rotation, /** @type {number} */ x, /** @type {number} */ y) => {
        const filled = cells[rotation];
        for (let i = 0; i < filled.length; i += 2) {
            const bx = x + filled[i];
            const by = y + filled[i + 1];
            if (bx < 0 || bx >= COLS || by >= height) return false;
            if (by >= 0 && boardGrid[by][bx] !== null) return false;
        }
        return true;
    };
    if (!fits(startRotation, piece.x, piece.y)) return [];

    const isO = piece.shapeKey === 'O';
    const kicksByTurn = piece.shapeKey === 'I' ? I_TURN_KICKS : JLSTZ_TURN_KICKS;
    const key = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ rotation) => (
        ((y + 64) * 128 + (x + 64)) * 4 + rotation);

    // State arrays: position, the link back, and the path as the pathfinder would trim it.
    const xs = [piece.x];
    const ys = [piece.y];
    const rotations = [startRotation];
    const parents = [-1];
    const actions = [-1];
    const costs = [0];
    const trimmedEnd = [0];
    const trimmedCost = [0];
    const visited = new Set([key(piece.x, piece.y, startRotation)]);
    /** @type {Map<number, { state: number, cost: number, x: number, y: number, rotation: number }>} */
    const best = new Map();

    /** @param {number} from @param {number} action @param {number} x @param {number} y @param {number} rotation */
    const push = (from, action, x, y, rotation) => {
        const nextKey = key(x, y, rotation);
        if (visited.has(nextKey)) return;
        visited.add(nextKey);
        const index = xs.length;
        const cost = costs[from] + ACTION_COST[action];
        xs.push(x);
        ys.push(y);
        rotations.push(rotation);
        parents.push(from);
        actions.push(action);
        costs.push(cost);
        trimmedEnd.push(action === SOFT_DROP ? trimmedEnd[from] : index);
        trimmedCost.push(action === SOFT_DROP ? trimmedCost[from] : cost);
    };
    /** @param {number} from @param {number} action @param {number} step @param {number} x @param {number} y @param {number} rotation */
    const turn = (from, action, step, x, y, rotation) => {
        const to = (rotation + step) % 4;
        const kicks = kicksByTurn[rotation * 4 + to];
        for (let i = 0; i < kicks.length; i += 1) {
            if (fits(to, x + kicks[i][0], y + kicks[i][1])) {
                push(from, action, x + kicks[i][0], y + kicks[i][1], to);
                return;
            }
        }
    };

    for (let cursor = 0; cursor < xs.length && visited.size < MAX_STATES; cursor += 1) {
        const x = xs[cursor];
        const y = ys[cursor];
        const rotation = rotations[cursor];
        let landingY = y;
        while (fits(rotation, x, landingY + 1)) landingY += 1;
        const landingKey = key(x, landingY, rotation);
        const existing = best.get(landingKey);
        if (!existing || trimmedCost[cursor] < existing.cost) {
            best.set(landingKey, {
                state: trimmedEnd[cursor], cost: trimmedCost[cursor], x, y: landingY, rotation,
            });
        }
        if (fits(rotation, x - 1, y)) push(cursor, MOVE_LEFT, x - 1, y, rotation);
        if (fits(rotation, x + 1, y)) push(cursor, MOVE_RIGHT, x + 1, y, rotation);
        if (!isO) {
            turn(cursor, ROTATE_LEFT, 3, x, y, rotation);
            turn(cursor, ROTATE_RIGHT, 1, x, y, rotation);
        }
        turn(cursor, FLIP, 2, x, y, rotation);
        if (fits(rotation, x, y + 1)) push(cursor, SOFT_DROP, x, y + 1, rotation);
    }

    return [...best.values()].map((landing) => {
        /** @type {Array<{type: string, dir?: number|string}>} */
        const path = [];
        let { state } = landing;
        while (state > 0) {
            path.push({ ...ACTIONS[actions[state]] });
            state = parents[state];
        }
        path.reverse();
        return {
            shape: shapes[landing.rotation].map((row) => row.slice()),
            rotation: landing.rotation,
            x: landing.x,
            y: landing.y,
            actions: path,
            pathCost: landing.cost,
        };
    });
}
