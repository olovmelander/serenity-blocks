/**
 * @fileoverview Modal Management for Serenity Blocks
 * Handles start modal, game-over modal, settings modal, and high scores modal.
 * The game-over, replay-complete and Records sheets are Keystone sheets
 * (public/styles/keystone-modals.css; docs/MENU_UI_OVERHAUL_2026-10.md).
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
import { installSheetInput } from './sheet-input.js';

const MENU_SURFACES = '.modal, .serenity-hub-panel, .match-config-modal, #lobby-browser';

/** Suspend decoration only on menu surfaces covered by a higher menu. */
export function updateMenuCoverage(documentRoot = document) {
    const surfaces = Array.from(documentRoot.querySelectorAll?.(MENU_SURFACES) || []);
    const visible = surfaces.filter((surface) => {
        if (surface.classList.contains('modal')) return surface.classList.contains('visible');
        if (surface.id === 'serenity-hub-panel') return surface.classList.contains('open');
        return !surface.classList.contains('hidden');
    });
    const view = documentRoot.defaultView || globalThis.window;
    const getLayer = (surface) => {
        const layer = Number.parseInt(view?.getComputedStyle?.(surface)?.zIndex, 10);
        if (Number.isFinite(layer)) return layer;
        if (surface.id === 'settings-modal') return 2100;
        if (surface.id === 'serenity-hub-panel') return 2000;
        return 1000;
    };
    let topSurface = null;
    let topLayer = -Infinity;
    visible.forEach((surface) => {
        const layer = getLayer(surface);
        // A later sibling paints above an earlier sibling at the same layer.
        if (layer >= topLayer) {
            topSurface = surface;
            topLayer = layer;
        }
    });
    surfaces.forEach((surface) => {
        surface.classList.toggle('menu-covered', visible.includes(surface) && surface !== topSurface);
    });
    const startMenu = surfaces.find((surface) => surface.id === 'start-modal');
    documentRoot.body?.classList.toggle('start-modal-covered', !!startMenu?.classList.contains('menu-covered'));
    return surfaces;
}

/** Watch menu roots, not their animated descendants or pointer-driven styles. */
export function createMenuCoverageController(documentRoot = document) {
    let trackedSurfaces = null;
    const view = documentRoot.defaultView || globalThis.window;
    const Observer = view?.MutationObserver || globalThis.MutationObserver;
    let observer = null;
    const refresh = () => {
        const surfaces = updateMenuCoverage(documentRoot);
        if (!observer || (surfaces.length === trackedSurfaces?.length
            && surfaces.every((surface, index) => surface === trackedSurfaces[index]))) return;
        observer.disconnect();
        // Menu controllers append their root directly to body when first opened.
        if (documentRoot.body) observer.observe(documentRoot.body, { childList: true });
        surfaces.forEach((surface) => observer.observe(surface, {
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden'],
        }));
        trackedSurfaces = surfaces;
    };
    observer = Observer ? new Observer(refresh) : null;
    ['modalShown', 'modalHidden', 'serenityHubVisibilityChange'].forEach((type) => {
        view?.addEventListener?.(type, refresh);
    });
    refresh();
    return {
        refresh,
        destroy() {
            observer?.disconnect();
            ['modalShown', 'modalHidden', 'serenityHubVisibilityChange'].forEach((type) => {
                view?.removeEventListener?.(type, refresh);
            });
            (trackedSurfaces || []).forEach((surface) => surface.classList.remove('menu-covered'));
            documentRoot.body?.classList.remove('start-modal-covered');
            trackedSurfaces = [];
        },
    };
}

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
        this.menuCoverage = createMenuCoverageController();
        this.gameOverLeaderboardPanel = null;
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
            if (modalName === 'gameOver') this.gameOverLeaderboardPanel?.show();
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
            this.menuCoverage.refresh();
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
            if (modalName === 'gameOver') this.gameOverLeaderboardPanel?.hide();
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
            this.menuCoverage.refresh();
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

    destroy() {
        this.gameOverLeaderboardPanel?.destroy();
        this.gameOverLeaderboardPanel = null;
        this.menuCoverage.destroy();
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

/* ---- Results (game over, replay complete) -------------------------------------
 * Both sheets share one layout: a score hero with rank chips, then four fact tiles
 * (keystone-modals.css). Copy and class names that tests pin are kept: final-stats,
 * "Experimental Session · Unranked", "Not added to legacy rankings", "Career Best",
 * "Rank #N". */

const LEVEL_SPEEDS = [
    1000, 900, 800, 700, 600, 500, 400, 350, 300, 250, 200, 175, 150, 125, 100, 90, 80, 70, 60,
    50,
];

const MEDALS = ['gold', 'silver', 'bronze'];

/** Keycaps for a sheet's primary button: Enter, or A on a controller. */
const PRIMARY_KEYS = '<kbd class="sb-kbd" data-key aria-hidden="true">Enter</kbd>'
    + '<kbd class="sb-kbd" data-pad aria-hidden="true">A</kbd>';

function formatDuration(durationMs) {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Score, pace and efficiency figures shared by game over and replay complete. */
function computeResultFigures({
    score, lines, piecesPlaced, dropInterval,
}, durationMs) {
    const totalMinutes = durationMs / 60000;
    return {
        speed: (LEVEL_SPEEDS[0] / dropInterval).toFixed(1),
        duration: formatDuration(durationMs),
        piecesPerMinute: durationMs > 0 ? Math.round((piecesPlaced / durationMs) * 60000) : 0,
        pointsPerMinute: totalMinutes > 0 ? Math.round(score / totalMinutes) : 0,
        linesPerPiece: piecesPlaced > 0 ? (lines / piecesPlaced).toFixed(2) : '0.00',
        efficiency: piecesPlaced > 0 ? Math.min(100, Math.round((lines / piecesPlaced) * 100)) : 0,
    };
}

function resultRow(label, value, className = '') {
    return `<div class="stat-row"><dt class="stat-label">${label}</dt>`
        + `<dd class="stat-value${className ? ` ${className}` : ''}">${value}</dd></div>`;
}

function resultCard(tone, title, rows) {
    return `<section class="stat-card stat-card-${tone}"><h3 class="stat-card-header">${title}</h3>`
        + `<dl class="stat-list">${rows.join('')}</dl></section>`;
}

/** A signed difference, drawn as a gain or a quiet shortfall (never alarm red). */
function comparisonRow(label, difference) {
    const sign = difference >= 0 ? '+' : '−';
    const tone = difference >= 0 ? 'is-up' : 'is-down';
    return resultRow(label, `${sign}${Math.abs(difference).toLocaleString()}`, `stat-comparison ${tone}`);
}

function rankChips(rank, score, { emptyLabel = '' } = {}) {
    // A game of 0 points tops an empty table, but it is not a record.
    if (!(score > 0)) return emptyLabel ? `<span class="ranking-display sb-chip">${emptyLabel}</span>` : '';
    if (rank === 1) {
        return `<span class="ranking-display sb-chip sb-chip--gold">${csIcon('trophy', 12, 'ranking-icon-svg')}`
            + '<span>New record</span></span>';
    }
    if (rank > 1 && rank <= 10) {
        return `<span class="ranking-display sb-chip sb-chip--accent">Rank #${rank}</span>`
            + '<span class="stat-badge sb-chip">Top 10</span>';
    }
    if (rank > 0) return `<span class="ranking-display sb-chip">Rank #${rank}</span>`;
    return emptyLabel ? `<span class="ranking-display sb-chip">${emptyLabel}</span>` : '';
}

function resultsHero(score, chips, label = 'Final score') {
    return `<div class="stats-header">
                <div class="results-score">
                    <p class="sb-eyebrow sb-eyebrow--quiet results-score__label">${label}</p>
                    <div class="score-display">${score.toLocaleString()}</div>
                </div>
                <div class="results-chips">${chips}</div>
            </div>`;
}

function performanceCard({ level, lines, piecesPlaced }, figures) {
    return resultCard('purple', 'Performance', [
        resultRow('Level', level),
        resultRow('Speed', `${figures.speed}×`),
        resultRow('Lines', lines),
        resultRow('Pieces', piecesPlaced),
    ]);
}

function paceCard(figures) {
    return resultCard('cyan', 'Pace', [
        resultRow('Points per minute', figures.pointsPerMinute.toLocaleString()),
        resultRow('Pieces per minute', figures.piecesPerMinute),
        resultRow('Lines per piece', figures.linesPerPiece),
        resultRow('Efficiency', `${figures.efficiency}%`),
    ]);
}

function careerCard(stats) {
    return resultCard('gold', 'Career Best', [
        resultRow('Best score', stats.highestScore.toLocaleString()),
        resultRow('Highest level', stats.highestLevel),
        resultRow('Games', stats.totalGames),
        resultRow('Lines cleared', stats.totalLines.toLocaleString()),
    ]);
}

function sessionCard(title, score, stats) {
    const personalBest = stats.highestScore > score ? stats.highestScore : null;
    const averageScore = stats.totalGames > 0 ? Math.round(stats.totalScore / stats.totalGames) : 0;
    return resultCard('green', title, [
        resultRow('Score', score.toLocaleString()),
        personalBest ? comparisonRow('Versus best', score - personalBest) : '',
        comparisonRow('Versus average', score - averageScore),
        resultRow('Average score', averageScore.toLocaleString()),
    ]);
}

function setText(id, text) {
    const element = typeof document !== 'undefined' ? document.getElementById(id) : null;
    if (element) element.textContent = text;
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
        score, lines, level, startTime,
    } = gameState;
    const includeLegacyResults = options.includeLegacyResults !== false;
    const shouldPresent = typeof options.shouldPresent === 'function'
        ? options.shouldPresent
        : () => true;

    if (!shouldPresent()) {
        return false;
    }
    modalManager.gameOverLeaderboardPanel?.destroy();
    modalManager.gameOverLeaderboardPanel = null;

    const figures = computeResultFigures(gameState, Date.now() - startTime);
    const modeName = gameState?.isInfinityMode ? 'Infinity' : 'Single Player';
    setText('game-over-eyebrow', `${modeName} · Game over`);

    if (!includeLegacyResults) {
        const unrankedChips = '<span class="ranking-display sb-chip sb-chip--accent">'
            + 'Experimental Session · Unranked</span><span class="stat-badge sb-chip">Separate ruleset</span>';
        const unrankedSession = resultCard('green', `Session · ${figures.duration}`, [
            resultRow('Score', score.toLocaleString()),
            resultRow('Status', 'Not added to legacy rankings', 'stat-value--text'),
        ]);
        document.getElementById('final-stats').innerHTML = `
            ${resultsHero(score, unrankedChips)}
            <div class="stats-grid">
                ${performanceCard(gameState, figures)}
                ${paceCard(figures)}
                ${unrankedSession}
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

        document.getElementById('final-stats').innerHTML = `
            ${resultsHero(score, rankChips(rank, score))}
            <div class="stats-grid">
                ${performanceCard(gameState, figures)}
                ${paceCard(figures)}
                ${careerCard(stats)}
                ${sessionCard(`Session · ${figures.duration}`, score, stats)}
            </div>
            <div class="steam-leaderboard-host" id="steam-leaderboard-host"></div>
        `;

        // Only mount the Steam leaderboard panel when leaderboards are actually
        // available. In a non-Steam/browser build it would render an "unavailable"
        // shell (~260px) that adds nothing but forces the modal to scroll.
        const leaderboardHost = document.getElementById('steam-leaderboard-host');
        if (leaderboardHost && steamService.capabilities?.leaderboards && shouldPresent()) {
            const isInfinity = !!gameState?.isInfinityMode;
            const sessionStart = gameState?.infinityStats?.sessionStartTime || gameState.startTime || Date.now();
            const durationSeconds = Math.max(1, Math.round((Date.now() - sessionStart) / 1000));
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
                title: isInfinity ? 'Infinity leaderboards' : 'Single Player leaderboards',
                boards,
                defaultBoardId: boards[0]?.id,
            });

            leaderboardPanel.mount(leaderboardHost);
            modalManager.gameOverLeaderboardPanel = leaderboardPanel;
        }
    } catch (error) {
        if (!shouldPresent()) {
            return false;
        }
        console.error('Error displaying game over stats:', error);
        // Fallback display
        const thisGame = resultCard('purple', 'This game', [
            resultRow('Level', level),
            resultRow('Speed', `${figures.speed}×`),
            resultRow('Lines', lines),
        ]);
        document.getElementById('final-stats').innerHTML = `
            ${resultsHero(score, '')}
            <div class="stats-grid">${thisGame}</div>
        `;
    }

    return presentGameOverModal(modalManager, callbacks, shouldPresent);
}

/**
 * Keep clicks inside a results sheet from reaching the document-level "tap anywhere
 * to restart" handler (controls.js): reading the stats or a leaderboard must not start
 * a new game. Tapping the dimmed area around the sheet still does.
 */
function containSheetClicks(modalId) {
    const sheet = typeof document !== 'undefined'
        ? document.getElementById(modalId)?.querySelector?.('.modal-content')
        : null;
    if (!sheet || sheet.dataset.clicksContained === 'true') return;
    sheet.dataset.clicksContained = 'true';
    sheet.addEventListener('click', (event) => event.stopPropagation());
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
            <button type="button" id="game-over-play-again" class="sb-btn sb-btn--primary">
                ${csIcon('play', 16, 'btn-icon-svg')}<span>Play again</span>
                ${PRIMARY_KEYS}
            </button>
            <button type="button" id="game-over-main-menu" class="sb-btn">
                ${csIcon('home', 16, 'btn-icon-svg')}<span>Main menu</span>
            </button>
        `;

        // The same restart Space, Enter and a controller face button trigger.
        document.getElementById('game-over-play-again')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (callbacks.onRestart) callbacks.onRestart();
            else globalThis.window?.startGame?.();
        });

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
    containSheetClicks('game-over-modal');

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
    const state = {
        score, lines, level, dropInterval, piecesPlaced,
    };

    let duration = 0;
    if (Number.isFinite(gameState?.simTimeMs)) duration = gameState.simTimeMs;
    else if (startTime) duration = Date.now() - startTime;
    const figures = computeResultFigures(state, duration);

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

    document.getElementById('demo-final-stats').innerHTML = `
        ${resultsHero(score, rankChips(rank, score), 'Replay score')}
        <div class="stats-grid">
            ${performanceCard(state, figures)}
            ${paceCard(figures)}
            ${careerCard(stats)}
            ${sessionCard(`Replay · ${figures.duration}`, score, stats)}
        </div>
    `;

    // Render Buttons
    const buttonsContainer = document.getElementById('demo-complete-buttons');
    if (buttonsContainer) {
        buttonsContainer.innerHTML = `
            <button type="button" id="demo-watch-again" class="sb-btn sb-btn--primary">
                ${csIcon('play', 16, 'btn-icon-svg')}<span>Watch again</span>
                ${PRIMARY_KEYS}
            </button>
            <button type="button" id="demo-browse-replays" class="sb-btn">
                ${csIcon('folder', 16, 'btn-icon-svg')}<span>Browse replays</span>
            </button>
            <button type="button" id="demo-main-menu" class="sb-btn sb-btn--quiet">
                ${csIcon('home', 16, 'btn-icon-svg')}<span>Main menu</span>
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

function formatRecordDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function recordRow(score, index, { showReplay, canPlay }) {
    const medal = MEDALS[index] || '';
    const points = score.score.toLocaleString();
    const lineWord = score.lines === 1 ? 'line' : 'lines';
    let replay = '';
    if (showReplay) {
        replay = score.demoId && canPlay
            ? `<button type="button" class="play-demo-btn hs-play sb-btn" data-demo-id="${score.demoId}"
                    aria-label="Watch the replay of ${points}">
                    ${csIcon('play', 12, 'btn-icon-svg')}<span>Watch</span>
                </button>`
            : '<span class="hs-play hs-play--empty" aria-hidden="true"></span>';
    }
    const stamp = score.timestamp ? new Date(score.timestamp) : null;
    const iso = stamp && !Number.isNaN(stamp.getTime()) ? stamp.toISOString() : '';
    return `
        <li class="hs-row${medal ? ` hs-row--${medal}` : ''}">
            <span class="hs-rank">${index + 1}</span>
            <div class="hs-main">
                <div class="hs-score">${points}</div>
                <div class="hs-meta">Level ${score.level} · ${score.lines} ${lineWord}</div>
            </div>
            <time class="hs-date"${iso ? ` datetime="${iso}"` : ''}>${formatRecordDate(score.timestamp)}</time>
            ${replay}
        </li>`;
}

/**
 * Shows the high scores modal with scores and statistics
 * @param {ModalManager} modalManager - Modal manager instance
 * @param {Object} highScoreManager - High score manager instance
 * @param {Function} [onPlayDemo] - Optional callback to play a demo by ID: (demoId) => void
 */
export async function showHighScoresModal(modalManager, highScoreManager, onPlayDemo = null) {
    const list = document.getElementById('high-scores-list');
    const statistics = document.getElementById('statistics-section');
    try {
        const topScores = await highScoreManager.getTopScores(10);
        const stats = await highScoreManager.getStatistics();

        if (topScores.length === 0) {
            list.innerHTML = `
                <div class="sb-empty hs-empty">
                    <span class="sb-empty__icon" aria-hidden="true">${csIcon('trophy', 26)}</span>
                    <p class="sb-empty__title">No records yet — your first game will set one.</p>
                    <button type="button" class="sb-btn hs-empty__close">Close</button>
                </div>`;
            statistics.innerHTML = '';
            list.querySelector('.hs-empty__close')?.addEventListener('click', () => {
                document.getElementById('close-high-scores')?.click();
            });
        } else {
            const showReplay = topScores.some((score) => score.demoId);
            const rows = topScores
                .map((score, index) => recordRow(score, index, { showReplay, canPlay: Boolean(onPlayDemo) }))
                .join('');
            list.innerHTML = `
                <h2 class="sb-sheet__section-title">Top scores</h2>
                <ol class="hs-leaderboard${showReplay ? ' hs-leaderboard--demos' : ''}">${rows}</ol>`;

            if (onPlayDemo) {
                list.querySelectorAll('.play-demo-btn').forEach((btn) => {
                    btn.addEventListener('click', (e) => {
                        const demoId = parseInt(e.currentTarget.dataset.demoId, 10);
                        modalManager.hide('highScores');
                        onPlayDemo(demoId);
                    });
                });
            }

            const games = stats.totalGames;
            const facts = [
                ['Games', games.toLocaleString()],
                ['Best score', stats.highestScore.toLocaleString()],
                ['Highest level', stats.highestLevel],
                ['Lines cleared', stats.totalLines.toLocaleString()],
                ['Average score', games > 0 ? Math.round(stats.totalScore / games).toLocaleString() : '0'],
                ['Average lines', games > 0 ? Math.round(stats.totalLines / games).toLocaleString() : '0'],
            ];
            statistics.innerHTML = `
                <h2 class="sb-sheet__section-title">Statistics</h2>
                <dl class="hs-stats-grid">${facts.map(([label, value]) => `
                    <div class="hs-stat">
                        <dt class="hs-stat-label">${label}</dt><dd class="hs-stat-value">${value}</dd>
                    </div>`).join('')}
                </dl>`;
        }
    } catch (error) {
        console.error('Error loading high scores:', error);
        list.innerHTML = '<p class="hs-error">Records could not be loaded. Close this and try again.</p>';
        statistics.innerHTML = '';
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

    setupSettingsScrollPerformanceMode(modalManager);
    // Escape as the way back, focus on open, Tab kept inside the open sheet.
    installSheetInput();

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
        // defaultPrevented: an open option list took this Escape (sheet-input.js).
        if (event.key === 'Escape' && modalManager.isVisible('settings') && !event.defaultPrevented) {
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
