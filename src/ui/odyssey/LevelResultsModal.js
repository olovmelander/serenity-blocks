/**
 * @fileoverview Odyssey Mode Level Results Modal
 * Displays results after completing or failing a level.
 */

import { getLevelById, getNextLevel } from '../../core/odyssey/data/levels.js';

/**
 * LevelResultsModal - Shows results after level completion/failure.
 */
export class LevelResultsModal {
    /**
     * Create results modal.
     * @param {Object} options - Configuration options.
     */
    constructor(options = {}) {
        this.onNextLevel = options.onNextLevel || (() => {});
        this.onRetry = options.onRetry || (() => {});
        this.onBackToMenu = options.onBackToMenu || (() => {});

        this.isVisible = false;
        this.currentLevelId = null;
        this.results = null;
        this.isVictory = false;

        this.overlay = null;
        this.modal = null;

        this._initialize();
    }

    _initialize() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'level-results-overlay';
        this.overlay.dataset.odysseyWheelLock = 'true';

        this.modal = document.createElement('div');
        this.modal.className = 'level-results-modal';

        this.overlay.appendChild(this.modal);
        document.body.appendChild(this.overlay);

        this._setupKeyboard();
        console.log('[LevelResultsModal] Initialized');
    }

    _setupKeyboard() {
        this._keyHandler = (e) => {
            if (!this.isVisible) return;

            switch (e.key) {
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (this.isVictory && getNextLevel(this.currentLevelId)) {
                    this._handleNextLevel();
                } else {
                    this._handleRetry();
                }
                break;
            case 'Escape':
                e.preventDefault();
                this._handleBackToMenu();
                break;
            case 'r':
            case 'R':
                e.preventDefault();
                this._handleRetry();
                break;
            }
        };

        document.addEventListener('keydown', this._keyHandler);
    }

    /**
     * Show results for a level.
     * @param {number} levelId - Level ID.
     * @param {Object} results - Level results.
     */
    show(levelId, results) {
        this.currentLevelId = levelId;
        this.results = results;
        this.isVictory = results.victory;

        this._buildContent();

        this.overlay.classList.add('is-visible');
        this.isVisible = true;

        if (this.isVictory) {
            setTimeout(() => this._animateStars(results.stars), 400);
        }

        console.log('[LevelResultsModal] Shown for level:', levelId, results);
    }

    _buildContent() {
        const level = getLevelById(this.currentLevelId) || {};
        const nextLevel = getNextLevel(this.currentLevelId);
        const { results } = this;

        const isNewHighScore = results.previousBest && results.score > results.previousBest.score;
        const isNewBestTime = results.previousBest && results.time < results.previousBest.time;
        const isNewStars = results.previousBest && results.stars > results.previousBest.stars;

        this.modal.classList.toggle('is-victory', this.isVictory);
        this.modal.classList.toggle('is-failure', !this.isVictory);

        const metrics = this._buildMetrics(results.metrics);
        const bonusObjectives = this._buildBonusObjectives(level, results);
        const starsDisplay = this.isVictory ? `
            <div class="stars-display">
                ${[1, 2, 3].map((i) => `<div class="result-star" data-star="${i}">&#9733;</div>`).join('')}
            </div>
        ` : '';
        const nextButton = this.isVictory && nextLevel ? `
            <button class="results-next-btn">Next Level &rarr;</button>
        ` : '';

        this.modal.innerHTML = `
            <div class="status-banner">
                <div class="status-icon">${this.isVictory ? '&#10003;' : '!'}</div>
                <div class="status-title">${this.isVictory ? 'Level Complete' : 'Level Failed'}</div>
            </div>

            <div class="results-level-info">
                <div class="ody-eyebrow">Chapter ${level.chapter || '-'} &middot; Level ${level.chapterLevel || this.currentLevelId}</div>
                <div class="results-level-name">${this._escapeHtml(level.name || 'Odyssey Level')}</div>
            </div>

            ${starsDisplay}

            <div class="results-score-card">
                <div class="results-stat-grid">
                    <div>
                        <div class="ody-stat-label">Score</div>
                        <div class="ody-stat-value is-cyan">${results.score.toLocaleString()}</div>
                        ${isNewHighScore ? '<div class="new-record">New Best</div>' : ''}
                    </div>
                    <div>
                        <div class="ody-stat-label">Lines</div>
                        <div class="ody-stat-value">${results.lines}</div>
                        ${isNewStars ? '<div class="new-record">New Stars</div>' : ''}
                    </div>
                    <div>
                        <div class="ody-stat-label">Time</div>
                        <div class="ody-stat-value is-success">${this._formatTime(results.time)}</div>
                        ${isNewBestTime ? '<div class="new-record">New Best</div>' : ''}
                    </div>
                </div>
                ${metrics}
            </div>

            ${bonusObjectives}

            <div class="results-actions">
                <button class="results-menu-btn">Menu</button>
                <button class="results-retry-btn">Retry</button>
                ${nextButton}
            </div>

            <div class="keyboard-hints">
                Press <span class="hint-key">Enter</span> for ${this.isVictory && nextLevel ? 'next level' : 'retry'} &middot;
                <span class="hint-key">R</span> to retry &middot;
                <span class="hint-key">Esc</span> for menu
            </div>
        `;

        this._setupButtonEvents();
    }

    _buildMetrics(metrics) {
        if (!metrics) return '';

        const items = [];
        if (metrics.cascades) {
            items.push(`<div>Cascades: <span class="results-metric-value">${metrics.cascades}</span></div>`);
        }
        if (metrics.tetrises) {
            items.push(`<div>Tetrises: <span class="results-metric-value">${metrics.tetrises}</span></div>`);
        }
        if (metrics.maxCombo) {
            items.push(`<div>Max Combo: <span class="results-metric-value">${metrics.maxCombo}x</span></div>`);
        }

        if (items.length === 0) return '';
        return `<div class="results-metrics">${items.join('')}</div>`;
    }

    _buildBonusObjectives(level, results) {
        if (!level.victory?.bonuses || level.victory.bonuses.length === 0) {
            return '';
        }

        return `
            <div class="bonus-objectives">
                <div class="ody-section-title">Bonus Objectives</div>
                <div class="bonus-list">
                    ${level.victory.bonuses.map((bonus, i) => {
        const completed = results.bonusesCompleted?.[i];
        return `
                            <div class="bonus-row${completed ? ' is-complete' : ''}">
                                <div class="bonus-check">${completed ? '&#10003;' : ''}</div>
                                <span>${this._escapeHtml(bonus.description)}</span>
                            </div>
                        `;
    }).join('')}
                </div>
            </div>
        `;
    }

    _setupButtonEvents() {
        this.modal.querySelector('.results-menu-btn')?.addEventListener('click', () => this._handleBackToMenu());
        this.modal.querySelector('.results-retry-btn')?.addEventListener('click', () => this._handleRetry());
        this.modal.querySelector('.results-next-btn')?.addEventListener('click', () => this._handleNextLevel());
    }

    _animateStars(earnedStars) {
        const stars = this.modal.querySelectorAll('.result-star');

        stars.forEach((star, index) => {
            const earned = index + 1 <= earnedStars;
            setTimeout(() => {
                star.classList.toggle('earned', earned);
            }, index * 300);
        });
    }

    _formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    _handleNextLevel() {
        const nextLevel = getNextLevel(this.currentLevelId);
        if (nextLevel) {
            this.hide();
            this.onNextLevel(nextLevel.id);
        }
    }

    _handleRetry() {
        this.hide();
        this.onRetry(this.currentLevelId);
    }

    _handleBackToMenu() {
        this.hide();
        this.onBackToMenu();
    }

    hide() {
        this.overlay.classList.remove('is-visible');

        setTimeout(() => {
            this.isVisible = false;
        }, 400);

        console.log('[LevelResultsModal] Hidden');
    }

    getIsVisible() {
        return this.isVisible;
    }

    destroy() {
        document.removeEventListener('keydown', this._keyHandler);

        if (this.overlay && this.overlay.parentElement) {
            this.overlay.parentElement.removeChild(this.overlay);
        }

        console.log('[LevelResultsModal] Destroyed');
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}
