/**
 * Shared cascade primitives (plan §5.2).
 *
 * These four functions are the deterministic core both cascade paths execute:
 * the legacy async processPhysics loop (physics.js) and the pure synchronous
 * resolveCascade (cascade-resolver.js). They live in this leaf module so both
 * can import the SAME implementations — identity by construction for the
 * differential gate — without a physics⇄resolver import cycle (no-circular is
 * a hard boundary gate). physics.js re-exports them for existing consumers.
 *
 * Bodies are verbatim moves from physics.js — do not "improve" them here;
 * `queue.shift()` and friends are pinned by the differential suite, and any
 * behavior change must go through the §5.10 gate.
 */
import { HIDDEN_ROWS, COLORS } from './constants.js';

const CASCADE_DEBUG = false;
/* eslint-disable no-console */
function cascadeLog(...args) {
    if (CASCADE_DEBUG) console.log(...args);
}
/* eslint-enable no-console */

/**
 * Determines if a specific board position is part of a given piece
 * @param {number} boardX - X coordinate on the board
 * @param {number} boardY - Y coordinate on the board
 * @param {Object} piece - The piece to check against
 * @returns {boolean} True if the position is part of the piece
 */
export function isPartOfPiece(boardX, boardY, piece) {
    const localX = boardX - piece.x;
    const localY = boardY - piece.y;
    if (
        localY >= 0
        && localY < piece.shape.length
        && localX >= 0
        && localX < piece.shape[0].length
    ) {
        return piece.shape[localY][localX] > 0;
    }
    return false;
}

/**
 * Splits the board into connected components (individual blocks or clusters)
 * Uses flood fill algorithm to find connected blocks with the same ID
 * @param {Array<Array>} boardData - The current board state
 * @returns {Array<Object>} Array of piece objects representing connected components
 */
export function findConnectedComponents(boardData) {
    const pieces = [];
    const visited = Array.from({ length: boardData.length }, () => Array(boardData[0].length).fill(false));

    for (let r = 0; r < boardData.length; r++) {
        for (let c = 0; c < boardData[0].length; c++) {
            if (boardData[r][c] !== null && !visited[r][c]) {
                const cellData = boardData[r][c];
                const component = [];
                const queue = [[r, c]];
                visited[r][c] = true;

                let minR = r;
                let maxR = r;
                let minC = c;
                let maxC = c;

                // Flood fill to find all connected blocks
                while (queue.length > 0) {
                    const [row, col] = queue.shift();
                    component.push({ r: row, c: col });

                    minR = Math.min(minR, row);
                    maxR = Math.max(maxR, row);
                    minC = Math.min(minC, col);
                    maxC = Math.max(maxC, col);

                    // Check 4 adjacent cells (up, down, left, right)
                    [
                        [-1, 0],
                        [1, 0],
                        [0, -1],
                        [0, 1],
                    ].forEach(([dr, dc]) => {
                        const nr = row + dr;
                        const nc = col + dc;
                        if (
                            nr >= 0
                            && nr < boardData.length
                            && nc >= 0
                            && nc < boardData[0].length
                            && !visited[nr][nc]
                            && boardData[nr][nc] !== null
                            && boardData[nr][nc].id === cellData.id
                        ) {
                            visited[nr][nc] = true;
                            queue.push([nr, nc]);
                        }
                    });
                }

                // Create shape array for this component
                const shape = Array.from({ length: maxR - minR + 1 }, () => Array(maxC - minC + 1).fill(0));
                component.forEach(({ r: cellR, c: cellC }) => {
                    shape[cellR - minR][cellC - minC] = 1;
                });

                const shapeKey = cellData.type || cellData.color;
                // Preserve attacker's player color for garbage blocks
                // Check cellData.color first before falling back to COLORS lookup
                const baseColor = cellData.color || COLORS[shapeKey] || '#808080';
                pieces.push({
                    x: minC,
                    y: minR,
                    shape,
                    shapeKey,
                    type: shapeKey,
                    color: baseColor,
                    pieceId: cellData.id,
                });
            }
        }
    }

    return pieces;
}

/**
 * Detects all complete lines on the board
 * @param {Array<Array>} boardData - The current board state
 * @returns {Array<number>} Array of Y coordinates of full lines
 */
export function detectFullLines(boardData) {
    const fullLines = [];
    for (let y = boardData.length - 1; y >= HIDDEN_ROWS; y--) {
        const isFull = boardData[y].every((cell) => cell !== null);
        if (isFull) {
            const hasGarbage = boardData[y].some((cell) => cell && cell.color === 'GARBAGE');
            if (hasGarbage) {
                cascadeLog(`[detectFullLines] Line ${y} is full and contains GARBAGE blocks`);
            }
            fullLines.push(y);
        }
    }
    return fullLines;
}

/**
 * Removes cleared lines from locked pieces
 * @param {Array<Object>} lockedPieces - Array of locked pieces
 * @param {Array<number>} fullLines - Y coordinates of lines to remove
 * @returns {Array<Object>} New array of pieces with cleared lines removed
 */
export function removeClearedLines(lockedPieces, fullLines) {
    const newPieces = [];

    lockedPieces.forEach((p) => {
        const newShape = [];
        p.shape.forEach((row, localY) => {
            const globalY = p.y + localY;
            if (!fullLines.includes(globalY)) {
                newShape.push(row);
            }
        });

        if (newShape.length > 0) {
            p.shape = newShape;
            newPieces.push(p);
        }
    });

    return newPieces;
}
