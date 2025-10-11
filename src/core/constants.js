// =================================================================================
// GAME CONSTANTS - Configuration and constants for Serenity Blocks
// =================================================================================

import { getThemeIds } from '../themes/theme-registry.js';

/**
 * Board dimensions
 */
export const COLS = 10;
export const ROWS = 20;
export const HIDDEN_ROWS = 4;

/**
 * Block size (will be dynamically adjusted based on viewport)
 */
export let BLOCK_SIZE = 30;

/**
 * Update block size (called on resize)
 * @param {number} size - New block size
 */
export function setBlockSize(size) {
    BLOCK_SIZE = size;
}

/**
 * Tetromino colors
 */
export const COLORS = {
    I: '#00ff00', // Green
    O: '#ff9900', // Orange
    T: '#0000ff', // Blue
    S: '#00ffff', // Cyan
    Z: '#ff0000', // Red
    J: '#ffff00', // Yellow
    L: '#cc00cc', // Purple
    GARBAGE: '#808080', // Gray (garbage blocks)
    CLEAN_GARBAGE: '#a0a0a0', // Light gray (clean garbage)
};

/**
 * Tetromino shapes (rotation state 0)
 * Each shape is a 2D array representing the piece structure
 */
export const SHAPES = {
    I: [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ],
    O: [
        [1, 1],
        [1, 1],
    ],
    T: [
        [0, 0, 0],
        [1, 1, 1],
        [0, 1, 0],
    ],
    S: [
        [0, 1, 1],
        [1, 1, 0],
        [0, 0, 0],
    ],
    Z: [
        [1, 1, 0],
        [0, 1, 1],
        [0, 0, 0],
    ],
    J: [
        [0, 0, 0],
        [1, 1, 1],
        [0, 0, 1],
    ],
    L: [
        [0, 0, 0],
        [1, 1, 1],
        [1, 0, 0],
    ],
};

/**
 * Piece types for 7-bag randomizer
 */
export const PIECE_KEYS = 'IOTZSLJ';

/**
 * Score values for line clears
 */
export const SCORE_VALUES = {
    1: 100, // Single
    2: 300, // Double
    3: 500, // Triple
    4: 800, // Tetris
};

/**
 * Drop speeds per level (in milliseconds)
 * Levels 1-40, speeds get progressively faster
 */
export const LEVEL_SPEEDS = [
    1000,
    900,
    800,
    700,
    600,
    500,
    450,
    400,
    360,
    320, // Levels 1-10
    290,
    260,
    240,
    220,
    200,
    185,
    170,
    155,
    145,
    135, // Levels 11-20
    125,
    115,
    105,
    95,
    90,
    85,
    80,
    75,
    70,
    65, // Levels 21-30
    62,
    59,
    56,
    53,
    50,
    48,
    46,
    44,
    42,
    40, // Levels 31-40
];

/**
 * Available theme names
 */
export const THEMES = getThemeIds();

/**
 * Game modes
 */
export const GAME_MODES = {
    SINGLE_PLAYER: 'single',
    MULTIPLAYER: 'multiplayer',
};

/**
 * Garbage calculation rules (1:1 pattern)
 */
export const GARBAGE_RULES = {
    1: 1, // Single - 1 line of garbage
    2: 2, // Double - 2 lines
    3: 3, // Triple - 3 lines
    4: 4, // Tetris - 4 lines
};

/**
 * Default settings configuration
 */
export const DEFAULT_SETTINGS = {
    // Game mode
    gameMode: GAME_MODES.SINGLE_PLAYER,

    // Input settings
    dasDelay: 120,
    dasInterval: 40,

    // Audio settings
    musicTrack: 'Ambient',
    soundSet: 'Zen',
    musicVolume: 1.0,
    sfxVolume: 1.0,

    // Visual settings
    backgroundMode: 'Level', // 'Level', 'Random', or 'Specific'
    backgroundTheme: 'forest',
    themeLinkedMode: false,
    autoThemeChange: false,
    randomThemeInterval: 60, // seconds
    pieceLockRipple: true,
    pieceLockRippleColor: '#64c8ff',
    comboPopupEffect: true,
    lineClearEffects: true,
    effectQuality: 'High',

    // Control settings
    controlScheme: 'ontouchstart' in window ? 'Touch' : 'Keyboard',
    keyBindings: {
        moveLeft: 'ArrowLeft',
        moveRight: 'ArrowRight',
        rotateRight: 'ArrowUp',
        rotateLeft: 'z',
        flip: 'a',
        softDrop: 'ArrowDown',
        hardDrop: 'Space',
        nextTrack: 'm',
        randomTheme: 'b',
        toggleFullscreen: 'f',
        showHighScores: 'h',
    },
    // Player 2 controls (for multiplayer)
    player2KeyBindings: {
        moveLeft: 'a',
        moveRight: 'd',
        rotateRight: 'w',
        rotateLeft: 'q',
        flip: 'e',
        softDrop: 's',
        hardDrop: 'Shift',
    },
};
