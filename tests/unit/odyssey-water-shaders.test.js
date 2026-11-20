import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { createOdysseyWorld } from '../../src/rendering/odyssey/world/odyssey-world-renderer.js';
import { ODYSSEY_NORTH_LAKE } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { WATER_SHORE_DEPTH_BIAS } from '../../src/rendering/odyssey/world/odyssey-water-looks.js';

/**
 * The north lake's real water and the sea's look from above (2026-11-02), and the tarn's clear
 * water (2026-11-20), build clean on both backends and both tiers: no throw, nothing said, no NaN
 * or Infinity in the source, and no var read before it is certainly assigned (the lake's and the
 * tarn's depth is shared by their colour and their opacity; the sea's shore foam is refined inside
 * the topside branch and read by its opacity). The ground, which reads the tarn's plate in a
 * branch for its height, its slope and its shore, builds clean too.
 */
describe('the waters build clean (2026-11-02, the tarn 2026-11-20)', () => {
    ['high', 'low'].forEach((quality) => {
        it(`${quality}: the lake, the tarn, the sea and the ground`, () => {
            const world = createOdysseyWorld({
                quality, forest: false, cloudField: false,
            });
            const lake = world.group.getObjectByName('odyssey-world-north-lake-0');
            const tarn = world.group.getObjectByName('odyssey-world-tarn');
            const sea = world.group.getObjectByName('odyssey-world-water');
            const ground = world.group.getObjectByName('odyssey-world-ground');
            expect(lake).toBeTruthy();
            expect(tarn).toBeTruthy();
            expect(sea).toBeTruthy();
            expect(ground).toBeTruthy();
            // The lake and the tarn are blended films (the soft shore), drawn after the land.
            [lake, tarn].forEach((mesh) => {
                expect(mesh.material.transparent, mesh.name).toBe(true);
                expect(mesh.material.depthWrite, mesh.name).toBe(false);
                expect(mesh.material.opacityNode, mesh.name).toBeTruthy();
            });
            // The shore's depth fight (2026-11-03): every film is drawn a few depth steps nearer
            // the eye, a constant bias in the depth buffer's own steps (no slope term).
            [lake, tarn, sea].forEach((mesh) => {
                expect(mesh.material.polygonOffset, mesh.name).toBe(true);
                expect(mesh.material.polygonOffsetUnits, mesh.name).toBe(-WATER_SHORE_DEPTH_BIAS);
                expect(mesh.material.polygonOffsetFactor, mesh.name).toBe(0);
            });
            ODYSSEY_NORTH_LAKE.lobes.forEach((_, i) => {
                expect(world.group.getObjectByName(`odyssey-world-north-lake-${i}`)?.material).toBe(lake.material);
            });
            const marks = new Map([[lake, /lakeRootDepth/], [tarn, /tarnRootDepth/], [sea, /wShoreFoam/], [ground, /fTarnGrad/]]);
            [lake, tarn, sea, ground].forEach((mesh) => {
                [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]].forEach(([label, Builder]) => {
                    const out = build(Builder, mesh);
                    const tag = `${quality} ${mesh.name} ${label}`;
                    expect(out.thrown, `${tag} ${out.thrown?.stack ?? ''}`).toBeUndefined();
                    expect(out.heard, tag).toEqual([]);
                    expect(out.fragment, tag).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                    if (label === 'WGSL') {
                        expect(unassignedReads(out.fragment), tag).toEqual([]);
                        // (the terms each pass added are in the module, by their var names)
                        expect(out.fragment, tag).toMatch(marks.get(mesh));
                    }
                });
            });
            world.dispose?.();
        }, 180_000);
    });
});
