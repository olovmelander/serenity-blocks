/** Fixed geometry, persistent sediment and dual-backend shader contracts. */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import {
    AIR_KIND, AIR_STRIDE, FAN_SLOTS, createAir, createSteam,
} from '../../src/themes/painted-ages/painted-ages-air.js';
import { WATER_STRIDE, createWater } from '../../src/themes/painted-ages/painted-ages-water.js';
import { HOODOO_STRIDE, createHoodoos } from '../../src/themes/painted-ages/painted-ages-hoodoo.js';
import { createPaintedAgesUniforms } from '../../src/themes/painted-ages/painted-ages-tsl.js';
import { tierFor } from '../../src/themes/painted-ages/painted-ages-quality.js';

const left = { id: 0, front: 0, points: new Float32Array([-320, 130, -700, -300, 80, -580, -250, 20, -450]) };
const right = { id: 1, front: 1, points: new Float32Array([380, 160, -850, 330, 90, -700, 310, 30, -500]) };
const bake = {
    chutes: [left, right],
    channels: [left.points, right.points],
    vents: [{ x: -150, y: 20, z: -330 }, { x: 175, y: 30, z: -570 }],
    desktopVents: [{ x: -190, y: 20, z: -430 }, { x: 180, y: 30, z: -240 }],
    heightAt: (x, z) => 40 + x * 0.01 - z * 0.01,
};
const colours = [[0.3, 0.1, 0.2], [0.1, 0.3, 0.2], [0.3, 0.2, 0.1], [0.2, 0.1, 0.3]];

function fixture(quality = 'Minimal') {
    const u = createPaintedAgesUniforms();
    const recordTexture = new THREE.DataTexture(new Uint8Array(16 * 512 * 4), 16, 512, THREE.RGBAFormat);
    const options = {
        u, tier: tierFor(quality), bake, recordTexture,
    };
    const parts = {
        air: createAir(options),
        water: createWater(options),
        steam: createSteam(options),
        hoodoo: createHoodoos(options),
    };
    return {
        ...parts,
        u,
        dispose() { Object.values(parts).forEach((part) => part.dispose()); recordTexture.dispose(); },
    };
}

function stubRenderer() {
    return {
        contextNode: context(),
        lighting: { enabled: false },
        backend: {
            device: null,
            capabilities: { getUniformBufferLimit: () => 65536 },
            extensions: { has: () => false },
            utils: { getTextureSampleData: () => ({ samples: 1, primarySamples: 1, isMSAA: false }) },
            compatibilityMode: false,
        },
        getRenderTarget: () => null,
        getMRT: () => null,
        shadowMap: { enabled: false, type: 0 },
        capabilities: {},
        library: { fromMaterial: (material) => material },
        nodes: {},
        getOutputRenderTarget: () => null,
        getOutputBufferType: () => THREE.HalfFloatType,
        currentColorSpace: 'srgb',
        outputColorSpace: 'srgb',
        toneMapping: 0,
        xr: { enabled: false },
        debug: { checkShaderErrors: false, diagnostics: { keywords: true } },
        getUniformBufferLimit: () => 65536,
        hasFeature: () => false,
        isOutputTarget: false,
        logarithmicDepthBuffer: false,
        reverseDepth: false,
        highPrecision: false,
    };
}

describe('Painted Ages fixed effect pools', () => {
    it('keeps talus until its own front is buried and replays deterministically without adding geometry', () => {
        const f = fixture();
        const { air } = f;
        const meshes = [...air.meshes];
        const replay = () => {
            air.fire({ chute: left, time: 1, color: colours[0] });
            air.fire({
                chute: right, time: 2, color: colours[1], hardDrop: true, distance: 18,
            });
            air.bury({ front: 0, time: 20 });
        };
        try {
            expect(air.data.every((value) => value === 0)).toBe(true);
            replay();
            expect(air.data[11]).toBe(AIR_KIND.fan);
            expect(air.data[16]).toBe(20);
            expect(air.data[AIR_STRIDE + 16]).toBe(1e9);
            expect(air.data[AIR_STRIDE + 12]).toBeGreaterThan(air.data[12]);
            const before = Array.from(air.data);
            air.reset(); replay();
            expect(Array.from(air.data)).toEqual(before);
            expect(air.meshes).toEqual(meshes);
            for (let i = 0; i < 100; i++) air.fire({ chute: left, time: i + 30, color: colours[0] });
            expect(air.geometry.instanceCount).toBe(tierFor('Minimal').airPool);
            expect(air.data.length).toBe(air.geometry.instanceCount * AIR_STRIDE);
            expect(air.geometry.getAttribute('aStart').data).toBe(air.geometry.getAttribute('aState').data);
            expect(air.data.slice(0, FAN_SLOTS * AIR_STRIDE).every(Number.isFinite)).toBe(true);
        } finally { f.dispose(); }
    });

    it('reserves meltwater, all four coloured flood streams and three capped spires at Minimal', () => {
        const f = fixture();
        try {
            f.water.setFlood({ time: 5, colors: colours });
            const streams = new Set();
            let meltwater = 0;
            for (let i = 0; i < f.water.count; i++) {
                const o = i * WATER_STRIDE;
                expect(f.water.data[o + 14]).toBe(5);
                if (f.water.data[o + 13] === 0) meltwater += 1;
                if (f.water.data[o + 13] === 1) streams.add(f.water.data[o + 11]);
            }
            expect([...streams].sort()).toEqual([0, 1, 2, 3]);
            expect(meltwater).toBeGreaterThan(0);
            for (let lines = 1; lines <= 3; lines++) f.hoodoo.fire({ time: lines, lines, chute: left });
            expect([0, 1, 2].map((i) => f.hoodoo.data[i * HOODOO_STRIDE + 4])).toEqual([18, 28, 40]);
            expect([0, 1, 2].map((i) => f.hoodoo.data[i * HOODOO_STRIDE + 6])).toEqual([1, 2, 3]);
            expect(f.steam.geometry.instanceCount).toBeGreaterThanOrEqual(2);
            expect(f.steam.data[8]).toBe(bake.desktopVents[0].x);
            expect(f.steam.data[10]).toBe(bake.desktopVents[0].z);
            expect(f.steam.data[12 + 8]).toBe(bake.desktopVents[1].x);
            expect(f.steam.geometry.getAttribute('aVent').data).toBe(f.steam.geometry.getAttribute('aField').data);
            f.hoodoo.reset();
            expect(f.hoodoo.data.every((value) => value === 0)).toBe(true);
        } finally { f.dispose(); }
    });

    it('falls pale ash for six seconds in the existing air pool while preserving loose fans', () => {
        const f = fixture();
        try {
            f.air.fire({ chute: left, time: 1, color: colours[0] });
            const fan = Array.from(f.air.data.slice(0, AIR_STRIDE));
            const fixedBuffer = f.air.buffer;
            const meshCount = f.air.meshes.length;
            f.air.ash({ time: 10 });
            let flakes = 0;
            for (let i = FAN_SLOTS; i < f.air.count; i++) {
                const o = i * AIR_STRIDE;
                if (f.air.data[o + 11] !== AIR_KIND.ash) continue;
                flakes += 1;
                expect(f.air.data[o + 3]).toBe(10);
                expect(f.air.data[o + 7]).toBe(6);
                expect(Math.max(...f.air.data.slice(o + 8, o + 11))).toBeLessThan(0.5);
            }
            expect(flakes).toBeGreaterThan(20);
            expect(f.air.meshes.length).toBe(meshCount);
            expect(f.air.buffer).toBe(fixedBuffer);
            expect(Array.from(f.air.data.slice(0, AIR_STRIDE))).toEqual(fan);
        } finally { f.dispose(); }
    });

    it('keeps near portrait grit and talus within a small board-cell footprint', () => {
        const f = fixture();
        try {
            f.u.aspect.value = 390 / 844;
            f.u.tanHalfFov.value = Math.tan((64 * Math.PI) / 360);
            f.u.camForward.value.set(0, -0.342, -0.94);
            f.u.boardCalm.value.set(0.17, 0.14, 0.83, 0.87);
            const chute = { front: 0, points: new Float32Array([-10, 43, 120, -10, 40, 132]) };
            f.air.fire({ chute, time: 1, color: colours[0] });
            const firstGrit = FAN_SLOTS * AIR_STRIDE;
            expect(f.air.data[firstGrit + 12]).toBeLessThan(8);
            expect(f.air.data[firstGrit + 13]).toBeLessThan(5);
            expect(f.air.data[12]).toBeLessThan(9);
            expect(f.air.data[13]).toBeLessThan(7);
        } finally { f.dispose(); }
    });

    it('fits a resting fan to the local slope without spanning a cliff face', () => {
        const u = createPaintedAgesUniforms();
        const cliffBake = { ...bake, heightAt: (x, z) => x * 4 + z * 3 };
        const air = createAir({ u, bake: cliffBake, tier: tierFor('Minimal') });
        try {
            air.fire({
                chute: left, time: 1, color: colours[0], hardDrop: true, distance: 30,
            });
            expect(air.data[0]).toBeCloseTo(4);
            expect(air.data[1]).toBeCloseTo(3);
            expect(air.data[12] * Math.abs(air.data[0])).toBeLessThanOrEqual(4.001);
            expect(air.data[13] * Math.abs(air.data[1])).toBeLessThanOrEqual(4.001);
            expect(air.data[5] - 2).toBeCloseTo(cliffBake.heightAt(air.data[4], air.data[6]));
        } finally { air.dispose(); }
    });

    it('preserves loose fans, pinnacle ages and flood colours across a quality rebuild', () => {
        const source = fixture('High');
        const restored = fixture('Minimal');
        try {
            source.air.fire({ chute: left, time: 4, color: colours[0] });
            source.air.fire({ chute: right, time: 5, color: colours[1] });
            source.air.bury({ front: 0, time: 6 });
            source.hoodoo.fire({ time: 7, lines: 2, chute: right });
            source.water.setFlood({ time: 8, colors: colours });
            for (const name of ['air', 'hoodoo', 'water']) {
                const fixedBuffer = restored[name].buffer;
                const saved = source[name].exportState();
                expect(restored[name].importState(saved)).toBe(true);
                expect(restored[name].buffer).toBe(fixedBuffer);
            }
            const fanEnd = FAN_SLOTS * AIR_STRIDE;
            const restoredFans = Array.from(restored.air.data.slice(0, fanEnd));
            expect(restoredFans).toEqual(Array.from(source.air.data.slice(0, fanEnd)));
            expect(restored.hoodoo.exportState()).toEqual(source.hoodoo.exportState());
            expect(restored.water.exportState()).toEqual(source.water.exportState());
            source.hoodoo.fire({ time: 9, lines: 3, chute: left });
            restored.hoodoo.fire({ time: 9, lines: 3, chute: left });
            expect(restored.hoodoo.exportState()).toEqual(source.hoodoo.exportState());
            const independent = restored.air.exportState();
            restored.air.reset();
            expect(independent.data[11]).toBe(AIR_KIND.fan);
        } finally { source.dispose(); restored.dispose(); }
    });
});

const BUILDERS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
describe.each(['Minimal', 'High'])('Painted Ages effect shaders at %s', (quality) => {
    it.each(BUILDERS)('builds all pools on %s', (label, Builder) => {
        const f = fixture(quality);
        const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            for (const part of [f.air, f.water, f.steam, f.hoodoo]) {
                for (const mesh of part.meshes) {
                    const builder = new Builder(mesh, stubRenderer());
                    builder.scene = new THREE.Scene();
                    builder.camera = new THREE.PerspectiveCamera();
                    builder.material = mesh.material;
                    builder.context.material = mesh.material;
                    builder.build();
                    expect(warnings.mock.calls, `${label} ${mesh.name}`).toEqual([]);
                    expect(errors.mock.calls, `${label} ${mesh.name}`).toEqual([]);
                    expect(builder.vertexShader).not.toMatch(/\bNaN\b|\bInfinity\b/);
                    expect(builder.fragmentShader).not.toMatch(/\bNaN\b|\bInfinity\b/);
                    expect(builder.fragmentShader.length).toBeLessThan(96 * 1024);
                    if (mesh.name === 'PaintedAgesRainCurtains') {
                        // Accessibility changes must reach both world drift and rain streaks
                        // through the shared live uniform on either shader backend.
                        expect(builder.uniforms.vertex.some(({ node }) => node === f.u.reducedMotion)).toBe(true);
                        expect(builder.uniforms.fragment.some(({ node }) => node === f.u.reducedMotion)).toBe(true);
                    }
                }
            }
        } finally { warnings.mockRestore(); errors.mockRestore(); f.dispose(); }
    });
});
