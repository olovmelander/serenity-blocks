// @ts-check
/**
 * Reader for the optional viewport-normalized lock origin carried on the canonical
 * PIECE_LOCK payload (see `emitPieceLock` in events/gameplay-events.js).
 *
 * Themes that place an effect AT the locked piece's board location normally derive a
 * normalized position from `piece.x/piece.y` against a FIXED board (row/20, minus hidden
 * rows). That assumption breaks in Infinity mode: its board is a tall scrolling grid where
 * `piece.y` is an absolute row that grows into the hundreds, so the fixed-board math
 * saturates and pins every lock effect to the BOTTOM of the screen. Infinity therefore
 * supplies `viewportOrigin` — the ON-SCREEN normalized lock position — and themes prefer it
 * over their own board math when present. Single player never sends it, so those themes keep
 * their existing behavior unchanged.
 *
 * @param {any} payload a PIECE_LOCK payload (or any object with an optional `viewportOrigin`).
 * @returns {{x:number,y:number}|null} normalized `{x,y}` in [0,1] with a TOP-LEFT origin
 *   (0 = top / left of the visible playfield, 1 = bottom / right), or `null` when the field
 *   is absent or invalid — in which case the caller should fall back to its own board math.
 */
export function readLockViewportOrigin(payload) {
    const viewport = payload && payload.viewportOrigin;
    if (!viewport || !Number.isFinite(viewport.x) || !Number.isFinite(viewport.y)) return null;
    return {
        x: Math.max(0, Math.min(1, viewport.x)),
        y: Math.max(0, Math.min(1, viewport.y)),
    };
}
