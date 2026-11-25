/**
 * Galaxy shader gate — no GPU needed.
 *
 * Every part's material is built through three's own node builders against a stub renderer: the
 * WGSL one the WebGPU backend uses and the GLSL one of the WebGL2 fallback, at the tier the theme
 * defaults to and at the leanest. A graph one builder cannot turn into a shader throws or warns
 * here instead of leaving a part undrawn on someone's machine.
 *
 * What it cannot see: the WGSL and GLSL are not compiled, so a shader the browser rejects can
 * still pass. The screenshot is still required.
 */
import {
    afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GALAXY_PARTS, GalaxyWorld } from '../../src/themes/galaxy/galaxy-world.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { materialXNoiseFunctions } from './helpers/materialx-noise.js';

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** The largest stage today is the disc's fragment (the volume walk) at about 30 KB of WGSL. */
const STAGE_BUDGET = 64 * 1024;

describe.each(TIERS)('galaxy shaders at %s', (quality) => {
    let world;
    /** part → backend → { vertex, fragment, heard } or { thrown } */
    const built = {};

    beforeAll(() => {
        world = new GalaxyWorld({ scene: new THREE.Scene(), quality, capture: true }).build();
        GALAXY_PARTS.forEach((name) => {
            built[name] = {};
            BACKENDS.forEach(([label, Builder]) => {
                built[name][label] = build(Builder, world.parts[name].mesh);
            });
        });
    });

    afterAll(() => {
        world.dispose();
    });

    it('has a node material to build for every part', () => {
        expect(Object.keys(world.parts).sort()).toEqual([...GALAXY_PARTS].sort());
        GALAXY_PARTS.forEach((name) => {
            expect(world.parts[name].mesh.material.isNodeMaterial, name).toBe(true);
        });
    });

    it.each(GALAXY_PARTS)('builds the %s for WebGPU and for the WebGL2 fallback without a word', (name) => {
        BACKENDS.forEach(([label]) => {
            const out = built[name][label];
            expect(out.thrown, `${name}, ${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(out.heard, `${name}, ${label}`).toEqual([]);
            for (const stage of ['vertex', 'fragment']) {
                expect(typeof out[stage], `${name}, ${label} ${stage}`).toBe('string');
                expect(out[stage].length, `${name}, ${label} ${stage}`).toBeGreaterThan(200);
                // A feature unrolled in JavaScript instead of looped shows up as a module of 100 KB.
                expect(Buffer.byteLength(out[stage]), `${name}, ${label} ${stage}`).toBeLessThan(STAGE_BUDGET);
                // A JavaScript operator on a node prints these into the shader.
                expect(out[stage], `${name}, ${label} ${stage}`).not.toMatch(/NaN|object Object|undefined/);
            }
            expect(materialXNoiseFunctions(`${out.vertex}${out.fragment}`), `${name}, ${label}`).toEqual([]);
        });
        expect(built[name].WGSL.vertex).toMatch(/@vertex/);
        expect(built[name].WGSL.fragment).toMatch(/@fragment/);
        expect(built[name].GLSL.vertex).toMatch(/void main\(\)/);
        expect(built[name].GLSL.fragment).toMatch(/void main\(\)/);
    });

    it.each(GALAXY_PARTS)('reads no variable of the %s before it is assigned', (name) => {
        for (const stage of ['vertex', 'fragment']) {
            expect(unassignedReads(built[name].WGSL[stage]), `${name} ${stage}`).toEqual([]);
        }
    });

    it('keeps the event loops behind their own switches, so a galaxy at rest pays for none', () => {
        // The disc's ripples, waves and arm pulses are each one uniform branch.
        const disc = built.disc.WGSL.fragment;
        expect((disc.match(/\bif\s*\(/g) || []).length).toBeGreaterThanOrEqual(4);
        // The sky's halo, its nearer galaxies and its companion are branched out of the pixels
        // that cannot show them (Minimal draws no deep field: one branch fewer).
        const sky = built.sky.WGSL.fragment;
        expect((sky.match(/\bif\s*\(/g) || []).length).toBeGreaterThanOrEqual(quality === 'Minimal' ? 3 : 4);
    });
});
