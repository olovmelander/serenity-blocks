// @ts-check
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
export let BLOCK_SIZE = 40;

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
    I: '#ff0000', // Red
    O: '#ff9900', // Orange
    T: '#0000ff', // Blue
    S: '#00ffff', // Cyan
    Z: '#00ff00', // Green
    J: '#ffff00', // Yellow
    L: '#cc00cc', // Purple
    GARBAGE: '#808080', // Gray (garbage blocks)
    CLEAN_GARBAGE: '#a0a0a0', // Light gray (clean garbage)
};

/**
 * Player colors for multiplayer (8 distinct colors for up to 8 players)
 * These are different from tetromino colors for clarity
 */
export const PLAYER_COLORS = [
    '#ff1744', // Red
    '#2979ff', // Blue
    '#00e676', // Green
    '#ffea00', // Yellow
    '#e040fb', // Purple
    '#00e5ff', // Cyan
    '#ff9100', // Orange
    '#f50057', // Pink
];

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
 * Base scores before level multiplier
 */
export const SCORE_VALUES = {
    1: 250, // Single
    2: 500, // Double
    3: 1000, // Triple
    4: 2000, // Quad (4-line clear)
};

/**
 * Scoring constants
 * Used for cascade bonuses, perfect clears, and level multipliers
 */
export const CASCADE_SCORING = {
    CASCADE_BASE: 200, // 200 * (complexity-1)² for cascades
    PERFECT_CLEAR_BASE: 1250, // depth * 1250 for perfect clears (≤4 lines)
    PERFECT_CLEAR_LARGE: 500, // depth² * 500 for perfect clears (>4 lines)
    LEVEL_MULTIPLIER: 0.1, // +10% per level (additive, not multiplicative)
};

/**
 * Calculate drop interval in milliseconds for a level
 *
 * Speed formula:
 *   level ≤ 10: speed = 4 + (level - 1) * 5
 *   level > 10: speed = 50 + (level - 10) * 3
 *
 * Conversion (fixed-point, >>4):
 *   Y coordinates are in 1/16th pixel units
 *   Cell height = 18 pixels × 16 = 288 sub-units
 *   At 100fps (10ms/frame): time_per_row = 288 / speed * 10ms
 *
 * @param {number} level - Current game level (1-indexed)
 * @returns {number} Drop interval in milliseconds per row
 */
export function getDropIntervalForLevel(level) {
    let speed;
    if (level <= 10) {
        speed = 4 + (level - 1) * 5;
    } else {
        speed = 50 + (level - 10) * 3;
    }
    // 288 sub-units per cell × 10ms per frame = 2880 / speed
    return Math.max(10, Math.floor(2880 / speed));
}

/**
 * Drop speeds per level (in milliseconds)
 * Generated from the drop-interval speed formula above
 * Level 1 = 720ms, Level 10 = 58ms, Level 20+ = very fast
 */
export const LEVEL_SPEEDS = (() => {
    const speeds = [];
    for (let level = 1; level <= 100; level++) {
        speeds.push(getDropIntervalForLevel(level));
    }
    return speeds;
})();

export const LOCK_DELAY_MS = 500;
export const LOCK_RESET_LIMIT = 15;

/**
 * Available theme names
 */
export const THEMES = getThemeIds();

/**
 * Theme to Sound Effect Set mapping
 * Only themes with their own dedicated SFX set are listed here
 * All other themes use 'Zen' as the default
 */
export const THEME_SFX_MAP = {
    'stellar-drift': 'StellarDrift',
    'cinder-drift': 'CinderDrift',
    pyrestorm: 'Pyrestorm',
    'swedish-forest': 'SwedishForest',
    galaxy: 'Galaxy',
    bioluminescence: 'Bioluminescence',
    'bioluminescence-2': 'Bioluminescence',
    wolfhour: 'Wolfhour',
    'neon-dusk': 'NeonDusk',
    'chromatic-impasto': 'ChromaticImpasto',
};

/**
 * Game modes
 */
export const GAME_MODES = {
    SINGLE_PLAYER: 'single',
    LOCAL_MULTIPLAYER: 'local-multiplayer',
    ONLINE_MULTIPLAYER: 'online-multiplayer',
    SERENITY: 'serenity',
    INFINITY: 'infinity',
    ODYSSEY: 'odyssey',
};

/**
 * Garbage calculation rules (1:1 pattern)
 */
export const GARBAGE_RULES = {
    1: 1, // Single - 1 line of garbage
    2: 2, // Double - 2 lines
    3: 3, // Triple - 3 lines
    4: 4, // Quad - 4 lines
};

/**
 * Default settings configuration
 */
export const DEFAULT_SETTINGS = {
    // Game mode
    gameMode: GAME_MODES.SINGLE_PLAYER,

    // Demo settings
    autoRecordDemos: true,

    // Input settings
    dasDelay: 120,
    dasInterval: 40,
    softDropInterval: 50,
    lockDelay: LOCK_DELAY_MS,
    lockResetLimit: LOCK_RESET_LIMIT,

    // Audio settings
    musicTrack: 'Ambient',
    soundSet: 'Zen',
    musicVolume: 1.0,
    sfxVolume: 1.0,

    // Visual settings
    backgroundMode: 'Level', // 'Level', 'Random', or 'Specific'
    backgroundTheme: 'forest',
    themeLinkedMode: false,
    themeLinkedSfx: false,
    autoThemeChange: false,
    randomThemeInterval: 60, // seconds
    pieceLockRipple: true,
    pieceLockRippleColor: '#64c8ff',
    comboPopupEffect: true,
    lineClearEffects: true,
    backgroundComboEffects: true,
    customCursorEnabled: true,
    customCursorIntensity: 'standard',
    customCursorVisibilityPreset: 'standard',
    customCursorReducedMotion: 'system',
    tornadoThemeParams: {
        emissiveColor: '#ff8a3b',
        timeScale: 1.0,
        ribbonWidth: 1.0,
        parabolaStrength: 1.0,
        parabolaOffset: 0.35,
        parabolaAmplitude: 0.45,
        bloomStrength: 1.0,
        bloomRadius: 0.2,
    },
    effectQuality: 'High',

    // Serenity Mode settings
    breathingGuideEnabled: false,
    breathingTechnique: 'deep-relaxation', // Breathing technique
    breathingText: true, // Show text prompts
    breathingGuideAutoStart: false, // Auto-start breathing guide on mode entry

    // Control settings
    controlScheme: 'Keyboard',
    keyBindings: {
        moveLeft: 'ArrowLeft',
        moveRight: 'ArrowRight',
        rotateRight: 'ArrowUp',
        rotateLeft: 'z',
        flip: 'a',
        softDrop: 'ArrowDown',
        hardDrop: 'Space',
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
    serenityKeyBindings: {
        toggleHub: 'h',
        toggleBreathing: 'Space',
        cycleBreathingTechnique: 't',
        randomTheme: 'b',
        toggleFullscreen: 'f',
        toggleControlHints: '/',
        exitToMenu: 'Escape',
    },
    // Gamepad bindings (Player 1)
    gamepadBindings: {
        moveLeft: 14, // D-pad Left
        moveRight: 15, // D-pad Right
        rotateRight: 0, // A Button
        rotateLeft: 3, // Y Button
        flip: 2, // X Button
        softDrop: 13, // D-pad Down
        hardDrop: 1, // B Button
        pause: 9, // Start Button
    },
    // Player 2 gamepad bindings (for multiplayer)
    player2GamepadBindings: {
        moveLeft: 14, // D-pad Left
        moveRight: 15, // D-pad Right
        rotateRight: 0, // A Button
        rotateLeft: 3, // Y Button
        flip: 2, // X Button
        softDrop: 13, // D-pad Down
        hardDrop: 1, // B Button
        pause: 9, // Start Button
    },
    player3GamepadBindings: {
        moveLeft: 14,
        moveRight: 15,
        rotateRight: 0,
        rotateLeft: 3,
        flip: 2,
        softDrop: 13,
        hardDrop: 1,
        pause: 9,
    },
    player4GamepadBindings: {
        moveLeft: 14,
        moveRight: 15,
        rotateRight: 0,
        rotateLeft: 3,
        flip: 2,
        softDrop: 13,
        hardDrop: 1,
        pause: 9,
    },
    serenityGamepadBindings: {
        toggleHub: 3,
        toggleBreathing: 2,
        randomTheme: 10,
        toggleFullscreen: 11,
        previousTrack: 4,
        nextTrack: 5,
        volumeDown: 6,
        volumeUp: 7,
        toggleControlHints: 8,
        openSettings: 9,
        previousBreathingTechnique: 12,
        nextBreathingTechnique: 13,
        confirmSelection: 0,
        closeHub: 1,
        navigateLeft: 14,
        navigateRight: 15,
    },
    // Gamepad settings
    gamepadEnabled: true,
    gamepadDeadzone: 0.25,
};
