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
    Object.freeze({ x: -164, y: 361.5, z: -289 }),
    Object.freeze({ x: -212, y: 389.5, z: -469 }),
    Object.freeze({ x: -211, y: 447, z: -504 }),
    Object.freeze({ x: -210, y: 622, z: -572 }),
    // ── THE ASCENT (Act II -> Space, Wave 1A, 2026-08-16) ────────────────────────
    // THE MOUNTAIN USED TO POP because the camera never left Act II — it was deleted out from
    // under it. Measured before: at the act gate the rail sat at y=688 while the hero massif
    // crowns at 1017.5 and the cloud deck bases at ~900, and the apex of the ENTIRE act was
    // y=729. The journey reached deep space 330u BELOW a summit whose 603u footprint it was
    // still inside, and from under the weather. Clearance was CLOSING, not opening: ground
    // rose 375->427 over p 0.65-0.70 while the camera rose only 658->711.
    //
    // The seam also had NO authored shape: cp15 governed p=0.621 and cp16 p=0.722 with nothing
    // between them, so the whole 5->6 transition was one near-linear interpolation.
    //
    // THESE SEVEN POINTS ARE CONSTRUCTED, NOT EYEBALLED. A gradient schedule eases
    // 76 -> 70 -> 63 -> 55 -> 47 -> 39 -> 32 deg and then joins the corridor at its own 24,
    // with segment lengths (105,110,115,115,105,95,85) converging on the corridor's own 76u
    // spacing. Catmull-Rom curvature depends on SPACING as much as direction: a first attempt
    // matched the join direction exactly but arrived on a 136u segment against the corridor's
    // 76u and spiked the turn rate to 5.99 deg. Regenerate from the schedule, never by nudging
    // one point.
    //
    // Measured after: apex 1501 (was 729), clearance grows monotonically instead of closing,
    // and the rail breaks out of the cloud deck around p=0.755 — the journey has never risen
    // above the weather before. The turn rate through the seam IMPROVED (14.45 -> 9.05
    // deg/step over p 0.55-0.85) because a kink was replaced by a longer arc.
    Object.freeze({ x: -200.1, y: 684.1, z: -615.8 }),
    Object.freeze({ x: -189.0, y: 744.5, z: -661.7 }),
    Object.freeze({ x: -177.4, y: 804.2, z: -708.4 }),
    Object.freeze({ x: -165.6, y: 862.7, z: -756.4 }),
    Object.freeze({ x: -153.8, y: 916.9, z: -809.5 }),
    Object.freeze({ x: -141.1, y: 969.2, z: -864.1 }),
    Object.freeze({ x: -118.2, y: 1017.3, z: -918.2 }),
    Object.freeze({ x: -74.3, y: 1055.4, z: -968.0 }),
    Object.freeze({ x: -34.9, y: 1100.7, z: -1015.5 }),
    Object.freeze({ x: 33.8, y: 1160.5, z: -1042.9 }),
    Object.freeze({ x: 100.8, y: 1205.5, z: -1069.5 }),
    Object.freeze({ x: 158.7, y: 1235.9, z: -1108.6 }),
    Object.freeze({ x: 216.6, y: 1266.2, z: -1147.7 }),
    Object.freeze({ x: 308.1, y: 1301.5, z: -1197.4 }),
    Object.freeze({ x: 318.8, y: 1315.8, z: -1183.9 }),
    Object.freeze({ x: 256.0, y: 1343.2, z: -1131.9 }),
    Object.freeze({ x: 249.7, y: 1363.9, z: -1129.6 }),
    Object.freeze({ x: 257.7, y: 1372.9, z: -1139.6 }),
    Object.freeze({ x: 254.7, y: 1402.9, z: -1134.6 }),
    Object.freeze({ x: 254.7, y: 1442.9, z: -1169.6 }),
    Object.freeze({ x: 249.7, y: 1462.9, z: -1174.6 }),
    Object.freeze({ x: 259.7, y: 1482.9, z: -1184.6 }),
    Object.freeze({ x: 254.7, y: 1502.9, z: -1179.6 }),
]);

const DEFAULT_LEVEL_POSITIONS_BY_ID = Object.freeze({
    1: 0,
    2: 0.0132,
    3: 0.0258,
    4: 0.0393,
    5: 0.0516,
    6: 0.0649,
    7: 0.0774,
    8: 0.0908,
    9: 0.1033,
    10: 0.1167,
    11: 0.1291,
    12: 0.1427,
    13: 0.1551,
    14: 0.1682,
    15: 0.1807,
    16: 0.1943,
    17: 0.2068,
    18: 0.2198,
    19: 0.2323,
    20: 0.2457,
    21: 0.2587,
    22: 0.2716,
    23: 0.284,
    24: 0.2973,
    25: 0.3097,
    26: 0.3223,
    27: 0.3356,
    28: 0.3489,
    29: 0.3996,
    30: 0.4503,
    31: 0.501,
    32: 0.5516,
    33: 0.6023,
    34: 0.653,
    35: 0.7037,
    36: 0.7543,
    37: 0.7634,
    38: 0.7725,
    39: 0.7808,
    40: 0.7899,
    41: 0.799,
    42: 0.808,
    43: 0.8171,
    44: 0.8262,
    45: 0.8353,
    46: 0.8437,
    47: 0.8527,
    48: 0.8618,
    49: 0.8709,
    50: 0.8835,
    51: 0.8967,
    52: 0.9093,
    53: 0.9225,
    54: 0.9351,
    55: 0.9484,
    56: 0.9609,
    57: 0.9742,
    58: 0.9868,
    59: 1,
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
