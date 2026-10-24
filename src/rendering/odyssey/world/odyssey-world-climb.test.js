import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';

import { createOdysseyWorld } from './odyssey-world-renderer.js';
import { ODYSSEY_SEA_LEVEL } from './odyssey-world-height.js';

/**
 * THE CLIMB (2026-10-24). At the end of chapter 5 the board shrinks the world toward the
 * sea-level point beneath the eye (`setClimb`, scheduled by `worldClimbScale`), which the eye sees
 * as climbing above the clouds. What is pinned here is the transform: the point beneath the eye
 * holds still while everything else draws in, the sky dome keeps its size (it only looks along
 * directions, and shrunk with the rest it would come into view as a ball below the eye), and the
 * world is back at identity outside the climb.
 */
describe('setClimb — the world shrinks beneath the eye', () => {
    const world = createOdysseyWorld({
        quality: 'low', forest: false, cloudField: false, water: false,
    });
    const sky = world.group.getObjectByName('odyssey-world-sky');
    const eye = { x: 120, y: 1100, z: -900 };
    const below = new THREE.Vector3(eye.x, ODYSSEY_SEA_LEVEL, eye.z);
    const isIdentity = (m) => m.elements.every((v, i) => Math.abs(v - new THREE.Matrix4().elements[i]) < 1e-6);

    it('holds the point beneath the eye still and draws the rest in toward it', () => {
        world.setClimb(0.1, eye);
        world.group.updateMatrixWorld(true);
        expect(below.clone().applyMatrix4(world.group.matrixWorld).distanceTo(below)).toBeLessThan(1e-6);
        // A point 1,000 u out along the sea now draws 100 u out: seen from ten times as high.
        const out = new THREE.Vector3(eye.x + 1000, ODYSSEY_SEA_LEVEL, eye.z);
        expect(out.applyMatrix4(world.group.matrixWorld).distanceTo(below)).toBeCloseTo(100, 6);
    });

    it('keeps the sky dome its own size, wherever the climb is', () => {
        expect(sky).toBeTruthy();
        [0.5, 0.1, 0.02].forEach((s) => {
            world.setClimb(s, eye);
            world.group.updateMatrixWorld(true);
            expect(isIdentity(sky.matrixWorld), `scale ${s}`).toBe(true);
        });
    });

    it('is back at identity at scale 1, and without an eye to climb above', () => {
        world.setClimb(0.1, eye);
        world.setClimb(1, eye);
        world.group.updateMatrixWorld(true);
        expect(isIdentity(world.group.matrixWorld)).toBe(true);
        expect(isIdentity(sky.matrixWorld)).toBe(true);
        world.setClimb(0.1, eye);
        world.setClimb(0.2, null);
        world.group.updateMatrixWorld(true);
        expect(isIdentity(world.group.matrixWorld)).toBe(true);
    });
});

/** A device-less renderer for the node builders (the Act II life test's). */
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
        library: { fromMaterial: (m) => m },
        nodes: {},
        getOutputRenderTarget: () => null,
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

function build(Builder, mesh) {
    const heard = [];
    const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 300));
    const warn = vi.spyOn(console, 'warn').mockImplementation(listen);
    const error = vi.spyOn(console, 'error').mockImplementation(listen);
    try {
        const builder = new Builder(mesh, stubRenderer());
        builder.scene = new THREE.Scene();
        builder.camera = new THREE.PerspectiveCamera();
        builder.context.material = mesh.material;
        builder.material = mesh.material;
        builder.build();
        return { vertex: builder.vertexShader, fragment: builder.fragmentShader, heard };
    } catch (thrown) {
        return { thrown, heard };
    } finally {
        warn.mockRestore();
        error.mockRestore();
    }
}

/**
 * nodeVars read where no assignment has certainly run (the repo's `unassignedReads` gate, as in
 * tests/unit/black-hole-shaders.test.js): the melt is a uniform branch inside the sea's and the
 * ground's colour, the shape that trap needs.
 */
function unassignedReads(wgsl) {
    const found = [];
    let stack = null;
    let header = false;
    wgsl.split('\n').forEach((raw, index) => {
        const line = raw.trim();
        if (!stack) {
            if (/^fn \w+\s*\(/.test(line)) header = true;
            if (header && /\{$/.test(line)) {
                header = false;
                stack = [{ kind: 'fn', set: new Set() }];
            }
            return;
        }
        const check = (text) => {
            (text.match(/\bnodeVar\d+\b/g) || []).forEach((name) => {
                if (stack.some((block) => block.set.has(name))) return;
                found.push(`${name}, line ${index + 1}: ${line.slice(0, 120)}`);
            });
        };
        if (/^if\s*\(.*\)\s*\{$/.test(line)) {
            check(line);
            stack.push({ kind: 'if', set: new Set() });
        } else if (/^\}\s*else\s*\{$/.test(line)) {
            const branch = stack.pop();
            stack.push({ kind: 'else', set: new Set(), ifSet: branch.set });
        } else if (/^(for\s*\(.*\)|loop)\s*\{$/.test(line)) {
            check(line);
            stack.push({ kind: 'loop', set: new Set() });
        } else if (line === '}') {
            const block = stack.pop();
            if (block.kind === 'fn') stack = null;
            else if (block.kind === 'else') {
                block.set.forEach((name) => {
                    if (block.ifSet.has(name)) stack[stack.length - 1].set.add(name);
                });
            }
        } else if (!/^var\s+nodeVar\d+\s*:[^=]*;$/.test(line)) {
            const assignment = line.match(/^(?:var\s+)?(nodeVar\d+)\s*(?::[^=]*)?=(?!=)\s*(.*)$/);
            if (assignment) {
                check(assignment[2]);
                stack[stack.length - 1].set.add(assignment[1]);
            } else check(line);
        }
    });
    return found;
}

describe('the climbed world still builds on both backends', () => {
    // Every material now reads positions and the eye through the climb's frame, and the sea and
    // the ground melt into the sky at their drawn edge behind a uniform branch: built here as
    // WebGPU and the WebGL2 fallback write them, with nothing said and nothing stringified.
    const world = createOdysseyWorld({ quality: 'low', forest: false });
    const names = ['odyssey-world-ground', 'odyssey-world-water', 'odyssey-world-sky', 'odyssey-world-cloud-field'];
    const backends = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
    names.forEach((name) => {
        backends.forEach(([label, Builder]) => {
            it(`${name} (${label})`, () => {
                const mesh = world.group.getObjectByName(name);
                expect(mesh, name).toBeTruthy();
                const out = build(Builder, mesh);
                expect(out.thrown, `${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(out.heard).toEqual([]);
                ['vertex', 'fragment'].forEach((stage) => {
                    expect(typeof out[stage]).toBe('string');
                    expect(out[stage]).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                });
                // A real build, not an early return: these are the world's largest materials.
                expect(out.fragment.length, 'fragment size').toBeGreaterThan(4000);
                if (label === 'WGSL') {
                    expect(unassignedReads(out.vertex), 'vertex').toEqual([]);
                    expect(unassignedReads(out.fragment), 'fragment').toEqual([]);
                }
            }, 60_000);
        });
    });
});
