import { describe, it, expect } from 'vitest';
import { MultiPlayerState } from '../multi-player-state.js';
import { COLS } from '../constants.js';

describe('MultiPlayerState — handicap & attack rules', () => {
    const col0 = () => Array.from({ length: COLS }, (_, i) => i === 0);

    // depth 3 → rowsToSend = depth - 1 = 2 normal garbage lines
    const tripleClear = () => ({
        depth: 3,
        complexity: 1,
        holeMask: [col0(), col0(), col0()],
        manualColumns: [0],
    });

    const newMatch = (handicaps) => {
        const mps = new MultiPlayerState(2);
        mps.players.forEach((p) => { p.isAlive = true; });
        mps.setPlayerHandicaps(handicaps);
        return mps;
    };

    it('setPlayerHandicaps applies levels and resets stamps', () => {
        const mps = newMatch([4, 1]);
        expect(mps.players[0].handicap).toBe(4);
        expect(mps.players[1].handicap).toBe(1);
        expect(mps.players[0].handicaps).toEqual({});
    });

    it('defaults unset handicaps to Intermediate (2)', () => {
        const mps = newMatch(undefined);
        expect(mps.players[0].handicap).toBe(2);
        expect(mps.players[1].handicap).toBe(2);
    });

    it('does not reduce garbage when handicaps are equal (default case)', () => {
        const mps = newMatch([2, 2]);
        for (let i = 0; i < 9; i++) mps.accumulateHandicap(0);
        mps.handleGarbageSummary(0, tripleClear(), null);
        expect(mps.garbageQueues[1].getTotalLines()).toBe(2);
    });

    it('reduces garbage to a weaker opponent after a stronger player accumulates stamps', () => {
        const mps = newMatch([4, 1]); // diff 3 → up to 9 stamps → reduce up to 3 lines
        for (let i = 0; i < 9; i++) mps.accumulateHandicap(0);
        expect(mps.players[0].handicaps[1]).toBe(9);

        mps.handleGarbageSummary(0, tripleClear(), null);
        // The 2 base normal lines are handicapped away entirely
        expect(mps.garbageQueues[1].getTotalLines()).toBe(0);
    });

    it('applies handicap per-opponent independently in a 3-player match', () => {
        const mps = new MultiPlayerState(3);
        mps.players.forEach((p) => { p.isAlive = true; });
        mps.setPlayerHandicaps([4, 1, 4]); // P0 strong; P1 weaker; P2 equal to P0

        for (let i = 0; i < 9; i++) mps.accumulateHandicap(0);
        expect(mps.players[0].handicaps[1]).toBe(9); // stamps build vs weaker P1
        expect(mps.players[0].handicaps[2] || 0).toBe(0); // none vs equal P2

        mps.handleGarbageSummary(0, tripleClear(), null);
        // P1 (weaker) is handicapped to 0 lines; P2 (equal) receives the full attack
        expect(mps.garbageQueues[1].getTotalLines()).toBe(0);
        expect(mps.garbageQueues[2].getTotalLines()).toBe(2);
    });

    it('peaceful attack rules send no garbage at all', () => {
        const mps = newMatch([2, 2]);
        mps.setMatchConfig({ attackRules: { disableAttacks: true } });
        mps.handleGarbageSummary(0, tripleClear(), null);
        expect(mps.garbageQueues[1].entries.length).toBe(0);
    });

    const potatoMatch = () => {
        const mps = newMatch([2, 2]);
        mps.setMatchConfig({ attackStyle: 'hot_potato', hotPotato: true });
        mps.potatoRandom = () => 0;
        return mps;
    };

    it('an attack by the hot potato holder counts toward its target instead of sending garbage', () => {
        const mps = potatoMatch();
        mps.updateHotPotato(2000); // the first holder is chosen two seconds in
        const holder = mps.getHotPotatoState().holderIndices[0];
        const other = 1 - holder;

        mps.handleGarbageSummary(holder, tripleClear(), null); // two rows: the first target

        expect(mps.garbageQueues[other].getTotalLines()).toBe(0);
        expect(mps.getHotPotatoState().holderTeam).toBeNull(); // passed on
        expect(mps.getPlayerMetrics(holder).potatoPasses).toBe(1);
        expect(mps.getPlayerMetrics(holder).potatoRowsSent).toBe(2);
    });

    it('hot potato: an attack on the holder goes through with the handicap rules as usual', () => {
        const mps = potatoMatch();
        mps.updateHotPotato(2000);
        const holder = mps.getHotPotatoState().holderIndices[0];
        const other = 1 - holder;

        mps.handleGarbageSummary(other, tripleClear(), null);

        expect(mps.garbageQueues[holder].getTotalLines()).toBe(2);
        expect(mps.getHotPotatoState().holderIndices).toEqual([holder]);
    });
});
