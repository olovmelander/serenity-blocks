// @ts-check

/**
 * Where Infinity's view looks while the game runs, and how it gets there.
 *
 * One target a frame and one critically damped spring (springStep: exact for any dt, so the view
 * moves the same at 60 and 165 Hz, and it starts and stops smoothly instead of whipping). The
 * target is the framing below, unless a beat holds the view on something the player should see.
 *
 * - The framing. The tower's top sits a fifth of the way down the view: room to steer above it,
 *   the stack beneath. A piece that goes deeper, down a shaft or into a hole, is followed with
 *   its top PIECE_LEAD_SHARE down the view, so the rows it falls toward are on screen, but the
 *   view goes no lower than it needs to show where the piece will land.
 * - The lock. A piece the view followed down is shown locking before the view goes home.
 * - The landing. A piece hard-dropped out of sight is gone after, shown landing, then home.
 * - The clear. Rows cleared out of sight are gone to and watched until their cascade settles.
 * - The player wins: moving or turning the next piece ends a beat at once.
 * - Reduced motion: no beats, and a trip longer than a view is a cut rather than a flight.
 *
 * No DOM and no Phaser. The clock is the page's unless one is passed in, and every call takes an
 * optional `now` (ms) as well, so tests run it on their own time. Rows are the board's own: a
 * view's `top` is its first row on screen, and rows grow DOWN the tower (row 0 is the grid's top).
 */

import { springStep } from './ascent/tower-flight.js';

export const PLAY_CAMERA = Object.freeze({
    /** The tower's top sits this far down the view. */
    TOWER_TOP_SHARE: 0.2,
    /** A piece below the tower's top is followed with its top this far down the view. */
    PIECE_LEAD_SHARE: 0.3,
    /** Rows kept under a revealed landing. */
    LANDING_MARGIN_ROWS: 1,
    /** Out-of-sight action (a landing, a clear) is framed this far down the view: the shaft it
     * came down shows above it. */
    ACTION_SHARE: 0.6,
    /** Spring rates (1/s): following the piece and the stack, going to the action, coming home. */
    OMEGA_FOLLOW: 16,
    OMEGA_DIVE: 15,
    OMEGA_HOME: 12,
    /** Farther than this from home the view travels home on its own spring. */
    TRAVEL_ROWS: 6,
    /** A beat's rows count as shown once they are on screen with this many rows to spare
     * (the spring is still settling, but the player can see them). */
    ARRIVE_MARGIN_ROWS: 1,
    /** How long each beat holds once its rows are shown. */
    LOCK_HOLD_MS: 150,
    LANDING_HOLD_MS: 220,
    CLEAR_HOLD_MS: 300,
    /** A beat that cannot arrive (its framing kept moving) gives up after this long. */
    BEAT_GIVE_UP_MS: 1800,
    /** A view more than this far below home when a piece locks had followed the piece down. */
    FOLLOWED_ROWS: 2,
    /** The longest step the spring takes (a stalled frame must not fling the view)… */
    MAX_DT_S: 0.05,
    /** …and a gap this long (a pause, the view held elsewhere) starts the view from rest. */
    REST_AFTER_MS: 250,
});

/** @param {number} value @param {number} min @param {number} max */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * The first and last rows of a piece's shape that hold a cell (0-based, inside the shape).
 * @param {unknown} shape
 * @returns {{first: number, last: number}}
 */
export function filledRowSpan(shape) {
    if (!Array.isArray(shape) || shape.length === 0) return { first: 0, last: 0 };
    let first = -1;
    let last = -1;
    for (let r = 0; r < shape.length; r += 1) {
        const row = shape[r];
        if (Array.isArray(row) && row.some(Boolean)) {
            if (first < 0) first = r;
            last = r;
        }
    }
    return first < 0 ? { first: 0, last: shape.length - 1 } : { first, last };
}

/**
 * The view's top row for the board as it stands: the tower's top TOWER_TOP_SHARE down the view
 * (an empty well rests on its floor), lowered to follow a piece that has gone deeper and to show
 * where it will land.
 *
 * @param {{
 *   boardRows: number,
 *   visibleRows: number,
 *   highestRow: number,
 *   piece?: {y: number, shape?: unknown}|null,
 *   landingY?: number|null,
 * }} board highestRow is the first occupied row (boardRows for an empty board); landingY is the
 *   row the piece would lock at (its ghost)
 * @returns {number}
 */
export function playFramingTop({
    boardRows, visibleRows, highestRow, piece = null, landingY = null,
}) {
    const rows = visibleRows > 0 ? visibleRows : 20;
    const maxTop = Math.max(0, boardRows - rows);
    let top = highestRow >= boardRows
        ? maxTop
        : highestRow - Math.floor(rows * PLAY_CAMERA.TOWER_TOP_SHARE);
    if (piece && Number.isFinite(piece.y)) {
        const span = filledRowSpan(piece.shape);
        let wanted = piece.y + span.first - Math.round(rows * PLAY_CAMERA.PIECE_LEAD_SHARE);
        if (Number.isFinite(landingY)) {
            const landingBottom = /** @type {number} */ (landingY) + span.last;
            const reveal = landingBottom + 1 + PLAY_CAMERA.LANDING_MARGIN_ROWS - rows;
            wanted = Math.min(wanted, reveal);
        }
        top = Math.max(top, wanted);
    }
    return clamp(top, 0, maxTop);
}

/**
 * @typedef {Object} PlayCameraBeat
 * @property {'lock'|'landing'|'clear'} kind
 * @property {number} top the framing the beat holds
 * @property {number} first the first row it shows (a piece's or a clear's)
 * @property {number} last its last row
 * @property {number} startedAt
 * @property {number|null} arrivedAt
 * @property {number} holdMs
 * @property {number|null} settledAt a clear's cascade finished (clears hold until then)
 */

const pageClock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class InfinityPlayCamera {
    /** @param {{reducedMotion?: () => boolean, clock?: () => number}} [options] */
    constructor({ reducedMotion = () => false, clock = pageClock } = {}) {
        this.reducedMotion = reducedMotion;
        this.clock = clock;
        /** rows a second, down the tower */
        this.velocity = 0;
        /** @type {PlayCameraBeat|null} */
        this.beat = null;
        /** @type {number|null} */
        this._lastNow = null;
    }

    /** Forget motion and beats: something else moved the view (looking around, a new run). */
    reset() {
        this.velocity = 0;
        this.beat = null;
        this._lastNow = null;
    }

    /** Rows were added above the board: a framing held in rows moves down with everything else. */
    shift(rows) {
        if (!this.beat || !Number.isFinite(rows)) return;
        this.beat.top += rows;
        this.beat.first += rows;
        this.beat.last += rows;
    }

    /**
     * A piece locked.
     * @param {{now?: number, pieceTop: number, pieceBottom: number, viewTop: number,
     *   visibleRows: number, home: number, pieceHome: number, maxTop: number}} lock
     *   pieceTop/pieceBottom are its first and last occupied rows; home is the framing once it
     *   has locked, pieceHome the framing that followed it (home lowered for the piece)
     */
    onLock({
        now = this.clock(), pieceTop, pieceBottom, viewTop, visibleRows, home, pieceHome, maxTop,
    }) {
        if (this.reducedMotion()) return;
        const seen = (top) => pieceTop >= top && pieceBottom < top + visibleRows;
        if (!seen(viewTop) && !seen(home)) {
            const center = (pieceTop + pieceBottom + 1) / 2;
            const framing = center - visibleRows * PLAY_CAMERA.ACTION_SHARE;
            this._begin('landing', framing, pieceTop, pieceBottom, maxTop, now, PLAY_CAMERA.LANDING_HOLD_MS);
        } else if (pieceHome - home > PLAY_CAMERA.FOLLOWED_ROWS && viewTop - home > PLAY_CAMERA.FOLLOWED_ROWS) {
            // The view had followed this piece down (not merely passed it on its way home).
            this._begin('lock', viewTop, pieceTop, pieceBottom, maxTop, now, PLAY_CAMERA.LOCK_HOLD_MS);
            if (this.beat) this.beat.arrivedAt = now;
        }
    }

    /**
     * Rows flashed for a clear (one cascade wave).
     * @param {{now?: number, rows: number[], viewTop: number, visibleRows: number, home: number,
     *   maxTop: number}} clear home is the framing the view is going to anyway
     */
    onClear({
        now = this.clock(), rows, viewTop, visibleRows, home, maxTop,
    }) {
        if (this.reducedMotion() || !Array.isArray(rows) || rows.length === 0) return;
        const first = Math.min(...rows);
        const last = Math.max(...rows);
        const seen = (top) => first >= top && last < top + visibleRows;
        if (this.beat?.kind === 'clear' ? seen(this.beat.top) : seen(viewTop) || seen(home)) {
            // In sight. A clear beat already holding the view keeps watching its cascade.
            if (this.beat?.kind === 'clear') this.beat.settledAt = null;
            return;
        }
        const framing = (first + last + 1) / 2 - visibleRows * PLAY_CAMERA.ACTION_SHARE;
        this._begin('clear', framing, first, last, maxTop, now, PLAY_CAMERA.CLEAR_HOLD_MS);
    }

    /** The cascade that began with a lock has settled. @param {number} [now] */
    onCascadeComplete(now = this.clock()) {
        if (this.beat?.kind === 'clear') this.beat.settledAt = now;
    }

    /** The player moved, turned or dropped the piece in hand: a beat yields to them. */
    onPlayerInput() {
        if (this.beat && this.beat.kind !== 'clear') this.beat = null;
        else if (this.beat?.kind === 'clear' && this.beat.settledAt !== null) this.beat = null;
    }

    /**
     * Advance the view one frame.
     * @param {{now?: number, top: number, home: number, maxTop: number, visibleRows: number}} frame
     *   top is where the view is now; home is the framing (playFramingTop) for this frame
     * @returns {number} the view's new top row
     */
    step({
        now = this.clock(), top, home, maxTop, visibleRows,
    }) {
        const gap = this._lastNow === null ? 0 : now - this._lastNow;
        // A long gap is a pause or something else holding the view: start from rest.
        if (gap > PLAY_CAMERA.REST_AFTER_MS) this.velocity = 0;
        const dt = clamp(gap / 1000, 0, PLAY_CAMERA.MAX_DT_S);
        this._lastNow = now;
        const target = clamp(this._target(now, top, home, visibleRows), 0, maxTop);
        const distance = Math.abs(target - top);
        if (this.reducedMotion() && distance > visibleRows) {
            this.velocity = 0;
            return target;
        }
        /** @type {number} */
        let omega = PLAY_CAMERA.OMEGA_FOLLOW;
        if (this.beat) omega = PLAY_CAMERA.OMEGA_DIVE;
        else if (distance > PLAY_CAMERA.TRAVEL_ROWS) omega = PLAY_CAMERA.OMEGA_HOME;
        const next = springStep(top, this.velocity, target, omega, dt);
        this.velocity = next.v;
        return clamp(next.x, 0, maxTop);
    }

    /** @private */
    _begin(kind, top, first, last, maxTop, now, holdMs) {
        this.beat = {
            kind,
            top: clamp(Math.round(top), 0, maxTop),
            first,
            last,
            startedAt: now,
            arrivedAt: null,
            holdMs,
            settledAt: null,
        };
    }

    /** The framing to aim for this frame: a beat's while it holds, home otherwise. @private */
    _target(now, top, home, visibleRows) {
        const { beat } = this;
        if (!beat) return home;
        if (beat.arrivedAt === null) {
            const margin = PLAY_CAMERA.ARRIVE_MARGIN_ROWS;
            const shown = beat.first >= top + margin && beat.last <= top + visibleRows - 1 - margin;
            // Rows taller than the view count once the view is nearly on its framing.
            if (shown || Math.abs(top - beat.top) < 1) beat.arrivedAt = now;
        }
        const waiting = beat.kind === 'clear' && beat.settledAt === null;
        // A clear holds from when the view is there and its cascade has settled, whichever is later.
        let holdFrom = beat.arrivedAt;
        if (beat.kind === 'clear') {
            holdFrom = waiting || beat.arrivedAt === null ? null : Math.max(beat.settledAt, beat.arrivedAt);
        }
        const held = holdFrom !== null && now - holdFrom >= beat.holdMs;
        const gaveUp = !waiting && beat.arrivedAt === null && now - beat.startedAt >= PLAY_CAMERA.BEAT_GIVE_UP_MS;
        if (held || gaveUp) {
            this.beat = null;
            return home;
        }
        return beat.top;
    }
}
