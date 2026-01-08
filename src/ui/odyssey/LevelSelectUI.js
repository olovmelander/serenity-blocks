/**
 * @fileoverview Odyssey Mode Level Selection UI
 * Full-screen level selection interface with chapter tabs and level grid
 */

import { LEVEL_CONFIGS, getLevelsByChapter } from '../../core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';

/**
 * LevelSelectUI - Level selection interface for Odyssey Mode
 *
 * Features:
 * - Chapter tabs for navigation
 * - Level grid with unlock/completion states
 * - Star display for each level
 * - Chapter progress overview
 * - Keyboard/gamepad navigation support
 */
export class LevelSelectUI {
    /**
     * Create level select UI
     * @param {Object} options - Configuration options
     */
    constructor(options = {}) {
        // Callbacks
        this.onLevelSelect = options.onLevelSelect || (() => {});
        this.onClose = options.onClose || (() => {});

        // State
        this.isVisible = false;
        this.selectedChapter = 1;
        this.selectedLevelIndex = 0;
        this.unlockedLevels = new Set([1]);
        this.completedLevels = new Map();

        // DOM elements
        this.container = null;
        this.chapterTabs = null;
        this.levelGrid = null;
        this.chapterProgress = null;

        // Initialize
        this._initialize();
    }

    /**
     * Initialize UI
     * @private
     */
    _initialize() {
        // Create main container
        this.container = document.createElement('div');
        this.container.id = 'odyssey-level-select';
        this.container.className = 'odyssey-level-select';
        this.container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg,
                rgba(10, 5, 25, 0.98) 0%,
                rgba(20, 10, 40, 0.98) 50%,
                rgba(10, 5, 25, 0.98) 100%);
            z-index: 1000;
            display: none;
            flex-direction: column;
            font-family: 'Orbitron', 'Segoe UI', sans-serif;
            color: #fff;
            overflow: hidden;
        `;

        // Create header
        this._createHeader();

        // Create chapter tabs
        this._createChapterTabs();

        // Create main content area
        this._createMainContent();

        // Create footer
        this._createFooter();

        // Add to document
        document.body.appendChild(this.container);

        // Setup keyboard navigation
        this._setupKeyboardNavigation();

        console.log('[LevelSelectUI] Initialized');
    }

    /**
     * Create header section
     * @private
     */
    _createHeader() {
        const header = document.createElement('div');
        header.className = 'level-select-header';
        header.style.cssText = `
            padding: 20px 40px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(180, 130, 255, 0.2);
        `;

        // Title
        const title = document.createElement('h1');
        title.textContent = 'ODYSSEY MODE';
        title.style.cssText = `
            font-size: 28px;
            font-weight: 700;
            letter-spacing: 4px;
            color: rgba(180, 130, 255, 1);
            text-shadow: 0 0 30px rgba(180, 130, 255, 0.5);
            margin: 0;
        `;
        header.appendChild(title);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'level-select-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = `
            width: 44px;
            height: 44px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            font-size: 28px;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
        `;
        closeBtn.addEventListener('click', () => this.hide());
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = 'rgba(255, 100, 100, 0.3)';
            closeBtn.style.borderColor = 'rgba(255, 100, 100, 0.6)';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
            closeBtn.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        });
        header.appendChild(closeBtn);

        this.container.appendChild(header);
    }

    /**
     * Create chapter tabs
     * @private
     */
    _createChapterTabs() {
        const tabContainer = document.createElement('div');
        tabContainer.className = 'chapter-tabs-container';
        tabContainer.style.cssText = `
            padding: 0 40px;
            background: rgba(0, 0, 0, 0.2);
            border-bottom: 1px solid rgba(180, 130, 255, 0.1);
        `;

        this.chapterTabs = document.createElement('div');
        this.chapterTabs.className = 'chapter-tabs';
        this.chapterTabs.style.cssText = `
            display: flex;
            gap: 4px;
            overflow-x: auto;
            scrollbar-width: none;
            -ms-overflow-style: none;
            padding: 12px 0;
        `;

        // Create tab for each chapter
        CHAPTER_CONFIGS.forEach((chapter) => {
            const tab = document.createElement('button');
            tab.className = 'chapter-tab';
            tab.dataset.chapter = chapter.id;
            tab.innerHTML = `
                <span class="tab-number">${chapter.id}</span>
                <span class="tab-name">${chapter.name.split('&')[0].trim()}</span>
            `;
            tab.style.cssText = `
                padding: 12px 20px;
                border: none;
                border-radius: 8px 8px 0 0;
                background: transparent;
                color: rgba(255, 255, 255, 0.5);
                font-family: inherit;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                gap: 8px;
                white-space: nowrap;
                position: relative;
            `;

            // Style the number
            const numberSpan = tab.querySelector('.tab-number');
            numberSpan.style.cssText = `
                width: 24px;
                height: 24px;
                border-radius: 50%;
                background: rgba(180, 130, 255, 0.2);
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 700;
                font-size: 11px;
            `;

            tab.addEventListener('click', () => this.selectChapter(chapter.id));

            this.chapterTabs.appendChild(tab);
        });

        tabContainer.appendChild(this.chapterTabs);
        this.container.appendChild(tabContainer);
    }

    /**
     * Create main content area
     * @private
     */
    _createMainContent() {
        const mainContent = document.createElement('div');
        mainContent.className = 'level-select-main';
        mainContent.style.cssText = `
            flex: 1;
            display: flex;
            padding: 30px 40px;
            gap: 30px;
            overflow: hidden;
        `;

        // Chapter info panel (left side)
        this._createChapterInfo(mainContent);

        // Level grid (right side)
        this._createLevelGrid(mainContent);

        this.container.appendChild(mainContent);
    }

    /**
     * Create chapter info panel
     * @private
     */
    _createChapterInfo(parent) {
        this.chapterInfo = document.createElement('div');
        this.chapterInfo.className = 'chapter-info';
        this.chapterInfo.style.cssText = `
            width: 300px;
            flex-shrink: 0;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 16px;
            padding: 24px;
            border: 1px solid rgba(180, 130, 255, 0.2);
            display: flex;
            flex-direction: column;
            gap: 20px;
        `;

        // Chapter title
        this.chapterTitle = document.createElement('div');
        this.chapterTitle.className = 'chapter-title';
        this.chapterTitle.style.cssText = `
            font-size: 20px;
            font-weight: 700;
            color: rgba(180, 130, 255, 1);
            text-shadow: 0 0 20px rgba(180, 130, 255, 0.4);
        `;
        this.chapterInfo.appendChild(this.chapterTitle);

        // Chapter subtitle
        this.chapterSubtitle = document.createElement('div');
        this.chapterSubtitle.className = 'chapter-subtitle';
        this.chapterSubtitle.style.cssText = `
            font-size: 13px;
            color: rgba(255, 255, 255, 0.6);
            font-style: italic;
            margin-top: -12px;
        `;
        this.chapterInfo.appendChild(this.chapterSubtitle);

        // Chapter progress
        this.chapterProgress = document.createElement('div');
        this.chapterProgress.className = 'chapter-progress';
        this.chapterProgress.style.cssText = `
            background: rgba(0, 0, 0, 0.3);
            border-radius: 12px;
            padding: 16px;
        `;
        this.chapterInfo.appendChild(this.chapterProgress);

        // Chapter narrative
        this.chapterNarrative = document.createElement('div');
        this.chapterNarrative.className = 'chapter-narrative';
        this.chapterNarrative.style.cssText = `
            font-size: 12px;
            color: rgba(255, 255, 255, 0.5);
            line-height: 1.6;
            flex: 1;
        `;
        this.chapterInfo.appendChild(this.chapterNarrative);

        parent.appendChild(this.chapterInfo);
    }

    /**
     * Create level grid
     * @private
     */
    _createLevelGrid(parent) {
        const gridContainer = document.createElement('div');
        gridContainer.className = 'level-grid-container';
        gridContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding-right: 10px;
        `;

        this.levelGrid = document.createElement('div');
        this.levelGrid.className = 'level-grid';
        this.levelGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 16px;
        `;

        gridContainer.appendChild(this.levelGrid);
        parent.appendChild(gridContainer);
    }

    /**
     * Create footer
     * @private
     */
    _createFooter() {
        const footer = document.createElement('div');
        footer.className = 'level-select-footer';
        footer.style.cssText = `
            padding: 16px 40px;
            background: rgba(0, 0, 0, 0.3);
            border-top: 1px solid rgba(180, 130, 255, 0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;

        // Total progress
        this.totalProgress = document.createElement('div');
        this.totalProgress.className = 'total-progress';
        this.totalProgress.style.cssText = `
            display: flex;
            gap: 20px;
            font-size: 13px;
            color: rgba(255, 255, 255, 0.6);
        `;
        footer.appendChild(this.totalProgress);

        // Controls hint
        const controlsHint = document.createElement('div');
        controlsHint.className = 'controls-hint';
        controlsHint.innerHTML = `
            <span style="color: rgba(180, 130, 255, 0.8);">Navigate:</span> Arrow Keys &nbsp;|&nbsp;
            <span style="color: rgba(180, 130, 255, 0.8);">Select:</span> Enter &nbsp;|&nbsp;
            <span style="color: rgba(180, 130, 255, 0.8);">Back:</span> Escape
        `;
        controlsHint.style.cssText = `
            font-size: 11px;
            color: rgba(255, 255, 255, 0.4);
            letter-spacing: 0.5px;
        `;
        footer.appendChild(controlsHint);

        this.container.appendChild(footer);
    }

    /**
     * Setup keyboard navigation
     * @private
     */
    _setupKeyboardNavigation() {
        this._keyHandler = (e) => {
            if (!this.isVisible) return;

            switch (e.key) {
                case 'Escape':
                    e.preventDefault();
                    this.hide();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this._navigateLevel(-1);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this._navigateLevel(1);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this._navigateChapter(-1);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this._navigateChapter(1);
                    break;
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    this._selectCurrentLevel();
                    break;
            }
        };

        document.addEventListener('keydown', this._keyHandler);
    }

    /**
     * Navigate between levels
     * @private
     * @param {number} direction - -1 for left, 1 for right
     */
    _navigateLevel(direction) {
        const levels = getLevelsByChapter(this.selectedChapter);
        const newIndex = this.selectedLevelIndex + direction;

        if (newIndex >= 0 && newIndex < levels.length) {
            this.selectedLevelIndex = newIndex;
            this._highlightSelectedLevel();
        }
    }

    /**
     * Navigate between chapters
     * @private
     * @param {number} direction - -1 for up, 1 for down
     */
    _navigateChapter(direction) {
        const newChapter = this.selectedChapter + direction;
        if (newChapter >= 1 && newChapter <= CHAPTER_CONFIGS.length) {
            this.selectChapter(newChapter);
        }
    }

    /**
     * Select the currently highlighted level
     * @private
     */
    _selectCurrentLevel() {
        const levels = getLevelsByChapter(this.selectedChapter);
        const level = levels[this.selectedLevelIndex];

        if (level && this.unlockedLevels.has(level.id)) {
            this.onLevelSelect(level.id);
            this.hide();
        }
    }

    /**
     * Highlight the selected level
     * @private
     */
    _highlightSelectedLevel() {
        // Remove previous highlight
        const prevSelected = this.levelGrid.querySelector('.level-card.selected');
        if (prevSelected) {
            prevSelected.classList.remove('selected');
            prevSelected.style.transform = 'scale(1)';
            prevSelected.style.boxShadow = '';
        }

        // Add new highlight
        const levels = getLevelsByChapter(this.selectedChapter);
        const levelCards = this.levelGrid.querySelectorAll('.level-card');

        if (levelCards[this.selectedLevelIndex]) {
            const card = levelCards[this.selectedLevelIndex];
            card.classList.add('selected');
            card.style.transform = 'scale(1.05)';
            card.style.boxShadow = '0 0 30px rgba(180, 130, 255, 0.5)';
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    /**
     * Select a chapter and update display
     * @param {number} chapterId - Chapter ID to select
     */
    selectChapter(chapterId) {
        this.selectedChapter = chapterId;
        this.selectedLevelIndex = 0;

        // Update tab styles
        const tabs = this.chapterTabs.querySelectorAll('.chapter-tab');
        tabs.forEach((tab) => {
            const isActive = parseInt(tab.dataset.chapter) === chapterId;
            tab.style.background = isActive ? 'rgba(180, 130, 255, 0.2)' : 'transparent';
            tab.style.color = isActive ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.5)';
            tab.style.borderBottom = isActive ? '2px solid rgba(180, 130, 255, 0.8)' : 'none';

            const numberSpan = tab.querySelector('.tab-number');
            numberSpan.style.background = isActive ? 'rgba(180, 130, 255, 0.5)' : 'rgba(180, 130, 255, 0.2)';
        });

        // Update chapter info
        this._updateChapterInfo();

        // Update level grid
        this._updateLevelGrid();
    }

    /**
     * Update chapter info panel
     * @private
     */
    _updateChapterInfo() {
        const chapter = CHAPTER_CONFIGS.find(c => c.id === this.selectedChapter);
        if (!chapter) return;

        this.chapterTitle.textContent = `Chapter ${chapter.id}: ${chapter.name}`;
        this.chapterSubtitle.textContent = chapter.subtitle;

        // Calculate chapter progress
        const levels = getLevelsByChapter(this.selectedChapter);
        const completedCount = levels.filter(l => this.completedLevels.has(l.id)).length;
        const totalStars = levels.reduce((sum, l) => {
            const completion = this.completedLevels.get(l.id);
            return sum + (completion?.stars || 0);
        }, 0);
        const maxStars = levels.length * 3;

        this.chapterProgress.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                <span style="color: rgba(255, 255, 255, 0.6); font-size: 11px;">PROGRESS</span>
                <span style="color: rgba(180, 130, 255, 1); font-weight: 700;">${completedCount}/${levels.length}</span>
            </div>
            <div style="height: 8px; background: rgba(0, 0, 0, 0.4); border-radius: 4px; overflow: hidden; margin-bottom: 16px;">
                <div style="height: 100%; width: ${(completedCount / levels.length) * 100}%; background: linear-gradient(90deg, rgba(100, 180, 255, 1), rgba(180, 130, 255, 1)); border-radius: 4px;"></div>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span style="color: rgba(255, 255, 255, 0.6); font-size: 11px;">STARS</span>
                <span style="color: rgba(255, 200, 100, 1); font-weight: 700;">${totalStars}/${maxStars} ★</span>
            </div>
        `;

        // Chapter narrative
        this.chapterNarrative.textContent = chapter.narrative?.intro || '';
    }

    /**
     * Update level grid
     * @private
     */
    _updateLevelGrid() {
        this.levelGrid.innerHTML = '';

        const levels = getLevelsByChapter(this.selectedChapter);

        levels.forEach((level, index) => {
            const card = this._createLevelCard(level, index);
            this.levelGrid.appendChild(card);
        });

        // Highlight first level
        this._highlightSelectedLevel();
    }

    /**
     * Create a level card
     * @private
     * @param {Object} level - Level configuration
     * @param {number} index - Index in the grid
     * @returns {HTMLElement}
     */
    _createLevelCard(level, index) {
        const isUnlocked = this.unlockedLevels.has(level.id);
        const completion = this.completedLevels.get(level.id);
        const isCompleted = !!completion;
        const stars = completion?.stars || 0;

        const card = document.createElement('div');
        card.className = 'level-card';
        card.dataset.levelId = level.id;
        card.style.cssText = `
            background: ${isUnlocked ? 'rgba(30, 20, 50, 0.8)' : 'rgba(20, 15, 30, 0.6)'};
            border: 2px solid ${isCompleted ? 'rgba(100, 255, 150, 0.4)' : isUnlocked ? 'rgba(180, 130, 255, 0.3)' : 'rgba(100, 100, 100, 0.2)'};
            border-radius: 12px;
            padding: 16px;
            cursor: ${isUnlocked ? 'pointer' : 'not-allowed'};
            transition: all 0.3s ease;
            opacity: ${isUnlocked ? '1' : '0.5'};
            position: relative;
            overflow: hidden;
        `;

        // Level number
        const levelNum = document.createElement('div');
        levelNum.className = 'level-num';
        levelNum.textContent = level.id;
        levelNum.style.cssText = `
            position: absolute;
            top: 8px;
            right: 8px;
            width: 24px;
            height: 24px;
            background: rgba(180, 130, 255, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: 700;
            color: rgba(180, 130, 255, 0.8);
        `;
        card.appendChild(levelNum);

        // Lock icon for locked levels
        if (!isUnlocked) {
            const lockIcon = document.createElement('div');
            lockIcon.className = 'lock-icon';
            lockIcon.innerHTML = `
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
                    <path d="M8 11V7a4 4 0 118 0v4" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
                </svg>
            `;
            lockIcon.style.cssText = `
                display: flex;
                justify-content: center;
                align-items: center;
                height: 60px;
            `;
            card.appendChild(lockIcon);
        } else {
            // Stars display
            const starsContainer = document.createElement('div');
            starsContainer.className = 'level-stars';
            starsContainer.style.cssText = `
                display: flex;
                justify-content: center;
                gap: 4px;
                margin-bottom: 8px;
                height: 24px;
            `;

            for (let i = 1; i <= 3; i++) {
                const star = document.createElement('span');
                star.innerHTML = i <= stars ? '★' : '☆';
                star.style.cssText = `
                    font-size: 18px;
                    color: ${i <= stars ? 'rgba(255, 200, 100, 1)' : 'rgba(255, 255, 255, 0.2)'};
                    text-shadow: ${i <= stars ? '0 0 8px rgba(255, 200, 100, 0.6)' : 'none'};
                `;
                starsContainer.appendChild(star);
            }
            card.appendChild(starsContainer);
        }

        // Level name
        const name = document.createElement('div');
        name.className = 'level-name';
        name.textContent = isUnlocked ? level.name : '???';
        name.style.cssText = `
            font-size: 13px;
            font-weight: 600;
            color: ${isUnlocked ? '#fff' : 'rgba(255, 255, 255, 0.3)'};
            text-align: center;
            margin-bottom: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        card.appendChild(name);

        // Difficulty
        if (isUnlocked) {
            const difficulty = document.createElement('div');
            difficulty.className = 'level-difficulty';
            const difficultyDots = '●'.repeat(level.metadata.difficulty) + '○'.repeat(10 - level.metadata.difficulty);
            difficulty.textContent = difficultyDots.substring(0, 10);
            difficulty.style.cssText = `
                font-size: 8px;
                letter-spacing: 1px;
                color: rgba(255, 100, 100, 0.6);
                text-align: center;
            `;
            card.appendChild(difficulty);
        }

        // Hover and click events for unlocked levels
        if (isUnlocked) {
            card.addEventListener('mouseenter', () => {
                if (!card.classList.contains('selected')) {
                    card.style.transform = 'translateY(-4px)';
                    card.style.boxShadow = '0 8px 24px rgba(180, 130, 255, 0.3)';
                }
            });

            card.addEventListener('mouseleave', () => {
                if (!card.classList.contains('selected')) {
                    card.style.transform = 'translateY(0)';
                    card.style.boxShadow = '';
                }
            });

            card.addEventListener('click', () => {
                this.selectedLevelIndex = index;
                this._highlightSelectedLevel();
                this.onLevelSelect(level.id);
                this.hide();
            });
        }

        return card;
    }

    /**
     * Update total progress display
     * @private
     */
    _updateTotalProgress() {
        const totalLevels = LEVEL_CONFIGS.length;
        const completedCount = this.completedLevels.size;
        const totalStars = Array.from(this.completedLevels.values()).reduce((sum, c) => sum + (c.stars || 0), 0);
        const maxStars = totalLevels * 3;

        this.totalProgress.innerHTML = `
            <div><span style="color: rgba(180, 130, 255, 0.8);">Total Progress:</span> ${completedCount}/${totalLevels} levels</div>
            <div><span style="color: rgba(255, 200, 100, 0.8);">Stars:</span> ${totalStars}/${maxStars} ★</div>
        `;
    }

    /**
     * Set unlocked levels
     * @param {Set<number>} unlockedLevels - Set of unlocked level IDs
     */
    setUnlockedLevels(unlockedLevels) {
        this.unlockedLevels = unlockedLevels;
        if (this.isVisible) {
            this._updateLevelGrid();
        }
    }

    /**
     * Set completed levels
     * @param {Map<number, Object>} completedLevels - Map of level ID to completion data
     */
    setCompletedLevels(completedLevels) {
        this.completedLevels = completedLevels;
        if (this.isVisible) {
            this._updateChapterInfo();
            this._updateLevelGrid();
            this._updateTotalProgress();
        }
    }

    /**
     * Show the level select UI
     * @param {number} [chapterId] - Optional chapter to select
     */
    show(chapterId) {
        this.container.style.display = 'flex';
        this.isVisible = true;

        // Select chapter
        if (chapterId) {
            this.selectChapter(chapterId);
        } else {
            this.selectChapter(this.selectedChapter);
        }

        this._updateTotalProgress();

        console.log('[LevelSelectUI] Shown');
    }

    /**
     * Hide the level select UI
     */
    hide() {
        this.container.style.display = 'none';
        this.isVisible = false;
        this.onClose();
        console.log('[LevelSelectUI] Hidden');
    }

    /**
     * Check if UI is visible
     * @returns {boolean}
     */
    getIsVisible() {
        return this.isVisible;
    }

    /**
     * Destroy UI and clean up
     */
    destroy() {
        document.removeEventListener('keydown', this._keyHandler);

        if (this.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }

        console.log('[LevelSelectUI] Destroyed');
    }
}
