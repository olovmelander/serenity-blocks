/**
 * @fileoverview Odyssey Mode HUD Component
 * Displays level objectives, progress, stars, and time during gameplay.
 */

import { getLevelById } from '../../core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';

/**
 * OdysseyHUD - Displays odyssey-specific statistics and objectives.
 */
export class OdysseyHUD {
    /**
     * Create HUD component.
     * @param {Object} options - Configuration options.
     */
    constructor(options = {}) {
        this.levelId = options.levelId || 1;
        this.levelConfig = null;
        this.chapterConfig = null;

        this.container = null;
        this.levelNameDisplay = null;
        this.chapterDisplay = null;
        this.objectiveDisplay = null;
        this.progressValue = null;
        this.progressBar = null;
        this.timeDisplay = null;
        this.starsDisplay = null;
        this.bonusesDisplay = null;
        this.finishHint = null;

        this.isVisible = false;
        this.startTime = null;
        this.elapsedTime = 0;
        this.timeLimit = null;
        this.isPaused = false;
        this.isVictoryLap = false;

        this.metrics = {
            lines: 0,
            score: 0,
            cascades: 0,
            maxCascadeDepth: 0,
            tetrises: 0,
            singles: 0,
            combo: 0,
        };

        this.animationFrame = null;
        this._initialize();
    }

    _initialize() {
        this.container = document.createElement('div');
        this.container.id = 'odyssey-hud';
        this.container.className = 'odyssey-hud';

        this._createHeaderSection();
        this._createObjectiveSection();
        this._createProgressSection();
        this._createTimeSection();
        this._createStarsSection();
        this._createBonusesSection();
        this._createFinishHint();

        console.log('[OdysseyHUD] Initialized');
    }

    _createHeaderSection() {
        const section = document.createElement('div');
        section.className = 'hud-section header-section';

        this.chapterDisplay = document.createElement('div');
        this.chapterDisplay.className = 'chapter-label';
        this.chapterDisplay.textContent = 'CHAPTER 1';
        section.appendChild(this.chapterDisplay);

        this.levelNameDisplay = document.createElement('div');
        this.levelNameDisplay.className = 'level-name';
        this.levelNameDisplay.textContent = 'First Light';
        section.appendChild(this.levelNameDisplay);

        this.levelBadge = document.createElement('div');
        this.levelBadge.className = 'level-badge';
        this.levelBadge.textContent = 'Level 1';
        section.appendChild(this.levelBadge);

        this.container.appendChild(section);
    }

    _createObjectiveSection() {
        const section = document.createElement('div');
        section.className = 'hud-section objective-section';

        const label = document.createElement('div');
        label.className = 'hud-label';
        label.textContent = 'OBJECTIVE';
        section.appendChild(label);

        this.objectiveDisplay = document.createElement('div');
        this.objectiveDisplay.className = 'objective-text';
        this.objectiveDisplay.textContent = 'Clear 40 Lines';
        section.appendChild(this.objectiveDisplay);

        this.progressValue = document.createElement('div');
        this.progressValue.className = 'progress-value';
        this.progressValue.textContent = '0 / 40';
        section.appendChild(this.progressValue);

        this.container.appendChild(section);
    }

    _createProgressSection() {
        const section = document.createElement('div');
        section.className = 'hud-section progress-section';

        const barContainer = document.createElement('div');
        barContainer.className = 'progress-track';

        this.progressBar = document.createElement('div');
        this.progressBar.className = 'progress-fill';
        barContainer.appendChild(this.progressBar);

        section.appendChild(barContainer);
        this.container.appendChild(section);
    }

    _createTimeSection() {
        const section = document.createElement('div');
        section.className = 'hud-section time-section';

        const timeLabel = document.createElement('div');
        timeLabel.className = 'hud-label';
        timeLabel.textContent = 'TIME';
        section.appendChild(timeLabel);

        this.timeDisplay = document.createElement('div');
        this.timeDisplay.className = 'time-value';
        this.timeDisplay.textContent = '0:00';
        section.appendChild(this.timeDisplay);

        this.container.appendChild(section);
    }

    _createStarsSection() {
        const section = document.createElement('div');
        section.className = 'hud-section stars-section';

        const label = document.createElement('div');
        label.className = 'hud-label';
        label.textContent = 'STAR GOALS';
        section.appendChild(label);

        this.starsDisplay = document.createElement('div');
        this.starsDisplay.className = 'stars-list';

        for (let i = 0; i < 3; i++) {
            const starRow = document.createElement('div');
            starRow.className = 'star-row';
            starRow.dataset.star = i + 1;

            const starIcon = document.createElement('div');
            starIcon.className = 'star-icon';
            starIcon.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke-width="2"/>
                </svg>
            `;

            const reqText = document.createElement('div');
            reqText.className = 'star-requirement';
            reqText.textContent = '...';

            starRow.appendChild(starIcon);
            starRow.appendChild(reqText);
            this.starsDisplay.appendChild(starRow);
        }

        section.appendChild(this.starsDisplay);
        this.container.appendChild(section);
    }

    _createBonusesSection() {
        const section = document.createElement('div');
        section.className = 'hud-section bonuses-section';

        const label = document.createElement('div');
        label.className = 'hud-label';
        label.textContent = 'BONUS OBJECTIVES';
        section.appendChild(label);

        this.bonusesDisplay = document.createElement('div');
        this.bonusesDisplay.className = 'bonuses-list';
        section.appendChild(this.bonusesDisplay);

        this.container.appendChild(section);
    }

    _createFinishHint() {
        this.finishHint = document.createElement('div');
        this.finishHint.className = 'finish-hint';
        this.finishHint.innerHTML = 'Press <kbd>Enter</kbd> to finish';
        this.container.appendChild(this.finishHint);
    }

    /**
     * Set level and update display.
     * @param {number} levelId - Level ID to display.
     */
    setLevel(levelId) {
        this.levelId = levelId;
        this.levelConfig = getLevelById(levelId);

        if (!this.levelConfig) {
            console.error('[OdysseyHUD] Level not found:', levelId);
            return;
        }

        this.chapterConfig = CHAPTER_CONFIGS.find((c) => c.id === this.levelConfig.chapter);

        this.chapterDisplay.textContent = `CHAPTER ${this.levelConfig.chapter}`;
        this.levelNameDisplay.textContent = this.levelConfig.name;
        this.levelBadge.textContent = `Level ${levelId}`;

        this._updateObjectiveDisplay();

        const { victory } = this.levelConfig;
        this.timeLimit = victory.failure && victory.failure.type === 'time'
            ? victory.failure.value
            : null;

        this._updateBonusesDisplay();
        this._updateStarRequirements();
        this.resetMetrics();

        console.log('[OdysseyHUD] Level set:', levelId, this.levelConfig.name);
    }

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

    _formatStarCondition(condition, starIndex) {
        const parts = [];

        for (const [key, value] of Object.entries(condition)) {
            switch (key) {
            case 'lines':
                if (starIndex === 0) {
                    parts.push('Complete level');
                }
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
                    parts.push(secs === 0 ? `Under ${mins} min` : `Under ${mins}:${secs.toString().padStart(2, '0')}`);
                } else {
                    parts.push(`Under ${value}s`);
                }
                break;
            case 'tetrises':
                parts.push(`${value}+ quads`);
                break;
            case 'maxCascadeDepth':
                parts.push(`${value}+ chain`);
                break;
            case 'combo':
                parts.push(`${value}x combo`);
                break;
            case 'bonuses':
                parts.push(value === 1 ? 'Get bonus' : `${value} bonuses`);
                break;
            }
        }

        if (parts.length === 0 && starIndex === 0) {
            parts.push('Complete level');
        }

        return parts.join(' + ') || '...';
    }

    _updateObjectiveDisplay() {
        if (!this.levelConfig) return;

        const { type, target } = this.levelConfig.victory.primary;
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
        case 'height':
            objectiveText = `Build to ${target} Rows`;
            break;
        default:
            objectiveText = 'Complete Objective';
        }

        this.objectiveDisplay.textContent = objectiveText;
        this.progressValue.textContent = `0 / ${target}`;
    }

    _updateBonusesDisplay() {
        if (!this.levelConfig) return;

        this.bonusesDisplay.innerHTML = '';

        const { bonuses } = this.levelConfig.victory;
        if (!bonuses || bonuses.length === 0) {
            const noneText = document.createElement('div');
            noneText.className = 'bonus-empty';
            noneText.textContent = 'No bonus objectives';
            this.bonusesDisplay.appendChild(noneText);
            return;
        }

        bonuses.forEach((bonus, index) => {
            const bonusItem = document.createElement('div');
            bonusItem.className = 'bonus-item';
            bonusItem.dataset.index = index;

            const checkbox = document.createElement('div');
            checkbox.className = 'bonus-checkbox';
            bonusItem.appendChild(checkbox);

            const text = document.createElement('span');
            text.textContent = bonus.description;
            bonusItem.appendChild(text);

            this.bonusesDisplay.appendChild(bonusItem);
        });
    }

    /**
     * Update metrics from game state.
     * @param {Object} metrics - Current game metrics.
     */
    updateMetrics(metrics) {
        Object.assign(this.metrics, metrics);
        this._updateProgress();
        this._checkStars();
    }

    _updateProgress() {
        if (!this.levelConfig || this.isVictoryLap) return;

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
        case 'height':
            current = this.metrics.height || 0;
            break;
        }

        this.progressValue.textContent = type === 'score'
            ? `${current.toLocaleString()} / ${target.toLocaleString()}`
            : `${current} / ${target}`;

        const percentage = Math.min(100, (current / target) * 100);
        this.progressBar.style.width = `${percentage}%`;
        this.progressBar.classList.toggle('is-complete', percentage >= 100);
    }

    _checkStars() {
        if (!this.levelConfig) return;

        const { stars } = this.levelConfig;
        let earnedStars = 0;

        if (this._meetsCondition(stars.one)) earnedStars = 1;
        if (this._meetsCondition(stars.two)) earnedStars = 2;
        if (this._meetsCondition(stars.three)) earnedStars = 3;

        this._updateStars(earnedStars);
    }

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
                // Bonus completion count is evaluated at level end; HUD keeps star preview conservative.
                break;
            }
        }
        return true;
    }

    _updateStars(earnedStars) {
        const starRows = this.starsDisplay.querySelectorAll('.star-row');
        starRows.forEach((row, index) => {
            row.classList.toggle('earned', index + 1 <= earnedStars);
        });
    }

    /**
     * Update time display.
     * @param {number} elapsed - Elapsed time in milliseconds.
     */
    updateTime(elapsed) {
        this.elapsedTime = elapsed;

        if (this.timeLimit) {
            const remaining = Math.max(0, this.timeLimit * 1000 - elapsed);
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            this.timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            this.timeDisplay.classList.toggle('is-danger', remaining < 30000);
            this.timeDisplay.classList.toggle('is-warning', remaining >= 30000 && remaining < 60000);
        } else {
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            this.timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            this.timeDisplay.classList.remove('is-danger', 'is-warning');
        }
    }

    /**
     * Mark a bonus as complete.
     * @param {number} index - Bonus index.
     */
    completeBons(index) {
        this.completeBonus(index);
    }

    /**
     * Mark a bonus as complete.
     * @param {number} index - Bonus index.
     */
    completeBonus(index) {
        const bonusItem = this.bonusesDisplay.querySelector(`[data-index="${index}"]`);
        if (!bonusItem) return;

        const checkbox = bonusItem.querySelector('.bonus-checkbox');
        if (checkbox) {
            checkbox.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                </svg>
            `;
        }
        bonusItem.classList.add('is-complete');
    }

    /**
     * Enter victory lap mode.
     */
    enterVictoryLap() {
        this.isVictoryLap = true;
        this.container.classList.add('is-victory-lap');

        if (this.objectiveDisplay) {
            this.objectiveDisplay.textContent = 'VICTORY LAP';
        }
        if (this.progressBar) {
            this.progressBar.style.width = '100%';
            this.progressBar.classList.add('is-complete');
        }
        if (this.progressValue) {
            this.progressValue.textContent = 'COMPLETE!';
        }

        this._showFinishHint();
        console.log('[OdysseyHUD] Victory lap mode activated');
    }

    /**
     * Exit victory lap mode.
     */
    exitVictoryLap() {
        this.isVictoryLap = false;
        this.container.classList.remove('is-victory-lap');
        this._hideFinishHint();
        this._updateObjectiveDisplay();
        this._updateProgress();

        console.log('[OdysseyHUD] Victory lap mode deactivated');
    }

    _showFinishHint() {
        this.finishHint?.classList.add('is-visible');
    }

    _hideFinishHint() {
        this.finishHint?.classList.remove('is-visible');
    }

    /**
     * Reset all metrics.
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
        this.container.classList.remove('is-victory-lap');
        this.progressBar.classList.remove('is-complete');
        this.progressBar.style.width = '0%';
        this._updateProgress();
        this._updateStars(0);
        this.updateTime(0);
        this._hideFinishHint();
    }

    /**
     * Show HUD.
     */
    show() {
        const stage = document.querySelector('.single-player-stage');

        if (stage && this.container.parentElement !== stage) {
            stage.appendChild(this.container);
        }

        this.container.classList.add('is-visible');
        this.isVisible = true;
        console.log('[OdysseyHUD] Shown');
    }

    /**
     * Hide HUD.
     */
    hide() {
        this.container.classList.remove('is-visible');
        this.isVisible = false;
        console.log('[OdysseyHUD] Hidden');
    }

    /**
     * Get current level configuration.
     * @returns {Object|null}
     */
    getLevelConfig() {
        return this.levelConfig;
    }

    /**
     * Get current metrics.
     * @returns {Object}
     */
    getMetrics() {
        return { ...this.metrics, elapsedTime: this.elapsedTime };
    }

    /**
     * Destroy HUD and clean up.
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
