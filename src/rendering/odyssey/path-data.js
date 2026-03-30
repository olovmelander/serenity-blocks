/**
 * @fileoverview Odyssey Path Data - Control points for the cosmic ascent path
 *
 * Defines the 3D spline path through all 8 chapters.
 * Chapter start positions reflect the current Odyssey campaign layout.
 */
import {
    deriveOdysseyChapterPositions,
    ODYSSEY_LAYOUT_DATA,
} from '../../core/odyssey/data/odyssey-layout.js';

/**
 * Path control points defining the cosmic ascent
 * Y-axis = vertical ascent, X/Z = horizontal variation
 */
const CHAPTER_POSITIONS = deriveOdysseyChapterPositions();

export const ODYSSEY_PATH_DATA = {
    // Main path control points
    controlPoints: ODYSSEY_LAYOUT_DATA.controlPoints,

    // Chapter positions (0-1 along path)
    chapterPositions: CHAPTER_POSITIONS,

    // Geometry settings
    segments: 300,
    radius: 0.4,
    radialSegments: 8,
};

export default ODYSSEY_PATH_DATA;
