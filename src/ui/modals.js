/**
 * @fileoverview Modal Management for Serenity Blocks
 * Handles start modal, game-over modal, settings modal, and high scores modal
 */

import { STEAM_LEADERBOARDS } from '../core/steam/steam-config.js';
import steamService from '../core/steam/steam-service.js';
import {
    SteamLeaderboardPanel,
    formatNumber,
    formatSeconds,
} from './components/steam-leaderboard-panel.js';
import { csIcon } from './components/cosmic-icons.js';
import { normalizeWheelDeltaToPixels } from '../utils/wheel-routing.js';

/**
 * Modal manager class
 */
export class ModalManager {
    constructor(gamepadController = null) {
        this.modals = {
            start: document.getElementById('start-modal'),
            gameOver: document.getElementById('game-over-modal'),
            demoComplete: document.getElementById('demo-complete-modal'),
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
                // Show highscores icon when start modal is open
                const highscoresIcon = document.getElementById('highscores-icon-btn');
                if (highscoresIcon) {
                    highscoresIcon.classList.add('visible');
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
                // Hide highscores icon when start modal closes
                const highscoresIcon = document.getElementById('highscores-icon-btn');
                if (highscoresIcon) {
                    highscoresIcon.classList.remove('visible');
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
 * @param {Object} callbacks - Optional callbacks for buttons { onMainMenu, onRestart }
 * @param {Object} options - Optional presentation policy
 * @param {boolean} [options.includeLegacyResults=true] - Query/show unversioned result stores
 * @param {Function} [options.shouldPresent] - Ownership predicate checked around async work
 * @returns {Promise<boolean>} Whether the modal was presented
 */
export async function showGameOverModal(
    modalManager,
    gameState,
    highScoreManager,
    callbacks = {},
    options = {},
) {
    const {
        score, lines, level, dropInterval, startTime, piecesPlaced,
    } = gameState;
    const includeLegacyResults = options.includeLegacyResults !== false;
    const shouldPresent = typeof options.shouldPresent === 'function'
        ? options.shouldPresent
        : () => true;

    if (!shouldPresent()) {
        return false;
    }

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

    if (!includeLegacyResults) {
        document.getElementById('final-stats').innerHTML = `
            <div class="stats-header">
                <div class="score-display">${score.toLocaleString()}</div>
                <div class="ranking-display">Experimental Session · Unranked</div>
                <div class="stat-badge stat-badge-purple">Separate Ruleset</div>
            </div>

            <div class="stats-grid">
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

                <div class="stat-card stat-card-green">
                    <div class="stat-card-header">Session (${durationStr})</div>
                    <div class="stat-row">
                        <span class="stat-label">Score</span>
                        <span class="stat-value">${score.toLocaleString()}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Status</span>
                        <span class="stat-value">Not added to legacy rankings</span>
                    </div>
                </div>
            </div>
        `;
        return presentGameOverModal(modalManager, callbacks, shouldPresent);
    }

    try {
        // Get rank and statistics
        const rank = await highScoreManager.getRank(score);
        const stats = await highScoreManager.getStatistics();

        if (!shouldPresent()) {
            return false;
        }

        // Build ranking HTML
        let rankingHTML = '';
        let rankingBadge = '';
        if (rank === 1) {
            rankingHTML = `<span class="ranking-line">${csIcon('trophy', 16, 'ranking-icon-svg')}<span>New High Score!</span></span>`;
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
            <div class="steam-leaderboard-host" id="steam-leaderboard-host"></div>
        `;

        // Only mount the Steam leaderboard panel when leaderboards are actually
        // available. In a non-Steam/browser build it would render an "unavailable"
        // shell (~260px) that adds nothing but forces the modal to scroll.
        const leaderboardHost = document.getElementById('steam-leaderboard-host');
        if (leaderboardHost && steamService.capabilities?.leaderboards && shouldPresent()) {
            const isInfinity = !!gameState?.isInfinityMode;
            const startTime = gameState?.infinityStats?.sessionStartTime || gameState.startTime || Date.now();
            const durationSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));
            const bestCascade = gameState?.infinityStats?.maxComboDepth || 0;

            const boards = isInfinity
                ? [
                    {
                        id: 'score',
                        label: 'Score',
                        name: STEAM_LEADERBOARDS.INFINITY_HIGH_SCORE,
                        currentScore: score,
                        formatScore: formatNumber,
                    },
                    {
                        id: 'time',
                        label: 'Survival',
                        name: STEAM_LEADERBOARDS.INFINITY_SURVIVAL_TIME,
                        currentScore: durationSeconds,
                        formatScore: formatSeconds,
                    },
                    {
                        id: 'cascade',
                        label: 'Cascade',
                        name: STEAM_LEADERBOARDS.INFINITY_BEST_CASCADE,
                        currentScore: bestCascade,
                        formatScore: formatNumber,
                    },
                ]
                : [
                    {
                        id: 'score',
                        label: 'Score',
                        name: STEAM_LEADERBOARDS.SINGLE_PLAYER_HIGH_SCORE,
                        currentScore: score,
                        formatScore: formatNumber,
                    },
                    {
                        id: 'lines',
                        label: 'Lines',
                        name: STEAM_LEADERBOARDS.SINGLE_PLAYER_LINES,
                        currentScore: lines,
                        formatScore: formatNumber,
                    },
                ];

            const leaderboardPanel = new SteamLeaderboardPanel({
                title: isInfinity ? 'Infinity Leaderboards' : 'Single Player Leaderboards',
                boards,
                defaultBoardId: boards[0]?.id,
            });

            leaderboardPanel.mount(leaderboardHost);
        }
    } catch (error) {
        if (!shouldPresent()) {
            return false;
        }
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
            `;
    }

    return presentGameOverModal(modalManager, callbacks, shouldPresent);
}

/**
 * Render the shared game-over controls and reveal the modal if ownership holds.
 * @param {ModalManager} modalManager
 * @param {Object} callbacks
 * @param {Function} shouldPresent
 * @returns {boolean}
 */
function presentGameOverModal(modalManager, callbacks, shouldPresent) {
    if (!shouldPresent()) return false;

    // Render Buttons
    const buttonsContainer = document.getElementById('game-over-buttons');
    if (buttonsContainer) {
        buttonsContainer.innerHTML = `
            <button id="game-over-main-menu" class="demo-btn tertiary">
                <svg class="btn-icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9.5 21v-6h5v6"/></svg>
                <span>Main Menu</span>
            </button>
        `;

        // Wire up button event listeners
        const mainMenuBtn = document.getElementById('game-over-main-menu');
        if (mainMenuBtn) {
            mainMenuBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[Modal] Game Over: Main Menu clicked');
                modalManager.hide('gameOver');
                if (callbacks.onMainMenu) callbacks.onMainMenu();
            });
        }
    }

    if (!shouldPresent()) {
        return false;
    }

    modalManager.show('gameOver');
    return true;
}

/**
 * Shows the demo complete modal after replay finishes
 * @param {ModalManager} modalManager - Modal manager instance
 * @param {Object} gameState - Game state at end of demo
 * @param {Object} callbacks - Navigation callbacks { onWatchAgain, onBrowseReplays, onMainMenu }
 * @param {Object} options - Optional presentation policy
 * @param {Function} [options.shouldPresent] - Ownership predicate checked around async work
 * @returns {Promise<boolean>} Whether the modal was presented
 */
export async function showDemoCompleteModal(
    modalManager,
    gameState,
    highScoreManager,
    callbacks = {},
    options = {},
) {
    const shouldPresent = typeof options.shouldPresent === 'function'
        ? options.shouldPresent
        : () => true;
    if (!shouldPresent()) {
        return false;
    }

    const {
        score = 0, lines = 0, level = 1, dropInterval = 1000, startTime, piecesPlaced = 0,
    } = gameState || {};

    // Calculate speed multiplier (same logic as Game Over)
    const LEVEL_SPEEDS = [
        1000, 900, 800, 700, 600, 500, 400, 350, 300, 250, 200, 175, 150, 125, 100, 90, 80, 70, 60,
        50,
    ];
    const speedMultiplier = (LEVEL_SPEEDS[0] / dropInterval).toFixed(1);

    // Calculate duration
    const duration = Number.isFinite(gameState?.simTimeMs)
        ? gameState.simTimeMs
        : startTime ? Date.now() - startTime : 0;
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

    // Fetch stats
    let rank = 0;
    let stats = {
        highestScore: 0, highestLevel: 0, totalGames: 0, totalLines: 0, totalScore: 0,
    };

    if (highScoreManager) {
        try {
            rank = await highScoreManager.getRank(score);
            stats = await highScoreManager.getStatistics();
        } catch (e) {
            console.warn('[Modal] Failed to load stats', e);
        }
    }

    if (!shouldPresent()) {
        return false;
    }

    // Ranking Logic
    let rankingHTML = '';
    let rankingBadge = '';
    if (rank === 1) {
        rankingHTML = `<span class="ranking-line">${csIcon('trophy', 16, 'ranking-icon-svg')}<span>New High Score!</span></span>`;
        rankingBadge = '<div class="stat-badge stat-badge-gold">New Record</div>';
    } else if (rank > 0 && rank <= 10) {
        rankingHTML = `Rank #${rank}`;
        rankingBadge = '<div class="stat-badge stat-badge-purple">Top 10</div>';
    } else if (rank > 0) {
        rankingHTML = `Rank #${rank}`;
    } else {
        rankingHTML = 'Replay';
    }

    // Personal best comparison
    const personalBest = stats.highestScore > score ? stats.highestScore : null;

    // Calculate averages
    const avgScore = stats.totalGames > 0 ? Math.round(stats.totalScore / stats.totalGames) : 0;

    // Update final stats display with 2x2 grid
    document.getElementById('demo-final-stats').innerHTML = `
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
                <div class="stat-card-header">Replay (${durationStr})</div>
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
    `;

    // Render Buttons
    const buttonsContainer = document.getElementById('demo-complete-buttons');
    if (buttonsContainer) {
        buttonsContainer.innerHTML = `
            <button id="demo-watch-again" class="demo-btn primary">
                ${csIcon('play', 16, 'btn-icon-svg')}
                <span>Watch Again</span>
            </button>
            <button id="demo-browse-replays" class="demo-btn secondary">
                ${csIcon('folder', 16, 'btn-icon-svg')}
                <span>Browse Replays</span>
            </button>
            <button id="demo-main-menu" class="demo-btn tertiary">
                ${csIcon('home', 16, 'btn-icon-svg')}
                <span>Main Menu</span>
            </button>
        `;

        // Wire up button event listeners
        document.getElementById('demo-watch-again').addEventListener('click', () => {
            modalManager.hide('demoComplete');
            if (callbacks.onWatchAgain) callbacks.onWatchAgain();
        });

        document.getElementById('demo-browse-replays').addEventListener('click', () => {
            modalManager.hide('demoComplete');
            if (callbacks.onBrowseReplays) callbacks.onBrowseReplays();
        });

        document.getElementById('demo-main-menu').addEventListener('click', () => {
            modalManager.hide('demoComplete');
            if (callbacks.onMainMenu) callbacks.onMainMenu();
        });
    }

    if (!shouldPresent()) {
        return false;
    }

    modalManager.show('demoComplete');
    return true;
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
 * @param {Function} [onPlayDemo] - Optional callback to play a demo by ID: (demoId) => void
 */
export async function showHighScoresModal(modalManager, highScoreManager, onPlayDemo = null) {
    try {
        const topScores = await highScoreManager.getTopScores(10);
        const stats = await highScoreManager.getStatistics();

        // Check if any scores have linked demos
        const hasAnyDemos = topScores.some((score) => score.demoId);

        // Build leaderboard (cosmic glass row-cards)
        const leaderboardClass = hasAnyDemos ? 'hs-leaderboard hs-leaderboard--demos' : 'hs-leaderboard';
        let scoresHTML = '<h2 class="hs-section-title">Top 10 Scores</h2>';
        if (topScores.length === 0) {
            scoresHTML += '<p class="hs-empty">No scores yet. Start playing!</p>';
        } else {
            const rowsHTML = topScores.map((score, index) => {
                const date = new Date(score.timestamp);
                const dateStr = date.toLocaleDateString();
                const medal = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
                const rankIcon = index === 0 ? 'crown' : index === 1 ? 'trophy' : index === 2 ? 'gem' : '';
                const rankLabel = rankIcon ? csIcon(rankIcon, 18, `hs-rank-icon hs-rank-icon--${medal}`) : `${index + 1}`;
                const rowClass = `hs-row${medal ? ` hs-row--${medal}` : ''}`;

                // Play button for scores with linked demos (placeholder keeps rows aligned)
                let playHTML = '';
                if (hasAnyDemos) {
                    if (score.demoId && onPlayDemo) {
                        playHTML = `<button class="play-demo-btn hs-play" data-demo-id="${score.demoId}" title="Watch replay" aria-label="Watch replay">${csIcon('play', 16, 'btn-icon-svg')}</button>`;
                    } else {
                        playHTML = '<span class="hs-play hs-play--empty" aria-hidden="true">—</span>';
                    }
                }

                return `
                    <div class="${rowClass}">
                        <div class="hs-rank">${rankLabel}</div>
                        <div class="hs-main">
                            <div class="hs-score">${score.score.toLocaleString()}</div>
                            <div class="hs-meta">Lv ${score.level} · ${score.lines} lines</div>
                        </div>
                        <div class="hs-date">${dateStr}</div>
                        ${playHTML}
                    </div>
                `;
            }).join('');

            scoresHTML += `<div class="${leaderboardClass}">${rowsHTML}</div>`;
        }

        document.getElementById('high-scores-list').innerHTML = scoresHTML;

        // Attach event listeners to play buttons (hover handled in CSS)
        if (onPlayDemo) {
            document.querySelectorAll('.play-demo-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    const demoId = parseInt(e.currentTarget.dataset.demoId, 10);
                    modalManager.hide('highScores');
                    onPlayDemo(demoId);
                });
            });
        }

        // Build statistics (cosmic glass stat cards)
        const statCards = [
            { label: 'Total Games', value: stats.totalGames.toLocaleString() },
            { label: 'Highest Score', value: stats.highestScore.toLocaleString() },
            { label: 'Total Lines', value: stats.totalLines.toLocaleString() },
            { label: 'Highest Level', value: stats.highestLevel },
        ];
        if (stats.totalGames > 0) {
            statCards.push({ label: 'Avg Score', value: Math.round(stats.totalScore / stats.totalGames).toLocaleString() });
            statCards.push({ label: 'Avg Lines', value: Math.round(stats.totalLines / stats.totalGames).toLocaleString() });
        }

        let statsHTML = '<h2 class="hs-section-title">Statistics</h2>';
        statsHTML += '<div class="hs-stats-grid">';
        statsHTML += statCards.map((s) => `
            <div class="hs-stat">
                <div class="hs-stat-value">${s.value}</div>
                <div class="hs-stat-label">${s.label}</div>
            </div>
        `).join('');
        statsHTML += '</div>';

        document.getElementById('statistics-section').innerHTML = statsHTML;
    } catch (error) {
        console.error('Error loading high scores:', error);
        document.getElementById('high-scores-list').innerHTML = '<p class="hs-error">Error loading scores</p>';
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
 * Sets up temporary scroll performance mode for the settings modal.
 * Reduces hover/pointer churn while the user is actively scrolling.
 * @param {ModalManager} modalManager - Modal manager instance
 */
export function createSettingsScrollPerformanceController(settingsModal) {
    const scrollIdleDelay = 200;
    let scrollRafId = null;
    let scrollIdleTimeout = null;

    const setScrollPerformanceMode = (enabled) => {
        const isEnabled = enabled && settingsModal.classList.contains('visible');
        settingsModal.classList.toggle('is-scrolling', isEnabled);
        document.body.classList.toggle('settings-scroll-active', isEnabled);
    };

    const clearScrollPerformanceMode = () => {
        if (scrollIdleTimeout) {
            clearTimeout(scrollIdleTimeout);
            scrollIdleTimeout = null;
        }
        if (scrollRafId !== null) {
            cancelAnimationFrame(scrollRafId);
            scrollRafId = null;
        }
        setScrollPerformanceMode(false);
    };

    const onSettingsScroll = () => {
        if (!settingsModal.classList.contains('visible')) return;
        if (scrollRafId !== null) return;

        scrollRafId = requestAnimationFrame(() => {
            scrollRafId = null;
            setScrollPerformanceMode(true);

            if (scrollIdleTimeout) {
                clearTimeout(scrollIdleTimeout);
            }
            scrollIdleTimeout = setTimeout(() => {
                scrollIdleTimeout = null;
                setScrollPerformanceMode(false);
            }, scrollIdleDelay);
        });
    };

    const onModalHidden = (event) => {
        if (event?.detail?.modalName === 'settings') {
            clearScrollPerformanceMode();
        }
    };

    const onModalShown = (event) => {
        if (event?.detail?.modalName === 'settings') {
            clearScrollPerformanceMode();
        }
    };

    return {
        onSettingsScroll,
        onModalHidden,
        onModalShown,
        clearScrollPerformanceMode,
    };
}

export function setupSettingsScrollPerformanceMode(modalManager) {
    const settingsModal = modalManager?.modals?.settings || document.getElementById('settings-modal');
    const scrollContainer = settingsModal?.querySelector('.settings-scroll-container');
    if (!settingsModal || !scrollContainer) return;

    settingsModal.dataset.wheelLock = 'true';
    settingsModal.querySelector('.modal-content')?.setAttribute('data-wheel-lock', 'true');
    scrollContainer.dataset.wheelLock = 'true';

    // Guard against duplicate setup if this initializer is called again.
    if (scrollContainer.dataset.scrollPerfSetup === 'true') return;
    scrollContainer.dataset.scrollPerfSetup = 'true';

    const controller = createSettingsScrollPerformanceController(settingsModal);
    scrollContainer.addEventListener('scroll', controller.onSettingsScroll, { passive: true });
    window.addEventListener('modalHidden', controller.onModalHidden);
    window.addEventListener('modalShown', controller.onModalShown);

    // Document-level capture-phase wheel listener for Electron.
    // In Electron's Chromium compositor, event.target can resolve to the canvas
    // beneath the settings modal. Since the modal isn't in the canvas's ancestor
    // chain, the scroll container's native scroll never fires. This capture listener
    // uses elementFromPoint to detect when the cursor is over the settings modal
    // and forwards the scroll delta to the settings-scroll-container.
    //
    // Store the handler reference on the modal element so it can be removed if
    // the modal is destroyed and recreated, preventing listener accumulation.
    if (settingsModal._wheelCaptureHandler) {
        document.removeEventListener('wheel', settingsModal._wheelCaptureHandler, { capture: true });
    }

    const captureWheelHandler = (event) => {
        if (!settingsModal.classList.contains('visible')) return;

        // Don't intercept events on <select> elements — let native dropdowns work
        if (event.target?.closest?.('select, option')) return;

        const topElement = (Number.isFinite(event.clientX) && Number.isFinite(event.clientY))
            ? document.elementFromPoint(event.clientX, event.clientY)
            : null;
        if (!topElement) return;

        // Don't intercept when cursor is over a <select> dropdown
        if (topElement.closest?.('select, option')) return;

        // Check if cursor is over the settings modal
        if (!settingsModal.contains(topElement) && topElement !== settingsModal) return;

        // Already handled natively when event.target is inside the modal
        if (event.target && settingsModal.contains(event.target)) return;

        const delta = normalizeWheelDeltaToPixels(event, {
            lineHeight: 20,
            pageHeight: scrollContainer.clientHeight || 600,
            clampPx: null,
        });
        if (!delta) return;

        const currentTop = Number(scrollContainer.scrollTop) || 0;
        const maxScroll = (scrollContainer.scrollHeight || 0) - (scrollContainer.clientHeight || 0);
        const nextTop = Math.max(0, Math.min(maxScroll, currentTop + delta));
        if (Math.abs(nextTop - currentTop) < 0.5) return;

        scrollContainer.scrollTop = nextTop;
        event.preventDefault();
        event.stopPropagation();
    };

    settingsModal._wheelCaptureHandler = captureWheelHandler;
    document.addEventListener('wheel', captureWheelHandler, { capture: true, passive: false });
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

    setupSettingsScrollPerformanceMode(modalManager);

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

    // High scores icon button (start screen)
    const highScoresIconBtn = document.getElementById('highscores-icon-btn');
    if (highScoresIconBtn) {
        highScoresIconBtn.addEventListener('click', () => {
            if (onHighScoresOpen) onHighScoresOpen();
        });
        // Also handle Enter/Space key for accessibility
        highScoresIconBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (onHighScoresOpen) onHighScoresOpen();
            }
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
