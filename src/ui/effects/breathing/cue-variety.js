/**
 * Variety for the spoken breath cues. A cue is a pool of takes, each with its own words and its
 * own recording: a guided run opens on the plain words ("Breathe in"), then draws from every
 * take ("Let the breath arrive"), and each take is heard before any comes round again, never the
 * same one twice running. One voice that sounds like it is listening, not a clip on a loop.
 *
 * Boot-safe data and plain functions: the session data, the session manager, the Breathing tab's
 * voice and the audio manager's preload read them.
 */

/** A pause (the hold, the rest) shorter than this has no room for words. */
export const MIN_CUE_SECONDS = 1.5;
/**
 * The breath in or out has room for quick words down to this length: the fire breath's
 * one-second out-breath still says "Out now". Quick takes are said crisply, in a delivery of their
 * own without the calm tags or a drawn-out ending, so they fit it.
 */
export const MIN_QUICK_CUE_SECONDS = 1;

/**
 * Whether a part of a breath this long has room for words (a take must still fit it).
 * @param {string} part 'in', 'hold', 'out' or 'rest'
 * @param {number} seconds how long that part lasts
 */
export function roomForWords(part, seconds) {
    return seconds >= (part === 'in' || part === 'out' ? MIN_QUICK_CUE_SECONDS : MIN_CUE_SECONDS);
}

/**
 * A cue's takes, from its words. The first take is line '<group>/<stem>', the next
 * '<group>/<stem>_2', and so on, in the order written.
 * @param {string} group the script group, e.g. 'cues_first'
 * @param {string} stem e.g. 'in', 'round_out', 'hold'
 * @param {string[]|{plain?: string[], more?: string[], quick?: boolean}} words the words of each
 *   take; `plain` ones open a guided run; `quick` takes are for a breath of a second, said crisply
 * @returns {{plain: object[], all: object[], quick: boolean}} takes: { id, words, plain }
 */
export function cuePool(group, stem, words) {
    const plain = Array.isArray(words) ? [] : (words.plain || []);
    const more = Array.isArray(words) ? words : (words.more || []);
    const all = [...plain, ...more].map((text, index) => Object.freeze({
        id: `${group}/${stem}${index ? `_${index + 1}` : ''}`,
        words: text,
        plain: index < plain.length,
    }));
    return Object.freeze({
        plain: Object.freeze(all.filter((take) => take.plain)),
        all: Object.freeze(all),
        quick: !Array.isArray(words) && words.quick === true,
    });
}

/** Every line a cue can speak. */
export function cueLines(pool) {
    return pool ? pool.all.map((take) => take.id) : [];
}

/**
 * Draws takes for a slot (one cue, or one world's couplets): a take that has been heard is not
 * drawn again until the others on offer have been, whichever of them the breath has room for
 * and whether it opened a run or not, and never the same take twice in a row.
 * @param {() => number} [random]
 * @returns {(slot: string, choices: string[], prefer?: string|null) => string|null} draw a take;
 *   `prefer` asks for a particular one (a world's own words on its first breath)
 */
export function createCueDraw(random = Math.random) {
    /** Slot to the takes heard since they last came round. */
    const heard = new Map();
    /** Slot to its takes in the order last heard, oldest first. */
    const recency = new Map();
    return (slot, choices, prefer = null) => {
        if (!choices?.length) return null;
        const said = heard.get(slot) || new Set();
        const order = recency.get(slot) || [];
        const last = order[order.length - 1];
        let options = choices.filter((id) => !said.has(id) && id !== last);
        if (!options.length) {
            // Every take on offer has been heard: they come round again, the one heard longest
            // ago first (so two takes that open a run take turns).
            choices.forEach((id) => said.delete(id));
            const rested = choices.filter((id) => id !== last);
            options = rested.length
                ? [rested.reduce((oldest, id) => (order.indexOf(id) < order.indexOf(oldest) ? id : oldest))]
                : choices;
        }
        const pick = prefer && choices.includes(prefer)
            ? prefer : options[Math.min(options.length - 1, Math.floor(random() * options.length))];
        said.add(pick);
        heard.set(slot, said);
        recency.set(slot, [...order.filter((id) => id !== pick), pick]);
        return pick;
    };
}

/**
 * One take of a cue that can be said now.
 * @param {ReturnType<typeof createCueDraw>} draw
 * @param {{plain: object[], all: object[]}|object[]|null} pool a cue pool, or a list of takes
 * @param {(id: string) => boolean} fits whether a take is recorded and short enough for the breath
 * @param {{plain?: boolean, slot?: string}} [options] `plain`: this breath opens a guided run.
 *   The plain words are kept for opening a run and its other breaths take the other wordings,
 *   so a run never says one take twice; either gives way when none of its kind fits
 * @returns {{id: string, words: string, plain?: boolean}|null}
 */
export function drawTake(draw, pool, fits, { plain = false, slot } = {}) {
    const all = Array.isArray(pool) ? pool : pool?.all;
    if (!all?.length) return null;
    const fitting = all.filter((take) => fits(take.id));
    const wanted = fitting.filter((take) => Boolean(take.plain) === plain);
    const takes = wanted.length ? wanted : fitting;
    const id = draw(slot || all[0].id, takes.map((take) => take.id));
    return takes.find((take) => take.id === id) || null;
}
