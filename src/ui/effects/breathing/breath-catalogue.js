/**
 * The twelve breathing worlds: the one place their names, rhythms and copy live.
 *
 * Boot-safe data (no three.js): the guide, both Hub tabs and the session manager read it.
 * Ids are the persisted `breathingTechnique` setting values and must not change.
 * A pattern is [inhale, hold full, exhale, hold empty] in seconds.
 */
export const BREATH_WORLDS = Object.freeze([
    {
        id: 'deep-relaxation',
        name: 'Aurora Dreams',
        intent: 'Unwind',
        pattern: [5, 2, 7, 2],
        summary: 'A long out-breath under northern lights.',
        description: 'The curtains climb as you breathe in and sink as you let go. The out-breath is the longest part: follow it all the way down.',
        cues: ['Lift the lights', 'Let them fall'],
        accent: [110, 240, 190],
    },
    {
        id: 'box-breathing',
        name: 'Sacred Geometry',
        intent: 'Focus',
        pattern: [4, 4, 4, 4],
        summary: 'Four equal sides: in, hold, out, hold.',
        description: 'Light travels one side of the square for each count of four. Even sides steady the attention.',
        cues: ['Up the first side', 'Down the third side'],
        accent: [240, 205, 140],
    },
    {
        id: 'calm-sleep',
        name: 'Moonlit Waters',
        intent: 'Sleep',
        pattern: [4, 7, 8, 0],
        summary: 'In for 4, hold for 7, out for 8.',
        description: 'The moon’s path opens across the water as you breathe in, rests while you hold, and narrows through a slow out-breath.',
        cues: ['Open the moon-path', 'Let it narrow'],
        accent: [185, 205, 255],
    },
    {
        id: 'energizing',
        name: 'Solar Flare',
        intent: 'Energize',
        pattern: [3, 1, 3, 1],
        summary: 'A brisk, even rhythm to wake up.',
        description: 'The corona streams out on the in-breath and draws back on the out-breath. Short pauses keep the pace lively.',
        cues: ['Let the corona reach', 'Draw it back in'],
        accent: [255, 190, 90],
    },
    {
        id: 'coherence',
        name: 'Heart Glow',
        intent: 'Balance',
        pattern: [5, 0, 5, 0],
        summary: 'Five in, five out, no pauses.',
        description: 'The lotus opens as you breathe in and folds as you breathe out: about six breaths a minute, smooth and continuous.',
        cues: ['Let the petals open', 'Let them fold'],
        accent: [255, 160, 190],
    },
    {
        id: 'triangle',
        name: 'Crystal Prism',
        intent: 'Clarity',
        pattern: [4, 0, 4, 4],
        summary: 'Three sides: in, out, rest.',
        description: 'Light fans into colour on the in-breath, gathers on the out-breath, and the crystal rests before the next one.',
        cues: ['Fan the light', 'Gather it'],
        accent: [150, 235, 240],
    },
    {
        id: 'wim-hof',
        name: 'Volcanic Fire',
        intent: 'Activate',
        pattern: [2, 0, 1, 0],
        summary: 'Quick, full breaths. The strongest rhythm here.',
        description: 'The fire leaps on a fast in-breath and drops on a short release. Strong breathing can make you light-headed: sit down for it, and stop if you feel dizzy.',
        cues: ['Feed the fire', 'Release'],
        accent: [255, 140, 80],
    },
    {
        id: 'ocean-breath',
        name: 'Ocean Tide',
        intent: 'Calm',
        pattern: [4, 0, 4, 0],
        summary: 'A wave in, a wave out.',
        description: 'The wave runs up the sand as you breathe in and slides back as you breathe out. Nothing to count: follow the water.',
        cues: ['Rise with the wave', 'Slide back'],
        accent: [120, 225, 225],
    },
    {
        id: 'zen-garden',
        name: 'Zen Garden',
        intent: 'Stillness',
        pattern: [6, 3, 6, 3],
        summary: 'Slow, spacious breaths with quiet pauses.',
        description: 'A ring of light travels out across the raked sand on the in-breath and returns on the out-breath, resting at each end.',
        cues: ['Let the ring widen', 'Let it return'],
        accent: [215, 220, 190],
    },
    {
        id: 'cosmic-breath',
        name: 'Cosmic Nebula',
        intent: 'Expand',
        pattern: [5, 3, 5, 3],
        summary: 'Wide, even breaths with room to float.',
        description: 'The galaxy opens its arms as you breathe in and gathers as you breathe out, drifting through each pause.',
        cues: ['Let the arms open', 'Gather inward'],
        accent: [200, 160, 255],
    },
    {
        id: 'forest-breath',
        name: 'Ancient Forest',
        intent: 'Ground',
        pattern: [4, 2, 6, 2],
        summary: 'A steady in-breath and a longer release.',
        description: 'Light pours through the canopy as you breathe in and softens as you breathe out. The longer out-breath settles you.',
        cues: ['Let the light pour in', 'Let it soften'],
        accent: [165, 230, 150],
    },
    {
        id: 'electric-storm',
        name: 'Electric Storm',
        intent: 'Sharpen',
        pattern: [3, 2, 4, 1],
        summary: 'A charged, uneven rhythm for alertness.',
        description: 'Filaments reach for the glass on the in-breath, hold their charge, and withdraw on a slightly longer out-breath.',
        cues: ['Let the charge reach', 'Draw it home'],
        accent: [160, 185, 255],
    },
]);

export const DEFAULT_BREATH_WORLD = 'deep-relaxation';

const BY_ID = new Map(BREATH_WORLDS.map((world) => [world.id, world]));

/** @param {string} id */
export function getBreathWorld(id) {
    return BY_ID.get(id) || BY_ID.get(DEFAULT_BREATH_WORLD);
}

export function isBreathWorld(id) {
    return BY_ID.has(id);
}

/** "5 · 2 · 7 · 2", leaving out the phases a pattern skips. */
export function formatPattern(pattern) {
    return pattern.filter((seconds) => seconds > 0).join(' · ');
}

/** Still artwork for a world, rendered from the live scene by scripts/capture-breathing-posters.mjs. */
export function breathPosterUrl(id) {
    return `./assets/breathing/${getBreathWorld(id).id}.webp`;
}
