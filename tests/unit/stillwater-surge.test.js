/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater — fast play builds instead of popping and starting over (stillwater-world.js with the
 * shared surge, src/themes/shared/gameplay-surge.js). A weak answer after a strong one only adds
 * to its light; a long chain reads hotter than its first clear and the night breathes back when
 * the hands rest; a perfect clear that settles after its quad crowns it instead of replaying it;
 * a T-spin that clears nothing and a back-to-back each have an answer of their own.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { REST_RIG, StillwaterWorld, fovForAspect } from '../../src/themes/stillwater/stillwater-world.js';
import { HEART, HUSH_HOLD } from '../../src/themes/stillwater/stillwater-core.js';
import { fallbackLayout } from '../../src/themes/stillwater/stillwater-composition.js';

vi.setConfig({ testTimeout: 60000 });

function frame(world, camera, time, delta) {
    const sim = { time, delta };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

function makeWorld({ width = 1600, height = 900, start = 10 } = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new StillwaterWorld({ scene, quality: 'Low', capture: true }).build();
    world.bindCamera(camera);
    world.setHourDrift(false);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    world.seek(start);
    frame(world, camera, start, 0);
    return { camera, world };
}

/** Advance by `seconds` at 60 fps, calling `each()` after every frame. */
function run(world, camera, seconds, each = null) {
    const steps = Math.max(1, Math.round(seconds * 60));
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        frame(world, camera, t0 + i / 60, 1 / 60);
        if (each) each(i);
    }
}

/** What the night shows of its light at this moment. */
function light(world) {
    const post = world.getPostState();
    return {
        shafts: post.shafts,
        bloom: post.bloomBoost,
        flash: post.flash,
        surge: world.u.surge.value,
        heart: world.u.heartAt.value.w,
        eyes: world.u.eyes.value.y,
        lilies: world.u.lilies.value.y,
        lantern: world.u.lanternAt.value.w,
        spirit: world.u.spiritAt.value.w,
        breath: world.u.breath.value,
    };
}

/** Lock, clear and step the chain as the theme's director tells the world. */
function clearOnce(world, combo, extra = {}) {
    world.onLock({ u: combo % 2 ? 0.3 : 0.7, rows: [18, 19], hardDrop: true });
    world.onClear({
        rows: [19], lines: 1, combo, ...extra,
    });
    world.onCombo(combo);
}

const strokesLive = (world) => world.u.counts.value.y;

describe('stillwater surge: a weak answer after a strong one never cuts the light', () => {
    it('adds a single that follows four lines to their light, frame by frame', () => {
        const alone = makeWorld();
        const followed = makeWorld();
        for (const { world } of [alone, followed]) world.onClear({ rows: [16, 17, 18, 19], lines: 4 });
        // Into the answer, then a single on its heels.
        run(alone.world, alone.camera, HUSH_HOLD + 0.15);
        run(followed.world, followed.camera, HUSH_HOLD + 0.15);
        followed.world.onClear({ rows: [19], lines: 1 });
        let frames = 0;
        const check = () => {
            const a = light(alone.world);
            const b = light(followed.world);
            for (const key of ['shafts', 'bloom', 'flash', 'surge', 'heart', 'eyes', 'lilies', 'lantern', 'spirit']) {
                expect(b[key], `${key} at frame ${frames}`).toBeGreaterThanOrEqual(a[key] - 1e-9);
            }
            frames += 1;
        };
        for (let i = 0; i < 180; i++) {
            run(alone.world, alone.camera, 1 / 60);
            run(followed.world, followed.camera, 1 / 60);
            check();
        }
        alone.world.dispose();
        followed.world.dispose();
    });

    it('sends the ring across the picture once: a T-spin on its heels adds to it, never pulls it back', () => {
        const { camera, world } = makeWorld();
        world.onClear({ rows: [16, 17, 18, 19], lines: 4 });
        run(world, camera, HUSH_HOLD + 0.3);
        const before = { ...world.getPostState().prism };
        world.onClear({ rows: [18, 19], lines: 2, tspin: true });
        run(world, camera, 1 / 60);
        const after = world.getPostState().prism;
        expect(after.radius).toBeGreaterThan(before.radius);
        expect(after.strength).toBeGreaterThan(before.strength);
        world.dispose();
    });

    it('keeps a great ring on the water however many small ones come after it', () => {
        const { camera, world } = makeWorld();
        world.onClear({ rows: [16, 17, 18, 19], lines: 4 });
        run(world, camera, HUSH_HOLD + 0.1);
        for (let i = 0; i < 40; i++) world.ring(-4 + i * 0.1, -6, world.time, 0.14, [1, 1, 1], 0.4);
        run(world, camera, 1 / 60);
        const great = Array.from({ length: world.u.counts.value.x }, (_, i) => world.u.ringRows[i * 2])
            .filter((row) => Math.abs(row.x - HEART[0] * world.squeeze) < 1e-6 && Math.abs(row.y - HEART[2]) < 1e-6);
        expect(great).toHaveLength(1);
        world.dispose();
    });
});

describe('stillwater surge: the crescendo', () => {
    it('reads a long chain hotter than its first clear, and breathes back to calm when the hands rest', () => {
        const { camera, world } = makeWorld();
        const rest = light(world);
        const restShafts = rest.shafts;
        clearOnce(world, 1);
        run(world, camera, 0.64);
        const first = { ...light(world), tarnfire: world.u.heat.value.y, state: world.getState() };
        for (let n = 2; n <= 12; n++) {
            clearOnce(world, n, n === 9 ? { cascade: 3 } : {});
            run(world, camera, 0.64);
        }
        const late = { ...light(world), tarnfire: world.u.heat.value.y, state: world.getState() };
        expect(late.state.fever).toBeGreaterThan(0.8);
        expect(late.state.stage).toBe(3);
        expect(late.tarnfire).toBeGreaterThan(first.tarnfire + 0.5);
        expect(late.lantern).toBeGreaterThan(first.lantern);
        expect(late.spirit).toBeGreaterThan(first.spirit);
        expect(late.shafts).toBeGreaterThan(first.shafts);
        expect(world.u.eyes.value.x).toBeGreaterThan(0.9);
        // The hands rest; the chain is over.
        world.onLock({ u: 0.5, rows: [19] });
        world.onCombo(0);
        run(world, camera, 30);
        const calm = world.getState();
        expect(calm.stage).toBe(0);
        expect(calm.fever).toBe(0);
        expect(world.u.heat.value.y).toBeLessThan(1e-3);
        expect(world.getPostState().shafts).toBeCloseTo(restShafts, 2);
        expect(world.u.power.value).toBeLessThan(0.01);
        world.dispose();
    });

    it('draws a quad mid-fever in a breath, where from cold it holds the night\'s breath', () => {
        const cold = makeWorld();
        cold.world.onClear({ rows: [16, 17, 18, 19], lines: 4 });
        run(cold.world, cold.camera, HUSH_HOLD * 0.8);
        const hot = makeWorld();
        for (let n = 1; n <= 10; n++) {
            clearOnce(hot.world, n);
            run(hot.world, hot.camera, 0.64);
        }
        hot.world.onClear({ rows: [16, 17, 18, 19], lines: 4, combo: 11 });
        run(hot.world, hot.camera, HUSH_HOLD * 0.8);
        expect(cold.world.u.breath.value).toBeLessThan(0.5);
        expect(hot.world.u.breath.value).toBeGreaterThan(0.75);
        cold.world.dispose();
        hot.world.dispose();
    });
});

describe('stillwater surge: moments of their own', () => {
    it('crowns four lines with the perfect clear that settles after them: no second hush, no second stroke', () => {
        const { camera, world } = makeWorld();
        world.onClear({ rows: [16, 17, 18, 19], lines: 4 });
        run(world, camera, 0.36);
        const strokes = strokesLive(world);
        const { clears, quads } = world.counts;
        world.onClear({
            lines: 0, perfect: true, crown: true, rows: [],
        });
        // The breath the quad drew keeps coming back: it is never drawn again.
        let last = world.u.breath.value;
        run(world, camera, 0.4, () => {
            expect(world.u.breath.value).toBeGreaterThanOrEqual(last - 1e-9);
            last = world.u.breath.value;
        });
        expect(last).toBeGreaterThan(0.95);
        expect(strokesLive(world)).toBe(strokes);
        expect(world.counts).toMatchObject({ clears, quads });
        expect(world.u.lift.value).toBeGreaterThan(0.8);
        expect(world.story.hearts).toHaveLength(1);
        expect(world.story.heart.gain).toBeGreaterThan(1);
        world.dispose();
    });

    it('whirls the water a little for a T-spin that clears nothing, and counts no clear', () => {
        const { camera, world } = makeWorld();
        world.onLock({ u: 0.3, rows: [18, 19] });
        run(world, camera, 1);
        const rings = world.u.counts.value.x;
        const wind = world.u.wind.value;
        const strokes = strokesLive(world);
        world.onClear({ lines: 0, tspin: true, rows: [] });
        run(world, camera, 0.5);
        expect(world.u.counts.value.x).toBeGreaterThan(rings);
        expect(world.u.wind.value).toBeGreaterThan(wind);
        expect(strokesLive(world)).toBe(strokes);
        expect(world.counts.clears).toBe(0);
        world.dispose();
    });

    it('answers a back-to-back: the lantern blazes, their light runs out toward each other, more for a second', () => {
        const plain = makeWorld();
        const b2b = makeWorld();
        plain.world.onClear({ rows: [16, 17, 18, 19], lines: 4 });
        b2b.world.onClear({ rows: [16, 17, 18, 19], lines: 4, b2b: true });
        let reach = 0;
        run(plain.world, plain.camera, 0.4);
        run(b2b.world, b2b.camera, 0.4, () => {
            reach = Math.max(reach, b2b.world.u.path.value.x);
        });
        expect(b2b.world.u.lanternAt.value.w).toBeGreaterThan(plain.world.u.lanternAt.value.w + 0.5);
        expect(reach).toBeGreaterThan(0.2);
        expect(plain.world.u.path.value.x).toBe(0);
        // A second back-to-back while the first still burns runs further.
        b2b.world.onClear({ rows: [16, 17, 18, 19], lines: 4, b2b: true });
        let again = 0;
        run(b2b.world, b2b.camera, 0.5, () => {
            again = Math.max(again, b2b.world.u.path.value.x);
        });
        expect(again).toBeGreaterThan(reach);
        plain.world.dispose();
        b2b.world.dispose();
    });
});
