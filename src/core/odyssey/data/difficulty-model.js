/**
 * @fileoverview Pure Odyssey difficulty and balance derivation.
 *
 * The authored level list still carries names, themes, story beats, and hand
 * exceptions. This module turns the pacing tags into a stable baseline so the
 * campaign has one coherent curve before level-specific overrides are applied.
 */

import { CHAPTER_CONFIGS } from './chapters.js';

const MAIN_ARC_LAST_LEVEL = 51;
const D_MIN = 0.06;
const D_MAX = 0.94;
const LOGISTIC_MIDPOINT = 34;
const LOGISTIC_STEEPNESS = 0.105;

const ROLE_OFFSETS = Object.freeze({
    arrival: -0.10,
    teach: -0.06,
    reinforce: 0,
    test: 0.10,
    boss: 0.18,
    release: -0.22,
    encore: 0,
});

const EMOTIONAL_OFFSETS = Object.freeze({
    wonder: -0.04,
    flow: 0,
    tension: 0.05,
    awe: 0.03,
    release: -0.08,
    panic: 0.09,
    transcendence: 0.06,
});

const REGIMES_BY_FOCUS = Object.freeze({
    lines: { baseMode: 'standard', progressing: true, victoryType: 'lines' },
    sprint: { baseMode: 'standard', progressing: true, victoryType: 'lines' },
    dig: { baseMode: 'standard', progressing: true, victoryType: 'lines' },
    score: { baseMode: 'standard', progressing: true, victoryType: 'score' },
    cascade: { baseMode: 'infinity', progressing: false, victoryType: 'cascade' },
    hybrid: { baseMode: 'hybrid', progressing: true, victoryType: 'score' },
});

const METRIC_BY_VICTORY_TYPE = Object.freeze({
    cascade: 'cascades',
    combo: 'combo',
    height: 'height',
    lines: 'lines',
    score: 'score',
    tetrises: 'tetrises',
    time: 'time',
});

const DERIVABLE_VICTORY_TYPES = new Set(['cascade', 'combo', 'height', 'lines', 'score', 'tetrises', 'time']);

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(start, end, amount) {
    return start + (end - start) * amount;
}

function roundTo(value, step) {
    return Math.round(value / step) * step;
}

function roundToInt(value) {
    return Math.max(1, Math.round(value));
}

function findChapterForLevel(levelId) {
    return CHAPTER_CONFIGS.find((chapter) => (
        levelId >= chapter.levelRange[0]
        && levelId <= chapter.levelRange[1]
    )) || null;
}

function getChapterPosition(levelId) {
    const chapter = findChapterForLevel(levelId);
    if (!chapter) {
        return 0;
    }

    const [start, end] = chapter.levelRange;
    if (start === end) {
        return 1;
    }

    return clamp((levelId - start) / (end - start), 0, 1);
}

function getEncoreDifficulty(levelId) {
    const chapter = findChapterForLevel(levelId);
    if (!chapter) {
        return D_MIN;
    }

    const encoreIndex = levelId - chapter.levelRange[0] + 1;
    return 0.40 + 0.45 / (1 + Math.exp(-1.4 * (encoreIndex - 2.5)));
}

function getMacroDifficulty(levelId) {
    return D_MIN + (D_MAX - D_MIN)
        / (1 + Math.exp(-LOGISTIC_STEEPNESS * (levelId - LOGISTIC_MIDPOINT)));
}

export function computeOdysseyDifficulty(levelId, tags = {}) {
    if (levelId > MAIN_ARC_LAST_LEVEL) {
        return clamp(getEncoreDifficulty(levelId), 0, 1);
    }

    const role = tags.role || 'reinforce';
    const emotionalBeat = tags.emotionalBeat || 'flow';
    const chapterPosition = getChapterPosition(levelId);
    const chapterRamp = (chapterPosition - 0.5) * 0.25;
    const roleOffset = ROLE_OFFSETS[role] ?? 0;
    const beatOffset = EMOTIONAL_OFFSETS[emotionalBeat] ?? 0;
    const amplitude = 0.5 + 0.5 * (levelId / MAIN_ARC_LAST_LEVEL);
    const microDifficulty = amplitude * (chapterRamp + roleOffset + beatOffset);

    return clamp(getMacroDifficulty(levelId) + microDifficulty, D_MIN, 1);
}

export function getOdysseyDifficultyBand(difficulty) {
    if (difficulty < 0.25) return 'gentle';
    if (difficulty < 0.50) return 'standard';
    if (difficulty < 0.75) return 'tough';
    return 'brutal';
}

function getRegime(mechanicFocus) {
    return REGIMES_BY_FOCUS[mechanicFocus] || REGIMES_BY_FOCUS.lines;
}

function getSpeedTier(difficulty, tags = {}) {
    const focus = tags.mechanicFocus || 'lines';
    const role = tags.role || 'reinforce';
    const emotionalBeat = tags.emotionalBeat || 'flow';

    let tier = Math.round(lerp(1, 13, difficulty ** 1.35));
    if (focus === 'sprint') tier += 1;
    if (focus === 'dig') tier -= 1;
    if (role === 'release') tier -= 1;
    if (role === 'boss' && emotionalBeat === 'panic') tier += 1;
    if (emotionalBeat === 'transcendence') tier += 1;

    return clamp(tier, 1, 13);
}

function getFixedCascadeDropInterval(difficulty) {
    const normalized = clamp((difficulty - D_MIN) / (D_MAX - D_MIN), 0, 1);
    return roundTo(lerp(820, 460, normalized), 10);
}

function getBoardConfig(regime, difficulty, tags = {}) {
    const focus = tags.mechanicFocus || 'lines';
    if (regime.baseMode === 'standard') {
        return {
            columns: 10,
            rows: 20,
            startingRows: focus === 'dig' ? Math.round(lerp(3, 9, difficulty)) : 0,
        };
    }

    const isBossOrTest = tags.role === 'boss' || tags.role === 'test';
    const maxStartingRows = regime.baseMode === 'hybrid' ? 8 : 10;
    const startingRows = isBossOrTest
        ? Math.round(lerp(0, maxStartingRows, difficulty))
        : Math.round(lerp(0, Math.min(6, maxStartingRows), difficulty));

    return {
        columns: 10,
        rows: Math.round(lerp(24, 32, difficulty)),
        startingRows,
    };
}

function getPreviewCount(difficulty, tags = {}) {
    const role = tags.role || 'reinforce';
    const emotionalBeat = tags.emotionalBeat || 'flow';
    let previewCount = Math.round(lerp(6, 4, difficulty));
    if ((role === 'test' || role === 'boss') && (emotionalBeat === 'tension' || emotionalBeat === 'panic')) {
        previewCount -= 1;
    }
    if (role === 'release' || emotionalBeat === 'release') {
        previewCount += 1;
    }
    return clamp(previewCount, 3, 6);
}

function getVictoryTarget(victoryType, difficulty) {
    switch (victoryType) {
    case 'cascade':
        return roundToInt(lerp(3, 25, difficulty));
    case 'score':
        return roundTo(lerp(12000, 90000, difficulty ** 1.4), 1000);
    case 'combo':
        return roundToInt(lerp(3, 15, difficulty));
    case 'tetrises':
        return roundToInt(lerp(2, 12, difficulty));
    case 'height':
        return roundToInt(lerp(8, 24, difficulty));
    case 'time':
        // "Survive/last N seconds" — more time is harder.
        return roundTo(lerp(60, 240, difficulty), 10);
    case 'lines':
    default:
        return roundToInt(lerp(20, 70, difficulty ** 2));
    }
}

function getFailureConfig(difficulty, tags = {}) {
    const role = tags.role || 'reinforce';
    const focus = tags.mechanicFocus || 'lines';
    const emotionalBeat = tags.emotionalBeat || 'flow';
    const hasClock = (role === 'test' && focus === 'sprint')
        || (role === 'boss' && emotionalBeat === 'panic')
        || (focus === 'hybrid' && difficulty >= 0.55);

    if (!hasClock) {
        return { type: 'top-out', value: null };
    }

    return {
        type: 'time',
        value: roundTo(lerp(300, 150, difficulty), 30),
    };
}

function getModifiers(regime, difficulty, tags = {}, failure = {}) {
    const modifiers = [];
    const focus = tags.mechanicFocus || 'lines';
    const role = tags.role || 'reinforce';

    if (regime.baseMode === 'infinity' || regime.baseMode === 'hybrid') {
        modifiers.push('gravity-cascade');
    }
    if (focus === 'score' || focus === 'hybrid' || (focus === 'cascade' && (difficulty >= 0.30 || role === 'boss'))) {
        modifiers.push('combo-multiplier');
    }
    if (failure.type === 'time') {
        modifiers.push('time-attack');
    }

    return modifiers;
}

function getStars(victoryType, target, failure) {
    const metric = METRIC_BY_VICTORY_TYPE[victoryType] || victoryType;

    if (failure.type === 'time') {
        return {
            one: { [metric]: target },
            two: { [metric]: target, time: Math.max(1, Math.round(failure.value * 0.80)) },
            three: { [metric]: target, time: Math.max(1, Math.round(failure.value * 0.62)) },
        };
    }

    if (victoryType === 'cascade') {
        return {
            one: { cascades: target },
            two: { cascades: target, maxCascadeDepth: 3 },
            three: {
                cascades: Math.max(target + 1, Math.round(target * 1.20)),
                maxCascadeDepth: 4,
            },
        };
    }

    return {
        one: { [metric]: target },
        two: { [metric]: Math.max(target + 1, Math.round(target * 1.15)) },
        three: { [metric]: Math.max(target + 2, Math.round(target * 1.45)) },
    };
}

function getVictoryType(regime, baseLevel) {
    const baseVictoryType = baseLevel?.victory?.primary?.type;
    if (DERIVABLE_VICTORY_TYPES.has(baseVictoryType)) {
        return baseVictoryType;
    }

    return regime.victoryType;
}

export function deriveOdysseyLevelTuning(levelId, tags = {}, baseLevel = null) {
    if (!tags) {
        return null;
    }

    const difficulty = computeOdysseyDifficulty(levelId, tags);
    const regime = getRegime(tags.mechanicFocus);
    const speedTier = getSpeedTier(difficulty, tags);
    const speed = regime.progressing
        ? {
            startLevel: speedTier,
            levelProgression: true,
            fixedDropInterval: null,
        }
        : {
            startLevel: clamp(speedTier, 4, 9),
            levelProgression: false,
            fixedDropInterval: getFixedCascadeDropInterval(difficulty),
        };

    const victoryType = getVictoryType(regime, baseLevel);
    const target = getVictoryTarget(victoryType, difficulty);
    const failure = getFailureConfig(difficulty, tags);

    return {
        mechanics: {
            baseMode: regime.baseMode,
            board: getBoardConfig(regime, difficulty, tags),
            speed,
            pieces: {
                previewCount: getPreviewCount(difficulty, tags),
            },
        },
        victory: {
            primary: {
                type: victoryType,
                target,
            },
            failure,
        },
        modifiers: {
            active: getModifiers(regime, difficulty, tags, failure),
        },
        stars: getStars(victoryType, target, failure),
        metadata: {
            difficulty: clamp(Math.round(1 + difficulty * 9), 1, 10),
            difficultyModel: {
                scalar: Number(difficulty.toFixed(3)),
                band: getOdysseyDifficultyBand(difficulty),
            },
        },
    };
}

export function getOdysseyDifficultySummary(levelIds, tagsById) {
    return levelIds.map((levelId) => {
        const tags = tagsById[levelId] || {};
        const difficulty = computeOdysseyDifficulty(levelId, tags);
        return {
            id: levelId,
            difficulty,
            band: getOdysseyDifficultyBand(difficulty),
            role: tags.role,
            mechanicFocus: tags.mechanicFocus,
            emotionalBeat: tags.emotionalBeat,
        };
    });
}
