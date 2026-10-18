/**
 * @fileoverview The Odyssey drawn as cells (keystone.css `.sb-meter`): one per level, a gap
 * between chapters, filled once cleared, the keystone on the next level. The main menu's
 * stage and the Records sheet draw the same journey.
 */

/**
 * @param {{ levels: number[] }[]} chapters in journey order
 * @param {{ completedIds?: Set<number>, next?: number|null }} [progress]
 * @returns {string} markup
 */
export function odysseyMeterHtml(chapters, { completedIds = new Set(), next = null } = {}) {
    const cells = [];
    let total = 0;
    chapters.forEach((chapter, chapterIndex) => {
        chapter.levels.forEach((id, index) => {
            total += 1;
            const classes = [];
            if (completedIds.has(id)) classes.push('is-filled');
            if (id === next) classes.push('is-current');
            if (index === chapter.levels.length - 1 && chapterIndex < chapters.length - 1) classes.push('is-break');
            cells.push(`<i${classes.length ? ` class="${classes.join(' ')}"` : ''}></i>`);
        });
    });
    const done = chapters.reduce((sum, chapter) => sum + chapter.levels.filter((id) => completedIds.has(id)).length, 0);
    return `<div class="sb-meter" role="img" aria-label="${done} of ${total} orbs cleared">${cells.join('')}</div>`;
}
