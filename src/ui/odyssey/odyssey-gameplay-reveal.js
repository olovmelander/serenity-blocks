/**
 * @fileoverview The orb's reveal: the gameplay surfaces (the well, the board canvas, the stats)
 * fade up as the portal gate opens. Extracted from OdysseyMode, which keeps thin
 * `_beginGameplayReveal` / `_showGameplayPlayableReveal` / `_finishGameplayUiReveal` wrappers;
 * `mode` is the active OdysseyMode.
 *
 * The surfaces start from the opacity they were painted at under the gate's cover
 * (odyssey-cover-paint.js), not from 0, where the compositor may drop the tiles it just
 * rastered. It reads as 0.
 */
import { prefersOdysseyReducedMotion } from '../../core/game-modes/odyssey-physics-callbacks.js';
import { COVER_PAINT_OPACITY } from './odyssey-cover-paint.js';

/**
 * Start the reveal: the surfaces fade and settle in, the playable step and the UI tail follow.
 * @param {object} mode the active OdysseyMode
 * @param {{fastReveal?: boolean, underPortalFlash?: boolean}} [options]
 * @returns {object} the reveal state (its playablePromise and uiPromise settle the steps)
 */
export function beginOdysseyGameplayReveal(mode, options = {}) {
    const fastReveal = !!(options.fastReveal ?? options.underPortalFlash);
    const reducedMotion = prefersOdysseyReducedMotion(mode, mode.deps.settingsManager?.get?.() || {});
    let revealDurationMs = fastReveal ? 420 : 1200;
    const revealDelayMs = fastReveal ? 0 : 50;
    let revealScaleStart = fastReveal ? 1.02 : 1.05;
    if (reducedMotion) { revealDurationMs = 180; revealScaleStart = 1; }
    const statsDelayMs = fastReveal ? 120 : 300;
    const statsTransitionMs = Math.max(220, revealDurationMs - 80);
    // From the painted opacity, not 0 (see the module note).
    const gameplayStartOpacity = COVER_PAINT_OPACITY;
    const phaserStartOpacity = COVER_PAINT_OPACITY;
    const backgroundStartOpacity = 0;
    const statsStartOpacity = COVER_PAINT_OPACITY;

    console.log('[Odyssey] Showing gameplay view with reveal animation');
    mode.closeOdysseyNavigator({ restoreBoardPreview: false });
    mode.setOdysseyNavigatorButtonVisible(false);

    const gameContainer = document.getElementById('single-player-container');
    const statsBar = document.querySelector('.single-player-stats-bar');
    const bgContainer = document.querySelector('.background-container');

    // Prepare for reveal (elements were hidden during background loading)
    if (gameContainer) {
        gameContainer.style.visibility = 'visible';
        gameContainer.style.opacity = String(gameplayStartOpacity);
        gameContainer.style.transform = `scale(${revealScaleStart})`;
        gameContainer.style.transition = `opacity ${revealDurationMs}ms ease-out, `
            + `transform ${revealDurationMs}ms ease-out`;
    }

    // Also reveal Phaser container
    const phaserContainer = document.getElementById('phaser-game-container');
    if (phaserContainer) {
        phaserContainer.style.visibility = 'visible';
        phaserContainer.style.opacity = String(phaserStartOpacity);
        phaserContainer.style.transition = `opacity ${revealDurationMs}ms ease-out`;
    }

    if (statsBar) {
        statsBar.style.visibility = 'visible';
        statsBar.style.opacity = String(statsStartOpacity);
        statsBar.style.setProperty('display', 'flex', 'important');
        statsBar.style.transition = `opacity ${statsTransitionMs}ms ease-out ${statsDelayMs}ms`;
    }

    if (bgContainer) {
        bgContainer.style.opacity = String(backgroundStartOpacity);
        bgContainer.style.transition = `opacity ${revealDurationMs}ms ease-out`;
    }

    const revealState = {
        bgContainer,
        fastReveal,
        gameContainer,
        phaserContainer,
        revealDelayMs,
        revealDurationMs,
        revealScaleStart,
        statsBar,
        statsDelayMs,
        statsTransitionMs,
    };

    revealState.playablePromise = mode._showGameplayPlayableReveal(revealState);
    revealState.uiPromise = mode._finishGameplayUiReveal(revealState);
    mode.gameplayRevealState = revealState;

    return revealState;
}

export async function showOdysseyGameplayPlayableReveal(mode, revealState) {
    if (!revealState) {
        return false;
    }

    await new Promise((resolve) => { setTimeout(resolve, revealState.revealDelayMs); });
    if (mode.gameplayRevealState !== revealState) {
        return false;
    }

    const {
        bgContainer,
        gameContainer,
        phaserContainer,
        statsBar,
    } = revealState;

    if (bgContainer) {
        bgContainer.style.opacity = '1';
    }

    if (phaserContainer) {
        phaserContainer.style.opacity = '1';
    }

    if (gameContainer) {
        gameContainer.style.opacity = '1';
        gameContainer.style.transform = 'scale(1)';
    }

    if (statsBar) {
        statsBar.style.opacity = '1';
    }

    await new Promise((resolve) => { setTimeout(resolve, revealState.revealDurationMs); });
    if (mode.gameplayRevealState !== revealState) {
        return false;
    }

    if (gameContainer) {
        gameContainer.style.transition = '';
        gameContainer.style.transform = '';
        gameContainer.style.willChange = '';
    }
    if (phaserContainer) {
        phaserContainer.style.transition = '';
        phaserContainer.style.willChange = '';
    }
    if (bgContainer) {
        bgContainer.style.transition = '';
    }

    return true;
}

export async function finishOdysseyGameplayUiReveal(mode, revealState) {
    if (!revealState) {
        return false;
    }

    const playableShown = await revealState.playablePromise;
    if (!playableShown || mode.gameplayRevealState !== revealState) {
        return false;
    }

    const statsTailMs = Math.max(
        0,
        (revealState.statsDelayMs + revealState.statsTransitionMs) - revealState.revealDurationMs,
    );
    if (statsTailMs > 0) {
        await new Promise((resolve) => { setTimeout(resolve, statsTailMs); });
        if (mode.gameplayRevealState !== revealState) {
            return false;
        }
    }

    if (revealState.statsBar) {
        revealState.statsBar.style.transition = '';
        revealState.statsBar.style.willChange = '';
    }

    return true;
}
