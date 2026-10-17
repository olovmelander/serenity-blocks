/**
 * The Waystones run model: stops complete on their goal, the between-stops choices come in
 * order (settle the stack, maybe a charm, then a world), banking pays and raises the ask,
 * lanterns go out on top-outs and the road ends in the dark on the last, and the Keeper
 * ends it in the light.
 */
import { describe, expect, it } from 'vitest';
import {
    BANK_TOLL_PER_ROW, LANTERNS, bank, choose, completeStop, createRun, isLastStop, nextOffers, recordStop,
    release, skipCharm, spendLantern, summary, takeCharm,
} from '../../src/core/waystones/run.js';
import { climateById } from '../../src/core/waystones/climates.js';
import { scaledGoal } from '../../src/core/waystones/road.js';

const WORLDS = [
    { id: 'forest', name: 'Forest' },
    { id: 'halcyon-apex', name: 'Halcyon Apex' },
    { id: 'thermal-bloom', name: 'Thermal Bloom' },
];
const START = WORLDS[0];
const newRun = (seed = 'dawn') => createRun({ seed, startWorld: START, worlds: WORLDS });

/** Meets the stop's goal in its own unit. */
function meet(run) {
    const { goal } = run.stop;
    const totals = { lines: 0, score: 0, cascades: 0 };
    totals[goal.type] = goal.target;
    expect(recordStop(run, totals)).toBe(true);
    completeStop(run);
}

describe('A Waystones run', () => {
    it('begins at the world on screen with three lanterns and the climate\'s base ask', () => {
        const run = newRun();
        expect(run.phase).toBe('play');
        expect(run.stopIndex).toBe(0);
        expect(run.stop.world).toEqual(START);
        expect(run.lanterns).toBe(LANTERNS);
        expect(run.stop.goal).toEqual(scaledGoal(run.stop.climate));
        expect(run.stop.carriedRows).toBe(0);
        expect(isLastStop(run)).toBe(false);
    });

    it('tracks progress in the goal\'s own unit and completes on it', () => {
        const run = newRun();
        const { goal } = run.stop;
        const short = { lines: 0, score: 0, cascades: 0 };
        short[goal.type] = goal.target - 1;
        expect(recordStop(run, short)).toBe(false);
        expect(run.stop.progress).toBe(goal.target - 1);
        expect(completeStop(run).phase).toBe('play'); // not met: nothing happens
        meet(run);
        expect(run.phase).toBe('between');
        expect(run.history).toHaveLength(1);
        expect(run.between.draft).toHaveLength(3);
        expect(run.between.banked).toBeNull();
        expect(nextOffers(run)).toHaveLength(2);
        expect(recordStop(run, { lines: 99, score: 0, cascades: 0 })).toBe(false); // between stops
    });

    it('settles the stack before the next world: banking pays a toll and raises the ask', () => {
        const run = newRun();
        meet(run);
        expect(choose(run, 0)).toBe(false); // the stack is not settled
        expect(bank(run, 6.9)).toBe(6 * BANK_TOLL_PER_ROW);
        expect(bank(run, 2)).toBe(-1); // only once
        expect(release(run)).toBe(false);
        expect(run.bankedRows).toBe(6);
        expect(run.toll).toBe(360);
        const [offer] = nextOffers(run);
        expect(choose(run, 0)).toBe(true);
        expect(run.phase).toBe('play');
        expect(run.stopIndex).toBe(1);
        expect(run.stop.world).toEqual(offer.world);
        expect(run.stop.carriedRows).toBe(6);
        expect(run.stop.goal).toEqual(scaledGoal(climateById(offer.climateId), { carriedRows: 6 }));
        expect(run.between).toBeNull();
    });

    it('releasing clears the ask back to the base, and the choice must exist', () => {
        const run = newRun();
        meet(run);
        expect(release(run)).toBe(true);
        expect(bank(run, 3)).toBe(-1);
        expect(choose(run, 5)).toBe(false);
        const [, offer] = nextOffers(run);
        expect(choose(run, 1)).toBe(true);
        expect(run.stop.goal).toEqual(scaledGoal(climateById(offer.climateId)));
        expect(run.toll).toBe(0);
    });

    it('drafts one charm from the three on offer, or none, and Tide doubles the toll', () => {
        const run = newRun();
        meet(run);
        const { draft } = run.between;
        expect(takeCharm(run, 'not-offered')).toBe(false);
        expect(takeCharm(run, draft[0])).toBe(true);
        expect(takeCharm(run, draft[1])).toBe(false); // one per stop
        expect(run.charms).toEqual([draft[0]]);
        release(run);
        choose(run, 0);
        meet(run);
        expect(skipCharm(run)).toBe(true);
        expect(run.between.charmSettled).toBe(true);
        expect(takeCharm(run, run.between.draft[0])).toBe(false);
        expect(run.between.draft).not.toContain(draft[0]);

        const tide = newRun('tide');
        tide.charms.push('tide');
        meet(tide);
        expect(bank(tide, 4)).toBe(4 * BANK_TOLL_PER_ROW * 2);
    });

    it('lights one more lantern for Lantern, and Keel lowers the asks from here', () => {
        const run = newRun('keel');
        meet(run);
        run.between.draft = ['lantern', 'keel', 'ember'];
        expect(takeCharm(run, 'lantern')).toBe(true);
        expect(run.lanterns).toBe(4);
        expect(run.lanternsMax).toBe(4);
        release(run);
        choose(run, 0);
        meet(run);
        run.between.draft = ['keel', 'ember', 'current'];
        takeCharm(run, 'keel');
        release(run);
        const [offer] = nextOffers(run);
        choose(run, 0);
        expect(run.stop.goal).toEqual(scaledGoal(climateById(offer.climateId), { keel: true }));
    });

    it('spends a lantern on a top-out and ends the road in the dark on the last', () => {
        const run = newRun();
        expect(spendLantern(run)).toEqual({ forgiven: false, ended: false });
        expect(run.lanterns).toBe(2);
        expect(spendLantern(run)).toEqual({ forgiven: false, ended: false });
        expect(spendLantern(run)).toEqual({ forgiven: false, ended: true });
        expect(run.lanterns).toBe(0);
        expect(run.phase).toBe('ended');
        expect(run.ended).toEqual({ won: false, reason: 'lanterns' });
        expect(run.stop.topOuts).toBe(3);
        expect(spendLantern(run)).toEqual({ forgiven: false, ended: true });
        expect(recordStop(run, { lines: 50, score: 0, cascades: 0 })).toBe(false);
        expect(summary(run, 1234)).toMatchObject({
            won: false, reason: 'lanterns', stopsCleared: 0, stopCount: 5, score: 1234, lanternsLeft: 0,
        });
    });

    it('Hearth forgives the first top-out at each stop', () => {
        const run = newRun();
        run.charms.push('hearth');
        expect(spendLantern(run)).toEqual({ forgiven: true, ended: false });
        expect(run.lanterns).toBe(3);
        expect(spendLantern(run)).toEqual({ forgiven: false, ended: false });
        expect(run.lanterns).toBe(2);
        meet(run);
        release(run);
        choose(run, 0);
        expect(spendLantern(run)).toEqual({ forgiven: true, ended: false });
        expect(run.lanterns).toBe(2);
    });

    it('ends in the light at the Keeper, with the road in the summary', () => {
        const run = newRun('keeper');
        for (let stop = 0; stop < 4; stop += 1) {
            meet(run);
            expect(run.phase).toBe('between');
            if (stop % 2 === 0) bank(run, 5); else release(run);
            if (run.between.draft[0]) takeCharm(run, run.between.draft[0]);
            expect(choose(run, stop % 2)).toBe(true);
        }
        expect(isLastStop(run)).toBe(true);
        expect(run.road.stops[run.stopIndex].keeper).toBe(true);
        expect(run.stop.goal).toEqual(scaledGoal(run.stop.climate, {
            carriedRows: run.stop.carriedRows, keeper: true, keel: run.charms.includes('keel'),
        }));
        meet(run);
        expect(run.phase).toBe('ended');
        expect(run.ended).toEqual({ won: true, reason: 'keeper' });
        const report = summary(run, 9000);
        expect(report).toMatchObject({
            seed: 'keeper', won: true, reason: 'keeper', stopsCleared: 5, stopCount: 5, score: 9000, bankedRows: 10,
        });
        expect(report.worlds).toHaveLength(5);
        expect(report.charms.length).toBeGreaterThan(0);
        expect(report.toll).toBe(run.toll);
    });
});
