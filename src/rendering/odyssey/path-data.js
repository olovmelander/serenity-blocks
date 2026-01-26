/**
 * @fileoverview Odyssey Path Data - Control points for the cosmic ascent path
 *
 * Defines the 3D spline path through all 7 chapters,
 * ascending from Earth Core to Black Hole transcendence.
 */

/**
 * Path control points defining the cosmic ascent
 * Y-axis = vertical ascent, X/Z = horizontal variation
 */
const CHAPTER_POSITIONS = [
    0.0, // Chapter 1 start
    0.03816, // Chapter 2 start
    0.070, // Chapter 3 start (Shifted earlier from 0.080)
    0.2124, // Chapter 4 start
    0.5768, // Chapter 5 start
    0.821325, // Chapter 6 start
    0.92098, // Chapter 7 start
    0.96519, // Chapter 8 start (bonus)
];

export const ODYSSEY_PATH_DATA = {
    // Main path control points
    controlPoints: [
        // Chapter 1: Earth Core (bottom, warm tones)
        { x: 0, y: -30, z: 0 },
        { x: 5, y: -22.5, z: 3 },
        { x: -3, y: -15, z: 5 },

        // Chapter 2: Deep Ocean (rising, blue tones)
        { x: -3, y: 0, z: 5 },
        { x: -3, y: 15, z: 5 },
        { x: -3, y: 30, z: 5 },

        // Chapter 3: Surface World (ground level) - approaching mountains
        // Straight ascent from water (up to y=55), then curve
        { x: -3, y: 55, z: 5 }, // Continue straight up from Ch2
        { x: -3, y: 70, z: -10 }, // Start gentle backward curve, keeping X largely stable
        { x: -15, y: 100, z: -60 }, // Connect to mountain approach

        // Chapter 4: Mountains - ascend straight through aurora
        // Path goes vertically through the aurora, not curving around mountains
        { x: -20, y: 160, z: -350 }, // Higher approach to clear Ch3 ground
        { x: -10, y: 240, z: -480 }, // Bend EARLIER and HIGHER to clear mountain slope
        { x: 0, y: 300, z: -480 }, // Vertical ascent (Constant Z at -480)
        { x: 0, y: 450, z: -480 }, // Continue straight up into space

        // Chapter 5: Sky & Atmospheric Drift - straight ascent into space
        { x: 0, y: 500, z: -480 }, // Continue vertical from Ch4
        { x: 0, y: 600, z: -550 }, // Slow drift deeper into space
        { x: 0, y: 700, z: -600 }, // Deep space

        // Chapter 6: Space (cosmic expanse, shifted up and deep)
        { x: 0, y: 750, z: -600 }, // Maintain deep Z
        { x: -5, y: 780, z: -595 },
        { x: 3, y: 810, z: -605 },

        // Chapter 7: Black Hole (transcendence, shifted up and deep)
        { x: 0, y: 850, z: -600 },
        { x: 0, y: 900, z: -600 },

        // Chapter 8: Urban Dreams (bonus, shifted up and deep)
        { x: -5, y: 920, z: -595 },
        { x: 5, y: 940, z: -605 },
        { x: 0, y: 960, z: -600 },
    ],

    // Chapter positions (0-1 along path)
    chapterPositions: CHAPTER_POSITIONS,

    // Level positions for each of the 60 levels
    // Chapters 1-7 have 8 levels, Chapter 8 has 4 levels
    levelPositions: generateLevelPositions(CHAPTER_POSITIONS),

    // Geometry settings
    segments: 300,
    radius: 0.4,
    radialSegments: 8,
};

/**
 * Generate path positions for all 60 levels
 * Chapters 1-7 have 8 levels each, Chapter 8 has 4 levels
 */
function generateLevelPositions(chapterPositions) {
    const positions = [];
    const levelCounts = [7, 7, 8, 8, 6, 8, 7, 4]; // Matches CHAPTER_CONFIGS in chapters.js

    // Generate positions chapter by chapter
    for (let chapter = 0; chapter < levelCounts.length; chapter++) {
        const chapterStart = chapterPositions[chapter];
        const chapterEnd = chapterPositions[chapter + 1] ?? 1;
        const chapterRange = chapterEnd - chapterStart;

        const count = levelCounts[chapter];

        for (let level = 0; level < count; level++) {
            // Distribute levels evenly within the chapter segment
            // (level + 0.5) / count centers them
            const levelOffset = (level + 0.5) / count;
            const position = chapterStart + chapterRange * levelOffset;
            positions.push(position);
        }
    }

    return positions;
}

/**
 * Get level configuration with path position
 * @param {number} levelId - 1-56
 * @returns {Object}
 */
export function getLevelPathPosition(levelId) {
    const index = levelId - 1;
    if (index < 0 || index >= ODYSSEY_PATH_DATA.levelPositions.length) {
        return 0;
    }
    return ODYSSEY_PATH_DATA.levelPositions[index];
}

/**
 * Get chapter for a level ID
 * @param {number} levelId - 1-56
 * @returns {number} 1-7
 */
export function getChapterForLevel(levelId) {
    return Math.ceil(levelId / 8);
}

export default ODYSSEY_PATH_DATA;
