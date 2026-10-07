/** Bounded repair of one chosen geometric placement, without lookahead or scoring. */
import { COLS, SHAPES } from '../../src/core/constants.js';
import {
    canPlacePiece, move, rotate, rotateShapeMatrix,
} from '../../src/core/game.js';

export const MASTERY_PATH_REPAIR_VERSION = 'exact-target-bfs-v1';
export const MASTERY_PATH_REPAIR_DEFAULTS = Object.freeze({ maxNodes: 4096, wallBudgetMs: 25 });
// The benchmark replaces performance.now with gameplay time; compute limits must not use it.
const realNow = () => Number(process.hrtime.bigint()) / 1e6;
const key = (piece) => `${piece.x},${piece.y},${piece.rotation}`;
const pose = (piece) => ({
    shapeKey: piece.shapeKey, x: piece.x, y: piece.y, rotation: piece.rotation ?? 0,
});

function optionsFor(options) {
    const maxNodes = options.maxNodes ?? MASTERY_PATH_REPAIR_DEFAULTS.maxNodes;
    const wallBudgetMs = options.wallBudgetMs ?? MASTERY_PATH_REPAIR_DEFAULTS.wallBudgetMs;
    if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 100000) {
        throw new RangeError('maxNodes must be an integer from 1 to 100000');
    }
    if (!Number.isFinite(wallBudgetMs) || wallBudgetMs <= 0) {
        throw new RangeError('wallBudgetMs must be finite and positive');
    }
    return { maxNodes, wallBudgetMs };
}

function validatedPose(piece, label) {
    if (!piece || !Object.hasOwn(SHAPES, piece.shapeKey)
        || !Number.isSafeInteger(piece.x) || !Number.isSafeInteger(piece.y)
        || !Number.isInteger(piece.rotation ?? 0)
        || (piece.rotation ?? 0) < 0 || (piece.rotation ?? 0) > 3) {
        throw new TypeError(`${label} must be a tetromino pose with integer coordinates and rotation 0..3`);
    }
    return pose(piece);
}

function copyPiece(piece) {
    const result = validatedPose(piece, 'currentPiece');
    let expected = SHAPES[result.shapeKey];
    for (let index = 0; index < result.rotation; index++) expected = rotateShapeMatrix(expected, 'right');
    if (!Array.isArray(piece.shape) || JSON.stringify(piece.shape) !== JSON.stringify(expected)) {
        throw new TypeError('currentPiece shape must match its tetromino and rotation');
    }
    return { ...result, shape: piece.shape.map((row) => row.slice()) };
}

function copyOccupancy(board) {
    if (!Array.isArray(board) || !board.length
        || board.some((row) => !Array.isArray(row) || row.length !== COLS)) {
        throw new TypeError(`boardGrid must contain rows of ${COLS} cells`);
    }
    // Collision depends only on null versus occupied. Never read IDs, colours, RNG, or queues.
    return board.map((row) => row.map((cell) => (cell === null ? null : {})));
}

function privateState(boardGrid, piece) {
    return {
        boardGrid,
        boardCache: boardGrid,
        boardCacheDirty: false,
        currentPiece: { ...piece },
        lockResetCount: 0,
    };
}

function transition(boardGrid, piece, action) {
    const state = privateState(boardGrid, piece);
    let accepted;
    if (action.type === 'move') accepted = move(state, action.dir);
    else if (action.type === 'rotate') accepted = rotate(state, action.dir);
    else {
        // A grounded soft drop may lock in production. It is never a repair-path edge.
        accepted = canPlacePiece(state, state.currentPiece, piece.x, piece.y + 1);
        if (accepted) state.currentPiece.y++;
    }
    // Production O left/right rotations report success without changing pose.
    if (!accepted || key(state.currentPiece) === key(piece)) return null;
    return state.currentPiece;
}

function orderedActions(piece, target) {
    const firstDir = target.x < piece.x ? -1 : 1;
    const rotationDelta = (target.rotation - piece.rotation + 4) % 4;
    let rotations = ['right', 'left', 'flip'];
    if (rotationDelta === 3) rotations = ['left', 'right', 'flip'];
    if (rotationDelta === 2) rotations = ['flip', 'left', 'right'];
    return [
        { type: 'move', dir: firstDir },
        ...rotations.map((dir) => ({ type: 'rotate', dir })),
        { type: 'move', dir: -firstDir },
        { type: 'softDrop' },
    ];
}

function actionsTo(queue, startIndex) {
    const actions = [];
    let index = startIndex;
    while (queue[index].parent !== null) {
        actions.push(queue[index].action);
        index = queue[index].parent;
    }
    return [...actions.reverse(), { type: 'hardDrop' }];
}

/**
 * Search breadth first for a spatial command path to the exact target pose on the observed board.
 * Every reachable result ends in hardDrop. Rotationally equivalent footprints are NOT
 * substituted for the chosen pose. No gravity, action cadence, lock timer, spin history,
 * or score prediction is simulated: the live runner must validate execution and ownership.
 * Only currentPiece and boardGrid are read from observation; even previews are unnecessary.
 */
export function repairMasteryPath(observation, targetPose, options = {}) {
    const config = optionsFor(options);
    const beganAt = realNow();
    const current = copyPiece(observation?.currentPiece);
    const target = validatedPose(targetPose, 'target');
    const boardGrid = copyOccupancy(observation?.boardGrid);
    const state = privateState(boardGrid, current);
    let nodes = 0;
    let expandedNodes = 0;
    let truncatedByNodes = false;
    const result = (status, reason, actions = []) => ({
        status,
        reason,
        actions,
        target,
        diagnostics: {
            version: MASTERY_PATH_REPAIR_VERSION,
            nodes,
            expandedNodes,
            nodeBudget: config.maxNodes,
            nodeAccounting: 'discovered-unique-spatial-states-including-start',
            stoppedByWall: reason === 'wall-budget',
            stoppedByNodes: reason === 'node-budget',
            truncatedByNodes,
            knowledgePolicy: 'current-piece-and-observed-board-only',
            targetPolicy: 'exact-pose-and-shape',
            timingFeasibility: 'unverified',
            scoringHistoryPreserved: false,
        },
    });
    const expired = () => realNow() - beganAt >= config.wallBudgetMs;
    if (expired()) return result('budget', 'wall-budget');
    if (target.shapeKey !== current.shapeKey) return result('unreachable', 'different-piece-shape');
    if (!canPlacePiece(state, current, current.x, current.y)) return result('unreachable', 'current-collision');
    let targetShape = current.shape;
    for (let index = 0; index < (target.rotation - current.rotation + 4) % 4; index++) {
        targetShape = rotateShapeMatrix(targetShape, 'right');
    }
    const targetPiece = { ...target, shape: targetShape };
    if (!canPlacePiece(state, targetPiece, target.x, target.y)) return result('unreachable', 'target-collision');
    if (canPlacePiece(state, targetPiece, target.x, target.y + 1)) return result('unreachable', 'target-not-grounded');

    const queue = [{ piece: current, parent: null, action: null }];
    const visited = new Set([key(current)]);
    nodes = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
        if (expired()) return result('budget', 'wall-budget');
        const { piece } = queue[cursor];
        expandedNodes++;
        // Only matching orientation/column needs a landing calculation; other states expand directly.
        if (piece.x === target.x && piece.rotation === target.rotation) {
            let landingY = piece.y;
            while (canPlacePiece(state, piece, piece.x, landingY + 1)) {
                if (expired()) return result('budget', 'wall-budget');
                landingY++;
            }
            if (landingY === target.y) return result('reachable', 'exact-target', actionsTo(queue, cursor));
        }
        for (const action of orderedActions(piece, target)) {
            if (expired()) return result('budget', 'wall-budget');
            const next = transition(boardGrid, piece, action);
            if (!next || visited.has(key(next))) continue;
            if (nodes >= config.maxNodes) {
                truncatedByNodes = true;
                continue;
            }
            visited.add(key(next));
            nodes++;
            queue.push({ piece: next, parent: cursor, action });
        }
    }
    return truncatedByNodes ? result('budget', 'node-budget') : result('unreachable', 'no-spatial-path');
}
