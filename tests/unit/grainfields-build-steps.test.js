/**
 * Grainfields builds its first visit in steps (2026-10-31): the barley's planting and its bands,
 * the fells' mesh and the shelterbelts pause by a clock, and the old functions drain the steps.
 * Paused at every chance, they build what one call builds. The geese's take-off routes a resize
 * or a layout asks for are scored a slice at a time, for the layout that asked first.
 */
import { describe, expect, it } from 'vitest';
import { CLOSE_STAND, grainSites, grainSitesSteps } from '../../src/themes/grainfields/grainfields-plan.js';
import { createGateGeometry, createGateGeometrySteps } from '../../src/themes/grainfields/grainfields-lapporten.js';
import { fanSteps } from '../../src/themes/grainfields/grainfields-land.js';
import { createGrain, createGrainSteps } from '../../src/themes/grainfields/grainfields-grain.js';
import { createNoiseTexture, createUniforms } from '../../src/themes/grainfields/grainfields-tsl.js';
import { fallbackLayout } from '../../src/themes/grainfields/grainfields-composition.js';
import {
    askTakeoffs, planTakeoff, stepTakeoffs, takeoffSteps,
} from '../../src/themes/grainfields/grainfields-goose-flight.js';
import { drainSteps } from '../../src/themes/shared/build-steps.js';

/** A clock that is always due: the steps yield at every chance they have. */
const always = () => ({ due: () => true, restart() {} });
const drainCounting = (steps) => {
    let yields = 0;
    let next = steps.next();
    while (!next.done) {
        yields += 1;
        next = steps.next();
    }
    return { value: next.value, yields };
};

describe('Grainfields first build in steps', () => {
    it('plants the same barley, drawing the same numbers, however often it pauses', () => {
        for (const options of [
            {
                count: 3000, near: 2.5, far: 60, knee: 7, seed: 0x6a7e,
            },
            {
                count: 40,
                near: CLOSE_STAND.near,
                far: CLOSE_STAND.far,
                bearings: CLOSE_STAND.bearings,
                bank: false,
                fade: false,
                seed: 0x6a7d,
            },
        ]) {
            const once = grainSites(options);
            const paused = drainCounting(grainSitesSteps(options, always()));
            expect(paused.yields).toBeGreaterThan(0);
            expect(paused.value.count).toBe(once.count);
            expect(paused.value.data).toEqual(once.data);
        }
    });

    it('lays the land\'s posts and the fells\' mesh the same, paused at every chance', () => {
        const whole = drainSteps(fanSteps(60, 40));
        const paused = drainCounting(fanSteps(60, 40, always()));
        expect(paused.yields).toBe(39);
        expect(paused.value.positions).toEqual(whole.positions);
        expect(paused.value.cover).toEqual(whole.cover);

        const gate = createGateGeometry(48, 20);
        const steps = drainCounting(createGateGeometrySteps(48, 20, always()));
        expect(steps.yields).toBeGreaterThanOrEqual(21);
        for (const name of ['position', 'aShape', 'normal']) {
            expect(steps.value.attributes[name].array, name).toEqual(gate.attributes[name].array);
        }
        expect(steps.value.index.array).toEqual(gate.index.array);
    });

    it('draws the same barley bands in steps as at once', () => {
        const u = createUniforms();
        const t = { noise: createNoiseTexture() };
        const sites = {
            near: grainSites({
                count: 900, near: 2.5, far: 40, knee: 7, seed: 0x6a7e,
            }),
            far: grainSites({
                count: 300, near: 36, far: 140, seed: 0x6a7f,
            }),
        };
        const once = createGrain(u, t, sites, { coverage: true });
        const paused = drainCounting(createGrainSteps(u, t, sites, { coverage: true }, always()));
        expect(paused.yields).toBeGreaterThanOrEqual(4);
        const grain = paused.value;
        expect(grain.counts).toEqual(once.counts);
        const draws = (g) => g.meshes.map((m) => [m.name, m.renderOrder]);
        expect(draws(grain)).toEqual(draws(once));
        grain.meshes.forEach((mesh, i) => {
            const { iA } = once.meshes[i].geometry.attributes;
            expect(mesh.geometry.attributes.iA.data.array, mesh.name).toEqual(iA.data.array);
            expect(mesh.geometry.instanceCount).toBe(once.meshes[i].geometry.instanceCount);
        });
        once.dispose();
        grain.dispose();
    });

    it('plans the same take-offs from routes scored in slices, for the layout that asked first', () => {
        const layout = fallbackLayout(1707, 1067);
        const aspect = 1707 / 1067;
        // A layout read a hair off the resize's: the same key (to a thousandth), other values.
        const snap = (r) => ({
            ...r, x0: Math.round(r.x0 * 1000) / 1000, x1: Math.round(r.x1 * 1000) / 1000,
        });
        const near = { ...layout, cards: layout.cards.map(snap), hud: snap(layout.hud) };
        const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        const plans = (l) => seeds.map((seed) => planTakeoff({ layout: l, aspect, seed }));
        askTakeoffs(null, 3); // another layout's routes stand in the cache
        const expected = plans(layout); // scored at once, as a launch does
        expect(expected.every(Boolean)).toBe(true);

        // Asked for (a resize), scored a slice at a time (the frames), then launched.
        askTakeoffs(null, 3);
        askTakeoffs(layout, aspect);
        let slices = 1;
        while (!stepTakeoffs(0)) slices += 1;
        expect(slices).toBeGreaterThan(1);
        expect(plans(layout)).toEqual(expected);

        // A launch half-way scores the rest itself; a later ask for the same key keeps the routes of
        // the first to ask, as scoring them at once on that ask did.
        askTakeoffs(null, 3);
        askTakeoffs(layout, aspect);
        stepTakeoffs(0);
        askTakeoffs(near, aspect);
        expect(plans(near)).toEqual(expected);

        // In a stepped build: steps until they are scored.
        askTakeoffs(null, 3);
        askTakeoffs(layout, aspect);
        expect(drainCounting(takeoffSteps(0)).yields).toBeGreaterThan(0);
        expect(stepTakeoffs()).toBe(true);
        expect(plans(layout)).toEqual(expected);
    });
});
