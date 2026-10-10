/**
 * The twelve breathing worlds: the one place their names, rhythms and copy live.
 *
 * Boot-safe data (no three.js): the guide, both Hub tabs and the session manager read it.
 * Ids are the persisted `breathingTechnique` setting values and must not change.
 * A pattern is [inhale, hold full, exhale, hold empty] in seconds.
 *
 * A world's words for the voice and the guide's hint: `cues` is its own couplet for the breath
 * in and out, `moreCues` four more, `holdCues` and `restCues` its words for a hold (lungs full)
 * and a rest (lungs empty) where its rhythm has them. No two worlds share a wording.
 */
import { MIN_CUE_SECONDS } from './cue-variety.js';

export const BREATH_WORLDS = Object.freeze([
    {
        id: 'deep-relaxation',
        name: 'Aurora Dreams',
        intent: 'Unwind',
        pattern: [5, 2, 7, 2],
        summary: 'A long out-breath under northern lights.',
        description: 'The curtains climb as you breathe in and sink as you let go. The out-breath is the longest part: follow it all the way down.',
        cues: ['Lift the lights', 'Let them fall'],
        moreCues: [
            ['Let the curtains climb', 'Let them sink slowly'],
            ['Raise the aurora', 'Follow it down'],
            ['Let the sky brighten', 'Let it dim, slowly'],
            ['Gather the green light', 'Let it drift away'],
        ],
        holdCues: ['Hold the glow', 'Lights held high', 'Glowing'],
        restCues: ['Deep night', 'A quiet sky', 'Starlight'],
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
        moreCues: [
            ['Trace the light upward', 'Trace it down'],
            ['Climb the square', 'Come back down'],
            ['Rise along the edge', 'Descend the far edge'],
            ['Draw the line up', 'Draw the line down'],
        ],
        holdCues: ['Across the top', 'Carry the light across', 'Steady, along the top'],
        restCues: ['Along the base', 'Close the square', 'Steady, along the base'],
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
        moreCues: [
            ['Widen the silver path', 'Let it fade to a thread'],
            ['Let the moonlight spread', 'Let it gather back'],
            ['Let the water brighten', 'Let the light slip away'],
            ['Draw the moon closer', 'Let it sink into the water'],
        ],
        holdCues: ['Let the light rest on the water', 'Hold the moon still', 'Float in the silver light'],
        accent: [185, 205, 255],
    },
    {
        id: 'energizing',
        name: 'Solar Flare',
        intent: 'Energize',
        pattern: [3, 1, 3, 1],
        summary: 'A brisk, even rhythm to wake up.',
        description: 'The corona streams out on the in-breath and draws back on the out-breath. Short pauses keep the pace lively.',
        cues: ['Let the corona reach', 'Draw it back'],
        moreCues: [
            ['Let the flare rise', 'Let it settle'],
            ['Brighten the sun', 'Draw the light back'],
            ['Wake the sun', 'Let it ease back'],
            ['Let the rays stretch', 'Fold them back'],
        ],
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
        moreCues: [
            ['Open the lotus', 'Close it softly'],
            ['Let the warmth bloom', 'Let it fold away'],
            ['Let the heart widen', 'Let it settle back'],
            ['Unfold, petal by petal', 'Gather them gently'],
        ],
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
        moreCues: [
            ['Spread the colours', 'Draw them together'],
            ['Let the prism shine', 'Let the light gather'],
            ['Open the rainbow', 'Fold the light to white'],
            ['Let the colours pour', 'Bring them to one'],
        ],
        restCues: ['Let the crystal rest', 'Clear, and still', 'Rest in the clear light'],
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
        moreCues: [
            ['Stoke the flames', 'Let go'],
            ['Breathe into the fire', 'And release'],
            ['Fan the embers', 'Let it drop'],
            ['Lift the flame', 'Let it fall'],
        ],
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
        moreCues: [
            ['Let the wave come in', 'Let it draw away'],
            ['Up the sand', 'And back to the sea'],
            ['Let the tide lift you', 'Let it carry you back'],
            ['Swell with the water', 'Ebb with the water'],
        ],
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
        moreCues: [
            ['Let the circle grow', 'Let it come home'],
            ['Across the sand', 'And slowly back'],
            ['Let the ripple travel', 'Let it drift home'],
            ['Widen the circle of light', 'Draw the circle close'],
        ],
        holdCues: ['Rest at the far edge', 'Wide, and still', 'Still, at the edge'],
        restCues: ['Rest at the centre', 'Quiet, at the stone', 'The still centre'],
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
        moreCues: [
            ['Let the galaxy unfold', 'Gather the stars'],
            ['Open into the stars', 'Let them gather'],
            ['Let the spiral widen', 'Let it turn homeward'],
            ['Breathe the stars apart', 'Draw them close again'],
        ],
        holdCues: ['Float among the stars', 'Drift, wide open', 'Weightless'],
        restCues: ['Drift in the quiet', 'Float in the dark', 'Deep space'],
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
        moreCues: [
            ['Let the sunlight fall through', 'Let it settle on the moss'],
            ['Breathe in the light', 'Let it sink to the roots'],
            ['Let the canopy brighten', 'Let the shade return'],
            ['Fill the clearing with light', 'Let it fade to green'],
        ],
        holdCues: ['Hold the light', 'Golden', 'Bright leaves'],
        restCues: ['Rest in the shade', 'A quiet forest', 'Deep shade'],
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
        moreCues: [
            ['Reach for the glass', 'Draw the charge back'],
            ['Let the sparks climb', 'Let them settle'],
            ['Send the filaments wide', 'Call them back'],
            ['Let the light crackle up', 'Let it quiet'],
        ],
        holdCues: ['Hold the charge', 'Charged', 'Crackling'],
        accent: [160, 185, 255],
    },
]);

/** Heart Glow: open from the start, the most even of the starter worlds. */
export const DEFAULT_BREATH_WORLD = 'coherence';

const BY_ID = new Map(BREATH_WORLDS.map((world) => [world.id, world]));

/** @param {string} id */
export function getBreathWorld(id) {
    return BY_ID.get(id) || BY_ID.get(DEFAULT_BREATH_WORLD);
}

export function isBreathWorld(id) {
    return BY_ID.has(id);
}

/**
 * A world's cue couplets and the voice lines that speak them: its own `cues` first
 * ('worlds/<id>_in', '_out'), then each of `moreCues` ('_in_2', '_out_2', ...). The voice keeps a
 * couplet together: the out-breath answers the in-breath it follows. A world whose out-breath is
 * too short to speak on (Volcanic Fire's one second) has no out line: those words are for the
 * guide only.
 * @returns {{in: string, out: string|null, words: string[]}[]}
 */
export function worldCuePairs(id) {
    const world = getBreathWorld(id);
    const sayOut = world.pattern[2] >= MIN_CUE_SECONDS;
    return [world.cues, ...(world.moreCues || [])].map((words, index) => {
        const take = index ? `_${index + 1}` : '';
        return { in: `worlds/${world.id}_in${take}`, out: sayOut ? `worlds/${world.id}_out${take}` : null, words };
    });
}

/**
 * A world's words for its pauses and the voice lines that speak them: `hold` with the lungs full
 * (`holdCues`: 'worlds/<id>_hold', '_hold_2', ...) and `rest` with them empty (`restCues`:
 * 'worlds/<id>_rest', ...). A world whose rhythm has no such pause has no words for it.
 * @returns {{hold: {id: string, words: string}[], rest: {id: string, words: string}[]}}
 */
export function worldPauseCues(id) {
    const world = getBreathWorld(id);
    const takes = (part, words = []) => words.map((text, index) => ({
        id: `worlds/${world.id}_${part}${index ? `_${index + 1}` : ''}`,
        words: text,
    }));
    return { hold: takes('hold', world.holdCues), rest: takes('rest', world.restCues) };
}

/** "5 · 2 · 7 · 2", leaving out the phases a pattern skips. */
export function formatPattern(pattern) {
    return pattern.filter((seconds) => seconds > 0).join(' · ');
}

/** Still artwork for a world, rendered from the live scene by scripts/capture-breathing-posters.mjs. */
export function breathPosterUrl(id) {
    return `./assets/breathing/${getBreathWorld(id).id}.webp`;
}
