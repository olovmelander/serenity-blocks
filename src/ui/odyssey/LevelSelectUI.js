/**
 * @fileoverview Odyssey Mode Level Selection UI
 * Full-screen level selection interface with chapter tabs and level grid.
 */

import { LEVEL_CONFIGS, getLevelsByChapter } from '../../core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';

/**
 * LevelSelectUI - Level selection interface for Odyssey Mode.
 */
export class LevelSelectUI {
    /**
     * Create level select UI.
     * @param {Object} options - Configuration options.
     */
    constructor(options = {}) {
        this.onLevelSelect = options.onLevelSelect || (() => {});
        this.onClose = options.onClose || (() => {});

        this.isVisible = false;
        this.selectedChapter = 1;
        this.selectedLevelIndex = 0;
        this.unlockedLevels = new Set([1]);
        this.completedLevels = new Map();

        this.container = null;
        this.chapterTabs = null;
        this.levelGrid = null;
        this.chapterProgress = null;

        this._initialize();
    }

    _initialize() {
        this.container = document.createElement('div');
        this.container.id = 'odyssey-level-select';
        this.container.className = 'odyssey-level-select';

        this._createHeader();
        this._createChapterTabs();
        this._createMainContent();
        this._createFooter();

        document.body.appendChild(this.container);
        this._setupKeyboardNavigation();

        console.log('[LevelSelectUI] Initialized');
    }

    _createHeader() {
        const header = document.createElement('div');
        header.className = 'level-select-header';

        const title = document.createElement('h1');
        title.className = 'level-select-title';
        title.textContent = 'ODYSSEY MODE';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'level-select-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('aria-label', 'Close Odyssey level select');
        closeBtn.addEventListener('click', () => this.hide());
        header.appendChild(closeBtn);

        this.container.appendChild(header);
    }

    _createChapterTabs() {
        const tabContainer = document.createElement('div');
        tabContainer.className = 'chapter-tabs-container';

        this.chapterTabs = document.createElement('div');
        this.chapterTabs.className = 'chapter-tabs';
        this.chapterTabs.setAttribute('role', 'tablist');

        CHAPTER_CONFIGS.forEach((chapter) => {
            const tab = document.createElement('button');
            tab.className = 'chapter-tab';
            tab.dataset.chapter = chapter.id;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-label', `Chapter ${chapter.id}: ${chapter.name}`);
            tab.innerHTML = `
                <span class="tab-number">${chapter.id}</span>
                <span class="tab-name">${chapter.name.split('&')[0].trim()}</span>
            `;
            tab.addEventListener('click', () => this.selectChapter(chapter.id));
            this.chapterTabs.appendChild(tab);
        });

        tabContainer.appendChild(this.chapterTabs);
        this.container.appendChild(tabContainer);
    }

    _createMainContent() {
        const mainContent = document.createElement('div');
        mainContent.className = 'level-select-main';

        this._createChapterInfo(mainContent);
        this._createLevelGrid(mainContent);

        this.container.appendChild(mainContent);
    }

    _createChapterInfo(parent) {
        this.chapterInfo = document.createElement('div');
        this.chapterInfo.className = 'chapter-info';

        this.chapterTitle = document.createElement('div');
        this.chapterTitle.className = 'chapter-title';
        this.chapterInfo.appendChild(this.chapterTitle);

        this.chapterSubtitle = document.createElement('div');
        this.chapterSubtitle.className = 'chapter-subtitle';
        this.chapterInfo.appendChild(this.chapterSubtitle);

        this.chapterProgress = document.createElement('div');
        this.chapterProgress.className = 'chapter-progress';
        this.chapterInfo.appendChild(this.chapterProgress);

        this.chapterNarrative = document.createElement('div');
        this.chapterNarrative.className = 'chapter-narrative';
        this.chapterInfo.appendChild(this.chapterNarrative);

        parent.appendChild(this.chapterInfo);
    }

    _createLevelGrid(parent) {
        const gridContainer = document.createElement('div');
        gridContainer.className = 'level-grid-container';

        this.levelGrid = document.createElement('div');
        this.levelGrid.className = 'level-grid';

        gridContainer.appendChild(this.levelGrid);
        parent.appendChild(gridContainer);
    }

    _createFooter() {
        const footer = document.createElement('div');
        footer.className = 'level-select-footer';

        this.totalProgress = document.createElement('div');
        this.totalProgress.className = 'total-progress';
        footer.appendChild(this.totalProgress);

        const controlsHint = document.createElement('div');
        controlsHint.className = 'controls-hint';
        controlsHint.innerHTML = `
            <span class="hint-key">Navigate:</span> Arrow Keys &nbsp;|&nbsp;
            <span class="hint-key">Select:</span> Enter &nbsp;|&nbsp;
            <span class="hint-key">Back:</span> Escape
        `;
        footer.appendChild(controlsHint);

        this.container.appendChild(footer);
    }

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

    _navigateLevel(direction) {
        const levels = getLevelsByChapter(this.selectedChapter);
        const newIndex = this.selectedLevelIndex + direction;

        if (newIndex >= 0 && newIndex < levels.length) {
            this.selectedLevelIndex = newIndex;
            this._highlightSelectedLevel();
        }
    }

    _navigateChapter(direction) {
        const newChapter = this.selectedChapter + direction;
        if (newChapter >= 1 && newChapter <= CHAPTER_CONFIGS.length) {
            this.selectChapter(newChapter);
        }
    }

    _selectCurrentLevel() {
        const levels = getLevelsByChapter(this.selectedChapter);
        const level = levels[this.selectedLevelIndex];

        if (level && this.unlockedLevels.has(level.id)) {
            this.onLevelSelect(level.id);
            this.hide();
        }
    }

    _highlightSelectedLevel() {
        const prevSelected = this.levelGrid.querySelector('.level-card.selected');
        if (prevSelected) {
            prevSelected.classList.remove('selected');
        }

        const levelCards = this.levelGrid.querySelectorAll('.level-card');
        const card = levelCards[this.selectedLevelIndex];
        if (!card) return;

        card.classList.add('selected');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /**
     * Select a chapter and update display.
     * @param {number} chapterId - Chapter ID to select.
     */
    selectChapter(chapterId) {
        this.selectedChapter = chapterId;
        this.selectedLevelIndex = 0;

        const tabs = this.chapterTabs.querySelectorAll('.chapter-tab');
        tabs.forEach((tab) => {
            const isActive = parseInt(tab.dataset.chapter, 10) === chapterId;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        this._updateChapterInfo();
        this._updateLevelGrid();
    }

    _updateChapterInfo() {
        const chapter = CHAPTER_CONFIGS.find((c) => c.id === this.selectedChapter);
        if (!chapter) return;

        this.chapterTitle.textContent = `Chapter ${chapter.id}: ${chapter.name}`;
        this.chapterSubtitle.textContent = chapter.subtitle;

        const levels = getLevelsByChapter(this.selectedChapter);
        const completedCount = levels.filter((l) => this.completedLevels.has(l.id)).length;
        const totalStars = levels.reduce((sum, l) => {
            const completion = this.completedLevels.get(l.id);
            return sum + (completion?.stars || 0);
        }, 0);
        const maxStars = levels.length * 3;
        const progress = levels.length > 0 ? (completedCount / levels.length) * 100 : 0;

        this.chapterProgress.innerHTML = `
            <div class="ody-progress-row">
                <span class="ody-progress-label">Progress</span>
                <span class="ody-progress-value">${completedCount}/${levels.length}</span>
            </div>
            <div class="ody-progress-track">
                <div class="ody-progress-fill" style="--progress: ${progress}%;"></div>
            </div>
            <div class="ody-progress-row">
                <span class="ody-progress-label">Stars</span>
                <span class="ody-progress-value">${totalStars}/${maxStars} &#9733;</span>
            </div>
        `;

        this.chapterNarrative.textContent = chapter.narrative?.intro || '';
    }

    _updateLevelGrid() {
        this.levelGrid.innerHTML = '';

        const levels = getLevelsByChapter(this.selectedChapter);
        levels.forEach((level, index) => {
            const card = this._createLevelCard(level, index);
            this.levelGrid.appendChild(card);
        });

        this._highlightSelectedLevel();
    }

    _createLevelCard(level, index) {
        const isUnlocked = this.unlockedLevels.has(level.id);
        const completion = this.completedLevels.get(level.id);
        const isCompleted = !!completion;
        const stars = completion?.stars || 0;

        const card = document.createElement('div');
        card.className = [
            'level-card',
            isUnlocked ? 'is-unlocked' : 'is-locked',
            isCompleted ? 'is-completed' : '',
        ].filter(Boolean).join(' ');
        card.dataset.levelId = level.id;
        card.tabIndex = isUnlocked ? 0 : -1;
        card.setAttribute('aria-label', isUnlocked ? `Level ${level.id}: ${level.name}` : `Level ${level.id}: locked`);

        const levelNum = document.createElement('div');
        levelNum.className = 'level-num';
        levelNum.textContent = level.id;
        card.appendChild(levelNum);

        if (!isUnlocked) {
            const lockIcon = document.createElement('div');
            lockIcon.className = 'lock-icon';
            lockIcon.innerHTML = `
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="2"/>
                    <path d="M8 11V7a4 4 0 118 0v4" stroke="currentColor" stroke-width="2"/>
                </svg>
            `;
            card.appendChild(lockIcon);
        } else {
            const starsContainer = document.createElement('div');
            starsContainer.className = 'level-stars';

            for (let i = 1; i <= 3; i++) {
                const star = document.createElement('span');
                star.className = `level-star${i <= stars ? ' earned' : ''}`;
                star.innerHTML = i <= stars ? '&#9733;' : '&#9734;';
                starsContainer.appendChild(star);
            }
            card.appendChild(starsContainer);
        }

        const name = document.createElement('div');
        name.className = 'level-name';
        name.textContent = isUnlocked ? level.name : '???';
        card.appendChild(name);

        if (isUnlocked) {
            const difficulty = document.createElement('div');
            difficulty.className = 'level-difficulty';
            const difficultyValue = Math.max(0, Math.min(10, level.metadata?.difficulty || 0));
            difficulty.innerHTML = Array.from({ length: 10 }, (_, dotIndex) => (
                `<span class="difficulty-dot${dotIndex < difficultyValue ? ' is-active' : ''}"></span>`
            )).join('');
            card.appendChild(difficulty);

            card.addEventListener('click', () => this._chooseLevel(level.id, index));
            card.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                this._chooseLevel(level.id, index);
            });
        }

        return card;
    }

    _chooseLevel(levelId, index) {
        this.selectedLevelIndex = index;
        this._highlightSelectedLevel();
        this.onLevelSelect(levelId);
        this.hide();
    }

    _updateTotalProgress() {
        const totalLevels = LEVEL_CONFIGS.length;
        const completedCount = this.completedLevels.size;
        const totalStars = Array.from(this.completedLevels.values()).reduce((sum, c) => sum + (c.stars || 0), 0);
        const maxStars = totalLevels * 3;

        this.totalProgress.innerHTML = `
            <div><span class="total-progress-label">Total Progress:</span> <span class="total-progress-value">${completedCount}/${totalLevels}</span> levels</div>
            <div><span class="total-progress-label">Stars:</span> <span class="total-progress-value">${totalStars}/${maxStars} &#9733;</span></div>
        `;
    }

    /**
     * Set unlocked levels.
     * @param {Set<number>} unlockedLevels - Set of unlocked level IDs.
     */
    setUnlockedLevels(unlockedLevels) {
        this.unlockedLevels = unlockedLevels;
        if (this.isVisible) {
            this._updateLevelGrid();
        }
    }

    /**
     * Set completed levels.
     * @param {Map<number, Object>} completedLevels - Map of level ID to completion data.
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
     * Show the level select UI.
     * @param {number} [chapterId] - Optional chapter to select.
     */
    show(chapterId) {
        this.container.classList.add('is-visible');
        this.isVisible = true;

        if (chapterId) {
            this.selectChapter(chapterId);
        } else {
            this.selectChapter(this.selectedChapter);
        }

        this._updateTotalProgress();
        console.log('[LevelSelectUI] Shown');
    }

    hide() {
        this.container.classList.remove('is-visible');
        this.isVisible = false;
        this.onClose();
        console.log('[LevelSelectUI] Hidden');
    }

    getIsVisible() {
        return this.isVisible;
    }

    destroy() {
        document.removeEventListener('keydown', this._keyHandler);

        if (this.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }

        console.log('[LevelSelectUI] Destroyed');
    }
}
