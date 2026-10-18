/**
 * The navigator's list view: header progress, then every chapter with its orbs as tiles.
 * Extracted from OdysseyMode._updateLevelSelectUI; the mode supplies state, registry and the
 * two actions a tile can take (travel to a chapter, launch an orb).
 */

/**
 * @param {object} mode the active OdysseyMode (odysseyState, levelRegistry, navigateToChapter,
 *   _launchLevelFromNavigator)
 * @param {number|null} [focusChapter] the chapter to mark as current
 */
export function renderOdysseyNavigatorList(mode, focusChapter = null) {
    const { odysseyState, levelRegistry } = mode;
    const progress = odysseyState.getProgressSummary();

    const setText = (id, text) => {
        const node = document.getElementById(id);
        if (node) node.textContent = text;
    };
    setText('odyssey-total-stars', progress.totalStars);
    setText('odyssey-max-stars', progress.maxStars);
    setText('odyssey-progress-pct', progress.overallProgress);
    const progressFill = document.getElementById('odyssey-progress-fill');
    if (progressFill) progressFill.style.width = `${progress.overallProgress}%`;

    const chaptersContainer = document.getElementById('odyssey-chapters');
    if (!chaptersContainer) return;
    chaptersContainer.innerHTML = '';

    for (const chapter of levelRegistry.getAllChapters()) {
        const chapterProgress = odysseyState.getChapterProgress(chapter.id);
        const chapterEl = document.createElement('div');
        chapterEl.className = 'odyssey-chapter';
        if (focusChapter === chapter.id) chapterEl.classList.add('current');
        if (chapterProgress.maxStars > 0 && chapterProgress.stars === chapterProgress.maxStars) {
            chapterEl.classList.add('complete');
        }
        chapterEl.innerHTML = `
            <div class="odyssey-chapter-header">
                <span class="odyssey-chapter-name"><small>Chapter ${chapter.id}</small>${chapter.name}</span>
                <span class="odyssey-chapter-stars">${chapterProgress.stars}/${chapterProgress.maxStars} ★</span>
            </div>
            <div class="odyssey-levels" id="odyssey-chapter-${chapter.id}-levels"></div>
        `;
        chaptersContainer.appendChild(chapterEl);

        const header = chapterEl.querySelector('.odyssey-chapter-header');
        if (header) {
            header.style.cursor = 'pointer';
            header.addEventListener('click', () => {
                mode.navigateToChapter(chapter.id).catch((error) => {
                    console.warn(`[Odyssey] Chapter navigation failed for ${chapter.id}:`, error);
                });
            });
        }

        const levelsContainer = document.getElementById(`odyssey-chapter-${chapter.id}-levels`);
        if (!levelsContainer) continue;
        for (const level of levelRegistry.getLevelsInChapter(chapter.id)) {
            const isUnlocked = odysseyState.isLevelUnlocked(level.id);
            const isCompleted = odysseyState.isLevelCompleted(level.id);
            const stars = odysseyState.getLevelStars(level.id);
            const isCurrent = level.id === progress.currentLevel;

            const btn = document.createElement('button');
            btn.className = 'odyssey-level-btn';
            if (!isUnlocked) btn.classList.add('locked');
            if (isCompleted) btn.classList.add('completed');
            if (isCurrent && isUnlocked && !isCompleted) btn.classList.add('current');
            btn.innerHTML = `
                <span>${level.id}</span>
                <span class="odyssey-level-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
            `;
            btn.title = `${level.name}\n${level.metadata.description}`;
            if (isUnlocked) {
                btn.addEventListener('click', () => {
                    mode._launchLevelFromNavigator(level.id).catch((error) => {
                        console.warn(`[Odyssey] Navigator launch failed for ${level.id}:`, error);
                    });
                });
            }
            levelsContainer.appendChild(btn);
        }
    }
}
