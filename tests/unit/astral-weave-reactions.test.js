import { describe, expect, it } from 'vitest';
import {
    ASTRAL_WEAVE_BURST_LIMITS,
    AstralWeaveFXController,
} from '../../src/themes/astral-weave/astral-weave-fx-controller.js';

function excitedController() {
    const controller = new AstralWeaveFXController();
    controller.onPieceLock();
    controller.onLineClear(4);
    controller.onCombo(6);
    return controller;
}

describe('Astral Weave event language', () => {
    it('keeps the lock stitch distinct from a clear wave and a celebration crown', () => {
        const controller = new AstralWeaveFXController();
        const lock = controller.onPieceLock();
        const stitch = controller.getSignals();
        expect(stitch.stitchPulse).toBeGreaterThan(0);
        expect(stitch.linePulse).toBe(0);
        expect(stitch.lineWaveProgress).toBe(1);
        expect(stitch.crownPulse).toBe(0);
        expect(stitch.cameraImpulse).toBe(0);
        expect(lock.shockwaveCount).toBe(0);

        controller.onLineClear(1);
        expect(controller.getSignals()).toMatchObject({ lineWaveProgress: 0, crownPulse: 0 });
        controller.step(0.8);
        expect(controller.getSignals().lineWaveProgress).toBeGreaterThan(0.4);
        expect(controller.getSignals().lineWaveProgress).toBeLessThan(0.6);

        controller.onLineClear(4);
        expect(controller.getSignals().crownPulse).toBeGreaterThan(0.7);
        expect(controller.getSignals().eventHue).toBeGreaterThan(0.8);

        controller.reset();
        controller.onCombo(3);
        expect(controller.getSignals().crownPulse).toBe(0);
        controller.onCombo(4);
        expect(controller.getSignals().crownPulse).toBeGreaterThan(0);
    });

    it('has the same envelope and wave phase at 30, 60, 144 FPS or one elapsed-time step', () => {
        const reference = excitedController();
        reference.step(1.2);
        const expected = reference.getSignals();

        for (const frameCount of [36, 72, 173]) {
            const controller = excitedController();
            for (let index = 0; index < frameCount; index += 1) controller.step(1.2 / frameCount);
            const actual = controller.getSignals();
            Object.keys(expected).forEach((name) => {
                expect(actual[name], `signal ${name} after ${frameCount} frames`).toBeCloseTo(expected[name], 10);
            });
        }
    });

    it('lets a stitch settle while the combo aurora carries a longer afterglow', () => {
        const controller = excitedController();
        controller.step(2);
        const signals = controller.getSignals();
        expect(signals.stitchPulse).toBeLessThan(0.0001);
        expect(signals.cameraImpulse).toBe(0);
        expect(signals.weaveCharge).toBeGreaterThan(0.3);
        expect(signals.comboEnergy).toBeGreaterThan(0.2);
        expect(signals.lineWaveProgress).toBe(1);

        controller.step(60);
        Object.entries(controller.getSignals()).forEach(([name, value]) => {
            if (name === 'time' || name === 'lineWaveProgress') return;
            expect(value, `settled ${name}`).toBe(0);
        });
    });

    it('saturates event queues and signals when many events arrive before a render', () => {
        const controller = new AstralWeaveFXController();
        for (let index = 0; index < 1000; index += 1) {
            controller.onPieceLock();
            controller.onLineClear(1000000);
            controller.onCombo(1000000);
        }
        const signals = controller.getSignals();
        expect(signals.cameraImpulse).toBeLessThanOrEqual(0.2);
        expect(signals.weaveCharge).toBeLessThanOrEqual(1);
        expect(signals.crownPulse).toBeLessThanOrEqual(1);
        expect(signals.eventHue).toBeLessThanOrEqual(1);
        Object.values(signals).forEach((value) => expect(Number.isFinite(value)).toBe(true));
        expect(controller.drainBursts()).toEqual(ASTRAL_WEAVE_BURST_LIMITS);
        expect(controller.drainBursts()).toEqual({
            flowShards: 0, dustPops: 0, shockwaves: 0, constellationFractures: 0,
        });
    });

    it('expires an unrendered impact after a stall while preserving the travelling wave and aurora', () => {
        const controller = excitedController();
        controller.step(0.5);
        expect(Object.values(controller.drainBursts())).toEqual([0, 0, 0, 0]);
        expect(controller.getSignals().lineWaveProgress).toBeGreaterThan(0);
        expect(controller.getSignals().lineWaveProgress).toBeLessThan(1);
        expect(controller.getSignals().weaveCharge).toBeGreaterThan(0.5);

        controller.onPieceLock();
        controller.step(1 / 30);
        expect(controller.drainBursts()).toMatchObject({ flowShards: 8, dustPops: 4 });

        controller.onLineClear(4);
        controller.step(60);
        expect(Object.values(controller.drainBursts())).toEqual([0, 0, 0, 0]);
    });

    it('rejects invalid times and burst names and normalizes invalid counts without poisoning signals', () => {
        const controller = excitedController();
        const before = controller.getSignals();
        for (const delta of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) controller.step(delta);
        expect(controller.getSignals()).toEqual(before);

        controller.drainBursts();
        controller.queueBurst('__proto__', 10);
        controller.queueBurst('toString', 10);
        controller.queueBurst('flowShards', Number.NaN);
        controller.queueBurst('flowShards', Number.POSITIVE_INFINITY);
        controller.queueBurst('dustPops', -12);
        expect(Object.values(controller.drainBursts())).toEqual([0, 0, 0, 0]);

        for (const count of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -10, undefined]) {
            controller.onLineClear(count);
            expect(controller.onCombo(count).combo).toBe(1);
        }
        Object.values(controller.getSignals()).forEach((value) => expect(Number.isFinite(value)).toBe(true));
    });

    it('resets all queued events and envelopes for a fresh theme activation', () => {
        const controller = excitedController();
        controller.step(0.2);
        controller.reset();
        expect(controller.getSignals()).toEqual(new AstralWeaveFXController().getSignals());
        expect(controller.drainBursts()).toEqual({
            flowShards: 0, dustPops: 0, shockwaves: 0, constellationFractures: 0,
        });
    });
});
