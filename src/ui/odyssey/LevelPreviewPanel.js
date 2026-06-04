/**
 * @fileoverview Odyssey Mode Level Preview Panel
 * Displays detailed level information before starting gameplay.
 */

import { getLevelRegistry } from '../../core/odyssey/LevelRegistry.js';

/**
 * LevelPreviewPanel - Shows detailed level info before playing.
 */
export class LevelPreviewPanel {
    /**
     * Create preview panel.
     * @param {Object} options - Configuration options.
     */
    constructor(options = {}) {
        this.onPlay = options.onPlay || (() => {});
        this.onClose = options.onClose || (() => {});

        this.isVisible = false;
        this.currentLevelId = null;
        this.levelConfig = null;
        this.completionData = null;
        this.levelRegistry = getLevelRegistry();

        this.container = null;
        this.overlay = null;
        this.panel = null;

        this._initialize();
    }

    _initialize() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'level-preview-overlay';
        this.overlay.dataset.odysseyWheelLock = 'true';
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.hide();
        });

        this.panel = document.createElement('div');
        this.panel.className = 'level-preview-panel';

        this.overlay.appendChild(this.panel);
        document.body.appendChild(this.overlay);

        this._setupKeyboard();
        console.log('[LevelPreviewPanel] Initialized');
    }

    _setupKeyboard() {
        this._keyHandler = (e) => {
            if (!this.isVisible) return;

            switch (e.key) {
            case 'Escape':
                e.preventDefault();
                this.hide();
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                this._startLevel();
                break;
            }
        };

        document.addEventListener('keydown', this._keyHandler);
    }

    /**
     * Show preview for a level.
     * @param {number} levelId - Level ID to preview.
     * @param {Object} [completionData] - Previous completion data.
     */
    show(levelId, completionData = null) {
        this.currentLevelId = levelId;
        this.levelConfig = this.levelRegistry.resolveLevelPresentation(levelId);
        this.completionData = completionData;

        if (!this.levelConfig) {
            console.error('[LevelPreviewPanel] Level not found:', levelId);
            return;
        }

        this._buildContent();
        this.overlay.classList.add('is-visible');
        this.isVisible = true;

        console.log('[LevelPreviewPanel] Shown for level:', levelId);
    }

    _buildContent() {
        const level = this.levelConfig;
        const title = this._escapeHtml(level.pathLabel || level.name);
        const description = this._escapeHtml(level.description);
        const timeLimit = level.victory.failure.type === 'time'
            ? `<div class="ody-time-limit">Time Limit: ${this._formatTime(level.victory.failure.value)}</div>`
            : '';
        const modifiers = level.modifiers.active.length > 0 ? `
            <div class="ody-section">
                <div class="ody-section-title">Active Modifiers</div>
                <div class="ody-modifier-list">
                    ${level.modifiers.active.map((mod) => (
        `<div class="ody-modifier">${this._escapeHtml(mod.replace(/-/g, ' '))}</div>`
    )).join('')}
                </div>
            </div>
        ` : '';
        const best = this.completionData ? `
            <div class="ody-section">
                <div class="ody-section-title">Your Best</div>
                <div class="ody-best-card">
                    <div>
                        <div class="ody-stat-label">Stars</div>
                        <div class="ody-stat-value is-gold">${'&#9733;'.repeat(this.completionData.stars)}${'&#9734;'.repeat(3 - this.completionData.stars)}</div>
                    </div>
                    <div>
                        <div class="ody-stat-label">Score</div>
                        <div class="ody-stat-value is-success">${this.completionData.bestScore?.toLocaleString() || '&mdash;'}</div>
                    </div>
                    <div>
                        <div class="ody-stat-label">Time</div>
                        <div class="ody-stat-value is-cyan">${this.completionData.bestTime ? this._formatTime(this.completionData.bestTime) : '&mdash;'}</div>
                    </div>
                </div>
            </div>
        ` : '';
        const tip = level.metadata.tip ? `
            <div class="ody-tip">
                <span class="ody-tip-label">Tip:</span> ${this._escapeHtml(level.metadata.tip)}
            </div>
        ` : '';

        this.panel.innerHTML = `
            <div class="ody-modal-header">
                <div>
                    <div class="ody-eyebrow">Chapter ${level.chapter} &middot; Level ${level.chapterLevel}</div>
                    <h2 class="ody-title">${title}</h2>
                </div>
                <button class="preview-close-btn" aria-label="Close level preview">&times;</button>
            </div>

            <div class="ody-card">${description}</div>

            <div class="ody-section">
                <div class="ody-section-title">Objective</div>
                <div class="ody-objective-card">
                    <div class="ody-objective-icon">${this._getObjectiveIcon(level.victory.primary.type)}</div>
                    <div>
                        <div class="ody-objective-text">${this._getObjectiveText(level.victory.primary)}</div>
                        ${timeLimit}
                    </div>
                </div>
            </div>

            ${modifiers}

            <div class="ody-section">
                <div class="ody-section-title">Star Requirements</div>
                <div class="ody-star-requirements">
                    ${this._buildStarRequirements(level.stars)}
                </div>
            </div>

            ${best}
            ${tip}

            <div class="ody-actions">
                <button class="ody-btn ody-btn-secondary preview-cancel-btn">Back</button>
                <button class="ody-btn ody-btn-primary preview-play-btn">Play</button>
            </div>
        `;

        this.panel.querySelector('.preview-close-btn')?.addEventListener('click', () => this.hide());
        this.panel.querySelector('.preview-cancel-btn')?.addEventListener('click', () => this.hide());
        this.panel.querySelector('.preview-play-btn')?.addEventListener('click', () => this._startLevel());
    }

    _getObjectiveIcon(type) {
        const icons = {
            lines: 'L',
            score: '&#9733;',
            cascade: '&darr;',
            time: 'T',
            height: '&uarr;',
        };
        return icons[type] || '&diams;';
    }

    _getObjectiveText(objective) {
        const { type, target } = objective;
        switch (type) {
        case 'lines':
            return `Clear ${target} Lines`;
        case 'score':
            return `Score ${target.toLocaleString()} Points`;
        case 'cascade':
            return `Trigger ${target} Cascades`;
        case 'time':
            return `Survive for ${this._formatTime(target)}`;
        case 'height':
            return `Build to ${target} Rows`;
        default:
            return 'Complete the Objective';
        }
    }

    _buildStarRequirements(stars) {
        return ['one', 'two', 'three'].map((key, index) => {
            const reqs = stars[key];
            const reqText = Object.entries(reqs).map(([k, v]) => {
                if (k === 'time') return `Under ${this._formatTime(v)}`;
                if (k === 'bonuses') return `${v}+ Bonus${v > 1 ? 'es' : ''}`;
                return `${v}+ ${k}`;
            }).join(', ');

            return `
                <div class="ody-star-requirement">
                    <div class="ody-star-icons">${'&#9733;'.repeat(index + 1)}${'&#9734;'.repeat(2 - index)}</div>
                    <div class="ody-star-text">${this._escapeHtml(reqText)}</div>
                </div>
            `;
        }).join('');
    }

    _formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    _startLevel() {
        if (this.currentLevelId) {
            this.onPlay(this.currentLevelId);
            this.hide();
        }
    }

    hide() {
        this.overlay.classList.remove('is-visible');

        setTimeout(() => {
            this.isVisible = false;
            this.onClose();
        }, 300);

        console.log('[LevelPreviewPanel] Hidden');
    }

    getIsVisible() {
        return this.isVisible;
    }

    destroy() {
        document.removeEventListener('keydown', this._keyHandler);

        if (this.overlay && this.overlay.parentElement) {
            this.overlay.parentElement.removeChild(this.overlay);
        }

        console.log('[LevelPreviewPanel] Destroyed');
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}
