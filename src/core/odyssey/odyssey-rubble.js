// @ts-check
/**
 * Rubble on an Odyssey board (level design audit 2026-11, phase 3: "Dig out N rubble rows").
 *
 * Rubble rows go in through the garbage boundary, so their cells carry the GARBAGE piece type. Physics rebuilds
 * locked pieces from the grid after every clear and keeps only that type (not `isGarbage`), so the grid's cell
 * type is the one marker that survives every clear, settle and cascade.
 */

const RUBBLE_TYPES = new Set(['GARBAGE', 'CLEAN_GARBAGE']);

/**
 * Rows that still hold at least one rubble cell.
 * @param {Array<Array<{ type?: string } | null>> | null | undefined} boardGrid
 * @returns {number}
 */
export function countRubbleRows(boardGrid) {
    if (!Array.isArray(boardGrid)) return 0;
    let rows = 0;
    for (const row of boardGrid) {
        if (Array.isArray(row) && row.some((cell) => Boolean(cell?.type && RUBBLE_TYPES.has(cell.type)))) rows++;
    }
    return rows;
}
