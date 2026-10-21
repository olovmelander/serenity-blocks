/**
 * @fileoverview Odyssey level-complete results sheet.
 *
 * Extracted from OdysseyMode._createResultsModal (masterplan E1 — UI layer out of the god
 * object). Pure DOM/view: it takes the resolved level outcome + the few pieces of mode state it
 * needs as explicit deps, and returns the modal element (the caller appends it). No
 * `OdysseyMode` coupling beyond the passed deps, so it is unit-testable in isolation.
 *
 * The navigator's grammar (odyssey-outcome-sheet.js, public/styles/odyssey-outcome.css): the
 * orb's world as the hero in its chapter's light, the orb's name, the stars landing a beat apart
 * and why, the run in figures, then what the clear left (a first-clear theme); the leaderboard
 * has a column of its own, and Continue sits in a footer that never scrolls away.
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
import { createOdysseyStarNotes } from './odyssey-star-notes.js';
import { describeOdysseyCharms } from '../../core/odyssey/odyssey-charm-bag.js';
import { createOdysseyCharmIconNode } from './odyssey-charm-icon-stage.js';
import { createOdysseyStarRow } from './odyssey-orb-art.js';
import {
    createOdysseyOutcomeFrame, describeOdysseyOutcomeEyebrow, describeOdysseyOutcomeOrb,
} from './odyssey-outcome-sheet.js';

/** A fact: its label and its value (dt/dd), the value drawn large as a figure. */
function createFact(label, value, className = 'sb-ody-fact') {
    const fact = el('div', className);
    fact.appendChild(el('dt', '', label));
    fact.appendChild(el('dd', '', String(value)));
    return fact;
}

/**
 * Build the level-complete results sheet.
 * @param {object} deps
 * @param {{stars:number, score:number, lines:number, time:number}} deps.results resolved outcome
 * @param {Function} deps.onClose called once when the modal is dismissed (button/Enter/Space/Esc)
 * @param {?object} deps.levelConfig the orb's resolved level (its name, chapter and world); may be null
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
    const { modal, panel } = createKeystoneSheet({
        id: 'odyssey-results-modal',
        label: 'Orb complete',
        variant: 'results',
    });
    const orb = describeOdysseyOutcomeOrb(levelConfig);
    const { main, side, footer } = createOdysseyOutcomeFrame(modal, panel, {
        orb, state: 'cleared', side: includeLegacyResults,
    });

    // Result first: where the orb lies, its name, the stars and the run. Reward second.
    main.appendChild(el('p', 'sb-eyebrow sb-ody-eyebrow', orb?.number
        ? describeOdysseyOutcomeEyebrow(orb, 'Cleared') : 'Orb complete'));
    const title = el('h2', 'sb-ody-title', orb?.name || levelConfig?.name || 'Odyssey');
    title.tabIndex = -1;
    main.appendChild(title);
    if (results.duel) {
        const {
            playerFrags = 0, botFrags = 0, targetFrags = 3, botName = 'the rival',
        } = results.duel;
        main.appendChild(el(
            'p',
            'sb-ody-lede',
            `You defeated ${botName}, ${playerFrags}–${botFrags}. First to ${targetFrags} knockouts.`,
        ));
    }

    // Stars: earned ones in gold, each landing a beat after the last.
    const stars = createOdysseyStarRow(results.stars, {
        className: 'sb-ody-stars',
        label: `${results.stars} of 3 stars`,
    });
    if (stars) {
        Array.from(stars.children || []).forEach((star, index) => {
            if (star.style) star.style.animationDelay = `${250 + index * 160}ms`;
        });
        main.appendChild(stars);
    }
    // Why these stars: each goal marked, and the next one's shortfall in the player's numbers.
    const starNotes = createOdysseyStarNotes(levelConfig, results, { className: 'sb-ody-star-notes' });
    if (starNotes) main.appendChild(starNotes.list);

    const statsContainer = el('dl', 'sb-ody-facts');
    if (results.duel) {
        statsContainer.appendChild(createFact('Knockouts', `${results.duel.playerFrags}–${results.duel.botFrags}`));
    }
    statsContainer.appendChild(createFact('Score', results.score.toLocaleString()));
    statsContainer.appendChild(createFact('Lines', results.lines));
    statsContainer.appendChild(createFact('Time', formatTime(results.time * 1000)));
    main.appendChild(statsContainer);

    // A fact, not a warning: the charms this clear used, each charm's live icon ahead of the
    // names, quieter than the figures. Its stars count in full.
    const charms = describeOdysseyCharms(results.charms);
    if (charms.length) {
        const used = el('dl', 'sb-ody-charms-used');
        const fact = el('div', 'sb-ody-fact');
        fact.appendChild(el('dt', '', 'Charms used'));
        const value = el('dd', 'sb-ody-fact__charms', charms.map((charm) => charm.name).join(' · '));
        const icons = charms.map((charm) => createOdysseyCharmIconNode(charm.id)).filter(Boolean);
        if (icons.length && typeof value.prepend === 'function') value.prepend(...icons);
        fact.appendChild(value);
        used.appendChild(fact);
        main.appendChild(used);
    }

    if (!includeLegacyResults) {
        const unrankedNotice = el('div', 'sb-ody-note odyssey-results-unranked');
        unrankedNotice.appendChild(el('strong', '', 'Experimental Session · Unranked'));
        unrankedNotice.appendChild(el(
            'span',
            '',
            'Run stars are a preview. Campaign progress and leaderboard results were not saved.',
        ));
        main.appendChild(unrankedNotice);
    }

    // What the clear left: a first clear's theme and song, after the result it was earned by.
    const themeReward = includeLegacyResults
        ? createThemeUnlockReward(results.themeUnlock, { reducedMotion: results.reducedMotion === true }) : null;
    if (themeReward) main.appendChild(themeReward);

    if (includeLegacyResults && side) {
        // Steam leaderboard panel (level time + total stars), in its own column so a long board
        // never pushes Continue away. Experimental clocks never construct this view because
        // mount() immediately reads cached/live entries from the unversioned legacy boards.
        const leaderboardHost = document.createElement('div');
        leaderboardHost.className = 'steam-leaderboard-panel';
        side.appendChild(leaderboardHost);

        const levelBoard = `${STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX}${levelId}`;
        const levelTimeMs = Math.max(1, Math.round((results.time || 0) * 1000));
        // A charmed run is not uploaded to the orb's time board (OdysseyMode._syncSteamStats), so
        // it is not placed among its times either.
        const timeRanked = !(results.charms?.length > 0);

        leaderboardPanel = new SteamLeaderboardPanel({
            title: 'Odyssey leaderboards',
            boards: [
                {
                    id: 'level-time',
                    label: 'Orb time',
                    name: levelBoard,
                    currentScore: timeRanked ? levelTimeMs : null,
                    formatScore: formatMilliseconds,
                    sortOrder: 'asc',
                    pendingLabel: 'You · this run',
                },
                {
                    id: 'total-stars',
                    label: 'Total stars',
                    name: STEAM_LEADERBOARDS.ODYSSEY_TOTAL_STARS,
                    currentScore: totalStars,
                    formatScore: formatNumber,
                    sortOrder: 'desc',
                    pendingLabel: 'You · now',
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
    footer.appendChild(actions);

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
