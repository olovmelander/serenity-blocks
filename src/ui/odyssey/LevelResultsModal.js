/**
 * @fileoverview Odyssey Mode Level Results Modal
 * Displays results after completing or failing a level
 */

import { getLevelById, getNextLevel } from '../../core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';

/**
 * LevelResultsModal - Shows results after level completion/failure
 *
 * Features:
 * - Victory or failure display
 * - Star rating animation
 * - Score and statistics
 * - Bonus objectives completion
 * - New records highlight
 * - Next level / retry options
 */
export class LevelResultsModal {
    /**
     * Create results modal
     * @param {Object} options - Configuration options
     */
    constructor(options = {}) {
        // Callbacks
        this.onNextLevel = options.onNextLevel || (() => {});
        this.onRetry = options.onRetry || (() => {});
        this.onBackToMenu = options.onBackToMenu || (() => {});

        // State
        this.isVisible = false;
        this.currentLevelId = null;
        this.results = null;
        this.isVictory = false;

        // DOM elements
        this.overlay = null;
        this.modal = null;

        // Initialize
        this._initialize();
    }

    /**
     * Initialize modal
     * @private
     */
    _initialize() {
        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'level-results-overlay';
        this.overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(12px);
            z-index: 1200;
            display: none;
            justify-content: center;
            align-items: center;
            opacity: 0;
            transition: opacity 0.4s ease;
        `;

        // Create modal
        this.modal = document.createElement('div');
        this.modal.className = 'level-results-modal';
        this.modal.style.cssText = `
            width: min(550px, 90vw);
            max-height: 90vh;
            background: linear-gradient(165deg,
                rgba(25, 15, 50, 0.98) 0%,
                rgba(15, 10, 35, 0.98) 100%);
            border: 2px solid rgba(180, 130, 255, 0.4);
            border-radius: 24px;
            padding: 40px;
            font-family: 'Orbitron', 'Segoe UI', sans-serif;
            color: #fff;
            box-shadow:
                0 24px 80px rgba(0, 0, 0, 0.6),
                0 0 100px rgba(180, 130, 255, 0.2);
            transform: scale(0.8) translateY(20px);
            transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            overflow-y: auto;
            text-align: center;
        `;

        this.overlay.appendChild(this.modal);
        document.body.appendChild(this.overlay);

        // Setup keyboard
        this._setupKeyboard();

        console.log('[LevelResultsModal] Initialized');
    }

    /**
     * Setup keyboard handlers
     * @private
     */
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
     * Show results for a level
     * @param {number} levelId - Level ID
     * @param {Object} results - Level results
     * @param {boolean} results.victory - Whether level was completed
     * @param {number} results.stars - Stars earned (0-3)
     * @param {number} results.score - Final score
     * @param {number} results.lines - Lines cleared
     * @param {number} results.time - Time in milliseconds
     * @param {Object} results.metrics - Additional metrics
     * @param {boolean[]} results.bonusesCompleted - Bonus completion status
     * @param {Object} results.previousBest - Previous best results (if any)
     */
    show(levelId, results) {
        this.currentLevelId = levelId;
        this.results = results;
        this.isVictory = results.victory;

        this._buildContent();

        this.overlay.style.display = 'flex';
        this.isVisible = true;

        // Animate in
        requestAnimationFrame(() => {
            this.overlay.style.opacity = '1';
            this.modal.style.transform = 'scale(1) translateY(0)';

            // Animate stars after modal appears
            if (this.isVictory) {
                setTimeout(() => this._animateStars(results.stars), 400);
            }
        });

        console.log('[LevelResultsModal] Shown for level:', levelId, results);
    }

    /**
     * Build modal content
     * @private
     */
    _buildContent() {
        const level = getLevelById(this.currentLevelId);
        const nextLevel = getNextLevel(this.currentLevelId);
        const results = this.results;

        // Check for new records
        const isNewHighScore = results.previousBest && results.score > results.previousBest.score;
        const isNewBestTime = results.previousBest && results.time < results.previousBest.time;
        const isNewStars = results.previousBest && results.stars > results.previousBest.stars;

        this.modal.innerHTML = `
            <!-- Status Banner -->
            <div class="status-banner" style="
                margin: -40px -40px 30px -40px;
                padding: 24px;
                background: ${this.isVictory
                    ? 'linear-gradient(135deg, rgba(100, 255, 150, 0.2), rgba(100, 200, 255, 0.2))'
                    : 'linear-gradient(135deg, rgba(255, 100, 100, 0.2), rgba(255, 150, 100, 0.2))'};
                border-bottom: 2px solid ${this.isVictory ? 'rgba(100, 255, 150, 0.4)' : 'rgba(255, 100, 100, 0.4)'};
                border-radius: 22px 22px 0 0;
            ">
                <div style="font-size: 36px; margin-bottom: 8px;">
                    ${this.isVictory ? '🎉' : '💫'}
                </div>
                <div style="
                    font-size: 28px;
                    font-weight: 700;
                    color: ${this.isVictory ? 'rgba(100, 255, 150, 1)' : 'rgba(255, 150, 100, 1)'};
                    text-shadow: 0 0 30px ${this.isVictory ? 'rgba(100, 255, 150, 0.5)' : 'rgba(255, 150, 100, 0.5)'};
                    letter-spacing: 3px;
                ">
                    ${this.isVictory ? 'LEVEL COMPLETE!' : 'LEVEL FAILED'}
                </div>
            </div>

            <!-- Level Info -->
            <div style="margin-bottom: 24px;">
                <div style="font-size: 12px; color: rgba(180, 130, 255, 0.7); letter-spacing: 1.5px; margin-bottom: 4px;">
                    CHAPTER ${level.chapter} • LEVEL ${level.chapterLevel}
                </div>
                <div style="font-size: 22px; font-weight: 600;">${level.name}</div>
            </div>

            <!-- Stars Display -->
            ${this.isVictory ? `
            <div class="stars-display" style="
                margin-bottom: 30px;
                display: flex;
                justify-content: center;
                gap: 16px;
            ">
                ${[1, 2, 3].map(i => `
                    <div class="result-star" data-star="${i}" style="
                        font-size: 48px;
                        color: rgba(255, 200, 100, 0.2);
                        transition: all 0.4s ease;
                        transform: scale(0.8);
                        filter: drop-shadow(0 0 0 transparent);
                    ">★</div>
                `).join('')}
            </div>
            ` : ''}

            <!-- Score Card -->
            <div style="
                background: rgba(0, 0, 0, 0.3);
                border-radius: 16px;
                padding: 20px;
                margin-bottom: 24px;
            ">
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
                    <div>
                        <div style="font-size: 10px; color: rgba(255, 255, 255, 0.5); letter-spacing: 1px; margin-bottom: 4px;">SCORE</div>
                        <div style="font-size: 24px; font-weight: 700; color: rgba(100, 220, 255, 1);">
                            ${results.score.toLocaleString()}
                        </div>
                        ${isNewHighScore ? '<div style="font-size: 10px; color: rgba(255, 200, 100, 1); margin-top: 4px;">NEW BEST!</div>' : ''}
                    </div>
                    <div>
                        <div style="font-size: 10px; color: rgba(255, 255, 255, 0.5); letter-spacing: 1px; margin-bottom: 4px;">LINES</div>
                        <div style="font-size: 24px; font-weight: 700; color: rgba(180, 130, 255, 1);">
                            ${results.lines}
                        </div>
                    </div>
                    <div>
                        <div style="font-size: 10px; color: rgba(255, 255, 255, 0.5); letter-spacing: 1px; margin-bottom: 4px;">TIME</div>
                        <div style="font-size: 24px; font-weight: 700; color: rgba(100, 255, 150, 1);">
                            ${this._formatTime(results.time)}
                        </div>
                        ${isNewBestTime ? '<div style="font-size: 10px; color: rgba(255, 200, 100, 1); margin-top: 4px;">NEW BEST!</div>' : ''}
                    </div>
                </div>

                <!-- Additional Stats -->
                ${results.metrics ? `
                <div style="
                    display: flex;
                    justify-content: center;
                    gap: 24px;
                    margin-top: 16px;
                    padding-top: 16px;
                    border-top: 1px solid rgba(255, 255, 255, 0.1);
                    font-size: 12px;
                ">
                    ${results.metrics.cascades ? `
                        <div>
                            <span style="color: rgba(255, 255, 255, 0.5);">Cascades:</span>
                            <span style="color: rgba(255, 200, 100, 1); font-weight: 600; margin-left: 4px;">${results.metrics.cascades}</span>
                        </div>
                    ` : ''}
                    ${results.metrics.tetrises ? `
                        <div>
                            <span style="color: rgba(255, 255, 255, 0.5);">Tetrises:</span>
                            <span style="color: rgba(100, 220, 255, 1); font-weight: 600; margin-left: 4px;">${results.metrics.tetrises}</span>
                        </div>
                    ` : ''}
                    ${results.metrics.maxCombo ? `
                        <div>
                            <span style="color: rgba(255, 255, 255, 0.5);">Max Combo:</span>
                            <span style="color: rgba(180, 130, 255, 1); font-weight: 600; margin-left: 4px;">${results.metrics.maxCombo}x</span>
                        </div>
                    ` : ''}
                </div>
                ` : ''}
            </div>

            <!-- Bonus Objectives -->
            ${level.victory.bonuses && level.victory.bonuses.length > 0 ? `
            <div style="margin-bottom: 24px;">
                <div style="font-size: 11px; color: rgba(180, 130, 255, 0.7); letter-spacing: 1.5px; margin-bottom: 12px;">
                    BONUS OBJECTIVES
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${level.victory.bonuses.map((bonus, i) => {
                        const completed = results.bonusesCompleted?.[i];
                        return `
                            <div style="
                                display: flex;
                                align-items: center;
                                gap: 10px;
                                padding: 10px 16px;
                                background: ${completed ? 'rgba(100, 255, 150, 0.1)' : 'rgba(0, 0, 0, 0.2)'};
                                border: 1px solid ${completed ? 'rgba(100, 255, 150, 0.3)' : 'rgba(255, 255, 255, 0.1)'};
                                border-radius: 8px;
                                font-size: 12px;
                            ">
                                <div style="
                                    width: 20px;
                                    height: 20px;
                                    border-radius: 50%;
                                    background: ${completed ? 'rgba(100, 255, 150, 0.3)' : 'transparent'};
                                    border: 2px solid ${completed ? 'rgba(100, 255, 150, 0.8)' : 'rgba(255, 255, 255, 0.2)'};
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    color: rgba(100, 255, 150, 1);
                                    font-size: 12px;
                                ">${completed ? '✓' : ''}</div>
                                <span style="color: ${completed ? 'rgba(100, 255, 150, 1)' : 'rgba(255, 255, 255, 0.5)'};">
                                    ${bonus.description}
                                </span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
            ` : ''}

            <!-- Actions -->
            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                <button class="results-menu-btn" style="
                    flex: 1;
                    min-width: 120px;
                    padding: 14px 20px;
                    background: rgba(255, 255, 255, 0.1);
                    border: 2px solid rgba(255, 255, 255, 0.2);
                    border-radius: 12px;
                    color: #fff;
                    font-family: inherit;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                ">Menu</button>

                <button class="results-retry-btn" style="
                    flex: 1;
                    min-width: 120px;
                    padding: 14px 20px;
                    background: rgba(255, 200, 100, 0.15);
                    border: 2px solid rgba(255, 200, 100, 0.4);
                    border-radius: 12px;
                    color: rgba(255, 200, 100, 1);
                    font-family: inherit;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                ">Retry</button>

                ${this.isVictory && nextLevel ? `
                <button class="results-next-btn" style="
                    flex: 2;
                    min-width: 160px;
                    padding: 14px 24px;
                    background: linear-gradient(135deg, rgba(100, 255, 150, 0.8), rgba(100, 200, 255, 0.8));
                    border: none;
                    border-radius: 12px;
                    color: #fff;
                    font-family: inherit;
                    font-size: 15px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    box-shadow: 0 4px 20px rgba(100, 255, 150, 0.3);
                    letter-spacing: 1px;
                ">Next Level →</button>
                ` : ''}
            </div>

            <!-- Keyboard hints -->
            <div style="
                margin-top: 20px;
                font-size: 10px;
                color: rgba(255, 255, 255, 0.3);
            ">
                Press <span style="color: rgba(180, 130, 255, 0.6);">Enter</span> for ${this.isVictory && nextLevel ? 'next level' : 'retry'} •
                <span style="color: rgba(180, 130, 255, 0.6);">R</span> to retry •
                <span style="color: rgba(180, 130, 255, 0.6);">Esc</span> for menu
            </div>
        `;

        // Setup button events
        this._setupButtonEvents();
    }

    /**
     * Setup button event listeners
     * @private
     */
    _setupButtonEvents() {
        const menuBtn = this.modal.querySelector('.results-menu-btn');
        const retryBtn = this.modal.querySelector('.results-retry-btn');
        const nextBtn = this.modal.querySelector('.results-next-btn');

        if (menuBtn) {
            menuBtn.addEventListener('click', () => this._handleBackToMenu());
            menuBtn.addEventListener('mouseenter', () => {
                menuBtn.style.background = 'rgba(255, 255, 255, 0.2)';
            });
            menuBtn.addEventListener('mouseleave', () => {
                menuBtn.style.background = 'rgba(255, 255, 255, 0.1)';
            });
        }

        if (retryBtn) {
            retryBtn.addEventListener('click', () => this._handleRetry());
            retryBtn.addEventListener('mouseenter', () => {
                retryBtn.style.background = 'rgba(255, 200, 100, 0.25)';
            });
            retryBtn.addEventListener('mouseleave', () => {
                retryBtn.style.background = 'rgba(255, 200, 100, 0.15)';
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => this._handleNextLevel());
            nextBtn.addEventListener('mouseenter', () => {
                nextBtn.style.transform = 'translateY(-2px)';
                nextBtn.style.boxShadow = '0 6px 24px rgba(100, 255, 150, 0.5)';
            });
            nextBtn.addEventListener('mouseleave', () => {
                nextBtn.style.transform = 'translateY(0)';
                nextBtn.style.boxShadow = '0 4px 20px rgba(100, 255, 150, 0.3)';
            });
        }
    }

    /**
     * Animate stars appearing
     * @private
     * @param {number} earnedStars - Number of stars earned
     */
    _animateStars(earnedStars) {
        const stars = this.modal.querySelectorAll('.result-star');

        stars.forEach((star, index) => {
            const delay = index * 300;
            const earned = index + 1 <= earnedStars;

            setTimeout(() => {
                if (earned) {
                    star.style.color = 'rgba(255, 200, 100, 1)';
                    star.style.transform = 'scale(1.2)';
                    star.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 100, 0.8))';

                    // Bounce effect
                    setTimeout(() => {
                        star.style.transform = 'scale(1)';
                    }, 150);
                } else {
                    star.style.transform = 'scale(1)';
                }
            }, delay);
        });
    }

    /**
     * Format time in milliseconds to mm:ss
     * @private
     */
    _formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Handle next level button
     * @private
     */
    _handleNextLevel() {
        const nextLevel = getNextLevel(this.currentLevelId);
        if (nextLevel) {
            this.hide();
            this.onNextLevel(nextLevel.id);
        }
    }

    /**
     * Handle retry button
     * @private
     */
    _handleRetry() {
        this.hide();
        this.onRetry(this.currentLevelId);
    }

    /**
     * Handle back to menu button
     * @private
     */
    _handleBackToMenu() {
        this.hide();
        this.onBackToMenu();
    }

    /**
     * Hide the modal
     */
    hide() {
        this.overlay.style.opacity = '0';
        this.modal.style.transform = 'scale(0.8) translateY(20px)';

        setTimeout(() => {
            this.overlay.style.display = 'none';
            this.isVisible = false;
        }, 400);

        console.log('[LevelResultsModal] Hidden');
    }

    /**
     * Check if modal is visible
     * @returns {boolean}
     */
    getIsVisible() {
        return this.isVisible;
    }

    /**
     * Destroy modal and clean up
     */
    destroy() {
        document.removeEventListener('keydown', this._keyHandler);

        if (this.overlay && this.overlay.parentElement) {
            this.overlay.parentElement.removeChild(this.overlay);
        }

        console.log('[LevelResultsModal] Destroyed');
    }
}
