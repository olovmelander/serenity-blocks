// @ts-check

/**
 * Which Fault Lines puzzles this player has solved, and which one to play next. The mode
 * reads and records it; the HUD restores it from storage at load and saves it after a
 * solve, so the mode itself never touches storage.
 */

import { FAULT_LINES_PUZZLES, openPuzzleIds } from './puzzle-bank.js';

/** @type {Set<string>} */
const solved = new Set();
/** @type {string | null} */
let chosen = null;

const known = (/** @type {unknown} */ id) => typeof id === 'string'
    && FAULT_LINES_PUZZLES.some((puzzle) => puzzle.id === id);

export const faultLinesProgress = {
    /** @param {Iterable<unknown>} ids saved solves; unknown ids are dropped */
    restore(ids) {
        solved.clear();
        for (const id of ids) if (known(id)) solved.add(/** @type {string} */ (id));
    },

    /** @returns {string[]} */
    solvedIds() {
        return [...solved];
    },

    /** @param {string} id @returns {boolean} whether it was a first solve */
    markSolved(id) {
        if (!known(id) || solved.has(id)) return false;
        solved.add(id);
        return true;
    },

    /** Picks the puzzle the next start plays. @param {string} id */
    choose(id) {
        if (known(id)) chosen = id;
    },

    /** @returns {Set<string>} */
    openIds() {
        return openPuzzleIds(solved);
    },

    /**
     * The chosen puzzle if it is open, else the first open one not yet solved, else
     * the first puzzle.
     * @returns {string}
     */
    current() {
        const open = openPuzzleIds(solved);
        if (chosen && open.has(chosen)) return chosen;
        return FAULT_LINES_PUZZLES.find((p) => open.has(p.id) && !solved.has(p.id))?.id
            ?? FAULT_LINES_PUZZLES[0].id;
    },

    /**
     * The open puzzle after `id`, preferring unsolved ones; null at the end.
     * @param {string} id
     * @returns {string | null}
     */
    after(id) {
        const open = openPuzzleIds(solved);
        const index = FAULT_LINES_PUZZLES.findIndex((p) => p.id === id);
        const later = FAULT_LINES_PUZZLES.slice(index + 1).filter((p) => open.has(p.id));
        return (later.find((p) => !solved.has(p.id)) || later[0])?.id ?? null;
    },
};
