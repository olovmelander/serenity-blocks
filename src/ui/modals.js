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
            if (modalName === 'start') {
                document.body.classList.add('start-modal-open');
                // Show replays icon when start modal is open
                const replaysIcon = document.getElementById('open-replays-btn');
                if (replaysIcon) {
                    replaysIcon.classList.add('visible');
                }
            }
            window.dispatchEvent(new CustomEvent('modalShown', { detail: { modalName } }));

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
            if (modalName === 'start') {
                document.body.classList.remove('start-modal-open');
                // Hide replays icon when start modal closes
                const replaysIcon = document.getElementById('open-replays-btn');
                if (replaysIcon) {
                    replaysIcon.classList.remove('visible');
                }
            }
            window.dispatchEvent(new CustomEvent('modalHidden', { detail: { modalName } }));

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
 * @param {Object} demoManager - Demo manager instance (optional)
 * @param {Object} demo - Recorded demo object (optional)
 */
export async function showGameOverModal(modalManager, gameState, highScoreManager, demoManager = null, demo = null) {
    const {
        score, lines, level, dropInterval, startTime, piecesPlaced,
    } = gameState;

    // Calculate speed multiplier
    const LEVEL_SPEEDS = [
        1000, 900, 800, 700, 600, 500, 400, 350, 300, 250, 200, 175, 150, 125, 100, 90, 80, 70, 60,
        50,
    ];
    const speedMultiplier = (LEVEL_SPEEDS[0] / dropInterval).toFixed(1);

    // Calculate game duration
    const duration = Date.now() - startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    const totalMinutes = duration / 60000;

    // Calculate PPM metrics
    const piecesPPM = duration > 0 ? Math.round((piecesPlaced / duration) * 60000) : 0;
    const pointsPPM = totalMinutes > 0 ? Math.round(score / totalMinutes) : 0;

    // Calculate efficiency metrics
    const linesPerPiece = piecesPlaced > 0 ? (lines / piecesPlaced).toFixed(2) : '0.00';
    const efficiency = piecesPlaced > 0 ? Math.min(100, Math.round((lines / piecesPlaced) * 100)) : 0;

    // Prepare demo buttons HTML
    let demoButtonsHTML = '';

    console.log('[Modals] showGameOverModal - demoManager:', !!demoManager, 'demo:', !!demo);
    console.log('[Modals] Demo object details:', demo);
    console.log('[Modals] DemoManager object details:', demoManager);

    // Store original values for button functionality
    const originalDemoManager = demoManager;
    const originalDemo = demo;

    // DEBUG: Force dummy objects if missing (for UI testing only)
    if (!demo) {
        console.warn('[Modals] Demo missing, creating dummy demo for UI testing');
        demo = { version: '1.0', inputs: [], metadata: { duration: 0 } };
    }

    if (!demoManager) {
        console.warn('[Modals] DemoManager missing, creating dummy manager for UI testing');
        demoManager = {
            saveDemo: async (d) => { console.log('Dummy save called'); alert('Demo saved (dummy)'); },
            exportToURL: async (d) => { const url = 'http://dummy-url'; console.log('Dummy export called'); await navigator.clipboard.writeText(url); alert('Link copied (dummy)'); }
        };
    }

    // ALWAYS show buttons
    demoButtonsHTML = `
        <div class="demo-actions" style="margin-top: 20px; display: flex; gap: 15px; justify-content: center; width: 100%;">
            <button id="save-replay-btn" class="action-btn" style="flex: 1; min-width: 160px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #10b981; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 16px; white-space: nowrap;">
                <span class="icon" style="font-size: 18px;">💾</span> Save Replay
            </button>
            <button id="share-replay-btn" class="action-btn" style="flex: 1; min-width: 160px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.4); color: #3b82f6; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 16px; white-space: nowrap;">
                <span class="icon" style="font-size: 18px;">🔗</span> Share Replay
            </button>
        </div>
    `;

    // Show debug info in footer
    const footerText = document.querySelector('#game-over-modal p');
    if (footerText) {
        const realMgr = !!originalDemoManager;
        const realDemo = !!originalDemo;
        footerText.innerHTML = `Press any key or tap to restart<br><small style="font-size: 10px; color: #666;">Real: Demo=${realDemo}, Mgr=${realMgr} | Inputs=${originalDemo?.inputs?.length || 0}</small>`;
    }

    try {
        // Get rank and statistics
        const rank = await highScoreManager.getRank(score);
        const stats = await highScoreManager.getStatistics();

        // Build ranking HTML
        let rankingHTML = '';
        let rankingBadge = '';
        if (rank === 1) {
            rankingHTML = '🏆 NEW HIGH SCORE!';
            rankingBadge = '<div class="stat-badge stat-badge-gold">New Record</div>';
        } else if (rank <= 10) {
            rankingHTML = `Rank #${rank}`;
            rankingBadge = '<div class="stat-badge stat-badge-purple">Top 10</div>';
        } else {
            rankingHTML = `Rank #${rank}`;
        }

        // Personal best comparison
        const personalBest = stats.highestScore > score ? stats.highestScore : null;

        // Calculate averages
        const avgScore = stats.totalGames > 0 ? Math.round(stats.totalScore / stats.totalGames) : 0;
        const avgLines = stats.totalGames > 0 ? Math.round(stats.totalLines / stats.totalGames) : 0;

        // Update final stats display with 2x2 grid
        document.getElementById('final-stats').innerHTML = `
            <div class="stats-header">
                <div class="score-display">${score.toLocaleString()}</div>
                <div class="ranking-display">${rankingHTML}</div>
                ${rankingBadge}
            </div>

            <div class="stats-grid">
                <!-- Performance Section (Purple) -->
                <div class="stat-card stat-card-purple">
                    <div class="stat-card-header">Performance</div>
                    <div class="stat-row">
                        <span class="stat-label">Level</span>
                        <span class="stat-value">${level}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Speed</span>
                        <span class="stat-value">${speedMultiplier}x</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Lines</span>
                        <span class="stat-value">${lines}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Pieces</span>
                        <span class="stat-value">${piecesPlaced}</span>
                    </div>
                </div>

                <!-- Rate Stats Section (Cyan) -->
                <div class="stat-card stat-card-cyan">
                    <div class="stat-card-header">Rates (Per Min)</div>
                    <div class="stat-row">
                        <span class="stat-label">Points/Min</span>
                        <span class="stat-value">${pointsPPM.toLocaleString()}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Pieces/Min</span>
                        <span class="stat-value">${piecesPPM}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Lines/Piece</span>
                        <span class="stat-value">${linesPerPiece}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Efficiency</span>
                        <span class="stat-value">${efficiency}%</span>
                    </div>
                </div>

                <!-- Career Stats Section (Gold) -->
                <div class="stat-card stat-card-gold">
                    <div class="stat-card-header">Career Best</div>
                    <div class="stat-row">
                        <span class="stat-label">High Score</span>
                        <span class="stat-value">${stats.highestScore.toLocaleString()}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">High Level</span>
                        <span class="stat-value">${stats.highestLevel}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Total Games</span>
                        <span class="stat-value">${stats.totalGames}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Total Lines</span>
                        <span class="stat-value">${stats.totalLines.toLocaleString()}</span>
                    </div>
                </div>

                <!-- Comparison Section (Green) -->
                <div class="stat-card stat-card-green">
                    <div class="stat-card-header">Session (${durationStr})</div>
                    <div class="stat-row">
                        <span class="stat-label">Score</span>
                        <span class="stat-value">${score.toLocaleString()}</span>
                    </div>
                    ${personalBest ? `
                    <div class="stat-row">
                        <span class="stat-label">vs Best</span>
                        <span class="stat-value stat-comparison">${score > personalBest ? '+' : ''}${(score - personalBest).toLocaleString()}</span>
                    </div>
                    ` : ''}
                    <div class="stat-row">
                        <span class="stat-label">vs Avg</span>
                        <span class="stat-value stat-comparison">${score > avgScore ? '+' : ''}${(score - avgScore).toLocaleString()}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Avg Score</span>
                        <span class="stat-value">${avgScore.toLocaleString()}</span>
                    </div>
                </div>
            </div>
            ${demoButtonsHTML}
        `;
    } catch (error) {
        console.error('Error displaying game over stats:', error);
        // Fallback display
        document.getElementById('final-stats').innerHTML = `
            <div class="stats-header">
                <div class="score-display">${score.toLocaleString()}</div>
            </div>
            <div class="stats-grid">
                <div class="stat-card stat-card-purple">
                    <div class="stat-card-header">Game Stats</div>
                    <div class="stat-row">
                        <span class="stat-label">Level</span>
                        <span class="stat-value">${level}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Speed</span>
                        <span class="stat-value">${speedMultiplier}x</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Lines</span>
                        <span class="stat-value">${lines}</span>
                    </div>
                </div>
            </div>
            ${demoButtonsHTML}
        `;
    }

    modalManager.show('gameOver');

    // Add event listeners for demo buttons - use ORIGINAL objects if available
    const saveBtn = document.getElementById('save-replay-btn');
    const shareBtn = document.getElementById('share-replay-btn');

    if (saveBtn) {
        console.log('[Modals] Save Replay button found, attaching listener');
        console.log('[Modals] Using real demo:', !!originalDemo, 'real manager:', !!originalDemoManager);

        saveBtn.addEventListener('click', async () => {
            try {
                saveBtn.innerHTML = '<span class="icon">⏳</span> Saving...';

                // Use original demo and manager if available
                if (originalDemoManager && originalDemo) {
                    await originalDemoManager.saveDemo(originalDemo);
                    saveBtn.innerHTML = '<span class="icon">✅</span> Saved!';
                } else {
                    // Fallback to dummy
                    await demoManager.saveDemo(demo);
                    saveBtn.innerHTML = '<span class="icon">✅</span> Saved (dummy)!';
                }

                saveBtn.disabled = true;
                saveBtn.style.opacity = '0.7';
                saveBtn.style.cursor = 'default';
            } catch (err) {
                console.error('Failed to save demo:', err);
                saveBtn.innerHTML = '<span class="icon">❌</span> Error';
            }
        });
    }

    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            try {
                shareBtn.innerHTML = '<span class="icon">⏳</span> Generating...';

                // Use original demo and manager if available
                if (originalDemoManager && originalDemo) {
                    const url = await originalDemoManager.exportToURL(originalDemo);
                    await navigator.clipboard.writeText(url);
                    shareBtn.innerHTML = '<span class="icon">🔗</span> Copied!';
                } else {
                    // Fallback to dummy
                    const url = await demoManager.exportToURL(demo);
                    await navigator.clipboard.writeText(url);
                    shareBtn.innerHTML = '<span class="icon">🔗</span> Copied (dummy)!';
                }

                shareBtn.disabled = true;
                shareBtn.style.opacity = '0.7';
                shareBtn.style.cursor = 'default';
            } catch (err) {
                console.error('Failed to share demo:', err);
                shareBtn.innerHTML = '<span class="icon">❌</span> Error';
            }
        });
    }
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
 * @param {Object} gameModeManager - Optional game mode manager for Serenity Hub icon
 */
export function setupModalUI(modalManager, callbacks, gameModeManager = null) {
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
    // Global Settings button
    const settingsBtnGlobal = document.getElementById('settings-btn-global');
    if (settingsBtnGlobal) {
        settingsBtnGlobal.addEventListener('click', () => {
            showSettingsModal(modalManager);
            if (onSettingsOpen) onSettingsOpen();
        });
    }

    // Serenity Hub icon - The global SerenityHub instance (created in main.js)
    // handles the click event, so no additional handler needed here.
    // The icon's click listener is set up by SerenityHub.createHubIcon().

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
