// Online versus: your own knock-out and drop-in screens on the main board. A knock-out darkens
// your board and raises the Out card; in survivor you then watch the whole roster until the
// round ends, in a free-for-all your board stays in front of you until a key brings you back
// (core/multiplayer/ffa/respawn.js). A drop-in joiner waits for the next round, or in a free-for-all for its key.
// Functions take the OnlineMultiplayerMode.

import {
    createOutCard, createStatusCard, showOutCard, showStatusCard,
} from './keystone/out-card.js';
import { RESPAWN_AFTER_MS } from '../core/multiplayer/versus-rules.js';

/**
 * Your knock-out on the main board: the stack goes dark, loses its colour and
 * comes apart (shared-effects.js playKnockout), then the Out card rises naming
 * who did it (ui/keystone/out-card.js).
 */
export function showDeathAnimation(mode, killerName = null) {
    const boardContainer = document.getElementById('online-main-board');
    if (!boardContainer) return;

    // Idempotent: a single death can be signalled by both PLAYER_TOPPED_OUT and
    // _handlePlayerDeath — only animate once per death until the next clear.
    if (mode._deathShown) return;
    mode._deathShown = true;

    // Free-for-all: out only until a key brings you back (ffa/respawn.js), so your board
    // stays in front of you, dark, with the prompt; the card rises when a key works.
    const freeForAll = mode._isFreeForAll();

    // B5: eliminated → keep watching. Expand to the full-roster watch view so a dead
    // player can follow everyone still playing (not just the 4-up beside their now-dead
    // board) until the round resolves. Reverted on revive in _clearDeathState.
    if (!freeForAll) enterDeadSpectate(mode);

    mode.mainBoardScene?.sharedEffects?.playKnockout?.();

    // The card after the board has gone dark. Tracked so _clearDeathState can cancel
    // a still-pending card (a round-ending death emits ROUND_RESTART BEFORE this fires).
    if (mode._deathOverlayTimer) clearTimeout(mode._deathOverlayTimer);
    mode._deathOverlayTimer = setTimeout(() => {
        mode._deathOverlayTimer = null;
        // If we were revived/cleared while the timer was pending, don't show it.
        if (!mode._deathShown) return;
        showOutCard(boardContainer, createOutCard(document, {
            cause: killerName ? `By ${killerName}` : 'Topped out',
            note: freeForAll ? 'Press any key to play again' : 'Watching until the round ends',
        }));
        boardContainer.classList.add('eliminated');
    }, freeForAll ? RESPAWN_AFTER_MS : 600);
}

/**
 * Clear death state from the main board (for rematch/new game)
 */
export function clearDeathState(mode) {
    // Cancel any still-pending death animation so it can't be born after the
    // round already reset (the orphaned-timeout bug that stuck "ELIMINATED").
    if (mode._deathOverlayTimer) {
        clearTimeout(mode._deathOverlayTimer);
        mode._deathOverlayTimer = null;
    }
    mode._deathShown = false;

    const boardContainer = document.getElementById('online-main-board');
    if (!boardContainer) return;

    boardContainer.classList.remove('eliminated');
    boardContainer.querySelector('.death-overlay')?.remove();
    mode.mainBoardScene?.sharedEffects?.clearKnockout?.();

    // B5: revived (round restart) → back to the normal watch-while-playing view.
    exitDeadSpectate(mode);
}

/**
 * B5 — spectate-after-death: when the LOCAL player is eliminated but the match
 * continues, expand the opponent watch grid to the full roster so they can watch
 * everyone still alive. (A pure spectator is already full-roster, so skip.) Reverted
 * by _exitDeadSpectate on revive.
 */
export function enterDeadSpectate(mode) {
    if (mode._deadSpectating || mode.ffaGameState?.isSpectator) return;
    if (!mode.opponentWatchManager) return;
    mode._deadSpectating = true;
    mode._preDeathMaxVisible = mode.opponentWatchManager.maxVisible;
    // setMaxVisible widens the CSS grid (full-roster class) so all alive players fit.
    mode.opponentWatchManager.setMaxVisible(8);
    document.getElementById('online-multiplayer-container')?.classList.add('dead-spectating');
    // A DROP-IN joiner (waiting, no elimination animation) gets a clear "you'll spawn
    // next round" banner over its empty board. An ELIMINATED player (_deathShown) already
    // has the "ELIMINATED" overlay, so don't add the join banner for them.
    if (!mode._deathShown) {
        showDropInWaitingBanner(mode);
    }
}

export function exitDeadSpectate(mode) {
    if (!mode._deadSpectating) return;
    mode._deadSpectating = false;
    mode.opponentWatchManager?.setMaxVisible(mode._preDeathMaxVisible || 4);
    document.getElementById('online-multiplayer-container')?.classList.remove('dead-spectating');
    hideDropInWaitingBanner();
}

/**
 * A mid-match drop-in joiner's empty board: the aqua "Next round" card, the one the
 * others see on this player's tile (ui/keystone/out-card.js).
 */
export function showDropInWaitingBanner(mode) {
    const container = document.getElementById('online-main-board');
    if (!container || container.querySelector('.dropin-waiting-banner')) return;
    // A free-for-all has no next round: a key brings you in (ffa/respawn.js).
    showStatusCard(container, createStatusCard(document, mode._isFreeForAll() ? {
        title: 'Join in',
        cause: 'Joined mid-match',
        note: 'Press any key to play',
        tone: 'aqua',
        marker: 'dropin-waiting-banner',
    } : {
        title: 'Next round',
        cause: 'Joined mid-match',
        note: 'You play from the next round',
        tone: 'aqua',
        marker: 'dropin-waiting-banner',
    }));
}

export function hideDropInWaitingBanner() {
    document.getElementById('online-main-board')?.querySelector('.dropin-waiting-banner')?.remove();
}

/**
 * Reconcile the death overlay against authoritative liveness. Driven from
 * state updates so the overlay is torn down the instant the local player is
 * revived (round restart), independent of event ordering/timeouts.
 */
export function reconcileDeathOverlay(mode, isAlive) {
    // A free-for-all drop-in watching until its key (no death shown) comes back too.
    if (isAlive === true && (mode._deathShown || (mode._deadSpectating && mode._isFreeForAll()))) {
        clearDeathState(mode);
    }
}
