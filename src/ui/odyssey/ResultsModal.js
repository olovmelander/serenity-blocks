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

/**
 * Build the "Level Complete!" results modal.
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
    const modal = document.createElement('div');
    modal.id = 'odyssey-results-modal';
    modal.style.cssText = `
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.8);
        z-index: 10000;
        animation: fadeIn 0.3s ease-out;
    `;

    // Add keyframes
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes starPop { 0% { transform: scale(0); } 50% { transform: scale(1.3); } 100% { transform: scale(1); } }
    `;
    modal.appendChild(style);

    const content = document.createElement('div');
    content.style.cssText = `
        background: linear-gradient(165deg, rgba(20, 15, 40, 0.95) 0%, rgba(12, 10, 30, 0.98) 100%);
        border: 1px solid rgba(180, 130, 255, 0.4);
        border-radius: 24px;
        padding: 40px 50px;
        text-align: center;
        max-width: 520px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 80px rgba(140, 80, 255, 0.2);
        animation: slideUp 0.4s ease-out;
        font-family: 'Orbitron', 'Segoe UI', sans-serif;
    `;

    // Title
    const title = document.createElement('h2');
    title.textContent = 'Level Complete!';
    title.style.cssText = `
        margin: 0 0 20px 0;
        font-size: 28px;
        font-weight: 700;
        color: #fff;
        text-shadow: 0 0 30px rgba(100, 255, 150, 0.5);
    `;
    content.appendChild(title);

    // Level name
    if (levelConfig) {
        const levelName = document.createElement('div');
        levelName.textContent = levelConfig.name;
        levelName.style.cssText = `
            font-size: 16px;
            color: rgba(180, 150, 255, 0.8);
            margin-bottom: 25px;
        `;
        content.appendChild(levelName);
    }

    if (!includeLegacyResults) {
        const unrankedNotice = document.createElement('div');
        unrankedNotice.className = 'odyssey-results-unranked';
        unrankedNotice.innerHTML = `
            <div style="font-size: 14px; font-weight: 700; color: rgba(205, 175, 255, 0.95);">
                Experimental Session · Unranked
            </div>
            <div style="margin-top: 6px; font-size: 11px; line-height: 1.5; color: rgba(210, 220, 240, 0.68);">
                Run stars are a preview. Campaign progress and leaderboard results were not saved.
            </div>
        `;
        unrankedNotice.style.cssText = `
            margin: 0 0 24px;
            padding: 12px 16px;
            border: 1px solid rgba(180, 130, 255, 0.35);
            border-radius: 10px;
            background: rgba(120, 80, 180, 0.12);
        `;
        content.appendChild(unrankedNotice);
    }

    // Stars
    const starsContainer = document.createElement('div');
    starsContainer.style.cssText = `
        display: flex;
        justify-content: center;
        gap: 12px;
        margin-bottom: 30px;
    `;

    for (let i = 0; i < 3; i++) {
        const star = document.createElement('div');
        const isFilled = i < results.stars;
        star.innerHTML = `
            <svg width="48" height="48" viewBox="0 0 24 24" fill="${isFilled ? 'rgba(255, 200, 100, 1)' : 'rgba(255, 200, 100, 0.1)'}" stroke="${isFilled ? 'rgba(255, 220, 150, 1)' : 'rgba(255, 200, 100, 0.3)'}" stroke-width="2">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
            </svg>
        `;
        star.style.cssText = `
            animation: starPop 0.3s ease-out ${0.2 + i * 0.15}s backwards;
            filter: ${isFilled ? 'drop-shadow(0 0 12px rgba(255, 200, 100, 0.8))' : 'none'};
        `;
        starsContainer.appendChild(star);
    }
    content.appendChild(starsContainer);

    // Stats
    const stats = [
        { label: 'Score', value: results.score.toLocaleString() },
        { label: 'Lines', value: results.lines },
        { label: 'Time', value: formatTime(results.time * 1000) },
    ];

    const statsContainer = document.createElement('div');
    statsContainer.style.cssText = `
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 20px;
        margin-bottom: 30px;
    `;

    stats.forEach((stat) => {
        const statDiv = document.createElement('div');
        statDiv.innerHTML = `
            <div style="font-size: 11px; color: rgba(180, 200, 220, 0.6); letter-spacing: 1px; margin-bottom: 5px;">${stat.label.toUpperCase()}</div>
            <div style="font-size: 20px; font-weight: 700; color: #fff;">${stat.value}</div>
        `;
        statsContainer.appendChild(statDiv);
    });
    content.appendChild(statsContainer);

    if (includeLegacyResults) {
        // Steam leaderboard panel (level time + total stars). Experimental clocks
        // never construct this view because mount() immediately reads cached/live
        // entries from the unversioned legacy boards.
        const leaderboardHost = document.createElement('div');
        leaderboardHost.className = 'steam-leaderboard-panel';
        leaderboardHost.style.marginBottom = '24px';
        content.appendChild(leaderboardHost);

        const levelBoard = `${STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX}${levelId}`;
        const levelTimeMs = Math.max(1, Math.round((results.time || 0) * 1000));

        const leaderboardPanel = new SteamLeaderboardPanel({
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

    // Continue button
    const button = document.createElement('button');
    button.textContent = 'Continue';
    button.style.cssText = `
        padding: 14px 40px;
        font-size: 16px;
        font-weight: 600;
        font-family: 'Orbitron', 'Segoe UI', sans-serif;
        color: #fff;
        background: linear-gradient(135deg, rgba(100, 180, 255, 0.3) 0%, rgba(180, 130, 255, 0.3) 100%);
        border: 1px solid rgba(180, 130, 255, 0.6);
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
    `;
    button.onmouseenter = () => {
        button.style.background = 'linear-gradient(135deg, rgba(100, 180, 255, 0.5) 0%, rgba(180, 130, 255, 0.5) 100%)';
        button.style.transform = 'scale(1.05)';
    };
    button.onmouseleave = () => {
        button.style.background = 'linear-gradient(135deg, rgba(100, 180, 255, 0.3) 0%, rgba(180, 130, 255, 0.3) 100%)';
        button.style.transform = 'scale(1)';
    };
    content.appendChild(button);

    // Keyboard hint
    const hint = document.createElement('div');
    hint.style.cssText = `
        margin-top: 18px;
        font-size: 11px;
        letter-spacing: 0.5px;
        color: rgba(200, 210, 255, 0.4);
    `;
    hint.innerHTML = 'Press <b style="color: rgba(200,210,255,0.7);">Enter</b> to continue';
    content.appendChild(hint);

    modal.appendChild(content);

    // Single-fire close shared by the button + keyboard (masterplan §2 #8 — the most-
    // pressed button in the mode was previously mouse-only). Capture phase so the modal
    // wins over any still-attached gameplay key handlers.
    let closed = false;
    let onKeyDown = null;
    const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeyDown, true);
        modal.remove();
        onClose();
    };
    onKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    };
    document.addEventListener('keydown', onKeyDown, true);
    button.addEventListener('click', close);

    return modal;
}

export default createResultsModal;
