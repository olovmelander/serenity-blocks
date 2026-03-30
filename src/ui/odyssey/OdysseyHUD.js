/**
 * @fileoverview Odyssey Mode HUD Component
 * Displays level objectives, progress, stars, and time during gameplay
 */

import { getLevelById } from '../../core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';

/**
 * OdysseyHUD - Displays odyssey-specific statistics and objectives
 *
 * Features:
 * - Current level name and chapter
 * - Primary objective with progress bar
 * - Time display (countdown or elapsed)
 * - Star rating preview
 * - Bonus objectives checklist
 * - Victory condition tracking
 */
export class OdysseyHUD {
    /**
     * Create HUD component
     * @param {Object} options - Configuration options
     */
    constructor(options = {}) {
        // Configuration
        this.levelId = options.levelId || 1;
        this.levelConfig = null;
        this.chapterConfig = null;

        // DOM elements
        this.container = null;
        this.levelNameDisplay = null;
        this.chapterDisplay = null;
        this.objectiveDisplay = null;
        this.progressBar = null;
        this.timeDisplay = null;
        this.starsDisplay = null;
        this.bonusesDisplay = null;

        // State
        this.isVisible = false;
        this.startTime = null;
        this.elapsedTime = 0;
        this.timeLimit = null;
        this.isPaused = false;

        // Tracked metrics (synced from VictoryConditionEvaluator)
        this.metrics = {
            lines: 0,
            score: 0,
            cascades: 0,
            maxCascadeDepth: 0,
            tetrises: 0,
            singles: 0,
            combo: 0,
        };

        // Animation frame
        this.animationFrame = null;

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
        this.container.id = 'odyssey-hud';
        this.container.className = 'odyssey-hud';
        this.container.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            /* Mirror of single-player-stats-bar: offset LEFT instead of right */
            transform: translate(calc(-1 * (var(--board-width) / 2 + 120px) - 100%), -50%);
            width: clamp(180px, 15vw, 220px);
            background: linear-gradient(
                165deg,
                rgba(20, 15, 40, 0.9) 0%,
                rgba(12, 10, 30, 0.95) 50%,
                rgba(8, 6, 22, 0.98) 100%
            );
            border: 1px solid rgba(180, 130, 255, 0.3);
            border-radius: 16px;
            padding: clamp(12px, 1.5vw, 18px);
            box-shadow:
                0 8px 32px rgba(0, 0, 0, 0.5),
                0 0 0 1px rgba(255, 255, 255, 0.05) inset,
                0 0 60px rgba(140, 80, 255, 0.1);
            font-family: 'Orbitron', 'Segoe UI', sans-serif;
            color: #fff;
            display: none;
            box-sizing: border-box;
            overflow: hidden;
            z-index: 10;
            max-height: calc(100vh - 120px);
            overflow-y: auto;
        `;

        // Create sections
        this._createHeaderSection();
        this._createObjectiveSection();
        this._createProgressSection();
        this._createTimeSection();
        this._createStarsSection();
        this._createBonusesSection();

        console.log('[OdysseyHUD] Initialized');
    }

    /**
     * Create header section with level name and chapter
     * @private
     */
    _createHeaderSection() {
        const section = document.createElement('div');
        section.className = 'hud-section header-section';
        section.style.cssText = `
            margin-bottom: clamp(8px, 1vw, 12px);
            padding-bottom: clamp(6px, 0.8vw, 10px);
            border-bottom: 1px solid rgba(180, 130, 255, 0.2);
            text-align: center;
        `;

        // Chapter label
        this.chapterDisplay = document.createElement('div');
        this.chapterDisplay.className = 'chapter-label';
        this.chapterDisplay.textContent = 'CHAPTER 1';
        this.chapterDisplay.style.cssText = `
            font-size: clamp(8px, 0.8vw, 10px);
            color: rgba(180, 150, 255, 0.7);
            letter-spacing: 1.5px;
            text-transform: uppercase;
            margin-bottom: 4px;
        `;
        section.appendChild(this.chapterDisplay);

        // Level name
        this.levelNameDisplay = document.createElement('div');
        this.levelNameDisplay.className = 'level-name';
        this.levelNameDisplay.textContent = 'First Light';
        this.levelNameDisplay.style.cssText = `
            font-size: clamp(12px, 1.2vw, 15px);
            font-weight: 700;
            color: #fff;
            text-shadow: 0 0 15px rgba(180, 130, 255, 0.5);
            letter-spacing: 0.5px;
        `;
        section.appendChild(this.levelNameDisplay);

        // Level number badge
        this.levelBadge = document.createElement('div');
        this.levelBadge.className = 'level-badge';
        this.levelBadge.textContent = 'Level 1';
        this.levelBadge.style.cssText = `
            display: inline-block;
            margin-top: 6px;
            padding: 3px 10px;
            background: rgba(180, 130, 255, 0.2);
            border: 1px solid rgba(180, 130, 255, 0.4);
            border-radius: 10px;
            font-size: clamp(8px, 0.8vw, 10px);
            color: rgba(200, 170, 255, 0.9);
            letter-spacing: 0.5px;
        `;
        section.appendChild(this.levelBadge);

        this.container.appendChild(section);
    }

    /**
     * Create objective display section
     * @private
     */
    _createObjectiveSection() {
        const section = document.createElement('div');
        section.className = 'hud-section objective-section';
        section.style.cssText = `
            margin-bottom: clamp(8px, 1vw, 12px);
            padding-bottom: clamp(6px, 0.8vw, 10px);
            border-bottom: 1px solid rgba(180, 130, 255, 0.2);
        `;

        // Label
        const label = document.createElement('div');
        label.textContent = 'OBJECTIVE';
        label.style.cssText = `
            font-size: clamp(7px, 0.7vw, 9px);
            color: rgba(180, 200, 220, 0.7);
            letter-spacing: 1px;
            text-transform: uppercase;
            margin-bottom: 5px;
        `;
        section.appendChild(label);

        // Objective text
        this.objectiveDisplay = document.createElement('div');
        this.objectiveDisplay.className = 'objective-text';
        this.objectiveDisplay.textContent = 'Clear 40 Lines';
        this.objectiveDisplay.style.cssText = `
            font-size: clamp(10px, 1vw, 13px);
            font-weight: 600;
            color: rgba(100, 220, 255, 1);
            margin-bottom: 6px;
        `;
        section.appendChild(this.objectiveDisplay);

        // Progress display
        this.progressValue = document.createElement('div');
        this.progressValue.className = 'progress-value';
        this.progressValue.textContent = '0 / 40';
        this.progressValue.style.cssText = `
            font-size: clamp(16px, 1.8vw, 22px);
            font-weight: 700;
            color: #fff;
            text-align: center;
            text-shadow: 0 0 15px rgba(100, 220, 255, 0.5);
        `;
        section.appendChild(this.progressValue);

        this.container.appendChild(section);
    }

    /**
     * Create progress bar section
     * @private
     */
    _createProgressSection() {
        const section = document.createElement('div');
        section.className = 'hud-section progress-section';
        section.style.cssText = `
            margin-bottom: clamp(8px, 1vw, 12px);
        `;

        // Progress bar container
        const barContainer = document.createElement('div');
        barContainer.style.cssText = `
            width: 100%;
            height: 8px;
            background: rgba(0, 0, 0, 0.4);
            border-radius: 4px;
            overflow: hidden;
            position: relative;
            box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
        `;

        this.progressBar = document.createElement('div');
        this.progressBar.className = 'progress-fill';
        this.progressBar.style.cssText = `
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg,
                rgba(100, 180, 255, 1) 0%,
                rgba(180, 130, 255, 1) 50%,
                rgba(255, 130, 200, 1) 100%);
            border-radius: 4px;
            transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 0 10px rgba(180, 130, 255, 0.6);
        `;
        barContainer.appendChild(this.progressBar);

        section.appendChild(barContainer);
        this.container.appendChild(section);
    }

    /**
     * Create time display section
     * @private
     */
    _createTimeSection() {
        const section = document.createElement('div');
        section.className = 'hud-section time-section';
        section.style.cssText = `
            margin-bottom: clamp(8px, 1vw, 12px);
            padding-bottom: clamp(6px, 0.8vw, 10px);
            border-bottom: 1px solid rgba(180, 130, 255, 0.2);
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;

        // Time label
        const timeLabel = document.createElement('div');
        timeLabel.textContent = 'TIME';
        timeLabel.style.cssText = `
            font-size: clamp(7px, 0.7vw, 9px);
            color: rgba(180, 200, 220, 0.7);
            letter-spacing: 1px;
            text-transform: uppercase;
        `;
        section.appendChild(timeLabel);

        // Time value
        this.timeDisplay = document.createElement('div');
        this.timeDisplay.className = 'time-value';
        this.timeDisplay.textContent = '0:00';
        this.timeDisplay.style.cssText = `
            font-size: clamp(14px, 1.4vw, 18px);
            font-weight: 700;
            color: #fff;
            font-variant-numeric: tabular-nums;
        `;
        section.appendChild(this.timeDisplay);

        this.container.appendChild(section);
    }

    /**
     * Create stars display section
     * @private
     */
    _createStarsSection() {
        const section = document.createElement('div');
        section.className = 'hud-section stars-section';
        section.style.cssText = `
            margin-bottom: clamp(8px, 1vw, 12px);
            padding-bottom: clamp(6px, 0.8vw, 10px);
            border-bottom: 1px solid rgba(180, 130, 255, 0.2);
        `;

        // Label
        const label = document.createElement('div');
        label.textContent = 'STAR GOALS';
        label.style.cssText = `
            font-size: clamp(7px, 0.7vw, 9px);
            color: rgba(180, 200, 220, 0.7);
            letter-spacing: 1px;
            text-transform: uppercase;
            margin-bottom: 6px;
        `;
        section.appendChild(label);

        // Stars list container
        this.starsDisplay = document.createElement('div');
        this.starsDisplay.className = 'stars-list';
        this.starsDisplay.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        // Create 3 star rows (will be populated with setLevel)
        for (let i = 0; i < 3; i++) {
            const starRow = document.createElement('div');
            starRow.className = 'star-row';
            starRow.dataset.star = i + 1;
            starRow.style.cssText = `
                display: flex;
                align-items: center;
                gap: 6px;
                opacity: 0.5;
                transition: all 0.3s ease;
            `;

            // Star icon
            const starIcon = document.createElement('div');
            starIcon.className = 'star-icon';
            starIcon.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                          stroke="rgba(255, 200, 100, 0.4)" stroke-width="2" fill="rgba(255, 200, 100, 0.15)"/>
                </svg>
            `;

            // Requirement text
            const reqText = document.createElement('div');
            reqText.className = 'star-requirement';
            reqText.style.cssText = `
                font-size: clamp(8px, 0.8vw, 10px);
                color: rgba(200, 200, 220, 0.7);
            `;
            reqText.textContent = '...';

            starRow.appendChild(starIcon);
            starRow.appendChild(reqText);
            this.starsDisplay.appendChild(starRow);
        }

        section.appendChild(this.starsDisplay);
        this.container.appendChild(section);
    }

    /**
     * Create bonuses section
     * @private
     */
    _createBonusesSection() {
        const section = document.createElement('div');
        section.className = 'hud-section bonuses-section';

        // Label
        const label = document.createElement('div');
        label.textContent = 'BONUS OBJECTIVES';
        label.style.cssText = `
            font-size: clamp(7px, 0.7vw, 9px);
            color: rgba(180, 200, 220, 0.7);
            letter-spacing: 1px;
            text-transform: uppercase;
            margin-bottom: 5px;
        `;
        section.appendChild(label);

        // Bonuses list
        this.bonusesDisplay = document.createElement('div');
        this.bonusesDisplay.className = 'bonuses-list';
        this.bonusesDisplay.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        section.appendChild(this.bonusesDisplay);
        this.container.appendChild(section);
    }

    /**
     * Set level and update display
     * @param {number} levelId - Level ID to display
     */
    setLevel(levelId) {
        this.levelId = levelId;
        this.levelConfig = getLevelById(levelId);

        if (!this.levelConfig) {
            console.error('[OdysseyHUD] Level not found:', levelId);
            return;
        }

        // Get chapter config
        this.chapterConfig = CHAPTER_CONFIGS.find((c) => c.id === this.levelConfig.chapter);

        // Update header
        this.chapterDisplay.textContent = `CHAPTER ${this.levelConfig.chapter}`;
        this.levelNameDisplay.textContent = this.levelConfig.name;
        this.levelBadge.textContent = `Level ${levelId}`;

        // Update objective
        this._updateObjectiveDisplay();

        // Update time limit
        const { victory } = this.levelConfig;
        if (victory.failure && victory.failure.type === 'time') {
            this.timeLimit = victory.failure.value;
        } else {
            this.timeLimit = null;
        }

        // Update bonuses
        this._updateBonusesDisplay();

        // Update star requirements text
        this._updateStarRequirements();

        // Reset stars
        this._updateStars(0);

        // Reset metrics
        this.resetMetrics();

        console.log('[OdysseyHUD] Level set:', levelId, this.levelConfig.name);
    }

    /**
     * Update star requirements display
     * @private
     */
    _updateStarRequirements() {
        if (!this.levelConfig?.stars) return;

        const { stars } = this.levelConfig;
        const starRows = this.starsDisplay.querySelectorAll('.star-row');

        const starConfigs = [stars.one, stars.two, stars.three];

        starRows.forEach((row, index) => {
            const reqText = row.querySelector('.star-requirement');
            if (reqText && starConfigs[index]) {
                reqText.textContent = this._formatStarCondition(starConfigs[index], index);
            }
        });
    }

    /**
     * Format a star condition into human-readable text
     * @private
     * @param {Object} condition - Star condition object
     * @param {number} starIndex - Star index (0, 1, 2)
     * @returns {string}
     */
    _formatStarCondition(condition, starIndex) {
        const parts = [];

        for (const [key, value] of Object.entries(condition)) {
            switch (key) {
            case 'lines':
                // First star typically just requires completing the objective
                if (starIndex === 0) {
                    parts.push('Complete level');
                }
                // Don't repeat lines requirement for higher stars
                break;
            case 'score':
                if (starIndex === 0) {
                    parts.push('Complete level');
                } else {
                    parts.push(`${value.toLocaleString()}+ pts`);
                }
                break;
            case 'cascades':
                if (starIndex === 0) {
                    parts.push('Complete level');
                } else {
                    parts.push(`${value}+ cascades`);
                }
                break;
            case 'time':
                if (value >= 60) {
                    const mins = Math.floor(value / 60);
                    const secs = value % 60;
                    if (secs === 0) {
                        parts.push(`Under ${mins} min`);
                    } else {
                        parts.push(`Under ${mins}:${secs.toString().padStart(2, '0')}`);
                    }
                } else {
                    parts.push(`Under ${value}s`);
                }
                break;
            case 'tetrises':
                parts.push(`${value}+ tetrises`);
                break;
            case 'maxCascadeDepth':
                parts.push(`${value}+ chain`);
                break;
            case 'combo':
                parts.push(`${value}x combo`);
                break;
            case 'bonuses':
                if (value === 1) {
                    parts.push('Get bonus');
                } else {
                    parts.push(`${value} bonuses`);
                }
                break;
            }
        }

        // If first star and no parts yet, add default
        if (parts.length === 0 && starIndex === 0) {
            parts.push('Complete level');
        }

        return parts.join(' + ') || '...';
    }

    /**
     * Update objective display based on level config
     * @private
     */
    _updateObjectiveDisplay() {
        if (!this.levelConfig) return;

        const { victory } = this.levelConfig;
        const { type, target } = victory.primary;

        let objectiveText = '';
        switch (type) {
        case 'lines':
            objectiveText = `Clear ${target} Lines`;
            break;
        case 'score':
            objectiveText = `Score ${target.toLocaleString()} Points`;
            break;
        case 'cascade':
            objectiveText = `Trigger ${target} Cascades`;
            break;
        case 'time':
            objectiveText = `Survive ${target} Seconds`;
            break;
        default:
            objectiveText = 'Complete Objective';
        }

        this.objectiveDisplay.textContent = objectiveText;
        this.progressValue.textContent = `0 / ${target}`;
    }

    /**
     * Update bonuses display
     * @private
     */
    _updateBonusesDisplay() {
        if (!this.levelConfig) return;

        this.bonusesDisplay.innerHTML = '';

        const { bonuses } = this.levelConfig.victory;
        if (!bonuses || bonuses.length === 0) {
            const noneText = document.createElement('div');
            noneText.textContent = 'No bonus objectives';
            noneText.style.cssText = `
                font-size: clamp(9px, 0.9vw, 11px);
                color: rgba(180, 200, 220, 0.5);
                font-style: italic;
            `;
            this.bonusesDisplay.appendChild(noneText);
            return;
        }

        bonuses.forEach((bonus, index) => {
            const bonusItem = document.createElement('div');
            bonusItem.className = 'bonus-item';
            bonusItem.dataset.index = index;
            bonusItem.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: clamp(9px, 0.9vw, 11px);
                color: rgba(255, 255, 255, 0.7);
            `;

            const checkbox = document.createElement('div');
            checkbox.className = 'bonus-checkbox';
            checkbox.style.cssText = `
                width: 16px;
                height: 16px;
                border: 2px solid rgba(180, 130, 255, 0.5);
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.3s ease;
            `;
            bonusItem.appendChild(checkbox);

            const text = document.createElement('span');
            text.textContent = bonus.description;
            bonusItem.appendChild(text);

            this.bonusesDisplay.appendChild(bonusItem);
        });
    }

    /**
     * Update metrics from game state
     * @param {Object} metrics - Current game metrics
     */
    updateMetrics(metrics) {
        Object.assign(this.metrics, metrics);
        this._updateProgress();
        this._checkStars();
    }

    /**
     * Update progress display
     * @private
     */
    _updateProgress() {
        if (!this.levelConfig) return;

        const { type, target } = this.levelConfig.victory.primary;
        let current = 0;

        switch (type) {
        case 'lines':
            current = this.metrics.lines;
            break;
        case 'score':
            current = this.metrics.score;
            break;
        case 'cascade':
            current = this.metrics.cascades;
            break;
        case 'time':
            current = Math.floor(this.elapsedTime / 1000);
            break;
        }

        // Update progress text
        if (type === 'score') {
            this.progressValue.textContent = `${current.toLocaleString()} / ${target.toLocaleString()}`;
        } else {
            this.progressValue.textContent = `${current} / ${target}`;
        }

        // Update progress bar
        const percentage = Math.min(100, (current / target) * 100);
        this.progressBar.style.width = `${percentage}%`;

        // Change color when complete
        if (percentage >= 100) {
            this.progressBar.style.background = 'linear-gradient(90deg, rgba(100, 255, 150, 1) 0%, rgba(150, 255, 200, 1) 100%)';
            this.progressBar.style.boxShadow = '0 0 20px rgba(100, 255, 150, 0.8)';
        }
    }

    /**
     * Check and update star rating
     * @private
     */
    _checkStars() {
        if (!this.levelConfig) return;

        const { stars } = this.levelConfig;
        let earnedStars = 0;

        // Check each star threshold
        if (this._meetsCondition(stars.one)) earnedStars = 1;
        if (this._meetsCondition(stars.two)) earnedStars = 2;
        if (this._meetsCondition(stars.three)) earnedStars = 3;

        this._updateStars(earnedStars);
    }

    /**
     * Check if a star condition is met
     * @private
     * @param {Object} condition - Star condition
     * @returns {boolean}
     */
    _meetsCondition(condition) {
        for (const [key, value] of Object.entries(condition)) {
            switch (key) {
            case 'lines':
                if (this.metrics.lines < value) return false;
                break;
            case 'score':
                if (this.metrics.score < value) return false;
                break;
            case 'cascades':
                if (this.metrics.cascades < value) return false;
                break;
            case 'maxCascadeDepth':
                if (this.metrics.maxCascadeDepth < value) return false;
                break;
            case 'tetrises':
                if (this.metrics.tetrises < value) return false;
                break;
            case 'combo':
                if (this.metrics.combo < value) return false;
                break;
            case 'time':
                if (Math.floor(this.elapsedTime / 1000) > value) return false;
                break;
            case 'bonuses':
                // TODO: Check bonus completion count
                break;
            }
        }
        return true;
    }

    /**
     * Update star display
     * @private
     * @param {number} earnedStars - Number of stars earned (0-3)
     */
    _updateStars(earnedStars) {
        const starRows = this.starsDisplay.querySelectorAll('.star-row');
        starRows.forEach((row, index) => {
            const starNum = index + 1;
            const starIcon = row.querySelector('.star-icon');
            const svg = starIcon?.querySelector('svg path');

            if (starNum <= earnedStars) {
                // Earned star
                row.style.opacity = '1';
                if (svg) {
                    svg.setAttribute('fill', 'rgba(255, 200, 100, 1)');
                    svg.setAttribute('stroke', 'rgba(255, 220, 150, 1)');
                }
                if (starIcon) {
                    starIcon.style.filter = 'drop-shadow(0 0 6px rgba(255, 200, 100, 0.8))';
                }
            } else {
                // Not yet earned
                row.style.opacity = '0.5';
                if (svg) {
                    svg.setAttribute('fill', 'rgba(255, 200, 100, 0.15)');
                    svg.setAttribute('stroke', 'rgba(255, 200, 100, 0.4)');
                }
                if (starIcon) {
                    starIcon.style.filter = 'none';
                }
            }
        });
    }

    /**
     * Update time display
     * @param {number} elapsed - Elapsed time in milliseconds
     */
    updateTime(elapsed) {
        this.elapsedTime = elapsed;

        if (this.timeLimit) {
            // Countdown mode
            const remaining = Math.max(0, this.timeLimit * 1000 - elapsed);
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            this.timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            // Warning color when low
            if (remaining < 30000) {
                this.timeDisplay.style.color = 'rgba(255, 100, 100, 1)';
                this.timeDisplay.style.textShadow = '0 0 10px rgba(255, 100, 100, 0.8)';
            } else if (remaining < 60000) {
                this.timeDisplay.style.color = 'rgba(255, 200, 100, 1)';
                this.timeDisplay.style.textShadow = '0 0 10px rgba(255, 200, 100, 0.5)';
            } else {
                this.timeDisplay.style.color = '#fff';
                this.timeDisplay.style.textShadow = 'none';
            }
        } else {
            // Elapsed mode
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            this.timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            this.timeDisplay.style.color = '#fff';
            this.timeDisplay.style.textShadow = 'none';
        }
    }

    /**
     * Mark a bonus as complete
     * @param {number} index - Bonus index
     */
    completeBons(index) {
        const bonusItem = this.bonusesDisplay.querySelector(`[data-index="${index}"]`);
        if (!bonusItem) return;

        const checkbox = bonusItem.querySelector('.bonus-checkbox');
        checkbox.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17L4 12" stroke="rgba(100, 255, 150, 1)" stroke-width="3" stroke-linecap="round"/>
            </svg>
        `;
        checkbox.style.borderColor = 'rgba(100, 255, 150, 0.8)';
        checkbox.style.background = 'rgba(100, 255, 150, 0.2)';

        bonusItem.style.color = 'rgba(100, 255, 150, 1)';
    }

    // =============================
    // Victory Lap System
    // =============================

    /**
     * Enter victory lap mode - goal is complete, player can keep playing
     */
    enterVictoryLap() {
        this.isVictoryLap = true;

        // Change objective section to show "VICTORY LAP"
        if (this.objectiveDisplay) {
            this.objectiveDisplay.textContent = 'VICTORY LAP';
            this.objectiveDisplay.style.color = 'rgba(100, 255, 150, 1)';
            this.objectiveDisplay.style.textShadow = '0 0 15px rgba(100, 255, 150, 0.6)';
        }

        // Update progress bar to gold/green gradient
        if (this.progressBar) {
            this.progressBar.style.width = '100%';
            this.progressBar.style.background = 'linear-gradient(90deg, #4ade80 0%, #fbbf24 50%, #4ade80 100%)';
            this.progressBar.style.backgroundSize = '200% 100%';
            this.progressBar.style.animation = 'victoryLapShimmer 2s ease-in-out infinite';
        }

        // Update progress value text
        if (this.progressValue) {
            this.progressValue.textContent = 'COMPLETE!';
            this.progressValue.style.color = 'rgba(100, 255, 150, 1)';
        }

        // Add pulsing glow to container
        this.container.style.borderColor = 'rgba(100, 255, 150, 0.5)';
        this.container.style.boxShadow = `
            0 8px 32px rgba(0, 0, 0, 0.5),
            0 0 0 1px rgba(255, 255, 255, 0.05) inset,
            0 0 60px rgba(100, 255, 150, 0.2)
        `;

        // Add finish hint
        this._showFinishHint();

        // Add shimmer animation style if not present
        this._addVictoryLapStyles();

        console.log('[OdysseyHUD] Victory lap mode activated');
    }

    /**
     * Exit victory lap mode
     */
    exitVictoryLap() {
        this.isVictoryLap = false;
        this._hideFinishHint();

        // Reset container styling
        this.container.style.borderColor = 'rgba(180, 130, 255, 0.3)';
        this.container.style.boxShadow = `
            0 8px 32px rgba(0, 0, 0, 0.5),
            0 0 0 1px rgba(255, 255, 255, 0.05) inset,
            0 0 60px rgba(140, 80, 255, 0.1)
        `;

        console.log('[OdysseyHUD] Victory lap mode deactivated');
    }

    /**
     * Show finish hint during victory lap
     * @private
     */
    _showFinishHint() {
        if (!this.finishHint) {
            this.finishHint = document.createElement('div');
            this.finishHint.className = 'finish-hint';
            this.finishHint.innerHTML = 'Press <kbd>Enter</kbd> to finish';
            this.finishHint.style.cssText = `
                text-align: center;
                font-size: clamp(9px, 0.9vw, 11px);
                color: rgba(255, 255, 255, 0.7);
                margin-top: 10px;
                padding-top: 10px;
                border-top: 1px solid rgba(100, 255, 150, 0.3);
                animation: victoryLapPulse 2s ease-in-out infinite;
            `;
            this.finishHint.querySelector('kbd').style.cssText = `
                background: rgba(100, 255, 150, 0.2);
                padding: 2px 8px;
                border-radius: 4px;
                border: 1px solid rgba(100, 255, 150, 0.4);
                font-family: inherit;
            `;
            this.container.appendChild(this.finishHint);
        }
        this.finishHint.style.display = 'block';
    }

    /**
     * Hide finish hint
     * @private
     */
    _hideFinishHint() {
        if (this.finishHint) {
            this.finishHint.style.display = 'none';
        }
    }

    /**
     * Add victory lap CSS animations
     * @private
     */
    _addVictoryLapStyles() {
        if (document.getElementById('victory-lap-hud-styles')) return;

        const style = document.createElement('style');
        style.id = 'victory-lap-hud-styles';
        style.textContent = `
            @keyframes victoryLapShimmer {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
            }
            @keyframes victoryLapPulse {
                0%, 100% { opacity: 0.7; }
                50% { opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Reset all metrics
     */
    resetMetrics() {
        this.metrics = {
            lines: 0,
            score: 0,
            cascades: 0,
            maxCascadeDepth: 0,
            tetrises: 0,
            singles: 0,
            combo: 0,
        };
        this.elapsedTime = 0;
        this.isVictoryLap = false;
        this._updateProgress();
        this._updateStars(0);
        this.updateTime(0);
        this._hideFinishHint();
    }

    /**
     * Show HUD
     */
    show() {
        // Append to .single-player-stage (same container as stats bar) for proper positioning
        const stage = document.querySelector('.single-player-stage');

        if (stage && this.container.parentElement !== stage) {
            stage.appendChild(this.container);
        }

        this.container.style.display = 'block';
        this.isVisible = true;
        console.log('[OdysseyHUD] Shown');
    }

    /**
     * Hide HUD
     */
    hide() {
        this.container.style.display = 'none';
        this.isVisible = false;
        console.log('[OdysseyHUD] Hidden');
    }

    /**
     * Get current level configuration
     * @returns {Object|null}
     */
    getLevelConfig() {
        return this.levelConfig;
    }

    /**
     * Get current metrics
     * @returns {Object}
     */
    getMetrics() {
        return { ...this.metrics, elapsedTime: this.elapsedTime };
    }

    /**
     * Destroy HUD and clean up
     */
    destroy() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        if (this.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }

        console.log('[OdysseyHUD] Destroyed');
    }
}
