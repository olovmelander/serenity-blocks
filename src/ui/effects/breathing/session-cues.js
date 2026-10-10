/**
 * The breath cues of each Hale session: its own words for the breath in, the breath out, the
 * hold (lungs full) and the rest (lungs empty), in its own recordings. No session borrows
 * another's. A guided run opens on a `plain` take, then draws from all of them
 * (cue-variety.js); the session manager only says a take that ends inside the breath it is
 * spoken on. On every fifth breath the world's own words take over (breath-catalogue.js).
 *
 * Each list is a script group `cues_<session>` in scripts/tts-script.json: the first take of
 * `in` is 'cues_first/in', the next 'cues_first/in_2', and a named set's ('settle', 'round')
 * 'cues_base/settle_in'. A test holds the script to these words.
 *
 * An in-breath cue never says "out" or "down", an out-breath cue never "in": the word heard
 * must agree with the breath. Boot-safe data: no audio, no three.js.
 */
import { cuePool } from './cue-variety.js';

const WORDS = {
    FIRST: {
        main: {
            in: {
                plain: ['Breathe in', 'Breathe in, softly'],
                more: ['A gentle breath in', 'Let the breath arrive', 'Softly, through the nose', 'An easy breath in'],
            },
            out: {
                plain: ['Breathe out', 'Breathe out, gently'],
                more: ['A gentle breath out', 'Let it leave, slowly', 'Softly, all the way out', 'An easy breath out'],
            },
            hold: ['Pause', 'A soft pause', 'Rest here'],
            rest: ['And pause', 'Stay soft', 'Wait'],
        },
    },
    TIDE: {
        main: {
            in: {
                plain: ['Breathe in, with the sea', 'And breathe in'],
                more: [
                    'In, as the wave arrives', 'Gather, like the swell',
                    'Let the sea breathe you in', 'In, on the rising water',
                ],
            },
            out: {
                plain: ['Breathe out, with the sea', 'And breathe out'],
                more: [
                    'Out, as it slides away', 'Release, like the foam',
                    'Let the sea breathe you out', 'Out, on the falling water',
                ],
            },
        },
    },
    ROOTS: {
        main: {
            in: {
                plain: ['Breathe in, steadily', 'A steady breath in'],
                more: ['Draw the breath up', 'Up from the ground', 'In, tall as a tree', 'Fill, from the roots'],
            },
            out: {
                plain: ['A long breath out', 'Breathe out, all the way'],
                more: ['Down into the earth', 'Send it down the roots', 'Heavy, into the ground', 'Long, and low'],
            },
            hold: ['Stay tall', 'A moment', 'Reach'],
            rest: ['Rooted', 'Rest low', 'Held'],
        },
    },
    UNWIND: {
        main: {
            in: {
                plain: ['Breathe in, gently', 'A soft breath in'],
                more: ['An unhurried breath in', 'Let the breath come', 'In, without effort', 'Softly, fill'],
            },
            out: {
                plain: ['A longer breath out', 'Breathe out, unhurried'],
                more: ['A long sigh out', 'Let the day go', 'Out, a little longer', 'Let it all drift out'],
            },
            hold: ['Linger', 'Float here', 'Quiet'],
            rest: ['Nothing to do', 'Let it be', 'Easy'],
        },
    },
    SUNRISE: {
        main: {
            in: {
                plain: ['Breathe in, lightly', 'In'],
                more: ['In with the light', 'Fresh air in', 'Wake the body', 'A bright breath in'],
            },
            out: {
                plain: ['Breathe out, lightly', 'Out'],
                more: ['Easy out', 'A light breath out', 'Let it go lightly', 'And out'],
            },
        },
    },
    REST: {
        main: {
            in: {
                plain: ['Breathe in, quietly', 'In, slow and soft'],
                more: ['A quiet breath in', 'Through the nose, slowly', 'Let the night air in', 'Gently, to the top'],
            },
            out: {
                plain: ['Slow breath out', 'Breathe out, slowly'],
                more: [
                    'Long, and slow', 'All the way out, unhurried', 'Let the day drain away', 'Slowly, to the very end',
                ],
            },
            hold: ['Hold gently', 'Hold softly', 'Rest at the top', 'Stay full, and soft', 'Let the breath be still'],
        },
    },
    FLOW: {
        main: {
            in: {
                plain: ['Breathe in, evenly', 'In, for the count'],
                more: ['Draw the first side', 'In, even and steady', 'Build the shape', 'One side, in'],
            },
            out: {
                plain: ['Breathe out, evenly', 'Out, for the count'],
                more: ['Draw the next side', 'Out, even and steady', 'Smooth, all the way', 'One side, out'],
            },
            hold: ['Hold', 'And hold', 'Hold the line', 'Steady, and full'],
            rest: ['Rest', 'And rest', 'Empty, and even', 'Steady, and empty'],
        },
    },
    BASE: {
        // The arrival: slow and nasal.
        settle: {
            in: { plain: ['Breathe in, slowly'], more: ['A slow breath in', 'Let the belly rise', 'In, and widen'] },
            out: {
                plain: ['Breathe out, easily'], more: ['A slow breath out', 'Let the belly fall', 'Out, and soften'],
            },
            hold: ['Hold a moment', 'Stay full', 'Steady'],
            rest: ['Be still', 'Rest empty', 'Empty'],
        },
        // The rounds: steady, full, through the nose.
        round: {
            in: {
                plain: ['Breathe in, fully', 'In through the nose'],
                more: ['Belly, then chest', 'Fill from the belly', 'A full breath in', 'Steady, to the top'],
            },
            out: {
                plain: ['Breathe out, freely', 'And let it go'],
                more: ['Let it fall away', 'Out, without pushing', 'A free breath out', 'Soften, and out'],
            },
        },
        // The recovery breath lets go.
        release: { out: ['Now, let it go', 'Let the breath out', 'Release, slowly'] },
    },
    ELIXIR: {
        settle: {
            in: { plain: ['Breathe in, calmly'], more: ['Through the nose, in', 'A calm breath in', 'In, and settle'] },
            out: { plain: ['Breathe out, calmly'], more: ['Slowly, out', 'A calm breath out', 'Out, and settle'] },
        },
        // The rounds: strong, connected breaths through the mouth, three seconds in and two out:
        // room for calm words on the out-breath too.
        round: {
            in: {
                plain: ['Fully in', 'Breathe in, deep'],
                more: ['And in', 'Fill up', 'A big breath in', 'In, through the mouth'],
            },
            out: {
                plain: ['Let it go', 'Let it out'],
                more: ['And let go', 'Then out', 'Exhale', 'Out again'],
            },
        },
        release: { out: ['Let it all go', 'Breathe out, and let go', 'Release, all of it'] },
    },
};

const PARTS = ['in', 'out', 'hold', 'rest'];

/**
 * Every session's cue sets, as pools of takes: SESSION_CUES.BASE.round.in.all[0] is
 * { id: 'cues_base/round_in', words: 'Breathe in', plain: true }.
 */
export const SESSION_CUES = Object.freeze(Object.fromEntries(Object.entries(WORDS).map(([sessionId, sets]) => [
    sessionId,
    Object.freeze(Object.fromEntries(Object.entries(sets).map(([setName, parts]) => [
        setName,
        Object.freeze(Object.fromEntries(PARTS.filter((part) => parts[part]).map((part) => [
            part,
            cuePool(`cues_${sessionId.toLowerCase()}`, setName === 'main' ? part : `${setName}_${part}`, parts[part]),
        ]))),
    ]))),
])));

/** Every take of every session, for the script and its tests: [{ sessionId, id, words }]. */
export function sessionCueTakes() {
    return Object.entries(SESSION_CUES).flatMap(([sessionId, sets]) => Object.values(sets)
        .flatMap((set) => Object.values(set).flatMap((pool) => pool.all.map((take) => ({ sessionId, ...take })))));
}
