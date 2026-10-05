import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    NEON_DISTRICT_EVENT_BUDGETS,
    NeonDistrictEvents,
} from '../../src/themes/neon-district/neon-district-events.js';

function create(options = {}) {
    return new NeonDistrictEvents(new THREE.Scene(), options);
}

describe('Neon District pooled city event effects', () => {
    it('coalesces simultaneous events to one strongest cue of each kind', () => {
        const events = create();
        try {
            events.triggerClear(4);
            events.triggerClear(1);
            events.triggerCombo(8);
            events.triggerCombo(2);
            events.triggerLock();
            expect(events.slots.filter((slot) => slot.group.visible)).toHaveLength(0);
            events.update(0.3);
            const active = events.slots.filter((slot) => slot.group.visible);
            expect(active).toHaveLength(3);
            expect(active.find((slot) => slot.kind === 1).strength.value).toBeCloseTo(0.99);
            expect(active.find((slot) => slot.kind === 2).strength.value).toBeCloseTo(0.930585);
            expect(events.frame.clear).toBeGreaterThan(events.frame.lock);
            expect(events.pending).toEqual(new Float32Array(3));
        } finally { events.dispose(); }
    });

    it('keeps rapid mixed events within fixed quality budgets and preserves every resource identity', () => {
        for (const [quality, budget] of Object.entries(NEON_DISTRICT_EVENT_BUDGETS)) {
            const events = create({ quality });
            try {
                const slots = [...events.slots];
                const objects = [...events.objects];
                const resources = objects.map((object) => ({ geometry: object.geometry, material: object.material }));
                const { frame, pending } = events;
                for (let i = 0; i < 250; i++) {
                    events.triggerLock();
                    events.triggerClear(1000);
                    events.triggerCombo(1000);
                    events.update(1 / 120);
                    expect(events.frame.pulse).toBeGreaterThanOrEqual(0);
                    expect(events.frame.pulse).toBeLessThanOrEqual(1);
                }
                expect(events.slots).toEqual(slots);
                expect(events.slots).toHaveLength(budget.slots * 3);
                expect(events.objects).toEqual(objects);
                expect(events.scene.children).toEqual([events.group]);
                expect(events.frame).toBe(frame);
                expect(events.pending).toBe(pending);
                expect(events.particleGeometry.instanceCount).toBe(budget.particles);
                objects.forEach((object, index) => {
                    expect(object.geometry).toBe(resources[index].geometry);
                    expect(object.material).toBe(resources[index].material);
                    expect(object.material.isNodeMaterial).toBe(true);
                });
            } finally { events.dispose(); }
        }
    });

    it('replaces only the oldest full slot and preserves overlapping younger scans', () => {
        const events = create({ quality: 'Ultra' });
        try {
            events.triggerClear(1); events.update(0.1);
            events.triggerClear(2); events.update(0.1);
            events.triggerClear(3); events.update(0.1);
            const scans = events.slots.filter((slot) => slot.kind === 1);
            const secondAge = scans[1].age;
            const thirdAge = scans[2].age;
            events.triggerClear(4); events.update(0.1);
            expect(scans.map((slot) => slot.serial)).toEqual([3, 1, 2]);
            expect(scans[0].age).toBeCloseTo(0.1);
            expect(scans[1].age).toBeCloseTo(secondAge + 0.1);
            expect(scans[2].age).toBeCloseTo(thirdAge + 0.1);
        } finally { events.dispose(); }
    });

    it('hides expired effects, freezes on zero delta and tolerates invalid game payloads', () => {
        const events = create();
        try {
            for (const value of [NaN, Infinity, -4, 0]) {
                events.triggerClear(value); events.triggerCombo(value); events.triggerLock(value);
            }
            events.update(NaN);
            expect(events.slots.some((slot) => slot.group.visible)).toBe(false);
            events.triggerClear(4); events.triggerCombo(8); events.triggerLock();
            events.update(0.4);
            const ages = events.slots.map((slot) => slot.age);
            const frame = { ...events.frame };
            events.update(0);
            events.update(-1);
            expect(events.slots.map((slot) => slot.age)).toEqual(ages);
            expect(events.frame).toEqual(frame);
            events.update(10);
            expect(events.slots.some((slot) => slot.group.visible)).toBe(false);
            expect(events.frame).toEqual({ lock: 0, clear: 0, combo: 0, pulse: 0 });
        } finally { events.dispose(); }
    });

    it('preserves static light responses while skipping moving sparks under reduced motion', () => {
        const normal = create();
        const quiet = create({ reducedMotion: true, quality: 'Minimal' });
        try {
            normal.triggerCombo(7); normal.update(0.35);
            quiet.triggerCombo(7); quiet.update(0.35);
            expect(quiet.motion.value).toBe(0);
            expect(quiet.slots.filter((slot) => slot.sparks).every((slot) => !slot.sparks.visible)).toBe(true);
            expect(quiet.frame.combo).toBeGreaterThan(0);
            expect(quiet.frame.combo).toBeLessThan(normal.frame.combo * 0.5);
            quiet.setReducedMotion(false);
            expect(quiet.motion.value).toBe(1);
            expect(quiet.slots.filter((slot) => slot.sparks).every((slot) => slot.sparks.visible)).toBe(true);
        } finally { normal.dispose(); quiet.dispose(); }
    });

    it('produces equal envelopes and event ages at 30, 60 and 144 Hz', () => {
        const states = [30, 60, 144].map((fps) => {
            const events = create();
            events.triggerClear(4); events.triggerCombo(7); events.triggerLock();
            for (let i = 0; i < fps / 2; i++) events.update(1 / fps);
            return events;
        });
        try {
            for (const other of states.slice(1)) {
                for (const key of ['lock', 'clear', 'combo', 'pulse']) {
                    expect(other.frame[key]).toBeCloseTo(states[0].frame[key], 10);
                }
                other.slots.forEach((slot, index) => {
                    expect(slot.age).toBeCloseTo(states[0].slots[index].age, 10);
                });
            }
        } finally { states.forEach((events) => events.dispose()); }
    });

    it('cleans up shared geometries and unique materials exactly once and becomes inert', () => {
        const events = create();
        const geometryDisposals = [events.planeGeometry, events.particleGeometry]
            .map((geometry) => vi.spyOn(geometry, 'dispose'));
        const materialDisposals = events.slots.flatMap((slot) => slot.materials)
            .map((material) => vi.spyOn(material, 'dispose'));
        const objectDisposals = events.objects.map((object) => vi.spyOn(object, 'dispose'));
        events.triggerClear(4); events.update(0.3);
        events.dispose(); events.dispose();
        geometryDisposals.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
        materialDisposals.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
        objectDisposals.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
        expect(events.scene.children).toHaveLength(0);
        events.triggerLock(); events.triggerClear(4); events.triggerCombo(8); events.update(0.2);
        expect(events.slots.some((slot) => slot.group.visible)).toBe(false);
        expect(events.frame.pulse).toBe(0);
        expect(events.pending).toEqual(new Float32Array(3));
    });

    it('prewarms dormant and reduced-motion meshes through the awaited object/camera/scene contract', async () => {
        const events = create({ reducedMotion: true });
        const camera = new THREE.PerspectiveCamera();
        let finish;
        const renderer = { compileAsync: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
        const warming = events.prewarm(renderer, camera);
        expect(renderer.compileAsync).toHaveBeenCalledWith(events.group, camera, events.scene);
        expect(events.slots.every((slot) => slot.group.visible)).toBe(true);
        expect(events.objects.every((object) => object.visible)).toBe(true);
        finish();
        await warming;
        expect(events.slots.every((slot) => !slot.group.visible)).toBe(true);
        expect(events.slots.filter((slot) => slot.sparks).every((slot) => !slot.sparks.visible)).toBe(true);
        events.dispose();
    });

    it('never restores or revives meshes when disposal cancels an in-flight prewarm', async () => {
        const events = create();
        let finish;
        const renderer = { compileAsync: () => new Promise((resolve) => { finish = resolve; }) };
        const warming = events.prewarm(renderer, new THREE.PerspectiveCamera());
        events.dispose();
        finish();
        await warming;
        expect(events.scene.children).toHaveLength(0);
        expect(events.group.visible).toBe(false);
        expect(events.objects.every((object) => !object.visible)).toBe(true);
        expect(events.slots.every((slot) => !slot.group.visible)).toBe(true);
    });

    it('preserves cues activated after gameplay resumes during an awaited prewarm', async () => {
        const events = create();
        let finish;
        const renderer = { compileAsync: () => new Promise((resolve) => { finish = resolve; }) };
        try {
            const warming = events.prewarm(renderer, new THREE.PerspectiveCamera());
            events.triggerClear(4);
            events.update(0.3);
            const liveScan = events.slots.find((slot) => slot.kind === 1 && slot.age < slot.duration);
            const liveSerial = liveScan.serial;
            finish();
            await warming;
            expect(liveScan.group.visible).toBe(true);
            expect(liveScan.age).toBeCloseTo(0.3);
            expect(liveScan.serial).toBe(liveSerial);
            expect(events.slots.filter((slot) => slot.group.visible)).toEqual([liveScan]);
            expect(events.frame.clear).toBeGreaterThan(0);
        } finally { events.dispose(); }
    });

    it('uses live reset, expiry and reduced-motion state when an in-flight prewarm finishes', async () => {
        const events = create();
        let finish;
        const renderer = { compileAsync: () => new Promise((resolve) => { finish = resolve; }) };
        try {
            events.triggerCombo(7);
            events.update(0.4);
            const warming = events.prewarm(renderer, new THREE.PerspectiveCamera());
            events.reset();
            events.setReducedMotion(true);
            events.triggerLock();
            events.update(0.25);
            finish();
            await warming;
            expect(events.slots.filter((slot) => slot.group.visible)).toHaveLength(1);
            expect(events.slots.find((slot) => slot.group.visible).kind).toBe(0);
            expect(events.slots.filter((slot) => slot.sparks).every((slot) => !slot.sparks.visible)).toBe(true);

            const expiryWarm = events.prewarm(renderer, new THREE.PerspectiveCamera());
            events.update(10);
            events.setReducedMotion(false);
            finish();
            await expiryWarm;
            expect(events.slots.every((slot) => !slot.group.visible)).toBe(true);
            expect(events.slots.filter((slot) => slot.sparks).every((slot) => slot.sparks.visible)).toBe(true);
            expect(events.frame.pulse).toBe(0);
        } finally { events.dispose(); }
    });

    it('keeps every canyon scan quad beyond the camera-near signage and street', () => {
        const events = create();
        try {
            const scans = events.objects.filter((object) => object.name.endsWith('-canyon-scan'));
            expect(scans).toHaveLength(4);
            const matrix = new THREE.Matrix4();
            const point = new THREE.Vector3();
            for (const scan of scans) {
                const positions = scan.geometry.attributes.position;
                for (let instance = 0; instance < scan.count; instance++) {
                    scan.getMatrixAt(instance, matrix);
                    for (let vertex = 0; vertex < positions.count; vertex++) {
                        point.fromBufferAttribute(positions, vertex).applyMatrix4(matrix);
                        expect(point.z).toBeLessThan(-200);
                        expect(Math.abs(point.x)).toBeCloseTo(104.4, 4);
                    }
                }
            }
        } finally { events.dispose(); }
    });
});
