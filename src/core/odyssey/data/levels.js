/**
 * @fileoverview Odyssey Mode Level Configurations
 *
 * Each level is a complete configuration defining:
 * - Theme and visual settings
 * - Gameplay mechanics (standard, infinity, or hybrid)
 * - Victory and failure conditions
 * - Star rating thresholds
 * - Active modifiers
 *
 * Levels are organized by chapter (55 total with unique themes).
 *
 * Difficulty Scale: 1-10
 * - 1-2: Tutorial/Easy
 * - 3-4: Normal
 * - 5-6: Challenging
 * - 7-8: Hard
 * - 9-10: Expert
 */

/**
 * @typedef {Object} LevelConfig
 * See ODYSSEY_MODE_IMPLEMENTATION_PLAN.md for full schema
 */

import { deriveOdysseyLevelTuning } from './difficulty-model.js';

// Phase 2 keeps the original authored list intact and composes the shipped campaign
// from the base data plus the tuning overrides defined below.
const BASE_LEVEL_CONFIGS = [
    // =============================
    // CHAPTER 1: EARTH CORE & SUBTERRANEAN ORIGINS
    // Levels 1-5
    // Theme: Deep underground, crystals, magma, pressure
    // =============================

    {
        id: 1,
        name: 'Ashen Dawn',
        chapter: 1,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        pathPosition: 0.000,

        theme: {
            primary: 'cinder-drift',
            overlays: [],
            transitionIn: 'warp',
            transitionDuration: 2000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 1,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 20,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'no-singles', description: 'Clear no single lines' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            // 1 star: Clear 20 lines
            one: { lines: 20 },
            // 2 stars: Clear 20 lines in under 3 minutes
            two: { lines: 20, time: 180 },
            // 3 stars: Clear 20 lines fast + avoid single-line clears (use victory lap for extras)
            three: { lines: 20, time: 90, bonuses: 1 },
        },

        metadata: {
            description: 'Clear 20 lines to complete your first level! A gentle introduction to the odyssey.',
            difficulty: 1,
            tip: 'Build flat stacks and clear multiple lines at once. Clearing 2+ lines is more efficient than singles! Keep playing after goal for more stars.',
        },
    },

    {
        id: 2,
        name: 'Crystal Cascade',
        chapter: 1,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.019,

        theme: {
            primary: 'crystal-cave',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 24,
                startingRows: 4,
            },

            speed: {
                startLevel: 2,
                levelProgression: false,
                fixedDropInterval: 800,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 3,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 2, description: 'Trigger a 2+ chain cascade' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade'],
        },

        stars: {
            // 1 star: Complete the goal (trigger 3 separate cascades)
            one: { cascades: 3 },
            // 2 stars: 4 cascades + achieve a 2-deep chain (use victory lap to get extra cascade)
            two: { cascades: 4, maxCascadeDepth: 2 },
            // 3 stars: 5 cascades + achieve a 3-deep chain (master cascade setup in victory lap)
            three: { cascades: 5, maxCascadeDepth: 3 },
        },

        metadata: {
            description: 'Learn the power of cascading clears. Watch blocks fall and chain together.',
            difficulty: 2,
            tip: 'Build towers with gaps - when you clear a line, blocks above will fall and may trigger chain reactions! Keep playing after goal for more stars.',
        },
    },

    {
        id: 3,
        name: 'Geode Heart',
        chapter: 1,
        chapterLevel: 3,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.037,

        theme: {
            primary: 'geode',
            overlays: ['bioluminescence'],
            transitionIn: 'crossfade',
            transitionDuration: 2500,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 26,
                startingRows: 6,
            },

            speed: {
                startLevel: 3,
                levelProgression: false,
                fixedDropInterval: 700,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 4,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 2, description: 'Trigger a 2+ chain cascade' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade'],
        },

        stars: {
            // 1 star: Trigger 4 cascades
            one: { cascades: 4 },
            // 2 stars: 4 cascades + achieve a 2-deep chain
            two: { cascades: 4, maxCascadeDepth: 2 },
            // 3 stars: 5 cascades + 3-deep chain (use victory lap for extra cascade)
            three: { cascades: 5, maxCascadeDepth: 3 },
        },

        metadata: {
            description: 'Trigger 4 cascades in the crystal geode! A cascade happens when falling blocks clear more lines.',
            difficulty: 2,
            tip: 'Build tall stacks with gaps underneath. Clear the bottom line and watch the cascade chain! Keep playing after goal for more stars.',
        },
    },

    {
        id: 4,
        name: 'Molten Flow',
        chapter: 1,
        chapterLevel: 4,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.056,

        theme: {
            primary: 'pyrestorm',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 5,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 4,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 30,
            },
            failure: {
                type: 'time',
                value: 180,
            },
            bonuses: [
                { type: 'time', target: 120, description: 'Complete in under 2 minutes' },
            ],
        },

        modifiers: {
            active: ['time-attack'],
        },

        stars: {
            // 1 star: Clear 30 lines before time runs out
            one: { lines: 30 },
            // 2 stars: Clear 30 lines with 30+ seconds remaining
            two: { lines: 30, time: 150 },
            // 3 stars: Clear 30 lines in under 90 seconds (fast!)
            three: { lines: 30, time: 90 },
        },

        metadata: {
            description: 'TIME ATTACK! Clear 30 lines before the 3-minute timer runs out.',
            difficulty: 3,
            tip: 'This is your first time attack level! Speed matters more than perfection - keep clearing lines to beat the clock.',
        },
    },

    {
        id: 5,
        name: 'Crystal Cavern',
        chapter: 1,
        chapterLevel: 5,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.074,

        theme: {
            primary: 'bioluminescence',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 2500,
        },

        mechanics: {
            baseMode: 'hybrid',

            board: {
                columns: 10,
                rows: 24,
                startingRows: 6,
            },

            speed: {
                startLevel: 4,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 40,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'cascade', target: 3, description: 'Trigger 3 cascades' },
                { type: 'no-singles', description: 'No single line clears' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade'],
        },

        stars: {
            // 1 star: Clear 40 lines
            one: { lines: 40 },
            // 2 stars: Clear 40 lines + trigger 2 cascades
            two: { lines: 40, cascades: 2 },
            // 3 stars: Clear 40 lines + 4 cascades + both bonuses (use victory lap)
            three: { lines: 40, cascades: 4, bonuses: 2 },
        },

        metadata: {
            description: 'Clear 40 lines in the crystal cavern! Cascades are active - falling blocks can trigger more clears.',
            difficulty: 4,
            tip: 'This level combines line clearing with cascades. The 6 starting rows create cascade opportunities - use them! Keep playing after goal for more stars.',
        },
    },

    {
        id: 6,
        name: 'Seismic Surge',
        chapter: 2,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        pathPosition: 0.093,

        theme: {
            primary: 'ocean',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 2000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 8,
            },

            speed: {
                startLevel: 6,
                levelProgression: false,
                fixedDropInterval: 600,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 3,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 20,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'tetris-count', target: 3, description: 'Clear 3 Quads' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            one: { lines: 20 },
            two: { lines: 20, tetrises: 2 },
            three: { lines: 20, tetrises: 4, time: 120 },
        },

        metadata: {
            description: 'Start under pressure with a half-filled board. Dig your way out!',
            difficulty: 5,
            tip: 'Clear the starting garbage quickly to make room for building.',
        },
    },

    {
        id: 7,
        name: 'Sunken Depths',
        chapter: 2,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.111,

        theme: {
            primary: 'luminous-tides',
            overlays: [],
            transitionIn: 'warp',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 30,
                startingRows: 10,
            },

            speed: {
                startLevel: 5,
                levelProgression: false,
                fixedDropInterval: 700,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 8,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 4, description: 'Trigger a 4+ chain cascade' },
                { type: 'combo', target: 5, description: 'Reach 5x combo' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            one: { cascades: 8 },
            two: { cascades: 8, maxCascadeDepth: 3 },
            three: { cascades: 10, maxCascadeDepth: 5, combo: 5 },
        },

        metadata: {
            description: 'Master the cascade. Build towering structures that collapse in chain reactions.',
            difficulty: 6,
            tip: 'Plan multiple layers of clears. Each cascade can trigger the next.',
        },
    },

    {
        id: 8,
        name: 'Luminous Tides',
        chapter: 2,
        chapterLevel: 3,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.130,

        theme: {
            primary: 'koi-pond',
            overlays: [],
            transitionIn: 'warp',
            transitionDuration: 4000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 3,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 30,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'no-singles', description: 'Clear no single lines' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            one: { lines: 30 },
            two: { lines: 30, time: 180 },
            three: { lines: 30, time: 120, bonuses: 1 },
        },

        metadata: {
            description: 'Enter the deep ocean. The water offers a new rhythm to your descent.',
            difficulty: 3,
            tip: 'The calmer pace gives you more time to plan ahead.',
        },
    },

    {
        id: 9,
        name: 'Stillwater Sanctuary',
        chapter: 2,
        chapterLevel: 4,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.148,

        theme: {
            primary: 'waves',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 5,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 10000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'tetris-count', target: 4, description: 'Clear 4 Quads' },
            ],
        },

        modifiers: {
            active: ['combo-multiplier'],
        },

        stars: {
            one: { score: 10000 },
            two: { score: 15000, tetrises: 2 },
            three: { score: 20000, tetrises: 5 },
        },

        metadata: {
            description: 'Ride the glowing tides. Build combos to maximize your score.',
            difficulty: 4,
            tip: 'Consecutive clears build combos. Keep the rhythm going!',
        },
    },

    {
        id: 10,
        name: 'Koi Dreams',
        chapter: 2,
        chapterLevel: 5,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.167,

        theme: {
            primary: 'misty-lake',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 4,
                levelProgression: false,
                fixedDropInterval: 900,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 6,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 40,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'no-singles', description: 'No single line clears' },
                { type: 'tetris-count', target: 5, description: 'Clear 5 Quads' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            one: { lines: 40 },
            two: { lines: 40, bonuses: 1 },
            three: { lines: 40, bonuses: 2 },
        },

        metadata: {
            description: 'A place of perfect calm. Take your time and build with precision.',
            difficulty: 3,
            tip: 'Slower drops mean more time for perfect placements.',
        },
    },

    {
        id: 11,
        name: 'Wave Runner',
        chapter: 2,
        chapterLevel: 6,
        isChapterStart: false,
        isChapterEnd: true,
        pathPosition: 0.185,

        theme: {
            primary: 'stillwater',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 26,
                startingRows: 8,
            },

            speed: {
                startLevel: 5,
                levelProgression: false,
                fixedDropInterval: 700,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 10,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 4, description: 'Trigger a 4+ chain' },
                { type: 'combo', target: 6, description: 'Reach 6x combo' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            one: { cascades: 10 },
            two: { cascades: 10, maxCascadeDepth: 4 },
            three: { cascades: 12, maxCascadeDepth: 5, combo: 6 },
        },

        metadata: {
            description: 'Float among graceful koi. Create flowing cascades like ripples in water.',
            difficulty: 5,
            tip: 'Build tall structures that cascade downward like waterfalls.',
        },
    },

    {
        id: 12,
        name: 'Forest Awakening',
        chapter: 3,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        pathPosition: 0.204,

        theme: {
            primary: 'forest',
            overlays: ['luminous-tides'],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 8,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 4,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 50,
            },
            failure: {
                type: 'time',
                value: 240,
            },
            bonuses: [
                { type: 'tetris-count', target: 8, description: 'Clear 8 Quads' },
                { type: 'time', target: 180, description: 'Complete in under 3 minutes' },
            ],
        },

        modifiers: {
            active: ['time-attack', 'combo-multiplier'],
        },

        stars: {
            one: { lines: 50 },
            two: { lines: 50, tetrises: 5 },
            three: { lines: 50, tetrises: 10, time: 150 },
        },

        metadata: {
            description: 'Race the waves! Speed and precision combine in this high-tempo challenge.',
            difficulty: 6,
            tip: 'The speed increases - stay focused and keep clearing!',
        },
    },

    {
        id: 13,
        name: 'Spring Bloom',
        chapter: 3,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.222,

        theme: {
            primary: 'moonlit-forest',
            overlays: [],
            transitionIn: 'warp',
            transitionDuration: 4000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 4,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 35,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'no-singles', description: 'No single line clears' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            one: { lines: 35 },
            two: { lines: 35, time: 180 },
            three: { lines: 35, time: 120, bonuses: 1 },
        },

        metadata: {
            description: 'Emerge into a lush forest. The surface world welcomes you with warmth.',
            difficulty: 4,
            tip: 'Enjoy the natural pace and focus on clean stacking.',
        },
    },

    {
        id: 14,
        name: 'Meadow Dance',
        chapter: 3,
        chapterLevel: 3,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.241,

        theme: {
            primary: 'swedish-forest',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 5,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 12000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'tetris-count', target: 5, description: 'Clear 5 Quads' },
                { type: 'combo', target: 4, description: 'Reach 4x combo' },
            ],
        },

        modifiers: {
            active: ['combo-multiplier'],
        },

        stars: {
            one: { score: 12000 },
            two: { score: 18000, tetrises: 3 },
            three: { score: 25000, tetrises: 6, combo: 5 },
        },

        metadata: {
            description: 'New growth springs forth. Build combos like blossoming flowers.',
            difficulty: 4,
            tip: 'Keep combos going by clearing lines in quick succession.',
        },
    },

    {
        id: 15,
        name: 'Summer Heat',
        chapter: 3,
        chapterLevel: 4,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.259,

        theme: {
            primary: 'moonlit-greenhouse',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 26,
                startingRows: 6,
            },

            speed: {
                startLevel: 5,
                levelProgression: false,
                fixedDropInterval: 700,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 8,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 4, description: 'Trigger a 4+ chain' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade'],
        },

        stars: {
            one: { cascades: 8 },
            two: { cascades: 8, maxCascadeDepth: 3 },
            three: { cascades: 10, maxCascadeDepth: 5 },
        },

        metadata: {
            description: 'Sway with the meadow grasses. Create cascading clears like wind through fields.',
            difficulty: 5,
            tip: 'Let blocks cascade naturally like grass bending in the breeze.',
        },
    },

    {
        id: 16,
        name: 'Fall Harvest',
        chapter: 3,
        chapterLevel: 5,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.278,

        theme: {
            primary: 'tornado',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 2500,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 7,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 4,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 45,
            },
            failure: {
                type: 'time',
                value: 180,
            },
            bonuses: [
                { type: 'time', target: 120, description: 'Complete in under 2 minutes' },
            ],
        },

        modifiers: {
            active: ['time-attack'],
        },

        stars: {
            one: { lines: 45 },
            two: { lines: 45, time: 150 },
            three: { lines: 45, time: 100 },
        },

        metadata: {
            description: 'The summer sun beats down. Move fast before the heat overwhelms!',
            difficulty: 6,
            tip: 'Speed is key - keep pieces flowing!',
        },
    },

    {
        id: 17,
        name: 'Sakura Twilight',
        chapter: 3,
        chapterLevel: 6,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.296,

        theme: {
            primary: 'summer',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'hybrid',

            board: {
                columns: 10,
                rows: 24,
                startingRows: 8,
            },

            speed: {
                startLevel: 6,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 20000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'cascade', target: 6, description: 'Trigger 6 cascades' },
                { type: 'tetris-count', target: 5, description: 'Clear 5 Quads' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            one: { score: 20000 },
            two: { score: 30000, cascades: 4 },
            three: { score: 40000, cascades: 8, tetrises: 6 },
        },

        metadata: {
            description: 'Gather the autumn harvest. Combine cascades and Quads for maximum yield.',
            difficulty: 6,
            tip: 'The starting blocks are your harvest - collect points from them!',
        },
    },

    {
        id: 18,
        name: 'Verdant Heights',
        chapter: 3,
        chapterLevel: 7,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.315,

        theme: {
            primary: 'fall',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 6,
                levelProgression: false,
                fixedDropInterval: 650,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 50,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'no-singles', description: 'No single line clears' },
                { type: 'tetris-count', target: 8, description: 'Clear 8 Quads' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            one: { lines: 50 },
            two: { lines: 50, tetrises: 5 },
            three: { lines: 50, tetrises: 10, bonuses: 2 },
        },

        metadata: {
            description: 'Cherry blossoms fall in the fading light. Play with grace and precision.',
            difficulty: 5,
            tip: 'Like falling petals, aim for clean, beautiful plays.',
        },
    },

    {
        id: 19,
        name: 'Sunset Ascension',
        chapter: 3,
        chapterLevel: 8,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.333,

        theme: {
            primary: 'summer',
            overlays: ['forest'],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 28,
                startingRows: 10,
            },

            speed: {
                startLevel: 7,
                levelProgression: false,
                fixedDropInterval: 600,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 12,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 5, description: 'Trigger a 5+ chain' },
                { type: 'combo', target: 7, description: 'Reach 7x combo' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            one: { cascades: 12 },
            two: { cascades: 12, maxCascadeDepth: 4 },
            three: { cascades: 15, maxCascadeDepth: 6, combo: 8 },
        },

        metadata: {
            description: 'Climb the rolling green hills. Master cascading chains on tall terrain.',
            difficulty: 7,
            tip: 'The tall board allows massive cascades - build upward!',
        },
    },

    {
        id: 20,
        name: 'Mountain Base',
        chapter: 3,
        chapterLevel: 9,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.352,

        theme: {
            primary: 'sakura-twilight',
            overlays: ['sakura-twilight', 'verdant-hills'],
            transitionIn: 'warp',
            transitionDuration: 4000,
        },

        mechanics: {
            baseMode: 'hybrid',

            board: {
                columns: 10,
                rows: 24,
                startingRows: 6,
            },

            speed: {
                startLevel: 8,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 35000,
            },
            failure: {
                type: 'time',
                value: 300,
            },
            bonuses: [
                { type: 'cascade', target: 10, description: 'Trigger 10 cascades' },
                { type: 'tetris-count', target: 8, description: 'Clear 8 Quads' },
                { type: 'time', target: 180, description: 'Complete in under 3 minutes' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier', 'time-attack'],
        },

        stars: {
            one: { score: 35000 },
            two: { score: 50000, cascades: 8 },
            three: { score: 70000, cascades: 12, tetrises: 10 },
        },

        metadata: {
            description: 'The sun sets on the surface world. Rise toward the mountains as light fades.',
            difficulty: 8,
            tip: 'Combine every technique. This is your graduation from the surface.',
        },
    },

    {
        id: 21,
        name: 'Himalayan Dawn',
        chapter: 3,
        chapterLevel: 10,
        isChapterStart: false,
        isChapterEnd: true,
        pathPosition: 0.370,

        theme: {
            primary: 'verdant-hills',
            overlays: [],
            transitionIn: 'warp',
            transitionDuration: 4000,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 40,
                startingRows: 10,
            },

            speed: {
                startLevel: 6,
                levelProgression: false,
                fixedDropInterval: 600,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 10,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 4, description: 'Trigger a 4+ chain cascade' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade'],
        },

        stars: {
            // 1 star: Trigger 10 cascades
            one: { cascades: 10 },
            // 2 star: 10 cascades + achieve a 3-deep chain
            two: { cascades: 10, maxCascadeDepth: 3 },
            // 3 stars: 12 cascades + 4-deep chain (use victory lap for 2 extra cascades)
            three: { cascades: 12, maxCascadeDepth: 4 },
        },

        metadata: {
            description: 'Chapter finale! Trigger 10 cascades on the tall 40-row board.',
            difficulty: 7,
            tip: 'Build tall towers with gaps - the 40-row board gives space for epic chain reactions! Keep playing after goal for more stars.',
        },
    },

    {
        id: 22,
        name: 'Aurora Borealis',
        chapter: 4,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        pathPosition: 0.389,

        theme: {
            primary: 'aurora',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 4,
            },

            speed: {
                startLevel: 7,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 4,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 18000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'tetris-count', target: 6, description: 'Clear 6 Quads' },
            ],
        },

        modifiers: {
            active: ['combo-multiplier'],
        },

        stars: {
            one: { score: 18000 },
            two: { score: 25000, tetrises: 4 },
            three: { score: 35000, tetrises: 8 },
        },

        metadata: {
            description: 'Watch the sun rise over the Himalayas. Build score in the thin mountain air.',
            difficulty: 6,
            tip: 'Start by clearing the existing blocks, then build for Quads.',
        },
    },

    {
        id: 23,
        name: 'Alpine Night',
        chapter: 4,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.407,

        theme: {
            primary: 'wolfhour',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 26,
                startingRows: 8,
            },

            speed: {
                startLevel: 6,
                levelProgression: false,
                fixedDropInterval: 650,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 10,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 4, description: 'Trigger a 4+ chain' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade'],
        },

        stars: {
            one: { cascades: 10 },
            two: { cascades: 10, maxCascadeDepth: 4 },
            three: { cascades: 12, maxCascadeDepth: 5 },
        },

        metadata: {
            description: 'Enter the ancient ice temple. Frozen structures create cascade opportunities.',
            difficulty: 6,
            tip: 'The ice formations are arranged for cascading - find the patterns.',
        },
    },

    {
        id: 24,
        name: 'Everest Ascent',
        chapter: 4,
        chapterLevel: 3,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.426,

        theme: {
            primary: 'himalayan-peak',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 9,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 3,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 50,
            },
            failure: {
                type: 'time',
                value: 180,
            },
            bonuses: [
                { type: 'time', target: 120, description: 'Complete in under 2 minutes' },
            ],
        },

        modifiers: {
            active: ['time-attack'],
        },

        stars: {
            one: { lines: 50 },
            two: { lines: 50, time: 150 },
            three: { lines: 50, time: 100 },
        },

        metadata: {
            description: 'A blizzard descends! Race against the storm at high speed.',
            difficulty: 7,
            tip: 'Speed is survival - keep moving!',
        },
    },

    {
        id: 25,
        name: 'Wolfhour',
        chapter: 4,
        chapterLevel: 4,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.444,

        theme: {
            primary: 'mountain',
            overlays: [],
            transitionIn: 'warp',
            transitionDuration: 4000,
        },

        mechanics: {
            baseMode: 'hybrid',

            board: {
                columns: 10,
                rows: 24,
                startingRows: 6,
            },

            speed: {
                startLevel: 7,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 25000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'cascade', target: 8, description: 'Trigger 8 cascades' },
                { type: 'tetris-count', target: 6, description: 'Clear 6 Quads' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            one: { score: 25000 },
            two: { score: 35000, cascades: 6 },
            three: { score: 50000, cascades: 10, tetrises: 8 },
        },

        metadata: {
            description: 'Rest in a moonlit forest on the mountainside. A moment of serene challenge.',
            difficulty: 7,
            tip: 'The moonlight reveals cascade patterns - watch for them.',
        },
    },

    {
        id: 26,
        name: 'Moonrise Summit',
        chapter: 4,
        chapterLevel: 5,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.463,

        theme: {
            primary: 'winter',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 10,
            },

            speed: {
                startLevel: 8,
                levelProgression: false,
                fixedDropInterval: 500,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 3,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 30,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'time', target: 90, description: 'Complete in under 90 seconds' },
                { type: 'tetris-count', target: 4, description: 'Clear 4 Quads' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            // 1 star: Clear 30 lines
            one: { lines: 30 },
            // 2 stars: Clear 30 lines in under 2 minutes
            two: { lines: 30, time: 120 },
            // 3 stars: Clear 30 lines in 90s + 4 tetrises (more achievable with starting garbage)
            three: { lines: 30, time: 90, tetrises: 4 },
        },

        metadata: {
            description: 'Clear 30 lines starting from a half-filled board! Dig out fast.',
            difficulty: 8,
            tip: 'Half the board is garbage - clear it quickly and build for Quads. Keep playing after goal for more stars!',
        },
    },

    {
        id: 27,
        name: 'Peak Transcendence',
        chapter: 4,
        chapterLevel: 6,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.481,

        theme: {
            primary: 'moonrise-summit',
            overlays: ['winter'],
            transitionIn: 'crossfade',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 28,
                startingRows: 10,
            },

            speed: {
                startLevel: 8,
                levelProgression: false,
                fixedDropInterval: 550,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 15,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 6, description: 'Trigger a 6+ chain' },
                { type: 'combo', target: 8, description: 'Reach 8x combo' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            one: { cascades: 15 },
            two: { cascades: 15, maxCascadeDepth: 5 },
            three: { cascades: 18, maxCascadeDepth: 7, combo: 10 },
        },

        metadata: {
            description: 'The moon rises over the summit. Create cascading avalanches.',
            difficulty: 8,
            tip: 'Build massive towers for spectacular cascade chains.',
        },
    },

    {
        id: 28,
        name: 'Cloud Walker',
        chapter: 4,
        chapterLevel: 7,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.500,

        theme: {
            primary: 'sunset',
            overlays: ['ice-temple', 'moonrise-summit'],
            transitionIn: 'warp',
            transitionDuration: 4500,
        },

        mechanics: {
            baseMode: 'hybrid',

            board: {
                columns: 10,
                rows: 24,
                startingRows: 8,
            },

            speed: {
                startLevel: 10,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 4,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 50000,
            },
            failure: {
                type: 'time',
                value: 300,
            },
            bonuses: [
                { type: 'cascade', target: 12, description: 'Trigger 12 cascades' },
                { type: 'tetris-count', target: 10, description: 'Clear 10 Quads' },
                { type: 'time', target: 180, description: 'Complete in under 3 minutes' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier', 'time-attack'],
        },

        stars: {
            one: { score: 50000 },
            two: { score: 70000, cascades: 10 },
            three: { score: 100000, cascades: 15, tetrises: 12 },
        },

        metadata: {
            description: 'Reach the summit and transcend the mountains. Only sky awaits above.',
            difficulty: 9,
            tip: 'Everything you\'ve learned comes together here. Trust your skills.',
        },
    },

    {
        id: 29,
        name: 'Aurora Dreams',
        chapter: 4,
        chapterLevel: 8,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.519,

        theme: {
            primary: 'starlight',
            overlays: [],
            transitionIn: 'warp',
            transitionDuration: 4500,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 7,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 45,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'no-singles', description: 'No single line clears' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            one: { lines: 45 },
            two: { lines: 45, time: 180 },
            three: { lines: 45, time: 120, bonuses: 1 },
        },

        metadata: {
            description: 'Step into the clouds. Gravity loosens as you enter the sky realm.',
            difficulty: 6,
            tip: 'Feel the lightness - pieces seem to float.',
        },
    },

    {
        id: 30,
        name: 'Starlight Path',
        chapter: 4,
        chapterLevel: 9,
        isChapterStart: false,
        isChapterEnd: true,
        pathPosition: 0.537,

        theme: {
            primary: 'ice-temple',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 4000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 8,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 22000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'tetris-count', target: 7, description: 'Clear 7 Quads' },
                { type: 'combo', target: 5, description: 'Reach 5x combo' },
            ],
        },

        modifiers: {
            active: ['combo-multiplier'],
        },

        stars: {
            one: { score: 22000 },
            two: { score: 32000, tetrises: 5 },
            three: { score: 45000, tetrises: 9, combo: 7 },
        },

        metadata: {
            description: 'Dance beneath the northern lights. Build combos like waves of color.',
            difficulty: 7,
            tip: 'The aurora pulses with your combos - keep them flowing!',
        },
    },

    {
        id: 31,
        name: 'Rainy Window',
        chapter: 5,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        pathPosition: 0.556,

        theme: {
            primary: 'nimbus-veil',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 26,
                startingRows: 8,
            },

            speed: {
                startLevel: 7,
                levelProgression: false,
                fixedDropInterval: 600,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 12,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 5, description: 'Trigger a 5+ chain' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade'],
        },

        stars: {
            one: { cascades: 12 },
            two: { cascades: 12, maxCascadeDepth: 5 },
            three: { cascades: 15, maxCascadeDepth: 6 },
        },

        metadata: {
            description: 'Follow the path of stars. Create cascading constellations.',
            difficulty: 7,
            tip: 'Stars cascade like dominoes - set them up carefully.',
        },
    },

    {
        id: 32,
        name: 'Storm Surge',
        chapter: 5,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.574,

        theme: {
            primary: 'rainy-window',
            overlays: ['rainy-window'],
            transitionIn: 'crossfade',
            transitionDuration: 2500,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 10,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 3,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 55,
            },
            failure: {
                type: 'time',
                value: 180,
            },
            bonuses: [
                { type: 'time', target: 120, description: 'Complete in under 2 minutes' },
            ],
        },

        modifiers: {
            active: ['time-attack'],
        },

        stars: {
            one: { lines: 55 },
            two: { lines: 55, time: 150 },
            three: { lines: 55, time: 100 },
        },

        metadata: {
            description: 'A storm rages! Navigate the turbulence at maximum speed.',
            difficulty: 8,
            tip: 'The storm pushes you faster - embrace the chaos!',
        },
    },

    {
        id: 33,
        name: 'Ethereal Heights',
        chapter: 5,
        chapterLevel: 3,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.593,

        theme: {
            primary: 'aether-tides',
            overlays: ['nimbus-veil'],
            transitionIn: 'crossfade',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'hybrid',

            board: {
                columns: 10,
                rows: 26,
                startingRows: 8,
            },

            speed: {
                startLevel: 8,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 35000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'cascade', target: 10, description: 'Trigger 10 cascades' },
                { type: 'tetris-count', target: 8, description: 'Clear 8 Quads' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            one: { score: 35000 },
            two: { score: 50000, cascades: 8 },
            three: { score: 70000, cascades: 12, tetrises: 10 },
        },

        metadata: {
            description: 'Float among ethereal lights. Combine cascades and combos for transcendence.',
            difficulty: 8,
            tip: 'The aurora responds to your cascades - make them spectacular!',
        },
    },

    {
        id: 34,
        name: 'Cosmic Threshold',
        chapter: 5,
        chapterLevel: 4,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.611,

        theme: {
            primary: 'solar-eclipse',
            overlays: ['aurora'],
            transitionIn: 'crossfade',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 30,
                startingRows: 12,
            },

            speed: {
                startLevel: 9,
                levelProgression: false,
                fixedDropInterval: 500,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 18,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 7, description: 'Trigger a 7+ chain' },
                { type: 'combo', target: 10, description: 'Reach 10x combo' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            // 1 star: Trigger 18 cascades
            one: { cascades: 18 },
            // 2 stars: 18 cascades + 5-deep chain
            two: { cascades: 18, maxCascadeDepth: 5 },
            // 3 stars: 20 cascades + 6-deep chain + 8x combo (use victory lap)
            three: { cascades: 20, maxCascadeDepth: 6, combo: 8 },
        },

        metadata: {
            description: 'Trigger 18 cascades at the edge of space. Build tall for chain reactions!',
            difficulty: 9,
            tip: 'The 30-row board with 12 starting rows creates cascade opportunities. Build upward! Keep playing after goal for more stars.',
        },
    },

    {
        id: 35,
        name: 'Atmosphere\'s End',
        chapter: 5,
        chapterLevel: 5,
        isChapterStart: false,
        isChapterEnd: true,
        pathPosition: 0.630,

        theme: {
            primary: 'lunara',
            overlays: ['starlight', 'nimbus-veil'],
            transitionIn: 'warp',
            transitionDuration: 5000,
        },

        mechanics: {
            baseMode: 'hybrid',

            board: {
                columns: 10,
                rows: 24,
                startingRows: 8,
            },

            speed: {
                startLevel: 11,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 4,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 60000,
            },
            failure: {
                type: 'time',
                value: 300,
            },
            bonuses: [
                { type: 'cascade', target: 15, description: 'Trigger 15 cascades' },
                { type: 'tetris-count', target: 12, description: 'Clear 12 Quads' },
                { type: 'time', target: 180, description: 'Complete in under 3 minutes' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier', 'time-attack'],
        },

        stars: {
            one: { score: 60000 },
            two: { score: 85000, cascades: 12 },
            three: { score: 120000, cascades: 18, tetrises: 15 },
        },

        metadata: {
            description: 'Leave the atmosphere behind. Space awaits beyond the aurora\'s final dance.',
            difficulty: 9,
            tip: 'This is the gateway to space. Give everything you have!',
        },
    },

    {
        id: 36,
        name: 'Galaxy Core',
        chapter: 6,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        pathPosition: 0.648,

        theme: {
            primary: 'galaxy',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 4000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 4,
            },

            speed: {
                startLevel: 9,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 4,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 30000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'tetris-count', target: 8, description: 'Clear 8 Quads' },
                { type: 'combo', target: 6, description: 'Reach 6x combo' },
            ],
        },

        modifiers: {
            active: ['combo-multiplier'],
        },

        stars: {
            one: { score: 30000 },
            two: { score: 45000, tetrises: 6 },
            three: { score: 65000, tetrises: 10, combo: 8 },
        },

        metadata: {
            description: 'Journey to the heart of a galaxy. Build score among swirling stars.',
            difficulty: 8,
            tip: 'The galaxy spirals with your combos - keep the rhythm!',
        },
    },

    {
        id: 37,
        name: 'Astral Weave',
        chapter: 6,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.667,

        theme: {
            primary: 'cosmic-noir',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 28,
                startingRows: 10,
            },

            speed: {
                startLevel: 8,
                levelProgression: false,
                fixedDropInterval: 550,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 15,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 6, description: 'Trigger a 6+ chain' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade'],
        },

        stars: {
            one: { cascades: 15 },
            two: { cascades: 15, maxCascadeDepth: 6 },
            three: { cascades: 18, maxCascadeDepth: 7 },
        },

        metadata: {
            description: 'Weave through astral threads. Create cascading patterns of cosmic energy.',
            difficulty: 8,
            tip: 'The astral threads guide cascade patterns - follow them.',
        },
    },

    {
        id: 38,
        name: 'Lunar Eclipse',
        chapter: 6,
        chapterLevel: 3,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.685,

        theme: {
            primary: 'supernova',
            overlays: ['blood-moon'],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 8,
            },

            speed: {
                startLevel: 10,
                levelProgression: false,
                fixedDropInterval: 450,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 3,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 35,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'time', target: 90, description: 'Complete in under 90 seconds' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            // 1 star: Clear 35 lines
            one: { lines: 35 },
            // 2 stars: Clear 35 lines in under 2 minutes
            two: { lines: 35, time: 120 },
            // 3 stars: Clear 35 lines in 90s (adjusted from 75s - more achievable with garbage + fast speed)
            three: { lines: 35, time: 90 },
        },

        metadata: {
            description: 'Clear 35 lines under the blood moon! 8 rows of garbage and fast drops.',
            difficulty: 8,
            tip: 'Fast 450ms drops with garbage - work quickly but stay calm. Every line counts!',
        },
    },

    {
        id: 39,
        name: 'Solar Eclipse',
        chapter: 6,
        chapterLevel: 4,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.704,

        theme: {
            primary: 'blood-moon',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'hybrid',

            board: {
                columns: 10,
                rows: 24,
                startingRows: 8,
            },

            speed: {
                startLevel: 10,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 4,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 45000,
            },
            failure: {
                type: 'time',
                value: 240,
            },
            bonuses: [
                { type: 'cascade', target: 10, description: 'Trigger 10 cascades' },
                { type: 'tetris-count', target: 10, description: 'Clear 10 Quads' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier', 'time-attack'],
        },

        stars: {
            one: { score: 45000 },
            two: { score: 65000, cascades: 8 },
            three: { score: 90000, cascades: 12, tetrises: 12 },
        },

        metadata: {
            description: 'The sun hides behind the moon. Play in the shadow of totality.',
            difficulty: 9,
            tip: 'The eclipse shadow reveals hidden cascade opportunities.',
        },
    },

    {
        id: 40,
        name: 'Supernova',
        chapter: 6,
        chapterLevel: 5,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.722,

        theme: {
            primary: 'astral-weave',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 11,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 4,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 80000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'tetris-count', target: 12, description: 'Clear 12 Quads' },
                { type: 'combo', target: 8, description: 'Reach 8x combo' },
            ],
        },

        modifiers: {
            active: ['combo-multiplier'],
        },

        stars: {
            one: { score: 80000 },
            two: { score: 120000, tetrises: 10 },
            three: { score: 180000, tetrises: 15, combo: 10 },
        },

        metadata: {
            description: 'A dying star explodes. Capture the energy in your score.',
            difficulty: 10,
            tip: 'The supernova energy fuels your combo multiplier.',
        },
    },

    {
        id: 41,
        name: 'Stellar Shockwave',
        chapter: 6,
        chapterLevel: 6,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.741,

        theme: {
            primary: 'astral-weave',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 12,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 3,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 60,
            },
            failure: {
                type: 'time',
                value: 180,
            },
            bonuses: [
                { type: 'tetris-count', target: 10, description: 'Clear 10 Quads' },
                { type: 'time', target: 140, description: 'Finish with 40+ seconds left' },
            ],
        },

        modifiers: {
            active: ['time-attack', 'combo-multiplier'],
        },

        stars: {
            // 1 star: Clear 60 lines before time runs out
            one: { lines: 60 },
            // 2 stars: Clear 60 lines + get 8 tetrises (efficient clearing)
            two: { lines: 60, tetrises: 8 },
            // 3 stars: Clear 60 lines + 12 tetrises + finish fast (use victory lap for extras)
            three: { lines: 60, tetrises: 12, time: 120 },
        },

        metadata: {
            description: 'Race the expanding shockwave! Clear 60 lines before time runs out.',
            difficulty: 9,
            tip: 'Speed is critical - use Quads (4-line clears) for maximum efficiency. Keep playing after goal for more stars!',
        },
    },

    {
        id: 42,
        name: 'Event Horizon',
        chapter: 6,
        chapterLevel: 7,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.759,

        theme: {
            primary: 'stellar-velocity',
            overlays: ['galaxy', 'stellar-velocity'],
            transitionIn: 'warp',
            transitionDuration: 5000,
        },

        mechanics: {
            baseMode: 'hybrid',

            board: {
                columns: 10,
                rows: 24,
                startingRows: 10,
            },

            speed: {
                startLevel: 13,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 4,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 80000,
            },
            failure: {
                type: 'time',
                value: 300,
            },
            bonuses: [
                { type: 'cascade', target: 18, description: 'Trigger 18 cascades' },
                { type: 'tetris-count', target: 15, description: 'Clear 15 Quads' },
                { type: 'time', target: 180, description: 'Complete in under 3 minutes' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier', 'time-attack'],
        },

        stars: {
            one: { score: 80000 },
            two: { score: 120000, cascades: 15 },
            three: { score: 180000, cascades: 22, tetrises: 18 },
        },

        metadata: {
            description: 'Approach the event horizon. Beyond lies the point of no return.',
            difficulty: 10,
            tip: 'Everything you\'ve learned leads to this. Trust your instincts.',
        },
    },

    {
        id: 43,
        name: 'Singularity Gate',
        chapter: 6,
        chapterLevel: 8,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.778,

        theme: {
            primary: 'cosmic-chimes',
            overlays: [],
            transitionIn: 'warp',
            transitionDuration: 5000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 10,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 55,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'no-singles', description: 'No single line clears' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            one: { lines: 55 },
            two: { lines: 55, time: 180 },
            three: { lines: 55, time: 120, bonuses: 1 },
        },

        metadata: {
            description: 'Enter the gate to singularity. Reality begins to distort around you.',
            difficulty: 8,
            tip: 'The black hole pulls at everything - stay centered.',
        },
    },

    {
        id: 44,
        name: 'The Singularity',
        chapter: 6,
        chapterLevel: 9,
        isChapterStart: false,
        isChapterEnd: true,
        pathPosition: 0.796,

        theme: {
            primary: 'black-hole',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 4000,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 28,
                startingRows: 10,
            },

            speed: {
                startLevel: 9,
                levelProgression: false,
                fixedDropInterval: 500,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 18,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 7, description: 'Trigger a 7+ chain' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade'],
        },

        stars: {
            // 1 star: Trigger 18 cascades
            one: { cascades: 18 },
            // 2 stars: 18 cascades + 6-deep chain
            two: { cascades: 18, maxCascadeDepth: 6 },
            // 3 stars: 20 cascades + 7-deep chain (use victory lap for 2 extra)
            three: { cascades: 20, maxCascadeDepth: 7 },
        },

        metadata: {
            description: 'Chapter 6 finale! Trigger 18 cascades at the singularity.',
            difficulty: 9,
            tip: 'The 28-row board is your canvas for massive chain reactions. Build tall and let gravity do the work! Keep playing after goal for more stars.',
        },
    },

    {
        id: 45,
        name: 'Fluid Dreams',
        chapter: 7,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        pathPosition: 0.815,

        theme: {
            primary: 'fluid-dreams',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 4000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 11,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 4,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 40000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'tetris-count', target: 12, description: 'Clear 12 Quads' },
                { type: 'combo', target: 8, description: 'Reach 8x combo' },
            ],
        },

        modifiers: {
            active: ['combo-multiplier'],
        },

        stars: {
            one: { score: 40000 },
            two: { score: 60000, tetrises: 10 },
            three: { score: 85000, tetrises: 15, combo: 10 },
        },

        metadata: {
            description: 'Reality becomes fluid. Build score in the realm of dreams.',
            difficulty: 9,
            tip: 'In dreams, combos flow endlessly - let them.',
        },
    },

    {
        id: 46,
        name: 'Nebula Flow',
        chapter: 7,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.833,

        theme: {
            primary: 'nebula-flow',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'hybrid',

            board: {
                columns: 10,
                rows: 26,
                startingRows: 10,
            },

            speed: {
                startLevel: 11,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 4,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 55000,
            },
            failure: {
                type: 'time',
                value: 240,
            },
            bonuses: [
                { type: 'cascade', target: 12, description: 'Trigger 12 cascades' },
                { type: 'tetris-count', target: 10, description: 'Clear 10 Quads' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier', 'time-attack'],
        },

        stars: {
            one: { score: 55000 },
            two: { score: 80000, cascades: 10 },
            three: { score: 110000, cascades: 15, tetrises: 12 },
        },

        metadata: {
            description: 'Colors splash across the void. Paint with cascades and combos.',
            difficulty: 9,
            tip: 'Each cascade paints a new color - make it a masterpiece.',
        },
    },

    {
        id: 47,
        name: 'Chromadelic Highway',
        chapter: 7,
        chapterLevel: 3,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.852,

        theme: {
            primary: 'chromadelic-highway',
            overlays: ['voltage-storm'],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 8,
            },

            speed: {
                startLevel: 13,
                levelProgression: false,
                fixedDropInterval: 400,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 3,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 40,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'time', target: 90, description: 'Complete in under 90 seconds' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            // 1 star: Clear 40 lines
            one: { lines: 40 },
            // 2 stars: Clear 40 lines in under 2 minutes
            two: { lines: 40, time: 120 },
            // 3 stars: Clear 40 lines in 100s (adjusted from 75s - more realistic at 400ms drops)
            three: { lines: 40, time: 100 },
        },

        metadata: {
            description: 'Clear 40 lines on the chromadelic highway! Ultra-fast 400ms drops.',
            difficulty: 9,
            tip: 'At level 13 speed with 400ms drops, trust your reflexes. Fast but clean stacking wins!',
        },
    },

    {
        id: 48,
        name: 'Voltage Storm',
        chapter: 7,
        chapterLevel: 4,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.870,

        theme: {
            primary: 'voltage-storm',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 32,
                startingRows: 16,
            },

            speed: {
                startLevel: 11,
                levelProgression: false,
                fixedDropInterval: 450,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'cascade',
                target: 25,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 10, description: 'Trigger a 10+ chain' },
                { type: 'combo', target: 15, description: 'Reach 15x combo' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            // 1 star: Trigger 25 cascades
            one: { cascades: 25 },
            // 2 stars: 25 cascades + 7-deep chain
            two: { cascades: 25, maxCascadeDepth: 7 },
            // 3 stars: 27 cascades + 8-deep chain + 10x combo (challenging but achievable)
            three: { cascades: 27, maxCascadeDepth: 8, combo: 10 },
        },

        metadata: {
            description: 'Harness the voltage! Trigger 25 cascades on the massive 32-row storm board.',
            difficulty: 10,
            tip: 'With 16 starting rows and 32 total rows, this board is built for epic cascades. Build strategically! Keep playing after goal for more stars.',
        },
    },

    {
        id: 49,
        name: 'Chromatic Impasto',
        chapter: 7,
        chapterLevel: 5,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.889,

        theme: {
            primary: 'chromatic-impasto',
            overlays: ['electric-dreams'],
            transitionIn: 'crossfade',
            transitionDuration: 3000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 0,
            },

            speed: {
                startLevel: 15,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 3,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 70,
            },
            failure: {
                type: 'time',
                value: 180,
            },
            bonuses: [
                { type: 'tetris-count', target: 15, description: 'Clear 15 Quads' },
                { type: 'time', target: 120, description: 'Complete in under 2 minutes' },
            ],
        },

        modifiers: {
            active: ['time-attack', 'combo-multiplier'],
        },

        stars: {
            one: { lines: 70 },
            two: { lines: 70, tetrises: 12 },
            three: { lines: 70, tetrises: 18, time: 100 },
        },

        metadata: {
            description: 'The ultimate speed challenge. Maximum intensity before transcendence.',
            difficulty: 10,
            tip: 'This is the storm before the calm. Give everything!',
        },
    },

    {
        id: 50,
        name: 'Electric Dreams',
        chapter: 7,
        chapterLevel: 6,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.907,

        theme: {
            primary: 'electric-dreams',
            overlays: ['black-hole', 'nebula-flow', 'fluid-dreams'],
            transitionIn: 'warp',
            transitionDuration: 6000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 8,
            },

            speed: {
                startLevel: 13,
                levelProgression: false,
                fixedDropInterval: 400,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 3,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 40,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'time', target: 90, description: 'Complete in under 90 seconds' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            // 1 star: Clear 40 lines
            one: { lines: 40 },
            // 2 stars: Clear 40 lines in under 2 minutes
            two: { lines: 40, time: 120 },
            // 3 stars: Clear 40 lines in 100s (adjusted - with cascade physics this is more achievable)
            three: { lines: 40, time: 100 },
        },

        metadata: {
            description: 'Clear 40 lines in an electric dreamscape! Cascades and combos active.',
            difficulty: 9,
            tip: 'Gravity cascades are active - use them to chain clears for faster progress!',
        },
    },

    {
        id: 51,
        name: 'Singularity Void',
        chapter: 7,
        chapterLevel: 7,
        isChapterStart: false,
        isChapterEnd: true,
        pathPosition: 0.926,

        theme: {
            primary: 'singing-bowl',
            overlays: ['electric-dreams', 'black-hole'],
            transitionIn: 'warp',
            transitionDuration: 6000,
        },

        mechanics: {
            baseMode: 'infinity',

            board: {
                columns: 10,
                rows: 100,
                startingRows: 30,
            },

            speed: {
                startLevel: 12,
                levelProgression: false,
                fixedDropInterval: 500,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 250000,
            },
            failure: {
                type: 'time',
                value: 480,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 10, description: 'Trigger a 10-chain cascade' },
                { type: 'cascade', target: 30, description: 'Trigger 30 cascades' },
                { type: 'tetris-count', target: 20, description: 'Clear 20 Quads' },
                { type: 'combo', target: 18, description: 'Reach 18x combo' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            one: { score: 250000 },
            two: { score: 350000, cascades: 25, maxCascadeDepth: 6 },
            three: {
                score: 500000, cascades: 35, maxCascadeDepth: 10, combo: 18,
            },
        },

        metadata: {
            description: 'The final abstract challenge. Build epic towers on a 100-row board and trigger legendary cascades.',
            difficulty: 10,
            tip: 'Use the full height of the board. The bigger the tower, the greater the cascade!',
        },
    },

    {
        id: 52,
        name: 'Neon Dunes',
        chapter: 8,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        pathPosition: 0.944,

        theme: {
            primary: 'shifting-sands',
            overlays: [],
            transitionIn: 'warp',
            transitionDuration: 2000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 4,
            },

            speed: {
                startLevel: 6,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 50,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'tetris-count', target: 8, description: 'Clear 8 Quads' },
                { type: 'combo', target: 8, description: 'Reach 8x combo' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            one: { lines: 50 },
            two: { lines: 50, tetrises: 6, time: 240 },
            three: {
                lines: 50, tetrises: 8, combo: 8, time: 180,
            },
        },

        metadata: {
            description: 'Rain patters against the window as you fall into a meditative rhythm. The city lights blur in the droplets.',
            difficulty: 6,
            tip: 'Let the rain guide your pace. Steady, rhythmic play wins this level.',
        },
    },

    {
        id: 53,
        name: 'Neon Dusk',
        chapter: 8,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.963,

        theme: {
            primary: 'neon-dusk',
            overlays: [],
            transitionIn: 'warp',
            transitionDuration: 2000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 6,
            },

            speed: {
                startLevel: 7,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 80000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'cascade', target: 15, description: 'Trigger 15 cascades' },
                { type: 'combo', target: 10, description: 'Reach 10x combo' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade'],
        },

        stars: {
            one: { score: 80000 },
            two: { score: 100000, cascades: 10, time: 300 },
            three: {
                score: 120000, cascades: 15, combo: 10, time: 240,
            },
        },

        metadata: {
            description: 'The sun sets behind towering skyscrapers as neon signs flicker to life. The city awakens.',
            difficulty: 7,
            tip: 'Use cascade gravity to chain reactions. The neon lights reward bold plays.',
        },
    },

    {
        id: 54,
        name: 'Electric Nights',
        chapter: 8,
        chapterLevel: 3,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.981,

        theme: {
            primary: 'synthwave-sunset',
            overlays: [],
            transitionIn: 'warp',
            transitionDuration: 2000,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 8,
            },

            speed: {
                startLevel: 8,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'lines',
                target: 60,
            },
            failure: {
                type: 'time',
                value: 300,
            },
            bonuses: [
                { type: 'tetris-count', target: 12, description: 'Clear 12 Quads' },
                { type: 'max-cascade-depth', target: 5, description: 'Trigger a 5-chain cascade' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            one: { lines: 60 },
            two: { lines: 60, tetrises: 10, cascades: 8 },
            three: {
                lines: 60, tetrises: 12, maxCascadeDepth: 5, time: 240,
            },
        },

        metadata: {
            description: 'Deep in the neon district, holographic billboards pulse with light. Speed and precision are everything.',
            difficulty: 8,
            tip: 'The time limit is strict. Focus on efficient four-line clears to meet your target.',
        },
    },

    {
        id: 55,
        name: 'Electric Apex',
        chapter: 8,
        chapterLevel: 4,
        isChapterStart: false,
        isChapterEnd: true,
        pathPosition: 1.000,

        theme: {
            primary: 'neon-district',
            overlays: [],
            transitionIn: 'warp',
            transitionDuration: 2500,
        },

        mechanics: {
            baseMode: 'standard',

            board: {
                columns: 10,
                rows: 20,
                startingRows: 10,
            },

            speed: {
                startLevel: 9,
                levelProgression: true,
                fixedDropInterval: null,
            },

            pieces: {
                bagType: '7-bag',
                customSequence: null,
                previewCount: 5,
            },
        },

        victory: {
            primary: {
                type: 'score',
                target: 150000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'cascade', target: 25, description: 'Trigger 25 cascades' },
                { type: 'max-cascade-depth', target: 7, description: 'Trigger a 7-chain cascade' },
                { type: 'combo', target: 12, description: 'Reach 12x combo' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            one: { score: 150000 },
            two: { score: 180000, cascades: 20, combo: 10 },
            three: {
                score: 220000, cascades: 25, maxCascadeDepth: 7, combo: 12,
            },
        },

        metadata: {
            description: 'The ultimate urban challenge. Retro-futuristic sun sets over chrome mountains as you push for the high score.',
            difficulty: 9,
            tip: 'This is the bonus chapter finale. Go for glory with maximum cascade chains!',
        },
    },
];

/* eslint-disable object-curly-newline -- Compact one-row pacing table. */
const LEVEL_PHASE2_TAGS = Object.freeze({
    1: { role: 'arrival', mechanicFocus: 'lines', emotionalBeat: 'wonder', victoryLapPolicy: 'none' },
    2: { role: 'teach', mechanicFocus: 'cascade', emotionalBeat: 'wonder', victoryLapPolicy: 'none' },
    3: { role: 'reinforce', mechanicFocus: 'cascade', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    4: { role: 'test', mechanicFocus: 'sprint', emotionalBeat: 'tension', victoryLapPolicy: 'none' },
    5: { role: 'boss', mechanicFocus: 'hybrid', emotionalBeat: 'awe', victoryLapPolicy: 'none' },
    6: { role: 'arrival', mechanicFocus: 'dig', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    7: { role: 'teach', mechanicFocus: 'cascade', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    8: { role: 'reinforce', mechanicFocus: 'lines', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    9: { role: 'reinforce', mechanicFocus: 'score', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    10: { role: 'release', mechanicFocus: 'lines', emotionalBeat: 'release', victoryLapPolicy: 'none' },
    11: { role: 'boss', mechanicFocus: 'cascade', emotionalBeat: 'awe', victoryLapPolicy: 'none' },
    12: { role: 'arrival', mechanicFocus: 'lines', emotionalBeat: 'wonder', victoryLapPolicy: 'none' },
    13: { role: 'teach', mechanicFocus: 'lines', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    14: { role: 'reinforce', mechanicFocus: 'score', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    15: { role: 'teach', mechanicFocus: 'cascade', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    16: { role: 'test', mechanicFocus: 'sprint', emotionalBeat: 'tension', victoryLapPolicy: 'none' },
    17: { role: 'test', mechanicFocus: 'hybrid', emotionalBeat: 'awe', victoryLapPolicy: 'none' },
    18: { role: 'release', mechanicFocus: 'lines', emotionalBeat: 'release', victoryLapPolicy: 'none' },
    19: { role: 'boss', mechanicFocus: 'cascade', emotionalBeat: 'awe', victoryLapPolicy: 'none' },
    20: { role: 'arrival', mechanicFocus: 'hybrid', emotionalBeat: 'wonder', victoryLapPolicy: 'none' },
    21: { role: 'teach', mechanicFocus: 'cascade', emotionalBeat: 'awe', victoryLapPolicy: 'none' },
    22: { role: 'reinforce', mechanicFocus: 'score', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    23: { role: 'reinforce', mechanicFocus: 'cascade', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    24: { role: 'test', mechanicFocus: 'sprint', emotionalBeat: 'tension', victoryLapPolicy: 'none' },
    25: { role: 'release', mechanicFocus: 'score', emotionalBeat: 'release', victoryLapPolicy: 'none' },
    26: { role: 'test', mechanicFocus: 'dig', emotionalBeat: 'tension', victoryLapPolicy: 'none' },
    27: { role: 'boss', mechanicFocus: 'cascade', emotionalBeat: 'awe', victoryLapPolicy: 'none' },
    28: { role: 'arrival', mechanicFocus: 'hybrid', emotionalBeat: 'awe', victoryLapPolicy: 'none' },
    29: { role: 'release', mechanicFocus: 'lines', emotionalBeat: 'release', victoryLapPolicy: 'none' },
    30: { role: 'reinforce', mechanicFocus: 'score', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    31: { role: 'reinforce', mechanicFocus: 'cascade', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    32: { role: 'test', mechanicFocus: 'sprint', emotionalBeat: 'tension', victoryLapPolicy: 'none' },
    33: { role: 'reinforce', mechanicFocus: 'hybrid', emotionalBeat: 'awe', victoryLapPolicy: 'none' },
    34: { role: 'boss', mechanicFocus: 'cascade', emotionalBeat: 'transcendence', victoryLapPolicy: 'showcase' },
    35: { role: 'boss', mechanicFocus: 'hybrid', emotionalBeat: 'transcendence', victoryLapPolicy: 'none' },
    36: { role: 'arrival', mechanicFocus: 'score', emotionalBeat: 'awe', victoryLapPolicy: 'none' },
    37: { role: 'teach', mechanicFocus: 'cascade', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    38: { role: 'reinforce', mechanicFocus: 'dig', emotionalBeat: 'tension', victoryLapPolicy: 'none' },
    39: { role: 'test', mechanicFocus: 'hybrid', emotionalBeat: 'tension', victoryLapPolicy: 'none' },
    40: { role: 'test', mechanicFocus: 'score', emotionalBeat: 'panic', victoryLapPolicy: 'none' },
    41: { role: 'test', mechanicFocus: 'sprint', emotionalBeat: 'panic', victoryLapPolicy: 'none' },
    42: { role: 'boss', mechanicFocus: 'hybrid', emotionalBeat: 'panic', victoryLapPolicy: 'none' },
    43: { role: 'release', mechanicFocus: 'lines', emotionalBeat: 'release', victoryLapPolicy: 'none' },
    44: { role: 'boss', mechanicFocus: 'cascade', emotionalBeat: 'transcendence', victoryLapPolicy: 'showcase' },
    45: { role: 'arrival', mechanicFocus: 'score', emotionalBeat: 'awe', victoryLapPolicy: 'none' },
    46: { role: 'reinforce', mechanicFocus: 'hybrid', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    47: { role: 'test', mechanicFocus: 'sprint', emotionalBeat: 'panic', victoryLapPolicy: 'none' },
    48: { role: 'boss', mechanicFocus: 'cascade', emotionalBeat: 'panic', victoryLapPolicy: 'none' },
    49: { role: 'test', mechanicFocus: 'sprint', emotionalBeat: 'panic', victoryLapPolicy: 'none' },
    50: { role: 'release', mechanicFocus: 'lines', emotionalBeat: 'release', victoryLapPolicy: 'none' },
    51: { role: 'boss', mechanicFocus: 'hybrid', emotionalBeat: 'transcendence', victoryLapPolicy: 'showcase' },
    52: { role: 'encore', mechanicFocus: 'lines', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    53: { role: 'encore', mechanicFocus: 'score', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    54: { role: 'encore', mechanicFocus: 'hybrid', emotionalBeat: 'tension', victoryLapPolicy: 'none' },
    55: { role: 'encore', mechanicFocus: 'hybrid', emotionalBeat: 'transcendence', victoryLapPolicy: 'showcase' },
});
/* eslint-enable object-curly-newline */

const LEVEL_PHASE2_OVERRIDES = Object.freeze({
    1: {
        // Full triple authored so the derived "more lines" tiers don't outrank the
        // hand-tuned time/quality tiers (keeps 1<=2<=3 monotonic on the lines axis).
        stars: {
            one: { lines: 20 },
            two: { lines: 20, time: 150 },
            three: { lines: 20, time: 120, bonuses: 1 },
        },
        metadata: {
            description: 'Clear 20 lines to begin the odyssey. A gentle opening that teaches calm stacking.',
            tip: 'Build flat stacks and favor doubles and triples. Clean structure matters more than speed here.',
        },
    },
    2: {
        // First cascade teach: hold the gentle authored target (3) instead of the
        // model's floor-rounded 4 so 1*/2*/3* stay monotonic.
        victory: {
            primary: {
                target: 3,
            },
        },
        stars: {
            one: { cascades: 3 },
            two: { cascades: 3, maxCascadeDepth: 2 },
            three: { cascades: 4, maxCascadeDepth: 3 },
        },
        metadata: {
            tip: 'Build towers with gaps so each clear drops into the next. Consistent small chains matter more than one huge gamble.',
        },
    },
    3: {
        // Cascade reinforce: tiers share the count (4) and escalate on chain depth.
        victory: {
            primary: {
                target: 4,
            },
        },
        stars: {
            one: { cascades: 4 },
            two: { cascades: 4, maxCascadeDepth: 2 },
            three: { cascades: 4, maxCascadeDepth: 3 },
        },
        metadata: {
            tip: 'Build layered shelves rather than one narrow tower. Reliable chain starts are the goal here.',
        },
    },
    5: {
        isChapterEnd: true,
        victory: {
            primary: {
                target: 40,
            },
        },
        stars: {
            one: { lines: 40 },
            two: { lines: 40, cascades: 2 },
            three: { lines: 40, cascades: 3, bonuses: 1 },
        },
        metadata: {
            tip: 'Use the starting rows to seed controlled cascades, then finish on clean line clears. Mastery here should happen in one composed run.',
        },
    },
    6: {
        mechanics: {
            board: {
                startingRows: 5,
            },
            speed: {
                startLevel: 4,
                fixedDropInterval: 800,
            },
            pieces: {
                previewCount: 4,
            },
        },
        victory: {
            bonuses: [
                { type: 'tetris-count', target: 2, description: 'Clear 2 Quads' },
            ],
        },
        stars: {
            one: { lines: 20 },
            two: { lines: 20, tetrises: 1 },
            three: { lines: 20, tetrises: 2, time: 150 },
        },
        metadata: {
            description: 'Pressure builds slowly as you enter the deeper water. Dig a clean route through the opening stack, then settle in.',
            difficulty: 3,
            tip: 'Use your first clears to make breathing room, then stabilize before you chase big clears.',
        },
    },
    7: {
        mechanics: {
            board: {
                rows: 28,
                startingRows: 8,
            },
            speed: {
                fixedDropInterval: 800,
            },
        },
        victory: {
            primary: {
                target: 7,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 3, description: 'Trigger a 3+ chain cascade' },
            ],
        },
        modifiers: {
            active: ['gravity-cascade'],
        },
        stars: {
            one: { cascades: 7 },
            two: { cascades: 7, maxCascadeDepth: 3 },
            three: { cascades: 9, maxCascadeDepth: 4 },
        },
        metadata: {
            description: 'Build layered reef structures and let the current pull them apart in cascading waves.',
            difficulty: 4,
            tip: 'Create staggered shelves instead of tall spikes. Reliable two- and three-step chains beat risky mega-builds.',
        },
    },
    8: {
        victory: {
            primary: {
                target: 35,
            },
        },
        stars: {
            one: { lines: 35 },
            two: { lines: 35, time: 190 },
            three: { lines: 35, time: 135, bonuses: 1 },
        },
        metadata: {
            description: 'The ocean opens into a calm, luminous lane. Use the slower rhythm to rebuild precision.',
            difficulty: 4,
            tip: 'Treat this as a reset level. Look ahead, flatten the stack, and win through efficiency.',
        },
    },
    9: {
        victory: {
            primary: {
                target: 14000,
            },
        },
        stars: {
            one: { score: 14000 },
            two: { score: 20000, tetrises: 2 },
            three: { score: 28000, tetrises: 4, combo: 4 },
        },
        metadata: {
            difficulty: 5,
            description: 'Still water rewards smooth rhythm. Chain clean clears together and let the score climb naturally.',
            tip: 'Use consecutive efficient clears to keep momentum alive. This is a flow score level, not a survival test.',
        },
    },
    10: {
        victory: {
            primary: {
                target: 36,
            },
        },
        stars: {
            one: { lines: 36 },
            two: { lines: 36, bonuses: 1 },
            three: { lines: 36, bonuses: 2 },
        },
        metadata: {
            difficulty: 4,
            description: 'A still pocket in the deep. Slow speed and a long preview let you shape deliberate, elegant clears.',
            tip: 'Do not force speed here. Use the long preview to set up the exact board you want.',
        },
    },
    11: {
        metadata: {
            difficulty: 6,
            description: 'The chapter closes in a graceful rush. Build tall, flowing chains and finish the ocean on confident cascade control.',
        },
    },
    12: {
        mechanics: {
            speed: {
                startLevel: 3,
            },
            pieces: {
                previewCount: 6,
            },
        },
        victory: {
            primary: {
                target: 32,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'no-singles', description: 'Clear no single lines' },
            ],
        },
        modifiers: {
            active: [],
        },
        stars: {
            one: { lines: 32 },
            two: { lines: 32, time: 190 },
            three: { lines: 32, time: 145, bonuses: 1 },
        },
        metadata: {
            description: 'You break into daylight at the forest edge. This is a reset: breathe, stack cleanly, and enjoy the wider horizon.',
            difficulty: 3,
            tip: 'Use the gentler opener to rebuild rhythm before the chapter starts mixing mechanics again.',
        },
    },
    14: {
        victory: {
            primary: {
                target: 15000,
            },
        },
        stars: {
            one: { score: 15000 },
            two: { score: 22000, tetrises: 3 },
            three: { score: 30000, tetrises: 5, combo: 5 },
        },
        metadata: {
            difficulty: 5,
            description: 'Wildflowers sway across a bright meadow. Keep your rhythm alive and let the score build naturally.',
        },
    },
    16: {
        victory: {
            primary: {
                target: 42,
            },
        },
        stars: {
            one: { lines: 42 },
            two: { lines: 42, time: 150 },
            three: { lines: 42, time: 105 },
        },
        metadata: {
            description: 'Autumn winds gather into a fast-moving storm. Clear efficiently before the harvest is blown away.',
            difficulty: 6,
            tip: 'Speed matters, but panic kills more runs than the timer. Stay compact and keep the well playable.',
        },
    },
    17: {
        victory: {
            primary: {
                target: 22000,
            },
        },
        stars: {
            one: { score: 22000 },
            two: { score: 32000, cascades: 4 },
            three: { score: 42000, cascades: 6, tetrises: 6 },
        },
        metadata: {
            description: 'Warm twilight settles over the grove. Blend cascades and Quads into one graceful summer performance.',
            tip: 'The starting rows are material, not clutter. Convert them into score before they ever become danger.',
        },
    },
    18: {
        victory: {
            primary: {
                target: 45,
            },
            bonuses: [
                { type: 'no-singles', description: 'No single line clears' },
                { type: 'tetris-count', target: 6, description: 'Clear 6 Quads' },
            ],
        },
        stars: {
            one: { lines: 45 },
            two: { lines: 45, tetrises: 4 },
            three: { lines: 45, tetrises: 6, bonuses: 2 },
        },
        metadata: {
            description: 'Golden leaves drift across open hills. End the season with patience, clean structure, and graceful lines.',
            difficulty: 5,
            tip: 'This is a release beat. Let the pace settle and win with clean board management.',
        },
    },
    19: {
        isChapterEnd: true,
    },
    20: {
        chapter: 4,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        mechanics: {
            board: {
                startingRows: 2,
            },
            speed: {
                startLevel: 5,
            },
        },
        victory: {
            primary: {
                target: 22000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'cascade', target: 6, description: 'Trigger 6 cascades' },
                { type: 'tetris-count', target: 4, description: 'Clear 4 Quads' },
            ],
        },
        modifiers: {
            active: ['combo-multiplier'],
        },
        stars: {
            one: { score: 22000 },
            two: { score: 30000, cascades: 3 },
            three: { score: 42000, cascades: 5, tetrises: 5 },
        },
        metadata: {
            description: 'The foothills rise ahead, still touched by evening color. Build momentum before the real climb begins.',
            difficulty: 5,
            tip: 'Treat the opening stack as scaffolding. Clear it cleanly, then turn the board into safe score routes.',
        },
    },
    21: {
        chapter: 4,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        mechanics: {
            board: {
                rows: 36,
                startingRows: 8,
            },
            speed: {
                fixedDropInterval: 700,
            },
        },
        victory: {
            primary: {
                target: 9,
            },
        },
        stars: {
            one: { cascades: 9 },
            two: { cascades: 9, maxCascadeDepth: 3 },
            three: { cascades: 10, maxCascadeDepth: 4 },
        },
        metadata: {
            description: 'The ridge opens into a vast vertical canvas. Use the extra height to stage elegant chain reactions.',
            difficulty: 6,
            tip: 'Tall boards reward patience. Build shelves, not spikes, so every clear feeds the next.',
        },
    },
    22: {
        chapterLevel: 3,
        isChapterStart: false,
        metadata: {
            description: 'Aurora light washes across the peaks. Build score in the thin air before the climb steepens again.',
        },
    },
    23: {
        chapterLevel: 4,
        metadata: {
            description: 'Moonlight settles over the ridge. Frozen ledges turn every clean clear into a potential avalanche.',
            tip: 'Work from the lower shelves first so the upper layers always have somewhere safe to fall.',
        },
    },
    24: {
        chapterLevel: 5,
    },
    25: {
        chapterLevel: 6,
        metadata: {
            description: 'A quiet traverse beneath the cliffs. Score matters here, but the mountain rewards restraint over panic.',
            difficulty: 6,
            tip: 'Use the calmer pace to stack for back-to-back clears instead of forcing risky rescues.',
        },
    },
    26: {
        chapterLevel: 7,
        metadata: {
            difficulty: 7,
            description: 'Thin air and a crowded field make every placement expensive. Dig quickly, then stabilize before you sprint.',
            tip: 'Half the board is already spoken for. Clear escape routes first, then decide where your quad lane will live.',
        },
    },
    27: {
        chapterLevel: 8,
        isChapterEnd: true,
    },
    28: {
        chapter: 5,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        mechanics: {
            speed: {
                startLevel: 7,
            },
        },
        victory: {
            primary: {
                target: 34000,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [
                { type: 'cascade', target: 10, description: 'Trigger 10 cascades' },
                { type: 'tetris-count', target: 8, description: 'Clear 8 Quads' },
            ],
        },
        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },
        stars: {
            one: { score: 34000 },
            two: { score: 47000, cascades: 7 },
            three: { score: 62000, cascades: 9, tetrises: 7 },
        },
        metadata: {
            description: 'The mountain finally falls away beneath you. Glide into open sky and learn the new floating rhythm.',
            difficulty: 6,
            tip: 'Use the extra height to smooth the board before you cash in on big score turns.',
        },
    },
    29: {
        chapter: 5,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        victory: {
            primary: {
                target: 42,
            },
        },
        stars: {
            one: { lines: 42 },
            two: { lines: 42, time: 190 },
            three: { lines: 42, time: 135, bonuses: 1 },
        },
        metadata: {
            difficulty: 6,
            description: 'Cool night air carries you through scattered lights and distant cloud banks. Stay light on the board.',
            tip: 'This chapter exhales here. Let the board stay low and take efficient clears as they come.',
        },
    },
    30: {
        chapter: 5,
        chapterLevel: 3,
        isChapterStart: false,
        isChapterEnd: false,
        theme: {
            primary: 'aurora',
        },
        victory: {
            primary: {
                target: 20000,
            },
        },
        stars: {
            one: { score: 20000 },
            two: { score: 30000, tetrises: 4 },
            three: { score: 40000, tetrises: 7, combo: 6 },
        },
        metadata: {
            difficulty: 6,
            description: 'A ribbon of aurora becomes your path through the upper atmosphere. Precision matters more than aggression.',
            tip: 'This is a flow score level. Take clean doubles and triples until a stronger scoring window opens naturally.',
        },
    },
    31: {
        chapterLevel: 4,
        isChapterStart: false,
        victory: {
            primary: {
                target: 10,
            },
        },
        stars: {
            one: { cascades: 10 },
            two: { cascades: 10, maxCascadeDepth: 4 },
            three: { cascades: 12, maxCascadeDepth: 5 },
        },
        metadata: {
            description: 'Rain streaks across the glass as the world below softens into light. Build measured cascades inside the storm.',
            difficulty: 6,
            tip: 'Think in layers. Gentle, repeatable cascades are better than one overbuilt tower.',
        },
    },
    32: {
        chapterLevel: 5,
    },
    33: {
        chapterLevel: 6,
        victory: {
            primary: {
                target: 32000,
            },
        },
        stars: {
            one: { score: 32000 },
            two: { score: 45000, cascades: 8 },
            three: { score: 65000, cascades: 12, tetrises: 10 },
        },
        metadata: {
            difficulty: 7,
            description: 'Thin light and drifting mist turn the board into a luminous balancing act. Stabilize first, then score hard.',
            tip: 'Alternate between cleanup and scoring turns. This level rewards controlled tempo changes.',
        },
    },
    34: {
        chapterLevel: 7,
        metadata: {
            description: 'The atmosphere thins into eclipse light. This is a showcase board built for spectacular chain reactions.',
            tip: 'Finish the clear first. If the structure still breathes after that, push for the extra cascade depth.',
        },
    },
    35: {
        chapterLevel: 8,
        isChapterEnd: true,
    },
    36: {
        victory: {
            primary: {
                target: 28000,
            },
        },
        stars: {
            one: { score: 28000 },
            two: { score: 42000, tetrises: 5 },
            three: { score: 60000, tetrises: 9, combo: 8 },
        },
        metadata: {
            description: 'Outer space opens with room to breathe. Let the score build before the void starts asking harder questions.',
            difficulty: 8,
        },
    },
    40: {
        victory: {
            primary: {
                target: 70000,
            },
        },
        stars: {
            one: { score: 70000 },
            two: { score: 110000, tetrises: 9 },
            three: { score: 160000, tetrises: 14, combo: 10 },
        },
    },
    41: {
        victory: {
            primary: {
                target: 52,
            },
        },
        stars: {
            one: { lines: 52 },
            two: { lines: 52, tetrises: 8 },
            three: { lines: 60, tetrises: 12, time: 120 },
        },
        metadata: {
            description: 'Race the expanding shockwave. Efficiency matters more than perfection once the speed spikes.',
            tip: 'Use Quads to compress the workload. The fastest path through this level is almost always the cleanest one.',
        },
    },
    43: {
        mechanics: {
            speed: {
                startLevel: 8,
            },
            pieces: {
                previewCount: 5,
            },
        },
        victory: {
            primary: {
                target: 42,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
        },
        stars: {
            one: { lines: 42 },
            two: { lines: 42, time: 190 },
            three: { lines: 42, time: 135, bonuses: 1 },
        },
        metadata: {
            difficulty: 7,
            description: 'The gate to singularity opens into a rare pocket of quiet. Re-center before the final pull.',
            tip: 'Use this release beat to lower the stack and rebuild a clean well before the chapter finale.',
        },
    },
    44: {
        metadata: {
            difficulty: 10,
            description: 'Chapter 6 finale. Trigger massive cascades at the lip of the singularity and hold your nerve in the void.',
            tip: 'Focus on completing the chapter clear first. If the board still holds together, chase the showcase chains afterward.',
        },
    },
    45: {
        victory: {
            primary: {
                target: 36000,
            },
        },
        stars: {
            one: { score: 36000 },
            two: { score: 52000, tetrises: 8 },
            three: { score: 72000, tetrises: 12, combo: 8 },
        },
        metadata: {
            difficulty: 8,
            description: 'Reality softens into fluid motion. Let the first abstract chapter beat feel strange, but not yet hostile.',
            tip: 'Trust the score game you already know. The visuals change first; the discipline stays the same.',
        },
    },
    48: {
        mechanics: {
            board: {
                startingRows: 10,
            },
            speed: {
                fixedDropInterval: 500,
            },
            pieces: {
                previewCount: 4,
            },
        },
        victory: {
            primary: {
                target: 22,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
        },
        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },
        stars: {
            one: { cascades: 22 },
            two: { cascades: 24, maxCascadeDepth: 6 },
            three: { cascades: 28, maxCascadeDepth: 8 },
        },
        metadata: {
            difficulty: 9,
            tip: 'Use the full height, but do not overbuild. The best storm boards are structured, not chaotic.',
        },
    },
    49: {
        mechanics: {
            speed: {
                startLevel: 12,
            },
            pieces: {
                previewCount: 3,
            },
        },
        victory: {
            primary: {
                target: 60,
            },
            failure: {
                type: 'time',
                value: 180,
            },
        },
        stars: {
            one: { lines: 60 },
            two: { lines: 60, tetrises: 10 },
            three: { lines: 60, tetrises: 14, time: 115 },
        },
        metadata: {
            difficulty: 9,
            tip: 'This is still a speed wall, but it is no longer a marathon. Compress the target with Quads and keep the stack low.',
        },
    },
    50: {
        mechanics: {
            board: {
                startingRows: 6,
            },
            speed: {
                startLevel: 11,
                levelProgression: false,
                fixedDropInterval: 500,
            },
            pieces: {
                previewCount: 4,
            },
        },
        victory: {
            primary: {
                target: 36,
            },
            bonuses: [
                { type: 'time', target: 100, description: 'Complete in under 100 seconds' },
            ],
        },
        modifiers: {
            active: ['gravity-cascade'],
        },
        stars: {
            one: { lines: 36 },
            two: { lines: 36, time: 130 },
            three: { lines: 36, time: 100 },
        },
        metadata: {
            description: 'The dream slows just enough for one deep breath. Use the cascades to glide into the final void.',
            difficulty: 8,
            tip: 'Do not race the board. Let each cascade finish before you commit to the next shape.',
        },
    },
    51: {
        mechanics: {
            baseMode: 'infinity',
            board: {
                rows: 100,
                startingRows: 30,
            },
            speed: {
                startLevel: 12,
                levelProgression: false,
                fixedDropInterval: 500,
            },
            pieces: {
                previewCount: 5,
            },
        },
        victory: {
            primary: {
                type: 'score',
                target: 250000,
            },
            failure: {
                type: 'time',
                value: 480,
            },
            bonuses: [
                { type: 'max-cascade-depth', target: 10, description: 'Trigger a 10-chain cascade' },
                { type: 'cascade', target: 30, description: 'Trigger 30 cascades' },
                { type: 'tetris-count', target: 20, description: 'Clear 20 Quads' },
                { type: 'combo', target: 18, description: 'Reach 18x combo' },
            ],
        },
        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },
        stars: {
            one: { score: 250000 },
            two: {
                score: 350000, cascades: 25, maxCascadeDepth: 6,
            },
            three: {
                score: 500000, cascades: 35, maxCascadeDepth: 10, combo: 18,
            },
        },
        metadata: {
            difficulty: 10,
            description: 'The final abstract challenge. Build epic towers on a 100-row board and trigger legendary cascades.',
            tip: 'Use the full height of the board. The bigger the tower, the greater the cascade!',
        },
    },
    52: {
        metadata: {
            difficulty: 7,
            description: 'Neon-lit dunes shimmer like a mirage. This bonus chapter opens with a stylish but manageable push.',
            tip: 'Use the starting rows to set your pace. The encore wants confidence, not panic.',
        },
    },
    53: {
        metadata: {
            difficulty: 8,
        },
    },
    54: {
        metadata: {
            difficulty: 9,
        },
    },
    55: {
        metadata: {
            difficulty: 10,
            description: 'The bonus chapter finale turns the city into a high-voltage arena. Push for one last spectacular score run.',
            tip: 'Treat the opening stack like fuel. Convert it into momentum fast, then keep the combo engine alive as long as you can.',
        },
        victory: {
            primary: {
                target: 160000,
            },
        },
        stars: {
            one: { score: 160000 },
            two: {
                score: 200000, cascades: 20, combo: 10,
            },
            three: {
                score: 260000, cascades: 25, maxCascadeDepth: 7, combo: 12,
            },
        },
    },
});

function mergeConfig(baseConfig, overrideConfig) {
    if (!overrideConfig) {
        return baseConfig;
    }

    const replaceObjectKeys = new Set(['one', 'two', 'three']);
    const merged = { ...baseConfig };
    Object.entries(overrideConfig).forEach(([key, value]) => {
        const baseValue = baseConfig?.[key];
        if (
            value
            && typeof value === 'object'
            && !Array.isArray(value)
            && !replaceObjectKeys.has(key)
            && baseValue
            && typeof baseValue === 'object'
            && !Array.isArray(baseValue)
        ) {
            merged[key] = mergeConfig(baseValue, value);
            return;
        }

        merged[key] = value;
    });

    return merged;
}

export const LEVEL_CONFIGS = BASE_LEVEL_CONFIGS.map((level) => {
    const tags = LEVEL_PHASE2_TAGS[level.id];
    const taggedLevel = mergeConfig(level, tags);
    const derivedLevel = mergeConfig(taggedLevel, deriveOdysseyLevelTuning(level.id, tags, level));
    return mergeConfig(derivedLevel, LEVEL_PHASE2_OVERRIDES[level.id]);
});

// Helper functions for level access
export function getLevelById(id) {
    return LEVEL_CONFIGS.find((level) => level.id === id);
}

export function getLevelsByChapter(chapterId) {
    return LEVEL_CONFIGS.filter((level) => level.chapter === chapterId);
}

export function getChapterStartLevel(chapterId) {
    return LEVEL_CONFIGS.find((level) => level.chapter === chapterId && level.isChapterStart);
}

export function getChapterEndLevel(chapterId) {
    return LEVEL_CONFIGS.find((level) => level.chapter === chapterId && level.isChapterEnd);
}

export function getNextLevel(currentId) {
    const nextId = currentId + 1;
    return LEVEL_CONFIGS.find((level) => level.id === nextId);
}

export function getPreviousLevel(currentId) {
    const prevId = currentId - 1;
    return LEVEL_CONFIGS.find((level) => level.id === prevId);
}

export function getTotalLevelCount() {
    return LEVEL_CONFIGS.length;
}

export function getLevelDifficultyRange() {
    const difficulties = LEVEL_CONFIGS.map((l) => l.metadata.difficulty);
    return {
        min: Math.min(...difficulties),
        max: Math.max(...difficulties),
    };
}

export default LEVEL_CONFIGS;
