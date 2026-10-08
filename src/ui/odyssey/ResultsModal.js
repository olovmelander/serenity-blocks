/**
 * @fileoverview Odyssey level-complete results modal.
 *
 * Extracted verbatim from OdysseyMode._createResultsModal (masterplan E1 — UI layer out of the
 * 5,900-line god object). Pure DOM/view: it takes the resolved level outcome + the few pieces of
 * mode state it needs as explicit deps, and returns the modal element (the caller appends it).
 * No `OdysseyMode` coupling beyond the passed deps, so it is unit-testable in isolation.
 */

import { STEAM_LEADERBOARDS } from '../../core/steam/steam-config.js';
import {
    SteamLeaderboardPanel,
    formatMilliseconds,
    formatNumber,
} from '../components/steam-leaderboard-panel.js';
import { appendKeyHint, createKeystoneSheet, el } from './keystone-sheet.js';
import { FOCUSABLE_SELECTOR } from '../spatial-navigation.js';
import { createThemeUnlockReward } from './ThemeUnlockReward.js';

/**
 * Build the level-complete results sheet.
 * @param {object} deps
 * @param {{stars:number, score:number, lines:number, time:number}} deps.results resolved outcome
 * @param {Function} deps.onClose called once when the modal is dismissed (button/Enter/Space/Esc)
 * @param {?object} deps.levelConfig current level config (for the name line); may be null
 * @param {string|number} deps.levelId current level id (Steam level-time board)
 * @param {number} deps.totalStars total stars earned (Steam total-stars board)
 * @param {function(number):string} deps.formatTime ms → mm:ss
 * @param {boolean} [deps.includeLegacyResults=true] show the unversioned Steam result view
 * @returns {HTMLElement} the modal root element (caller mounts it)
 */
export function createResultsModal({
    results,
    onClose,
    levelConfig,
    levelId,
    totalStars,
    formatTime,
    includeLegacyResults = true,
}) {
    let leaderboardPanel = null;
    // Keystone sheet (keystone-overlays.css): the level's name is the hero, its stars
    // and numbers below, one primary action.
    const { modal, panel: content } = createKeystoneSheet({
        id: 'odyssey-results-modal',
        label: 'Level complete',
        variant: 'results',
    });

    content.appendChild(el('p', 'sb-eyebrow sb-ody-eyebrow', 'Level complete'));
    const title = el('h2', 'sb-ody-title', levelConfig?.name || 'Odyssey');
    title.tabIndex = -1;
    content.appendChild(title);
    const themeReward = includeLegacyResults
        ? createThemeUnlockReward(results.themeUnlock, { reducedMotion: results.reducedMotion === true }) : null;
    if (themeReward) content.appendChild(themeReward);
    if (results.duel) {
        const {
            playerFrags = 0, botFrags = 0, targetFrags = 7, botName = 'the bot',
        } = results.duel;
        content.appendChild(el(
            'p',
            'sb-ody-lede',
            `You beat ${botName}, ${playerFrags}–${botFrags}. First to ${targetFrags} frags.`,
        ));
    }

    if (!includeLegacyResults) {
        const unrankedNotice = el('div', 'sb-ody-note odyssey-results-unranked');
        unrankedNotice.appendChild(el('strong', '', 'Experimental Session · Unranked'));
        unrankedNotice.appendChild(el(
            'span',
            '',
            'Run stars are a preview. Campaign progress and leaderboard results were not saved.',
        ));
        content.appendChild(unrankedNotice);
    }

    // Stars: earned ones in gold, each landing a beat after the last.
    const starsContainer = el('div', 'sb-ody-stars');
    starsContainer.role = 'img';
    starsContainer.ariaLabel = `${results.stars} of 3 stars`;
    for (let i = 0; i < 3; i++) {
        const isFilled = i < results.stars;
        const star = el('span', `sb-ody-star${isFilled ? ' is-earned' : ''}`);
        star.style.animationDelay = `${0.25 + i * 0.16}s`;
        star.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
            + '<path d="M12 2.6l2.7 5.6 6.1.8-4.4 4.3 1.1 6.1L12 16.5l-5.5 2.9 1.1-6.1-4.4-4.3 6.1-.8L12 2.6Z"/></svg>';
        starsContainer.appendChild(star);
    }
    content.appendChild(starsContainer);

    const stats = [
        { label: 'Score', value: results.score.toLocaleString() },
        { label: 'Lines', value: results.lines },
        { label: 'Time', value: formatTime(results.time * 1000) },
    ];
    if (results.duel) {
        stats.unshift({ label: 'Final frags', value: `${results.duel.playerFrags}–${results.duel.botFrags}` });
    }
    const statsContainer = el('dl', 'sb-ody-facts');
    stats.forEach((stat) => {
        const fact = el('div', 'sb-ody-fact');
        fact.appendChild(el('dt', '', stat.label));
        fact.appendChild(el('dd', '', String(stat.value)));
        statsContainer.appendChild(fact);
    });
    content.appendChild(statsContainer);

    if (includeLegacyResults) {
        // Steam leaderboard panel (level time + total stars). Experimental clocks
        // never construct this view because mount() immediately reads cached/live
        // entries from the unversioned legacy boards.
        const leaderboardHost = document.createElement('div');
        leaderboardHost.className = 'steam-leaderboard-panel';
        content.appendChild(leaderboardHost);

        const levelBoard = `${STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX}${levelId}`;
        const levelTimeMs = Math.max(1, Math.round((results.time || 0) * 1000));

        leaderboardPanel = new SteamLeaderboardPanel({
            title: 'Odyssey Leaderboards',
            boards: [
                {
                    id: 'level-time',
                    label: 'Level Time',
                    name: levelBoard,
                    currentScore: levelTimeMs,
                    formatScore: formatMilliseconds,
                },
                {
                    id: 'total-stars',
                    label: 'Total Stars',
                    name: STEAM_LEADERBOARDS.ODYSSEY_TOTAL_STARS,
                    currentScore: totalStars,
                    formatScore: formatNumber,
                },
            ],
            defaultBoardId: 'level-time',
            pageSize: 8,
        });

        leaderboardPanel.mount(leaderboardHost);
    }

    const actions = el('div', 'sb-ody-actions');
    const button = el('button', 'sb-btn sb-btn--primary', 'Continue');
    button.type = 'button';
    appendKeyHint(button, 'Enter', 'A');
    actions.appendChild(button);
    content.appendChild(actions);

    // Single-fire close shared by the button + keyboard (masterplan §2 #8 — the most-
    // pressed button in the mode was previously mouse-only). Capture phase so the modal
    // wins over any still-attached gameplay key handlers.
    let closed = false;
    let disposed = false;
    let onKeyDown = null;
    let onKeyUp = null;
    const pressedKeys = new Set();
    let focusTimer = null;
    modal.dispose = () => {
        if (disposed) return;
        disposed = true;
        themeReward?.dispose?.();
        closed = true;
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('keyup', onKeyUp, true);
        clearTimeout(focusTimer);
        leaderboardPanel?.destroy();
        modal.remove();
    };
    const close = () => {
        if (closed) return;
        modal.dispose();
        onClose();
    };
    onKeyDown = (e) => {
        if (modal.isConnected === false) {
            modal.dispose();
            return;
        }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
            // A held finishing key cannot dismiss results or activate their newly focused control.
            if (e.repeat) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            pressedKeys.add(e.key);
            const focused = document.activeElement;
            if (e.key !== 'Escape' && modal.contains?.(focused)
                && focused?.matches?.(FOCUSABLE_SELECTOR)) return;
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    };
    onKeyUp = (e) => {
        if (modal.isConnected === false) {
            modal.dispose();
            return;
        }
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // Space released after the sheet appeared did not begin on one of its controls.
        if (!pressedKeys.delete(e.key)) {
            e.preventDefault();
            e.stopPropagation();
        }
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    // Let the focused control receive its key before keeping gameplay's document
    // listener from cancelling Space's native activation as a hard drop.
    modal.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    button.addEventListener('click', close);
    focusTimer = setTimeout(() => (themeReward ? title : button).focus?.({ preventScroll: true }), 0);

    return modal;
}

export default createResultsModal;
