/**
 * @fileoverview Infinity Mode HUD Component
 * Displays height, build statistics, and milestone achievements
 */

import { calculateTopRow, calculateBuildHeight, getGridStats } from '../../core/infinity-grid.js';

/**
 * InfinityHUD - Displays infinity-specific statistics and progress
 *
 * Features:
 * - Current height from bottom (in rows)
 * - Top row position (distance from ceiling)
 * - Build height as percentage of max (1000 rows)
 * - Height milestones achieved
 * - Session statistics (blocks placed, combos, etc.)
 */
export class InfinityHUD {
    /**
     * Create HUD component
     */
    constructor() {
        // DOM elements
        this.container = null;
        this.heightDisplay = null;
        this.topRowDisplay = null;
        this.progressBar = null;
        this.milestonesDisplay = null;
        this.statsDisplay = null;

        // Game state reference
        this.gameState = null;

        // Milestones tracking
        this.milestones = [100, 250, 500, 750, 1000];
        this.achievedMilestones = new Set();

        // Initialize
        this._initialize();
    }

    /**
     * Initialize HUD
     * @private
     */
    _initialize() {
        // Create main container
        this.container = document.createElement('div');
        this.container.id = 'infinity-hud';
        this.container.className = 'infinity-hud';
        this.container.style.cssText = `
            position: relative;
            width: 240px;
            background: linear-gradient(180deg, rgba(10, 12, 28, 0.92), rgba(6, 8, 20, 0.92));
            border: 2px solid rgba(100, 200, 255, 0.35);
            border-radius: 16px;
            padding: 20px;
            margin: 0;
            box-shadow:
                0 14px 40px rgba(12, 18, 44, 0.55),
                inset 0 0 24px rgba(80, 150, 255, 0.25);
            font-family: 'Orbitron', monospace;
            color: #fff;
            display: none;
            box-sizing: border-box;
        `;

        // Create title
        const title = document.createElement('div');
        title.className = 'hud-title';
        title.textContent = 'INFINITY';
        title.style.cssText = `
            font-size: 14px;
            font-weight: 700;
            text-align: center;
            margin-bottom: 16px;
            color: rgba(100, 200, 255, 1.0);
            letter-spacing: 2px;
            text-shadow: 0 0 10px rgba(100, 200, 255, 0.5);
        `;
        this.container.appendChild(title);

        // Create height section
        this._createHeightSection();

        // Create progress bar
        this._createProgressBar();

        // Create milestones section
        this._createMilestonesSection();

        // Create stats section
        this._createStatsSection();

        console.log('[InfinityHUD] Initialized');
    }

    /**
     * Create height display section
     * @private
     */
    _createHeightSection() {
        const section = document.createElement('div');
        section.className = 'hud-section height-section';
        section.style.cssText = `
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        `;

        // Build height (from bottom)
        const heightLabel = document.createElement('div');
        heightLabel.textContent = 'BUILD HEIGHT';
        heightLabel.style.cssText = `
            font-size: 9px;
            color: rgba(255, 255, 255, 0.6);
            margin-bottom: 4px;
            letter-spacing: 1px;
        `;
        section.appendChild(heightLabel);

        this.heightDisplay = document.createElement('div');
        this.heightDisplay.className = 'height-value';
        this.heightDisplay.textContent = '0 ROWS';
        this.heightDisplay.style.cssText = `
            font-size: 24px;
            font-weight: 700;
            color: rgba(100, 200, 255, 1.0);
            margin-bottom: 8px;
            text-shadow: 0 0 10px rgba(100, 200, 255, 0.5);
        `;
        section.appendChild(this.heightDisplay);

        // Top row position
        const topRowLabel = document.createElement('div');
        topRowLabel.textContent = 'FROM CEILING';
        topRowLabel.style.cssText = `
            font-size: 9px;
            color: rgba(255, 255, 255, 0.6);
            margin-bottom: 4px;
            letter-spacing: 1px;
        `;
        section.appendChild(topRowLabel);

        this.topRowDisplay = document.createElement('div');
        this.topRowDisplay.className = 'top-row-value';
        this.topRowDisplay.textContent = '— ROWS';
        this.topRowDisplay.style.cssText = `
            font-size: 16px;
            font-weight: 600;
            color: rgba(255, 200, 100, 1.0);
        `;
        section.appendChild(this.topRowDisplay);

        this.container.appendChild(section);
    }

    /**
     * Create progress bar
     * @private
     */
    _createProgressBar() {
        const section = document.createElement('div');
        section.className = 'hud-section progress-section';
        section.style.cssText = `
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        `;

        const label = document.createElement('div');
        label.textContent = 'PROGRESS';
        label.style.cssText = `
            font-size: 9px;
            color: rgba(255, 255, 255, 0.6);
            margin-bottom: 6px;
            letter-spacing: 1px;
        `;
        section.appendChild(label);

        // Progress bar container
        const barContainer = document.createElement('div');
        barContainer.style.cssText = `
            width: 100%;
            height: 8px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            overflow: hidden;
            position: relative;
        `;

        this.progressBar = document.createElement('div');
        this.progressBar.className = 'progress-fill';
        this.progressBar.style.cssText = `
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg,
                rgba(100, 200, 255, 0.8) 0%,
                rgba(100, 255, 200, 0.8) 100%);
            border-radius: 4px;
            transition: width 0.3s ease;
            box-shadow: 0 0 10px rgba(100, 200, 255, 0.5);
        `;
        barContainer.appendChild(this.progressBar);

        section.appendChild(barContainer);

        // Percentage text
        this.progressText = document.createElement('div');
        this.progressText.textContent = '0.0%';
        this.progressText.style.cssText = `
            font-size: 11px;
            color: rgba(255, 255, 255, 0.8);
            margin-top: 4px;
            text-align: right;
        `;
        section.appendChild(this.progressText);

        this.container.appendChild(section);
    }

    /**
     * Create milestones section
     * @private
     */
    _createMilestonesSection() {
        const section = document.createElement('div');
        section.className = 'hud-section milestones-section';
        section.style.cssText = `
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        `;

        const label = document.createElement('div');
        label.textContent = 'MILESTONES';
        label.style.cssText = `
            font-size: 9px;
            color: rgba(255, 255, 255, 0.6);
            margin-bottom: 8px;
            letter-spacing: 1px;
        `;
        section.appendChild(label);

        this.milestonesDisplay = document.createElement('div');
        this.milestonesDisplay.className = 'milestones-list';
        this.milestonesDisplay.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        `;

        // Create milestone badges
        this.milestones.forEach(milestone => {
            const badge = document.createElement('div');
            badge.className = 'milestone-badge';
            badge.dataset.milestone = milestone;
            badge.textContent = milestone;
            badge.style.cssText = `
                padding: 4px 8px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 4px;
                font-size: 11px;
                color: rgba(255, 255, 255, 0.4);
                transition: all 0.3s ease;
            `;
            this.milestonesDisplay.appendChild(badge);
        });

        section.appendChild(this.milestonesDisplay);
        this.container.appendChild(section);
    }

    /**
     * Create statistics section
     * @private
     */
    _createStatsSection() {
        const section = document.createElement('div');
        section.className = 'hud-section stats-section';

        const label = document.createElement('div');
        label.textContent = 'STATISTICS';
        label.style.cssText = `
            font-size: 9px;
            color: rgba(255, 255, 255, 0.6);
            margin-bottom: 8px;
            letter-spacing: 1px;
        `;
        section.appendChild(label);

        this.statsDisplay = document.createElement('div');
        this.statsDisplay.className = 'stats-list';
        this.statsDisplay.style.cssText = `
            font-size: 11px;
            line-height: 1.6;
            color: rgba(255, 255, 255, 0.8);
        `;
        this.statsDisplay.innerHTML = `
            <div class="stat-row" style="display: flex; justify-content: space-between;">
                <span>Blocks:</span>
                <span id="stat-blocks">0</span>
            </div>
            <div class="stat-row" style="display: flex; justify-content: space-between;">
                <span>Lines:</span>
                <span id="stat-lines">0</span>
            </div>
            <div class="stat-row" style="display: flex; justify-content: space-between;">
                <span>Score:</span>
                <span id="stat-score">0</span>
            </div>
            <div class="stat-row" style="display: flex; justify-content: space-between; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
                <span style="color: rgba(255, 200, 100, 0.9);">Max Combo:</span>
                <span id="stat-combo" style="color: rgba(255, 200, 100, 1.0); font-weight: 600;">0</span>
            </div>
            <div class="stat-row" style="display: flex; justify-content: space-between;">
                <span style="color: rgba(255, 200, 100, 0.9);">Complexity:</span>
                <span id="stat-complexity" style="color: rgba(255, 200, 100, 1.0); font-weight: 600;">0</span>
            </div>
            <div class="stat-row" style="display: flex; justify-content: space-between;">
                <span style="color: rgba(255, 200, 100, 0.9);">Cascades:</span>
                <span id="stat-cascades" style="color: rgba(255, 200, 100, 1.0); font-weight: 600;">0</span>
            </div>
        `;

        section.appendChild(this.statsDisplay);
        this.container.appendChild(section);
    }

    /**
     * Show HUD
     */
    show() {
        const panel = document.getElementById('infinity-side-panels')
            || document.getElementById('single-player-container');

        if (panel && this.container.parentElement !== panel) {
            panel.appendChild(this.container);
        }

        this.container.style.display = 'block';
        console.log('[InfinityHUD] Shown');
    }

    /**
     * Hide HUD
     */
    hide() {
        this.container.style.display = 'none';
        console.log('[InfinityHUD] Hidden');
    }

    /**
     * Update HUD with current game state
     * @param {Object} gameState - Current game state
     */
    update(gameState) {
        this.gameState = gameState;

        if (!this.gameState) return;

        // Update height displays
        this._updateHeightDisplays();

        // Update progress bar
        this._updateProgressBar();

        // Update milestones
        this._updateMilestones();

        // Update statistics
        this._updateStatistics();
    }

    /**
     * Update height displays
     * @private
     */
    _updateHeightDisplays() {
        const buildHeight = calculateBuildHeight(this.gameState);
        const topRow = calculateTopRow(this.gameState);
        const totalRows = this.gameState.board.length;

        // Build height from bottom
        this.heightDisplay.textContent = `${buildHeight} ROWS`;

        // Top row (distance from ceiling)
        if (buildHeight > 0) {
            this.topRowDisplay.textContent = `${topRow} ROWS`;
        } else {
            this.topRowDisplay.textContent = '— ROWS';
        }
    }

    /**
     * Update progress bar
     * @private
     */
    _updateProgressBar() {
        const buildHeight = calculateBuildHeight(this.gameState);
        const maxRows = this.gameState.maxRows || 1000;
        const percentage = (buildHeight / maxRows) * 100;

        this.progressBar.style.width = `${percentage}%`;
        this.progressText.textContent = `${percentage.toFixed(1)}%`;

        // Change color based on progress
        if (percentage >= 75) {
            this.progressBar.style.background = 'linear-gradient(90deg, rgba(255, 100, 100, 0.8) 0%, rgba(255, 200, 100, 0.8) 100%)';
        } else if (percentage >= 50) {
            this.progressBar.style.background = 'linear-gradient(90deg, rgba(255, 200, 100, 0.8) 0%, rgba(100, 255, 200, 0.8) 100%)';
        } else {
            this.progressBar.style.background = 'linear-gradient(90deg, rgba(100, 200, 255, 0.8) 0%, rgba(100, 255, 200, 0.8) 100%)';
        }
    }

    /**
     * Update milestone badges
     * @private
     */
    _updateMilestones() {
        const buildHeight = calculateBuildHeight(this.gameState);

        this.milestones.forEach(milestone => {
            const badge = this.milestonesDisplay.querySelector(`[data-milestone="${milestone}"]`);
            if (!badge) return;

            if (buildHeight >= milestone) {
                // Milestone achieved
                if (!this.achievedMilestones.has(milestone)) {
                    this.achievedMilestones.add(milestone);
                    this._animateMilestoneAchieved(badge);
                }

                badge.style.cssText = `
                    padding: 4px 8px;
                    background: rgba(100, 255, 200, 0.3);
                    border: 1px solid rgba(100, 255, 200, 0.8);
                    border-radius: 4px;
                    font-size: 11px;
                    color: rgba(100, 255, 200, 1.0);
                    font-weight: 700;
                    box-shadow: 0 0 10px rgba(100, 255, 200, 0.5);
                    transition: all 0.3s ease;
                `;
            } else {
                // Not yet achieved
                badge.style.cssText = `
                    padding: 4px 8px;
                    background: rgba(255, 255, 255, 0.1);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    border-radius: 4px;
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.4);
                    transition: all 0.3s ease;
                `;
            }
        });
    }

    /**
     * Animate milestone achievement
     * @private
     */
    _animateMilestoneAchieved(badge) {
        // Pulse animation
        badge.style.animation = 'milestone-pulse 0.6s ease-out';

        // Add keyframes if not already added
        if (!document.getElementById('milestone-keyframes')) {
            const style = document.createElement('style');
            style.id = 'milestone-keyframes';
            style.textContent = `
                @keyframes milestone-pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.3); }
                    100% { transform: scale(1); }
                }
            `;
            document.head.appendChild(style);
        }

        console.log('[InfinityHUD] Milestone achieved:', badge.dataset.milestone);
    }

    /**
     * Update statistics display
     * @private
     */
    _updateStatistics() {
        // Update blocks placed
        const blocksElem = document.getElementById('stat-blocks');
        if (blocksElem && this.gameState.infinityStats) {
            blocksElem.textContent = this.gameState.infinityStats.blocksPlaced.toString();
        }

        // Update lines cleared
        const linesElem = document.getElementById('stat-lines');
        if (linesElem) {
            linesElem.textContent = this.gameState.lines.toString();
        }

        // Update score
        const scoreElem = document.getElementById('stat-score');
        if (scoreElem) {
            scoreElem.textContent = this.gameState.score.toLocaleString();
        }

        // Update max combo depth
        const comboElem = document.getElementById('stat-combo');
        if (comboElem && this.gameState.infinityStats) {
            comboElem.textContent = this.gameState.infinityStats.maxComboDepth.toString();
        }

        // Update max combo complexity
        const complexityElem = document.getElementById('stat-complexity');
        if (complexityElem && this.gameState.infinityStats) {
            complexityElem.textContent = this.gameState.infinityStats.maxComboComplexity.toString();
        }

        // Update total cascades
        const cascadesElem = document.getElementById('stat-cascades');
        if (cascadesElem && this.gameState.infinityStats) {
            cascadesElem.textContent = this.gameState.infinityStats.totalCascades.toString();
        }
    }

    /**
     * Destroy HUD and clean up
     */
    destroy() {
        // Remove from DOM
        if (this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }

        // Remove keyframes style if exists
        const keyframes = document.getElementById('milestone-keyframes');
        if (keyframes) {
            keyframes.remove();
        }

        console.log('[InfinityHUD] Destroyed');
    }
}
