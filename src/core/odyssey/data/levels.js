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
 * Levels are organized by chapter (60 total, including the urban encore).
 *
 * The words players read (each orb's name, description and tip) live in orb-copy.js, keyed by
 * the orb's theme, and are applied after the campaign is assembled. Bonus goal labels and the
 * goal and star lines are generated from the numbers here (src/ui/odyssey/objective-copy.js).
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

import { deriveOdysseyLevelTuning, normalizeOdysseyCompletionStars } from './difficulty-model.js';
import { assembleOdysseyCampaign } from './campaign-order.js';
import { applyOdysseyOrbCopy } from './orb-copy.js';
import {
    ODYSSEY_DUEL_KNOCKOUTS, ODYSSEY_DUEL_STAR_TOP_OUTS, formatOdysseyDuelGoal, formatOdysseyRival, getOdysseyDuelGravity,
} from './duel-rules.js';

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
            difficulty: 1,
        },
    },

    {
        id: 2,
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
            difficulty: 2,
        },
    },

    {
        id: 3,
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
            difficulty: 2,
        },
    },

    {
        id: 4,
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
            difficulty: 3,
        },
    },

    {
        id: 5,
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
            difficulty: 4,
        },
    },

    {
        id: 6,
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
            difficulty: 5,
        },
    },

    {
        id: 7,
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
            difficulty: 6,
        },
    },

    {
        id: 8,
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
            difficulty: 3,
        },
    },

    {
        id: 9,
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
            difficulty: 4,
        },
    },

    {
        id: 11,
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
            difficulty: 5,
        },
    },

    {
        id: 12,
        chapter: 3,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        pathPosition: 0.204,

        theme: {
            primary: 'grainfields',
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
            difficulty: 6,
        },
    },

    {
        id: 13,
        chapter: 3,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.222,

        theme: {
            primary: 'spring',
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
            difficulty: 4,
        },
    },

    {
        id: 14,
        chapter: 3,
        chapterLevel: 3,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.241,

        theme: {
            primary: 'golden-forest',
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
            difficulty: 4,
        },
    },

    {
        id: 15,
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
            difficulty: 5,
        },
    },

    {
        id: 16,
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
            difficulty: 6,
        },
    },

    {
        id: 17,
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
            difficulty: 6,
        },
    },

    {
        id: 18,
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
            difficulty: 5,
        },
    },

    {
        id: 19,
        chapter: 3,
        chapterLevel: 8,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.333,

        theme: {
            primary: 'halcyon-apex',
            overlays: [],
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
            difficulty: 7,
        },
    },

    {
        id: 20,
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
            difficulty: 8,
        },
    },

    {
        id: 21,
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
            difficulty: 7,
        },
    },

    {
        id: 22,
        chapter: 4,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        pathPosition: 0.389,

        theme: {
            primary: 'ice-temple',
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
            difficulty: 6,
        },
    },

    {
        id: 23,
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
            difficulty: 6,
        },
    },

    {
        id: 24,
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
            difficulty: 7,
        },
    },

    {
        id: 25,
        chapter: 4,
        chapterLevel: 4,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.444,

        theme: {
            primary: 'high-coast',
            overlays: [],
            transitionIn: 'crossfade',
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
            difficulty: 7,
        },
    },

    {
        id: 26,
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
            difficulty: 8,
        },
    },

    {
        id: 27,
        chapter: 4,
        chapterLevel: 6,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.481,

        theme: {
            primary: 'sunfall',
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
            difficulty: 8,
        },
    },

    {
        id: 28,
        chapter: 4,
        chapterLevel: 7,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.500,

        theme: {
            primary: 'sunset',
            overlays: ['ice-temple', 'sunfall'],
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
            difficulty: 9,
        },
    },

    {
        id: 29,
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
            difficulty: 6,
        },
    },

    {
        id: 30,
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
            difficulty: 7,
        },
    },

    {
        id: 31,
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
            difficulty: 7,
        },
    },

    {
        id: 32,
        chapter: 5,
        chapterLevel: 2,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.574,

        theme: {
            primary: 'sunbraid',
            overlays: ['sunbraid'],
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
            difficulty: 8,
        },
    },

    {
        id: 33,
        chapter: 5,
        chapterLevel: 3,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.593,

        theme: {
            primary: 'rainbow-terraces',
            overlays: [],
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
            difficulty: 8,
        },
    },

    {
        id: 34,
        chapter: 5,
        chapterLevel: 4,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.611,

        theme: {
            primary: 'parhelion',
            overlays: [],
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
            difficulty: 9,
        },
    },

    {
        id: 35,
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
            difficulty: 9,
        },
    },

    {
        id: 36,
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
            difficulty: 8,
        },
    },

    {
        id: 37,
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
            difficulty: 8,
        },
    },

    {
        id: 38,
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
            difficulty: 8,
        },
    },

    {
        id: 39,
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
            difficulty: 9,
        },
    },

    {
        id: 40,
        chapter: 6,
        chapterLevel: 5,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.722,

        theme: {
            primary: 'void-ember',
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
            difficulty: 10,
        },
    },

    {
        id: 41,
        chapter: 6,
        chapterLevel: 6,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.741,

        theme: {
            primary: 'aether-tides',
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
            difficulty: 9,
        },
    },

    // ── SPACE LENGTHENED (Wave 1, D1 2026-08-15): the second movement, levels 42-45,
    // inserted between Stellar Shockwave and the Event Horizon finale trilogy. The
    // names track the re-composed environment's beats (the reef, the pillar, the
    // witnesses, the quiet drift before the dive). ─────────────────────────────────
    {
        id: 42,
        chapter: 6,
        chapterLevel: 7,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.725,

        theme: {
            primary: 'astral-weave',
            overlays: ['galaxy'],
            transitionIn: 'crossfade',
            transitionDuration: 4000,
        },

        mechanics: {
            baseMode: 'standard',
            board: { columns: 10, rows: 20, startingRows: 4 },
            speed: { startLevel: 10, levelProgression: true, fixedDropInterval: null },
            pieces: { bagType: '7-bag', customSequence: null, previewCount: 4 },
        },

        victory: {
            primary: { type: 'score', target: 38000 },
            failure: { type: 'top-out', value: null },
            bonuses: [
                { type: 'tetris-count', target: 8, description: 'Clear 8 Quads' },
                { type: 'combo', target: 6, description: 'Reach 6x combo' },
            ],
        },

        modifiers: { active: ['combo-multiplier'] },

        stars: {
            one: { score: 38000 },
            two: { score: 55000, tetrises: 6 },
            three: { score: 75000, tetrises: 10, combo: 8 },
        },

        metadata: {
            difficulty: 8,
        },
    },

    {
        id: 43,
        chapter: 6,
        chapterLevel: 8,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.738,

        theme: {
            primary: 'shifting-sands',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 4000,
        },

        mechanics: {
            baseMode: 'standard',
            board: { columns: 10, rows: 20, startingRows: 5 },
            speed: { startLevel: 10, levelProgression: true, fixedDropInterval: null },
            pieces: { bagType: '7-bag', customSequence: null, previewCount: 4 },
        },

        victory: {
            primary: { type: 'lines', target: 40 },
            failure: { type: 'top-out', value: null },
            bonuses: [
                { type: 'tetris-count', target: 6, description: 'Clear 6 Quads' },
                { type: 'combo', target: 7, description: 'Reach 7x combo' },
            ],
        },

        modifiers: { active: ['combo-multiplier'] },

        stars: {
            one: { lines: 40 },
            two: { lines: 40, tetrises: 5 },
            three: { lines: 40, tetrises: 8, combo: 8 },
        },

        metadata: {
            difficulty: 9,
        },
    },

    {
        id: 44,
        chapter: 6,
        chapterLevel: 9,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.751,

        theme: {
            primary: 'stellar-velocity',
            overlays: ['galaxy'],
            transitionIn: 'warp',
            transitionDuration: 3500,
        },

        mechanics: {
            baseMode: 'standard',
            board: { columns: 10, rows: 20, startingRows: 5 },
            speed: { startLevel: 11, levelProgression: true, fixedDropInterval: null },
            pieces: { bagType: '7-bag', customSequence: null, previewCount: 4 },
        },

        victory: {
            primary: { type: 'score', target: 50000 },
            failure: { type: 'top-out', value: null },
            bonuses: [
                { type: 'tetris-count', target: 10, description: 'Clear 10 Quads' },
                { type: 'combo', target: 8, description: 'Reach 8x combo' },
            ],
        },

        modifiers: { active: ['combo-multiplier'] },

        stars: {
            one: { score: 50000 },
            two: { score: 70000, tetrises: 8 },
            three: { score: 95000, tetrises: 12, combo: 9 },
        },

        metadata: {
            difficulty: 10,
        },
    },

    {
        id: 45,
        chapter: 6,
        chapterLevel: 10,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.764,

        theme: {
            primary: 'stellar-drift',
            overlays: [],
            transitionIn: 'crossfade',
            transitionDuration: 5000,
        },

        mechanics: {
            baseMode: 'standard',
            board: { columns: 10, rows: 20, startingRows: 3 },
            speed: { startLevel: 9, levelProgression: true, fixedDropInterval: null },
            pieces: { bagType: '7-bag', customSequence: null, previewCount: 5 },
        },

        victory: {
            primary: { type: 'score', target: 32000 },
            failure: { type: 'top-out', value: null },
            bonuses: [
                { type: 'combo', target: 6, description: 'Reach 6x combo' },
                { type: 'tetris-count', target: 6, description: 'Clear 6 Quads' },
            ],
        },

        modifiers: { active: ['combo-multiplier'] },

        stars: {
            one: { score: 32000 },
            two: { score: 46000, combo: 6 },
            three: { score: 62000, combo: 8, tetrises: 8 },
        },

        metadata: {
            difficulty: 7,
        },
    },

    {
        id: 46,
        chapter: 6,
        chapterLevel: 11,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.776,

        theme: {
            primary: 'solar-eclipse',
            overlays: [],
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
            difficulty: 10,
        },
    },

    {
        id: 47,
        chapter: 6,
        chapterLevel: 12,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.789,

        theme: {
            primary: 'rainbark',
            overlays: [],
            transitionIn: 'crossfade',
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
            difficulty: 8,
        },
    },

    {
        id: 48,
        chapter: 6,
        chapterLevel: 13,
        isChapterStart: false,
        isChapterEnd: true,
        pathPosition: 0.802,

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
            difficulty: 9,
        },
    },

    {
        id: 49,
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
            difficulty: 9,
        },
    },

    {
        id: 50,
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
            difficulty: 9,
        },
    },

    {
        id: 51,
        chapter: 7,
        chapterLevel: 3,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.852,

        theme: {
            primary: 'chiral-gold',
            overlays: [],
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
            difficulty: 9,
        },
    },

    {
        id: 52,
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
            difficulty: 10,
        },
    },

    {
        id: 53,
        chapter: 7,
        chapterLevel: 5,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.889,

        theme: {
            primary: 'chromatic-impasto',
            overlays: ['murmuration'],
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
            difficulty: 10,
        },
    },

    {
        id: 54,
        chapter: 7,
        chapterLevel: 6,
        isChapterStart: false,
        isChapterEnd: false,
        pathPosition: 0.907,

        theme: {
            primary: 'murmuration',
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
            difficulty: 9,
        },
    },

    {
        id: 55,
        chapter: 7,
        chapterLevel: 7,
        isChapterStart: false,
        isChapterEnd: true,
        pathPosition: 0.926,

        theme: {
            primary: 'kaleidosonic',
            overlays: ['murmuration', 'black-hole'],
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
            difficulty: 10,
        },
    },

    {
        id: 56,
        chapter: 8,
        chapterLevel: 1,
        isChapterStart: true,
        isChapterEnd: false,
        pathPosition: 0.944,

        theme: {
            primary: 'chromadelic-highway',
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
            difficulty: 6,
        },
    },

    {
        id: 57,
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
            difficulty: 7,
        },
    },

    {
        id: 58,
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
            difficulty: 8,
        },
    },

    {
        id: 59,
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
            difficulty: 9,
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
    // Space lengthening (Wave 1, D1): the second movement — quiet shallows, a rising
    // test pair, a breath — inserted between Stellar Shockwave and the finale trilogy.
    42: { role: 'reinforce', mechanicFocus: 'score', emotionalBeat: 'wonder', victoryLapPolicy: 'none' },
    43: { role: 'test', mechanicFocus: 'lines', emotionalBeat: 'tension', victoryLapPolicy: 'none' },
    44: { role: 'test', mechanicFocus: 'score', emotionalBeat: 'awe', victoryLapPolicy: 'none' },
    45: { role: 'release', mechanicFocus: 'score', emotionalBeat: 'release', victoryLapPolicy: 'none' },
    46: { role: 'boss', mechanicFocus: 'hybrid', emotionalBeat: 'panic', victoryLapPolicy: 'none' },
    47: { role: 'release', mechanicFocus: 'lines', emotionalBeat: 'release', victoryLapPolicy: 'none' },
    48: { role: 'boss', mechanicFocus: 'cascade', emotionalBeat: 'transcendence', victoryLapPolicy: 'showcase' },
    49: { role: 'arrival', mechanicFocus: 'score', emotionalBeat: 'awe', victoryLapPolicy: 'none' },
    50: { role: 'reinforce', mechanicFocus: 'hybrid', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    51: { role: 'test', mechanicFocus: 'sprint', emotionalBeat: 'panic', victoryLapPolicy: 'none' },
    52: { role: 'boss', mechanicFocus: 'cascade', emotionalBeat: 'panic', victoryLapPolicy: 'none' },
    53: { role: 'test', mechanicFocus: 'sprint', emotionalBeat: 'panic', victoryLapPolicy: 'none' },
    54: { role: 'release', mechanicFocus: 'lines', emotionalBeat: 'release', victoryLapPolicy: 'none' },
    55: { role: 'boss', mechanicFocus: 'hybrid', emotionalBeat: 'transcendence', victoryLapPolicy: 'showcase' },
    56: { role: 'encore', mechanicFocus: 'lines', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    57: { role: 'encore', mechanicFocus: 'score', emotionalBeat: 'flow', victoryLapPolicy: 'none' },
    58: { role: 'encore', mechanicFocus: 'hybrid', emotionalBeat: 'tension', victoryLapPolicy: 'none' },
    59: { role: 'encore', mechanicFocus: 'hybrid', emotionalBeat: 'transcendence', victoryLapPolicy: 'showcase' },
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
            difficulty: 3,
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
            difficulty: 4,
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
            difficulty: 4,
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
        },
    },
    11: {
        metadata: {
            difficulty: 6,
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
            difficulty: 3,
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
            difficulty: 6,
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
            difficulty: 5,
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
            difficulty: 5,
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
            difficulty: 6,
        },
    },
    22: {
        chapterLevel: 3,
        isChapterStart: false,
    },
    23: {
        chapterLevel: 4,
    },
    24: {
        chapterLevel: 5,
    },
    25: {
        chapterLevel: 6,
        metadata: {
            difficulty: 6,
        },
    },
    26: {
        chapterLevel: 7,
        metadata: {
            difficulty: 7,
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
            difficulty: 6,
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
            difficulty: 6,
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
        },
    },
    34: {
        chapterLevel: 7,
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
    },
    47: {
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
        },
    },
    48: {
        metadata: {
            difficulty: 10,
        },
    },
    49: {
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
        },
    },
    52: {
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
        },
    },
    53: {
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
        },
    },
    54: {
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
            difficulty: 8,
        },
    },
    55: {
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
        },
    },
    56: {
        metadata: {
            difficulty: 7,
        },
    },
    57: {
        metadata: {
            difficulty: 8,
        },
    },
    58: {
        metadata: {
            difficulty: 9,
        },
    },
    59: {
        metadata: {
            difficulty: 10,
        },
        victory: {
            primary: {
                target: 160000,
            },
            failure: {
                value: 210,
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

// One rival in each chapter. The authored slot keeps its id, title, theme and path position;
// campaign-order.js then moves the duel to the chapter's last slot (the rival guards the exit).
const AUTHORED_BOT_CHALLENGES = Object.freeze({
    4: Object.freeze({ botDifficulty: 1, botName: 'Cinder' }),
    9: Object.freeze({ botDifficulty: 2, botName: 'Coral' }),
    17: Object.freeze({ botDifficulty: 3, botName: 'Willow' }),
    26: Object.freeze({ botDifficulty: 4, botName: 'Frost' }),
    33: Object.freeze({ botDifficulty: 5, botName: 'Zephyr' }),
    44: Object.freeze({ botDifficulty: 6, botName: 'Nova' }),
    53: Object.freeze({ botDifficulty: 7, botName: 'Prism' }),
    58: Object.freeze({ botDifficulty: 8, botName: 'Neon' }),
});

function applyBotChallenge(level) {
    const challenge = AUTHORED_BOT_CHALLENGES[level.id];
    if (!challenge) return level;
    const { botDifficulty, botName } = challenge;
    const knockouts = ODYSSEY_DUEL_KNOCKOUTS;
    const gravity = getOdysseyDuelGravity(level.chapter);

    return mergeConfig(level, {
        mechanicFocus: 'versus',
        victoryLapPolicy: 'none',
        mechanics: {
            baseMode: 'standard',
            board: { columns: 10, rows: 20, startingRows: 0 },
            speed: { startLevel: 1, levelProgression: false, fixedDropInterval: gravity },
            pieces: { bagType: '7-bag', customSequence: null, previewCount: 5 },
            versus: { botDifficulty, botName, fragsToWin: knockouts },
        },
        victory: {
            primary: {
                type: 'frags',
                target: knockouts,
                description: formatOdysseyDuelGoal(botName, knockouts),
            },
            failure: { type: 'opponent-frags', value: knockouts },
            bonuses: [],
        },
        modifiers: { active: [] },
        stars: {
            one: { frags: knockouts },
            two: { frags: knockouts, maxDeaths: ODYSSEY_DUEL_STAR_TOP_OUTS.two },
            three: { frags: knockouts, maxDeaths: ODYSSEY_DUEL_STAR_TOP_OUTS.three },
        },
        metadata: {
            difficulty: botDifficulty + 1,
            subtitle: formatOdysseyRival(botName, botDifficulty),
        },
    });
}

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

/**
 * Chains are one metric. The engine reports a lock's cascade-wave ordinal into both `combo`
 * and `maxCascadeDepth`, so an orb that asked for "an 8x combo" and "a 6-wave chain" was asking
 * for one thing twice, with the stricter number winning silently. Every chain goal is now a
 * single `maxCascadeDepth` condition, and the deepest chain the campaign asks for is six waves,
 * the deepest the game's own effect catalogue and the offline benchmark have ever shown. Two
 * stars ask for at most four. Authored score, line, cascade-count and Quad goals are untouched.
 */
const CHAIN_WAVE_CAP = Object.freeze({ two: 4, three: 6 });
const CHAIN_BONUS_TYPES = new Set(['combo', 'max-cascade-depth']);

function chainTargetOf(condition) {
    return Math.max(Number(condition?.combo) || 0, Number(condition?.maxCascadeDepth) || 0);
}

function harmonizeChainGoals(level) {
    if (level.mechanics?.versus) return level;
    const stars = {};
    let previousChain = 0;
    for (const tier of ['one', 'two', 'three']) {
        const authored = level.stars?.[tier];
        if (!authored) continue;
        const { combo, maxCascadeDepth, ...rest } = authored;
        const condition = { ...rest };
        let chain = chainTargetOf(authored);
        if (chain > 0) {
            if (CHAIN_WAVE_CAP[tier]) chain = Math.min(chain, CHAIN_WAVE_CAP[tier]);
            chain = Math.max(chain, previousChain);
            condition.maxCascadeDepth = chain;
            previousChain = chain;
        }
        stars[tier] = condition;
    }
    const bonuses = level.victory?.bonuses || [];
    const chainBonuses = bonuses.filter((bonus) => CHAIN_BONUS_TYPES.has(bonus.type));
    let nextBonuses = bonuses;
    if (chainBonuses.length) {
        const waves = Math.min(CHAIN_WAVE_CAP.three, Math.max(...chainBonuses.map((bonus) => bonus.target || 0)));
        const first = bonuses.indexOf(chainBonuses[0]);
        nextBonuses = bonuses.filter((bonus) => !CHAIN_BONUS_TYPES.has(bonus.type));
        nextBonuses.splice(first, 0, {
            type: 'max-cascade-depth', target: waves, description: `Trigger a ${waves}-wave chain`,
        });
    }
    return {
        ...level,
        victory: { ...level.victory, bonuses: nextBonuses },
        stars: level.stars ? stars : level.stars,
    };
}

// The three mastery capstones asked for chains and totals no solver or benchmark run has ever
// produced (12- and 18-wave chains, 500k on a 480-second board). Their first star is unchanged;
// the higher tiers now sit at the edge of what skilled play has demonstrated. Keyed by authored id.
const MASTERY_RETUNE = Object.freeze({
    49: Object.freeze({
        victory: {
            bonuses: [
                { type: 'tetris-count', target: 10, description: 'Clear 10 Quads' },
                { type: 'max-cascade-depth', target: 5, description: 'Trigger a 5-wave chain' },
            ],
        },
        stars: {
            one: { score: 36000 },
            two: { score: 36000, tetrises: 8 },
            three: { score: 36000, tetrises: 10, maxCascadeDepth: 5 },
        },
    }),
    55: Object.freeze({
        victory: {
            bonuses: [
                { type: 'max-cascade-depth', target: 6, description: 'Trigger a 6-wave chain' },
                { type: 'cascade', target: 25, description: 'Trigger 25 cascades' },
                { type: 'tetris-count', target: 12, description: 'Clear 12 Quads' },
            ],
        },
        stars: {
            one: { score: 250000 },
            two: { score: 320000, cascades: 20, maxCascadeDepth: 4 },
            three: { score: 400000, cascades: 28, maxCascadeDepth: 6 },
        },
    }),
    59: Object.freeze({
        victory: {
            bonuses: [
                { type: 'cascade', target: 20, description: 'Trigger 20 cascades' },
                { type: 'max-cascade-depth', target: 6, description: 'Trigger a 6-wave chain' },
            ],
        },
        stars: {
            one: { score: 160000 },
            two: { score: 200000, cascades: 16, maxCascadeDepth: 4 },
            three: { score: 240000, cascades: 20, maxCascadeDepth: 6 },
        },
    }),
});

function applyMasteryRetune(level) {
    const retune = MASTERY_RETUNE[level.id];
    if (!retune) return level;
    return {
        ...level,
        victory: { ...level.victory, bonuses: structuredClone(retune.victory.bonuses) },
        stars: structuredClone(retune.stars),
    };
}

const AUTHORED_LEVEL_CONFIGS = BASE_LEVEL_CONFIGS.map((level) => {
    const tags = LEVEL_PHASE2_TAGS[level.id];
    const taggedLevel = mergeConfig(level, tags);
    const derivedLevel = mergeConfig(taggedLevel, deriveOdysseyLevelTuning(level.id, tags, level));
    const authoredLevel = mergeConfig(derivedLevel, LEVEL_PHASE2_OVERRIDES[level.id]);
    const challengeLevel = applyBotChallenge(authoredLevel);
    const tunedLevel = applyMasteryRetune(normalizeOdysseyCompletionStars(challengeLevel));
    return harmonizeChainGoals(tunedLevel);
});

// The words go on last, so every orb ships with exactly the name, description and tip in orb-copy.js.
export const LEVEL_CONFIGS = applyOdysseyOrbCopy(assembleOdysseyCampaign(AUTHORED_LEVEL_CONFIGS));

/** The rival of each chapter, keyed by the public id of the duel orb (the chapter's last slot). */
export const ODYSSEY_BOT_CHALLENGES = Object.freeze(Object.fromEntries(
    LEVEL_CONFIGS.filter((level) => level.mechanics.versus).map((level) => [
        level.id,
        Object.freeze({
            botDifficulty: level.mechanics.versus.botDifficulty,
            botName: level.mechanics.versus.botName,
        }),
    ]),
));

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
