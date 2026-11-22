/**
 * Attack size in a local match follows the versus crowd rule (versus-rules.js): attacks keep
 * full size while four or fewer players are alive. Past that, each placed piece earns a crowd
 * stamp (three per extra living player at most) and every three stamps take one row off a
 * normal attack. A move that empties the board, and boring rules, are never cut.
 */
import { describe, expect, it, vi } from 'vitest';
import { COLS } from '../../src/core/constants.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { ATTACK_TYPES } from '../../src/core/garbage.js';

const col0 = () => Array.from({ length: COLS }, (_, column) => column === 0);

/** Lines cleared by one piece; a clear of n sends n - 1 rows. */
const clearOf = (depth, extra = {}) => ({
    depth,
    complexity: 1,
    holeMask: Array.from({ length: depth }, col0),
    manualColumns: [0],
    ...extra,
});

function match(players, config = {}) {
    const state = new MultiPlayerState(players);
    state.players.forEach((player) => { player.isAlive = true; });
    state.setPlayerHandicaps(Array(players).fill(2));
    state.setMatchConfig(config);
    return state;
}

const queued = (state, index) => state.garbageQueues[index].getTotalLines();

/** Place `pieces` pieces for one player, earning its crowd stamps. */
function place(state, index, pieces) {
    for (let i = 0; i < pieces; i += 1) state.notePiecePlaced(index);
}

describe('attack size in a local match', () => {
    it.each([2, 3, 4])('with %i players a clear of 5 sends 4 rows to each opponent', (players) => {
        const state = match(players);
        place(state, 0, 30);

        state.handleGarbageSummary(0, clearOf(5), null);

        for (let target = 1; target < players; target += 1) {
            expect(queued(state, target)).toBe(4);
        }
    });

    it('earns no crowd stamps while four or fewer players are alive', () => {
        const state = match(4);
        place(state, 0, 30);
        expect(state.crowdStamps[0]).toBe(0);
    });

    it('earns up to three stamps per living player past four', () => {
        const state = match(6);
        place(state, 0, 30);
        expect(state.crowdStamps[0]).toBe(6);

        state.players[5].isAlive = false;
        place(state, 0, 1); // the cap drops with the players
        expect(state.crowdStamps[0]).toBe(3);
    });

    it('takes one row off a normal attack for every three stamps, and spends them', () => {
        const state = match(6);
        place(state, 0, 6);

        state.handleGarbageSummary(0, clearOf(5), null);

        expect(queued(state, 1)).toBe(2);
        expect(state.crowdStamps[0]).toBe(0);
    });

    it('never cuts a move that empties the board', () => {
        const state = match(6);
        place(state, 0, 6);

        state.handleGarbageSummary(0, clearOf(5, { sendForPerfectClear: true }), null);

        expect(queued(state, 1)).toBe(4 + 3); // four rows plus the clean bonus of (1 + 5) / 2
        expect(state.crowdStamps[0]).toBe(6);
    });

    it('never cuts with boring rules on', () => {
        const state = match(6, { boringRules: true });
        place(state, 0, 6);

        state.handleGarbageSummary(0, clearOf(5), null);

        expect(queued(state, 1)).toBe(4);
    });

    it('tells the HUD what the opponents really receive', () => {
        const state = match(6);
        place(state, 0, 3);
        state.onAttack = vi.fn();

        state.handleGarbageSummary(0, clearOf(5), null);

        expect(state.onAttack).toHaveBeenCalledWith(0, [1, 2, 3, 4, 5], 3);
        expect(queued(state, 1)).toBe(3);
    });

    it('records the rows that were sent', () => {
        const state = match(4);

        state.handleGarbageSummary(0, clearOf(5), null);

        expect(state.getPlayerMetrics(0).attackLinesSent).toBe(12); // 4 rows to each of 3
        expect(state.getPlayerMetrics(1).attackLinesReceived).toBe(4);
    });

    it('joins the rows of a cut attack into one block', () => {
        const state = match(6);
        place(state, 0, 6);

        state.handleGarbageSummary(0, clearOf(5), null);

        const entries = state.garbageQueues[1].entries.filter((entry) => entry.type === 'line');
        expect(entries.at(-1).isLastInBurst).toBe(true);
        expect(entries.at(-1).connectBelow).toBe(false);
    });

    it('turns each row of a blind attack into a blind piece for every opponent', () => {
        const state = match(4, { attackRules: { forceAttackType: ATTACK_TYPES.BLIND } });

        state.handleGarbageSummary(0, clearOf(4), null);

        // Each of the three rows is a blind piece (versus-attack-modes.test.js has the rules).
        const entries = state.garbageQueues[1].entries;
        expect(entries.map((entry) => entry.type)).toEqual(['blind', 'blind', 'blind']);
        expect(entries.every((entry) => entry.ticks === 30)).toBe(true);
        expect(state.getPlayerMetrics(1).attackLinesReceived).toBe(3);
    });
});
