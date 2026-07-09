/**
 * @fileoverview Odyssey Mode Chapter Configurations
 *
 * Defines the eight chapters of Odyssey Mode, each representing a stage
 * of cosmic ascent from Earth's core to abstract transcendence and urban dreams.
 */

export const DEFAULT_BOARD_TRANSITION = Object.freeze({
    seamWidth: 0.018,
    beatDurationMs: 850,
    preloadDistance: 0.05,
    fxPreset: 'standard',
});

// NOTE: `arcBeats` and `targetDifficultyCurve` are documentation of design INTENT,
// not the live driver. Actual gameplay difficulty is derived in difficulty-model.js
// from the per-level `role`/`mechanicFocus`/`emotionalBeat` tags in levels.js
// (LEVEL_PHASE2_TAGS). `arcBeats` must mirror those `role` tags — this is enforced by
// the "chapter arcBeats stay in sync" assertion in odyssey-difficulty-balance.test.js.
// `targetDifficultyCurve` is an indicative 1-10 sketch; the model computes the real
// continuous scalar (metadata.difficultyModel.scalar) per level.
export const CHAPTER_CONFIGS = [
    {
        id: 1,
        name: 'Earth Core & Subterranean Origins',
        subtitle: 'Find your first rhythm',
        levelRange: [1, 5],
        arcBeats: ['arrival', 'teach', 'reinforce', 'test', 'boss'],
        targetDifficultyCurve: [1, 2, 2, 3, 4],

        themes: {
            primary: ['crystal-cave', 'cinder-drift', 'geode', 'pyrestorm', 'bioluminescence'],
            supporting: [],
        },

        environment: {
            skyColor: 0x1a0a00,
            fogColor: 0x2d1500,
            fogDensity: 0.015, // Increased for better crater edge fog effect
            ambientLight: 0x331100,
            ambientIntensity: 0.4,
        },

        music: {
            track: 'CinderDrift',
            crossfadeDuration: 3000,
            transitionOutStinger: 'steam-quench',
        },

        narrative: {
            intro: 'The journey begins deep within the Earth\'s core. Pressure surrounds you, but crystal light shows the way.',
            outro: 'You emerge from the molten depths. Above, you sense the vast liquid worlds waiting...',
        },
        boardTransition: { ...DEFAULT_BOARD_TRANSITION },
    },

    {
        id: 2,
        name: 'Deep Ocean & Liquid Worlds',
        subtitle: 'Drift, dive, recover',
        levelRange: [6, 11],
        arcBeats: ['arrival', 'teach', 'reinforce', 'reinforce', 'release', 'boss'],
        targetDifficultyCurve: [3, 4, 4, 5, 4, 6],

        themes: {
            primary: ['ocean', 'luminous-tides', 'koi-pond', 'waves', 'misty-lake', 'stillwater'],
            supporting: [],
        },

        environment: {
            skyColor: 0x001030,
            fogColor: 0x002040,
            fogDensity: 0.003,
            ambientLight: 0x003366,
            ambientIntensity: 0.5,
        },

        music: {
            track: 'OceanDeep',
            crossfadeDuration: 4000,
            transitionOutStinger: 'surface-breach',
        },

        narrative: {
            intro: 'Stone gives way to water and pressure eases into flow. The ocean teaches patience before it asks for command.',
            outro: 'Light spills down from above. The sea lifts you toward land, color, and changing seasons...',
        },
        boardTransition: { ...DEFAULT_BOARD_TRANSITION },
    },

    {
        id: 3,
        name: 'Surface World & Living Landscapes',
        subtitle: 'Learn the seasons',
        levelRange: [12, 19],
        arcBeats: ['arrival', 'teach', 'reinforce', 'teach', 'test', 'test', 'release', 'boss'],
        targetDifficultyCurve: [4, 4, 5, 5, 6, 6, 5, 7],

        themes: {
            primary: ['forest', 'moonlit-forest', 'swedish-forest', 'moonlit-greenhouse', 'tornado', 'summer', 'fall'],
            supporting: [],
        },

        environment: {
            skyColor: 0x87ceeb,
            fogColor: 0xc8e6c9,
            fogDensity: 0.0008,
            ambientLight: 0xfff8e7,
            ambientIntensity: 0.8,
        },

        music: {
            track: 'MoonlitForest',
            crossfadeDuration: 3000,
            transitionOutStinger: 'ridgeline-rise',
        },

        narrative: {
            intro: 'You break into daylight and living air. Forests, fields, heat, and wind teach rhythm through contrast instead of pressure.',
            outro: 'The earth begins to rise beneath your feet. Foothills harden into a climb toward colder air and sharper edges...',
        },
        boardTransition: {
            ...DEFAULT_BOARD_TRANSITION,
            seamWidth: 0.03,
            preloadDistance: 0.06,
        },
    },

    {
        id: 4,
        name: 'Mountains & Thin-Air Ascension',
        subtitle: 'Climb the ridgeline',
        levelRange: [20, 27],
        arcBeats: ['arrival', 'teach', 'reinforce', 'reinforce', 'test', 'release', 'test', 'boss'],
        targetDifficultyCurve: [6, 6, 6, 6, 7, 6, 7, 8],

        themes: {
            primary: ['sakura-twilight', 'verdant-hills', 'aurora', 'wolfhour', 'himalayan-peak', 'mountain', 'winter', 'moonrise-summit'],
            supporting: [],
        },

        environment: {
            skyColor: 0x2c3e50,
            fogColor: 0x95a5a6,
            fogDensity: 0.0005,
            ambientLight: 0xbdc3c7,
            ambientIntensity: 0.6,
        },

        music: {
            track: 'HimalayanPeak',
            crossfadeDuration: 3500,
            transitionOutStinger: 'summit-liftoff',
        },

        narrative: {
            intro: 'Foothills turn to ridgelines and the climb becomes deliberate. Every gain in altitude asks for cleaner decisions.',
            outro: 'At the summit, stone gives way to light. The next step is no longer upward through land, but outward into sky...',
        },
        boardTransition: {
            ...DEFAULT_BOARD_TRANSITION,
            seamWidth: 0.06,
        },
    },

    {
        id: 5,
        name: 'Sky & Atmospheric Drift',
        subtitle: 'Cross the last air',
        levelRange: [28, 35],
        arcBeats: ['arrival', 'release', 'reinforce', 'reinforce', 'test', 'reinforce', 'boss', 'boss'],
        targetDifficultyCurve: [7, 6, 6, 6, 8, 7, 9, 9],

        themes: {
            primary: ['sunset', 'starlight', 'aurora', 'nimbus-veil', 'rainy-window', 'aether-tides', 'solar-eclipse', 'lunara'],
            supporting: [],
        },

        environment: {
            skyColor: 0x1a1a2e,
            fogColor: 0x16213e,
            fogDensity: 0.001,
            ambientLight: 0x4a5568,
            ambientIntensity: 0.5,
        },

        music: {
            track: 'Starlight',
            crossfadeDuration: 4000,
            transitionOutStinger: 'atmosphere-edge',
        },

        narrative: {
            intro: 'The mountain drops away beneath you. Clouds, rain, aurora, and eclipse light become the new terrain.',
            outro: 'The last breath of atmosphere fades. What remains ahead is pure distance and the cold logic of space...',
        },
        boardTransition: { ...DEFAULT_BOARD_TRANSITION },
    },

    {
        id: 6,
        name: 'Space & Cosmic Expanse',
        subtitle: 'Push into the void',
        levelRange: [36, 44],
        arcBeats: ['arrival', 'teach', 'reinforce', 'test', 'test', 'test', 'boss', 'release', 'boss'],
        targetDifficultyCurve: [8, 8, 8, 9, 10, 9, 10, 7, 10],

        themes: {
            primary: ['galaxy', 'cosmic-noir', 'supernova', 'blood-moon', 'astral-weave', 'stellar-velocity', 'cosmic-chimes', 'black-hole'],
            supporting: [],
        },

        environment: {
            skyColor: 0x0a0a0a,
            fogColor: 0x1a1a2e,
            fogDensity: 0.005,
            ambientLight: 0x2d3436,
            ambientIntensity: 0.3,
        },

        music: {
            track: 'Galaxy',
            crossfadeDuration: 5000,
            transitionOutStinger: 'lensing-engage',
        },

        narrative: {
            intro: 'You exit the atmosphere into outer space. Vastness replaces familiarity. Stars, planets, and nebulae surround you.',
            outro: 'A darkness grows ahead. Not empty void, but something denser. The event horizon awaits...',
        },
        boardTransition: {
            ...DEFAULT_BOARD_TRANSITION,
            seamWidth: 0.03,
            beatDurationMs: 1100,
            preloadDistance: 0.07,
            fxPreset: 'heavy',
        },
    },

    {
        id: 7,
        name: 'Black Hole & Abstract Transcendence',
        subtitle: 'Surrender to abstraction',
        levelRange: [45, 51],
        arcBeats: ['arrival', 'reinforce', 'test', 'boss', 'test', 'release', 'boss'],
        targetDifficultyCurve: [8, 9, 9, 10, 10, 8, 10],

        themes: {
            primary: ['fluid-dreams', 'nebula-flow', 'chromadelic-highway', 'voltage-storm', 'chromatic-impasto', 'electric-dreams', 'singing-bowl'],
            supporting: [],
        },

        environment: {
            skyColor: 0x000000,
            fogColor: 0x0d0d0d,
            fogDensity: 0.02,
            ambientLight: 0x1a1a1a,
            ambientIntensity: 0.2,
        },

        music: {
            track: 'BlackHole',
            crossfadeDuration: 6000,
            transitionOutStinger: 'neon-snap',
        },

        narrative: {
            intro: 'The journey collapses inward toward a black hole. Space, geometry, and light begin to distort.',
            outro: 'Beyond the singularity, physical reality dissolves. The core journey ends here, in pure abstraction.',
        },
        boardTransition: {
            ...DEFAULT_BOARD_TRANSITION,
            seamWidth: 0.022,
            beatDurationMs: 900,
            preloadDistance: 0.06,
            fxPreset: 'neon',
        },
    },

    {
        id: 8,
        name: 'Urban Dreams Encore',
        subtitle: 'Bonus chapter',
        levelRange: [52, 55],
        arcBeats: ['encore', 'encore', 'encore', 'encore'],
        targetDifficultyCurve: [7, 8, 9, 10],

        themes: {
            primary: ['shifting-sands', 'neon-dusk', 'synthwave-sunset', 'neon-district'],
            supporting: [],
        },

        environment: {
            skyColor: 0x0a0a1a,
            fogColor: 0x1a1020,
            fogDensity: 0.02,
            ambientLight: 0x2a1a3a,
            ambientIntensity: 0.4,
        },

        music: {
            track: 'NeonDistrict',
            crossfadeDuration: 4000,
        },

        narrative: {
            intro: 'A bonus coda unfolds in neon-lit cityscapes. This is an encore: a harder, flashier dream after the true finale.',
            outro: 'The city fades like an afterimage. What remains is the memory of the journey and the pulse of these electric nights.',
        },
        boardTransition: { ...DEFAULT_BOARD_TRANSITION },
    },
];

export default CHAPTER_CONFIGS;
