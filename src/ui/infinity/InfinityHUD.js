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
        this.cascadeCounter = null;

        // Game state reference
        this.gameState = null;

        // Milestones tracking
        this.milestones = [100, 250, 500, 750, 1000];
        this.achievedMilestones = new Set();

        // Cascade tracking
        this.activeCascadeCount = 0;
        this.cascadeTimeout = null;

        // PERFORMANCE: Cache values to avoid expensive recalculation
        // Only update DOM when values actually change
        this.lastBuildHeight = null;
        this.lastTopRow = null;
        this.lastPercentage = null;
        this.lastLockedPiecesCount = 0;
        this.lastStats = null;

        // PERFORMANCE: Cache individual stat values to avoid unnecessary DOM updates
        this.lastScore = null;
        this.lastBlocks = null;
        this.lastLines = null;

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

        // Create live cascade counter overlay
        this._createCascadeCounter();

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
     * Create live cascade counter overlay
     * @private
     */
    _createCascadeCounter() {
        this.cascadeCounter = document.createElement('div');
        this.cascadeCounter.className = 'cascade-counter-overlay';
        this.cascadeCounter.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            padding: 24px 40px;
            font-family: 'Orbitron', monospace;
            font-size: 48px;
            font-weight: 900;
            color: #ffffff;
            text-shadow:
                0 0 20px rgba(255, 100, 100, 1.0),
                0 0 40px rgba(255, 100, 100, 0.8),
                2px 2px 4px rgba(0, 0, 0, 0.8);
            z-index: 10000;
            pointer-events: none;
            display: none;
            letter-spacing: 4px;
            animation: cascade-pulse 0.5s ease-in-out infinite alternate;
        `;

        // Add animation keyframes
        if (!document.getElementById('cascade-counter-keyframes')) {
            const style = document.createElement('style');
            style.id = 'cascade-counter-keyframes';
            style.textContent = `
                @keyframes cascade-pulse {
                    0% { transform: translate(-50%, -50%) scale(0.95); }
                    100% { transform: translate(-50%, -50%) scale(1.05); }
                }
                @keyframes cascade-flash {
                    0% { opacity: 1; }
                    50% { opacity: 0.7; }
                    100% { opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(this.cascadeCounter);
    }

    /**
     * Update cascade counter display
     * @param {number} cascadeCount - Current cascade count
     */
    updateCascadeCounter(cascadeCount) {
        if (!this.cascadeCounter) return;

        this.activeCascadeCount = cascadeCount;

        // Only show for cascades 2+
        if (cascadeCount >= 2) {
            this.cascadeCounter.textContent = `CASCADE x${cascadeCount}`;
            this.cascadeCounter.style.display = 'block';

            // Update font size based on cascade count
            if (cascadeCount >= 20) {
                this.cascadeCounter.style.fontSize = '56px';
            } else if (cascadeCount >= 10) {
                this.cascadeCounter.style.fontSize = '52px';
            } else if (cascadeCount >= 5) {
                this.cascadeCounter.style.fontSize = '48px';
            } else {
                this.cascadeCounter.style.fontSize = '48px';
            }

            // Clear existing timeout
            if (this.cascadeTimeout) {
                clearTimeout(this.cascadeTimeout);
            }

            // Hide after 1.5 seconds of no updates
            this.cascadeTimeout = setTimeout(() => {
                this.hideCascadeCounter();
            }, 1500);
        }
    }

    /**
     * Hide cascade counter
     */
    hideCascadeCounter() {
        if (this.cascadeCounter) {
            this.cascadeCounter.style.display = 'none';
            this.activeCascadeCount = 0;
        }
    }

    /**
     * Show HUD
     */
    show() {
        const panel = document.getElementById('single-player-container');

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
     * PERFORMANCE OPTIMIZED: Only updates DOM when values actually change
     * @param {Object} gameState - Current game state
     */
    update(gameState) {
        if (!gameState) return;
        this.gameState = gameState;

        // PERFORMANCE: Calculate current values once
        const buildHeight = calculateBuildHeight(this.gameState);
        const topRow = calculateTopRow(this.gameState);
        const lockedPiecesCount = this.gameState.lockedPieces?.length || 0;

        // PERFORMANCE: Only update height displays if values changed
        if (this.lastBuildHeight !== buildHeight || this.lastTopRow !== topRow) {
            this.lastBuildHeight = buildHeight;
            this.lastTopRow = topRow;
            this._updateHeightDisplays(buildHeight);
        }

        // PERFORMANCE: Only update progress bar if build height changed
        if (this.lastBuildHeight !== buildHeight) {
            this._updateProgressBar(buildHeight);
        }

        // PERFORMANCE: Only update milestones when build height changes
        if (this.lastBuildHeight !== buildHeight) {
            this._updateMilestones(buildHeight);
        }

        // PERFORMANCE: Only update statistics when piece count changes
        if (this.lastLockedPiecesCount !== lockedPiecesCount) {
            this.lastLockedPiecesCount = lockedPiecesCount;
            this._updateStatistics();
        }
    }

    /**
     * Update height displays
     * PERFORMANCE: Accepts pre-calculated buildHeight to avoid recalculation
     * @private
     * @param {number} buildHeight - Pre-calculated build height
     */
    _updateHeightDisplays(buildHeight) {
        const maxRows = this.gameState.maxRows || 1000;

        // Build height from bottom
        this.heightDisplay.textContent = `${buildHeight} ROWS`;

        // Rows remaining to reach the ceiling (1000 rows)
        if (buildHeight > 0) {
            const rowsRemaining = maxRows - buildHeight;
            this.topRowDisplay.textContent = `${rowsRemaining} ROWS`;
        } else {
            this.topRowDisplay.textContent = '— ROWS';
        }
    }

    /**
     * Update progress bar
     * PERFORMANCE: Accepts pre-calculated buildHeight to avoid recalculation
     * @private
     * @param {number} buildHeight - Pre-calculated build height
     */
    _updateProgressBar(buildHeight) {
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
     * PERFORMANCE: Accepts pre-calculated buildHeight to avoid recalculation
     * @private
     * @param {number} buildHeight - Pre-calculated build height
     */
    _updateMilestones(buildHeight) {

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
     * PERFORMANCE OPTIMIZED: Only updates DOM when values actually change
     * @private
     */
    _updateStatistics() {
        // PERFORMANCE: Only update blocks if changed
        const blocksElem = document.getElementById('stat-blocks');
        if (blocksElem && this.gameState.infinityStats) {
            const blocks = this.gameState.infinityStats.blocksPlaced;
            if (this.lastBlocks !== blocks) {
                this.lastBlocks = blocks;
                blocksElem.textContent = blocks.toString();
            }
        }

        // PERFORMANCE: Only update lines if changed
        const linesElem = document.getElementById('stat-lines');
        if (linesElem) {
            const lines = this.gameState.lines;
            if (this.lastLines !== lines) {
                this.lastLines = lines;
                linesElem.textContent = lines.toString();
            }
        }

        // PERFORMANCE CRITICAL: Only call toLocaleString() if score changed
        // toLocaleString() gets slower as numbers grow!
        const scoreElem = document.getElementById('stat-score');
        if (scoreElem) {
            const score = this.gameState.score;
            if (this.lastScore !== score) {
                this.lastScore = score;
                scoreElem.textContent = score.toLocaleString();
            }
        }

        // Update max combo depth (these change rarely, so no caching needed)
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
        // Clear cascade timeout
        if (this.cascadeTimeout) {
            clearTimeout(this.cascadeTimeout);
        }

        // Remove cascade counter from DOM
        if (this.cascadeCounter && this.cascadeCounter.parentElement) {
            this.cascadeCounter.parentElement.removeChild(this.cascadeCounter);
        }

        // Remove from DOM
        if (this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }

        // Remove keyframes styles if exist
        const keyframes = document.getElementById('milestone-keyframes');
        if (keyframes) {
            keyframes.remove();
        }

        const cascadeKeyframes = document.getElementById('cascade-counter-keyframes');
        if (cascadeKeyframes) {
            cascadeKeyframes.remove();
        }

        console.log('[InfinityHUD] Destroyed');
    }
}
