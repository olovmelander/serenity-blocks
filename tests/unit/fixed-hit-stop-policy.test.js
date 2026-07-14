import { describe, expect, it } from 'vitest';
import {
    applyFixedHardDropHitStop,
    applyFixedLineImpactHitStop,
    applyFixedPerfectClearHitStop,
} from '../../src/core/fixed-hit-stop-policy.js';
import { consumeFixedHitStopTick, GameState } from '../../src/core/game.js';

function countFrozenTicks(gameState) {
    let frozenTicks = 0;
    while (consumeFixedHitStopTick(gameState)) {
        frozenTicks += 1;
    }
    return frozenTicks;
}

describe('fixed hit-stop producer policy', () => {
    it('keeps hard-drop max semantics while impact events replace', () => {
        const state = new GameState();

        state.hitStopRemaining = 70;
        expect(applyFixedHardDropHitStop(state)).toBe(true);
        expect(state.hitStopRemaining).toBe(70);

        state.hitStopRemaining = 110;
        expect(applyFixedLineImpactHitStop(state, 4)).toBe(true);
        expect(state.hitStopRemaining).toBe(70);

        state.hitStopRemaining = 200;
        expect(applyFixedPerfectClearHitStop(state)).toBe(true);
        expect(state.hitStopRemaining).toBe(110);
    });

    it('does not write any event when the latched policy is disabled', () => {
        let writes = 0;
        const state = {
            hitStopEnabled: false,
            get hitStopRemaining() {
                return 45;
            },
            set hitStopRemaining(_value) {
                writes += 1;
            },
        };

        expect(applyFixedHardDropHitStop(state)).toBe(false);
        expect(applyFixedLineImpactHitStop(state, 4)).toBe(false);
        expect(applyFixedPerfectClearHitStop(state)).toBe(false);
        expect(writes).toBe(0);
        expect(state.hitStopRemaining).toBe(45);
    });

    it.each([
        undefined,
        null,
        false,
        '4',
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -1,
        3,
        3.999,
        4.5,
        Number.MAX_SAFE_INTEGER + 1,
        [],
        {},
    ])('rejects a non-discrete line count without changing state: %o', (lineCount) => {
        const state = new GameState();
        state.hitStopRemaining = 30;

        expect(applyFixedLineImpactHitStop(state, lineCount)).toBe(false);
        expect(state.hitStopRemaining).toBe(30);
    });

    it.each([
        ['hard drop', (state) => applyFixedHardDropHitStop(state), 2],
        ['quad impact', (state) => applyFixedLineImpactHitStop(state, 4), 5],
        ['perfect clear', (state) => applyFixedPerfectClearHitStop(state), 7],
    ])('keeps %s as a millisecond write that quantizes to %i ticks', (
        _event,
        applyEvent,
        expectedTicks,
    ) => {
        const state = new GameState();

        expect(applyEvent(state)).toBe(true);
        expect(countFrozenTicks(state)).toBe(expectedTicks);
    });

    it('produces the canonical hard-drop, quad, perfect-clear sequence', () => {
        const state = new GameState();

        applyFixedHardDropHitStop(state);
        expect(state.hitStopRemaining).toBe(30);

        applyFixedLineImpactHitStop(state, 4);
        expect(state.hitStopRemaining).toBe(70);

        applyFixedPerfectClearHitStop(state);
        expect(state.hitStopRemaining).toBe(110);
    });

    it('accepts every safe integer line count at or above four', () => {
        const state = new GameState();

        expect(applyFixedLineImpactHitStop(state, 5)).toBe(true);
        expect(state.hitStopRemaining).toBe(70);

        expect(applyFixedLineImpactHitStop(state, Number.MAX_SAFE_INTEGER)).toBe(true);
        expect(state.hitStopRemaining).toBe(70);
    });
});
