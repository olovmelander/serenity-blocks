/**
 * The webgpu-threejs-tsl skill's starter template builds, on both backends.
 *
 * `.claude/skills/webgpu-threejs-tsl/templates/theme-starter.effect.js` is the code a new theme
 * or effect starts from, and the skill presents it as keeping every house rule. An example that
 * no longer builds, or that breaks a rule it teaches, misleads every session that copies it. So
 * it is held to what a theme's own shader gate holds (no GPU needed): every material is built
 * through three's WGSL builder (the WebGPU backend) and its GLSL builder (the WebGL2 backend),
 * at the richest tier and the leanest.
 *
 * What this cannot see: the shaders are generated, not compiled, and nothing is drawn. The
 * picture was checked in the playground when the template was written; check it again there
 * when you change it (CLAUDE.md, ADR-0007).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    STARTER_QUALITY, WAVE_ROWS, create, createStarterWorld, meta, tierFor,
} from '../../.claude/skills/webgpu-threejs-tsl/templates/theme-starter.effect.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

const TIERS = ['Extreme', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** The largest stage today is the sky's fragment, about 3 KB of WGSL. */
const STAGE_BUDGET = 16 * 1024;

describe('agent skill template (theme-starter)', () => {
    it('follows the playground contract', () => {
        expect(meta.id).toBe('theme-starter');
        expect(typeof create).toBe('function');
        expect(Object.keys(STARTER_QUALITY)).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        expect(tierFor('nonsense')).toBe(STARTER_QUALITY.High);
    });

    for (const quality of TIERS) {
        for (const [label, Builder] of BACKENDS) {
            it(`builds every material to ${label} at ${quality}`, () => {
                const world = createStarterWorld({ scene: new THREE.Scene(), quality });
                expect(world.parts.map((p) => p.mesh.name)).toEqual(['StarterGround', 'StarterSky', 'StarterMotes']);
                for (const { mesh } of world.parts) {
                    const built = build(Builder, mesh);
                    expect(built.thrown, `${mesh.name}: ${built.thrown?.stack ?? ''}`).toBeUndefined();
                    expect(built.heard, `${mesh.name} warned`).toEqual([]);
                    for (const stage of ['vertex', 'fragment']) {
                        const text = built[stage];
                        expect(text.length, `${mesh.name} ${stage}`).toBeGreaterThan(0);
                        expect(text.length, `${mesh.name} ${stage} size`).toBeLessThan(STAGE_BUDGET);
                        // A JavaScript operator on a node prints one of these into the shader.
                        expect(text, `${mesh.name} ${stage}`).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                    }
                    if (label === 'WGSL') {
                        expect(unassignedReads(built.vertex), `${mesh.name} vertex`).toEqual([]);
                        expect(unassignedReads(built.fragment), `${mesh.name} fragment`).toEqual([]);
                    }
                }
                world.dispose();
            });
        }
    }

    it('emits its laid-out helper once, as a real function', () => {
        const world = createStarterWorld({ scene: new THREE.Scene(), quality: 'Extreme' });
        const sky = world.parts.find((p) => p.mesh.name === 'StarterSky');
        const { fragment } = build(THREE.WGSLNodeBuilder, sky.mesh);
        expect(fragment.match(/fn starter_hash21\b/g)?.length).toBe(1);
        world.dispose();
    });

    it('drops the dither TERM on lean tiers instead of zeroing it', () => {
        const world = createStarterWorld({ scene: new THREE.Scene(), quality: 'Minimal' });
        const sky = world.parts.find((p) => p.mesh.name === 'StarterSky');
        const { fragment } = build(THREE.WGSLNodeBuilder, sky.mesh);
        expect(fragment).not.toMatch(/starter_hash21/);
        world.dispose();
    });

    it('loops over the event table to a live count, not once per row', () => {
        const world = createStarterWorld({ scene: new THREE.Scene(), quality: 'High' });
        const sky = world.parts.find((p) => p.mesh.name === 'StarterSky');
        const { fragment } = build(THREE.WGSLNodeBuilder, sky.mesh);
        expect(fragment.match(/\bfor\s*\(/g)?.length).toBe(1);
        world.dispose();
    });

    it('packs live waves at the front of the table and keeps them unit length', () => {
        const world = createStarterWorld({ scene: new THREE.Scene(), quality: 'Low' });
        world.holdWave({ x: 3, y: 4, z: 0 }, 0.5);
        world.writeWaves(100);
        expect(world.u.waveCount.value).toBe(1);
        const row = world.u.tables.waveRows[0];
        expect(Math.hypot(row.x, row.y, row.z)).toBeCloseTo(1, 6);
        expect(row.w).toBeCloseTo(0.5, 6);

        world.holdWave(null);
        for (let i = 0; i < WAVE_ROWS + 3; i++) world.fireWave({ x: 0, y: 1, z: 0 }, 99.9);
        world.writeWaves(100);
        expect(world.u.waveCount.value).toBeLessThanOrEqual(WAVE_ROWS);
        expect(world.u.waveCount.value).toBeGreaterThan(0);
        world.dispose();
    });

    it('is a closed form of the time: the same t gives the same table', () => {
        const a = createStarterWorld({ scene: new THREE.Scene(), quality: 'Low' });
        const b = createStarterWorld({ scene: new THREE.Scene(), quality: 'Low' });
        a.writeWaves(3.3);
        a.writeWaves(41.7);
        b.writeWaves(41.7);
        expect(a.u.waveCount.value).toBe(b.u.waveCount.value);
        expect(a.u.tables.waveRows.map((r) => r.toArray())).toEqual(b.u.tables.waveRows.map((r) => r.toArray()));
        a.dispose();
        b.dispose();
    });
});
