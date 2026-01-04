/**
 * @fileoverview Journey Path Data - Control points for the cosmic ascent path
 *
 * Defines the 3D spline path through all 7 chapters,
 * ascending from Earth Core to Black Hole transcendence.
 */

/**
 * Path control points defining the cosmic ascent
 * Y-axis = vertical ascent, X/Z = horizontal variation
 */
const CHAPTER_POSITIONS = [
    0.0,     // Chapter 1 start
    0.03816, // Chapter 2 start
    0.070, // Chapter 3 start (Shifted earlier from 0.080)
    0.2124,  // Chapter 4 start
    0.5768,  // Chapter 5 start
    0.821325, // Chapter 6 start
    0.92098, // Chapter 7 start
    0.96519, // Chapter 8 start (bonus)
];

export const JOURNEY_PATH_DATA = {
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
        { x: -3, y: 45, z: 5 },
        { x: 5, y: 60, z: -20 },
        { x: -15, y: 75, z: -60 },

        // Chapter 4: Mountains - ascend straight through aurora
        // Path goes vertically through the aurora, not curving around mountains
        { x: -20, y: 95, z: -150 },   // Approaching mountains, mostly centered
        { x: -10, y: 140, z: -250 },  // Rising straight up through aurora
        { x: 0, y: 190, z: -280 },    // Through the center of aurora
        { x: 0, y: 235, z: -200 },    // Continue vertical ascent

        // Chapter 5: Sky & Atmospheric Drift - straight ascent into space
        { x: 0, y: 260, z: -100 },    // Continuing straight up
        { x: 0, y: 280, z: -30 },     // Centered vertical path
        { x: 0, y: 300, z: 10 },      // Centered, heading to space

        // Chapter 6: Space (cosmic expanse, shifted up)
        { x: 0, y: 310, z: 0 },     // +85
        { x: -5, y: 340, z: 5 },
        { x: 3, y: 370, z: -5 },

        // Chapter 7: Black Hole (transcendence, shifted up)
        { x: 0, y: 400, z: 0 },
        { x: 0, y: 425, z: 0 },

        // Chapter 8: Urban Dreams (bonus, shifted up)
        { x: -5, y: 440, z: 5 },
        { x: 5, y: 450, z: -3 },
        { x: 0, y: 465, z: 0 },
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
    if (index < 0 || index >= JOURNEY_PATH_DATA.levelPositions.length) {
        return 0;
    }
    return JOURNEY_PATH_DATA.levelPositions[index];
}

/**
 * Get chapter for a level ID
 * @param {number} levelId - 1-56
 * @returns {number} 1-7
 */
export function getChapterForLevel(levelId) {
    return Math.ceil(levelId / 8);
}

export default JOURNEY_PATH_DATA;
