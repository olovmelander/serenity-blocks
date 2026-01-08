/**
 * @fileoverview Odyssey Mode Level Preview Panel
 * Displays detailed level information before starting gameplay
 */

import { getLevelById } from '../../core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';

/**
 * LevelPreviewPanel - Shows detailed level info before playing
 *
 * Features:
 * - Level name and description
 * - Objective details
 * - Modifiers active
 * - Star requirements
 * - Best score/time (if previously played)
 * - Play button
 */
export class LevelPreviewPanel {
    /**
     * Create preview panel
     * @param {Object} options - Configuration options
     */
    constructor(options = {}) {
        // Callbacks
        this.onPlay = options.onPlay || (() => {});
        this.onClose = options.onClose || (() => {});

        // State
        this.isVisible = false;
        this.currentLevelId = null;
        this.levelConfig = null;
        this.completionData = null;

        // DOM elements
        this.container = null;
        this.overlay = null;
        this.panel = null;

        // Initialize
        this._initialize();
    }

    /**
     * Initialize panel
     * @private
     */
    _initialize() {
        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'level-preview-overlay';
        this.overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(8px);
            z-index: 1100;
            display: none;
            justify-content: center;
            align-items: center;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.hide();
        });

        // Create panel
        this.panel = document.createElement('div');
        this.panel.className = 'level-preview-panel';
        this.panel.style.cssText = `
            width: min(500px, 90vw);
            max-height: 90vh;
            background: linear-gradient(165deg,
                rgba(25, 15, 50, 0.98) 0%,
                rgba(15, 10, 35, 0.98) 100%);
            border: 2px solid rgba(180, 130, 255, 0.4);
            border-radius: 24px;
            padding: 32px;
            font-family: 'Orbitron', 'Segoe UI', sans-serif;
            color: #fff;
            box-shadow:
                0 24px 80px rgba(0, 0, 0, 0.6),
                0 0 80px rgba(180, 130, 255, 0.15);
            transform: scale(0.9);
            transition: transform 0.3s ease;
            overflow-y: auto;
        `;

        this.overlay.appendChild(this.panel);
        document.body.appendChild(this.overlay);

        // Setup keyboard
        this._setupKeyboard();

        console.log('[LevelPreviewPanel] Initialized');
    }

    /**
     * Setup keyboard handlers
     * @private
     */
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
     * Show preview for a level
     * @param {number} levelId - Level ID to preview
     * @param {Object} [completionData] - Previous completion data
     */
    show(levelId, completionData = null) {
        this.currentLevelId = levelId;
        this.levelConfig = getLevelById(levelId);
        this.completionData = completionData;

        if (!this.levelConfig) {
            console.error('[LevelPreviewPanel] Level not found:', levelId);
            return;
        }

        this._buildContent();

        this.overlay.style.display = 'flex';
        this.isVisible = true;

        // Animate in
        requestAnimationFrame(() => {
            this.overlay.style.opacity = '1';
            this.panel.style.transform = 'scale(1)';
        });

        console.log('[LevelPreviewPanel] Shown for level:', levelId);
    }

    /**
     * Build panel content
     * @private
     */
    _buildContent() {
        const level = this.levelConfig;
        const chapter = CHAPTER_CONFIGS.find(c => c.id === level.chapter);

        this.panel.innerHTML = `
            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
                <div>
                    <div style="font-size: 11px; color: rgba(180, 130, 255, 0.7); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px;">
                        Chapter ${level.chapter} • Level ${level.chapterLevel}
                    </div>
                    <h2 style="font-size: 28px; font-weight: 700; color: #fff; margin: 0; text-shadow: 0 0 30px rgba(180, 130, 255, 0.5);">
                        ${level.name}
                    </h2>
                </div>
                <button class="preview-close-btn" style="
                    width: 36px;
                    height: 36px;
                    border: 2px solid rgba(255, 255, 255, 0.2);
                    border-radius: 50%;
                    background: rgba(255, 255, 255, 0.05);
                    color: #fff;
                    font-size: 20px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">&times;</button>
            </div>

            <!-- Description -->
            <div style="
                background: rgba(0, 0, 0, 0.3);
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 20px;
                font-size: 13px;
                color: rgba(255, 255, 255, 0.7);
                line-height: 1.6;
            ">
                ${level.metadata.description}
            </div>

            <!-- Objective Section -->
            <div style="margin-bottom: 20px;">
                <div style="font-size: 11px; color: rgba(180, 130, 255, 0.7); letter-spacing: 1.5px; margin-bottom: 8px;">OBJECTIVE</div>
                <div style="
                    background: rgba(100, 220, 255, 0.1);
                    border: 1px solid rgba(100, 220, 255, 0.3);
                    border-radius: 12px;
                    padding: 16px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                ">
                    <div style="
                        width: 48px;
                        height: 48px;
                        background: rgba(100, 220, 255, 0.2);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 24px;
                    ">${this._getObjectiveIcon(level.victory.primary.type)}</div>
                    <div>
                        <div style="font-size: 16px; font-weight: 600; color: rgba(100, 220, 255, 1);">
                            ${this._getObjectiveText(level.victory.primary)}
                        </div>
                        ${level.victory.failure.type === 'time' ? `
                        <div style="font-size: 12px; color: rgba(255, 150, 100, 0.8); margin-top: 4px;">
                            Time Limit: ${this._formatTime(level.victory.failure.value)}
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>

            <!-- Modifiers -->
            ${level.modifiers.active.length > 0 ? `
            <div style="margin-bottom: 20px;">
                <div style="font-size: 11px; color: rgba(180, 130, 255, 0.7); letter-spacing: 1.5px; margin-bottom: 8px;">ACTIVE MODIFIERS</div>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${level.modifiers.active.map(mod => `
                        <div style="
                            padding: 8px 14px;
                            background: rgba(255, 200, 100, 0.1);
                            border: 1px solid rgba(255, 200, 100, 0.3);
                            border-radius: 20px;
                            font-size: 11px;
                            color: rgba(255, 200, 100, 0.9);
                            text-transform: capitalize;
                        ">${mod.replace(/-/g, ' ')}</div>
                    `).join('')}
                </div>
            </div>
            ` : ''}

            <!-- Star Requirements -->
            <div style="margin-bottom: 20px;">
                <div style="font-size: 11px; color: rgba(180, 130, 255, 0.7); letter-spacing: 1.5px; margin-bottom: 8px;">STAR REQUIREMENTS</div>
                <div style="
                    background: rgba(0, 0, 0, 0.3);
                    border-radius: 12px;
                    padding: 12px 16px;
                ">
                    ${this._buildStarRequirements(level.stars)}
                </div>
            </div>

            <!-- Best Score (if previously played) -->
            ${this.completionData ? `
            <div style="margin-bottom: 24px;">
                <div style="font-size: 11px; color: rgba(100, 255, 150, 0.7); letter-spacing: 1.5px; margin-bottom: 8px;">YOUR BEST</div>
                <div style="
                    background: rgba(100, 255, 150, 0.1);
                    border: 1px solid rgba(100, 255, 150, 0.3);
                    border-radius: 12px;
                    padding: 16px;
                    display: flex;
                    justify-content: space-around;
                    text-align: center;
                ">
                    <div>
                        <div style="font-size: 10px; color: rgba(255, 255, 255, 0.5); margin-bottom: 4px;">STARS</div>
                        <div style="font-size: 20px; color: rgba(255, 200, 100, 1);">
                            ${'★'.repeat(this.completionData.stars)}${'☆'.repeat(3 - this.completionData.stars)}
                        </div>
                    </div>
                    <div>
                        <div style="font-size: 10px; color: rgba(255, 255, 255, 0.5); margin-bottom: 4px;">SCORE</div>
                        <div style="font-size: 20px; color: rgba(100, 255, 150, 1);">${this.completionData.bestScore?.toLocaleString() || '—'}</div>
                    </div>
                    <div>
                        <div style="font-size: 10px; color: rgba(255, 255, 255, 0.5); margin-bottom: 4px;">TIME</div>
                        <div style="font-size: 20px; color: rgba(100, 220, 255, 1);">${this.completionData.bestTime ? this._formatTime(this.completionData.bestTime) : '—'}</div>
                    </div>
                </div>
            </div>
            ` : ''}

            <!-- Tip -->
            ${level.metadata.tip ? `
            <div style="
                background: rgba(180, 130, 255, 0.1);
                border-left: 3px solid rgba(180, 130, 255, 0.5);
                padding: 12px 16px;
                margin-bottom: 24px;
                font-size: 12px;
                color: rgba(255, 255, 255, 0.7);
                line-height: 1.5;
            ">
                <span style="color: rgba(180, 130, 255, 0.9); font-weight: 600;">Tip:</span> ${level.metadata.tip}
            </div>
            ` : ''}

            <!-- Actions -->
            <div style="display: flex; gap: 12px;">
                <button class="preview-cancel-btn" style="
                    flex: 1;
                    padding: 16px 24px;
                    background: rgba(255, 255, 255, 0.1);
                    border: 2px solid rgba(255, 255, 255, 0.2);
                    border-radius: 12px;
                    color: #fff;
                    font-family: inherit;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                ">Back</button>
                <button class="preview-play-btn" style="
                    flex: 2;
                    padding: 16px 24px;
                    background: linear-gradient(135deg, rgba(180, 130, 255, 0.8), rgba(130, 100, 255, 0.8));
                    border: none;
                    border-radius: 12px;
                    color: #fff;
                    font-family: inherit;
                    font-size: 16px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    box-shadow: 0 4px 20px rgba(180, 130, 255, 0.3);
                    letter-spacing: 1px;
                ">PLAY</button>
            </div>
        `;

        // Setup button events
        const closeBtn = this.panel.querySelector('.preview-close-btn');
        const cancelBtn = this.panel.querySelector('.preview-cancel-btn');
        const playBtn = this.panel.querySelector('.preview-play-btn');

        closeBtn.addEventListener('click', () => this.hide());
        cancelBtn.addEventListener('click', () => this.hide());
        playBtn.addEventListener('click', () => this._startLevel());

        // Button hover effects
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = 'rgba(255, 100, 100, 0.2)';
            closeBtn.style.borderColor = 'rgba(255, 100, 100, 0.5)';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.05)';
            closeBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        });

        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.background = 'rgba(255, 255, 255, 0.2)';
        });
        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.background = 'rgba(255, 255, 255, 0.1)';
        });

        playBtn.addEventListener('mouseenter', () => {
            playBtn.style.transform = 'translateY(-2px)';
            playBtn.style.boxShadow = '0 6px 24px rgba(180, 130, 255, 0.5)';
        });
        playBtn.addEventListener('mouseleave', () => {
            playBtn.style.transform = 'translateY(0)';
            playBtn.style.boxShadow = '0 4px 20px rgba(180, 130, 255, 0.3)';
        });
    }

    /**
     * Get objective icon based on type
     * @private
     */
    _getObjectiveIcon(type) {
        const icons = {
            lines: '═',
            score: '★',
            cascade: '↯',
            time: '⏱',
            height: '↑',
        };
        return icons[type] || '◆';
    }

    /**
     * Get objective text
     * @private
     */
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

    /**
     * Build star requirements HTML
     * @private
     */
    _buildStarRequirements(stars) {
        return ['one', 'two', 'three'].map((key, index) => {
            const reqs = stars[key];
            const reqText = Object.entries(reqs).map(([k, v]) => {
                if (k === 'time') return `Under ${this._formatTime(v)}`;
                if (k === 'bonuses') return `${v}+ Bonus${v > 1 ? 'es' : ''}`;
                return `${v}+ ${k}`;
            }).join(', ');

            return `
                <div style="
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 8px 0;
                    ${index < 2 ? 'border-bottom: 1px solid rgba(255, 255, 255, 0.1);' : ''}
                ">
                    <div style="color: rgba(255, 200, 100, 1); font-size: 16px;">
                        ${'★'.repeat(index + 1)}${'☆'.repeat(2 - index)}
                    </div>
                    <div style="font-size: 12px; color: rgba(255, 255, 255, 0.6);">${reqText}</div>
                </div>
            `;
        }).join('');
    }

    /**
     * Format time in seconds to mm:ss
     * @private
     */
    _formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Start the level
     * @private
     */
    _startLevel() {
        if (this.currentLevelId) {
            this.onPlay(this.currentLevelId);
            this.hide();
        }
    }

    /**
     * Hide the preview panel
     */
    hide() {
        this.overlay.style.opacity = '0';
        this.panel.style.transform = 'scale(0.9)';

        setTimeout(() => {
            this.overlay.style.display = 'none';
            this.isVisible = false;
            this.onClose();
        }, 300);

        console.log('[LevelPreviewPanel] Hidden');
    }

    /**
     * Check if panel is visible
     * @returns {boolean}
     */
    getIsVisible() {
        return this.isVisible;
    }

    /**
     * Destroy panel and clean up
     */
    destroy() {
        document.removeEventListener('keydown', this._keyHandler);

        if (this.overlay && this.overlay.parentElement) {
            this.overlay.parentElement.removeChild(this.overlay);
        }

        console.log('[LevelPreviewPanel] Destroyed');
    }
}
