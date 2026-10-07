import { spawnPiece } from '../game.js';
import { COLS, ROWS } from '../constants.js';
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

function presentationViewport(mode, gameState) {
    if (!gameState.isInfinityMode) return null;
    const camera = mode._getBoardScene?.()?.cameraSettings;
    const visibleRows = camera?.visibleRows || mode.visibleRows || ROWS;
    if (!(visibleRows > 0)) return null;
    let topRow = gameState.cameraRow ?? 0;
    if (Number.isFinite(camera?.currentTopRow)) topRow = camera.currentTopRow;
    if (Number.isFinite(camera?.activeTopRow)) topRow = camera.activeTopRow;
    return { topRow, visibleRows };
}

function pieceViewportOrigin(mode, gameState, piece) {
    const viewport = presentationViewport(mode, gameState);
    if (!viewport || !Array.isArray(piece?.shape)
        || !Number.isFinite(piece.x) || !Number.isFinite(piece.y)) return undefined;
    let sumRow = 0;
    let sumCol = 0;
    let filled = 0;
    piece.shape.forEach((row, rowIndex) => {
        if (!Array.isArray(row)) return;
        row.forEach((cell, colIndex) => {
            if (!cell) return;
            sumRow += rowIndex;
            sumCol += colIndex;
            filled++;
        });
    });
    if (!filled) return undefined;
    return {
        x: Math.max(0, Math.min(1, (piece.x + sumCol / filled + 0.5) / COLS)),
        y: Math.max(0, Math.min(1, (piece.y + sumRow / filled + 0.5 - viewport.topRow) / viewport.visibleRows)),
    };
}

function clearViewportOrigin(mode, gameState, clearedRows) {
    const viewport = presentationViewport(mode, gameState);
    const rows = clearedRows.filter(Number.isFinite);
    if (!viewport || !rows.length) return undefined;
    const meanRow = rows.reduce((sum, row) => sum + row, 0) / rows.length + 0.5;
    return {
        x: 0.5,
        y: Math.max(0, Math.min(1, (meanRow - viewport.topRow) / viewport.visibleRows)),
    };
}

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
                viewportOrigin: clearViewportOrigin(mode, gameState, clearedRows),
                source: 'odyssey',
                levelId,
            });
        },
        onTSpin: (lineCount) => {
            emitTSpin({ lineCount, source: 'odyssey', levelId });
            mode.deps.soundManager?.sfxPlayer?.playTSpin?.();
            mode._getBoardScene?.()?.sharedEffects?.playTSpinEffect?.(lineCount);
        },
        onB2B: () => {
            emitB2B({ source: 'odyssey', levelId });
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
                viewportOrigin: pieceViewportOrigin(mode, gameState, dropData?.piece),
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
            mode.boardJuice?.dip(4);
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
        onLineClearImpact: (lineCount, cascadeCount) => {
            // Timing stays at the call site (fixed-tick lane reads no settings).
            if (usesFixedTiming) {
                applyFixedLineImpactHitStop(gameState, lineCount);
            } else if (!prefersOdysseyReducedMotion(mode)) {
                const tier = mode._getBoardScene()?.sharedEffects?.getClearTier?.(lineCount);
                const hitStop = tier?.hitStop || (lineCount >= 4 ? 70 : 0);
                if (hitStop > 0) gameState.hitStopRemaining = hitStop;
            }
            effectHandlers.clearImpactBeat(lineCount, cascadeCount);
        },
        // Parity with local MP: no background pulse.
        triggerBackgroundPulse: () => {},
        onPieceLock: (piece) => {
            emitPieceLock({
                piece, viewportOrigin: pieceViewportOrigin(mode, gameState, piece), source: 'odyssey', levelId,
            });
            effectHandlers.lockBeat(piece);
        },
        onPerfectClear: (depth, perfectClearBonus) => {
            if (usesFixedTiming) {
                applyFixedPerfectClearHitStop(gameState);
            } else if (!prefersOdysseyReducedMotion(mode)) {
                gameState.hitStopRemaining = 110;
            }
            emitPerfectClear({
                depth, perfectClearBonus, source: 'odyssey', levelId,
            });
            mode.deps.soundManager?.sfxPlayer?.playPerfectClear?.();
            mode._getBoardScene()?.sharedEffects?.playPerfectClear?.(depth);
            mode.boardJuice?.dip(2);
            mode.boardJuice?.bounce();
        },
        // The match runtime owns insertion and death; these fenced hooks only
        // present those committed transitions on the human Phaser board.
        onGarbageApplied: (lineCount) => mode._getBoardScene?.()?.sharedEffects?.playGarbageArrival?.(lineCount),
        onTopOut: () => {
            const effects = mode._getBoardScene?.()?.sharedEffects;
            return session.duel ? effects?.playKnockout?.() : effects?.playGameOver?.();
        },
        onRoundWin: (options) => mode._getBoardScene?.()?.sharedEffects?.playRoundWin?.(options),
        onVictory: (options) => mode._getBoardScene?.()?.sharedEffects?.playVictory?.(options),
        spawnPiece: () => {
            spawnPiece(
                gameState,
                () => mode._refreshNextQueue(),
                () => mode._handleGameOver(session),
            );
        },
    };
    const trackedCallbacks = hybridEngine.buildPhysicsCallbacks(baseCallbacks);
    return fenceOdysseyPhysicsCallbacks(
        session.duel ? session.duel.wrapHumanCallbacks(trackedCallbacks) : trackedCallbacks,
        () => mode._isLevelSessionActive(session),
    );
}
