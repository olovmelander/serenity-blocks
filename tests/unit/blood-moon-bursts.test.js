import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createBloodMoonBursts } from '../../src/playground/effects/blood-moon-bursts.js';

describe('Blood Moon bounded burst pool', () => {
    let scene;
    let shared;
    let bursts;

    beforeEach(() => {
        scene = new THREE.Scene();
        shared = {
            center: uniform(new THREE.Vector2(0.235, 0.62)),
            radius: uniform(0.23),
            aspect: uniform(1.6),
            viewport: uniform(new THREE.Vector2(1280, 800)),
            time: uniform(0),
        };
        bursts = createBloodMoonBursts({
            scene, shared, count: 30, random: () => 0.37,
        });
    });

    afterEach(() => { bursts.dispose(); });

    it('merges same-frame cues into one strongest shower and freezes its age at zero delta', () => {
        bursts.trigger(0.3);
        bursts.trigger(0.9);
        bursts.trigger(0.5);
        expect(bursts.getDiagnostics().pendingStrength).toBe(0.9);
        expect(bursts.getDiagnostics().activeSlots).toBe(0);

        bursts.update(0.1);
        const emitted = bursts.getDiagnostics();
        expect(emitted.activeSlots).toBe(1);
        expect(emitted.activeParticles).toBe(30);
        expect(emitted.pendingStrength).toBe(0);
        expect(emitted.slots[0].strength).toBe(0.9);
        expect(emitted.slots[0].age).toBeCloseTo(0.1);
        bursts.update(0);
        expect(bursts.getDiagnostics()).toEqual(emitted);
    });

    it('reuses only the oldest of three full slots while other showers continue aging', () => {
        const objects = [...bursts.objects];
        bursts.trigger(1);
        bursts.update(0.4);
        bursts.trigger(0.8);
        bursts.update(0.3);
        bursts.trigger(0.6);
        bursts.update(0.2);
        const previous = bursts.getDiagnostics();
        expect(previous.activeSlots).toBe(3);

        bursts.trigger(0.7);
        bursts.update(0.1);
        const current = bursts.getDiagnostics();
        expect(current.activeSlots).toBe(3);
        expect(current.activeParticles).toBe(90);
        expect(current.slots.map((slot) => slot.serial)).toEqual([3, 1, 2]);
        expect(current.slots[0].age).toBeCloseTo(0.1);
        expect(current.slots[0].strength).toBe(0.7);
        for (const index of [1, 2]) {
            expect(current.slots[index].age).toBeCloseTo(previous.slots[index].age + 0.1);
            expect(current.slots[index].strength).toBe(previous.slots[index].strength);
        }
        expect(scene.children).toHaveLength(3);
        bursts.objects.forEach((object, index) => { expect(object).toBe(objects[index]); });
    });

    it('captures each launch origin before the moon moves and never drags existing showers', () => {
        bursts.trigger();
        shared.center.value.set(0.6, 0.8);
        bursts.update(0.1);
        expect(bursts.getDiagnostics().slots[0].origin).toEqual({ x: 0.235, y: 0.62 });

        shared.center.value.set(0.8, 0.2);
        bursts.trigger();
        bursts.update(0.3);
        const current = bursts.getDiagnostics();
        expect(current.slots[0].origin).toEqual({ x: 0.235, y: 0.62 });
        expect(current.slots[1].origin).toEqual({ x: 0.8, y: 0.2 });
        shared.center.value.set(0.1, 0.9);
        bursts.update(0.2);
        expect(bursts.getDiagnostics().slots.map((slot) => slot.origin))
            .toEqual(current.slots.map((slot) => slot.origin));
    });

    it('seeks to the same single-burst state after overlapping activity and hides expired slots', () => {
        bursts.seek(0.65, 0.7);
        const first = bursts.getDiagnostics();
        bursts.trigger();
        bursts.update(0.4);
        bursts.trigger(0.8);
        bursts.update(0.2);
        expect(bursts.getDiagnostics().activeSlots).toBe(3);

        bursts.seek(0.65, 0.7);
        const repeated = bursts.getDiagnostics();
        expect(repeated.activeSlots).toBe(1);
        expect(repeated.pendingStrength).toBe(0);
        expect(repeated.slots[0]).toEqual(first.slots[0]);
        expect(bursts.objects.map((object) => object.visible)).toEqual([true, false, false]);
        bursts.update(repeated.lifetime);
        expect(bursts.getDiagnostics().activeSlots).toBe(0);
        expect(bursts.getDiagnostics().activeParticles).toBe(0);
        expect(bursts.objects.every((object) => !object.visible)).toBe(true);
        bursts.seek(repeated.lifetime, 1);
        expect(bursts.getDiagnostics().activeSlots).toBe(0);
    });

    it('keeps a drifting tail beyond the former cutoff and retires it at the new lifetime', () => {
        bursts.trigger(0.8);
        bursts.update(5.2);
        const drifting = bursts.getDiagnostics();
        expect(drifting.lifetime).toBeGreaterThanOrEqual(6.5);
        expect(drifting.lifetime).toBeLessThanOrEqual(7);
        expect(drifting.activeSlots).toBe(1);
        expect(bursts.objects[0].visible).toBe(true);

        bursts.update(drifting.lifetime - 5.2 - 0.01);
        expect(bursts.getDiagnostics().activeSlots).toBe(1);
        bursts.update(0.02);
        const expired = bursts.getDiagnostics();
        expect(expired.activeSlots).toBe(0);
        expect(expired.slots[0].age).toBe(expired.lifetime);
        expect(bursts.objects.every((object) => !object.visible)).toBe(true);
    });

    it('disposes the shared geometry exactly once and makes cleanup idempotent', () => {
        const { geometry } = bursts.objects[0];
        expect(bursts.objects.every((object) => object.geometry === geometry)).toBe(true);
        const geometryDispose = vi.spyOn(geometry, 'dispose');
        const materialDisposals = bursts.objects.map((object) => vi.spyOn(object.material, 'dispose'));
        bursts.trigger();
        bursts.update(0.1);

        bursts.dispose();
        bursts.dispose();
        expect(geometryDispose).toHaveBeenCalledTimes(1);
        materialDisposals.forEach((dispose) => { expect(dispose).toHaveBeenCalledTimes(1); });
        expect(scene.children).toHaveLength(0);
        expect(bursts.objects.every((object) => !object.visible)).toBe(true);
        bursts.trigger();
        bursts.update(0.2);
        expect(bursts.getDiagnostics().activeSlots).toBe(0);
    });
});
