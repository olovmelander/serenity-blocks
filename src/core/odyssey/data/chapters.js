/**
 * @fileoverview Odyssey Mode Chapter Configurations
 *
 * Defines the eight chapters of Odyssey Mode, each representing a stage
 * of cosmic ascent from Earth's core to abstract transcendence and urban dreams.
 */

export const CHAPTER_CONFIGS = [
    {
        id: 1,
        name: 'Earth Core & Subterranean Origins',
        subtitle: 'Begin your ascent',
        levelRange: [1, 5],

        themes: {
            primary: ['crystal-cave', 'cinder-drift', 'geode', 'pyrestorm', 'bioluminescence'],
            supporting: [],
        },

        environment: {
            skyColor: 0x1a0a00,
            fogColor: 0x2d1500,
            fogDensity: 0.015,  // Increased for better crater edge fog effect
            ambientLight: 0x331100,
            ambientIntensity: 0.4,
        },

        music: {
            track: 'Ambient', // Use existing track for now
            crossfadeDuration: 3000,
        },

        narrative: {
            intro: 'The journey begins deep within the Earth\'s core. Pressure surrounds you, but crystal light shows the way.',
            outro: 'You emerge from the molten depths. Above, you sense the vast liquid worlds waiting...',
        },

        unlockRequirement: null, // First chapter always unlocked
    },

    {
        id: 2,
        name: 'Deep Ocean & Liquid Worlds',
        subtitle: 'Descend into the deep',
        levelRange: [6, 11],

        themes: {
            primary: ['ocean', 'luminous-tides', 'stillwater', 'koi-pond', 'waves', 'misty-lake'],
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
            track: 'Ambient',
            crossfadeDuration: 4000,
        },

        narrative: {
            intro: 'Rock dissolves into water as you descend into the deep ocean. Bioluminescent life pulses gently around you.',
            outro: 'Light breaks through above. The surface world awaits, full of life and color...',
        },

        unlockRequirement: {
            type: 'complete-chapter',
            value: 1,
        },
    },

    {
        id: 3,
        name: 'Surface World & Living Landscapes',
        subtitle: 'Embrace the light',
        levelRange: [12, 21],

        themes: {
            primary: ['forest', 'moonlit-forest', 'swedish-forest', 'moonlit-greenhouse', 'tornado', 'summer', 'fall', 'meadow', 'sakura-twilight', 'verdant-hills'],
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
            track: 'Ambient',
            crossfadeDuration: 3000,
        },

        narrative: {
            intro: 'You break the surface into open, breathable natural environments. Light, wind, and life surround you.',
            outro: 'The horizon calls upward. Mountains pierce the sky, challenging you to climb higher...',
        },

        unlockRequirement: {
            type: 'complete-chapter',
            value: 2,
        },
    },

    {
        id: 4,
        name: 'Mountains & Thin-Air Ascension',
        subtitle: 'Scale the heights',
        levelRange: [22, 30],

        themes: {
            primary: ['aurora', 'wolfhour', 'himalayan-peak', 'mountain', 'winter', 'moonrise-summit', 'sunset', 'starlight', 'ice-temple'],
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
            track: 'Ambient',
            crossfadeDuration: 3500,
        },

        narrative: {
            intro: 'Elevation becomes the focus. The air grows thin as you ascend through towering peaks and icy ridges.',
            outro: 'The summit passes beneath you. Above, only sky remains. Gravity begins to loosen its grip...',
        },

        unlockRequirement: {
            type: 'complete-chapter',
            value: 3,
        },
    },

    {
        id: 5,
        name: 'Sky & Atmospheric Drift',
        subtitle: 'Float among clouds',
        levelRange: [31, 35],

        themes: {
            primary: ['nimbus-veil', 'rainy-window', 'aether-tides', 'solar-eclipse', 'lunara'],
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
            track: 'Ambient',
            crossfadeDuration: 4000,
        },

        narrative: {
            intro: 'Gravity loosens as you float into the sky. Clouds, mist, and auroras surround the path.',
            outro: 'The atmosphere thins to nothing. Stars beckon from the cosmic expanse beyond...',
        },

        unlockRequirement: {
            type: 'complete-chapter',
            value: 4,
        },
    },

    {
        id: 6,
        name: 'Space & Cosmic Expanse',
        subtitle: 'Journey through stars',
        levelRange: [36, 44],

        themes: {
            primary: ['galaxy', 'cosmic-noir', 'supernova', 'blood-moon', 'astral-weave', 'stellar-drift', 'stellar-velocity', 'cosmic-chimes', 'black-hole'],
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
            track: 'Ambient',
            crossfadeDuration: 5000,
        },

        narrative: {
            intro: 'You exit the atmosphere into outer space. Vastness replaces familiarity. Stars, planets, and nebulae surround you.',
            outro: 'A darkness grows ahead. Not empty void, but something denser. The event horizon awaits...',
        },

        unlockRequirement: {
            type: 'complete-chapter',
            value: 5,
        },
    },

    {
        id: 7,
        name: 'Black Hole & Abstract Transcendence',
        subtitle: 'Beyond reality',
        levelRange: [45, 51],

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
            track: 'Ambient',
            crossfadeDuration: 6000,
        },

        narrative: {
            intro: 'The journey collapses inward toward a black hole. Space, geometry, and light begin to distort.',
            outro: 'Beyond the singularity, physical reality dissolves. You have transcended. The journey is complete.',
        },

        unlockRequirement: {
            type: 'complete-chapter',
            value: 6,
        },
    },

    {
        id: 8,
        name: 'Urban Dreams',
        subtitle: 'Neon reflections',
        levelRange: [52, 55],

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
            track: 'Ambient',
            crossfadeDuration: 4000,
        },

        narrative: {
            intro: 'A detour through neon-lit cityscapes. Rain reflects the glow of countless signs as you drift through urban dreams.',
            outro: 'The city fades into memory. The cosmic journey continues, but these electric nights remain with you.',
        },

        unlockRequirement: {
            type: 'complete-chapter',
            value: 7,
        },
    },
];

export default CHAPTER_CONFIGS;
