// @ts-check

/**
 * Every landing the real controls can reach, for the Stillfall solver. It is the same
 * breadth-first search as ai/reachability-pathfinder.js (findReachablePlacements): the same
 * start, the same transitions in the same order (move left, move right, rotate left, rotate
 * right, flip, soft drop), the same kick tables, the same state cap, and the same choice
 * between two paths to one landing (the cheaper after trailing soft drops are trimmed, the
 * first found on a tie). It differs only in bookkeeping: states are numbers, paths are
 * parent links and kick lists are looked up once, so a three-piece puzzle solves several
 * times faster.
 *
 * tests/unit/stillfall-reach.test.js holds it to findReachablePlacements, landing for
 * landing and action for action, on every bank puzzle's openings and on random boards with
 * caves and overhangs where tucks and spins matter.
 */

import { COLS, SHAPES } from '../constants.js';
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
 * The offsets a turn tries, in order, as [dx, dy] board offsets: the turn's own list (y up, so
 * negated) for a left or right turn, then the plain sideways nudges; a flip tries only the
 * nudges. Indexed [from * 4 + to].
 * @param {Record<string, number[][]>} table
 */
function turnKicks(table) {
    /** @type {number[][][]} */
    const byTurn = [];
    for (let from = 0; from < 4; from += 1) {
        for (let to = 0; to < 4; to += 1) {
            const own = (to - from + 4) % 4 === 2
                ? []
                : (table[`${ROTATION_NAMES[from]}>${ROTATION_NAMES[to]}`] || [[0, 0]]).map(([dx, dy]) => [dx, -dy]);
            byTurn[from * 4 + to] = [...own, ...LEGACY_WALL_KICKS.map(([dx, dy]) => [dx, dy])];
        }
    }
    return byTurn;
}
const I_TURN_KICKS = turnKicks(I_KICKS);
const JLSTZ_TURN_KICKS = turnKicks(JLSTZ_KICKS);

/**
 * Store the last call that visited each state. The default allocation covers
 * 64 rows. An expanded Infinity well grows it once for its actual height.
 */
let stamps = new Uint32Array(1 << 16);
let fitStamps = new Int32Array(stamps.length);
let dropStamps = new Uint32Array(stamps.length);
let dropRows = new Int32Array(stamps.length);
let generation = 0;
/**
 * One search's states. The search stops expanding once it holds MAX_STATES, and one
 * expansion adds at most six, so the room never runs out.
 */
const STATE_ROOM = MAX_STATES + 8;
const STATES = {
    xs: new Int16Array(STATE_ROOM),
    ys: new Int16Array(STATE_ROOM),
    rotations: new Uint8Array(STATE_ROOM),
    parents: new Int32Array(STATE_ROOM),
    actions: new Int8Array(STATE_ROOM),
    costs: new Int32Array(STATE_ROOM),
    trimmedEnd: new Int32Array(STATE_ROOM),
    trimmedCost: new Int32Array(STATE_ROOM),
};

/**
 * @typedef {Object} ReachedLanding
 * @property {number[][]} shape
 * @property {number} rotation
 * @property {number} x
 * @property {number} y
 * @property {Array<{type: string, dir?: number|string}>} actions from the start, trailing soft drops trimmed
 * @property {number} pathCost
 */

/** @typedef {{ shapeKey: string, shape: number[][], rotation?: number, x: number, y: number }} MovingPiece */

/**
 * @param {Array<Array<unknown>>} boardGrid
 * @param {MovingPiece} piece
 * @returns {ReachedLanding[]} one per landing (x, y, rotation), in the order the search first lands there
 */
export function reachableLandings(boardGrid, piece) {
    return searchLandings(boardGrid, piece);
}

/**
 * Visit distinct hard-drop endpoints in the same discovery order as reachableLandings.
 * Return true from the visitor once all requested positions have been seen.
 * @param {Array<Array<unknown>>} boardGrid
 * @param {MovingPiece} piece
 * @param {(x: number, y: number, rotation: number) => boolean} visit
 */
export function visitReachableLandings(boardGrid, piece, visit) {
    searchLandings(boardGrid, piece, visit);
}

/**
 * @param {Array<Array<unknown>>} boardGrid
 * @param {MovingPiece} piece
 * @param {(x: number, y: number, rotation: number) => boolean} [visit]
 * @returns {ReachedLanding[]}
 */
function searchLandings(boardGrid, piece, visit) {
    const height = boardGrid.length;
    const capacity = (height + 64) * 128 * 4;
    if (capacity > stamps.length) {
        stamps = new Uint32Array(capacity);
        fitStamps = new Int32Array(capacity);
        dropStamps = new Uint32Array(capacity);
        dropRows = new Int32Array(capacity);
    }
    if (++generation > 0x7fffffff) {
        stamps.fill(0);
        fitStamps.fill(0);
        dropStamps.fill(0);
        generation = 1;
    }
    const stamp = generation;
    const rowStride = 128 * 4;
    const key = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ rotation) => (
        ((y + 64) * 128 + (x + 64)) * 4 + rotation);
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
        const pose = key(x, y, rotation);
        if (fitStamps[pose] === stamp) return true;
        if (fitStamps[pose] === -stamp) return false;
        const filled = cells[rotation];
        for (let i = 0; i < filled.length; i += 2) {
            const bx = x + filled[i];
            const by = y + filled[i + 1];
            if (bx < 0 || bx >= COLS || by >= height || (by >= 0 && boardGrid[by][bx] !== null)) {
                fitStamps[pose] = -stamp;
                return false;
            }
        }
        fitStamps[pose] = stamp;
        return true;
    };
    if (!fits(startRotation, piece.x, piece.y)) return [];

    // From a high central spawn in an empty standard well, every landing has
    // an open-air rotation and translation. Removing a soft drop preserves that
    // endpoint. Reaching a floor kick costs more than crossing the entire well.
    const canonical = SHAPES[piece.shapeKey];
    const openSpawn = !visit && startRotation === 0 && Array.isArray(canonical) && piece.y >= 0
        && height - piece.y >= 2 * COLS && piece.x === Math.floor(COLS / 2) - Math.floor(canonical[0].length / 2)
        && piece.shape.length === canonical.length && piece.shape.every((row, y) => row.length === canonical[y].length
            && row.every((cell, x) => cell === canonical[y][x]))
        && boardGrid.every((row) => row.length === COLS && row.every((cell) => cell === null) && !row.includes(undefined));
    const isO = piece.shapeKey === 'O';
    const kicksByTurn = piece.shapeKey === 'I' ? I_TURN_KICKS : JLSTZ_TURN_KICKS;

    // State arrays (shared buffers; the search is synchronous and never re-entered):
    // position, the link back, and the path as the pathfinder would trim it.
    const {
        xs, ys, rotations, parents, actions, costs, trimmedEnd, trimmedCost,
    } = STATES;
    xs[0] = piece.x;
    ys[0] = piece.y;
    rotations[0] = startRotation;
    parents[0] = -1;
    actions[0] = -1;
    costs[0] = 0;
    trimmedEnd[0] = 0;
    trimmedCost[0] = 0;
    let count = 1;
    stamps[key(piece.x, piece.y, startRotation)] = stamp;
    /** @type {Map<number, { state: number, cost: number, x: number, y: number, rotation: number }>} */
    const best = new Map();
    const visitedLandings = visit && new Set();

    /** @param {number} from @param {number} action @param {number} x @param {number} y @param {number} rotation */
    const push = (from, action, x, y, rotation) => {
        const nextKey = key(x, y, rotation);
        if (stamps[nextKey] === stamp) return;
        stamps[nextKey] = stamp;
        const index = count;
        xs[index] = x;
        ys[index] = y;
        rotations[index] = rotation;
        if (!visit) {
            const cost = costs[from] + ACTION_COST[action];
            parents[index] = from;
            actions[index] = action;
            costs[index] = cost;
            trimmedEnd[index] = action === SOFT_DROP ? trimmedEnd[from] : index;
            trimmedCost[index] = action === SOFT_DROP ? trimmedCost[from] : cost;
        }
        count += 1;
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

    for (let cursor = 0; cursor < count && count < MAX_STATES; cursor += 1) {
        const x = xs[cursor];
        const y = ys[cursor];
        const rotation = rotations[cursor];
        // Every pose on an unobstructed vertical descent has the same hard-drop
        // endpoint. Memoize just that run so a cavity still has its own endpoint.
        const pose = key(x, y, rotation);
        if (dropStamps[pose] !== stamp) {
            let bottom = y;
            let endPose = pose;
            while (fits(rotation, x, bottom + 1)) {
                bottom++;
                endPose += rowStride;
                if (dropStamps[endPose] === stamp) {
                    bottom = dropRows[endPose];
                    break;
                }
            }
            for (let p = pose; p <= endPose; p += rowStride) {
                dropStamps[p] = stamp;
                dropRows[p] = bottom;
            }
        }
        const landingY = dropRows[pose];
        const landingKey = key(x, landingY, rotation);
        if (visit && visitedLandings) {
            if (!visitedLandings.has(landingKey)) {
                visitedLandings.add(landingKey);
                if (visit(x, landingY, rotation)) return [];
            }
        } else {
            const existing = best.get(landingKey);
            if (!existing || trimmedCost[cursor] < existing.cost) {
                best.set(landingKey, {
                    state: trimmedEnd[cursor], cost: trimmedCost[cursor], x, y: landingY, rotation,
                });
            }
        }
        if (fits(rotation, x - 1, y)) push(cursor, MOVE_LEFT, x - 1, y, rotation);
        if (fits(rotation, x + 1, y)) push(cursor, MOVE_RIGHT, x + 1, y, rotation);
        if (!isO) {
            turn(cursor, ROTATE_LEFT, 3, x, y, rotation);
            turn(cursor, ROTATE_RIGHT, 1, x, y, rotation);
        }
        turn(cursor, FLIP, 2, x, y, rotation);
        if (!openSpawn && fits(rotation, x, y + 1)) push(cursor, SOFT_DROP, x, y + 1, rotation);
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
