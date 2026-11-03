import {
    describe, expect, it, vi,
} from 'vitest';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { countRubbleRows } from '../../src/core/odyssey/odyssey-rubble.js';
import { createOdysseyTide, isOdysseyTideConfig, tideIntervalAt } from '../../src/core/odyssey/odyssey-tide.js';
import { getOdysseyLevelBriefing } from '../../src/ui/odyssey/odyssey-level-briefing.js';

// The rising tide (level design audit 2026-11): rubble rows rise from below on a tightening schedule.
const CONFIG = {
    startSeconds: 8, firstEverySeconds: 6, lastEverySeconds: 2, rampSeconds: 180,
};
const gapsOf = (entries) => entries.map((entry) => entry.holeMask.toString(2).padStart(10, '0').indexOf('1'));

describe('the tide schedule', () => {
    it('starts after its grace, then tightens from the first interval to the last over the ramp', () => {
        expect(tideIntervalAt(CONFIG, 0)).toBe(6);
        expect(tideIntervalAt(CONFIG, 8 + 90)).toBe(4);
        expect(tideIntervalAt(CONFIG, 8 + 180)).toBe(2);
        expect(tideIntervalAt(CONFIG, 1000)).toBe(2);
        const tide = createOdysseyTide(CONFIG, 1);
        expect(tide.take(7.9)).toHaveLength(0);
        expect(tide.take(8)).toHaveLength(1);
        expect(tide.secondsUntilNext(8)).toBeCloseTo(6, 5);
        expect(tide.take(60).length + 1).toBe(tide.risen);
    });

    it('rises the same way for the same seed, differently for another, with gaps held for a run of 1-4 rows', () => {
        const gaps = (seed) => gapsOf(createOdysseyTide(CONFIG, seed).take(400));
        expect(gaps(12001)).toEqual(gaps(12001));
        expect(gaps(12001)).not.toEqual(gaps(12002));
        let run = 1;
        const runs = [];
        gaps(12001).forEach((gap, index, all) => {
            if (index === 0) return;
            if (gap === all[index - 1]) run += 1;
            else { runs.push(run); run = 1; }
        });
        expect(Math.max(...runs)).toBeLessThanOrEqual(4);
        expect(new Set(gaps(12001)).size).toBeGreaterThan(5);
    });

    it('accepts only a schedule that starts, tightens and ramps', () => {
        expect(isOdysseyTideConfig(CONFIG)).toBe(true);
        expect(isOdysseyTideConfig({ ...CONFIG, lastEverySeconds: 8 })).toBe(false);
        expect(isOdysseyTideConfig({ ...CONFIG, rampSeconds: 0 })).toBe(false);
        expect(isOdysseyTideConfig(null)).toBe(false);
    });
});

describe('the tide in an orb', () => {
    const tideOrb = getLevelById(58);

    function start(level = tideOrb) {
        const engine = new GameplayHybridEngine();
        engine.configure(structuredClone(level));
        const state = engine.createGameState({ rngSeed: 7 });
        const base = { spawnPiece: vi.fn(), onGarbageApplied: vi.fn(), onTideTopOut: vi.fn() };
        return {
            engine, state, base, callbacks: engine.buildPhysicsCallbacks(base),
        };
    }

    it('rises between pieces: the rows due by now go in before the next piece spawns', () => {
        const {
            engine, state, base, callbacks,
        } = start();
        engine.updateTime(5);
        callbacks.spawnPiece();
        expect(countRubbleRows(state.boardGrid)).toBe(0);
        engine.updateTime(20);
        callbacks.spawnPiece();
        expect(countRubbleRows(state.boardGrid)).toBe(3);
        expect(base.onGarbageApplied).toHaveBeenCalledOnce();
        expect(base.onGarbageApplied).toHaveBeenLastCalledWith(3);
        expect(base.spawnPiece).toHaveBeenCalledTimes(2);
        expect(engine.getMetrics()).toMatchObject({ tideRows: 3 });
        expect(engine.getMetrics().tideNextSeconds).toBeGreaterThan(0);
    });

    it('ends the run when its rows would top the well out, instead of spawning', () => {
        const { engine, base, callbacks } = start();
        engine.updateTime(600);
        callbacks.spawnPiece();
        expect(base.onTideTopOut).toHaveBeenCalledTimes(1);
        expect(base.spawnPiece).not.toHaveBeenCalled();
    });

    it('stays out of every other orb', () => {
        const { engine, base, callbacks } = start(getLevelById(57));
        engine.updateTime(600);
        callbacks.spawnPiece();
        expect(base.spawnPiece).toHaveBeenCalledTimes(1);
        expect(engine.getMetrics().tideRows).toBeUndefined();
    });

    it('is briefed, and only on a solo orb with a sound schedule', () => {
        expect(getOdysseyLevelBriefing(tideOrb).rules)
            .toContain('Rubble rows rise from below, faster as time goes on: clear lines to stay ahead of them.');
        const broken = structuredClone(tideOrb);
        broken.mechanics.tide = { ...broken.mechanics.tide, lastEverySeconds: 60 };
        expect(new LevelRegistry().validateLevel(broken).errors)
            .toContain('A rising tide needs a start, an interval that only tightens and a ramp, on a solo orb');
    });
});
