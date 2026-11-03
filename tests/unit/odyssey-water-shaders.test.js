import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { createOdysseyWorld } from '../../src/rendering/odyssey/world/odyssey-world-renderer.js';
import { ODYSSEY_NORTH_LAKE } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { WATER_SHORE_DEPTH_BIAS } from '../../src/rendering/odyssey/world/odyssey-water-looks.js';

/**
 * The north lake's real water and the sea's look from above (2026-11-02) build clean on both
 * backends and both tiers: no throw, nothing said, no NaN or Infinity in the source, and no var
 * read before it is certainly assigned (the lake's depth is shared by its colour and its opacity;
 * the sea's shore foam is refined inside the topside branch and read by its opacity).
 */
describe('the waters build clean (2026-11-02)', () => {
    ['high', 'low'].forEach((quality) => {
        it(`${quality}: the lake and the sea`, () => {
            const world = createOdysseyWorld({
                quality, forest: false, cloudField: false,
            });
            const lake = world.group.getObjectByName('odyssey-world-north-lake-0');
            const sea = world.group.getObjectByName('odyssey-world-water');
            expect(lake).toBeTruthy();
            expect(sea).toBeTruthy();
            // The lake is a blended film now (the soft shore), drawn after the land.
            expect(lake.material.transparent).toBe(true);
            expect(lake.material.depthWrite).toBe(false);
            expect(lake.material.opacityNode).toBeTruthy();
            // The shore's depth fight (2026-11-03): both films are drawn a few depth steps nearer
            // the eye, a constant bias in the depth buffer's own steps (no slope term).
            [lake, sea].forEach((mesh) => {
                expect(mesh.material.polygonOffset, mesh.name).toBe(true);
                expect(mesh.material.polygonOffsetUnits, mesh.name).toBe(-WATER_SHORE_DEPTH_BIAS);
                expect(mesh.material.polygonOffsetFactor, mesh.name).toBe(0);
            });
            ODYSSEY_NORTH_LAKE.lobes.forEach((_, i) => {
                expect(world.group.getObjectByName(`odyssey-world-north-lake-${i}`)?.material).toBe(lake.material);
            });
            [lake, sea].forEach((mesh) => {
                [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]].forEach(([label, Builder]) => {
                    const out = build(Builder, mesh);
                    const tag = `${quality} ${mesh.name} ${label}`;
                    expect(out.thrown, `${tag} ${out.thrown?.stack ?? ''}`).toBeUndefined();
                    expect(out.heard, tag).toEqual([]);
                    expect(out.fragment, tag).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                    if (label === 'WGSL') {
                        expect(unassignedReads(out.fragment), tag).toEqual([]);
                        // (the terms this pass added are in the module, by their var names)
                        expect(out.fragment, tag).toMatch(mesh === lake ? /lakeRootDepth/ : /wShoreFoam/);
                    }
                });
            });
            world.dispose?.();
        }, 120_000);
    });
});
