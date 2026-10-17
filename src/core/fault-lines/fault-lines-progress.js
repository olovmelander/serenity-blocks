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
    /**
     * Saved solves. An id the bank no longer has (a puzzle renamed or retired) is kept
     * and written back untouched, so a save never loses a solve.
     * @param {Iterable<unknown>} ids
     */
    restore(ids) {
        solved.clear();
        for (const id of ids) if (typeof id === 'string') solved.add(id);
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
     * The puzzle to go on to after `id`: the next open unsolved one, else an earlier open
     * unsolved one, else the next open one; null when nothing else is open.
     * @param {string} id
     * @returns {string | null}
     */
    after(id) {
        const open = openPuzzleIds(solved);
        const index = FAULT_LINES_PUZZLES.findIndex((p) => p.id === id);
        const later = FAULT_LINES_PUZZLES.slice(index + 1).filter((p) => open.has(p.id));
        const earlier = FAULT_LINES_PUZZLES.slice(0, Math.max(0, index)).filter((p) => open.has(p.id));
        const unsolved = (/** @type {{ id: string }} */ p) => !solved.has(p.id);
        return (later.find(unsolved) || earlier.find(unsolved) || later[0])?.id ?? null;
    },

    /** @returns {boolean} whether every puzzle in the bank is solved */
    allSolved() {
        return FAULT_LINES_PUZZLES.every((p) => solved.has(p.id));
    },
};
