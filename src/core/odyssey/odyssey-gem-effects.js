/**
 * What a gem does to a live well. Tide and Second Breath rewrite the locked pieces through
 * the same restore boundary replays use, so the grid, caches and the Infinity camera stay in
 * step; Still Air only touches the fall pace or the deadline. None of it counts toward goals.
 */
import { markBoardDirty, rebuildBoardGridFromPieces } from '../board.js';
import { restoreBoardState } from '../game.js';
import { DEMO_FIXED_SIMULATION_CLOCK } from '../demo/DemoRecorder.js';
import {
    ODYSSEY_STILL_AIR_EXTENSION_SECONDS, ODYSSEY_STILL_AIR_MS, ODYSSEY_STILL_AIR_SLOWEST_MS, ODYSSEY_TIDE_ROWS,
    canUseOdysseyGem, describeOdysseyGemRun,
} from './odyssey-gems.js';

/**
 * Remove the lowest `rows` rows of a well and settle everything above by the same distance.
 * Pure: returns new pieces with fresh shape matrices. A stack always rests on the floor, so
 * every surviving cell keeps its support and nothing is left floating.
 * @returns {{ pieces: object[], removed: number }} the settled pieces and the cells swept away
 */
export function sweepLowestRows(lockedPieces, rows, floorRow) {
    const cutFrom = floorRow - rows + 1;
    let removed = 0;
    const pieces = [];
    for (const piece of lockedPieces || []) {
        let remaining = 0;
        const shape = piece.shape.map((row) => row.slice());
        for (let dy = 0; dy < shape.length; dy++) {
            const swept = Math.floor(piece.y + dy) >= cutFrom;
            for (let dx = 0; dx < shape[dy].length; dx++) {
                if (!shape[dy][dx]) continue;
                if (swept) {
                    shape[dy][dx] = 0;
                    removed++;
                } else {
                    remaining++;
                }
            }
        }
        if (remaining > 0) pieces.push({ ...piece, shape, y: piece.y + rows });
    }
    return { pieces, removed };
}

function replaceWell(gameState, pieces) {
    const grid = rebuildBoardGridFromPieces(pieces, gameState.boardGrid.map((row) => Array(row.length).fill(null)));
    restoreBoardState(gameState, { grid, lockedPieces: pieces }, {
        adoptBoard: true, keepCurrentPiece: true, mirrorGrid: Array.isArray(gameState.grid),
    });
    markBoardDirty(gameState);
}

/** Tide: the lowest rows wash away; refused mid-cascade, after a top-out, or over an empty floor. */
export function applyOdysseyTide(gameState, rows = ODYSSEY_TIDE_ROWS) {
    if (!gameState?.boardGrid?.length || gameState.isProcessingPhysics || gameState.isGameOver) return false;
    const { pieces, removed } = sweepLowestRows(gameState.lockedPieces, rows, gameState.boardGrid.length - 1);
    if (removed === 0) return false;
    replaceWell(gameState, pieces);
    return true;
}

/** Still Air: thirty more seconds on a deadline orb, otherwise twenty seconds of the slowest fall. */
export function beginOdysseyStillAir(session, nowMs) {
    const run = session?.gems;
    const { gameState, levelConfig } = session || {};
    if (!run || !gameState) return null;
    if (levelConfig?.victory?.failure?.type === 'time') {
        session.hybridEngine?.extendTimeLimit?.(ODYSSEY_STILL_AIR_EXTENSION_SECONDS);
        run.stillAir = { kind: 'extension', seconds: ODYSSEY_STILL_AIR_EXTENSION_SECONDS, until: null };
        return run.stillAir;
    }
    const base = Math.max(1, Number(gameState.dropInterval) || 1000);
    const slow = Math.max(base, ODYSSEY_STILL_AIR_SLOWEST_MS);
    run.stillAir = {
        kind: 'slow', until: nowMs + ODYSSEY_STILL_AIR_MS, base, slow,
    };
    gameState.dropInterval = slow;
    return run.stillAir;
}

/**
 * Keep Still Air's pace through level-ups and duel rounds, and restore the pace when it ends.
 * @returns {number|null} milliseconds left, 0 when it just ended, null when none is running
 */
export function tickOdysseyStillAir(session, nowMs) {
    const air = session?.gems?.stillAir;
    if (!air || air.kind !== 'slow') return null;
    const { gameState } = session;
    if (nowMs >= air.until) {
        if (gameState.dropInterval === air.slow) gameState.dropInterval = air.base;
        session.gems.stillAir = null;
        return 0;
    }
    if (gameState.dropInterval !== air.slow) {
        // A level-up or a new duel round set a fresh pace underneath; slow that one instead.
        air.base = gameState.dropInterval;
        air.slow = Math.max(air.base, ODYSSEY_STILL_AIR_SLOWEST_MS);
        gameState.dropInterval = air.slow;
    }
    return air.until - nowMs;
}

/** Second Breath: an armed top-out empties the well and the orb goes on; once per attempt. */
export function reviveOdysseyWell(session, { spawn } = {}) {
    const run = session?.gems;
    const { gameState } = session || {};
    if (!run?.secondBreathArmed || run.secondBreathUsed || !gameState?.boardGrid?.length) return false;
    run.secondBreathArmed = false;
    run.secondBreathUsed = true;
    replaceWell(gameState, []);
    gameState.isGameOver = false;
    gameState.isAlive = true;
    gameState.dropCounter = 0;
    if (!gameState.currentPiece) spawn?.();
    return true;
}

/** The attempt's clock in milliseconds, on whichever simulation clock it runs. */
export function odysseyLevelNowMs(mode, session = mode?._activeLevelSession) {
    if (!session) return 0;
    if (session.simulationClock === DEMO_FIXED_SIMULATION_CLOCK) return Number(session.gameState?.simTimeMs) || 0;
    return Number(mode?._elapsedLevelMs?.()) || 0;
}

/** Advance Still Air and show the tray's current state. */
export function syncOdysseyGemHud(mode, session = mode?._activeLevelSession, nowMs = odysseyLevelNowMs(mode, session)) {
    if (!session?.gems) return;
    tickOdysseyStillAir(session, nowMs);
    mode.odysseyHUD?.updateGems?.(describeOdysseyGemRun(session.gems, mode.odysseyState?.getGemCount?.() ?? 0, nowMs));
}

/**
 * Spend a gem on an ability during the current orb.
 * @returns {boolean} whether a gem was spent
 */
export function activateOdysseyGem(mode, abilityId) {
    const session = mode?._activeLevelSession;
    if (!mode?._isLevelSessionActive?.(session) || !session.gems) return false;
    const { gameState } = session;
    if (mode.isPaused || mode.levelCompleting || gameState.isPaused || gameState.isGameOver || gameState.victoryLapActive) {
        return false;
    }
    if (!canUseOdysseyGem(session.gems, abilityId, mode.odysseyState?.getGemCount?.())) return false;
    const nowMs = odysseyLevelNowMs(mode, session);
    const effects = mode._getBoardScene?.()?.sharedEffects;
    let applied = false;
    if (abilityId === 'tide') {
        applied = applyOdysseyTide(gameState);
        if (applied) effects?.playLineClearImpact?.(ODYSSEY_TIDE_ROWS, 1);
    } else if (abilityId === 'still-air') {
        const air = beginOdysseyStillAir(session, nowMs);
        applied = Boolean(air);
        if (air?.kind === 'extension') mode.odysseyHUD?.extendTimeLimit?.(air.seconds);
    } else if (abilityId === 'second-breath') {
        session.gems.secondBreathArmed = true;
        applied = true;
    }
    if (!applied) return false;
    session.gems.used.add(abilityId);
    session.gems.spent += 1;
    mode.odysseyState?.spendGem?.();
    mode.deps?.soundManager?.sfxPlayer?.playLevelUp?.();
    syncOdysseyGemHud(mode, session, nowMs);
    return true;
}

/** Intercept a top-out while Second Breath is armed. Shared by solo wells and the duel's human well. */
export function tryOdysseySecondBreath(mode, session) {
    if (!session?.gems?.secondBreathArmed || session.gems.secondBreathUsed) return false;
    const revived = reviveOdysseyWell(session, { spawn: () => session.physicsCallbacks?.spawnPiece?.() });
    if (!revived) return false;
    mode._getBoardScene?.()?.sharedEffects?.playPerfectClear?.(0);
    mode.deps?.soundManager?.sfxPlayer?.playPerfectClear?.();
    syncOdysseyGemHud(mode, session);
    console.log('[Odyssey] Second Breath: the well empties and the orb goes on');
    return true;
}
