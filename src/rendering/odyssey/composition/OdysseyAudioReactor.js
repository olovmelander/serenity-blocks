/**
 * @fileoverview OdysseyAudioReactor — board-side audio signal source
 *
 * Part of the Odyssey AAA "Cosmic Ascent" overhaul (Phase 0 — spine scaffolding).
 * See docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §4.7.
 *
 * Thin wrapper around the shared SoundManager analyser (which owns the single
 * MediaElementSource and already throttles + smooths bass/mid/treble + beat).
 * Exposes a stable per-frame signal the OdysseyDirector consumes. Degrades to
 * zeros when no music is playing or no sound manager is available, so the board
 * always looks correct in silence.
 */

const ZERO_SNAPSHOT = Object.freeze({
    bassEnergy: 0,
    midEnergy: 0,
    trebleEnergy: 0,
    overallEnergy: 0,
    beatDetected: false,
});

export class OdysseyAudioReactor {
    /**
     * @param {object|null} soundManager - app SoundManager (provides getAudioAnalysis)
     */
    constructor(soundManager = null) {
        this.soundManager = soundManager || null;

        this.energy = 0;
        this.bass = 0;
        this.mid = 0;
        this.treble = 0;
        this.beat = false;
        this.sinceBeatMs = Infinity;

        // Reusable output object — never reallocated per frame.
        this._state = {
            energy: 0,
            bass: 0,
            mid: 0,
            treble: 0,
            beat: false,
            sinceBeatMs: Infinity,
            available: false,
        };
    }

    setSoundManager(soundManager) {
        this.soundManager = soundManager || null;
    }

    /**
     * Pull the latest analysis and update the smoothed board signal.
     * @param {number} deltaSeconds
     * @returns {object} the reusable state object (do not retain across frames)
     */
    update(deltaSeconds = 1 / 60) {
        const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;

        let snapshot = ZERO_SNAPSHOT;
        let available = false;
        if (this.soundManager && typeof this.soundManager.getAudioAnalysis === 'function') {
            try {
                snapshot = this.soundManager.getAudioAnalysis(dt) || ZERO_SNAPSHOT;
                available = true;
            } catch {
                snapshot = ZERO_SNAPSHOT;
                available = false;
            }
        }

        this.energy = clamp01(snapshot.overallEnergy);
        this.bass = clamp01(snapshot.bassEnergy);
        this.mid = clamp01(snapshot.midEnergy);
        this.treble = clamp01(snapshot.trebleEnergy);
        this.beat = snapshot.beatDetected === true;

        if (this.beat) {
            this.sinceBeatMs = 0;
        } else if (Number.isFinite(this.sinceBeatMs)) {
            this.sinceBeatMs += dt * 1000;
        }

        this._state.energy = this.energy;
        this._state.bass = this.bass;
        this._state.mid = this.mid;
        this._state.treble = this.treble;
        this._state.beat = this.beat;
        this._state.sinceBeatMs = this.sinceBeatMs;
        this._state.available = available;
        return this._state;
    }

    getState() {
        return this._state;
    }

    dispose() {
        // Does not own the analyser (SoundManager does); nothing to tear down.
        this.soundManager = null;
    }
}

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

export default OdysseyAudioReactor;
