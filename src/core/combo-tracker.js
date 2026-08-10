// @ts-check
/**
 * @fileoverview ComboTracker — the true consecutive-clear combo counter.
 *
 * WHY THIS EXISTS
 * The physics engine's `triggerCombo` callback carries the CASCADE depth, not a
 * combo: it fires mid-lock, once per cascade wave, and only when a single lock
 * chains 2+ waves. That schedule (order + payload) is a pinned contract —
 * ADR-0011 and tests/unit/physics-callback-schedule.test.js certify it for 60+
 * theme/juice consumers — so the real combo cannot be threaded through it.
 *
 * A combo in the Tetris sense is a property of the LOCK sequence, not of one
 * lock's cascade: it counts consecutive locks that cleared at least one line and
 * resets on the first lock that clears nothing. Both facts are already observable
 * from callbacks every game mode wires today, so this tracker derives the counter
 * renderer-side without touching physics.
 *
 * `gameState.comboCount` is NOT this number — it only advances when
 * `comboMultiplierEnabled` is set (an Odyssey scoring modifier) and is unmaintained
 * in shared single-player physics.
 *
 * USAGE (per player board, per run):
 *   tracker.notePieceLocked();   // from onPieceLock / PIECE_LOCK, every lock
 *   tracker.noteLineClear();     // from onLineClear / LINE_CLEAR, every wave
 *
 * Waves are de-duplicated by the lock boundary rather than by a cascade index, so
 * the same code works for the local physics callbacks (which know the cascade
 * count) and for the online-MP wire events (which do not).
 *
 * Ordering note: `onLineClear` fires before `triggerFlash` in the pinned schedule,
 * so the counter is already correct when the line-clear visuals read it.
 */

/**
 * Tracks consecutive clearing locks.
 */
export class ComboTracker {
    constructor() {
        /** @type {number} Consecutive locks that cleared lines (1 = first clear of a chain). */
        this.combo = 0;
        /** @type {boolean} Has the lock currently being resolved cleared anything yet? */
        this._lockCleared = false;
        /** @type {boolean} Did the most recent noteLineClear() advance the counter? */
        this._advancedThisWave = false;
    }

    /**
     * Call on every piece lock, before physics resolves it.
     *
     * The reset is applied here rather than at the end of a non-clearing lock
     * because physics emits no "resolved with no clears" callback — a lock that
     * clears nothing is simply silent. Deferring the reset to the next lock is
     * still correct for every consumer: the counter is only read during a clear,
     * and this runs before that lock's clear callbacks.
     *
     * @returns {number} The combo carried into this lock (0 once a chain broke).
     */
    notePieceLocked() {
        if (!this._lockCleared) {
            this.combo = 0;
        }
        this._lockCleared = false;
        this._advancedThisWave = false;
        return this.combo;
    }

    /**
     * Call on every line-clear wave.
     *
     * Only the FIRST clearing wave of a lock advances the combo — the later waves
     * are the same lock cascading, which is depth, not combo. The lock boundary
     * (notePieceLocked) is what re-arms it, so no cascade index is needed.
     *
     * @returns {number} The combo after this wave (1 = first clear of a chain).
     */
    noteLineClear() {
        this._advancedThisWave = !this._lockCleared;
        if (this._advancedThisWave) {
            this._lockCleared = true;
            this.combo += 1;
        }
        return this.combo;
    }

    /**
     * Whether the wave just recorded should surface the "Nx COMBO!" popup.
     * A lone clear is not a combo, and a cascade must not re-announce per wave.
     * @returns {boolean}
     */
    shouldAnnounce() {
        return this._advancedThisWave && this.combo >= 2;
    }

    /** Reset to a fresh run (new game, retry, board clear). */
    reset() {
        this.combo = 0;
        this._lockCleared = false;
        this._advancedThisWave = false;
    }
}

/**
 * Wire a lock into the combo state and push the result to the board's effects.
 *
 * Call from the lock callback unconditionally — this is bookkeeping, not
 * decoration. Gating it behind a visual setting is what previously left the
 * effect layer's combo state stuck at its last value for the rest of a run.
 *
 * @param {ComboTracker|null|undefined} tracker
 * @param {Object|null|undefined} boardScene - Phaser board scene (may be absent).
 * @returns {number} The combo carried into this lock.
 */
export function noteLockForCombo(tracker, boardScene) {
    if (!tracker) return 0;
    const combo = tracker.notePieceLocked();
    boardScene?.sharedEffects?.setComboCount?.(combo);
    return combo;
}

/**
 * Advance the combo for one clear wave, sync the effect layer, and surface the
 * popup when this is a genuine 2x+ combo.
 *
 * Must run before the wave's flash/impact visuals so the particle tint and
 * intensity multiplier see the current value — the pinned physics schedule puts
 * onLineClear ahead of triggerFlash, which satisfies that.
 *
 * @param {ComboTracker|null|undefined} tracker
 * @param {Object|null|undefined} boardScene
 * @param {{popupEnabled?: boolean}} [options]
 * @returns {number} The combo after this wave.
 */
export function announceCombo(tracker, boardScene, options = {}) {
    if (!tracker) return 0;
    const combo = tracker.noteLineClear();
    boardScene?.sharedEffects?.setComboCount?.(combo);
    if (options.popupEnabled !== false && tracker.shouldAnnounce()) {
        boardScene?.showComboPopup?.(combo);
    }
    return combo;
}

export default ComboTracker;
