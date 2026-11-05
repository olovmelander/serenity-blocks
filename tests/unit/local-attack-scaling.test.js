/**
 * Local matches scale an attack by the players left: three at 75%, four at 50%, and the "No attack
 * scaling" option keeps full strength. The scaled number only ever reached the HUD: the garbage
 * was queued from the unscaled attack, so the setting changed a figure and nothing else.
 */
import { describe, expect, it, vi } from 'vitest';
import { COLS } from '../../src/core/constants.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { ATTACK_TYPES, GarbageAttack } from '../../src/core/garbage.js';

const col0 = () => Array.from({ length: COLS }, (_, column) => column === 0);

/** Lines cleared by one piece; a clear of n sends n - 1 rows before any scaling. */
const clearOf = (depth) => ({
    depth,
    complexity: 1,
    holeMask: Array.from({ length: depth }, col0),
    manualColumns: [0],
});

function match(players, config = {}) {
    const state = new MultiPlayerState(players);
    state.players.forEach((player) => { player.isAlive = true; });
    state.setPlayerHandicaps(Array(players).fill(2));
    state.setMatchConfig(config);
    return state;
}

const queued = (state, index) => state.garbageQueues[index].getTotalLines();

describe('attack scaling in a local match', () => {
    it.each([
        // players, lines cleared, rows each opponent receives
        [2, 5, 4],
        [3, 5, 3],
        [4, 5, 2],
    ])('with %i players a clear of %i sends %i rows to each opponent', (players, depth, rows) => {
        const state = match(players);

        state.handleGarbageSummary(0, clearOf(depth), null);

        for (let target = 1; target < players; target += 1) {
            expect(queued(state, target)).toBe(rows);
        }
    });

    it('keeps full strength with "No attack scaling" on', () => {
        const state = match(4, { boringRules: true });

        state.handleGarbageSummary(0, clearOf(5), null);

        expect([1, 2, 3].map((target) => queued(state, target))).toEqual([4, 4, 4]);
    });

    it('goes by the players left, not the players who started', () => {
        const state = match(4);
        state.players[3].isAlive = false;

        state.handleGarbageSummary(0, clearOf(5), null);

        expect(queued(state, 1)).toBe(3);
        expect(queued(state, 3)).toBe(0);
    });

    it('still sends a small attack rather than scaling it away', () => {
        const state = match(4);

        state.handleGarbageSummary(0, clearOf(2), null); // one row, at 50%

        expect(queued(state, 1)).toBe(1);
    });

    it('tells the HUD what the opponents really receive', () => {
        const state = match(4);
        state.onAttack = vi.fn();

        state.handleGarbageSummary(0, clearOf(5), null);

        expect(state.onAttack).toHaveBeenCalledWith(0, [1, 2, 3], queued(state, 1));
    });

    it('records the rows that were sent, not the rows before scaling', () => {
        const state = match(4);

        state.handleGarbageSummary(0, clearOf(5), null);

        expect(state.getPlayerMetrics(0).attackLinesSent).toBe(6); // 2 rows to each of 3
        expect(state.getPlayerMetrics(1).attackLinesReceived).toBe(2);
    });

    it('keeps an attack\'s first rows, clean ones first, as online does', () => {
        const attack = new GarbageAttack({ id: 'a', cleanMasks: [1, 2], holeMasks: [3, 4, 5] });

        const cut = match(4)._attackWithLines(attack, 3);

        expect(cut.cleanMasks).toEqual([1, 2]);
        expect(cut.holeMasks).toEqual([3]);
        expect(cut.id).toBe('a');
    });

    it('cuts into the clean rows only when it has to', () => {
        const attack = new GarbageAttack({ cleanMasks: [1, 2, 3], holeMasks: [4] });

        const cut = match(4)._attackWithLines(attack, 2);

        expect(cut.cleanMasks).toEqual([1, 2]);
        expect(cut.holeMasks).toEqual([]);
    });

    it('hands back the attack itself when there is nothing to cut', () => {
        const attack = new GarbageAttack({ holeMasks: [1, 2] });

        expect(match(4)._attackWithLines(attack, 2)).toBe(attack);
    });

    it('joins the rows of a scaled attack into one block', () => {
        const state = match(4);

        state.handleGarbageSummary(0, clearOf(5), null);

        const entries = state.garbageQueues[1].entries.filter((entry) => entry.type === 'line');
        expect(entries.at(-1).isLastInBurst).toBe(true);
        expect(entries.at(-1).connectBelow).toBe(false);
    });

    it('leaves a blind attack\'s effect alone', () => {
        const state = match(4, { attackRules: { forceAttackType: ATTACK_TYPES.BLIND } });

        state.handleGarbageSummary(0, clearOf(4), null);

        const blinds = state.garbageQueues[1].entries.filter((entry) => entry.type === 'blind');
        expect(blinds).toHaveLength(1);
        expect(blinds[0].duration).toBeGreaterThan(0);
    });
});
