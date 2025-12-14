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
export const JOURNEY_PATH_DATA = {
    // Main path control points
    controlPoints: [
        // Chapter 1: Earth Core (bottom, warm tones)
        { x: 0, y: -20, z: 0 },
        { x: 5, y: -15, z: 3 },
        { x: -3, y: -10, z: 5 },

        // Chapter 2: Deep Ocean (rising, blue tones)
        { x: 0, y: 0, z: 2 },
        { x: -5, y: 10, z: 0 },
        { x: 3, y: 20, z: -3 },

        // Chapter 3: Surface World (ground level)
        { x: 0, y: 30, z: 0 },
        { x: 5, y: 40, z: 5 },
        { x: -2, y: 50, z: 3 },

        // Chapter 4: Mountains (ascending peaks)
        { x: 0, y: 60, z: 0 },
        { x: -4, y: 75, z: -5 },
        { x: 4, y: 90, z: -2 },

        // Chapter 5: Sky (floating in atmosphere)
        { x: 0, y: 105, z: 0 },
        { x: 6, y: 120, z: 3 },
        { x: -3, y: 135, z: -3 },

        // Chapter 6: Space (cosmic expanse)
        { x: 0, y: 150, z: 0 },
        { x: -5, y: 170, z: 5 },
        { x: 3, y: 190, z: -5 },

        // Chapter 7: Black Hole (transcendence)
        { x: 0, y: 210, z: 0 },
        { x: 0, y: 225, z: 0 },

        // Chapter 8: Urban Dreams (bonus - neon cyberpunk detour)
        { x: -5, y: 235, z: 5 },
        { x: 5, y: 245, z: -3 },
        { x: 0, y: 255, z: 0 },
    ],

    // Chapter positions (0-1 along path)
    chapterPositions: [
        0.0,    // Chapter 1 start
        0.125,  // Chapter 2 start
        0.25,   // Chapter 3 start
        0.375,  // Chapter 4 start
        0.5,    // Chapter 5 start
        0.625,  // Chapter 6 start
        0.75,   // Chapter 7 start
        0.875,  // Chapter 8 start (bonus)
    ],

    // Level positions for each of the 60 levels
    // Chapters 1-7 have 8 levels, Chapter 8 has 4 levels
    levelPositions: generateLevelPositions(),

    // Geometry settings
    segments: 300,
    radius: 0.4,
    radialSegments: 8,
};

/**
 * Generate path positions for all 60 levels
 * Chapters 1-7 have 8 levels each, Chapter 8 has 4 levels
 */
function generateLevelPositions() {
    const positions = [];

    // Chapters 1-7: 8 levels each (56 levels)
    for (let chapter = 0; chapter < 7; chapter++) {
        const chapterStart = chapter / 8; // Divide by 8 chapters now
        const chapterEnd = (chapter + 1) / 8;
        const chapterRange = chapterEnd - chapterStart;

        for (let level = 0; level < 8; level++) {
            const levelOffset = (level + 0.5) / 8;
            const position = chapterStart + chapterRange * levelOffset;
            positions.push(position);
        }
    }

    // Chapter 8: 4 levels (57-60)
    const ch8Start = 7 / 8;
    const ch8End = 1.0;
    const ch8Range = ch8End - ch8Start;

    for (let level = 0; level < 4; level++) {
        const levelOffset = (level + 0.5) / 4;
        const position = ch8Start + ch8Range * levelOffset;
        positions.push(position);
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
