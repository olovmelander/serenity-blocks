import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { IceTempleWorld } from '../../src/themes/ice-temple/ice-temple-world.js';
import { build, stubRenderer, unassignedReads } from './helpers/tsl-node-build.js';

describe.each(['Minimal', 'High'])('Ice Temple %s materials', (quality) => {
    it.each([
        ['WGSL', THREE.WGSLNodeBuilder],
        ['GLSL', THREE.GLSLNodeBuilder],
    ])('emits valid shader graphs for the %s backend', (language, Builder) => {
        const world = new IceTempleWorld({ scene: new THREE.Scene(), quality, capture: true }).build();
        const renderer = {
            ...stubRenderer(),
            getDrawingBufferSize: (out) => out.set(1280, 720),
        };
        try {
            for (const [name, part] of Object.entries(world.parts)) {
                const result = build(Builder, part.mesh, renderer);
                expect(result.thrown, name).toBeUndefined();
                expect(result.heard, name).toEqual([]);
                for (const stage of [result.vertex, result.fragment]) {
                    expect(stage, name).not.toMatch(/\b(?:NaN|Infinity)\b|\[object Object\]/);
                    if (language === 'WGSL') expect(unassignedReads(stage), name).toEqual([]);
                }
            }
        } finally {
            world.dispose();
        }
    }, 30_000);
});
