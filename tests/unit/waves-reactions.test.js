import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    WAVES_REACTION_LIMITS,
    WavesReactions,
} from '../../src/themes/waves/waves-reactions.js';
import { WavesOcean } from '../../src/themes/waves/waves-ocean.js';

function seededRandom(seed = 187) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function create(quality = 'High') {
    return new WavesReactions({ quality, rng: seededRandom() });
}

function expectBounded(frame) {
    for (const key of ['pulse', 'foam', 'spray', 'shafts', 'surgeStrength']) {
        expect(Number.isFinite(frame[key])).toBe(true);
        expect(frame[key]).toBeGreaterThanOrEqual(0);
        expect(frame[key]).toBeLessThanOrEqual(1);
    }
    for (const impact of frame.impacts) {
        expect(impact.z).toBeGreaterThanOrEqual(-12);
        expect(impact.z).toBeLessThanOrEqual(25);
        expect(Math.abs(Math.cos(impact.angle))).toBeGreaterThan(0.69);
        expect(impact.age).toBeGreaterThanOrEqual(0);
        expect(impact.age).toBeLessThan(impact.duration);
    }
}

describe('Waves reaction director', () => {
    it('gives every quality tier a bounded, visible lock splash', () => {
        for (const [quality, capacity] of Object.entries(WAVES_REACTION_LIMITS)) {
            const reactions = create(quality);
            reactions.onPieceLock();
            expect(reactions.impactSlots).toHaveLength(capacity);
            expect(reactions.frame.impacts).toHaveLength(1);
            expect(reactions.frame.impacts[0].kind).toBe('lock');
            expect(reactions.frame.pulse).toBeGreaterThan(0);
            expect(reactions.frame.shafts).toBe(0);
            expectBounded(reactions.frame);
        }
    });

    it('places lock splashes from viewport origin before absolute board coordinates', () => {
        const reactions = create();
        reactions.onPieceLock({ piece: { x: 8, y: 900 }, viewportOrigin: { x: 0.1, y: 0.9 } });
        reactions.onPieceLock({ piece: { x: 8 } });
        const [left, right] = reactions.frame.impacts;
        expect(Math.cos(left.angle)).toBeGreaterThan(0.69);
        expect(Math.cos(right.angle)).toBeLessThan(-0.69);
        expectBounded(reactions.frame);
    });

    it.each([16 / 9, 390 / 844])('maps board left/right onto the visible walls at aspect %s', (aspect) => {
        const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 240);
        const ocean = new WavesOcean({
            scene: new THREE.Scene(), camera, quality: 'Minimal', rng: () => 0.5,
        });
        try {
            ocean.prepareCamera(aspect, true);
            camera.updateMatrixWorld(true);
            const reactions = new WavesReactions({ rng: () => 0.5 });
            reactions.onPieceLock({ viewportOrigin: { x: 0.1 } });
            reactions.onPieceLock({ viewportOrigin: { x: 0.9 } });
            const [left, right] = reactions.frame.impacts;
            const project = (impact) => new THREE.Vector3(
                Math.cos(impact.angle) * 13,
                Math.sin(impact.angle) * 11,
                impact.z,
            ).project(camera).x;
            const axisX = new THREE.Vector3(0, 0, left.z).project(camera).x;
            expect(project(left)).toBeLessThan(axisX);
            expect(project(right)).toBeGreaterThan(axisX);
        } finally { ocean.dispose(); }
    });

    it('separates single clears from Tetris with a travelling swell and staggered spray', () => {
        const single = create();
        const tetris = create();
        single.onLineClear(1);
        tetris.onLineClear(4);
        expect(tetris.frame.foam).toBeGreaterThan(single.frame.foam);
        expect(tetris.frame.spray).toBeGreaterThan(single.frame.spray);
        expect(tetris.frame.impacts).toHaveLength(1);
        tetris.update(0.4);
        expect(tetris.frame.impacts).toHaveLength(8);
        expect(tetris.frame.surgeStrength).toBeGreaterThan(0);
        expect(tetris.frame.surgeZ).toBeGreaterThan(-18);
        expectBounded(tetris.frame);
    });

    it('makes combo 2 readable and continues increasing shafts and foam above combo 7', () => {
        const frames = [2, 3, 7, 8, 14].map((count) => {
            const reactions = create();
            reactions.onCombo(count);
            return reactions.frame;
        });
        expect(frames[0].shafts).toBeGreaterThan(0.2);
        expect(frames[0].foam).toBeGreaterThan(0.1);
        for (let index = 1; index < frames.length; index++) {
            expect(frames[index].shafts).toBeGreaterThan(frames[index - 1].shafts);
            expect(frames[index].foam).toBeGreaterThan(frames[index - 1].foam);
        }
        frames.forEach(expectBounded);
    });

    it('preserves a travelling swell at retrigger and coalesces one successor crest', () => {
        const reactions = create();
        reactions.onLineClear(4);
        reactions.update(0.55);
        const before = reactions.frame;
        const state = reactions.surge;
        reactions.onCombo(8);
        reactions.onLineClear(2);
        reactions.onCombo(14);
        expect(reactions.surge).toBe(state);
        expect(reactions.frame.surgeStrength).toBe(before.surgeStrength);
        expect(reactions.frame.surgeZ).toBe(before.surgeZ);
        expect(reactions.surge.pendingPeak).toBeGreaterThan(0);
        expect(reactions.surge.pendingPeak).toBeLessThanOrEqual(1);
        reactions.update(1.1);
        expect(reactions.surge.age).toBeCloseTo(0.05, 10);
        expect(reactions.surge.pendingPeak).toBe(0);
        expect(reactions.frame.surgeStrength).toBeGreaterThan(0);
        reactions.update(4);
        expect(reactions.frame.surgeStrength).toBe(0);
    });

    it('produces the same envelopes and queued-impact ages at 30, 60 and 144 Hz', () => {
        const frames = [30, 60, 144].map((fps) => {
            const reactions = create();
            reactions.onPieceLock();
            reactions.onLineClear(4);
            reactions.onCombo(8);
            for (let frame = 0; frame < fps / 2; frame++) reactions.update(1 / fps);
            return reactions.frame;
        });
        const reference = frames[0];
        for (const frame of frames.slice(1)) {
            for (const key of ['pulse', 'foam', 'spray', 'shafts', 'surgeStrength', 'surgeZ']) {
                expect(frame[key]).toBeCloseTo(reference[key], 10);
            }
            expect(frame.impacts.map((impact) => impact.id)).toEqual(reference.impacts.map((impact) => impact.id));
            frame.impacts.forEach((impact, index) => {
                expect(impact.age).toBeCloseTo(reference.impacts[index].age, 10);
            });
        }
    });

    it('starts a queued swell at the same boundary across frame rates', () => {
        const frames = [30, 60, 144].map((fps) => {
            const reactions = create();
            reactions.onLineClear(4);
            for (let frame = 0; frame < fps / 2; frame++) reactions.update(1 / fps);
            reactions.onCombo(12);
            for (let frame = 0; frame < fps * 2; frame++) reactions.update(1 / fps);
            return reactions.frame;
        });
        expect(frames[0].surgeStrength).toBeGreaterThan(0);
        for (const frame of frames.slice(1)) {
            expect(frame.surgeStrength).toBeCloseTo(frames[0].surgeStrength, 10);
            expect(frame.surgeZ).toBeCloseTo(frames[0].surgeZ, 10);
        }
    });

    it('keeps rapid lock, clear and combo bursts within fixed slot and queue budgets', () => {
        for (const quality of Object.keys(WAVES_REACTION_LIMITS)) {
            const reactions = create(quality);
            const storage = [...reactions.impactSlots];
            for (let event = 0; event < 200; event++) {
                reactions.onPieceLock();
                reactions.onLineClear(4);
                reactions.onCombo(60);
                if (event % 5 === 0) reactions.update(0.016);
                expect(reactions.frame.impacts.length).toBeLessThanOrEqual(reactions.maxImpacts);
                expect(reactions.pendingImpacts.length).toBeLessThanOrEqual(reactions.maxQueuedImpacts);
                expectBounded(reactions.frame);
            }
            expect(reactions.impactSlots).toEqual(storage);
            storage.forEach((slot, index) => expect(reactions.impactSlots[index]).toBe(slot));
        }
    });

    it('reclaims the oldest active splash and cycles equally aged slots', () => {
        const reactions = create('Minimal');
        reactions.onPieceLock();
        reactions.update(0.2);
        reactions.onPieceLock();
        reactions.onPieceLock();
        reactions.onPieceLock();
        const freshAngles = reactions.frame.impacts.slice(1).map((impact) => impact.angle);
        reactions.onPieceLock();
        expect(reactions.frame.impacts[0].age).toBe(0);
        expect(reactions.frame.impacts.slice(1).map((impact) => impact.angle)).toEqual(freshAngles);
        for (let event = 0; event < 3; event++) reactions.onPieceLock();
        expect(reactions.cursor).toBe(0);
    });

    it('ignores invalid counts and time steps without poisoning the scene', () => {
        const reactions = create();
        for (const value of [NaN, Infinity, -5, 0, 'garbage']) {
            expect(reactions.onLineClear(value)).toBe(false);
            expect(reactions.onCombo(value)).toBe(false);
            reactions.update(value);
        }
        expect(reactions.frame.impacts).toHaveLength(0);
        expect(reactions.time).toBe(0);
        expect(reactions.onLineClear('99')).toBe(true);
        expect(reactions.onCombo('99')).toBe(true);
        reactions.update(0.3);
        expectBounded(reactions.frame);
    });

    it('retires all responses and resets pending work without reallocating slots', () => {
        const reactions = create();
        reactions.onLineClear(4);
        reactions.onCombo(10);
        reactions.update(15);
        expect(reactions.pendingImpacts).toHaveLength(0);
        expect(reactions.frame.impacts).toHaveLength(0);
        expect(reactions.frame).toMatchObject({
            pulse: 0, foam: 0, spray: 0, shafts: 0, surgeStrength: 0,
        });
        reactions.onLineClear(4);
        const storage = reactions.impactSlots;
        reactions.reset();
        expect(reactions.impactSlots).toBe(storage);
        expect(reactions.pendingImpacts).toHaveLength(0);
        expect(reactions.time).toBe(0);
        expect(reactions.frame.impacts).toHaveLength(0);
        reactions.update(1);
        expect(reactions.frame.impacts).toHaveLength(0);
        reactions.onPieceLock();
        expect(reactions.frame.impacts).toHaveLength(1);
    });
});
