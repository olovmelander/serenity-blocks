// @ts-check
/**
 * @fileoverview Shared board-effect beats — ONE wiring for the four frequent
 * moments (lock, clear, combo, cascade) across every game mode.
 *
 * WHY THIS EXISTS
 * Local multiplayer and single player historically wired these beats in two
 * unrelated places (main.js getMultiplayerPhysicsCallbacks vs each mode's
 * _getPhysicsCallbacks), and they drifted: single player accumulated extra
 * layers (cascade rings/banners, settle beats, full-viewport background pulses,
 * heavier board juice) that local MP never had — and players preferred MP's
 * leaner, smoother read. Meanwhile fixes landed in dead code
 * (LocalMultiplayerMode's own builder is shadowed by the main.js injection).
 * One factory ends the drift: local MP's read is the canonical baseline.
 *
 * CONTRACT
 * - Visual-only. NO settings reads (SharedEffects gates internally via
 *   _effectEnabled, which keeps Odyssey's fixed-tick determinism guard intact:
 *   the timing path consults no settings). NO hit-stop writes, NO theme-event
 *   emits, NO SFX, NO stats, NO session fencing — those stay at each call site.
 * - Tolerates a missing scene/juice at any moment (mode teardown, headless).
 * - The injected ComboTracker owns particle-tint state ONLY. The combo popup's
 *   number is CASCADE DEPTH (fired per cascade wave — local MP's frequent,
 *   preferred behaviour); the tracker keeps tints escalating on true
 *   consecutive-clear combos and resetting when a chain breaks.
 */

import { ComboTracker, noteLockForCombo, announceCombo } from '../combo-tracker.js';

/**
 * @param {Object} deps
 * @param {() => (Object|null|undefined)} deps.getScene - resolves the target
 *   board scene per call (modes swap scenes across sessions; resolve late).
 * @param {(() => (Object|null|undefined))} [deps.getJuice] - resolves the
 *   BoardJuice instance, if the mode has one.
 * @param {ComboTracker} [deps.comboTracker] - injected for mode-owned lifecycle
 *   (reset per session/attempt); created internally if omitted.
 */
export function createBoardEffectHandlers({ getScene, getJuice, comboTracker }) {
    const tracker = comboTracker || new ComboTracker();
    const juiceOf = () => (typeof getJuice === 'function' ? getJuice() : null);

    return {
        /** Exposed so call sites can reset per attempt/session/round. */
        comboTracker: tracker,

        /**
         * Piece lock: tint bookkeeping (every lock, ungated — a lock that clears
         * nothing is what breaks a chain), ripple + stamp, gentle juice.
         * @param {Object} piece
         */
        lockBeat(piece) {
            const scene = getScene();
            noteLockForCombo(tracker, scene);
            scene?.createPieceLockRipple?.(piece); // internal pieceLockRipple gate
            const juice = juiceOf();
            juice?.dip?.(1);
            juice?.pulse?.(1.005);
        },

        /**
         * Line-clear flash: stripes, per-cell debris, spark fountain.
         * @param {Array<number>} fullLines
         */
        clearFlashBeat(fullLines) {
            getScene()?.triggerLineClearFlash?.(fullLines); // internal lineClearEffects gate
        },

        /**
         * Line-clear impact: tint escalation for THIS wave, shake/zoom via the
         * scene, juice pulse scaled by line count. In the pinned physics
         * schedule onLineClearImpact fires before triggerFlash, so the tint set
         * here is already current when the flash draws.
         * @param {number} lineCount
         */
        clearImpactBeat(lineCount) {
            const scene = getScene();
            announceCombo(tracker, scene, { popupEnabled: false }); // tint sync ONLY
            scene?.playLineClearImpact?.(lineCount);
            juiceOf()?.pulse?.(1 + Math.min(lineCount, 4) * 0.004);
        },

        /**
         * Combo popup, local-MP semantics: the number is cascade depth, fired
         * once per cascade wave at depth >= 2 by physics. A deep cascade pops
         * 2x -> 3x -> 4x in succession — the frequent feedback players like.
         * @param {number} cascadeCount
         */
        comboBeat(cascadeCount) {
            getScene()?.showComboPopup?.(cascadeCount); // internal comboPopupEffect gate
        },

        /**
         * Cascade wave: silent below 10 (parity with local MP), mega celebration
         * at 10+ (primarily Infinity's moment).
         * @param {number} cascadeCount
         */
        cascadeWaveBeat(cascadeCount) {
            getScene()?.sharedEffects?.showCascadeWave?.(cascadeCount);
        },
    };
}

export default createBoardEffectHandlers;
