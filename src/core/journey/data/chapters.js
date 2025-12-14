/**
 * @fileoverview Journey Mode Chapter Configurations
 *
 * Defines the seven chapters of Journey Mode, each representing a stage
 * of cosmic ascent from Earth's core to abstract transcendence.
 */

export const CHAPTER_CONFIGS = [
    {
        id: 1,
        name: 'Earth Core & Subterranean Origins',
        subtitle: 'Begin your ascent',
        levelRange: [1, 8],

        themes: {
            primary: ['crystal-cave', 'geode', 'cinder-drift', 'pyrestorm'],
            supporting: ['bioluminescence', 'cosmic-noir'],
        },

        environment: {
            skyColor: 0x1a0a00,
            fogColor: 0x2d1500,
            fogDensity: 0.03,
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
        levelRange: [9, 16],

        themes: {
            primary: ['ocean', 'bioluminescence', 'luminous-tides', 'stillwater'],
            supporting: ['waves', 'koi-pond'],
        },

        environment: {
            skyColor: 0x001030,
            fogColor: 0x002040,
            fogDensity: 0.02,
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
        levelRange: [17, 24],

        themes: {
            primary: ['forest', 'meadow', 'spring', 'summer', 'fall', 'verdant-hills'],
            supporting: ['sakura-twilight', 'swedish-forest', 'misty-lake', 'moonlit-greenhouse', 'sunset'],
        },

        environment: {
            skyColor: 0x87ceeb,
            fogColor: 0xc8e6c9,
            fogDensity: 0.01,
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
        levelRange: [25, 32],

        themes: {
            primary: ['mountain', 'himalayan-peak', 'ice-temple', 'winter', 'moonrise-summit'],
            supporting: ['moonlit-forest', 'wolfhour'],
        },

        environment: {
            skyColor: 0x2c3e50,
            fogColor: 0x95a5a6,
            fogDensity: 0.015,
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
        levelRange: [33, 40],

        themes: {
            primary: ['nimbus-veil', 'aurora'],
            supporting: ['starlight', 'wolfhour'],
        },

        environment: {
            skyColor: 0x1a1a2e,
            fogColor: 0x16213e,
            fogDensity: 0.008,
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
        levelRange: [41, 48],

        themes: {
            primary: ['galaxy', 'stellar-drift', 'astral-weave', 'solar-eclipse', 'supernova'],
            supporting: ['lunara', 'blood-moon', 'aether-tides', 'cosmic-chimes', 'stellar-velocity'],
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
        levelRange: [49, 56],

        themes: {
            primary: ['black-hole', 'nebula-flow', 'fluid-dreams'],
            supporting: ['chromadelic-highway', 'chromatic-impasto', 'electric-dreams', 'voltage-storm', 'singing-bowl'],
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
        levelRange: [57, 60],

        themes: {
            primary: ['rainy-window', 'neon-dusk', 'neon-district', 'synthwave-sunset'],
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
