/**
 * @fileoverview Journey Mode Level Configurations
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
 * See JOURNEY_MODE_IMPLEMENTATION_PLAN.md for full schema
 */

export const LEVEL_CONFIGS = [
    // =============================
    // CHAPTER 1: EARTH CORE & SUBTERRANEAN ORIGINS
    // Levels 1-7
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
                holdEnabled: true,
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
            description: 'Clear 20 lines to complete your first level! A gentle introduction to the journey.',
            difficulty: 1,
            estimatedTime: 120,
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
                holdEnabled: true,
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
            estimatedTime: 180,
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
                holdEnabled: true,
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
            estimatedTime: 150,
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
                holdEnabled: true,
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
            estimatedTime: 120,
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
                holdEnabled: true,
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
            estimatedTime: 200,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 3, description: 'Clear 3 Tetrises' },
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
            estimatedTime: 150,
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
                holdEnabled: true,
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
            estimatedTime: 240,
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
                holdEnabled: true,
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
            estimatedTime: 150,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 4, description: 'Clear 4 Tetrises' },
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
            estimatedTime: 180,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 5, description: 'Clear 5 Tetrises' },
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
            estimatedTime: 240,
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
                holdEnabled: true,
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
            estimatedTime: 200,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 8, description: 'Clear 8 Tetrises' },
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
            estimatedTime: 180,
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
                holdEnabled: true,
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
            estimatedTime: 150,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 5, description: 'Clear 5 Tetrises' },
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
            estimatedTime: 180,
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
                holdEnabled: true,
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
            estimatedTime: 200,
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
            primary: 'spring',
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
                holdEnabled: true,
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
            estimatedTime: 150,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 5, description: 'Clear 5 Tetrises' },
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
            description: 'Gather the autumn harvest. Combine cascades and Tetrises for maximum yield.',
            difficulty: 6,
            estimatedTime: 200,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 8, description: 'Clear 8 Tetrises' },
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
            estimatedTime: 210,
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
            primary: 'meadow',
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
                holdEnabled: true,
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
            estimatedTime: 240,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 8, description: 'Clear 8 Tetrises' },
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
            estimatedTime: 240,
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
                holdEnabled: true,
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
            estimatedTime: 180,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 6, description: 'Clear 6 Tetrises' },
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
            estimatedTime: 180,
            tip: 'Start by clearing the existing blocks, then build for Tetrises.',
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
                holdEnabled: true,
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
            estimatedTime: 200,
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
                holdEnabled: true,
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
            estimatedTime: 150,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 6, description: 'Clear 6 Tetrises' },
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
            estimatedTime: 210,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 4, description: 'Clear 4 Tetrises' },
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
            estimatedTime: 120,
            tip: 'Half the board is garbage - clear it quickly and build for Tetrises. Keep playing after goal for more stars!',
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
                holdEnabled: true,
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
            estimatedTime: 240,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 10, description: 'Clear 10 Tetrises' },
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
            estimatedTime: 240,
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
                holdEnabled: true,
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
            estimatedTime: 170,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 7, description: 'Clear 7 Tetrises' },
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
            estimatedTime: 190,
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
                holdEnabled: true,
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
            estimatedTime: 210,
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
                holdEnabled: true,
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
            estimatedTime: 150,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 8, description: 'Clear 8 Tetrises' },
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
            estimatedTime: 220,
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
                holdEnabled: true,
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
            estimatedTime: 260,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 12, description: 'Clear 12 Tetrises' },
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
            estimatedTime: 250,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 8, description: 'Clear 8 Tetrises' },
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
            estimatedTime: 200,
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
                holdEnabled: true,
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
            estimatedTime: 230,
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
                holdEnabled: true,
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
            estimatedTime: 120,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 10, description: 'Clear 10 Tetrises' },
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
            estimatedTime: 200,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 12, description: 'Clear 12 Tetrises' },
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
            estimatedTime: 240,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 10, description: 'Clear 10 Tetrises' },
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
            estimatedTime: 150,
            tip: 'Speed is critical - use Tetrises (4-line clears) for maximum efficiency. Keep playing after goal for more stars!',
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 15, description: 'Clear 15 Tetrises' },
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
            estimatedTime: 260,
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
                holdEnabled: true,
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
            estimatedTime: 180,
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
                holdEnabled: true,
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
            estimatedTime: 240,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 12, description: 'Clear 12 Tetrises' },
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
            estimatedTime: 200,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 10, description: 'Clear 10 Tetrises' },
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
            estimatedTime: 210,
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
                holdEnabled: true,
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
            estimatedTime: 120,
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
                holdEnabled: true,
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
            estimatedTime: 300,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 15, description: 'Clear 15 Tetrises' },
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
            estimatedTime: 150,
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
                holdEnabled: true,
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
            estimatedTime: 120,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 20, description: 'Clear 20 Tetrises' },
                { type: 'combo', target: 18, description: 'Reach 18x combo' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            one: { score: 250000 },
            two: { score: 350000, cascades: 25, maxCascadeDepth: 6 },
            three: { score: 500000, cascades: 35, maxCascadeDepth: 10, combo: 18 },
        },

        metadata: {
            description: 'The final abstract challenge. Build epic towers on a 100-row board and trigger legendary cascades.',
            difficulty: 10,
            estimatedTime: 420,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 8, description: 'Clear 8 Tetrises' },
                { type: 'combo', target: 8, description: 'Reach 8x combo' },
            ],
        },

        modifiers: {
            active: [],
        },

        stars: {
            one: { lines: 50 },
            two: { lines: 50, tetrises: 6, time: 240 },
            three: { lines: 50, tetrises: 8, combo: 8, time: 180 },
        },

        metadata: {
            description: 'Rain patters against the window as you fall into a meditative rhythm. The city lights blur in the droplets.',
            difficulty: 6,
            estimatedTime: 180,
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
                holdEnabled: true,
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
            three: { score: 120000, cascades: 15, combo: 10, time: 240 },
        },

        metadata: {
            description: 'The sun sets behind towering skyscrapers as neon signs flicker to life. The city awakens.',
            difficulty: 7,
            estimatedTime: 240,
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
                holdEnabled: true,
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
                { type: 'tetris-count', target: 12, description: 'Clear 12 Tetrises' },
                { type: 'max-cascade-depth', target: 5, description: 'Trigger a 5-chain cascade' },
            ],
        },

        modifiers: {
            active: ['gravity-cascade', 'combo-multiplier'],
        },

        stars: {
            one: { lines: 60 },
            two: { lines: 60, tetrises: 10, cascades: 8 },
            three: { lines: 60, tetrises: 12, maxCascadeDepth: 5, time: 240 },
        },

        metadata: {
            description: 'Deep in the neon district, holographic billboards pulse with light. Speed and precision are everything.',
            difficulty: 8,
            estimatedTime: 250,
            tip: 'The time limit is strict. Focus on efficient Tetris clears to meet your target.',
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
                holdEnabled: true,
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
            three: { score: 220000, cascades: 25, maxCascadeDepth: 7, combo: 12 },
        },

        metadata: {
            description: 'The ultimate urban challenge. Retro-futuristic sun sets over chrome mountains as you push for the high score.',
            difficulty: 9,
            estimatedTime: 300,
            tip: 'This is the bonus chapter finale. Go for glory with maximum cascade chains!',
        },
    }
];

// Helper functions for level access
export function getLevelById(id) {
    return LEVEL_CONFIGS.find(level => level.id === id);
}

export function getLevelsByChapter(chapterId) {
    return LEVEL_CONFIGS.filter(level => level.chapter === chapterId);
}

export function getChapterStartLevel(chapterId) {
    return LEVEL_CONFIGS.find(level => level.chapter === chapterId && level.isChapterStart);
}

export function getChapterEndLevel(chapterId) {
    return LEVEL_CONFIGS.find(level => level.chapter === chapterId && level.isChapterEnd);
}

export function getNextLevel(currentId) {
    const nextId = currentId + 1;
    return LEVEL_CONFIGS.find(level => level.id === nextId);
}

export function getPreviousLevel(currentId) {
    const prevId = currentId - 1;
    return LEVEL_CONFIGS.find(level => level.id === prevId);
}

export function getTotalLevelCount() {
    return LEVEL_CONFIGS.length;
}

export function getLevelDifficultyRange() {
    const difficulties = LEVEL_CONFIGS.map(l => l.metadata.difficulty);
    return {
        min: Math.min(...difficulties),
        max: Math.max(...difficulties),
    };
}

export default LEVEL_CONFIGS;
