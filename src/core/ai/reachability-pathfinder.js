import { COLS } from '../constants.js';
import {
    I_KICKS,
    JLSTZ_KICKS,
    LEGACY_WALL_KICKS,
    ROTATION_NAMES,
    ROTATION_STEP,
    rotateShapeMatrix,
} from '../game.js';
import { computeLandingHeight } from './cascade-simulator.js';

function cloneShape(shape) {
    return shape.map((row) => row.slice());
}

function clonePiece(piece) {
    return {
        ...piece,
        shape: cloneShape(piece.shape),
        rotation: piece.rotation ?? 0,
    };
}

function canPlaceOnBoard(boardGrid, piece, checkX, checkY) {
    if (!piece || !boardGrid) return false;

    for (let y = 0; y < piece.shape.length; y++) {
        for (let x = 0; x < piece.shape[y].length; x++) {
            if (piece.shape[y][x] <= 0) continue;

            const boardX = Math.floor(checkX + x);
            const boardY = Math.floor(checkY + y);
            if (boardX < 0 || boardX >= COLS || boardY >= boardGrid.length) {
                return false;
            }
            if (boardY >= 0 && boardGrid[boardY]?.[boardX] !== null) {
                return false;
            }
        }
    }

    return true;
}

function stateKey(piece) {
    return `${piece.x},${piece.y},${piece.rotation ?? 0}`;
}

function actionPathCost(actions) {
    return actions.reduce((cost, action) => cost + (action.type === 'softDrop' ? 4 : 1), 0);
}

function trimTrailingSoftDrops(actions) {
    const trimmed = actions.slice();
    while (trimmed[trimmed.length - 1]?.type === 'softDrop') {
        trimmed.pop();
    }
    return trimmed;
}

function dropPieceToLanding(boardGrid, piece) {
    const landingPiece = clonePiece(piece);
    while (canPlaceOnBoard(boardGrid, landingPiece, landingPiece.x, landingPiece.y + 1)) {
        landingPiece.y++;
    }
    return landingPiece;
}

function tryMove(boardGrid, state, dir) {
    const nextPiece = clonePiece(state.piece);
    if (!canPlaceOnBoard(boardGrid, nextPiece, nextPiece.x + dir, nextPiece.y)) return null;
    nextPiece.x += dir;
    return {
        actions: state.actions.concat({ type: 'move', dir }),
        piece: nextPiece,
    };
}

function trySoftDrop(boardGrid, state) {
    const nextPiece = clonePiece(state.piece);
    if (!canPlaceOnBoard(boardGrid, nextPiece, nextPiece.x, nextPiece.y + 1)) return null;
    nextPiece.y++;
    return {
        actions: state.actions.concat({ type: 'softDrop' }),
        piece: nextPiece,
    };
}

function tryRotate(boardGrid, state, dir) {
    const { piece } = state;
    if (piece.shapeKey === 'O' && dir !== 'flip') return null;

    const step = ROTATION_STEP[dir] ?? ROTATION_STEP.right;
    const fromRotation = piece.rotation ?? 0;
    const toRotation = (fromRotation + step + 4) % 4;
    const rotatedShape = rotateShapeMatrix(piece.shape, dir);
    const rotatedPiece = {
        ...piece,
        shape: rotatedShape,
        rotation: toRotation,
    };
    const originalX = piece.x;
    const originalY = piece.y;

    if (dir === 'flip') {
        for (const [dx, dy] of LEGACY_WALL_KICKS) {
            if (canPlaceOnBoard(boardGrid, rotatedPiece, originalX + dx, originalY + dy)) {
                return {
                    actions: state.actions.concat({ type: 'rotate', dir }),
                    piece: {
                        ...rotatedPiece,
                        x: originalX + dx,
                        y: originalY + dy,
                    },
                };
            }
        }
        return null;
    }

    const key = `${ROTATION_NAMES[fromRotation]}>${ROTATION_NAMES[toRotation]}`;
    const kicks = piece.shapeKey === 'I' ? I_KICKS[key] : JLSTZ_KICKS[key];

    for (const [dx, dy] of kicks || [[0, 0]]) {
        if (canPlaceOnBoard(boardGrid, rotatedPiece, originalX + dx, originalY - dy)) {
            return {
                actions: state.actions.concat({ type: 'rotate', dir }),
                piece: {
                    ...rotatedPiece,
                    x: originalX + dx,
                    y: originalY - dy,
                },
            };
        }
    }

    for (const [dx, dy] of LEGACY_WALL_KICKS) {
        if (canPlaceOnBoard(boardGrid, rotatedPiece, originalX + dx, originalY + dy)) {
            return {
                actions: state.actions.concat({ type: 'rotate', dir }),
                piece: {
                    ...rotatedPiece,
                    x: originalX + dx,
                    y: originalY + dy,
                },
            };
        }
    }

    return null;
}

function makePlacement(state, boardGrid) {
    const landingPiece = dropPieceToLanding(boardGrid, state.piece);
    const actions = trimTrailingSoftDrops(state.actions);
    const pieceId = [
        landingPiece.shapeKey || 'piece',
        landingPiece.x,
        landingPiece.y,
        landingPiece.rotation ?? 0,
    ].join(':');

    return {
        ...landingPiece,
        actions,
        landingHeight: computeLandingHeight(landingPiece, boardGrid.length),
        pathCost: actionPathCost(actions),
        simulationId: `bot:${pieceId}`,
    };
}

function storeBestPlacement(placements, placement) {
    const key = stateKey(placement);
    const existing = placements.get(key);
    if (!existing || placement.pathCost < existing.pathCost) {
        placements.set(key, placement);
    }
}

export function findReachablePlacements(gameState, options = {}) {
    const boardGrid = gameState?.boardGrid || gameState?.board;
    const currentPiece = gameState?.currentPiece;
    if (!boardGrid || !currentPiece) return [];

    const maxStates = options.maxStates || 4096;
    const startPiece = clonePiece(currentPiece);
    if (!canPlaceOnBoard(boardGrid, startPiece, startPiece.x, startPiece.y)) return [];

    const queue = [{
        actions: [],
        piece: startPiece,
    }];
    const visited = new Set([stateKey(startPiece)]);
    const placementsByKey = new Map();
    let cursor = 0;

    while (cursor < queue.length && visited.size < maxStates) {
        const state = queue[cursor++];
        storeBestPlacement(placementsByKey, makePlacement(state, boardGrid));

        const transitions = [
            tryMove(boardGrid, state, -1),
            tryMove(boardGrid, state, 1),
            tryRotate(boardGrid, state, 'left'),
            tryRotate(boardGrid, state, 'right'),
            tryRotate(boardGrid, state, 'flip'),
            trySoftDrop(boardGrid, state),
        ];

        for (const next of transitions) {
            if (!next) continue;
            const key = stateKey(next.piece);
            if (visited.has(key)) continue;
            visited.add(key);
            queue.push(next);
        }
    }

    return [...placementsByKey.values()];
}

export function canPlaceCandidate(boardGrid, placement) {
    return canPlaceOnBoard(boardGrid, placement, placement.x, placement.y);
}
