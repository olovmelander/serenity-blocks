/**
 * Rainbow Terraces builds its first visit and lays out its first frame in steps (2026-10-31): the
 * isles' cascades, massifs and groves and the frame's solve (applyFrameSteps: the falls, the
 * spray's fit, the pools) pause by a clock, and the old functions drain the steps. Paused at every
 * chance, they build and write what one call does.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    buildCascade, buildCascadeSteps, buildGrove, buildGroveSteps, buildMassif, buildMassifSteps, isleCascade,
    isleCascadeSteps, isleGroves, isleShapes,
} from '../../src/themes/rainbow-terraces/rainbow-terraces-isles.js';
import { PLAN } from '../../src/themes/rainbow-terraces/rainbow-terraces-plan.js';
import { QUALITY } from '../../src/themes/rainbow-terraces/rainbow-terraces-quality.js';
import { RainbowTerracesWorld } from '../../src/themes/rainbow-terraces/rainbow-terraces-world.js';
import { fallbackLayout } from '../../src/themes/rainbow-terraces/rainbow-terraces-composition.js';

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
const sameGeometry = (a, b) => {
    expect(Object.keys(b.attributes).sort()).toEqual(Object.keys(a.attributes).sort());
    for (const name of Object.keys(a.attributes)) {
        expect(b.attributes[name].array, name).toEqual(a.attributes[name].array);
    }
    expect(b.index?.array).toEqual(a.index?.array);
};

/** Every value a world's frame writes: its uniforms (and their rows), the falls it keeps and the frame. */
function frameState(world) {
    const out = {};
    for (const [key, node] of Object.entries(world.U)) {
        const v = node?.value;
        if (typeof v === 'number') out[key] = v;
        else if (v?.toArray) out[key] = v.toArray();
        else if (Array.isArray(node?.array)) out[key] = node.array.map((row) => (row?.toArray ? row.toArray() : row));
    }
    return JSON.parse(JSON.stringify({
        U: out,
        fallCpu: world.fallCpu,
        frame: world.frame,
        placement: world.placement,
        spray: [world.sprayFit, world.sprayArea],
        edge: Array.from(world.fallEdgeBins ?? []),
        mother: world.motherTh,
    }));
}

describe('Rainbow Terraces first build in steps', () => {
    it('builds the same cascades, massifs and groves, drawing the same numbers, however often it pauses', () => {
        const tier = QUALITY.High;
        const shapes = isleShapes(PLAN);
        for (const name of ['spring', 'twin']) {
            const whole = isleCascade(PLAN, tier, name);
            const paused = drainCounting(isleCascadeSteps(PLAN, tier, name, always()));
            expect(paused.yields).toBeGreaterThan(20);
            sameGeometry(whole.geometry, paused.value.geometry);
            expect(JSON.stringify(paused.value.pools)).toBe(JSON.stringify(whole.pools));
            expect(JSON.stringify(paused.value.outlets)).toBe(JSON.stringify(whole.outlets));
            expect(paused.value.footprint).toEqual(whole.footprint);
        }
        const small = { count: 6, radial: 14, seed: 9 };
        const cascade = buildCascade(shapes.twin, small);
        sameGeometry(cascade.geometry, drainCounting(buildCascadeSteps(shapes.twin, small, always())).value.geometry);

        const options = {
            radial: tier.isleRadial, rings: tier.isleRings, seed: 33, asym: 0.2, outletTh: Math.PI / 2 - 0.62,
        };
        const massif = drainCounting(buildMassifSteps(shapes.spring, options, always()));
        expect(massif.yields).toBeGreaterThan(tier.isleRings / 2);
        sameGeometry(buildMassif(shapes.spring, options), massif.value);

        const cascades = { spring: isleCascade(PLAN, tier, 'spring'), twin: isleCascade(PLAN, tier, 'twin') };
        const spots = isleGroves(PLAN, tier, cascades).spring;
        const grove = drainCounting(buildGroveSteps(spots, 41, always()));
        expect(grove.yields).toBe(spots.length + 1);
        sameGeometry(buildGrove(spots, 41), grove.value);
    });

    it('lays out a frame the same in steps as at once, paused at every chance', () => {
        const aspect = 1707 / 1067;
        const built = () => new RainbowTerracesWorld({
            scene: new THREE.Scene(), quality: 'Minimal', capture: true,
        }).build();
        const whole = built();
        const paused = built();
        try {
            for (const world of [whole, paused]) world.bindCamera(new THREE.PerspectiveCamera(50, aspect, 0.3, 60000));
            whole.setViewport(1707, 1067, aspect);
            const steps = drainCounting(paused.setViewportSteps(1707, 1067, aspect, always()));
            expect(steps.yields).toBeGreaterThanOrEqual(6);
            expect(frameState(paused)).toEqual(frameState(whole));
            // And with a board on screen (the layout read of the first frame).
            whole.setLayout(fallbackLayout(1707, 1067), aspect);
            paused.layout = fallbackLayout(1707, 1067);
            drainCounting(paused.applyFrameSteps(always()));
            expect(frameState(paused)).toEqual(frameState(whole));
        } finally {
            whole.dispose();
            paused.dispose();
        }
    });
});
