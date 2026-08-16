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
    Object.freeze({ x: -186.4, y: 723.9, z: -581.4 }),
    Object.freeze({ x: -151.4, y: 827.2, z: -595.3 }),
    Object.freeze({ x: -102.8, y: 929.7, z: -614.6 }),
    Object.freeze({ x: -41.5, y: 1023.9, z: -639 }),
    Object.freeze({ x: 25.1, y: 1100.7, z: -665.5 }),
    Object.freeze({ x: 93.8, y: 1160.5, z: -692.9 }),
    Object.freeze({ x: 160.8, y: 1205.5, z: -719.5 }),
    // ── CH6 SPACE CORRIDOR (re-authored 2026-08; TRANSLATED by Wave 1A) ──────────
    // Every point from here on is translated by ONE rigid offset, so the corridor's shape is
    // bit-for-bit what it was: the 6->7 hairpin, the banking climb and the aim-pitch floor all
    // survive because no relative geometry changed. Only the whole run moved, up and out, to
    // meet the top of the ascent. Space is authored in the CORRIDOR frame and rides the rail,
    // so translating it carries the diorama with the camera and leaves the One World behind —
    // which IS the "fly past the mountain" read.
    //
    // ARC LENGTH IS LOAD-BEARING and CHANGED DELIBERATELY: 1767.65 -> 2393.89 (+626.24).
    // Every level position below was REGENERATED to absorb it:
    //   * ids 1-28 keep their WORLD seats (max drift 0.029u, nearest-point against the old
    //     curve). 28 is included on purpose: it is chapter 5's first level, and
    //     getChapterPathRange(4).center — which the massifs are sited from — is the midpoint
    //     of ch4.start and ch5.start. Moving 28 re-sites the mountains.
    //   * ids 29-35 are re-spaced along the longer sky climb. No levels were ADDED; they are
    //     spread out, per owner direction. Chapter 5 goes 14.8% -> 37% of the traversal.
    //   * ids 36-59 are ARC-PRESERVING: new_p = (old_arc + added) / newTotal. All the added
    //     length is before the boundary, so chapters 6-8 keep their exact arc extents. A
    //     proportional re-map instead stretched them and pulled the 6->7 hairpin INSIDE
    //     chapter 6, spiking its turn rate to 32.7 deg (measured).
    // Do not hand-edit one of these without regenerating the rest.
    Object.freeze({ x: 218.7, y: 1235.9, z: -758.6 }),
    Object.freeze({ x: 276.6, y: 1266.2, z: -797.7 }),
    Object.freeze({ x: 368.1, y: 1301.5, z: -847.4 }),
    Object.freeze({ x: 378.8, y: 1315.8, z: -833.9 }),
    Object.freeze({ x: 316, y: 1343.2, z: -781.9 }),
    Object.freeze({ x: 309.7, y: 1363.9, z: -779.6 }),
    Object.freeze({ x: 317.7, y: 1372.9, z: -789.6 }),
    Object.freeze({ x: 314.7, y: 1402.9, z: -784.6 }),
    Object.freeze({ x: 314.7, y: 1442.9, z: -819.6 }),
    Object.freeze({ x: 309.7, y: 1462.9, z: -824.6 }),
    Object.freeze({ x: 319.7, y: 1482.9, z: -834.6 }),
    Object.freeze({ x: 314.7, y: 1502.9, z: -829.6 }),
]);

const DEFAULT_LEVEL_POSITIONS_BY_ID = Object.freeze({
    1: 0,
    2: 0.014,
    3: 0.0273,
    4: 0.0414,
    5: 0.0546,
    6: 0.0687,
    7: 0.0819,
    8: 0.0961,
    9: 0.1093,
    10: 0.1233,
    11: 0.1366,
    12: 0.1508,
    13: 0.164,
    14: 0.1779,
    15: 0.1914,
    16: 0.2055,
    17: 0.2188,
    18: 0.2326,
    19: 0.2458,
    20: 0.2598,
    21: 0.2732,
    22: 0.2871,
    23: 0.3006,
    24: 0.3145,
    25: 0.3277,
    26: 0.3412,
    27: 0.3551,
    28: 0.3692,
    29: 0.4156,
    30: 0.4619,
    31: 0.5083,
    32: 0.5547,
    33: 0.601,
    34: 0.6474,
    35: 0.6937,
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
    36: 0.7401,
    37: 0.7497,
    38: 0.7593,
    39: 0.7681,
    40: 0.7777,
    41: 0.7873,
    42: 0.7969,
    43: 0.8065,
    44: 0.8161,
    45: 0.8257,
    46: 0.8346,
    47: 0.8442,
    48: 0.8538,
    49: 0.8634,
    50: 0.8767,
    51: 0.8907,
    52: 0.904,
    53: 0.918,
    54: 0.9313,
    55: 0.9454,
    56: 0.9586,
    57: 0.9727,
    58: 0.986,
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
