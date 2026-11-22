// @ts-check

/**
 * Pure board/wire helpers extracted from ffa-p2p-game-state.js (plan §6A.2).
 * No instance state — safe to import in node tests.
 *
 * There is no board-height death check here: in versus play only a piece that cannot spawn
 * ends a player (versus-rules.js).
 */

/**
 * True when clearing `rows` leaves the board empty: that wave is a clean canvas.
 * @param {Array<Array<unknown>|null>|null|undefined} grid
 * @param {number[]} rows
 * @returns {boolean}
 */
export function clearEmptiesBoard(grid, rows) {
    if (!Array.isArray(grid)) return false;
    return grid.every((row, r) => rows.includes(r) || !row?.some(Boolean));
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
