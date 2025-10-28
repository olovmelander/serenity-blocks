/**
 * @fileoverview Modal Management for Serenity Blocks
 * Handles start modal, game-over modal, settings modal, and high scores modal
 */

/**
 * Modal manager class
 */
export class ModalManager {
    constructor(gamepadController = null) {
        this.modals = {
            start: document.getElementById('start-modal'),
            gameOver: document.getElementById('game-over-modal'),
            settings: document.getElementById('settings-modal'),
            highScores: document.getElementById('high-scores-modal'),
        };
        this.gamepadController = gamepadController;
    }

    /**
     * Set gamepad controller reference
     */
    setGamepadController(gamepadController) {
        this.gamepadController = gamepadController;
    }

    /**
     * Shows a modal
     * @param {string} modalName - Name of the modal ('start', 'gameOver', 'settings', 'highScores')
     */
    show(modalName) {
        const modal = this.modals[modalName];
        if (modal) {
            modal.classList.add('visible');
            
            // Enable menu navigation when modal opens
            if (this.gamepadController && modalName !== 'gameOver') {
                this.gamepadController.enableMenuNavigation();
            }
        }
    }

    /**
     * Hides a modal
     * @param {string} modalName - Name of the modal
     */
    hide(modalName) {
        const modal = this.modals[modalName];
        if (modal) {
            modal.classList.remove('visible');
            
            // Disable menu navigation when modal closes
            if (this.gamepadController && modalName !== 'start' && modalName !== 'gameOver') {
                this.gamepadController.disableMenuNavigation();
            }
        }
    }

    /**
     * Checks if a modal is visible
     * @param {string} modalName - Name of the modal
     * @returns {boolean} True if modal is visible
     */
    isVisible(modalName) {
        const modal = this.modals[modalName];
        return modal ? modal.classList.contains('visible') : false;
    }

    /**
     * Hides all modals
     */
    hideAll() {
        Object.keys(this.modals).forEach((name) => this.hide(name));
    }
}

/**
 * Shows the start modal
 * @param {ModalManager} modalManager - Modal manager instance
 */
export function showStartModal(modalManager) {
    modalManager.show('start');
    // Menu navigation is enabled in show() method
}

/**
 * Shows the game over modal with final stats
 * @param {ModalManager} modalManager - Modal manager instance
 * @param {Object} gameState - Current game state
 * @param {Object} highScoreManager - High score manager instance
 */
export async function showGameOverModal(modalManager, gameState, highScoreManager) {
    const {
        score, lines, level, dropInterval,
    } = gameState;

    // Calculate speed multiplier
    const LEVEL_SPEEDS = [
        1000, 900, 800, 700, 600, 500, 400, 350, 300, 250, 200, 175, 150, 125, 100, 90, 80, 70, 60,
        50,
    ];
    const speedMultiplier = (LEVEL_SPEEDS[0] / dropInterval).toFixed(1);

    try {
        // Get rank and statistics
        const rank = await highScoreManager.getRank(score);
        const stats = await highScoreManager.getStatistics();

        // Build ranking HTML
        let rankingHTML = '';
        if (rank === 1) {
            rankingHTML = '<div style="font-size:20px;color:#10b981;margin:10px 0;font-weight:bold;">🏆 NEW HIGH SCORE! 🏆</div>';
        } else if (rank <= 10) {
            rankingHTML = `<div style="font-size:16px;color:#fbbf24;margin:10px 0;">Rank: #${rank} in your top 10!</div>`;
        } else {
            rankingHTML = `<div style="font-size:14px;color:#9ca3af;margin:10px 0;">Personal Rank: #${rank}</div>`;
        }

        // Personal best
        const personalBest = stats.highestScore > score
            ? `<div style="font-size:14px;color:#9ca3af;margin:5px 0;">Personal Best: ${stats.highestScore}</div>`
            : '';

        // Update final stats display
        document.getElementById('final-stats').innerHTML = `
            <div style="font-size:24px;margin-bottom:10px;color:#fbbf24;">Score: ${score}</div>
            ${rankingHTML}
            ${personalBest}
            <div style="margin-bottom:5px;">Level ${level} (${speedMultiplier}x speed)</div>
            <div>Lines Cleared: ${lines}</div>
            <div style="font-size:12px;color:#9ca3af;margin-top:10px;">Total Games: ${stats.totalGames}</div>
        `;
    } catch (error) {
        console.error('Error displaying game over stats:', error);
        // Fallback display
        document.getElementById('final-stats').innerHTML = `
            <div style="font-size:24px;margin-bottom:10px;color:#fbbf24;">Score: ${score}</div>
            <div style="margin-bottom:5px;">Level ${level} (${speedMultiplier}x speed)</div>
            <div>Lines Cleared: ${lines}</div>
        `;
    }

    modalManager.show('gameOver');
}

/**
 * Shows the settings modal
 * @param {ModalManager} modalManager - Modal manager instance
 */
export function showSettingsModal(modalManager) {
    modalManager.show('settings');
    // Menu navigation is enabled in show() method
}

/**
 * Shows the high scores modal with scores and statistics
 * @param {ModalManager} modalManager - Modal manager instance
 * @param {Object} highScoreManager - High score manager instance
 */
export async function showHighScoresModal(modalManager, highScoreManager) {
    try {
        const topScores = await highScoreManager.getTopScores(10);
        const stats = await highScoreManager.getStatistics();

        // Build high scores table
        let scoresHTML = '<h2 style="margin-bottom: 15px; color: #fbbf24;">Top 10 Scores</h2>';
        if (topScores.length === 0) {
            scoresHTML += '<p style="color: #9ca3af;">No scores yet. Start playing!</p>';
        } else {
            scoresHTML += '<table style="width: 100%; border-collapse: collapse;">';
            scoresHTML += `
                <thead>
                    <tr style="border-bottom: 2px solid rgba(255,255,255,0.3);">
                        <th style="text-align: left; padding: 8px;">Rank</th>
                        <th style="text-align: right; padding: 8px;">Score</th>
                        <th style="text-align: center; padding: 8px;">Level</th>
                        <th style="text-align: center; padding: 8px;">Lines</th>
                        <th style="text-align: right; padding: 8px;">Date</th>
                    </tr>
                </thead>
                <tbody>
            `;

            topScores.forEach((score, index) => {
                const date = new Date(score.timestamp);
                const dateStr = date.toLocaleDateString();
                const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                const rowColor = index % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'transparent';

                scoresHTML += `
                    <tr style="background: ${rowColor};">
                        <td style="padding: 8px; font-weight: bold;">${rankEmoji}</td>
                        <td style="padding: 8px; text-align: right; color: #fbbf24; font-weight: bold;">${score.score.toLocaleString()}</td>
                        <td style="padding: 8px; text-align: center;">${score.level}</td>
                        <td style="padding: 8px; text-align: center;">${score.lines}</td>
                        <td style="padding: 8px; text-align: right; color: #9ca3af; font-size: 12px;">${dateStr}</td>
                    </tr>
                `;
            });

            scoresHTML += '</tbody></table>';
        }

        document.getElementById('high-scores-list').innerHTML = scoresHTML;

        // Build statistics section
        let statsHTML = '<h2 style="margin-bottom: 15px; color: #fbbf24;">Statistics</h2>';
        statsHTML += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">';
        statsHTML += `<div><strong>Total Games:</strong> ${stats.totalGames}</div>`;
        statsHTML += `<div><strong>Highest Score:</strong> ${stats.highestScore.toLocaleString()}</div>`;
        statsHTML += `<div><strong>Total Lines:</strong> ${stats.totalLines.toLocaleString()}</div>`;
        statsHTML += `<div><strong>Highest Level:</strong> ${stats.highestLevel}</div>`;

        if (stats.totalGames > 0) {
            const avgScore = Math.round(stats.totalScore / stats.totalGames);
            const avgLines = Math.round(stats.totalLines / stats.totalGames);
            statsHTML += `<div><strong>Avg Score:</strong> ${avgScore.toLocaleString()}</div>`;
            statsHTML += `<div><strong>Avg Lines:</strong> ${avgLines}</div>`;
        }

        statsHTML += '</div>';

        document.getElementById('statistics-section').innerHTML = statsHTML;
    } catch (error) {
        console.error('Error loading high scores:', error);
        document.getElementById('high-scores-list').innerHTML = '<p style="color: #ef4444;">Error loading scores</p>';
    }

    modalManager.show('highScores');
    // Menu navigation is enabled in show() method
}

/**
 * Closes the high scores modal
 * @param {ModalManager} modalManager - Modal manager instance
 */
export function closeHighScoresModal(modalManager) {
    modalManager.hide('highScores');
    // Menu navigation is disabled in hide() method
}

/**
 * Closes the settings modal
 * @param {ModalManager} modalManager - Modal manager instance
 */
export function closeSettingsModal(modalManager) {
    modalManager.hide('settings');
    // Menu navigation is disabled in hide() method
}

/**
 * Sets up UI button listeners
 * @param {ModalManager} modalManager - Modal manager instance
 * @param {Object} callbacks - Callback functions
 */
export function setupModalUI(modalManager, callbacks) {
    const {
        onSettingsOpen,
        onSettingsClose,
        onHighScoresOpen,
        onHighScoresClose,
        onFullscreenToggle,
        onNextTrack,
        onRandomTheme,
    } = callbacks;

    // Settings button (single player)
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            showSettingsModal(modalManager);
            if (onSettingsOpen) onSettingsOpen();
        });
    }

    // Settings button (multiplayer)
    const settingsBtnMp = document.getElementById('settings-btn-mp');
    if (settingsBtnMp) {
        settingsBtnMp.addEventListener('click', () => {
            showSettingsModal(modalManager);
            if (onSettingsOpen) onSettingsOpen();
        });
    }

    // Close settings button
    const closeSettingsBtn = document.getElementById('close-settings');
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            closeSettingsModal(modalManager);
            if (onSettingsClose) onSettingsClose();
        });
    }

    // Close settings modal with Escape key
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modalManager.isVisible('settings')) {
            event.preventDefault();
            event.stopImmediatePropagation(); // Stop other handlers on same element
            console.log('[Modals] Escape pressed, closing settings modal');
            closeSettingsModal(modalManager);
            if (onSettingsClose) onSettingsClose();
        }
    });

    // High scores button
    const highScoresBtn = document.getElementById('high-scores-btn');
    if (highScoresBtn) {
        highScoresBtn.addEventListener('click', () => {
            if (onHighScoresOpen) onHighScoresOpen();
        });
    }

    // Close high scores button
    const closeHighScoresBtn = document.getElementById('close-high-scores');
    if (closeHighScoresBtn) {
        closeHighScoresBtn.addEventListener('click', () => {
            closeHighScoresModal(modalManager);
            if (onHighScoresClose) onHighScoresClose();
        });
    }

    // Fullscreen toggle
    const fullscreenBtn = document.getElementById('fullscreen-toggle');
    if (fullscreenBtn && onFullscreenToggle) {
        fullscreenBtn.addEventListener('click', onFullscreenToggle);
    }

    // Next track button
    const nextTrackBtn = document.getElementById('next-track-btn');
    if (nextTrackBtn && onNextTrack) {
        nextTrackBtn.addEventListener('click', onNextTrack);
    }

    // Random theme button
    const randomThemeBtn = document.getElementById('random-theme-btn');
    if (randomThemeBtn && onRandomTheme) {
        randomThemeBtn.addEventListener('click', onRandomTheme);
    }
}

/**
 * Toggles fullscreen mode
 */
export function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch((err) => {
            console.error('Error attempting to enable fullscreen:', err);
        });
    } else if (document.exitFullscreen) {
        document.exitFullscreen();
    }
}
