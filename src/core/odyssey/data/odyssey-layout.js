/**
 * @fileoverview Odyssey layout data and helpers
 *
 * Centralizes the authored Odyssey spline control points and level placements
 * so the board, camera, environments, and layout editor all work from the
 * same source of truth.
 */

import { LEVEL_CONFIGS } from './levels.js';

const LAYOUT_POSITION_EPSILON = 0.001;

const DEFAULT_CONTROL_POINTS = Object.freeze([
    Object.freeze({ x: 0, y: -30, z: 0 }),
    Object.freeze({ x: 5, y: -22.5, z: 3 }),
    Object.freeze({ x: -3, y: -15, z: 5 }),
    Object.freeze({ x: -3, y: 0, z: 5 }),
    Object.freeze({ x: -3, y: 15, z: 5 }),
    Object.freeze({ x: -3, y: 30, z: 5 }),
    Object.freeze({ x: -3, y: 55, z: 5 }),
    Object.freeze({ x: -3, y: 125, z: 8 }),
    Object.freeze({ x: -3, y: 190, z: 10 }),
    Object.freeze({ x: -5, y: 250, z: 8 }),
    Object.freeze({ x: -28, y: 292, z: -30 }),
    Object.freeze({ x: -86, y: 336, z: -130 }),
    Object.freeze({ x: -164.0, y: 361.5, z: -289.0 }),
    Object.freeze({ x: -212.0, y: 389.5, z: -469.0 }),
    Object.freeze({ x: -211.0, y: 447.0, z: -504.0 }),
    Object.freeze({ x: -210.0, y: 622.0, z: -572.0 }),
    Object.freeze({ x: -96.0, y: 733.0, z: -654.0 }),
    // ── CH6 SPACE CORRIDOR (re-authored 2026-08) ─────────────────────────────────
    // Points 17-19 used to zigzag: cp17 stalled in z (-654 -> -662 while x ran +32),
    // and cp18/19 overshot to x=+61 before snapping back to cp20's x=0. Replaying
    // computeFollowFrame over the shipped curve showed the camera aim lurching
    // 13.1 deg per 0.3% of progress (pitch swinging 32 -> 42 -> -10, yaw 57 -> 83 -> 103)
    // and dipping BELOW the horizon mid-ascent — so no fixed placement could keep the
    // Space heroes framed (they measured 31-68 deg off the forward ray). These three
    // points turn the zigzag into one smooth banking climb: max turn rate 13.13 -> 1.40
    // deg/0.3%p, total turn 127 -> 24 deg, and the aim never pitches below +11 deg.
    //
    // ARC LENGTH IS LOAD-BEARING. Path positions are arc-length parameterised over the
    // WHOLE curve, so changing the total length re-maps every chapter's p -> world
    // position (a first attempt shortened it 74u and shifted Ch1-Ch5 by up to 54u).
    // These points hold the total at 1767.58 vs 1767.57, which keeps ch1-ch4 within
    // 0.01u and ch5 (the Ch4 hero-peak clearance) within 0.28u of the shipped curve.
    // Guarded by odyssey-path-layout.test.js.
    Object.freeze({ x: -38.1, y: 763.3, z: -693.1 }),
    Object.freeze({ x: 53.4, y: 798.6, z: -742.8 }),
    Object.freeze({ x: 64.1, y: 812.9, z: -729.3 }),
    Object.freeze({ x: 1.3, y: 840.3, z: -677.3 }),
    Object.freeze({ x: -5.0, y: 861.0, z: -675.0 }),
    Object.freeze({ x: 3.0, y: 870.0, z: -685.0 }),
    Object.freeze({ x: 0.0, y: 900.0, z: -680.0 }),
    Object.freeze({ x: 0, y: 940, z: -715 }),
    Object.freeze({ x: -5, y: 960, z: -720 }),
    Object.freeze({ x: 5, y: 980, z: -730 }),
    Object.freeze({ x: 0, y: 1000, z: -725 }),
]);

const DEFAULT_LEVEL_POSITIONS_BY_ID = Object.freeze({
    1: 0.000,
    2: 0.019,
    3: 0.037,
    4: 0.056,
    5: 0.074,
    6: 0.093,
    7: 0.111,
    8: 0.130,
    9: 0.148,
    10: 0.167,
    11: 0.185,
    12: 0.204,
    13: 0.222,
    14: 0.241,
    15: 0.259,
    16: 0.278,
    17: 0.296,
    18: 0.315,
    19: 0.333,
    20: 0.352,
    21: 0.370,
    22: 0.389,
    23: 0.407,
    24: 0.426,
    25: 0.444,
    26: 0.463,
    27: 0.481,
    28: 0.500,
    29: 0.519,
    30: 0.537,
    31: 0.556,
    32: 0.574,
    33: 0.593,
    34: 0.611,
    35: 0.630,
    // ── SPACE LENGTHENED (Space overhaul Wave 1, D1 2026-08-15): ch6 = 13 levels
    // (36-48) packed INSIDE the unchanged 0.648-0.815 window; ch7 = 49-55 and
    // ch8 = 56-59 keep the OLD 45-55 positions verbatim. No chapter boundary moves,
    // so every seam band, station and camera fit survives; players get 4 more space
    // levels and denser stations. Save-data ids ≥45 migrated +4 (SAVE_VERSION 2).
    //
    // ⚠️ Historical scout result (kept — do not re-try): re-spacing ch6's p-window to
    // 0.845 by taking far-side share FAILS against the spline — the 6→7 helical
    // sweep begins immediately after 0.815 (rail turn 25.6° vs corridor max 3°; BH
    // hero ndcX −1.70 by p=0.829). The boundary sits where the rail bends BY design;
    // growing the p-window needs re-authoring cp17-20 under the pinned arc length.
    36: 0.648,
    37: 0.661,
    38: 0.674,
    39: 0.686,
    40: 0.699,
    41: 0.712,
    42: 0.725,
    43: 0.738,
    44: 0.751,
    45: 0.764,
    46: 0.776,
    47: 0.789,
    48: 0.802,
    49: 0.815,
    50: 0.833,
    51: 0.852,
    52: 0.870,
    53: 0.889,
    54: 0.907,
    55: 0.926,
    56: 0.944,
    57: 0.963,
    58: 0.981,
    59: 1.000,
});

export const ODYSSEY_LAYOUT_DATA = Object.freeze({
    controlPoints: DEFAULT_CONTROL_POINTS,
    levelPositionsById: DEFAULT_LEVEL_POSITIONS_BY_ID,
});

function cloneControlPoints(controlPoints = DEFAULT_CONTROL_POINTS) {
    return controlPoints.map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
        z: Number(point.z),
    }));
}

function cloneLevelPositionsById(levelPositionsById = DEFAULT_LEVEL_POSITIONS_BY_ID) {
    return Object.fromEntries(
        Object.entries(levelPositionsById)
            .filter(([levelId, position]) => Number.isFinite(Number(levelId)) && Number.isFinite(position))
            .map(([levelId, position]) => [Number(levelId), Number(position)]),
    );
}

function getSortedLevelConfigs(levelConfigs = LEVEL_CONFIGS) {
    return [...levelConfigs].sort((left, right) => left.id - right.id);
}

function formatNumber(value, decimals = 3) {
    return Number(value).toFixed(decimals).replace(/\.?0+$/, '');
}

export function cloneOdysseyLayoutData(layout = ODYSSEY_LAYOUT_DATA) {
    return {
        controlPoints: cloneControlPoints(layout.controlPoints),
        levelPositionsById: cloneLevelPositionsById(layout.levelPositionsById),
    };
}

export function validateOdysseyLayoutData(layout, levelConfigs = LEVEL_CONFIGS) {
    const errors = [];
    const sortedLevels = getSortedLevelConfigs(levelConfigs);
    const controlPoints = layout?.controlPoints;
    const levelPositionsById = layout?.levelPositionsById;

    if (!Array.isArray(controlPoints) || controlPoints.length < 2) {
        errors.push('Layout must include at least two control points.');
    } else {
        controlPoints.forEach((point, index) => {
            if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || !Number.isFinite(point?.z)) {
                errors.push(`Control point ${index} is invalid.`);
            }
        });
    }

    if (!levelPositionsById || typeof levelPositionsById !== 'object') {
        errors.push('Layout must include levelPositionsById.');
    } else {
        let previousPosition = -Infinity;
        sortedLevels.forEach((level) => {
            const position = Number(levelPositionsById[level.id]);
            if (!Number.isFinite(position)) {
                errors.push(`Level ${level.id} is missing a layout path position.`);
                return;
            }

            if (position < 0 || position > 1) {
                errors.push(`Level ${level.id} path position ${position} is outside 0..1.`);
            }

            if (position <= previousPosition) {
                errors.push(`Level ${level.id} path position ${position} is not strictly increasing.`);
            }

            previousPosition = position;
        });
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

export function normalizeOdysseyLayoutData(
    layout = ODYSSEY_LAYOUT_DATA,
    fallback = ODYSSEY_LAYOUT_DATA,
    levelConfigs = LEVEL_CONFIGS,
) {
    const fallbackClone = cloneOdysseyLayoutData(fallback);
    const normalized = {
        controlPoints: Array.isArray(layout?.controlPoints) && layout.controlPoints.length >= 2
            ? cloneControlPoints(layout.controlPoints)
            : fallbackClone.controlPoints,
        levelPositionsById: {
            ...fallbackClone.levelPositionsById,
            ...cloneLevelPositionsById(layout?.levelPositionsById),
        },
    };

    const validation = validateOdysseyLayoutData(normalized, levelConfigs);
    if (!validation.valid) {
        throw new Error(validation.errors.join(' '));
    }

    return normalized;
}

export function deriveOdysseyChapterPositions(
    levelConfigs = LEVEL_CONFIGS,
    levelPositionsById = ODYSSEY_LAYOUT_DATA.levelPositionsById,
) {
    const sortedLevels = getSortedLevelConfigs(levelConfigs);
    const chapterPositions = [];
    const seenChapters = new Set();

    sortedLevels.forEach((level) => {
        if (seenChapters.has(level.chapter)) {
            return;
        }

        const position = Number(levelPositionsById[level.id]);
        if (!Number.isFinite(position)) {
            return;
        }

        seenChapters.add(level.chapter);
        chapterPositions.push(position);
    });

    if (chapterPositions[chapterPositions.length - 1] !== 1) {
        chapterPositions.push(1);
    }

    return chapterPositions;
}

export function applyOdysseyLayoutToLevels(levelConfigs = LEVEL_CONFIGS, layout = ODYSSEY_LAYOUT_DATA) {
    const normalizedLayout = normalizeOdysseyLayoutData(layout, ODYSSEY_LAYOUT_DATA, levelConfigs);

    return getSortedLevelConfigs(levelConfigs).map((level) => ({
        ...level,
        pathPosition: normalizedLayout.levelPositionsById[level.id],
    }));
}

export function buildOdysseyPresentationLayout(levelConfigs = LEVEL_CONFIGS, layout = ODYSSEY_LAYOUT_DATA) {
    const normalizedLayout = normalizeOdysseyLayoutData(layout, ODYSSEY_LAYOUT_DATA, levelConfigs);
    const resolvedLevels = applyOdysseyLayoutToLevels(levelConfigs, normalizedLayout);
    const chapterPositions = deriveOdysseyChapterPositions(
        resolvedLevels,
        normalizedLayout.levelPositionsById,
    );
    const chapterRanges = [];
    const chapters = new Map();

    resolvedLevels.forEach((level) => {
        if (!chapters.has(level.chapter)) {
            chapters.set(level.chapter, []);
        }
        chapters.get(level.chapter).push(level);
    });

    Array.from(chapters.keys()).sort((left, right) => left - right).forEach((chapterId, index) => {
        const chapterLevels = chapters.get(chapterId);
        const startLevel = chapterLevels[0];
        const endLevel = chapterLevels[chapterLevels.length - 1];
        chapterRanges.push({
            chapterId,
            startLevelId: startLevel.id,
            endLevelId: endLevel.id,
            startPosition: startLevel.pathPosition,
            endPosition: chapterPositions[index + 1] ?? 1,
        });
    });

    return {
        controlPoints: cloneControlPoints(normalizedLayout.controlPoints),
        levelPositionsById: cloneLevelPositionsById(normalizedLayout.levelPositionsById),
        levelPositions: resolvedLevels.map((level) => level.pathPosition),
        chapterPositions,
        totalLevels: resolvedLevels.length,
        chapterRanges,
    };
}

export function serializeOdysseyLayoutData(layout = ODYSSEY_LAYOUT_DATA) {
    return JSON.stringify(normalizeOdysseyLayoutData(layout), null, 4);
}

export function parseOdysseyLayoutData(
    serializedLayout,
    fallback = ODYSSEY_LAYOUT_DATA,
    levelConfigs = LEVEL_CONFIGS,
) {
    const parsed = typeof serializedLayout === 'string'
        ? JSON.parse(serializedLayout)
        : serializedLayout;

    return normalizeOdysseyLayoutData(parsed, fallback, levelConfigs);
}

export function createPatchReadyOdysseyLayoutSnippet(layout = ODYSSEY_LAYOUT_DATA) {
    const normalizedLayout = normalizeOdysseyLayoutData(layout);
    const controlPointsLines = normalizedLayout.controlPoints.map(
        (point) => `        { x: ${formatNumber(point.x)}, y: ${formatNumber(point.y)}, z: ${formatNumber(point.z)} },`,
    ).join('\n');
    const levelPositionLines = getSortedLevelConfigs()
        .map((level) => `        ${level.id}: ${formatNumber(normalizedLayout.levelPositionsById[level.id])},`)
        .join('\n');

    return [
        'export const ODYSSEY_LAYOUT_DATA = {',
        '    controlPoints: [',
        controlPointsLines,
        '    ],',
        '    levelPositionsById: {',
        levelPositionLines,
        '    },',
        '};',
        '',
        'export default ODYSSEY_LAYOUT_DATA;',
    ].join('\n');
}

export function getOdysseyLayoutPositionEpsilon() {
    return LAYOUT_POSITION_EPSILON;
}
