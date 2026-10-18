import { CHAPTER_CONFIGS } from './chapters.js';

/** Authored v3 IDs remain balance identities; only the public campaign order changes. */
export function remapAuthoredOdysseyLevelId(levelId) {
    if (levelId === 10) return null;
    if (levelId >= 11 && levelId <= 43) return levelId - 1;
    if (levelId >= 55) return levelId + 1;
    return levelId;
}

export function remapAuthoredOdysseyPositions(positions) {
    const mapped = Object.fromEntries(Object.entries(positions)
        .filter(([id]) => Number(id) !== 10)
        .map(([id, position]) => [remapAuthoredOdysseyLevelId(Number(id)), position]));
    mapped[43] = (positions[43] + positions[44]) / 2;
    mapped[55] = (positions[54] + positions[55]) / 2;
    return mapped;
}

function createVesperLevel(template, pathPosition) {
    return {
        ...template,
        id: 43,
        name: 'Celestial Chrysalis',
        chapter: 6,
        pathPosition,
        theme: {
            primary: 'vesper-chrysalis', overlays: [], transitionIn: 'crossfade', transitionDuration: 4000,
        },
        metadata: {
            ...template.metadata,
            description: 'An alien lake reflects impossible worlds and a waking crystal heart. '
                + 'Build your score in a quiet pocket before the next cosmic trial.',
            tip: 'There is no countdown. Let the stack settle and choose clean scoring routes.',
        },
    };
}

function createWarpLevel(template, pathPosition) {
    return {
        ...template,
        id: 55,
        name: 'Serenity Passage',
        chapter: 7,
        pathPosition,
        theme: {
            primary: 'serenity-warp', overlays: [], transitionIn: 'warp', transitionDuration: 4000,
        },
        role: 'teach',
        mechanicFocus: 'cascade',
        emotionalBeat: 'wonder',
        victoryLapPolicy: 'none',
        mechanics: {
            baseMode: 'infinity',
            board: { columns: 10, rows: 36, startingRows: 10 },
            speed: { startLevel: 8, levelProgression: false, fixedDropInterval: 600 },
            pieces: {
                bagType: '7-bag', customSequence: null, previewCount: 5,
            },
        },
        victory: {
            primary: { type: 'cascade', target: 10 },
            failure: { type: 'top-out', value: null },
            bonuses: [],
        },
        modifiers: { active: ['gravity-cascade'] },
        stars: {
            one: { cascades: 10 },
            two: { cascades: 10, maxCascadeDepth: 3 },
            three: { cascades: 10, maxCascadeDepth: 4 },
        },
        metadata: {
            description: 'A tunnel of light carries you toward the final abstraction. '
                + 'Trigger 10 cascades on a taller board before the summit challenge.',
            difficulty: 6,
            // Authored rehearsal profile: gentler fixed speed and no deadline before the capstone.
            difficultyModel: { scalar: 0.60, band: 'tough', profile: 'tall-board-rehearsal' },
            tip: 'Use the starting shelves to rehearse layered cascades. '
                + 'There is no timer; leave room for the next piece.',
        },
    };
}

/**
 * Every chapter ends on its rival. The duel takes the chapter's last slot and the orbs that
 * followed it each step one slot earlier. Slots keep their public ids and path positions, so
 * the world geometry, layout data and chapter boundaries are untouched; only which challenge
 * sits in which slot changes. Saves re-key through odyssey-progress-schema's V4_TO_V5 table.
 */
export function rotateDuelsToChapterEnd(levels) {
    const byChapter = new Map();
    [...levels].sort((left, right) => left.id - right.id).forEach((level) => {
        if (!byChapter.has(level.chapter)) byChapter.set(level.chapter, []);
        byChapter.get(level.chapter).push(level);
    });
    const rotated = [];
    byChapter.forEach((chapterLevels) => {
        const slots = chapterLevels.map((level) => ({ id: level.id, pathPosition: level.pathPosition }));
        const duelIndex = chapterLevels.findIndex((level) => level.mechanics?.versus);
        const order = duelIndex === -1
            ? chapterLevels
            : [...chapterLevels.filter((_, index) => index !== duelIndex), chapterLevels[duelIndex]];
        // The opening garbage pattern is seeded from boardSeedId, so a challenge keeps the same
        // opening board in its new slot (the balance benchmark was measured on those boards).
        order.forEach((level, index) => rotated.push({ ...level, boardSeedId: level.id, ...slots[index] }));
    });
    return rotated.sort((left, right) => left.id - right.id);
}

/** Public id of the challenge that occupied a v4 slot, after the chapter-end rotation. */
export function mapV4SlotToRotatedId(levels, v4Id) {
    const level = levels.find((entry) => entry.v4Id === v4Id);
    return level ? level.id : null;
}

/** Compose after all old tuning so inserting a collectible never retunes an existing challenge. */
export function assembleOdysseyCampaign(authoredLevels) {
    const authored = new Map(authoredLevels.map((level) => [level.id, level]));
    const positions = remapAuthoredOdysseyPositions(Object.fromEntries(
        authoredLevels.map((level) => [level.id, level.pathPosition]),
    ));
    const levels = authoredLevels.filter((level) => level.id !== 10).map((level) => ({
        ...level,
        id: remapAuthoredOdysseyLevelId(level.id),
    }));
    levels.push(createVesperLevel(structuredClone(authored.get(45)), positions[43]));
    levels.push(createWarpLevel(structuredClone(authored.get(54)), positions[55]));
    const v4Levels = levels.sort((left, right) => left.id - right.id)
        .map((level) => ({ ...level, v4Id: level.id }));
    return rotateDuelsToChapterEnd(v4Levels).map((level) => {
        const chapter = CHAPTER_CONFIGS.find((entry) => entry.id === level.chapter);
        return {
            ...level,
            chapterLevel: level.id - chapter.levelRange[0] + 1,
            isChapterStart: level.id === chapter.levelRange[0],
            isChapterEnd: level.id === chapter.levelRange[1],
        };
    });
}
