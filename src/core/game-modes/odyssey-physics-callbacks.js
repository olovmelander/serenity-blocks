import { spawnPiece } from '../game.js';
import {
    emitB2B,
    emitCombo,
    emitLineClear,
    emitPerfectClear,
    emitPieceLock,
    emitTSpin,
    emitHardDrop,
    emitLevelUp,
} from '../../events/gameplay-events.js';
import { DEMO_FIXED_SIMULATION_CLOCK } from '../demo/DemoRecorder.js';
import {
    applyFixedHardDropHitStop,
    applyFixedLineImpactHitStop,
    applyFixedPerfectClearHitStop,
} from '../fixed-hit-stop-policy.js';
import { fenceOdysseyPhysicsCallbacks } from '../odyssey/odyssey-level-session.js';
import { ComboTracker } from '../combo-tracker.js';
import { createBoardEffectHandlers } from './board-effect-callbacks.js';

export function prefersOdysseyReducedMotion(
    mode,
    settings = mode.deps.settingsManager?.get() || {},
) {
    return settings.reducedMotion || (typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** Build callbacks owned by one exact Odyssey attempt. */
export function createOdysseyPhysicsCallbacks(mode, session) {
    const {
        gameState, hybridEngine, levelId, simulationClock,
    } = session;
    const usesFixedTiming = simulationClock === DEMO_FIXED_SIMULATION_CLOCK;
    // Shared four-beat visual wiring — identical to local MP's and single
    // player's, injected INSIDE baseCallbacks so the session fence and the
    // hybrid engine's victory-metric wrappers still apply. One attempt = one
    // combo chain: the per-session tracker keeps tint state honest. The factory
    // reads no settings, which preserves the fixed-tick determinism guard.
    const effectHandlers = createBoardEffectHandlers({
        getScene: () => mode._getBoardScene?.(),
        getJuice: () => mode.boardJuice,
        comboTracker: new ComboTracker(),
    });
    const baseCallbacks = {
        onMove: () => mode.deps.soundManager?.sfxPlayer?.playMove(),
        onRotate: () => mode.deps.soundManager?.sfxPlayer?.playRotate(),
        onLineClear: (lineCount, ...rest) => {
            const clearedRows = Array.isArray(rest[2]) ? rest[2] : [];
            const cascadeCount = rest[3] ?? 1;
            mode.deps.soundManager?.sfxPlayer?.playLineClear(cascadeCount);
            emitLineClear({
                lineCount,
                clearedRows,
                cascadeCount,
                source: 'odyssey',
                levelId,
            });
        },
        onTSpin: (lineCount) => {
            emitTSpin({ lineCount, source: 'odyssey' });
            mode.deps.soundManager?.sfxPlayer?.playTSpin?.();
            mode._getBoardScene?.()?.sharedEffects?.playTSpinEffect?.(lineCount);
        },
        onB2B: () => {
            emitB2B({ source: 'odyssey' });
            mode.deps.soundManager?.sfxPlayer?.playB2B?.();
            mode._getBoardScene?.()?.sharedEffects?.playB2BChange?.(true);
        },
        onLevelUp: (level) => {
            emitLevelUp({ level, source: 'odyssey', levelId });
            mode.deps.soundManager?.sfxPlayer?.playLevelUp();
            mode._getBoardScene?.()?.sharedEffects?.playLevelUp?.(level);
        },
        onHardDrop: (dropData) => {
            emitHardDrop({
                piece: dropData?.piece || null,
                startY: dropData?.startY,
                endY: dropData?.endY,
                source: 'odyssey',
                levelId,
            });
            if (usesFixedTiming) {
                applyFixedHardDropHitStop(gameState);
            } else if (!prefersOdysseyReducedMotion(mode)) {
                gameState.hitStopRemaining = Math.max(gameState.hitStopRemaining || 0, 30);
            }
            mode.deps.soundManager?.sfxPlayer?.playDrop();
            mode._getBoardScene()?.playHardDropEffect?.(dropData);
            mode.boardJuice?.dip(3);
            mode.boardJuice?.bounce();
        },
        // Cascade signal — the payload is cascade DEPTH, kept as-is for themes.
        // The board popup is driven from onLineClear; the cascade's own board
        // feedback is triggerCascadeWave below.
        // Combo popup, local-MP semantics: the number is cascade depth, per wave.
        triggerCombo: (comboCount) => {
            effectHandlers.comboBeat(comboCount);
            emitCombo({ comboCount, source: 'odyssey', levelId });
        },
        // Mega-only inside SharedEffects; silent below 10.
        triggerCascadeWave: (cascadeCount) => {
            effectHandlers.cascadeWaveBeat(cascadeCount);
        },
        // No settle visual — parity with local MP. Key kept for callback shape.
        onCascadeComplete: () => {},
        triggerFlash: (fullLines) => {
            effectHandlers.clearFlashBeat(fullLines);
        },
        onLineClearImpact: (lineCount) => {
            // Timing stays at the call site (fixed-tick lane reads no settings).
            if (usesFixedTiming) {
                applyFixedLineImpactHitStop(gameState, lineCount);
            } else if (!prefersOdysseyReducedMotion(mode)) {
                const tier = mode._getBoardScene()?.sharedEffects?.getClearTier?.(lineCount);
                const hitStop = tier?.hitStop || (lineCount >= 4 ? 70 : 0);
                if (hitStop > 0) gameState.hitStopRemaining = hitStop;
            }
            effectHandlers.clearImpactBeat(lineCount);
        },
        // Parity with local MP: no background pulse.
        triggerBackgroundPulse: () => {},
        onPieceLock: (piece) => {
            emitPieceLock({ piece });
            effectHandlers.lockBeat(piece);
        },
        onPerfectClear: (depth, perfectClearBonus) => {
            if (usesFixedTiming) {
                applyFixedPerfectClearHitStop(gameState);
            } else if (!prefersOdysseyReducedMotion(mode)) {
                gameState.hitStopRemaining = 110;
            }
            emitPerfectClear({ depth, perfectClearBonus, source: 'odyssey' });
            mode.deps.soundManager?.sfxPlayer?.playPerfectClear?.();
            mode._getBoardScene()?.sharedEffects?.playPerfectClear?.(depth);
            mode.boardJuice?.dip(2);
            mode.boardJuice?.bounce();
        },
        spawnPiece: () => {
            spawnPiece(
                gameState,
                () => mode._refreshNextQueue(),
                () => mode._handleGameOver(session),
            );
        },
    };
    const fencedCallbacks = fenceOdysseyPhysicsCallbacks(
        baseCallbacks,
        () => mode._isLevelSessionActive(session),
    );
    return hybridEngine.buildPhysicsCallbacks(fencedCallbacks);
}
