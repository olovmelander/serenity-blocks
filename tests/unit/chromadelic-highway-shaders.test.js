/**
 * Chromadelic Highway full-world shader gate — no GPU needed.
 *
 * Every mesh material `ChromadelicWorld` builds at High and Minimal (sky dome, starfield,
 * hero rainbow giant, moon, ringed ice giant, prism-glass highway, holographic rails,
 * Blender-sculpted gate pylons and roadside speed chevrons, neon arches, ring-air glow,
 * 3D twist helix, warp-tunnel ribbons, cosmic event portals, hyperspace streaks, stardust
 * motes, and meteors) is built through three's own node builders against a stub renderer:
 * WGSLNodeBuilder (WebGPU) and GLSLNodeBuilder (WebGL2).
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { ChromadelicWorld } from '../../src/themes/chromadelic-highway/chromadelic-highway-world.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { hasMaterialXNoise } from './helpers/materialx-noise.js';

vi.setConfig({ testTimeout: 60_000 });

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

function problemsOf({
    name, label, out,
}) {
    if (out.thrown) {
        return [`${name}, ${label} threw: ${out.thrown?.stack?.split('\n').slice(0, 5).join(' | ')}`];
    }
    const problems = (out.heard || []).map((said) => `${name}, ${label} said: ${said}`);
    for (const stage of ['vertex', 'fragment']) {
        const code = out[stage];
        if (typeof code !== 'string' || code.length < 100) {
            problems.push(`${name}, ${label}: missing ${stage} stage`);
            continue;
        }
        if (/\bNaN\b|\bInfinity\b/.test(code)) {
            problems.push(`${name}, ${label} ${stage}: NaN or Infinity literal`);
        }
        if (/object Object/.test(code)) {
            problems.push(`${name}, ${label} ${stage}: node stringified into code`);
        }
        if (hasMaterialXNoise(code)) {
            problems.push(`${name}, ${label} ${stage}: MaterialX noise detected`);
        }
    }
    if (label === 'WGSL') {
        for (const stage of ['vertex', 'fragment']) {
            unassignedReads(out[stage]).forEach((read) => {
                problems.push(`${name}, WGSL ${stage}: unassigned ${read}`);
            });
        }
    }
    return problems;
}

describe.each(TIERS)('Chromadelic Highway full-world shaders at %s', (quality) => {
    let world;
    const built = [];

    beforeAll(() => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(65, 16 / 9, 1, 20000);
        camera.updateProjectionMatrix();
        world = new ChromadelicWorld({ scene, quality }).build();
        world.setViewport(900, camera, 1600);
        world.updateCamera(camera, { time: 20, delta: 0 });
        world.update({ time: 20, delta: 0.016 }, camera);

        const meshes = [];
        scene.traverse((obj) => {
            if ((obj.isMesh || obj.isPoints) && obj.material) meshes.push(obj);
        });

        for (const obj of meshes) {
            for (const [label, Builder] of BACKENDS) {
                const out = build(Builder, obj);
                built.push({
                    name: obj.name || obj.material.name || 'unnamed',
                    label,
                    out,
                });
            }
        }
    });

    afterAll(() => world?.dispose());

    it('builds every mesh material cleanly on both WGSL and GLSL without MaterialX noise', () => {
        const expectedMin = quality === 'Minimal' ? 14 : 32;
        expect(built.length).toBeGreaterThanOrEqual(expectedMin);
        expect(built.flatMap(problemsOf)).toEqual([]);
    });

    it('includes the new 3D architecture and event spectacle meshes at High tier', () => {
        if (quality !== 'High') return;
        const names = new Set(built.map((b) => b.name));
        expect(names.has('chromadelic-pylons')).toBe(true);
        expect(names.has('chromadelic-chevrons')).toBe(true);
        expect(names.has('chromadelic-twist-helix')).toBe(true);
        expect(names.has('chromadelic-warp-rails')).toBe(true);
        expect(names.has('chromadelic-portals')).toBe(true);
    });
});
