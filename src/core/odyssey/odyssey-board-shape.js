/**
 * The shape of an Odyssey well as the player sees it.
 *
 * The Phaser board shows twenty rows at a time. Any authored well taller than that scrolls
 * behind a camera, so it needs the tall-board presentation: the tower layout, the minimap
 * and the paused camera controls. The minimap used to appear only from thirty rows, which
 * left the 24- to 29-row cascade boards scrolling with no map of the stack above the lens.
 */
export const ODYSSEY_VISIBLE_ROWS = 20;

/** @param {object|number} boardOrRows a level config, its mechanics.board, or a row count */
export function getOdysseyBoardRows(boardOrRows) {
    if (Number.isFinite(boardOrRows)) return Number(boardOrRows);
    const rows = boardOrRows?.mechanics?.board?.rows ?? boardOrRows?.board?.rows ?? boardOrRows?.rows;
    return Number.isFinite(rows) && rows > 0 ? Number(rows) : ODYSSEY_VISIBLE_ROWS;
}

/** True when the well is taller than the twenty rows on screen and therefore scrolls. */
export function isOdysseyTallBoard(boardOrRows, visibleRows = ODYSSEY_VISIBLE_ROWS) {
    return getOdysseyBoardRows(boardOrRows) > visibleRows;
}
