// @ts-check

/**
 * Pure board/wire helpers extracted from ffa-p2p-game-state.js (plan §6A.2).
 * No instance state — safe to import in node tests.
 */

const HIDDEN_ROWS = 4;

/**
 * True when the board has topped out: any locked piece sits at or above the
 * spawn line. Pieces spawn at y=HIDDEN_ROWS, so a locked piece there means there
 * is no room to spawn the next one.
 * @param {{ lockedPieces?: Array<{ y: number }> }} gameState
 * @returns {boolean}
 */
export function checkTopOut(gameState) {
    const pieces = gameState && gameState.lockedPieces;
    if (!Array.isArray(pieces)) return false;
    return pieces.some((piece) => piece.y <= HIDDEN_ROWS);
}

/**
 * Strip a board grid to wire form (drop the render-only `id`), preserving row
 * structure and null cells.
 * @param {Array<Array<{ color: unknown, type: unknown }|null>|null>|null|undefined} grid
 * @returns {Array<Array<{ color: unknown, type: unknown }|null>|null>|null}
 */
export function serializeBoardGrid(grid) {
    if (!Array.isArray(grid)) return null;
    return grid.map((row) => (Array.isArray(row)
        ? row.map((c) => (c ? { color: c.color, type: c.type } : null))
        : null));
}
