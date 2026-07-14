import { spawnPiece } from '../game.js';
import {
    emitB2B,
    emitCombo,
    emitLineClear,
    emitPerfectClear,
    emitPieceLock,
    emitTSpin,
} from '../../events/gameplay-events.js';
import { DEMO_FIXED_SIMULATION_CLOCK } from '../demo/DemoRecorder.js';
import {
    applyFixedHardDropHitStop,
    applyFixedLineImpactHitStop,
    applyFixedPerfectClearHitStop,
} from '../fixed-hit-stop-policy.js';
import { fenceOdysseyPhysicsCallbacks } from '../odyssey/odyssey-level-session.js';

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
        onLevelUp: () => mode.deps.soundManager?.sfxPlayer?.playLevelUp(),
        onHardDrop: (dropData) => {
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
        triggerCombo: (comboCount) => {
            emitCombo({ comboCount, source: 'odyssey', levelId });
            mode._getBoardScene()?.showComboPopup?.(comboCount);
        },
        triggerCascadeWave: (cascadeCount) => {
            mode._getBoardScene()?.sharedEffects?.showCascadeWave?.(cascadeCount);
        },
        triggerFlash: (fullLines) => {
            mode._getBoardScene()?.triggerLineClearFlash?.(fullLines);
        },
        onLineClearImpact: (lineCount, cascadeCount) => {
            const boardScene = mode._getBoardScene();
            if (usesFixedTiming) {
                applyFixedLineImpactHitStop(gameState, lineCount);
            } else if (!prefersOdysseyReducedMotion(mode)) {
                const tier = boardScene?.sharedEffects?.getClearTier?.(lineCount);
                const hitStop = tier?.hitStop || (lineCount >= 4 ? 70 : 0);
                if (hitStop > 0) gameState.hitStopRemaining = hitStop;
            }
            boardScene?.playLineClearImpact?.(lineCount, cascadeCount);
            mode.boardJuice?.pulse(1 + (Math.min(lineCount, 4) * 0.004));
        },
        triggerBackgroundPulse: (lineCount) => {
            mode._getBoardScene()?.triggerBackgroundPulse?.(lineCount);
        },
        onPieceLock: (piece) => {
            emitPieceLock({ piece });
            mode._getBoardScene()?.createPieceLockRipple?.(piece);
            mode.boardJuice?.dip(1);
            mode.boardJuice?.pulse(1.005);
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
