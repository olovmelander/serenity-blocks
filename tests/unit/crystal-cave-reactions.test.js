import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { CrystalCaveReactions } from '../../src/themes/crystal-cave/crystal-cave-reactions.js';
import { QUALITY_PRESETS } from '../../src/themes/crystal-cave/crystal-cave-quality.js';

const instances = [];

function create(quality = { eventParticles: 64, maxArcs: 3, maxRipples: 3 }) {
    const scene = new THREE.Scene();
    const uniforms = {
        time: uniform(0),
        energy: uniform(0),
        resonance: uniform(0),
        waveRadius: uniform(-100),
        waveIntensity: uniform(0),
        waveOrigin: uniform(new THREE.Vector3(0, -7, -8)),
    };
    const reactions = new CrystalCaveReactions({
        scene,
        quality,
        uniforms,
        anchors: [
            { position: new THREE.Vector3(-12, 2, -8), color: 0x8bece1 },
            { position: new THREE.Vector3(-20, 10, -15), color: 0xa98cfa },
            { position: new THREE.Vector3(12, 4, -10), color: 0xf1b46e },
            { position: new THREE.Vector3(18, 12, -17), color: 0x86dff6 },
        ],
    });
    instances.push(reactions);
    return { reactions, scene, uniforms };
}

function advance(reactions, seconds, hz) {
    let elapsed = 0;
    while (elapsed < seconds - 1e-12) {
        const delta = Math.min(1 / hz, seconds - elapsed);
        reactions.update(delta);
        elapsed += delta;
    }
}

afterEach(() => {
    for (const instance of instances) instance.dispose();
    instances.length = 0;
    vi.restoreAllMocks();
});

describe('Crystal Cave fixed-capacity resonance', () => {
    it('keeps hundreds of overlapping events within the same render resources', () => {
        const { reactions, uniforms, scene } = create();
        const geometries = [...reactions.geometries];
        const materials = [...reactions.materials];
        const objects = [...reactions.group.children];
        for (let index = 0; index < 250; index++) {
            reactions.pieceLock();
            reactions.lineClear(4);
            reactions.combo(60);
            reactions.update(1 / 144);
        }
        expect([...reactions.geometries]).toEqual(geometries);
        expect([...reactions.materials]).toEqual(materials);
        expect(reactions.group.children).toEqual(objects);
        expect(scene.children).toHaveLength(1);
        expect(reactions.debug.activeShards + reactions.debug.activeMotes).toBeLessThanOrEqual(64);
        expect(reactions.debug.activeArcs).toBeLessThanOrEqual(3);
        expect(reactions.debug.activeRipples).toBeLessThanOrEqual(3);
        expect(reactions.debug.activeCoronas).toBeLessThanOrEqual(4);
        expect(reactions.debug.queuedReactions).toBeLessThanOrEqual(6);
        for (const key of ['energy', 'resonance', 'waveIntensity']) {
            expect(uniforms[key].value).toBeGreaterThanOrEqual(0);
            expect(uniforms[key].value).toBeLessThanOrEqual(1);
        }
        expect(reactions.pendingWave).toBeLessThanOrEqual(1);
    });

    it('decays and travels identically at 30 and 144 Hz', () => {
        const slow = create();
        const fast = create();
        for (const { reactions } of [slow, fast]) {
            reactions.lineClear(4);
            reactions.combo(8);
        }
        advance(slow.reactions, 3.1, 30);
        advance(fast.reactions, 3.1, 144);
        for (const key of ['time', 'energy', 'resonance', 'waveRadius', 'waveIntensity']) {
            expect(slow.uniforms[key].value).toBeCloseTo(fast.uniforms[key].value, 10);
        }
        for (let index = 0; index < slow.reactions.motes.length; index++) {
            const a = slow.reactions.motes[index];
            const b = fast.reactions.motes[index];
            expect(a.active).toBe(b.active);
            if (a.active) expect(a.position.distanceTo(b.position)).toBeLessThan(1e-10);
        }
        slow.reactions.update(20);
        fast.reactions.update(20);
        expect(slow.uniforms.waveRadius.value).toBe(-100);
        expect(fast.uniforms.waveRadius.value).toBe(-100);
        expect(slow.uniforms.waveIntensity.value).toBe(0);
        expect(slow.reactions.debug.activeMotes).toBe(0);
    });

    it('lets one wave finish and coalesces overlapping clear/combo successors', () => {
        const { reactions, uniforms } = create();
        reactions.lineClear(1);
        reactions.update(0.6);
        const radius = uniforms.waveRadius.value;
        const origin = uniforms.waveOrigin.value.clone();
        reactions.lineClear(4);
        reactions.combo(30);
        reactions.lineClear(1);
        expect(uniforms.waveRadius.value).toBe(radius);
        expect(uniforms.waveOrigin.value).toEqual(origin);
        expect(reactions.pendingWave).toBeGreaterThan(0.85);
        reactions.update(2.0);
        expect(uniforms.waveRadius.value).toBeCloseTo(4, 10);
        expect(uniforms.waveIntensity.value).toBeGreaterThan(0.85);
        expect(reactions.pendingWave).toBe(0);
        reactions.update(2.5);
        expect(uniforms.waveRadius.value).toBe(-100);
        expect(uniforms.waveIntensity.value).toBe(0);
    });

    it('makes locks visible with local shards, coronas and ripples without a global wave', () => {
        const { reactions, uniforms } = create();
        for (let index = 0; index < 50; index++) reactions.pieceLock();
        expect(uniforms.energy.value).toBe(0.18);
        expect(uniforms.resonance.value).toBe(0.1);
        expect(uniforms.waveRadius.value).toBe(-100);
        expect(uniforms.waveIntensity.value).toBe(0);
        expect(reactions.debug.activeArcs).toBe(0);
        expect(reactions.debug.activeShards).toBeGreaterThan(0);
        expect(reactions.debug.activeMotes).toBeGreaterThan(4);
        expect(reactions.debug.activeCoronas).toBeGreaterThan(0);
        expect(reactions.ripples.every((slot) => slot.growth <= 2.7)).toBe(true);
    });

    it('answers a first tetris on both walls and places echoes on open water', () => {
        const { reactions } = create();
        reactions.lineClear(4);
        const particles = [...reactions.shards, ...reactions.motes].filter((slot) => slot.active);
        expect(particles.some((slot) => slot.origin.x < 0)).toBe(true);
        expect(particles.some((slot) => slot.origin.x > 0)).toBe(true);
        for (const ripple of reactions.ripples) {
            if (!ripple.active) continue;
            expect(Math.abs(ripple.mesh.position.x)).toBeGreaterThanOrEqual(5.8);
            expect(Math.abs(ripple.mesh.position.x)).toBeLessThanOrEqual(7.8);
            expect(ripple.mesh.position.y).toBe(-6.95);
        }
    });

    it('responds to combo one on both walls and scales higher combos through staggered launches', () => {
        const results = [1, 3, 8].map((level) => {
            const result = create(QUALITY_PRESETS.High);
            expect(result.reactions.combo(level)).toBe(true);
            result.level = level;
            result.initialEnergy = result.uniforms.energy.value;
            result.initialResonance = result.uniforms.resonance.value;
            result.queued = result.reactions.debug.queuedReactions;
            return result;
        });
        const single = results[0].reactions;
        expect(single.debug.activeArcs).toBe(2);
        expect(single.debug.activeCoronas).toBe(2);
        expect(single.motes.some((slot) => slot.active && slot.origin.x < 0)).toBe(true);
        expect(single.motes.some((slot) => slot.active && slot.origin.x > 0)).toBe(true);
        expect(results[0].queued).toBe(0);
        expect(results[1].queued).toBeGreaterThan(results[0].queued);
        expect(results[2].queued).toBeGreaterThan(results[1].queued);
        expect(results[1].initialEnergy).toBeGreaterThan(results[0].initialEnergy);
        expect(results[2].initialResonance).toBeGreaterThan(results[1].initialResonance);
        for (const result of results) result.reactions.update(0.8);
        expect(results[2].reactions.debug.activeArcs).toBeGreaterThan(single.debug.activeArcs);
        expect(results[2].reactions.debug.activeCoronas).toBeGreaterThan(single.debug.activeCoronas);
        expect(results[2].reactions.debug.queuedReactions).toBe(0);
    });

    it('ages every cascade by its exact launch time across a long frame', () => {
        const oneFrame = create(QUALITY_PRESETS.High);
        const slow = create(QUALITY_PRESETS.High);
        const fast = create(QUALITY_PRESETS.High);
        for (const { reactions } of [oneFrame, slow, fast]) reactions.combo(8);
        oneFrame.reactions.update(0.8);
        advance(slow.reactions, 0.8, 30);
        advance(fast.reactions, 0.8, 144);
        for (const comparison of [slow, fast]) {
            for (const key of ['energy', 'resonance', 'waveRadius', 'waveIntensity']) {
                expect(comparison.uniforms[key].value).toBeCloseTo(oneFrame.uniforms[key].value, 10);
            }
            for (const collection of ['motes', 'shards', 'arcs', 'ripples', 'coronas']) {
                const slots = comparison.reactions[collection];
                for (let index = 0; index < slots.length; index++) {
                    const expected = oneFrame.reactions[collection][index];
                    const actual = slots[index];
                    expect(actual.active).toBe(expected.active);
                    expect(actual.age).toBeCloseTo(expected.age, 10);
                    if (actual.active && actual.position) {
                        expect(actual.position.distanceTo(expected.position)).toBeLessThan(1e-10);
                    }
                    if (actual.opacity) expect(actual.opacity.value).toBeCloseTo(expected.opacity.value, 10);
                    if (actual.progress) expect(actual.progress.value).toBeCloseTo(expected.progress.value, 10);
                }
            }
        }
        const later = oneFrame.reactions.coronas.filter((slot) => slot.active)
            .sort((a, b) => a.age - b.age)[0];
        expect(later.age).toBeGreaterThan(0.2);
        expect(later.age).toBeLessThan(0.3);
    });

    it('gives each combo burst a different jewel palette shared by its corona, ripple and ribbon', () => {
        const { reactions } = create(QUALITY_PRESETS.High);
        reactions.combo(8);
        reactions.update(0.8);
        const colors = reactions.coronas.filter((slot) => slot.active).map((slot) => slot.tint.value.getHex());
        expect(new Set(colors).size).toBeGreaterThanOrEqual(4);
        const matched = reactions.coronas.filter((slot) => slot.active && slot.age < 0.3)[0];
        const ripple = reactions.ripples.find((slot) => slot.active && Math.abs(slot.age - matched.age) < 1e-9);
        const arc = reactions.arcs.find((slot) => slot.active && Math.abs(slot.age - matched.age) < 1e-9);
        expect(ripple.tint.value).toEqual(matched.tint.value);
        expect(arc.tint.value).toEqual(matched.tint.value);
        expect(arc.accent.value).toEqual(matched.accent.value);
        reactions.reset();
        reactions.combo(8);
        reactions.update(0.8);
        expect(reactions.coronas.filter((slot) => slot.active).map((slot) => slot.tint.value.getHex())).toEqual(colors);
    });

    it('prefers Infinity viewport origin and uses occupied piece centroid for wall placement', () => {
        const { reactions } = create();
        reactions.pieceLock({ piece: { x: 8, y: 900, shape: [[1, 1]] }, viewportOrigin: { x: 0.1, y: 0.9 } });
        expect(reactions.coronas.find((slot) => slot.active).mesh.position.x).toBeLessThan(0);
        reactions.reset();
        reactions.pieceLock({ piece: { x: 3, shape: [[0, 0, 1, 1]] } });
        expect(reactions.coronas.find((slot) => slot.active).mesh.position.x).toBeGreaterThan(0);
        reactions.reset();
        reactions.pieceLock({ viewportOrigin: { x: NaN, y: 0.3 }, piece: { x: -2 } });
        expect(reactions.coronas.find((slot) => slot.active).mesh.position.x).toBeLessThan(0);
    });

    it('uses validated piece colors in the local corona while rejecting malformed color values', () => {
        const { reactions } = create();
        const warning = vi.spyOn(console, 'warn');
        reactions.pieceLock({ piece: { x: 2, color: '#ff3fba' } });
        const expected = new THREE.Color('#ff3fba');
        expect(reactions.coronas.find((slot) => slot.active).tint.value).toEqual(expected);
        reactions.reset();
        reactions.pieceLock({ piece: { x: 2, color: 'not-a-color' } });
        expect(warning).not.toHaveBeenCalled();
        expect(reactions.coronas.find((slot) => slot.active).tint.value.toArray().every(Number.isFinite)).toBe(true);
    });

    it.each(Object.entries(QUALITY_PRESETS))('keeps visible jewel feedback in the %s tier', (_, preset) => {
        const { reactions } = create(preset);
        reactions.pieceLock();
        reactions.update(0.15);
        expect(reactions.debug.activeShards).toBeGreaterThan(0);
        expect(reactions.debug.activeMotes).toBeGreaterThan(4);
        expect(reactions.coronas.some((slot) => slot.opacity.value > 0.4)).toBe(true);
        reactions.combo(1);
        reactions.update(0.35);
        expect(reactions.arcs.some((slot) => slot.opacity.value > 0.2)).toBe(true);
        expect(reactions.debug.activeCoronas).toBeGreaterThan(0);
        for (const arc of reactions.arcs) {
            if (!arc.active) continue;
            // The full emissive ribbon, including its broad edges, stays outboard.
            const { array } = arc.positions;
            for (let index = 0; index < array.length; index += 3) {
                expect(Math.abs(array[index])).toBeGreaterThanOrEqual(6 - 1e-6);
            }
        }
        for (const corona of reactions.coronas) {
            if (!corona.active) continue;
            const innerEdge = Math.abs(corona.mesh.position.x) - corona.mesh.scale.x;
            expect(innerEdge).toBeGreaterThan(5);
        }
    });

    it('cancels every delayed launch on reset and disposal without new resources', () => {
        const { reactions } = create();
        reactions.combo(8);
        expect(reactions.debug.queuedReactions).toBeGreaterThan(0);
        const geometryCount = reactions.debug.geometries;
        const materialCount = reactions.debug.materials;
        reactions.reset();
        reactions.update(1.2);
        expect(reactions.debug.queuedReactions).toBe(0);
        expect(reactions.debug.activeCoronas + reactions.debug.activeArcs + reactions.debug.activeMotes).toBe(0);
        expect(reactions.debug.geometries).toBe(geometryCount);
        expect(reactions.debug.materials).toBe(materialCount);
        reactions.combo(8);
        reactions.dispose();
        reactions.update(3);
        expect(reactions.debug.queuedReactions).toBe(0);
        expect(reactions.debug.activeCoronas).toBe(0);
    });

    it('keeps finite fragment and filament positions outside the board corridor', () => {
        const { reactions } = create();
        reactions.combo(20);
        reactions.lineClear(4);
        reactions.update(1.4);
        for (const slot of [...reactions.shards, ...reactions.motes]) {
            if (!slot.active) continue;
            expect(slot.position.toArray().every(Number.isFinite)).toBe(true);
            expect(Math.abs(slot.position.x)).toBeGreaterThanOrEqual(6);
        }
        for (const arc of reactions.arcs) {
            if (!arc.active) continue;
            const coordinates = arc.positions.array;
            const sign = Math.sign(coordinates[0]);
            for (let index = 0; index < coordinates.length; index += 3) {
                expect(Number.isFinite(coordinates[index])).toBe(true);
                expect(Number.isFinite(coordinates[index + 1])).toBe(true);
                expect(Number.isFinite(coordinates[index + 2])).toBe(true);
                expect(Math.sign(coordinates[index])).toBe(sign);
                expect(Math.abs(coordinates[index])).toBeGreaterThan(5);
            }
        }
        for (const mesh of [reactions.shardMesh, reactions.moteMesh]) {
            expect(mesh.instanceMatrix.array.every(Number.isFinite)).toBe(true);
            expect(mesh.material.isMeshBasicNodeMaterial).toBe(true);
        }
    });

    it('rejects malformed counts/times and supports empty effect budgets', () => {
        const { reactions, uniforms } = create({ eventParticles: 0, maxArcs: 0, maxRipples: 0 });
        for (const value of [null, undefined, '', false, true, NaN, Infinity, -1, {}, []]) {
            expect(reactions.lineClear(value)).toBe(value === undefined);
            expect(reactions.combo(value)).toBe(false);
        }
        reactions.reset();
        reactions.combo(5);
        const before = uniforms.energy.value;
        for (const invalid of [NaN, Infinity, -1, 0]) reactions.update(invalid);
        expect(uniforms.energy.value).toBe(before);
        expect(reactions.debug.particles).toBe(0);
        expect(reactions.debug.materials).toBe(0);
        reactions.update(10);
        expect(uniforms.waveIntensity.value).toBe(0);
    });

    it('reset clears reactions and reproduces the same authored event sequence', () => {
        const { reactions, uniforms } = create();
        reactions.combo(8);
        reactions.update(0.8);
        const positions = reactions.motes.map((slot) => slot.position.toArray());
        reactions.reset();
        expect(uniforms.energy.value).toBe(0);
        expect(uniforms.resonance.value).toBe(0);
        expect(uniforms.waveIntensity.value).toBe(0);
        expect(reactions.debug.activeArcs + reactions.debug.activeMotes + reactions.debug.activeRipples).toBe(0);
        reactions.combo(8);
        reactions.update(0.8);
        expect(reactions.motes.map((slot) => slot.position.toArray())).toEqual(positions);
    });

    it('disposes every owned GPU resource once and leaves its parent intact', () => {
        const { reactions, scene, uniforms } = create();
        const sentinel = new THREE.Object3D();
        scene.add(sentinel);
        reactions.combo(8);
        const resources = [...reactions.geometries, ...reactions.materials, ...reactions.group.children];
        const spies = resources.map((resource) => vi.spyOn(resource, 'dispose'));
        reactions.dispose();
        reactions.dispose();
        for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
        expect(scene.children).toEqual([sentinel]);
        expect(reactions.group.children).toHaveLength(0);
        expect(reactions.debug.materials + reactions.debug.geometries).toBe(0);
        expect(reactions.pieceLock()).toBe(false);
        expect(reactions.lineClear(4)).toBe(false);
        expect(reactions.combo(5)).toBe(false);
        reactions.update(0.5);
        expect(uniforms.energy.value).toBe(0);
    });
});
