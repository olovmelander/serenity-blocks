/**
 * The navigator as plain data: the journey's totals, every chapter with its orbs and their
 * states, and which orb a look at a chapter lands on. No DOM; odyssey-navigator-list.js draws it.
 *
 * Orb states: `cleared` (completed), `next` (the orb the journey waits on), `open` (unlocked,
 * not cleared, not the next one) and `locked`. Chapter states: `complete` (every orb cleared),
 * `current` (holds the next orb), `open` (some orb unlocked) and `locked`.
 */
import { describeOdysseyOrbKind } from './odyssey-level-panel.js';

/** The chapter's short name, the part before " & ": "Deep Ocean & Liquid Worlds" → "Deep Ocean". */
export function shortOdysseyChapterName(name = '') {
    const text = String(name || '').trim();
    return text.split(/\s+&\s+/)[0] || text;
}

function orbState({ unlocked, completed, isNext }) {
    if (completed) return 'cleared';
    if (!unlocked) return 'locked';
    return isNext ? 'next' : 'open';
}

function chapterState(orbs) {
    if (orbs.length > 0 && orbs.every((orb) => orb.state === 'cleared')) return 'complete';
    if (orbs.some((orb) => orb.state === 'next')) return 'current';
    if (orbs.some((orb) => orb.state !== 'locked')) return 'open';
    return 'locked';
}

function describeOrb(level, chapterId, { odysseyState, levelRegistry, nextLevelId }) {
    const presented = levelRegistry.resolveLevelPresentation?.(level.id) || level;
    const unlocked = Boolean(odysseyState.isLevelUnlocked(level.id));
    const completed = Boolean(odysseyState.isLevelCompleted(level.id));
    const stars = Math.max(0, Math.min(3, Number(odysseyState.getLevelStars(level.id)) || 0));
    return {
        id: level.id,
        chapterId,
        name: presented.pathLabel || presented.name || `Orb ${level.id}`,
        description: presented.description || presented.metadata?.description || '',
        themeId: presented.iconThemeId || presented.theme?.pathIcon || presented.theme?.primary || null,
        kind: describeOdysseyOrbKind(presented),
        level: presented,
        stars,
        completion: odysseyState.getLevelCompletion?.(level.id) || null,
        unlocked,
        state: orbState({ unlocked, completed, isNext: level.id === nextLevelId }),
    };
}

/**
 * @param {{ odysseyState: object, levelRegistry: object }} mode the active OdysseyMode
 * @returns {{ progress: object, nextLevelId: number, chapters: object[], orbs: Map<number, object> }}
 */
export function buildOdysseyNavigatorModel({ odysseyState, levelRegistry }) {
    const progress = odysseyState.getProgressSummary();
    const nextLevelId = Number(progress.currentLevel) || 1;
    const orbs = new Map();
    const chapters = levelRegistry.getAllChapters().map((chapter) => {
        const chapterOrbs = levelRegistry.getLevelsInChapter(chapter.id)
            .map((level) => describeOrb(level, chapter.id, { odysseyState, levelRegistry, nextLevelId }));
        chapterOrbs.forEach((orb) => orbs.set(orb.id, orb));
        const stars = chapterOrbs.reduce((sum, orb) => sum + orb.stars, 0);
        return {
            id: chapter.id,
            name: chapter.name || `Chapter ${chapter.id}`,
            shortName: shortOdysseyChapterName(chapter.name || `Chapter ${chapter.id}`),
            subtitle: chapter.subtitle || '',
            intro: chapter.narrative?.intro || '',
            orbs: chapterOrbs,
            stars,
            maxStars: chapterOrbs.length * 3,
            cleared: chapterOrbs.filter((orb) => orb.state === 'cleared').length,
            state: chapterState(chapterOrbs),
        };
    });
    const clearedOrbs = chapters.reduce((sum, chapter) => sum + chapter.cleared, 0);
    return {
        progress: { ...progress, clearedOrbs, totalOrbs: orbs.size },
        nextLevelId,
        chapters,
        orbs,
    };
}

/**
 * The orb a look at a chapter lands on: the next orb, else the first open one, else the first
 * cleared orb still short of three stars, else the first orb.
 */
export function preferredOdysseyChapterOrb(chapter) {
    const orbs = chapter?.orbs || [];
    return orbs.find((orb) => orb.state === 'next')
        || orbs.find((orb) => orb.state === 'open')
        || orbs.find((orb) => orb.state === 'cleared' && orb.stars < 3)
        || orbs[0]
        || null;
}

/**
 * Where the navigator opens: an asked-for chapter's preferred orb, else the orb the board has
 * selected, else the next orb, else the first orb of the journey.
 * @returns {{ chapter: object|null, orb: object|null }}
 */
export function resolveOdysseyNavigatorSelection(model, { chapterId = null, levelId = null } = {}) {
    const byChapter = (id) => model.chapters.find((chapter) => chapter.id === id) || null;
    const asked = Number.isFinite(chapterId) ? byChapter(chapterId) : null;
    if (asked) return { chapter: asked, orb: preferredOdysseyChapterOrb(asked) };
    const orb = model.orbs.get(levelId) || model.orbs.get(model.nextLevelId) || model.chapters[0]?.orbs[0] || null;
    return { chapter: orb ? byChapter(orb.chapterId) : (model.chapters[0] || null), orb };
}

/** The orb one step along the whole journey (crossing chapters), or null at either end. */
export function stepOdysseyNavigatorOrb(model, orbId, step) {
    const ids = [...model.orbs.keys()].sort((left, right) => left - right);
    const index = ids.indexOf(orbId);
    if (index < 0) return null;
    return model.orbs.get(ids[index + step]) || null;
}

/**
 * What pressing an orb does: it sets out when the card already showed it, and otherwise shows
 * it. A pointer press counts the orb the card showed before the press (its focus comes first);
 * a key or controller press lands on an orb whose focus already showed it.
 * @returns {'launch'|'select'}
 */
export function resolveOdysseyOrbPress({
    orbId, shownOrbId, shownBeforePress = null, viaPointer = false,
}) {
    return (viaPointer ? shownBeforePress : shownOrbId) === orbId ? 'launch' : 'select';
}

/**
 * Where a key takes the navigator, as the map's keys do: left and right walk the orbs across
 * chapters, up and down (and Page Up/Down) climb the chapters, Home goes to the first orb (or
 * chapter), End to the orb the journey waits on (or the last chapter). From anywhere else in
 * the navigator an arrow first brings focus back to the selected orb.
 * @param {object} model the navigator model
 * @param {string} key KeyboardEvent.key
 * @param {'orb'|'tab'|'other'} on what holds focus: an orb, a chapter tab or another control
 * @returns {{ orbStep?: number, chapterStep?: number, orbId?: number, chapterId?: number,
 *   focus?: 'orb'|'tab'|'auto' }|null}
 */
export function resolveOdysseyNavigatorKey(model, key, on = 'other') {
    const chapters = model?.chapters || [];
    switch (key) {
    case 'PageUp':
    case 'PageDown':
        return { chapterStep: key === 'PageUp' ? 1 : -1, focus: on === 'tab' ? 'tab' : 'auto' };
    case 'ArrowLeft':
    case 'ArrowRight': {
        const step = key === 'ArrowRight' ? 1 : -1;
        if (on === 'orb') return { orbStep: step };
        if (on === 'tab') return step > 0 ? { focus: 'orb' } : null;
        return { focus: 'orb' };
    }
    case 'ArrowUp':
    case 'ArrowDown':
        if (on === 'other') return { focus: 'orb' };
        return { chapterStep: key === 'ArrowUp' ? 1 : -1, focus: on };
    case 'Home':
        if (on === 'tab') return { chapterId: chapters[0]?.id, focus: 'tab' };
        return { orbId: chapters[0]?.orbs[0]?.id, focus: 'orb' };
    case 'End':
        if (on === 'tab') return { chapterId: chapters[chapters.length - 1]?.id, focus: 'tab' };
        return { orbId: model.nextLevelId, focus: 'orb' };
    default:
        return null;
    }
}
