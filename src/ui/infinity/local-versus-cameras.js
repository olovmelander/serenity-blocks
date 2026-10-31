// @ts-check

/**
 * Infinity's play camera on every board of a local versus Last Standing match.
 *
 * Each board gets its own InfinityPlayCamera (infinity-play-camera.js), so it frames and moves
 * exactly as Infinity does: the tower's top three tenths of the way down the view, a piece taken
 * down a shaft followed until its landing shows, a landing or a clear out of sight shown and then
 * the view home, all on one spring that moves the same at 60 and 165 Hz.
 *
 * The mode syncs its boards several times a frame (its loop and every player's physics draw), so
 * the cameras step on the clock: a second step in the same moment does not move the view. Moving
 * or turning a board's piece ends its beat (the move APIs have no callbacks, so the piece is
 * watched). Presentation only: spawns stay on the board's own anchor.
 */

import { getGhostLandingY } from '../../core/game.js';
import { findHighestOccupiedInfinityRow } from '../../core/infinity-spawn-policy.js';
import { InfinityPlayCamera, filledRowSpan, playFramingTop } from './infinity-play-camera.js';

const DEFAULT_VISIBLE_ROWS = 20;

/**
 * @typedef {{cameraSettings?: Record<string, any>|null,
 *   updateCameraPosition?: (row: number, instant?: boolean) => void}} BoardSceneLike
 * @typedef {Record<string, any>} PlayerStateLike
 */

/** The board's rows (top row first), or null outside Infinity. @param {PlayerStateLike} state */
function infinityBoard(state) {
    if (!state?.isInfinityMode) return null;
    const board = state.boardGrid || state.board;
    return Array.isArray(board) && board.length > 0 ? board : null;
}

/** @param {Record<string, any>} settings */
const visibleRowsOf = (settings) => settings.visibleRows || DEFAULT_VISIBLE_ROWS;

export class LocalVersusCameras {
    /** @param {{reducedMotion?: () => boolean, clock?: () => number}} [options] */
    constructor({ reducedMotion = () => false, clock } = {}) {
        this.reducedMotion = reducedMotion;
        this.clock = clock;
        /** @type {Array<{camera: InfinityPlayCamera, locks: number, piece: string|null, x: number,
         *   rotation: number}>} */
        this.boards = [];
    }

    /** A new match or round: every board starts at rest, with no beat. */
    reset() {
        this.boards = [];
    }

    /** @param {number} index @private */
    _board(index) {
        if (!this.boards[index]) {
            this.boards[index] = {
                camera: new InfinityPlayCamera({ reducedMotion: this.reducedMotion, clock: this.clock }),
                locks: 0,
                piece: null,
                x: NaN,
                rotation: NaN,
            };
        }
        return this.boards[index];
    }

    /**
     * Where the board's view rests: the tower's top three tenths of the way down, lowered to
     * follow a piece that went deeper and to show where it will land.
     * @param {PlayerStateLike} state @param {number} visibleRows
     */
    static home(state, visibleRows) {
        const board = infinityBoard(state);
        if (!board) return 0;
        const piece = state.currentPiece || null;
        return playFramingTop({
            boardRows: board.length,
            visibleRows,
            highestRow: findHighestOccupiedInfinityRow(board),
            piece,
            landingY: piece ? getGhostLandingY(state) : null,
        });
    }

    /**
     * Move one board's view for this moment.
     * @param {number} index @param {BoardSceneLike} scene @param {PlayerStateLike} state
     * @param {number} [now] ms (the page's clock by default)
     */
    step(index, scene, state, now) {
        const settings = scene?.cameraSettings;
        const board = infinityBoard(state);
        if (!settings || !board) return;
        const entry = this._board(index);
        this._watchInput(entry, state);
        if (settings.manualControl) {
            entry.camera.reset();
            return;
        }
        const visibleRows = visibleRowsOf(settings);
        const top = Number.isFinite(settings.currentTopRow) ? settings.currentTopRow : 0;
        const next = entry.camera.step({
            now,
            top,
            home: LocalVersusCameras.home(state, visibleRows),
            maxTop: Math.max(0, board.length - visibleRows),
            visibleRows,
        });
        if (next !== top) scene.updateCameraPosition?.(next, true);
    }

    /**
     * A board event from the physics callbacks.
     * @param {'lock'|'clear'|'settled'|'input'} kind
     * @param {number} index @param {BoardSceneLike} scene @param {PlayerStateLike} state
     * @param {any} [detail] the locked piece ('lock') or the cleared rows ('clear')
     */
    handle(kind, index, scene, state, detail) {
        const entry = this._board(index);
        // Every lock ends the piece in hand: the next one seen is a new piece.
        if (kind === 'lock') entry.locks += 1;
        if (kind === 'settled') {
            entry.camera.onCascadeComplete();
            return;
        }
        if (kind === 'input') {
            entry.camera.onPlayerInput();
            return;
        }
        const settings = scene?.cameraSettings;
        const board = infinityBoard(state);
        if (!settings || settings.manualControl || !board) return;
        const visibleRows = visibleRowsOf(settings);
        const framing = {
            boardRows: board.length,
            visibleRows,
            highestRow: findHighestOccupiedInfinityRow(board),
        };
        const viewTop = Number.isFinite(settings.currentTopRow) ? settings.currentTopRow : 0;
        const maxTop = Math.max(0, board.length - visibleRows);
        if (kind === 'lock' && detail && Number.isFinite(detail.y)) {
            const span = filledRowSpan(detail.shape);
            entry.camera.onLock({
                pieceTop: detail.y + span.first,
                pieceBottom: detail.y + span.last,
                viewTop,
                visibleRows,
                home: playFramingTop(framing),
                pieceHome: playFramingTop({ ...framing, piece: detail, landingY: detail.y }),
                maxTop,
            });
        } else if (kind === 'clear' && Array.isArray(detail) && detail.length > 0) {
            entry.camera.onClear({
                rows: detail, viewTop, visibleRows, home: playFramingTop(framing), maxTop,
            });
        }
    }

    /** Rows were added above a board: a beat held in rows moves down with everything else. */
    shift(index, rows) {
        this.boards[index]?.camera.shift(rows);
    }

    /**
     * The piece in hand moved or turned since the last look: that is the player's input.
     * A piece is known by this board's lock count and its spawn time, not by identity or
     * piecesPlaced: the pool can hand the next spawn back as the same object at the spawn
     * column, and spawnPiece syncs the boards (its draw callback) before it counts the spawn.
     * @private
     */
    _watchInput(entry, state) {
        const piece = state.currentPiece;
        const key = piece ? `${entry.locks}|${state.pieceSpawnTime}` : null;
        if (piece && key === entry.piece && (piece.x !== entry.x || piece.rotation !== entry.rotation)) {
            entry.camera.onPlayerInput();
        }
        entry.piece = key;
        entry.x = piece ? piece.x : NaN;
        entry.rotation = piece ? piece.rotation : NaN;
    }
}
