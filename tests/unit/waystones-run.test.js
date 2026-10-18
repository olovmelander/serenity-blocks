/**
 * The Waystones run model: stops complete on their goal, the between-stops choices come in
 * order (settle the stack, maybe a charm, maybe a lantern, then a world), a banked stack
 * pays only once the next stop is cleared and raises its ask, points buy a lantern back,
 * lanterns go out on top-outs (the first forgiven once by Hearth) and the road ends in the
 * dark on the last; the Keeper ends it in the light.
 */
import { describe, expect, it } from 'vitest';
import {
    BANK_TOLL_PER_ROW, LANTERNS, RELIGHT_COST, bank, canRelight, choose, completeStop, createRun, isLastStop,
    nextOffers, offerAsk, recordStop, release, relightLantern, skipCharm, spendLantern, summary, takeCharm,
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
function meet(run, board = {}) {
    const { goal } = run.stop;
    const totals = { lines: 0, score: 0, cascades: 0 };
    totals[goal.type] = goal.target;
    expect(recordStop(run, totals)).toBe(true);
    completeStop(run, board);
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
        expect(run.stop.carriedToll).toBe(0);
        expect(isLastStop(run)).toBe(false);
    });

    it('tracks progress in the goal\'s own unit and completes on it, not before', () => {
        const run = newRun();
        const { goal } = run.stop;
        const short = { lines: 0, score: 0, cascades: 0 };
        short[goal.type] = goal.target - 1;
        expect(recordStop(run, short)).toBe(false);
        expect(run.stop.progress).toBe(goal.target - 1);
        expect(completeStop(run).phase).toBe('play');
        meet(run);
        expect(run.phase).toBe('between');
        expect(run.history).toHaveLength(1);
        expect(run.lastPayout).toBe(0);
        expect(run.between.draft).toHaveLength(3);
        expect(run.between.banked).toBeNull();
        expect(run.between.autoReleased).toBe(false);
        expect(nextOffers(run)).toHaveLength(2);
        expect(recordStop(run, { lines: 99, score: 0, cascades: 0 })).toBe(false);
    });

    it('settles the stack before the next world: banking raises the ask and pays once that stop is cleared', () => {
        const run = newRun();
        meet(run);
        expect(choose(run, 0)).toBe(false); // the stack is not settled
        expect(bank(run, 6.9)).toBe(6 * BANK_TOLL_PER_ROW);
        expect(bank(run, 2)).toBe(-1); // only once
        expect(release(run)).toBe(false);
        expect(run.bankedRows).toBe(6);
        expect(run.toll).toBe(0); // nothing paid yet
        const [offer] = nextOffers(run);
        expect(offerAsk(run, offer, 6)).toEqual(scaledGoal(climateById(offer.climateId), { carriedRows: 6 }));
        expect(choose(run, 0)).toBe(true);
        expect(run.phase).toBe('play');
        expect(run.stopIndex).toBe(1);
        expect(run.stop.world).toEqual(offer.world);
        expect(run.stop.carriedRows).toBe(6);
        expect(run.stop.carriedToll).toBe(360);
        expect(run.stop.goal).toEqual(scaledGoal(climateById(offer.climateId), { carriedRows: 6 }));
        expect(run.between).toBeNull();
        meet(run);
        expect(run.lastPayout).toBe(360);
        expect(run.toll).toBe(360);
    });

    it('releasing clears the ask back to the base, and an empty well settles itself', () => {
        const run = newRun();
        meet(run);
        expect(release(run)).toBe(true);
        expect(bank(run, 3)).toBe(-1);
        expect(choose(run, 5)).toBe(false);
        const [, offer] = nextOffers(run);
        expect(choose(run, 1)).toBe(true);
        expect(run.stop.goal).toEqual(scaledGoal(climateById(offer.climateId)));
        expect(run.stop.carriedToll).toBe(0);
        meet(run, { material: 0 });
        expect(run.between).toMatchObject({ banked: false, autoReleased: true, carriedRows: 0 });
        expect(bank(run, 4)).toBe(-1);
        expect(choose(run, 0)).toBe(true);
    });

    it('drafts one charm from the three on offer, or none, and Tide doubles what a bank pays', () => {
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

    it('Wick lights one more lantern; Keel and Ballast change the asks from here', () => {
        const run = newRun('keel');
        meet(run);
        run.between.draft = ['wick', 'keel', 'kindle'];
        expect(takeCharm(run, 'wick')).toBe(true);
        expect(run.lanterns).toBe(4);
        expect(run.lanternsMax).toBe(4);
        release(run);
        choose(run, 0);
        meet(run);
        run.between.draft = ['keel', 'kindle', 'swell'];
        takeCharm(run, 'keel');
        release(run);
        let [offer] = nextOffers(run);
        choose(run, 0);
        expect(run.stop.goal).toEqual(scaledGoal(climateById(offer.climateId), { keel: true }));
        meet(run);
        run.between.draft = ['ballast', 'kindle', 'swell'];
        takeCharm(run, 'ballast');
        bank(run, 8);
        [offer] = nextOffers(run);
        choose(run, 0);
        expect(run.stop.goal).toEqual(scaledGoal(climateById(offer.climateId), {
            carriedRows: 8, keel: true, ballast: true, keeper: run.road.stops[3].keeper,
        }));
    });

    it('buys a lantern back for points, once between stops, only when one is out', () => {
        const run = newRun();
        expect(canRelight(run, 9000)).toEqual({ can: false, why: null }); // not between stops
        expect(spendLantern(run).ended).toBe(false);
        meet(run);
        expect(canRelight(run, RELIGHT_COST - 1)).toEqual({ can: false, why: 'short' });
        expect(relightLantern(run, { score: RELIGHT_COST - 1 })).toBe(false);
        expect(canRelight(run, RELIGHT_COST)).toEqual({ can: true, why: null });
        expect(relightLantern(run, { score: RELIGHT_COST })).toBe(true);
        expect(run.lanterns).toBe(3);
        expect(run.relights).toBe(1);
        expect(canRelight(run, 9000)).toEqual({ can: false, why: 'done' });
        release(run);
        choose(run, 0);
        meet(run);
        expect(canRelight(run, 9000)).toEqual({ can: false, why: 'full' });
    });

    it('spends a lantern on a top-out, drops the carried stack and its toll, and ends the road on the last', () => {
        const run = newRun();
        meet(run);
        bank(run, 10);
        const [offer] = nextOffers(run);
        choose(run, 0);
        const base = scaledGoal(climateById(offer.climateId));
        expect(run.stop.goal).not.toEqual(base);
        expect(spendLantern(run)).toEqual({ forgiven: false, ended: false });
        expect(run.lanterns).toBe(2);
        expect(run.stop.carriedRows).toBe(0);
        expect(run.stop.carriedToll).toBe(0);
        expect(run.stop.goal).toEqual(base); // the material is gone, so is the raised ask
        expect(spendLantern(run)).toEqual({ forgiven: false, ended: false });
        expect(spendLantern(run)).toEqual({ forgiven: false, ended: true });
        expect(run.lanterns).toBe(0);
        expect(run.phase).toBe('ended');
        expect(run.ended).toEqual({ won: false, reason: 'lanterns' });
        expect(run.stop.topOuts).toBe(3);
        expect(spendLantern(run)).toEqual({ forgiven: false, ended: true });
        expect(recordStop(run, { lines: 50, score: 0, cascades: 0 })).toBe(false);
        expect(summary(run, 1234)).toMatchObject({
            won: false, reason: 'lanterns', stopsCleared: 1, stopCount: 5, score: 1234, lanternsLeft: 0, toll: 0,
        });
    });

    it('Hearth forgives the first top-out of the road, and only that one', () => {
        const run = newRun();
        run.charms.push('hearth');
        expect(spendLantern(run)).toEqual({ forgiven: true, ended: false });
        expect(run.lanterns).toBe(3);
        expect(spendLantern(run)).toEqual({ forgiven: false, ended: false });
        expect(run.lanterns).toBe(2);
        meet(run);
        release(run);
        choose(run, 0);
        expect(spendLantern(run)).toEqual({ forgiven: false, ended: false });
        expect(run.lanterns).toBe(1);
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
            carriedRows: run.stop.carriedRows,
            keeper: true,
            keel: run.charms.includes('keel'),
            ballast: run.charms.includes('ballast'),
        }));
        meet(run);
        expect(run.phase).toBe('ended');
        expect(run.ended).toEqual({ won: true, reason: 'keeper' });
        const report = summary(run, 9000);
        expect(report).toMatchObject({
            seed: 'keeper', won: true, reason: 'keeper', stopsCleared: 5, stopCount: 5, score: 9000, bankedRows: 10,
        });
        expect(report.worlds).toHaveLength(5);
        expect(report.uniqueWorlds).toBeGreaterThanOrEqual(1);
        expect(report.uniqueWorlds).toBeLessThanOrEqual(5);
        expect(report.charms.length).toBeGreaterThan(0);
        expect(report.toll).toBe(run.toll);
        expect(report.toll).toBe(600); // two banks of five rows, each paid when the next stop was cleared
    });
});
