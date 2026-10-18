/**
 * What the held charms do to a live attempt. The goal, deadline, rubble and pace charms are
 * already written into the orb the engine was configured with (odyssey-charms.js); this is
 * the rest: the score charms paid after each lock's cascade settles, and Hearth, which once
 * an orb turns a top-out into an emptied well. Hearth's
 * well rewrite goes through the restore boundary replays use, so the grid, caches and the
 * Infinity camera stay in step.
 */
import { markBoardDirty, rebuildBoardGridFromPieces } from '../board.js';
import { restoreBoardState } from '../game.js';
import {
    AFTERGLOW_BONUS, KINDLE, SWELL, describeOdysseyCharms,
} from './odyssey-charms.js';

/** One attempt's charm bookkeeping. @param {readonly string[]} [charmIds] */
export function createOdysseyCharmRun(charmIds = []) {
    return {
        charms: [...(charmIds || [])],
        hearthUsed: false,
        lock: { waves: 0, maxLines: 0, scoreAtLock: 0 },
        paid: 0,
    };
}

/** What the HUD shows: the charms held, and which safety charm this attempt has spent. */
export function describeOdysseyCharmRun(run) {
    return {
        charms: describeOdysseyCharms(run?.charms || []).map((charm) => ({
            ...charm,
            spent: charm.id === 'hearth' && run?.hearthUsed === true,
        })),
    };
}

/** Kindle and Swell: a share of the lock's clear points, once its cascade has settled. */
export function payOdysseyScoreCharms(gameState, run) {
    if (!gameState || !run) return 0;
    const delta = (gameState.score || 0) - run.lock.scoreAtLock;
    if (delta <= 0) return 0;
    let share = 0;
    if (run.charms.includes('kindle') && run.lock.waves >= KINDLE.wavesAtLeast) share += KINDLE.bonusShare;
    if (run.charms.includes('swell') && run.lock.maxLines >= SWELL.linesAtLeast) share += SWELL.bonusShare;
    const bonus = share > 0 ? Math.round(delta * share) : 0;
    if (bonus > 0) {
        gameState.score += bonus;
        run.paid += bonus;
    }
    return bonus;
}

/**
 * Wrap an attempt's physics callbacks so the score charms are paid. A duel keeps its own
 * score and no charm touches it; an attempt without a score charm is left exactly as it was.
 */
export function wrapOdysseyCharmCallbacks(session, callbacks) {
    const run = session?.charmRun;
    const { gameState } = session || {};
    const scoring = run && gameState && !session.duel
        && ['kindle', 'swell', 'afterglow'].some((id) => run.charms.includes(id));
    if (!scoring) return callbacks;
    return {
        ...callbacks,
        onPieceLock: (piece, ...rest) => {
            run.lock = { waves: 0, maxLines: 0, scoreAtLock: gameState.score || 0 };
            callbacks.onPieceLock?.(piece, ...rest);
        },
        onLineClear: (lineCount, ...rest) => {
            run.lock.waves = Math.max(run.lock.waves, Number(rest[3]) || 1);
            run.lock.maxLines = Math.max(run.lock.maxLines, Number(lineCount) || 0);
            callbacks.onLineClear?.(lineCount, ...rest);
        },
        onPerfectClear: (depth, perfectClearBonus, ...rest) => {
            if (run.charms.includes('afterglow')) {
                gameState.score += AFTERGLOW_BONUS;
                run.paid += AFTERGLOW_BONUS;
            }
            callbacks.onPerfectClear?.(depth, perfectClearBonus, ...rest);
        },
        // After the cascade settles and before the next piece: the lock's charms are paid.
        spawnPiece: (...args) => {
            payOdysseyScoreCharms(gameState, run);
            return callbacks.spawnPiece?.(...args);
        },
    };
}

/** Empty a well and let play go on: the piece in hand stays, or a new one is dealt. */
export function reviveOdysseyWell(gameState, { spawn } = {}) {
    if (!gameState?.boardGrid?.length) return false;
    const grid = rebuildBoardGridFromPieces([], gameState.boardGrid.map((row) => Array(row.length).fill(null)));
    restoreBoardState(gameState, { grid, lockedPieces: [] }, {
        adoptBoard: true, keepCurrentPiece: true, mirrorGrid: Array.isArray(gameState.grid),
    });
    markBoardDirty(gameState);
    gameState.isGameOver = false;
    gameState.isAlive = true;
    gameState.dropCounter = 0;
    if (!gameState.currentPiece) spawn?.();
    return true;
}

/**
 * Hearth: once an orb, a top-out empties the well instead of ending the orb. Shared by solo
 * wells (the mode's game-over path) and the duel's human well (its top-out guard).
 * @returns {boolean} whether the top-out was absorbed
 */
export function tryOdysseyHearth(mode, session) {
    const run = session?.charmRun;
    if (!run?.charms?.includes('hearth') || run.hearthUsed) return false;
    const { gameState } = session;
    if (!mode?._isLevelSessionActive?.(session) || gameState?.victoryLapActive) return false;
    const revived = reviveOdysseyWell(gameState, { spawn: () => session.physicsCallbacks?.spawnPiece?.() });
    if (!revived) return false;
    run.hearthUsed = true;
    mode._getBoardScene?.()?.sharedEffects?.playPerfectClear?.(0);
    mode.deps?.soundManager?.sfxPlayer?.playPerfectClear?.();
    mode.odysseyHUD?.updateCharms?.(describeOdysseyCharmRun(run));
    console.log('[Odyssey] Hearth: the well empties and the orb goes on');
    return true;
}
